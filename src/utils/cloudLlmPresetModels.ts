import type { CloudLlmPresetId } from './inferenceChatEndpoint';
import { CLOUD_LLM_PRESETS, getCloudLlmPreset } from './inferenceChatEndpoint';

/**
 * 各预设「最新 2 个」model 字段，与官方文档 / List Models API 对齐（2026-05 核查）。
 * 更新时请对照各 preset 的 docsUrl（inferenceChatEndpoint）或 GET /v1/models。
 */

/** 每个服务商下拉最多展示的候选数（按新→旧排列，须含 defaultModel） */
export const MAX_CLOUD_LLM_PRESET_MODEL_CHOICES = 2;

/** 历史/别名 → 预设列表中的规范 model id */
const PRESET_MODEL_ALIASES: Partial<Record<CloudLlmPresetId, Record<string, string>>> = {
  deepseek: {
    'deepseek-v4': 'deepseek-v4-flash',
    'deepseek-v4-fast': 'deepseek-v4-flash',
    'deepseek-3.2': 'deepseek-v4-flash',
    'deepseek-chat': 'deepseek-v4-flash',
    'deepseek-reasoner': 'deepseek-v4-pro'
  },
  openai: {
    'gpt-4o': 'gpt-5.4-mini',
    'gpt-4o-mini': 'gpt-5.4-mini',
    'o4-mini': 'gpt-5.4-mini',
    'gpt-4.1': 'gpt-5.5',
    'gpt-5.4': 'gpt-5.5'
  },
  moonshot: {
    'moonshot-v1-8k': 'kimi-k2.6',
    'moonshot-v1-32k': 'kimi-k2.6',
    'moonshot-v1-128k': 'kimi-k2.5'
  },
  zhipu: {
    'glm-4-flash': 'glm-5.1',
    'glm-4-plus': 'glm-5.1',
    'glm-4.7': 'glm-5.1'
  },
  siliconflow: {
    'Qwen/Qwen2.5-7B-Instruct': 'deepseek-ai/DeepSeek-V4-Flash',
    'deepseek-ai/DeepSeek-V3': 'deepseek-ai/DeepSeek-V3.2'
  },
  google_gemini: {
    'gemini-2.0-flash': 'gemini-3-flash-preview',
    'gemini-2.5-flash': 'gemini-3-flash-preview',
    'gemini-2.5-pro': 'gemini-3.1-pro-preview'
  },
  anthropic: {
    'claude-3-5-sonnet-20241022': 'claude-sonnet-4-6',
    'claude-3-5-haiku-20241022': 'claude-haiku-4-5-20251001'
  },
  qianfan: {
    'ernie-4.0-turbo-8k': 'ernie-5.1',
    'deepseek-v4-flash': 'ernie-5.1'
  },
  volcengine_ark: {
    'doubao-seed-1-6-251015': 'doubao-seed-2-0-pro-260215',
    'deepseek-v3-250324': 'doubao-seed-2-0-lite-260215'
  },
  minimax: {
    'MiniMax-M2': 'MiniMax-M2.7',
    'MiniMax-Text-01': 'MiniMax-M2.5'
  },
  aliyun_dashscope_cn: {
    'qwen-plus': 'qwen3.7-max-2026-05-20',
    'qwen-max': 'qwen3.7-max-2026-05-20'
  },
  aliyun_dashscope_intl: {
    'qwen-plus': 'qwen3.7-max-2026-05-20',
    'qwen-max': 'qwen3.7-max-2026-05-20'
  }
};

/**
 * 各 MaaS 预设可选模型（新→旧，最多 2 项；与 inferenceChatEndpoint.defaultModel 对齐）
 */
