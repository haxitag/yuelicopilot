import { resolveSkillExecutorAuthHeaders, resolveSkillExecutorBaseUrl } from '../utils/skillExecutorUrl';

export interface SkillsHubListingDto {
  id: string;
  name: string;
  description: string;
  /** 展示用作者/维护者（可与安装路径 owner 不同） */
  author: string;
  /**
   * 安装 URL `skillshub.wtf/{owner}/{id}` 的 owner 段（已由服务端归一化为小写 slug）。
   * 若上游未区分字段，可与 `author` 的 slug 形式一致。
   */
  installOwner?: string;
  version: string;
  tags: string[];
}

/** 将任意展示名转为 skillshub.wtf 路径段（与历史 `author` 规则一致） */
export function normalizeSkillshubOwnerSegment(raw: string | undefined | null): string {
  const s = String(raw ?? '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .toLowerCase();
  return s || '';
}

async function getJson<T>(path: string): Promise<T> {
  const base = resolveSkillExecutorBaseUrl();
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  const res = await fetch(url, { headers: { Accept: 'application/json', ...resolveSkillExecutorAuthHeaders() } });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Skills Hub 代理 ${res.status}: ${t || res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchSkillsHubTrending(limit = 12): Promise<SkillsHubListingDto[]> {
  const data = await getJson<{ success?: boolean; listings?: SkillsHubListingDto[] }>(
    `/v1/skills-hub/trending?limit=${encodeURIComponent(String(limit))}`
  );
  return Array.isArray(data.listings) ? data.listings : [];
}

export async function fetchSkillsHubSearch(q: string, limit = 24): Promise<SkillsHubListingDto[]> {
  const data = await getJson<{ success?: boolean; listings?: SkillsHubListingDto[] }>(
    `/v1/skills-hub/search?q=${encodeURIComponent(q)}&limit=${encodeURIComponent(String(limit))}`
  );
  return Array.isArray(data.listings) ? data.listings : [];
}

/** 与 EventManager skillshub.wtf 解析一致：/{owner}/{id} */
export function buildSkillshubWtfInstallUrl(
  listing: Pick<SkillsHubListingDto, 'id' | 'author'> & { installOwner?: string }
): string {
  const owner =
    normalizeSkillshubOwnerSegment(listing.installOwner) ||
    normalizeSkillshubOwnerSegment(listing.author) ||
    'community';
  return `https://skillshub.wtf/${encodeURIComponent(owner)}/${encodeURIComponent(listing.id)}`;
}
