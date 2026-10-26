/** Copilot 浏览器侧 KGM 入口：始终同源 `/kgm`，由 Gateway/Vite 转发到本机 KGM */

export function shouldUseSameOriginKgmProxy(env?: {
  DEV?: boolean;
  VITE_DEPLOY_PROFILE?: string;
}): boolean {
  const viteEnv = env ?? (import.meta as { env?: Record<string, unknown> }).env ?? {};
  return Boolean(viteEnv.DEV) || viteEnv.VITE_DEPLOY_PROFILE === 'desktop';
}

/** 是否为本机 loopback 主机名 */
export function isLoopbackHostname(hostname: string): boolean {
  const h = hostname.trim().toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '[::1]';
}

/**
 * 规范化写入 localStorage / 用于 fetch 的 KGM 根路径。
 * 桌面与 dev 下禁止把 yueli.com、DeepSeek 等外网 URL 当作 kgmBaseUrl（会触发浏览器 CORS）。
 */
export function normalizeBrowserKgmBaseUrl(
  raw: string | null | undefined,
  env?: { DEV?: boolean; VITE_DEPLOY_PROFILE?: string }
): string {
  const fallback = '/kgm';
  const trimmed = (raw ?? '').trim();
  if (!trimmed || trimmed.includes('${')) return fallback;

  if (!shouldUseSameOriginKgmProxy(env)) {
    return trimmed.replace(/\/$/, '') || fallback;
  }

  if (trimmed.startsWith('/')) {
    return trimmed.replace(/\/$/, '') || fallback;
  }

  try {
    const withProto = trimmed.startsWith('http://') || trimmed.startsWith('https://')
      ? trimmed
      : `http://${trimmed}`;
    const u = new URL(withProto);
    if (isLoopbackHostname(u.hostname)) {
      return fallback;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

/** 修正历史误配的 kgmBaseUrl / skillExecutorUrl（仅浏览器） */
export function migrateMisconfiguredLocalServiceUrls(): void {
  if (typeof window === 'undefined') return;

  const kgmRaw = window.localStorage.getItem('kgmBaseUrl');
  const kgmNext = normalizeBrowserKgmBaseUrl(kgmRaw);
  if (kgmRaw && kgmRaw.trim() !== kgmNext) {
    window.localStorage.setItem('kgmBaseUrl', kgmNext);
  }

  if (shouldUseSameOriginKgmProxy()) {
    const execRaw = window.localStorage.getItem('skillExecutorUrl')?.trim() || '';
    if (!execRaw.startsWith('/') || execRaw.startsWith('http://') || execRaw.startsWith('https://')) {
      window.localStorage.setItem('skillExecutorUrl', '/api');
    }
  }
}
