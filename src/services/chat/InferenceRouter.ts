/**
 * 统一推理路由：UI 选择 → HTTP 端点 / adapter / model / tier 元数据。
 */
import type { ApiProvider } from '../../api/services/apiService';
import {
  isBuiltinYueliaiProvider,
  readCloudProvidersFromLocalStorage,
  readYueliaiFreemodelProvider,
  type CloudProviderRow
} from '../../utils/defaultCloudProviders';
import { normalizeKgmRequestModelForApi } from '../../utils/kgmRequestModel';
import { resolveYueliaiChatUrlForApp } from '../../utils/yueliaiChatEndpoint';
import { getCloudLlmPreset } from '../../utils/inferenceChatEndpoint';
import { parseChatModelValue, type InferenceTier } from './inferenceModelTiers';

export type { InferenceTier };

export interface InferenceRoutePlan {
  tier: InferenceTier;
  provider: ApiProvider;
  /** 发往上游的 model 字段 */
  requestModel: string;
  /** UI 展示用 */
  displayModel: string;
  vendor?: string;
  /** L2：provider/model 路径（如 deepseek/deepseek-v4-fast） */
  l2ProviderPath?: string;
  l2PresetId?: string;
  l2CloudRow?: CloudProviderRow;
  /** 是否经 KGM HTTP */
  viaKgm: boolean;
  /** 是否直连 Yueli AI */
  viaYueliai: boolean;
}

