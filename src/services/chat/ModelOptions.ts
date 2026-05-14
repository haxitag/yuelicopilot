export type ChatProvider = 'kgm' | 'ollama';

export interface ModelOption {
  /** e.g. "kgm:kgm-dynamic" */
  value: string;
  /** human label */
  label: string;
}

export interface CloudProvidersConfig {
  scheduleStrategy?: string;
  cloudProviders?: Array<{ enabled?: boolean; apiUrl?: string; model?: string }>;
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

export function resolveModelOptionsFromCloudConfig(
  cloudConfig: CloudProvidersConfig
): { options: ModelOption[]; scheduleStrategy: string; hasEnabledCloud: boolean } {
  const scheduleStrategy = cloudConfig.scheduleStrategy || 'kgm-dynamic';
  const hasEnabledCloud = Array.isArray(cloudConfig.cloudProviders)
    ? cloudConfig.cloudProviders.some((p) => Boolean(p?.enabled && p?.apiUrl && p?.model))
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

