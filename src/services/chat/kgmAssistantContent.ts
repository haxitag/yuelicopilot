/**
 * KGM / 聊天助手正文：从原始 SSE/API 形态转为可稳定渲染的 Markdown 字符串。
 *
 * - 流式分片：仅 coerce（结构拉平），不改全文。
 * - 回合结束 / 落盘 / 历史迁移：deck 级 prepareChatMessageContent（与展示层一致）。
 */

import type { Message } from '../../types';
import { prepareChatMessageContent } from '../../components/deck-render/chat/messageContentPipeline';
import { coerceAssistantContentToString } from '@haxitag/markdown-gfm-normalize';

export { coerceAssistantContentToString };

/** 流式 delta、工具结果等：只保证是 string，不改全文结构 */
export function coerceKgmStreamTextChunk(raw: unknown): string {
  return coerceAssistantContentToString(raw);
}

function prepareForStorage(raw: string): string {
  if (!raw.trim()) return raw;
  return prepareChatMessageContent(raw);
}

/**
 * 回合结束后的助手可见正文（写入 message.content / localStorage 前调用）。
 */
export function finalizeKgmAssistantMarkdown(raw: unknown): string {
  return prepareForStorage(coerceAssistantContentToString(raw));
}

/** 从 localStorage 恢复的历史消息：与 finalize 相同 */
export function normalizeStoredAssistantMarkdown(raw: unknown): string {
  return prepareForStorage(coerceAssistantContentToString(raw));
}

/** 是否为内置占位/系统提示文案，不做 Markdown 归一化 */
export function isBuiltinAssistantPlaceholder(content: string): boolean {
  const t = content.trim();
  return (
    t.startsWith('（本轮模型未输出可见正文') ||
    t.startsWith('（助手暂未返回可展示的正文') ||
    t.startsWith('（回复在上方「思考过程」') ||
    t.startsWith('（本轮在 **正文通道**') ||
    t.startsWith('❌ **请求失败**') ||
    t === '(streaming...)'
  );
}

/** 有工具调用但模型未产出正文时的用户向提示（{@link isBuiltinAssistantPlaceholder}） */
export const ASSISTANT_EMPTY_TOOLS_HINT =
  '（模型未生成文字总结，请展开上方「调用工具」查看结果；需要总结时可回复：请根据工具结果简要说明。）';

/** 正文与思考区均为空时的用户向提示（{@link isBuiltinAssistantPlaceholder}） */
export const ASSISTANT_EMPTY_UPSTREAM_HINT =
  '（助手暂未返回可展示的正文，请重试；若仍无回复，可在配置中更换模型或检查推理服务是否可用。）';

/** 按指标生成更可操作的空回复提示 */
export function buildAssistantEmptyUpstreamHint(opts?: {
  completionTokens?: number;
  totalLatencyMs?: number;
}): string {
  const ct = opts?.completionTokens;
  const ms = opts?.totalLatencyMs;
  const parts: string[] = [
    '（助手暂未返回可展示的正文。'
  ];
  if (typeof ct === 'number' && ct === 0) {
    parts.push(
      ' KGM/上游返回 completion_tokens=0，常见于 Ollama 思考模型只写 thinking 通道、或路由到无效云端模型。'
    );
  }
  if (typeof ms === 'number' && ms >= 115000) {
    parts.push(` 本轮耗时约 ${Math.round(ms / 1000)}s，可能已触发推理超时。`);
  }
  parts.push(
    ' 调试：Mac 应用顶部「调试工具栏」或菜单 调试→开发者工具；点「开请求日志」等价 ?debug=true；Console 执行 debugYueli。）'
  );
  return parts.join('');
}

/** 仅有思考区、未能解析出正文时的短提示（{@link isBuiltinAssistantPlaceholder}） */
export const ASSISTANT_THINKING_ONLY_HINT =
  '（回复在上方「思考过程」中，请展开查看；若仍为空，请重试或更换模型。）';

/**
 * Ollama / Qwen 等常把最终答复放在 thinking 块末尾（CLI 里在 “done thinking” 之后）。
 * 当 SSE 未单独推送 response 分片时，从 thinking 文本中提取可见答复。
 */
