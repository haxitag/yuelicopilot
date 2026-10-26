/** 客户端 RRF 融合（与 server/lib/ragFusion.mjs 算法一致） */

const RRF_K = 60;

export type RagFusionItem = {
  documentId: string;
  chunkIndex: number;
  content: string;
  score?: number;
  channel?: string;
};

export function reciprocalRankFusion(
  rankedLists: RagFusionItem[][],
  topK = 8
): RagFusionItem[] {
  const scores = new Map<string, number>();
  const meta = new Map<string, RagFusionItem>();

  for (const list of rankedLists) {
    if (!Array.isArray(list)) continue;
    list.forEach((item, rank) => {
      const key = `${item.documentId}:${item.chunkIndex}`;
      scores.set(key, (scores.get(key) || 0) + 1 / (RRF_K + rank + 1));
      if (!meta.has(key)) meta.set(key, item);
    });
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK)
    .map(([key, fusedScore]) => {
      const item = meta.get(key)!;
      return { ...item, score: fusedScore, channel: item.channel || 'rrf' };
    });
}

export function deduplicateRagHits(hits: RagFusionItem[], threshold = 0.82): RagFusionItem[] {
  const out: RagFusionItem[] = [];
  for (const h of hits) {
    const text = String(h.content || '').trim();
    if (!text) continue;
    const dup = out.some((o) => {
      const a = text.slice(0, 200);
      const b = String(o.content || '').trim().slice(0, 200);
      if (a === b) return true;
      const shorter = Math.min(a.length, b.length);
      if (shorter < 40) return false;
      let same = 0;
      for (let i = 0; i < shorter; i += 1) {
        if (a[i] === b[i]) same += 1;
      }
      return same / shorter >= threshold;
    });
    if (!dup) out.push(h);
  }
  return out;
}
