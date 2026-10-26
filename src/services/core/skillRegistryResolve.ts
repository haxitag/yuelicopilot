import type { SkillManifest } from './SkillManifestSchema';
import { semverSatisfies } from './skillSemver';

export interface RegistrySkillRef {
  skillId: string;
  version: string;
  manifest?: SkillManifest;
}

export interface SemverResolveResult {
  ok: boolean;
  skillId: string;
  requestedRange: string;
  resolvedVersion?: string;
  reason?: string;
}

/** 从 manifest 读取 requires 的版本约束（`requiresSemver` 优先，其次 `requires` 内 `id@range`） */
export function parseRequiresSemverMap(manifest: SkillManifest): Record<string, string> {
  const out: Record<string, string> = {};
  const direct = manifest.requiresSemver as Record<string, string> | undefined;
  if (direct && typeof direct === 'object') {
    for (const [id, range] of Object.entries(direct)) {
      if (id && range) out[String(id).trim()] = String(range).trim();
    }
  }
  const req = manifest.requires;
  if (Array.isArray(req)) {
    for (const entry of req) {
      const s = String(entry).trim();
      const at = s.indexOf('@');
      if (at > 0) {
        out[s.slice(0, at).trim()] = s.slice(at + 1).trim();
      }
    }
  }
  return out;
}

export function listRequiredSkillIds(manifest: SkillManifest): string[] {
  const ids = new Set<string>();
  if (Array.isArray(manifest.requires)) {
    for (const entry of manifest.requires) {
      const s = String(entry).trim();
      const at = s.indexOf('@');
      ids.add(at > 0 ? s.slice(0, at).trim() : s);
    }
  }
  const semverMap = parseRequiresSemverMap(manifest);
  for (const id of Object.keys(semverMap)) ids.add(id);
  return [...ids].filter(Boolean);
}

export function resolveInstalledVersion(
  installed: RegistrySkillRef | undefined,
  range: string
): SemverResolveResult {
  const skillId = installed?.skillId ?? '';
  if (!installed?.version) {
    return { ok: false, skillId, requestedRange: range, reason: '未安装' };
  }
  const ok = semverSatisfies(installed.version, range);
  return {
    ok,
    skillId,
    requestedRange: range,
    resolvedVersion: installed.version,
    reason: ok ? undefined : `已安装 ${installed.version} 不满足 ${range}`
  };
}

/** 校验 consumer 的全部 requires（含 semver） */
export function checkRequiresSemver(
  consumer: SkillManifest,
  installedById: Record<string, RegistrySkillRef | undefined>
): { ok: boolean; details: SemverResolveResult[] } {
  const ids = listRequiredSkillIds(consumer);
  const semverMap = parseRequiresSemverMap(consumer);
  const details: SemverResolveResult[] = [];

  for (const id of ids) {
    const range = semverMap[id] || '>=0.0.0';
    const ref = installedById[id];
    details.push(resolveInstalledVersion(ref ? { ...ref, skillId: id } : undefined, range));
  }

  return { ok: details.every((d) => d.ok), details };
}
