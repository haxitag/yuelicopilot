import { shouldUseSameOriginKgmProxy } from './kgmBrowserBaseUrl';

/** Skill Executor 默认监听端口（与 start.sh 默认值一致，可被 VITE_SKILL_EXECUTOR_* 覆盖） */
export const DEFAULT_SKILL_EXECUTOR_PORT = 3010;

export function normalizeSkillExecutorBaseUrl(url: string): string {
  return url.trim().replace(/\/$/, '');
}

export function resolveSkillExecutorAuthHeaders(): Record<string, string> {
  let token = '';

  if (typeof localStorage !== 'undefined') {
    token = localStorage.getItem('skillExecutorApiToken')?.trim() || '';
  }

  const viteEnv =
    typeof import.meta !== 'undefined' ? (import.meta as ImportMeta).env : undefined;
  if (!token) {
    token = String(viteEnv?.VITE_SKILL_EXECUTOR_API_TOKEN || '').trim();
  }

  return token ? { Authorization: `Bearer ${token}` } : {};
}

type SkillExecutorEnv = Pick<
  ImportMetaEnv,
  'VITE_DEPLOY_PROFILE' | 'VITE_SKILL_EXECUTOR_URL' | 'VITE_SKILL_EXECUTOR_PORT'
>;

/**
 * 浏览器侧解析 Skill Executor 根 URL。
 * 优先级：localStorage skillExecutorUrl → VITE_SKILL_EXECUTOR_URL → VITE_SKILL_EXECUTOR_PORT → 默认端口 3010
 * @param envOverride 仅用于单测注入（避免 vitest 加载 .env.local 覆盖 stubEnv）
 */
export function resolveSkillExecutorBaseUrl(envOverride?: SkillExecutorEnv): string {
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem('skillExecutorUrl');
    if (stored?.trim() && !stored.includes('${')) {
      if (stored.trim().startsWith('/')) {
        return normalizeSkillExecutorBaseUrl(stored);
      }
      const viteEnvEarly =
        envOverride ??
        (typeof import.meta !== 'undefined' ? (import.meta as ImportMeta).env : undefined);
      if (shouldUseSameOriginKgmProxy(viteEnvEarly)) {
        return '/api';
      }
      try {
        new URL(stored);
        return normalizeSkillExecutorBaseUrl(stored);
      } catch {
        /* 无效则继续 */
      }
    }
  }

  const viteEnv: SkillExecutorEnv | undefined =
    envOverride ??
    (typeof import.meta !== 'undefined' ? (import.meta as ImportMeta).env : undefined);

  const explicitUrl = viteEnv?.VITE_SKILL_EXECUTOR_URL;
  if (explicitUrl?.trim() && !String(explicitUrl).includes('${')) {
    const raw = String(explicitUrl).trim();
    if (raw.startsWith('/')) {
      return normalizeSkillExecutorBaseUrl(raw);
    }
    try {
      new URL(raw);
      return normalizeSkillExecutorBaseUrl(raw);
    } catch {
      /* fallthrough */
    }
  }

  if (viteEnv?.VITE_DEPLOY_PROFILE === 'desktop') {
    return '/api';
  }

  const portRaw = viteEnv?.VITE_SKILL_EXECUTOR_PORT;
  const parsed =
    portRaw !== undefined && String(portRaw).trim() !== ''
      ? parseInt(String(portRaw), 10)
      : DEFAULT_SKILL_EXECUTOR_PORT;

  const port =
    Number.isFinite(parsed) && parsed > 0 && parsed < 65536 ? parsed : DEFAULT_SKILL_EXECUTOR_PORT;

  return `http://127.0.0.1:${port}`;
}
