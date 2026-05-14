import { SkillStorage } from './SkillStorage';
import type { SkillManifest } from './SkillManifestSchema';
import type { PreflightCheckRow, PreflightResult } from './preflightTypes';
import { resolveSkillExecutorAuthHeaders, resolveSkillExecutorBaseUrl } from '../../utils/skillExecutorUrl';

export type { PreflightCheckRow, PreflightResult } from './preflightTypes';

const PREFLIGHT_TTL_MS = 60 * 60 * 1000;

function stableJsonStringify(value: unknown): string {
  const seen = new WeakSet();
  const normalize = (v: any): any => {
    if (v === null || typeof v !== 'object') return v;
    if (seen.has(v)) return '[Circular]';
    seen.add(v);
    if (Array.isArray(v)) return v.map(normalize);
    const out: Record<string, any> = {};
    for (const k of Object.keys(v).sort()) out[k] = normalize(v[k]);
    return out;
  };
  return JSON.stringify(normalize(value));
}

function computeManifestHash(manifest: SkillManifest): string {
  // 非加密 hash：仅用于缓存失效判定
  let h = 2166136261;
  const s = stableJsonStringify(manifest);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `fnv1a32:${(h >>> 0).toString(16)}`;
}

async function isSkillExecutorHealthy(): Promise<boolean> {
  try {
    const base = resolveSkillExecutorBaseUrl();
    const res = await fetch(`${base}/health`, {
      method: 'GET',
      headers: resolveSkillExecutorAuthHeaders(),
      signal: AbortSignal.timeout(3000)
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** 声明了需要服务端深度校验的字段时，必须在线 skill-executor */
export function manifestNeedsStrictPreflight(manifest: SkillManifest): boolean {
  const profile =
    manifest.execution && typeof manifest.execution === 'object'
      ? (manifest.execution as { profile?: string }).profile
      : undefined;
  if (profile && profile !== 'process_host') return true;

  if (manifest.runtime?.min_runtime_version) return true;
  const d = manifest.dependencies;
  if (d && typeof d === 'object' && !Array.isArray(d)) {
    if (Array.isArray(d.env_vars) && d.env_vars.length > 0) return true;
    if (Array.isArray(d.system) && d.system.length > 0) return true;
    if (d.npm && typeof d.npm === 'object' && Object.keys(d.npm).length > 0) return true;
  }
  if (
    manifest.capabilities?.network &&
    Array.isArray(manifest.capabilities.allowed_domains) &&
    manifest.capabilities.allowed_domains.length > 0
  ) {
    return true;
  }
  return false;
}

async function fetchPreflightFromExecutor(manifest: SkillManifest): Promise<PreflightCheckRow[]> {
  const base = resolveSkillExecutorBaseUrl();
  try {
    const res = await fetch(`${base}/v1/skills/preflight`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...resolveSkillExecutorAuthHeaders() },
      body: JSON.stringify({ manifest }),
      signal: AbortSignal.timeout(20000)
    });
    const data = (await res.json().catch(() => ({}))) as {
      checks?: PreflightCheckRow[];
      error?: string;
      ok?: boolean;
    };
    if (!res.ok) {
      return [
        {
          name: 'skill_executor',
          ok: false,
          detail: data.error || `preflight HTTP ${res.status}`
        }
      ];
    }
    if (!Array.isArray(data.checks)) {
      return [
        {
          name: 'skill_executor',
          ok: false,
          detail: 'preflight 响应缺少 checks'
        }
      ];
    }
    return data.checks;
  } catch (e) {
    return [
      {
        name: 'skill_executor',
        ok: false,
        detail: e instanceof Error ? e.message : String(e)
      }
    ];
  }
}

/**
 * 运行预检并写入缓存（TTL 1 小时）。严格依赖项在未连接 executor 时失败。
 */
export async function runPreflightWithCache(
  skillId: string,
  manifest: SkillManifest,
  storage: SkillStorage,
  opts?: { force?: boolean }
): Promise<PreflightResult> {
  const executorBaseUrl = resolveSkillExecutorBaseUrl();
  const manifestHash = computeManifestHash(manifest);

  if (!opts?.force) {
    const cached = await storage.getPreflight(skillId);
    const cacheFresh = cached && Date.now() - cached.cachedAt < PREFLIGHT_TTL_MS;
    const cacheMatch =
      cached &&
      (!cached.manifestHash || cached.manifestHash === manifestHash) &&
      (!cached.executorBaseUrl || cached.executorBaseUrl === executorBaseUrl);

    if (cacheFresh && cacheMatch) {
      return cached;
    }
  }

  const strict = manifestNeedsStrictPreflight(manifest);
  let checks: PreflightCheckRow[];
  let ok: boolean;

  if (strict) {
    const healthy = await isSkillExecutorHealthy();
    if (!healthy) {
      checks = [
        {
          name: 'skill_executor',
          ok: false,
          detail:
            '技能声明了运行环境 / 系统依赖 / 环境变量 / npm 依赖 / 联网域名等，需要本地 skill-executor 在线完成预检（默认端口 3010，可由 SKILL_EXECUTOR_PORT / VITE_SKILL_EXECUTOR_* 覆盖）。请启动 server/index.js 或在设置中配置 skillExecutorUrl。'
        }
      ];
      ok = false;
    } else {
      checks = await fetchPreflightFromExecutor(manifest);
      ok = checks.length > 0 && checks.every((c) => c.ok);
    }
  } else {
    checks = [
      {
        name: 'preflight',
        ok: true,
        detail: '未声明需服务端校验的硬依赖（runtime/env/system/npm/联网域名），跳过深度预检',
        skipped: true
      }
    ];
    ok = true;
  }

  const result: PreflightResult = {
    ok,
    checks,
    cachedAt: Date.now(),
    manifestHash,
    executorBaseUrl
  };
  await storage.savePreflight(skillId, result);
  return result;
}
