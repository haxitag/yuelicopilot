/** KGM memory 中与工具路由索引一致的 metadata.kind */
export const YUELI_SKILL_ROUTING_KIND = 'yueli_skill_routing';

export const DEFAULT_TOOL_ROUTING_COLLECTION = 'yueli_tool_routing';

export interface KgmMemorySearchLike {
  kgmMemorySearch(query: string, collection?: string, topK?: number): Promise<{
    results?: Array<{
      content?: string;
      text?: string;
      score?: number;
      similarity?: number;
      metadata?: Record<string, any>;
    }>;
  } | null>;
}

/**
 * 从 KGM 向量库读取与当前输入相关的技能分（仅作用于已在候选集中的 skillId）。
 * 需先在 ToolsMenu 中「同步工具路由索引」并开启「向量工具路由」。
 */
export async function recallSkillRoutingScoresFromMemory(
  input: string,
  candidateSkillIds: string[],
  api: KgmMemorySearchLike
): Promise<Record<string, number> | undefined> {
  if (typeof localStorage === 'undefined' || localStorage.getItem('yueli_tool_routing_vector') !== '1') {
    return undefined;
  }
  const q = String(input || '').trim();
  if (!q || candidateSkillIds.length === 0) return undefined;

  const coll =
    window.localStorage.getItem('yueli_tool_routing_collection')?.trim() || DEFAULT_TOOL_ROUTING_COLLECTION;

  const active = new Set(candidateSkillIds);
  try {
    const searchResult = await api.kgmMemorySearch(q, coll, 32);
    if (!searchResult?.results?.length) return undefined;

    const out: Record<string, number> = {};
    for (const r of searchResult.results) {
      const meta = r.metadata || {};
      const kind = meta.yueliKind || meta.yueli_kind;
      const sid = meta.skillId || meta.skill_id;
      if (!sid || !active.has(String(sid))) continue;
      if (kind && kind !== YUELI_SKILL_ROUTING_KIND) continue;

      const raw =
        typeof r.score === 'number'
          ? r.score
          : typeof r.similarity === 'number'
            ? r.similarity
            : 0.35;
      const sidStr = String(sid);
      out[sidStr] = Math.max(out[sidStr] || 0, Math.min(1, raw > 1 ? raw / 100 : raw));
    }
    return Object.keys(out).length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}
