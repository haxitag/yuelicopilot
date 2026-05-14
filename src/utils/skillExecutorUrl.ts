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

/**
 * 浏览器侧解析 Skill Executor 根 URL。
 * 优先级：localStorage skillExecutorUrl → VITE_SKILL_EXECUTOR_URL → VITE_SKILL_EXECUTOR_PORT → 默认端口 3010
 */
export function resolveSkillExecutorBaseUrl(): string {
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem('skillExecutorUrl');
    if (stored?.trim() && !stored.includes('${')) {
      try {
        new URL(stored);
        return normalizeSkillExecutorBaseUrl(stored);
      } catch {
        /* 无效则继续 */
      }
    }
  }

  const viteEnv =
    typeof import.meta !== 'undefined' ? (import.meta as ImportMeta).env : undefined;

  const explicitUrl = viteEnv?.VITE_SKILL_EXECUTOR_URL;
  if (explicitUrl?.trim() && !String(explicitUrl).includes('${')) {
    try {
      new URL(String(explicitUrl));
      return normalizeSkillExecutorBaseUrl(String(explicitUrl));
    } catch {
      /* fallthrough */
    }
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
