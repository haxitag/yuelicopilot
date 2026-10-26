import {
  isBuiltinYueliaiProvider,
  readCloudProvidersFromLocalStorage,
  readYueliaiSubModelsFromLocalStorage,
  type YueliaiSubModelRow
} from '../../utils/defaultCloudProviders';
import { getCloudLlmPreset } from '../../utils/inferenceChatEndpoint';
import {
  isCloudProviderConfiguredForPicker,
  resolveKgmCatalogModelId,
  type KgmCatalogEntry
} from './kgmModelCatalog';
import type { ChatProvider, ModelOption } from './ModelOptions';

export type InferenceTier = 'L1' | 'L2' | 'L3';

export interface TieredModelOption extends ModelOption {
  tier: InferenceTier;
  group: string;
}

const L1_GROUP = '第1层 · KGM（Playground / auto）';
const L2_GROUP = '第2层 · Copilot MaaS 直选';
const L3_GROUP = '第3层 · Yueli AI 云端聚合';

export function parseChatModelValue(value: string): { provider: ChatProvider; model: string } {
  const raw = (value || '').trim();
  if (!raw) return { provider: 'kgm', model: 'kgm-dynamic' };
  const idx = raw.indexOf(':');
  if (idx <= 0) return { provider: 'kgm', model: raw };
  const prefix = raw.slice(0, idx);
  const model = raw.slice(idx + 1);
  if (prefix === 'kgm' || prefix === 'ollama' || prefix === 'anthropic' || prefix === 'yueliai') {
    return { provider: prefix, model };
  }
  return { provider: 'kgm', model: raw };
}

function formatL1Label(entry: KgmCatalogEntry): string {
  const vendor = entry.ownedBy?.trim();
  if (vendor) return `kgm / ${vendor} / ${entry.id}`;
  if (entry.cloud) return `kgm / 云端 / ${entry.id}`;
  return `kgm / ${entry.id}`;
}

function formatL2Label(p: { presetId?: string; name?: string; model: string }): string {
  const preset = getCloudLlmPreset(p.presetId || '');
  const vendor = (preset?.label || p.name || p.presetId || 'MaaS').replace(/（.*?）/g, '').trim();
  const model = p.model.trim();
  return `${vendor} / ${model}`;
}

function pushL3Options(
  options: TieredModelOption[],
  yueliaiApiKey: string,
  subModels: YueliaiSubModelRow[]
): void {
  if (!yueliaiApiKey.trim()) return;
  options.push({
    tier: 'L3',
    group: L3_GROUP,
    value: 'yueliai:freemodel',
    label: 'Yueli AI / freemodel'
  });
  for (const sub of subModels) {
    if (!sub.enabled || !sub.model?.trim()) continue;
    const model = sub.model.trim();
    options.push({
      tier: 'L3',
      group: L3_GROUP,
      value: `yueliai:${model}`,
      label: sub.label?.trim() || `Yueli AI / ${model}`
    });
  }
}

/**
 * 三层推理模型下拉：L1 KGM 动态/catalog，L2 已配置 MaaS 直选，L3 Yueli AI 聚合（需 API Key）。
 */
