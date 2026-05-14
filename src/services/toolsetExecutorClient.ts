import { resolveSkillExecutorAuthHeaders, resolveSkillExecutorBaseUrl } from '../utils/skillExecutorUrl';

export interface ToolsetRow {
  id: string;
  name: string;
  description?: string;
  tools?: string[];
  enabled?: boolean;
}

async function getJson<T>(path: string): Promise<T> {
  const base = resolveSkillExecutorBaseUrl();
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, { headers: { Accept: 'application/json', ...resolveSkillExecutorAuthHeaders() } });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Toolset ${res.status}: ${t || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchToolsets(): Promise<ToolsetRow[]> {
  const data = await getJson<{ success?: boolean; toolsets?: ToolsetRow[] }>('/v1/toolset/list');
  return Array.isArray(data.toolsets) ? data.toolsets : [];
}

export async function toggleToolset(id: string): Promise<boolean | undefined> {
  const base = resolveSkillExecutorBaseUrl();
  const res = await fetch(`${base}/v1/toolset/toggle`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...resolveSkillExecutorAuthHeaders()
    },
    body: JSON.stringify({ id })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.error || res.statusText);
  return (data as { enabled?: boolean }).enabled;
}