export function extractVisibleAnswerFromThinking(thinking: string): string | null {
  const t = thinking.trim();
  if (!t) return null;

  const doneMarkers = [
    /\.{2,}done thinking\.?\s*/i,
    /done thinking\.?\s*/i,
    /Thinking Process:\s*[\s\S]*?(?=\n\n[A-Za-z\u4e00-\u9fff])/i
  ];
  for (const re of doneMarkers) {
    const m = t.match(re);
    if (m && m.index != null) {
      const after = t.slice(m.index + m[0].length).trim();
      if (after.length > 0 && after.length < 8000) return after;
    }
  }

  const paragraphs = t.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
  if (paragraphs.length >= 2) {
    const last = paragraphs[paragraphs.length - 1];
    if (
      last.length > 0 &&
      last.length < 4000 &&
      !/^Thinking Process:/i.test(last) &&
      !/^\d+\.\s+\*\*/.test(last)
    ) {
      return last;
    }
  }

  // Qwen/Ollama 思考模型：整段 thinking 无分轨时，取末段非元叙述文本（避免 completion_tokens=0 空气泡）
  const stripped = t
    .replace(/^Thinking Process:\s*/im, '')
    .replace(/^\d+\.\s+\*\*[^*]+\*\*[^\n]*\n/gm, '')
    .trim();
  if (stripped.length > 120 && stripped.length < 12_000) {
    const tail = stripped.slice(-Math.min(3500, Math.floor(stripped.length * 0.45)));
    if (tail.length > 80 && /[\u4e00-\u9fffA-Za-z]{8,}/.test(tail)) return tail.trim();
  }
  return null;
}

function hasNonEmptySideChannelText(opts: {
  reasoningContent?: string;
  thinkingContent?: string;
  thinkingRecords?: Array<{ content?: string }>;
}): boolean {
  if (typeof opts.reasoningContent === 'string' && opts.reasoningContent.trim()) return true;
  if (typeof opts.thinkingContent === 'string' && opts.thinkingContent.trim()) return true;
  const records = opts.thinkingRecords;
  if (!Array.isArray(records)) return false;
  return records.some((r) => typeof r?.content === 'string' && r.content.trim().length > 0);
}

/**
 * 流结束后写入助手 **主气泡正文** 的文本：仅使用上游可见答复通道（如 Ollama 的 `response` 累加），
 * **不把** thinking/reasoning 提升为正文（避免与执行日志重复、避免出现整段 「Thinking Process:」）。
 * 若仅有思考/推理区有内容，正文留空，由聊天 UI 上方区块展示。
 */
export function pickAssistantVisibleRawText(opts: {
  accumulatedContent: string;
  toolCallRecords?: unknown[];
  reasoningContent?: string;
  thinkingContent?: string;
  thinkingRecords?: Array<{ content?: string }>;
  completionTokens?: number;
  totalLatencyMs?: number;
}): string {
  const acc = opts.accumulatedContent || '';
  if (acc.trim()) return acc;
  if (Array.isArray(opts.toolCallRecords) && opts.toolCallRecords.length > 0) {
    return ASSISTANT_EMPTY_TOOLS_HINT;
  }
  if (hasNonEmptySideChannelText(opts)) {
    const sideText =
      opts.thinkingContent?.trim() ||
      opts.reasoningContent?.trim() ||
      opts.thinkingRecords?.map((r) => r?.content?.trim()).filter(Boolean).join('\n\n') ||
      '';
    const extracted = extractVisibleAnswerFromThinking(sideText);
    if (extracted) return extracted;
    return ASSISTANT_THINKING_ONLY_HINT;
  }
  return buildAssistantEmptyUpstreamHint({
    completionTokens: opts.completionTokens,
    totalLatencyMs: opts.totalLatencyMs
  });
}

/** 回合结束写入 message.content 前：占位文案原样返回，其余走 finalize */
export function finalizeKgmAssistantMarkdownIfNeeded(raw: unknown): string {
  const s = coerceAssistantContentToString(raw);
  if (!s.trim() || isBuiltinAssistantPlaceholder(s)) return s;
  return finalizeKgmAssistantMarkdown(s);
}

/** 加载历史会话时，对 bot 条目的 content 做归一化（兼容旧 localStorage） */
export function normalizeBotMessagesForDisplay(messages: Message[]): Message[] {
  return messages.map((m) => {
    if (m.role !== 'bot' && m.role !== 'assistant') return m;
    const raw = m.content;
    if (raw == null) return m;
    const text = coerceAssistantContentToString(raw);
    if (!text.trim() || isBuiltinAssistantPlaceholder(text)) return m;
    return { ...m, content: normalizeStoredAssistantMarkdown(text) };
  });
}
