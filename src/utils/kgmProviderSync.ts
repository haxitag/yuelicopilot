/**
 * 将 Copilot localStorage cloudProviders 同步到 KGM PUT /v1/admin/model-providers
 */
import { readCloudProvidersFromLocalStorage } from './defaultCloudProviders';
import { normalizeCloudProvidersModelsForStorage } from './cloudLlmPresetModels';
import { normalizeBrowserKgmBaseUrl } from './kgmBrowserBaseUrl';

function resolveKgmFetchRoot(): string {
  if (typeof window === 'undefined') return '/kgm';
  const raw = localStorage.getItem('kgmBaseUrl') || '/kgm';
  const viteEnv = (import.meta as { env?: Record<string, string> }).env ?? {};
  return normalizeBrowserKgmBaseUrl(raw, viteEnv);
}

export async function syncCloudProvidersToKgm(kgmFetchRoot?: string): Promise<{
  ok: boolean;
  saved?: number;
  error?: string;
}> {
  const root = kgmFetchRoot ?? resolveKgmFetchRoot();
  const providers = normalizeCloudProvidersModelsForStorage(readCloudProvidersFromLocalStorage());
  try {
    const res = await fetch(`${root.replace(/\/$/, '')}/v1/admin/model-providers`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cloudProviders: providers })
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
      return { ok: false, error: text || String(res.status) };
    }
    const data = text ? JSON.parse(text) : {};
    return { ok: true, saved: typeof data.saved === 'number' ? data.saved : undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
