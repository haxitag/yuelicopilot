import type { SkillManifest } from './SkillManifestSchema';
import { resolveSkillExecutorAuthHeaders, resolveSkillExecutorBaseUrl } from '../../utils/skillExecutorUrl';
import { devWarn } from '../../utils/devConsole';

const EVOLUTION_QUEUE_KEY = 'yueli_evolution_feedback_queue_v1';

/** 与 server `/v1/evolution/feedback` 及 evolutionStore 对齐 */
export interface SkillEvolutionFeedbackPayload {
  skillId: string;
  skillName: string;
  /** 推荐字段名 */
  execution_ms: number;
  /** 向后兼容 */
  durationMs: number;
  success: boolean;
  error?: string;
  args?: Record<string, unknown>;
  resultSize?: number;
  userRating?: number;
  result_valid?: boolean;
  /** 本次注入 LLM 的估算 token（system + 变量 + 用户输入） */
  tokens_injected?: number;
  /** 本次 schema 校验是否通过（0 | 1，聚合为 schema_pass_rate） */
  schema_pass_rate?: number;
  tool_round_count?: number;
  /** 执行剖面 / 管道阶段 */
  phase?: string;
  ab_variant?: string | null;
}

export function estimateTokensFromText(text: string): number {
  const t = text?.trim() ?? '';
  if (!t) return 0;
  return Math.max(1, Math.ceil(t.length / 4));
}

export function estimateTokensInjected(params: {
  systemPrompt?: string;
  userInput?: string;
  variables?: Record<string, unknown>;
}): number {
  let total = 0;
  total += estimateTokensFromText(params.systemPrompt ?? '');
  total += estimateTokensFromText(params.userInput ?? '');
  if (params.variables) {
    try {
      total += estimateTokensFromText(JSON.stringify(params.variables));
    } catch {
      total += estimateTokensFromText(String(params.variables));
    }
  }
  return total;
}

export function buildEvolutionFeedbackPayload(input: {
  skillId: string;
  skillName: string;
  startTimeMs: number;
  success: boolean;
  error?: string;
  resultText?: string;
  result_valid?: boolean;
  toolCalls?: unknown[];
  args?: Record<string, unknown>;
  tokens_injected?: number;
  phase?: string;
  ab_variant?: string | null;
}): SkillEvolutionFeedbackPayload {
  const execution_ms = Math.max(0, Date.now() - input.startTimeMs);
  const tool_round_count = Array.isArray(input.toolCalls) ? input.toolCalls.length : 0;
  const schema_pass_rate =
    typeof input.result_valid === 'boolean' ? (input.result_valid ? 1 : 0) : undefined;

  return {
    skillId: input.skillId,
    skillName: input.skillName,
    execution_ms,
    durationMs: execution_ms,
    success: input.success,
    error: input.error,
    args: input.args ?? {},
    resultSize: input.resultText?.length ?? 0,
    result_valid: input.result_valid,
    tokens_injected: input.tokens_injected,
    schema_pass_rate,
    tool_round_count,
    phase: input.phase,
    ab_variant: input.ab_variant ?? undefined
  };
}

function readQueue(): SkillEvolutionFeedbackPayload[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(EVOLUTION_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as SkillEvolutionFeedbackPayload[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(items: SkillEvolutionFeedbackPayload[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(EVOLUTION_QUEUE_KEY, JSON.stringify(items.slice(-200)));
  } catch {
    /* ignore */
  }
}

async function postOne(
  executorUrl: string,
  payload: SkillEvolutionFeedbackPayload
): Promise<boolean> {
  const res = await fetch(`${executorUrl}/v1/evolution/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...resolveSkillExecutorAuthHeaders() },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(12000)
  });
  return res.ok;
}

/** 写入 evolution（服务端）；失败时入 localStorage 队列 */
export async function postSkillEvolutionFeedback(
  payload: SkillEvolutionFeedbackPayload
): Promise<void> {
  const executorUrl = resolveSkillExecutorBaseUrl();
  if (!executorUrl) {
    writeQueue([...readQueue(), payload]);
    return;
  }

  try {
    const ok = await postOne(executorUrl, payload);
    if (!ok) {
      writeQueue([...readQueue(), payload]);
      return;
    }
    const queue = readQueue();
    if (queue.length > 0) {
      const remaining: SkillEvolutionFeedbackPayload[] = [];
      for (const item of queue) {
        try {
          if (await postOne(executorUrl, item)) continue;
        } catch {
          /* keep */
        }
        remaining.push(item);
      }
      writeQueue(remaining);
    }
  } catch (e) {
    devWarn('[evolution] 反馈上报失败，已入本地队列:', e);
    writeQueue([...readQueue(), payload]);
  }
}

export function buildEvolutionPayloadFromSkillRun(params: {
  skillId: string;
  skillName: string;
  startTimeMs: number;
  success: boolean;
  error?: string;
  resultText?: string;
  result_valid?: boolean;
  toolCalls?: unknown[];
  systemPrompt?: string;
  userInput?: string;
  variables?: Record<string, unknown>;
  phase?: string;
  ab_variant?: string | null;
}): SkillEvolutionFeedbackPayload {
  const tokens_injected = estimateTokensInjected({
    systemPrompt: params.systemPrompt,
    userInput: params.userInput,
    variables: params.variables
  });
  return buildEvolutionFeedbackPayload({
    ...params,
    tokens_injected
  });
}

/** 供测试：manifest 存在 output_schema 时是否可能产生 schema 指标 */
export function manifestHasOutputSchema(manifest?: SkillManifest): boolean {
  return !!manifest?.context_injection?.output_schema;
}