export const CLOUD_LLM_PRESET_MODEL_CHOICES: Partial<Record<CloudLlmPresetId, readonly string[]>> = {
  yueliai: ['freemodel'],
  deepseek: ['deepseek-v4-flash', 'deepseek-v4-pro'],
  openai: ['gpt-5.5', 'gpt-5.4-mini'],
  groq: ['openai/gpt-oss-120b', 'meta-llama/llama-4-scout-17b-16e-instruct'],
  together: ['meta-llama/Llama-4-Maverick-17B-128E-Instruct-Turbo', 'openai/gpt-oss-120b'],
  moonshot: ['kimi-k2.6', 'kimi-k2.5'],
  moonshot_ai: ['kimi-k2.6', 'kimi-k2.6-thinking'],
  zhipu: ['glm-5.1', 'glm-5'],
  siliconflow: ['deepseek-ai/DeepSeek-V4-Flash', 'deepseek-ai/DeepSeek-V3.2'],
  mistral: ['mistral-large-latest', 'mistral-small-latest'],
  xai: ['grok-4.3', 'grok-4.20-0309-reasoning'],
  minimax: ['MiniMax-M2.7', 'MiniMax-M2.5'],
  aliyun_dashscope_cn: ['qwen3.7-max-2026-05-20', 'qwen3.6-plus-2026-04-02'],
  aliyun_dashscope_intl: ['qwen3.7-max-2026-05-20', 'qwen3.6-plus-2026-04-02'],
  modelscope: ['deepseek-ai/DeepSeek-V3.2', 'Qwen/Qwen3-32B'],
  qianfan: ['ernie-5.1', 'ernie-5.0-thinking-preview'],
  volcengine_ark: ['doubao-seed-2-0-pro-260215', 'doubao-seed-2-0-lite-260215'],
  google_gemini: ['gemini-3.1-pro-preview', 'gemini-3-flash-preview'],
  anthropic: ['claude-opus-4-7', 'claude-sonnet-4-6'],
  tencent_hunyuan: ['hunyuan-turbos-latest', 'hunyuan-pro'],
  huawei_maas_cn: ['deepseek-v3', 'qwen2.5-72b-instruct'],
  huawei_maas_hk: ['deepseek-v3', 'qwen2.5-72b-instruct'],
  fireworks: [
    'accounts/fireworks/models/deepseek-v3',
    'accounts/fireworks/models/llama-v3p3-70b-instruct'
  ],
  baseten: ['deepseek-ai/DeepSeek-V3.2', 'meta-llama/Llama-3.3-70B-Instruct-Turbo'],
  sambanova: ['Meta-Llama-3.3-70B-Instruct', 'Meta-Llama-3.1-8B-Instruct'],
  cerebras: ['llama-3.3-70b', 'llama3.1-8b'],
  openrouter: ['openai/gpt-5.5', 'anthropic/claude-sonnet-4.6'],
  perplexity: ['sonar-pro', 'sonar-reasoning-pro']
};

function limitPresetModelChoices(models: string[], defaultModel?: string): string[] {
  const ordered = [...new Set(models.filter(Boolean))];
  if (defaultModel && !ordered.includes(defaultModel)) {
    ordered.unshift(defaultModel);
  }
  const out: string[] = [];
  if (defaultModel && ordered.includes(defaultModel)) {
    out.push(defaultModel);
  }
  for (const m of ordered) {
    if (out.length >= MAX_CLOUD_LLM_PRESET_MODEL_CHOICES) break;
    if (!out.includes(m)) out.push(m);
  }
  return out.slice(0, MAX_CLOUD_LLM_PRESET_MODEL_CHOICES);
}

export function listCloudLlmPresetModels(presetId: string | undefined): string[] {
  if (!presetId || presetId === 'custom') return [];
  const id = presetId as CloudLlmPresetId;
  const preset = getCloudLlmPreset(id);
  const fromMap = [...(CLOUD_LLM_PRESET_MODEL_CHOICES[id] ?? [])];
  return limitPresetModelChoices(fromMap, preset?.defaultModel);
}

export function coerceCloudLlmPresetModel(presetId: string | undefined, model: string): string {
  const trimmed = (model ?? '').trim();
  if (!presetId || presetId === 'custom') return trimmed;
  const choices = listCloudLlmPresetModels(presetId);
  if (choices.length === 0) {
    return trimmed || getCloudLlmPreset(presetId)?.defaultModel || '';
  }
  if (!trimmed) return choices[0];
  if (choices.includes(trimmed)) return trimmed;
  const alias = PRESET_MODEL_ALIASES[presetId as CloudLlmPresetId]?.[trimmed];
  if (alias && choices.includes(alias)) return alias;
  return choices[0];
}

/** 保存 cloudProviders 前规范化各行 model */
export function normalizeCloudProvidersModelsForStorage<
  T extends { presetId?: string; model?: string }
>(rows: T[]): T[] {
  return rows.map((row) => ({
    ...row,
    model: coerceCloudLlmPresetModel(row.presetId, row.model ?? '')
  }));
}

/** vitest：预设均有 defaultModel 或 models 列表 */
export function assertCloudPresetModelCatalogIntegrity(): void {
  for (const p of CLOUD_LLM_PRESETS) {
    if (p.id === 'custom') continue;
    const choices = listCloudLlmPresetModels(p.id);
    if (choices.length === 0) {
      throw new Error(`preset ${p.id} has no model choices`);
    }
    if (p.defaultModel && !choices.includes(p.defaultModel)) {
      throw new Error(`preset ${p.id} defaultModel ${p.defaultModel} not in choices`);
    }
    if (choices.length > MAX_CLOUD_LLM_PRESET_MODEL_CHOICES) {
      throw new Error(`preset ${p.id} has more than ${MAX_CLOUD_LLM_PRESET_MODEL_CHOICES} model choices`);
    }
  }
}