export function resolveInferenceRoute(
  provider: ApiProvider,
  model: string
): InferenceRoutePlan {
  const parsed = parseChatModelValue(`${provider}:${model}`);
  const p = parsed.provider;
  const m = parsed.model;

  if (p === 'yueliai') {
    const row = readYueliaiFreemodelProvider();
    const requestModel = m?.trim() || row.model || 'freemodel';
    return {
      tier: 'L3',
      provider: 'yueliai',
      requestModel,
      displayModel: requestModel,
      vendor: 'Yueli AI',
      viaKgm: false,
      viaYueliai: true
    };
  }

  const apiModel = normalizeKgmRequestModelForApi(m);
  const isAuto = apiModel === 'auto';

  if (!isAuto) {
    const maas = readCloudProvidersFromLocalStorage().filter(
      (row) => !isBuiltinYueliaiProvider(row) && row.enabled && row.apiKey?.trim() && row.model?.trim()
    );
    const match = maas.find((row) => {
      const bare = row.model.trim();
      return bare === m || bare === apiModel || apiModel.includes(bare);
    });
    if (match) {
      const preset = getCloudLlmPreset(match.presetId || '');
      const vendor = (preset?.label || match.name || match.presetId || 'MaaS')
        .replace(/（.*?）/g, '')
        .trim();
      const l2Path = `${match.presetId || vendor}/${match.model.trim()}`.replace(/^custom\//, '');
      return {
        tier: 'L2',
        provider: 'kgm',
        requestModel: apiModel,
        displayModel: match.model.trim(),
        vendor,
        l2ProviderPath: l2Path,
        l2PresetId: match.presetId,
        l2CloudRow: match,
        viaKgm: true,
        viaYueliai: false
      };
    }
    return {
      tier: 'L1',
      provider: 'kgm',
      requestModel: apiModel,
      displayModel: m,
      vendor: 'kgm',
      viaKgm: true,
      viaYueliai: false
    };
  }

  return {
    tier: 'L1',
    provider: 'kgm',
    requestModel: 'auto',
    displayModel: 'auto',
    vendor: 'kgm',
    viaKgm: true,
    viaYueliai: false
  };
}

/** 写入 KGM 请求体的 L2 路由元数据（与 KGM 0.2.8 admin routes 对齐） */
export function applyL2RoutingMetaToKgmBody(
  requestBody: Record<string, unknown>,
  plan: InferenceRoutePlan
): void {
  if (plan.tier !== 'L2' || !plan.l2ProviderPath) return;
  const kgm = (requestBody.kgm && typeof requestBody.kgm === 'object'
    ? (requestBody.kgm as Record<string, unknown>)
    : {}) as Record<string, unknown>;
  const routing =
    kgm.routing && typeof kgm.routing === 'object'
      ? (kgm.routing as Record<string, unknown>)
      : {};
  requestBody.kgm = {
    ...kgm,
    routing: {
      ...routing,
      tier: 'L2',
      providerPath: plan.l2ProviderPath,
      presetId: plan.l2PresetId,
      cloudProviderName: plan.l2CloudRow?.name
    }
  };
}

export interface FirstRunRouteCandidate {
  tier: InferenceTier;
  provider: ApiProvider;
  model: string;
  label: string;
  reason: string;
}

/** 首启推荐：L3（有 Key）> L2 MaaS > L1 auto */
export function rankFirstRunRouteCandidates(): FirstRunRouteCandidate[] {
  const out: FirstRunRouteCandidate[] = [];
  const yueliai = readYueliaiFreemodelProvider();
  if (yueliai.apiKey?.trim()) {
    out.push({
      tier: 'L3',
      provider: 'yueliai',
      model: 'freemodel',
      label: 'Yueli AI 免费聚合',
      reason: '已配置 Yueli AI API Key，可直连云端'
    });
  }
  const maas = readCloudProvidersFromLocalStorage().filter(
    (p) => !isBuiltinYueliaiProvider(p) && p.enabled && p.apiKey?.trim() && p.model?.trim()
  );
  for (const p of maas.slice(0, 3)) {
    const preset = getCloudLlmPreset(p.presetId || '');
    out.push({
      tier: 'L2',
      provider: 'kgm',
      model: p.model.trim(),
      label: `${preset?.label || p.name} / ${p.model}`,
      reason: '已启用 MaaS，经 KGM 固定模型'
    });
  }
  out.push({
    tier: 'L1',
    provider: 'kgm',
    model: 'kgm-dynamic',
    label: 'KGM 自动路由',
    reason: '由 KGM 在本地与云端上游间动态选择'
  });
  return out;
}

export function hasYueliaiRuntimeApiKey(): boolean {
  return Boolean(readYueliaiFreemodelProvider().apiKey?.trim());
}

export function yueliaiEndpointReady(): boolean {
  return Boolean(resolveYueliaiChatUrlForApp(readYueliaiFreemodelProvider()));
}

/** 各 tier 流式/回退策略（L3 禁用 KGM 非流式回退） */
export interface InferenceTransportPolicy {
  allowKgmNonStreamFallback: boolean;
  allowStreamDisconnectRetry: boolean;
  streamIdleMs: number;
  streamMaxMs: number;
}

export function resolveTransportPolicy(plan: InferenceRoutePlan): InferenceTransportPolicy {
  if (plan.viaYueliai) {
    return {
      allowKgmNonStreamFallback: false,
      allowStreamDisconnectRetry: false,
      streamIdleMs: 35_000,
      streamMaxMs: 120_000
    };
  }
  if (plan.tier === 'L2') {
    return {
      allowKgmNonStreamFallback: true,
      allowStreamDisconnectRetry: true,
      streamIdleMs: 35_000,
      streamMaxMs: 90_000
    };
  }
  return {
    allowKgmNonStreamFallback: true,
    allowStreamDisconnectRetry: true,
    streamIdleMs: 35_000,
    streamMaxMs: 90_000
  };
}

export interface RouteTraceInfo {
  tier: InferenceTier;
  vendor?: string;
  displayModel: string;
  l2ProviderPath?: string;
  transportFallback?: string;
}

export function buildRouteTrace(
  plan: InferenceRoutePlan,
  extras?: { transportFallback?: string }
): RouteTraceInfo {
  return {
    tier: plan.tier,
    vendor: plan.vendor,
    displayModel: plan.displayModel,
    l2ProviderPath: plan.l2ProviderPath,
    transportFallback: extras?.transportFallback
  };
}
