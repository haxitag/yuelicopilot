export type KnowledgeScopeMode = 'full' | 'vector' | 'off';

export const KNOWLEDGE_SCOPE_LS_KEY = 'yueli_knowledge_scope';

export function readKnowledgeScopeMode(): KnowledgeScopeMode {
  try {
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem(KNOWLEDGE_SCOPE_LS_KEY) : null;
    if (v === 'vector' || v === 'full' || v === 'off') return v;
  } catch {
    /* ignore */
  }
  return 'full';
}

export function isValidKnowledgeScopeMode(v: string | null | undefined): v is KnowledgeScopeMode {
  return v === 'vector' || v === 'full' || v === 'off';
}
