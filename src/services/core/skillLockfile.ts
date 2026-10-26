import type { SkillManifest } from './SkillManifestSchema';
import { skillPkgPayloadDigestHex } from './skillPkgVerification';

export const SKILL_LOCKFILE_NAME = 'skill.lock.json';
export const SKILL_LOCKFILE_SCHEMA_VERSION = 1 as const;

export interface SkillLockRequiresEntry {
  skillId: string;
  range: string;
  resolvedVersion: string;
  ok: boolean;
}

export interface SkillLockfile {
  schemaVersion: typeof SKILL_LOCKFILE_SCHEMA_VERSION;
  skillId: string;
  version: string;
  /** 规范化 manifest JSON（键排序）的 SHA-256 hex */
  manifestSha256: string;
  /** 与 signature.json 规则一致的载荷摘要（无 signature.json 时仍按 canonical 计算） */
  payloadDigest: string;
  lockedAt: string;
  /** 安装时解析的 requires semver 快照 */
  requiresResolved?: SkillLockRequiresEntry[];
}

async function sha256HexUtf8(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function stableManifestJson(manifest: SkillManifest): string {
  const sorted = (obj: unknown): unknown => {
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return obj;
    const o = obj as Record<string, unknown>;
    const keys = Object.keys(o).sort();
    const out: Record<string, unknown> = {};
    for (const k of keys) out[k] = sorted(o[k]);
    return out;
  };
  return JSON.stringify(sorted(manifest));
}

export async function computeManifestSha256(manifest: SkillManifest): Promise<string> {
  return sha256HexUtf8(stableManifestJson(manifest));
}

export async function buildSkillLockfile(
  manifest: SkillManifest,
  files: Record<string, string>,
  opts?: { requiresResolved?: SkillLockfile['requiresResolved'] }
): Promise<SkillLockfile> {
  const manifestSha256 = await computeManifestSha256(manifest);
  const payloadDigest = await skillPkgPayloadDigestHex(files);
  return {
    schemaVersion: SKILL_LOCKFILE_SCHEMA_VERSION,
    skillId: manifest.id,
    version: manifest.version,
    manifestSha256,
    payloadDigest,
    lockedAt: new Date().toISOString(),
    requiresResolved: opts?.requiresResolved
  };
}

export function parseSkillLockfile(raw: string): SkillLockfile | null {
  try {
    const j = JSON.parse(raw) as SkillLockfile;
    if (j.schemaVersion !== SKILL_LOCKFILE_SCHEMA_VERSION) return null;
    if (!j.skillId || !j.version || !j.manifestSha256 || !j.payloadDigest) return null;
    return j;
  } catch {
    return null;
  }
}

/** 锁文件未变则跳过重复安装（manifest + 包载荷指纹一致） */
export function skillLockfilesEqual(a: SkillLockfile, b: SkillLockfile): boolean {
  return (
    a.skillId === b.skillId &&
    a.version === b.version &&
    a.manifestSha256 === b.manifestSha256 &&
    a.payloadDigest === b.payloadDigest
  );
}

export function serializeSkillLockfile(lock: SkillLockfile): string {
  return `${JSON.stringify(lock, null, 2)}\n`;
}
