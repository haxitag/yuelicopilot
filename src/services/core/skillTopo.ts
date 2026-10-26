import type { SkillManifest } from './SkillManifestSchema';

/** 按 manifest.requires 拓扑排序；环或未声明依赖保持相对稳定顺序并跳过无效边 */
export function topoSortSkillsByRequires(
  skillIds: string[],
  manifestsById: Map<string, SkillManifest | undefined>
): string[] {
  const ids = [...new Set(skillIds.filter(Boolean))];
  const present = new Set(ids);

  const adj = new Map<string, Set<string>>();
  const indeg = new Map<string, number>();

  for (const id of ids) {
    adj.set(id, new Set());
    indeg.set(id, 0);
  }

  for (const id of ids) {
    const req = manifestsById.get(id)?.requires;
    if (!Array.isArray(req)) continue;
    for (const dep of req) {
      if (!dep || !present.has(dep) || dep === id) continue;
      adj.get(dep)!.add(id);
      indeg.set(id, (indeg.get(id) || 0) + 1);
    }
  }

  const q: string[] = [];
  for (const id of ids) {
    if ((indeg.get(id) || 0) === 0) q.push(id);
  }

  const ordered: string[] = [];
  while (q.length > 0) {
    const u = q.shift()!;
    ordered.push(u);
    for (const v of adj.get(u) || []) {
      indeg.set(v, (indeg.get(v) || 0) - 1);
      if ((indeg.get(v) || 0) === 0) q.push(v);
    }
  }

  if (ordered.length !== ids.length) {
    return ids;
  }
  return ordered;
}
