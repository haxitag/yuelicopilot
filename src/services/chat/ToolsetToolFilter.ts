import type { SkillExecutor } from '../SkillExecutor';
import { fetchToolsets, type ToolsetRow } from '../toolsetExecutorClient';

/**
 * 从已启用的 toolset 汇总「逻辑工具名」（与 manifest / MCP / connector 的尾段对齐，小写）。
 */
export function collectLogicalToolNamesFromEnabledToolsets(
  toolsets: Array<Pick<ToolsetRow, 'enabled' | 'tools'>>
): Set<string> {
  const out = new Set<string>();
  for (const t of toolsets) {
    if (t.enabled === false) continue;
    for (const raw of t.tools || []) {
      const n = String(raw).trim().toLowerCase();
      if (n) out.add(n);
    }
  }
  return out;
}

/**
 * 解析 OpenAI tool name 的逻辑尾段（与 SkillExecutor / MCPRuntime / Connector 命名一致）。
 */
export function extractLogicalToolSuffix(functionName: string): string | null {
  const name = String(functionName || '');
  const patterns = [
    /^skill__([^_]+(?:_[^_]+)*)__(.+)$/,
    /^mcp__([^_]+(?:_[^_]+)*)__(.+)$/,
    /^connector__([^_]+(?:_[^_]+)*)__(.+)$/
  ];
  for (const p of patterns) {
    const m = name.match(p);
    if (m?.[2]) return m[2].toLowerCase();
  }
  return null;
}

export function filterSkillIdsByToolsetAllowlist(
  skillIds: string[],
  allowed: Set<string>,
  skillExecutor: Pick<SkillExecutor, 'getSkillToolDefinitions'>
): string[] {
  if (allowed.size === 0) return [...skillIds];
  const kept: string[] = [];
  for (const id of skillIds) {
    const defs = skillExecutor.getSkillToolDefinitions(id);
    const hit = defs.some((d) => {
      const suf = extractLogicalToolSuffix(d.function.name);
      return suf != null && allowed.has(suf);
    });
    if (hit) kept.push(id);
  }
  return kept.length > 0 ? kept : [...skillIds];
}

export function filterToolDefinitionsByAllowlist<T extends { function?: { name?: string } }>(
  tools: T[],
  allowed: Set<string>
): T[] {
  if (allowed.size === 0) return tools;
  const next = tools.filter((t) => {
    const fn = t?.function?.name;
    if (!fn) return true;
    const suf = extractLogicalToolSuffix(fn);
    if (suf == null) return true;
    return allowed.has(suf);
  });
  return next.length > 0 ? next : tools;
}

export function isToolsetWhitelistFilterEnabled(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('yueli_toolset_filter_enabled') === '1';
  } catch {
    return false;
  }
}

/** 拉取已启用 toolset 并汇总逻辑工具名；未开启开关或并集为空时返回 null。 */
export async function resolveEnabledToolsetLogicalNames(): Promise<Set<string> | null> {
  if (!isToolsetWhitelistFilterEnabled()) return null;
  try {
    const toolsets = await fetchToolsets();
    const s = collectLogicalToolNamesFromEnabledToolsets(toolsets as ToolsetRow[]);
    return s.size > 0 ? s : null;
  } catch {
    return null;
  }
}
