/**
 * KGM 聊天传输方式（流式 / 非流式）由代码自动决定，不向用户暴露选项。
 *
 * 经 KGM→Ollama 时 SSE 常无 delta.content，连接可空挂至上游超时（~240s）；
 * 阻塞式与 curl stream=false 一致；PDF compact 默认 blocking，避免空流 + 二次请求把 Ollama 打满。
 */

export type KgmChatTransport = 'stream' | 'blocking';

export function decideKgmChatTransport(opts?: {
  toolCount?: number;
  /** 出站 messages 估算字符数 */
  estimatedPayloadChars?: number;
  /** PDF 附件 compact：非流式单请求（与 curl stream=false 一致，避免空 SSE + 回退 500） */
  compactAttachmentChat?: boolean;
}): KgmChatTransport {
  void opts?.toolCount;
  if (opts?.compactAttachmentChat) return 'blocking';
  if (typeof opts?.estimatedPayloadChars === 'number' && opts.estimatedPayloadChars > 24_000) {
    return 'stream';
  }
  // 默认流式：blocking 固定 300s 下限，本地 Ollama 大 PDF 易误杀；空 SSE 由上层禁止回退 blocking 处理
  return 'stream';
}

/** 写入 buildRequestBody 的 stream 字段 */
export function kgmRequestUsesStream(transport: KgmChatTransport): boolean {
  return transport === 'stream';
}
