/** KGM 聊天 HTTP 超时：配置项可能为 60s，但 auto 路由 + 工具多轮常需更久 */

const BLOCKING_FLOOR_MS = 300_000; // 5 分钟
const STREAM_FLOOR_MS = 600_000; // 10 分钟
const CEILING_MS = 900_000; // 15 分钟上限

export function parseTimeoutMs(raw: unknown, fallbackMs = 60_000): number {
  const n = typeof raw === 'number' ? raw : parseInt(String(raw ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : fallbackMs;
}

export function resolveKgmChatTimeoutMs(
  configuredMs: unknown,
  mode: 'blocking' | 'stream' = 'blocking',
  opts?: { compactAttachmentChat?: boolean }
): number {
  const base = parseTimeoutMs(configuredMs, 60_000);
  let floor = mode === 'blocking' ? BLOCKING_FLOOR_MS : STREAM_FLOOR_MS;
  /** PDF compact 走非流式单请求，本地 qwen3.5 + RAG 常超过 300s */
  if (opts?.compactAttachmentChat) {
    floor = STREAM_FLOOR_MS;
  }
  return Math.min(Math.max(base, floor), CEILING_MS);
}

export function isFetchAbortError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = (err as { name?: string }).name;
  const msg = String((err as { message?: string }).message || '');
  return name === 'AbortError' || /aborted without reason/i.test(msg) || /\babort(ed)?\b/i.test(msg);
}

export function formatKgmFetchAbortMessage(
  timeoutMs: number,
  hints?: { payloadChars?: number; toolsCount?: number }
): string {
  const sec = Math.round(timeoutMs / 1000);
  const parts = [
    `KGM 推理请求超时（已等待约 ${sec} 秒）。`,
    '常见原因：PDF/附件过大、会话历史过长、或本机 Ollama 负载过高。'
  ];
  if (typeof hints?.payloadChars === 'number' && hints.payloadChars > 80_000) {
    parts.push(`本次上下文约 ${Math.round(hints.payloadChars / 1000)}k 字符，建议缩小附件或新建会话。`);
  }
  if (typeof hints?.toolsCount === 'number' && hints.toolsCount > 0) {
    parts.push(`已附带 ${hints.toolsCount} 个工具定义，可尝试关闭未用技能后重试。`);
  }
  parts.push(
    '可在聊天区选择具体云端模型（勿用 auto）；或在配置管理启用云端推理并确保 KGM Playground 已配置对应 route。'
  );
  parts.push('或执行 curl 探活 /kgm/v1/chat/completions。');
  return parts.join(' ');
}

/** @param timeoutMs 须为 {@link resolveKgmChatTimeoutMs} 已解析后的毫秒数 */
export function scheduleFetchAbort(
  controller: AbortController,
  timeoutMs: number,
  message?: string
): ReturnType<typeof setTimeout> {
  const ms = Math.min(Math.max(timeoutMs, 1000), CEILING_MS);
  const reason =
    message ||
    (typeof DOMException !== 'undefined'
      ? new DOMException(formatKgmFetchAbortMessage(ms), 'TimeoutError')
      : formatKgmFetchAbortMessage(ms));
  return setTimeout(() => controller.abort(reason), ms);
}
