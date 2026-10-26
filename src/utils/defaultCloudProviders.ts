import { applyCloudLlmPresetToRow } from './inferenceChatEndpoint';
import { hydrateCloudProviderSecrets, redactCloudProviderSecrets } from './secretStore';

/** 与 ApiConfigModal / SkillManager 写入 localStorage 的 cloudProviders 行结构一致 */
export interface CloudProviderRow {
  id: string;
  name: string;
  presetId?: string;
  apiUrl: string;
  apiKey: string;
  model: string;
  enabled: boolean;
}

export const BUILTIN_YUELIAI_PROVIDER_ID = 'builtin_yueliai_freemodel';

const YUELIAI_SUB_MODELS_STORAGE_KEY = 'yueliaiSubModels';

/** 第3层：用户手工填写的 Yueli AI 子模型路径（如 deepseek/deepseek-v4-fast） */
export interface YueliaiSubModelRow {
  id: string;
  model: string;
  label?: string;
  enabled: boolean;
}

export function readYueliaiSubModelsFromLocalStorage(): YueliaiSubModelRow[] {
  if (typeof window === 'undefined') return [];
  const raw = window.localStorage.getItem(YUELIAI_SUB_MODELS_STORAGE_KEY);
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row: unknown): YueliaiSubModelRow | null => {
        if (!row || typeof row !== 'object') return null;
        const r = row as Record<string, unknown>;
        const model = typeof r.model === 'string' ? r.model.trim() : '';
        if (!model) return null;
        const id =
          typeof r.id === 'string' && r.id.trim()
            ? r.id.trim()
            : `yueliai_sub_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        return {
          id,
          model,
          label: typeof r.label === 'string' ? r.label : undefined,
          enabled: r.enabled !== false
        };
      })
      .filter((row): row is YueliaiSubModelRow => row !== null);
  } catch {
    return [];
  }
}

export function writeYueliaiSubModelsToLocalStorage(rows: YueliaiSubModelRow[]): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(YUELIAI_SUB_MODELS_STORAGE_KEY, JSON.stringify(rows));
  window.dispatchEvent(new Event('yueli-cloud-providers-changed'));
}

export function readYueliaiFreemodelProvider(): CloudProviderRow {
  return splitCloudProviderRows(readCloudProvidersFromLocalStorage()).yueliai;
}

export function isBuiltinYueliaiProvider(row: { id?: string; presetId?: string }): boolean {
  return row.id === BUILTIN_YUELIAI_PROVIDER_ID || row.presetId === 'yueliai';
}

/** 将存储行拆为：内置 Yueli freemodel（单条）与其它 MaaS 服务商（平级列表） */
export function splitCloudProviderRows(rows: CloudProviderRow[]): {
  yueliai: CloudProviderRow;
  maas: CloudProviderRow[];
} {
  const builtin = rows.find((r) => r.id === BUILTIN_YUELIAI_PROVIDER_ID);
  const yueliai = builtin ?? buildBuiltinDefaultCloudProviders()[0];
  const maas = rows.filter((r) => !isBuiltinYueliaiProvider(r));
  return { yueliai, maas };
}

export function mergeCloudProviderRows(
  yueliai: CloudProviderRow,
  maas: CloudProviderRow[]
): CloudProviderRow[] {
  const cleanMaas = maas.filter((r) => !isBuiltinYueliaiProvider(r));
  return [yueliai, ...cleanMaas];
}

function ensureBuiltinYueliaiRow(rows: CloudProviderRow[]): CloudProviderRow[] {
  const { yueliai, maas } = splitCloudProviderRows(rows.length ? rows : buildBuiltinDefaultCloudProviders());
  return mergeCloudProviderRows(yueliai, maas);
}

/** 从 Vite 环境变量读取 Yueli AI API Key（勿在源码中硬编码） */
export function getYueliaiApiKeyFromEnv(): string {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
  return (env.VITE_YUELIAI_API_KEY || '').trim();
}

/** 系统内置默认云端推理：Yueli AI freemodel（与 docs/Untitled curl 示例一致） */
export function buildBuiltinDefaultCloudProviders(): CloudProviderRow[] {
  const preset = applyCloudLlmPresetToRow('yueliai');
  const apiKey = getYueliaiApiKeyFromEnv();
  return [
    {
      id: BUILTIN_YUELIAI_PROVIDER_ID,
      name: 'Yueli AI（freemodel）',
      presetId: preset.presetId,
      apiUrl: preset.apiUrl,
      model: preset.model,
      apiKey,
      /** L2 元数据供 KGM Playground 对齐；默认不启用，避免 UI 误以为 Copilot 直连 freemodel */
      enabled: false
    }
  ];
}

function normalizeCloudProviderRow(raw: unknown): CloudProviderRow | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  const apiUrl = typeof p.apiUrl === 'string' ? p.apiUrl : '';
  const model = typeof p.model === 'string' ? p.model : '';
  const presetId = typeof p.presetId === 'string' ? p.presetId : 'custom';
  const id =
    typeof p.id === 'string' && p.id.trim()
      ? p.id.trim()
      : `provider_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    name: typeof p.name === 'string' ? p.name : '未命名服务商',
    presetId,
    apiUrl,
    apiKey: typeof p.apiKey === 'string' ? p.apiKey : '',
    model,
    enabled: Boolean(p.enabled)
  };
}

