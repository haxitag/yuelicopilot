/**
 * 云端推理配置保存 → 同步 KGM → 验证 configured models
 */
import type { CloudProviderRow } from './defaultCloudProviders';
import { syncCloudProvidersToKgm } from './kgmProviderSync';
import { normalizeBrowserKgmBaseUrl } from './kgmBrowserBaseUrl';
import { redactCloudProviderSecrets } from './secretStore';

export interface CloudProviderSaveSyncResult {
  ok: boolean;
  syncOk: boolean;
  verifyOk: boolean;
  saved?: number;
  error?: string;
  verifyDetail?: string;
}

async function probeConfiguredModels(kgmRoot: string): Promise<{ ok: boolean; detail: string }> {
  const root = kgmRoot.replace(/\/$/, '');
  try {
    const res = await fetch(`${root}/v1/models?configured=true`, {
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) {
      return { ok: false, detail: `HTTP ${res.status}` };
    }
    const json = await res.json();
    const count = Array.isArray(json?.data) ? json.data.length : 0;
    return { ok: true, detail: `${count} 个已配置模型` };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

export async function saveCloudProvidersWithKgmSync(
  rows: CloudProviderRow[]
): Promise<CloudProviderSaveSyncResult> {
  if (typeof window === 'undefined') {
    return { ok: true, syncOk: true, verifyOk: true };
  }

  const persisted = redactCloudProviderSecrets(rows);
  window.localStorage.setItem('cloudProviders', JSON.stringify(persisted));
  window.dispatchEvent(new Event('yueli-cloud-providers-changed'));

  const viteEnv = (import.meta as { env?: Record<string, string> }).env ?? {};
  const rawKgm = window.localStorage.getItem('kgmBaseUrl') || '/kgm';
  const kgmRoot = normalizeBrowserKgmBaseUrl(rawKgm, viteEnv);

  const sync = await syncCloudProvidersToKgm(kgmRoot);
  if (!sync.ok) {
    return {
      ok: false,
      syncOk: false,
      verifyOk: false,
      error: sync.error || '同步 KGM 失败',
      verifyDetail: '请在 KGM Playground 检查 routes 或稍后重试'
    };
  }

  const verify = await probeConfiguredModels(kgmRoot);
  const enabledMaas = rows.filter((r) => r.enabled && r.apiKey?.trim() && r.model?.trim());
  const verifyOk = enabledMaas.length === 0 || verify.ok;

  return {
    ok: sync.ok && verifyOk,
    syncOk: sync.ok,
    verifyOk,
    saved: sync.saved,
    error: verifyOk ? undefined : `KGM 校验未通过：${verify.detail}`,
    verifyDetail: verify.detail
  };
}
