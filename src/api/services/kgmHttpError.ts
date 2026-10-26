/** 解析 KGM / 网关返回的非 2xx JSON，生成用户可读错误 */

export function parseKgmErrorPayload(raw: string): {
  message: string;
  traceId?: string;
  code?: string;
  suggestedFix?: string;
} {
  const fallback = { message: raw.slice(0, 500) || '未知错误' };
  try {
    const j = JSON.parse(raw) as {
      error?: {
        message?: string;
        code?: string;
        kgm?: {
          traceId?: string;
          suggestedFix?: string;
          logRef?: string;
        };
      };
    };
    const err = j?.error;
    if (!err) return fallback;
    return {
      message: String(err.message || fallback.message),
      code: err.code,
      traceId: err.kgm?.traceId,
      suggestedFix: err.kgm?.suggestedFix
    };
  } catch {
    return fallback;
  }
}

export function formatKgmHttpError(status: number, raw: string): string {
  const p = parseKgmErrorPayload(raw);
  const parts = [`KGM 请求失败 HTTP ${status}: ${p.message}`];
  if (p.traceId) parts.push(`traceId=${p.traceId}`);
  if (/model\s+['"]?[\w.-]+['"]?\s+not found/i.test(p.message)) {
    parts.push(
      '该 model 仅在 KGM /v1/models 登记，Playground 未配置 L2 route。请打开 http://127.0.0.1:3080 为 deepseek-v4 / freemodel 等添加上游，或聊天区改选「KGM 动态路由 (auto)」。'
    );
  }
  if (status === 500 && /aborted/i.test(p.message)) {
    parts.push(
      '常见原因：本机 Ollama 仍在处理上一轮 PDF/聊天（并发被中断）。请等待约 30 秒后重试，或执行 ollama ps 查看是否有卡住的推理。'
    );
  }
  if (p.suggestedFix) parts.push(p.suggestedFix);
  return parts.join(' ');
}