/** 读取 localStorage cloudProviders；空列表时返回内置默认（不自动写回，由 ensure 负责落盘） */
export function readCloudProvidersFromLocalStorage(): CloudProviderRow[] {
  if (typeof window === 'undefined') return buildBuiltinDefaultCloudProviders();
  const raw = window.localStorage.getItem('cloudProviders');
  if (!raw || !raw.trim()) return buildBuiltinDefaultCloudProviders();
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return buildBuiltinDefaultCloudProviders();
    }
    const normalized = parsed
      .map((row) => normalizeCloudProviderRow(row))
      .filter((row): row is CloudProviderRow => row !== null);
    return hydrateCloudProviderSecrets(ensureBuiltinYueliaiRow(normalized));
  } catch {
    return buildBuiltinDefaultCloudProviders();
  }
}

/**
 * 首次启动（或未配置云端推理）时，将内置 Yueli AI freemodel 写入 localStorage。
 * 已有用户配置时不覆盖。
 */
export function ensureDefaultCloudProvidersInLocalStorage(): void {
  if (typeof window === 'undefined') return;
  const raw = window.localStorage.getItem('cloudProviders');
  if (raw && raw.trim() && raw.trim() !== '[]') {
    demoteBuiltinFreemodelBrowserDirectIfNeeded();
    return;
  }
  const defaults = buildBuiltinDefaultCloudProviders();
  window.localStorage.setItem(
    'cloudProviders',
    JSON.stringify(redactCloudProviderSecrets(defaults))
  );
  window.dispatchEvent(new Event('yueli-cloud-providers-changed'));
}

/** 旧版在存在 API Key 时默认 enabled=true，会导致「云端推理」误选；改为仅元数据 */
function demoteBuiltinFreemodelBrowserDirectIfNeeded(): void {
  try {
    const parsed = JSON.parse(window.localStorage.getItem('cloudProviders') || '[]');
    if (!Array.isArray(parsed)) return;
    let changed = false;
    const next = parsed.map((row: CloudProviderRow) => {
      if (row?.id !== BUILTIN_YUELIAI_PROVIDER_ID || !row.enabled) return row;
      changed = true;
      return { ...row, enabled: false };
    });
    if (changed) {
      window.localStorage.setItem(
        'cloudProviders',
        JSON.stringify(redactCloudProviderSecrets(next))
      );
      window.dispatchEvent(new Event('yueli-cloud-providers-changed'));
    }
  } catch {
    /* ignore */
  }
}

/** 聊天默认走 KGM 动态路由（model `auto`），由 KGM 在 Ollama / freemodel / MaaS 间调度 */
export function ensureDefaultKgmChatDefaultsInLocalStorage(): void {
  if (typeof window === 'undefined') return;
  if (!window.localStorage.getItem('kgmScheduleStrategy')?.trim()) {
    window.localStorage.setItem('kgmScheduleStrategy', 'kgm-dynamic');
  }
  const prov = window.localStorage.getItem('selectedProvider');
  if (!prov || prov === 'anthropic') {
    window.localStorage.setItem('selectedProvider', 'kgm');
  }
}
