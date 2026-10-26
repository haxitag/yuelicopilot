import { readCloudProvidersFromLocalStorage } from '../../utils/defaultCloudProviders';
import { resolveCloudProviderChatUrl } from '../../utils/inferenceChatEndpoint';

export type ChatProvider = 'kgm' | 'ollama' | 'anthropic' | 'yueliai';

export interface ModelOption {
  /** e.g. "kgm:kgm-dynamic" */
  value: string;
  /** human label */
  label: string;
}

export interface CloudProvidersConfig {
  scheduleStrategy?: string;
  cloudProviders?: Array<{ enabled?: boolean; apiUrl?: string; model?: string; presetId?: string }>;
}

export function safeParseCloudConfig(raw: string | null): CloudProvidersConfig {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as CloudProvidersConfig;
  } catch {
    return {};
  }
}

/**
 * 与 SkillManager / ApiConfigModal 写入的 localStorage 对齐：
 * - `cloudProviders` 为 L2 管理中心 MaaS 元数据（与 KGM routes 对齐），非浏览器直连目标；
 * - 调度策略保存在 `kgmScheduleStrategy`；发往 KGM 的动态/云端选项映射为 model `auto`。
 */
export function normalizeStoredCloudProvidersForModelOptions(
  cloudProvidersRaw: string | null,
  kgmScheduleStrategy: string | null
): CloudProvidersConfig {
  const scheduleFallback = (kgmScheduleStrategy || 'kgm-dynamic').trim() || 'kgm-dynamic';
  if (!cloudProvidersRaw) return { scheduleStrategy: scheduleFallback };
  try {
    const parsed = JSON.parse(cloudProvidersRaw);
    if (Array.isArray(parsed)) {
      return { scheduleStrategy: scheduleFallback, cloudProviders: parsed };
    }
    if (parsed && typeof parsed === 'object') {
      const o = parsed as CloudProvidersConfig;
      return {
        ...o,
        scheduleStrategy: o.scheduleStrategy || scheduleFallback
      };
    }
    return { scheduleStrategy: scheduleFallback };
  } catch {
    return { scheduleStrategy: scheduleFallback };
  }
}

export function loadChatCloudConfigFromLocalStorage(): CloudProvidersConfig {
  if (typeof window === 'undefined') return {};
  const providers = readCloudProvidersFromLocalStorage();
  return normalizeStoredCloudProvidersForModelOptions(
    JSON.stringify(providers),
    window.localStorage.getItem('kgmScheduleStrategy')
  );
}

export function resolveModelOptionsFromCloudConfig(
  cloudConfig: CloudProvidersConfig
): { options: ModelOption[]; scheduleStrategy: string; hasEnabledCloud: boolean } {
  const scheduleStrategy = cloudConfig.scheduleStrategy || 'kgm-dynamic';
  const hasEnabledCloud = Array.isArray(cloudConfig.cloudProviders)
    ? cloudConfig.cloudProviders.some(
        (p) =>
          Boolean(p?.enabled && p?.model && resolveCloudProviderChatUrl(p as { apiUrl?: string; presetId?: string }))
      )
    : false;

  if (scheduleStrategy === 'kgm-dynamic') {
    return {
      scheduleStrategy,
      hasEnabledCloud,
      options: [{ value: 'kgm:kgm-dynamic', label: 'Yueli-KGM-Computing (动态路由)' }]
    };
  }

  const options: ModelOption[] = [
    { value: 'kgm:kgm-dynamic', label: 'Yueli-KGM-Computing' },
    { value: 'ollama:qwen3.5:latest', label: 'Qwen 3.5 (Ollama)' },
    { value: 'ollama:ollama:latest', label: 'Ollama' },
    { value: 'ollama:vmlx:latest', label: 'VMLX' }
  ];
  if (hasEnabledCloud) options.push({ value: 'kgm:cloud', label: '云端推理' });

  return { scheduleStrategy, hasEnabledCloud, options };
}

