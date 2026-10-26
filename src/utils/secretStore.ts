/**
 * 敏感凭据：仅存 sessionStorage（会话级），禁止写入 localStorage 明文。
 * 读取时若 localStorage 仍有旧值，一次性迁移后清除。
 */

const SECRET_KEYS = ['kgmApiKey', 'apiKey', 'anthropicApiKey', 'embeddingApiKey'] as const;

export type SecretKey = (typeof SECRET_KEYS)[number];

const CLOUD_PROVIDER_SECRETS_KEY = 'cloudProviderApiKeys';

function canUseSession(): boolean {
  return typeof window !== 'undefined' && typeof window.sessionStorage !== 'undefined';
}

function canUseLocal(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

export function getSecret(key: SecretKey): string {
  if (!canUseSession()) return '';
  try {
    const fromSession = window.sessionStorage.getItem(key);
    if (fromSession != null && fromSession !== '') return fromSession;
    if (canUseLocal()) {
      const legacy = window.localStorage.getItem(key);
      if (legacy) {
        window.sessionStorage.setItem(key, legacy);
        window.localStorage.removeItem(key);
        return legacy;
      }
    }
    return '';
  } catch {
    return '';
  }
}

export function setSecret(key: SecretKey, value: string): void {
  if (!canUseSession()) return;
  try {
    if (value) {
      window.sessionStorage.setItem(key, value);
    } else {
      window.sessionStorage.removeItem(key);
    }
    if (canUseLocal()) {
      window.localStorage.removeItem(key);
    }
  } catch {
    /* ignore quota / private mode */
  }
}

/** 从 cloudProviders 行提取 apiKey → session；落盘行去掉 apiKey */
export function redactCloudProviderSecrets<T extends { id: string; apiKey?: string }>(
  rows: T[]
): T[] {
  if (!canUseSession()) {
    return rows.map((r) => ({ ...r, apiKey: '' }));
  }
  try {
    const map: Record<string, string> = {};
    try {
      const raw = window.sessionStorage.getItem(CLOUD_PROVIDER_SECRETS_KEY);
      if (raw) Object.assign(map, JSON.parse(raw));
    } catch {
      /* ignore */
    }
    for (const row of rows) {
      if (row.apiKey) map[row.id] = row.apiKey;
      else if (map[row.id] === undefined) map[row.id] = '';
    }
    window.sessionStorage.setItem(CLOUD_PROVIDER_SECRETS_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
  return rows.map((r) => ({ ...r, apiKey: '' }));
}

/** 读取时把 session 中的 apiKey 合回行；并迁移 localStorage 中残留明文 */
export function hydrateCloudProviderSecrets<T extends { id: string; apiKey?: string }>(
  rows: T[]
): T[] {
  if (!canUseSession()) return rows;
  try {
    let map: Record<string, string> = {};
    try {
      const raw = window.sessionStorage.getItem(CLOUD_PROVIDER_SECRETS_KEY);
      if (raw) map = JSON.parse(raw) || {};
    } catch {
      map = {};
    }
    let migrated = false;
    for (const row of rows) {
      if (row.apiKey) {
        map[row.id] = row.apiKey;
        migrated = true;
      }
    }
    if (migrated) {
      window.sessionStorage.setItem(CLOUD_PROVIDER_SECRETS_KEY, JSON.stringify(map));
      // 清除 localStorage 中残留的明文 apiKey
      if (canUseLocal()) {
        try {
          const raw = window.localStorage.getItem('cloudProviders');
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
              window.localStorage.setItem(
                'cloudProviders',
                JSON.stringify(parsed.map((r: { id?: string; apiKey?: string }) => ({ ...r, apiKey: '' })))
              );
            }
          }
        } catch {
          /* ignore */
        }
      }
    }
    return rows.map((r) => ({
      ...r,
      apiKey: map[r.id] || r.apiKey || ''
    }));
  } catch {
    return rows;
  }
}
