/** 发往 KGM 的请求体体积控制，避免超大上下文导致 5 分钟级超时 */

/** 出站 messages 字符预算（约 10k–12k tokens，适配本地 Ollama） */
export const KGM_MAX_PAYLOAD_CHARS = 40_000;

/** 估算 messages 序列化后的字符量（与实际上游 token 近似正相关） */
export function estimateKgmMessagesChars(messages: unknown[]): number {
  try {
    return JSON.stringify(messages).length;
  } catch {
    return messages.reduce<number>((sum, m) => {
      const c = (m as { content?: unknown })?.content;
      return sum + (typeof c === 'string' ? c.length : 0);
    }, 0);
  }
}

const TRUNCATION_SUFFIX =
  '\n\n[因上下文过长已自动截断。可缩小 PDF/附件、减少历史消息，或新建会话后重试。]';

function truncateSystemMessages(
  messages: Array<{ role?: string; content?: unknown }>,
  targetMax: number
): boolean {
  let estimated = estimateKgmMessagesChars(messages);
  if (estimated <= targetMax) return false;

  let changed = false;
  for (let i = messages.length - 1; i >= 0 && estimated > targetMax; i -= 1) {
    const msg = messages[i];
    if (msg?.role !== 'system' || typeof msg.content !== 'string') continue;
    const content = msg.content;
    if (content.length < 800) continue;
    const over = estimated - targetMax;
    const keep = Math.max(400, content.length - over - 80);
    messages[i] = {
      ...msg,
      content:
        content.slice(0, keep) +
        '\n\n[系统上下文过长已截断，优先保留附件与用户问题。]'
    };
    estimated = estimateKgmMessagesChars(messages);
    changed = true;
  }
  return changed;
}

/**
 * 当 messages 总体过大时，先截断最后一条 user，再必要时截断 system。
 */
export function clampKgmMessagesForRequest(
  messages: Array<{ role?: string; content?: unknown }>,
  maxPayloadChars = KGM_MAX_PAYLOAD_CHARS
): { clamped: boolean; estimatedChars: number } {
  let estimated = estimateKgmMessagesChars(messages);
  if (estimated <= maxPayloadChars) {
    return { clamped: false, estimatedChars: estimated };
  }

  let clamped = false;

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (msg?.role !== 'user' || typeof msg.content !== 'string') continue;

    const content = msg.content;
    const over = estimated - maxPayloadChars;
    const keep = Math.max(10_000, content.length - over - TRUNCATION_SUFFIX.length);
    messages[i] = {
      ...msg,
      content: content.slice(0, keep) + TRUNCATION_SUFFIX
    };
    estimated = estimateKgmMessagesChars(messages);
    clamped = true;
    break;
  }

  if (estimated > maxPayloadChars) {
    clamped = truncateSystemMessages(messages, maxPayloadChars) || clamped;
    estimated = estimateKgmMessagesChars(messages);
  }

  return { clamped, estimatedChars: estimated };
}