export function buildTieredModelOptions(
  catalog: KgmCatalogEntry[],
  cloudProviders = readCloudProvidersFromLocalStorage(),
  subModels = readYueliaiSubModelsFromLocalStorage()
): TieredModelOption[] {
  const options: TieredModelOption[] = [
    {
      tier: 'L1',
      group: L1_GROUP,
      value: 'kgm:kgm-dynamic',
      label: 'kgm / auto'
    }
  ];

  const maas = cloudProviders.filter(
    (p) => !isBuiltinYueliaiProvider(p) && isCloudProviderConfiguredForPicker(p)
  );
  const reservedL2Ids = new Set<string>();
  for (const p of maas) {
    const resolved = catalog.length
      ? resolveKgmCatalogModelId(p.model.trim(), catalog) ?? p.model.trim()
      : p.model.trim();
    if (resolved) reservedL2Ids.add(resolved);
  }

  const seenL1 = new Set<string>(['auto', 'kgm-dynamic', 'cloud']);
  for (const entry of catalog) {
    if (!entry.id || seenL1.has(entry.id)) continue;
    if (reservedL2Ids.has(entry.id)) continue;
    seenL1.add(entry.id);
    options.push({
      tier: 'L1',
      group: L1_GROUP,
      value: `kgm:${entry.id}`,
      label: formatL1Label(entry)
    });
  }

  const seenL2 = new Set<string>();
  for (const p of maas) {
    const resolved = catalog.length
      ? resolveKgmCatalogModelId(p.model.trim(), catalog) ?? p.model.trim()
      : p.model.trim();
    if (!resolved || seenL2.has(resolved)) continue;
    seenL2.add(resolved);
    options.push({
      tier: 'L2',
      group: L2_GROUP,
      value: `kgm:${resolved}`,
      label: formatL2Label(p)
    });
  }

  const yueliai = cloudProviders.find(isBuiltinYueliaiProvider) ?? cloudProviders[0];
  pushL3Options(options, yueliai?.apiKey ?? '', subModels);

  return options;
}

/** Ant Design Select 分组选项 */
const INTENT_AUTO = '自动（KGM 动态路由）';
const INTENT_ADVANCED = '高级 · 技术分层';

/** 面向普通用户的意图化选项（默认视图） */
export function buildIntentModelOptions(
  catalog: KgmCatalogEntry[],
  cloudProviders = readCloudProvidersFromLocalStorage(),
  subModels = readYueliaiSubModelsFromLocalStorage()
): TieredModelOption[] {
  const tiered = buildTieredModelOptions(catalog, cloudProviders, subModels);
  const intent: TieredModelOption[] = [];
  const auto = tiered.find((o) => o.value === 'kgm:kgm-dynamic');
  if (auto) {
    intent.push({
      ...auto,
      group: INTENT_AUTO,
      label: '自动 · 成本与体验平衡（推荐）'
    });
  }
  const l3Free = tiered.find((o) => o.value === 'yueliai:freemodel');
  if (l3Free) {
    intent.push({
      ...l3Free,
      group: INTENT_AUTO,
      label: 'Yueli AI 免费聚合'
    });
  }
  for (const o of tiered.filter((t) => t.tier === 'L2').slice(0, 6)) {
    intent.push({
      ...o,
      group: '指定云端模型',
      label: o.label.replace(/^[^/]+\s*\/\s*/, '')
    });
  }
  for (const o of tiered.filter((t) => t.tier === 'L1' && t.value !== 'kgm:kgm-dynamic').slice(0, 4)) {
    intent.push({ ...o, group: INTENT_ADVANCED, label: o.label });
  }
  for (const o of tiered.filter((t) => t.tier === 'L3' && t.value !== 'yueliai:freemodel')) {
    intent.push({ ...o, group: INTENT_ADVANCED, label: o.label });
  }
  return intent.length ? intent : tiered;
}

export function tieredOptionsToSelectGroups(
  options: TieredModelOption[]
): { label: string; options: { value: string; label: string }[] }[] {
  const order: InferenceTier[] = ['L1', 'L2', 'L3'];
  const byGroup = new Map<string, { value: string; label: string }[]>();
  for (const o of options) {
    const list = byGroup.get(o.group) ?? [];
    list.push({ value: o.value, label: o.label });
    byGroup.set(o.group, list);
  }
  const groups: { label: string; options: { value: string; label: string }[] }[] = [];
  for (const tier of order) {
    const match = options.find((o) => o.tier === tier);
    if (!match) continue;
    const opts = byGroup.get(match.group);
    if (opts?.length) groups.push({ label: match.group, options: opts });
  }
  return groups;
}
