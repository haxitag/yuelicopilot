import type { SkillManifest } from './SkillManifestSchema';

/** 从 manifest 提取可匹配触发词（小写） */
export function collectTriggerTerms(manifest: SkillManifest): string[] {
  const terms = new Set<string>();
  const id = manifest.id?.trim().toLowerCase();
  const name = manifest.name?.trim().toLowerCase();
  if (id) terms.add(id);
  if (name) terms.add(name);

  const triggers = manifest.triggers as { keywords?: string[]; intent_patterns?: string[] } | undefined;
  if (triggers?.keywords) {
    for (const kw of triggers.keywords) {
      const k = String(kw).trim().toLowerCase();
      if (k) terms.add(k);
    }
  }
  if (triggers?.intent_patterns) {
    for (const p of triggers.intent_patterns) {
      const k = String(p).trim().toLowerCase();
      if (k) terms.add(k);
    }
  }
  if (Array.isArray(manifest.tags)) {
    for (const t of manifest.tags) {
      const k = String(t).trim().toLowerCase();
      if (k.length >= 2) terms.add(k);
    }
  }
  return [...terms];
}

/** 输入是否应触发该技能（@id、关键词、意图模式子串） */
export function inputMatchesSkillTriggers(input: string, manifest: SkillManifest): boolean {
  const text = input.toLowerCase();
  const id = manifest.id?.toLowerCase();
  if (id && (text.includes(`@${id}`) || text.includes(id))) return true;

  for (const term of collectTriggerTerms(manifest)) {
    if (term.length >= 2 && text.includes(term)) return true;
  }
  return false;
}
