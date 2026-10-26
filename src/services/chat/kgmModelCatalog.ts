import {
  isBuiltinYueliaiProvider,
  readCloudProvidersFromLocalStorage
} from '../../utils/defaultCloudProviders';
import { normalizeKgmRequestModelForApi } from '../../utils/kgmRequestModel';
import type { ModelOption } from './ModelOptions';

export type KgmCatalogEntry = { id: string; cloud?: boolean; ownedBy?: string };

let catalogCache: { at: number; entries: KgmCatalogEntry[] } | null = null;
const CACHE_MS = 5 * 60 * 1000;

const routableCache = new Map<string, { at: number; ok: boolean }>();
const ROUTABLE_PROBE_MS = 5 * 60 * 1000;

/** @internal vitest 用：避免探针缓存串扰 */
export function clearKgmRoutableProbeCacheForTests(): void {
  routableCache.clear();
}

/** 与 KGM /v1/models 及 cloudProviders.model 的常见别名对齐 */
const MODEL_ALIASES: Record<string, string> = {
  'deepseek-v4-fast': 'deepseek-v4',
  'deepseek-v4-flash': 'deepseek-v4',
  'deepseek-chat': 'deepseek-3.2'
};

export function resolveKgmCatalogModelId(
  requested: string,
  catalog: KgmCatalogEntry[]
): string | null {
  const bare = requested.includes(':') ? requested.split(':').pop()! : requested;
  const alias = MODEL_ALIASES[bare] ?? bare;
  const ids = new Set(catalog.map((e) => e.id));
  if (ids.has(bare)) return bare;
  if (ids.has(alias)) return alias;
  return null;
}

export async function fetchKgmModelCatalog(kgmFetchRoot: string): Promise<KgmCatalogEntry[]> {
  const now = Date.now();
  if (catalogCache && now - catalogCache.at < CACHE_MS) {
    return catalogCache.entries;
  }
  const root = kgmFetchRoot.replace(/\/$/, '');
  try {
    const useConfigured = readCloudProvidersFromLocalStorage().some(isCloudProviderConfiguredForPicker);
    const modelsUrl = useConfigured ? `${root}/v1/models?configured=true` : `${root}/v1/models`;
    const res = await fetch(modelsUrl, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return catalogCache?.entries ?? [];
    const json = await res.json();
    const entries: KgmCatalogEntry[] = (json?.data ?? [])
      .map((m: { id?: string; owned_by?: string; kgm?: { cloud?: boolean } }) => ({
        id: String(m?.id ?? '').trim(),
        ownedBy: typeof m?.owned_by === 'string' ? m.owned_by.trim() : undefined,
        cloud: Boolean(m?.kgm?.cloud)
      }))
      .filter((e: KgmCatalogEntry) => e.id && e.id !== 'auto');
    catalogCache = { at: now, entries };
    return entries;
  } catch {
    return catalogCache?.entries ?? [];
  }
}

/** 探测 KGM 是否已为该 model 配置可命中的 L2/L1 route（仅 /v1/models 列出不够） */
export async function probeKgmModelRoutable(
  kgmFetchRoot: string,
  modelId: string
): Promise<boolean> {
  const root = kgmFetchRoot.replace(/\/$/, '');
  const key = `${root}|${modelId}`;
  const cached = routableCache.get(key);
  if (cached && Date.now() - cached.at < ROUTABLE_PROBE_MS) {
    return cached.ok;
  }
  try {
    const res = await fetch(`${root}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
        stream: false
      }),
      signal: AbortSignal.timeout(8_000)
    });
    const ok = res.ok;
    routableCache.set(key, { at: Date.now(), ok });
    return ok;
  } catch {
    routableCache.set(key, { at: Date.now(), ok: false });
    return false;
  }
}

/** 云端推理行：已启用且填写了 apiKey（用于下拉，避免穷举 KGM catalog） */
export function isCloudProviderConfiguredForPicker(p: {
  enabled?: boolean;
  model?: string;
  apiKey?: string;
}): boolean {
  return Boolean(p.enabled && p.model?.trim() && p.apiKey?.trim());
}

export function buildKgmModelOptions(
  catalog: KgmCatalogEntry[],
  cloudProviders = readCloudProvidersFromLocalStorage()
): ModelOption[] {
  const options: ModelOption[] = [
    { value: 'kgm:kgm-dynamic', label: 'KGM 动态路由 (auto)' }
  ];

  const seen = new Set<string>();
  const configuredCloud = cloudProviders.filter(isCloudProviderConfiguredForPicker);
  const pushConfigured = (p: (typeof configuredCloud)[number], labelPrefix: string) => {
    const resolved = catalog.length
      ? resolveKgmCatalogModelId(p.model.trim(), catalog) ?? p.model.trim()
      : p.model.trim();
    if (!resolved || seen.has(resolved)) return;
    seen.add(resolved);
    options.push({
      value: `kgm:${resolved}`,
      label: `${labelPrefix} · ${resolved}`
    });
  };

  for (const p of configuredCloud.filter((row) => !isBuiltinYueliaiProvider(row))) {
    pushConfigured(p, p.name?.trim() || 'MaaS');
  }

  return options;
}

/**
 * 附件/PDF：若 UI 仍为 auto，仅在 KGM 已配置 route 的云端 model 上覆盖（避免 catalog 有 id 但 completions 404）
 */
export async function pickAttachmentChatModel(
  selectedModel: string,
  catalog: KgmCatalogEntry[],
  kgmFetchRoot: string
): Promise<{ model: string; reason?: string }> {
  const apiModel = normalizeKgmRequestModelForApi(selectedModel);
  if (apiModel !== 'auto') {
    return { model: selectedModel };
  }

  const candidates: string[] = [];
  const providers = readCloudProvidersFromLocalStorage().filter(isCloudProviderConfiguredForPicker);
  for (const p of providers) {
    const resolved = catalog.length
      ? resolveKgmCatalogModelId(p.model.trim(), catalog) ?? p.model.trim()
      : p.model.trim();
    if (resolved && !candidates.includes(resolved)) {
      candidates.push(resolved);
    }
  }

  for (const id of candidates) {
    if (!(await probeKgmModelRoutable(kgmFetchRoot, id))) continue;
    const prov = providers.find((p) => {
      const r = catalog.length
        ? resolveKgmCatalogModelId(p.model.trim(), catalog) ?? p.model.trim()
        : p.model.trim();
      return r === id;
    });
    return {
      model: id,
      reason: prov
        ? `已启用云端「${prov.name}」，PDF 聊天改用 ${id}（KGM 已配 route）`
        : `PDF 聊天改用 ${id}（KGM 已配 route）`
    };
  }

  if (candidates.length > 0) {
    return {
      model: selectedModel,
      reason:
        `云端模型 ${candidates.join('、')} 在 KGM 未配置 L2 route（/v1/models 仅登记）。` +
        ' PDF 仍用动态路由 auto；请在 KGM Playground 为 DeepSeek/freemodel 添加上游后重试。'
    };
  }

  return { model: selectedModel };
}
