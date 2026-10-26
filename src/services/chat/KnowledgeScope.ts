export type KnowledgeScopeMode = 'full' | 'vector' | 'off';

export type FusionPolicy =
  | 'local_first'
  | 'session_first'
  | 'memory_first'
  | 'web_supplement'
  | 'local_only';

export const KNOWLEDGE_SCOPE_LS_KEY = 'yueli_knowledge_scope';
export const FUSION_POLICY_LS_KEY = 'yueli_fusion_policy';

/** @deprecated 工作区已并入项目主题 topic.workspaceRoot */
export const WORKSPACE_ID_LS_KEY = 'yueli_workspace_id';
/** @deprecated 工作区已并入项目主题 topic.workspaceRoot */
export const WORKSPACE_ROOT_LS_KEY = 'yueli_workspace_root';

export const DEFAULT_FUSION_POLICY: FusionPolicy = 'local_first';

/** 未设置 localStorage 时的默认策略：向量片段（依赖 KGM memory；无结果时 buildMessages 可回退） */
export const DEFAULT_KNOWLEDGE_SCOPE_MODE: KnowledgeScopeMode = 'vector';

export function readKnowledgeScopeMode(): KnowledgeScopeMode {
  try {
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem(KNOWLEDGE_SCOPE_LS_KEY) : null;
    if (v === 'vector' || v === 'full' || v === 'off') return v;
  } catch {
    /* ignore */
  }
  return DEFAULT_KNOWLEDGE_SCOPE_MODE;
}

export function isValidKnowledgeScopeMode(v: string | null | undefined): v is KnowledgeScopeMode {
  return v === 'vector' || v === 'full' || v === 'off';
}

export function isValidFusionPolicy(v: string | null | undefined): v is FusionPolicy {
  return (
    v === 'local_first' ||
    v === 'session_first' ||
    v === 'memory_first' ||
    v === 'web_supplement' ||
    v === 'local_only'
  );
}

export function readFusionPolicy(): FusionPolicy {
  try {
    const v =
      typeof localStorage !== 'undefined' ? localStorage.getItem(FUSION_POLICY_LS_KEY) : null;
    if (isValidFusionPolicy(v)) return v;
  } catch {
    /* ignore */
  }
  return DEFAULT_FUSION_POLICY;
}

