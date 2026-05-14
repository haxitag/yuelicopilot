import type { MessageMetrics } from '../../types';

/** 与 OpenAI / yueli-deck 风格 HTTP 响应对齐的用量块，便于观测与对账 */
export interface GenerationInfoUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface GenerationInfoEnvelope {
  usage: GenerationInfoUsage;
  /** 与 {@link MessageMetrics.providerHttpRounds} 一致：本轮工具循环内的 Provider HTTP 次数 */
  providerHttpRounds: number;
  model?: string;
}

/** 单条 SSE JSON 中解析出的 token 片段（同一次流内多 chunk 时以后出现的字段覆盖前者） */
export type StreamUsagePatch = Partial<
  Pick<MessageMetrics, 'promptTokens' | 'completionTokens' | 'totalTokens'>
>;

export function extractUsageFromSsePayload(rawData: unknown): StreamUsagePatch | undefined {
  if (!rawData || typeof rawData !== 'object') return undefined;
  const raw = rawData as Record<string, unknown>;
  const choice0 =
    Array.isArray(raw.choices) && raw.choices.length > 0 ? (raw.choices[0] as Record<string, unknown>) : undefined;
  const u = (raw.usage ?? choice0?.usage) as Record<string, unknown> | undefined;
  if (!u || typeof u !== 'object') return undefined;
  const out: StreamUsagePatch = {};
  const pt = u.prompt_tokens ?? u.promptTokens;
  const ct = u.completion_tokens ?? u.completionTokens;
  const tt = u.total_tokens ?? u.totalTokens;
  if (typeof pt === 'number' && Number.isFinite(pt)) out.promptTokens = pt;
  if (typeof ct === 'number' && Number.isFinite(ct)) out.completionTokens = ct;
  if (typeof tt === 'number' && Number.isFinite(tt)) out.totalTokens = tt;
  return Object.keys(out).length ? out : undefined;
}

/**
 * OpenAI 兼容流式末尾常见：仅含 `usage` 且 `choices` 缺失或为空数组。
 * 此类帧若走默认 transform 会把整段 JSON 拼进助手正文；应在合并 usage 后跳过正文管线。
 */
export function isPureOpenAiUsageChunk(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object') return false;
  const o = raw as Record<string, unknown>;
  if (!o.usage || typeof o.usage !== 'object') return false;
  if (!('choices' in o) || o.choices === null) return true;
  const ch = o.choices;
  if (!Array.isArray(ch)) return false;
  return ch.length === 0;
}

export function accumulateInvocationUsage(
  agg: { promptTokens: number; completionTokens: number; totalTokens: number },
  patch: StreamUsagePatch | undefined
): void {
  if (!patch) return;
  if (typeof patch.promptTokens === 'number') agg.promptTokens += patch.promptTokens;
  if (typeof patch.completionTokens === 'number') agg.completionTokens += patch.completionTokens;
  if (typeof patch.totalTokens === 'number') agg.totalTokens += patch.totalTokens;
}

export function buildInvocationMetrics(
  toolCallRounds: number,
  baselineToolHttp: number,
  invokeStartedAt: number,
  usageAgg: { promptTokens: number; completionTokens: number; totalTokens: number }
): MessageMetrics {
  const inv: MessageMetrics = {
    providerHttpRounds: toolCallRounds - baselineToolHttp,
    totalLatencyMs: Date.now() - invokeStartedAt
  };
  if (usageAgg.promptTokens > 0) inv.promptTokens = usageAgg.promptTokens;
  if (usageAgg.completionTokens > 0) inv.completionTokens = usageAgg.completionTokens;
  if (usageAgg.totalTokens > 0) inv.totalTokens = usageAgg.totalTokens;
  return inv;
}

/** 将聚合后的 token 与 HTTP 轮次封装为与 OpenAI `usage` 字段一致的结构（含零值，便于对账） */
export function buildGenerationInfoFromAgg(
  usageAgg: { promptTokens: number; completionTokens: number; totalTokens: number },
  providerHttpRounds: number,
  model?: string
): GenerationInfoEnvelope {
  const base: GenerationInfoEnvelope = {
    usage: {
      prompt_tokens: usageAgg.promptTokens,
      completion_tokens: usageAgg.completionTokens,
      total_tokens: usageAgg.totalTokens
    },
    providerHttpRounds
  };
  if (model) return { ...base, model };
  return base;
}
