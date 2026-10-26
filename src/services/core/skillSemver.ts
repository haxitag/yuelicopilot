/**
 * 轻量 semver：满足 Registry / lockfile / requires 解析（无外部依赖）。
 */

export interface SemVerParts {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
  build: string | null;
  raw: string;
}

export function parseSemver(version: string): SemVerParts | null {
  const raw = String(version || '')
    .trim()
    .replace(/^v/i, '');
  const m = raw.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/);
  if (!m) return null;
  return {
    major: parseInt(m[1], 10),
    minor: m[2] !== undefined ? parseInt(m[2], 10) : 0,
    patch: m[3] !== undefined ? parseInt(m[3], 10) : 0,
    prerelease: m[4] ?? null,
    build: m[5] ?? null,
    raw
  };
}

export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return String(a).localeCompare(String(b));
  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1;
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1;
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1;
  if (pa.prerelease && !pb.prerelease) return -1;
  if (!pa.prerelease && pb.prerelease) return 1;
  if (pa.prerelease && pb.prerelease) {
    const c = pa.prerelease.localeCompare(pb.prerelease);
    if (c !== 0) return c;
  }
  return 0;
}

/** `current` 是否满足 `range`（支持 >=, ^, ~, 精确版本） */
export function semverSatisfies(current: string, range: string): boolean {
  const cur = parseSemver(current);
  if (!cur) return false;
  const r = String(range || '').trim();
  if (!r) return true;

  if (r.startsWith('>=')) {
    const min = parseSemver(r.slice(2).trim());
    if (!min) return false;
    return compareSemver(current, min.raw) >= 0;
  }
  if (r.startsWith('^')) {
    const base = parseSemver(r.slice(1).trim());
    if (!base) return false;
    if (cur.major !== base.major) return false;
    if (base.major > 0) return compareSemver(current, base.raw) >= 0;
    if (cur.minor !== base.minor) return false;
    return compareSemver(current, base.raw) >= 0;
  }
  if (r.startsWith('~')) {
    const base = parseSemver(r.slice(1).trim());
    if (!base) return false;
    if (cur.major !== base.major || cur.minor !== base.minor) return false;
    return compareSemver(current, base.raw) >= 0;
  }

  const exact = parseSemver(r);
  if (!exact) return false;
  return compareSemver(current, exact.raw) === 0;
}

/** 与 server/index.js 历史 `semverGte` 对齐 */
export function semverGte(current: string, minReq: string): boolean {
  return semverSatisfies(current, `>=${minReq}`);
}
