export type ToolSelectionStage = 'toolset';

export interface SelectSkillIdsOptions {
  /** 上限：最终最多给 LLM 多少个 skill 的 tools */
  maxSkills: number;
  /** 近期使用（降序），例如 ["translator","code-generator", ...] */
  recentSkillIds?: string[];
  /**
   * 来自 KGM 向量召回的 skillId -> 相关度（建议 0~1；>1 时会按百分制归一）
   * 与输入命中 / 最近使用合并排序，不替代显式 UI 选中的技能集合。
   */
  embeddingScores?: Record<string, number>;
}

function normalizeText(input: string): string {
  return String(input || '').toLowerCase();
}

function uniqueStable<T>(arr: T[]): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const v of arr) {
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

/**
 * 给定“候选 skillIds”（通常来自 resolveToolSkillIds），基于最小策略挑选 top-k：
 * - **输入命中**：input 里出现 skillId（或其简单变体）则加分
 * - **最近使用**：recentSkillIds 靠前加分
 * - **稳定性**：同分按原顺序稳定排序，避免工具集每轮抖动
 */
export function selectSkillIdsForTools(input: string, candidateSkillIds: string[], options: SelectSkillIdsOptions): string[] {
  const maxSkills = Math.max(0, Math.floor(options.maxSkills || 0));
  const candidates = uniqueStable(candidateSkillIds.filter(Boolean));
  if (maxSkills <= 0) return [];
  if (candidates.length <= maxSkills) return candidates;

  const text = normalizeText(input);
  const recent = options.recentSkillIds || [];
  const emb = options.embeddingScores || {};
  const recentRank = new Map<string, number>();
  for (let i = 0; i < recent.length; i++) {
    if (!recentRank.has(recent[i])) recentRank.set(recent[i], i);
  }

  const scored = candidates.map((id, idx) => {
    let score = 0;
    const nid = normalizeText(id);
    // 避免短 id（如 "a"/"d"）导致的误命中：仅对较长 id 做 includes 匹配
    if (nid.length >= 3) {
      const idTokens = [nid, nid.replace(/[-_]/g, ''), nid.replace(/[-_]/g, ' ')];
      if (text && idTokens.some((t) => t && text.includes(t))) score += 50;
    }

    const r = recentRank.get(id);
    if (typeof r === 'number') {
      // 越近越大：0 -> 30, 1 -> 29, ...
      score += Math.max(0, 30 - r);
    }

    const e = emb[id];
    if (typeof e === 'number' && e > 0) {
      const norm = e > 1 ? Math.min(1, e / 100) : Math.min(1, e);
      score += norm * 55;
    }

    return { id, idx, score };
  });

  scored.sort((a, b) => (b.score - a.score) || (a.idx - b.idx));
  return scored.slice(0, maxSkills).map((s) => s.id);
}

const RECENT_SKILLS_KEY = 'yueli_recent_skill_ids_v1';

export function readRecentSkillIds(limit = 50): string[] {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return [];
    const raw = window.localStorage.getItem(RECENT_SKILLS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(String).filter(Boolean).slice(0, Math.max(0, limit));
  } catch {
    return [];
  }
}

export function recordRecentSkillId(skillId: string, limit = 50): void {
  const id = String(skillId || '').trim();
  if (!id) return;
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const existing = readRecentSkillIds(limit);
    const next = [id, ...existing.filter((x) => x !== id)].slice(0, Math.max(1, limit));
    window.localStorage.setItem(RECENT_SKILLS_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

