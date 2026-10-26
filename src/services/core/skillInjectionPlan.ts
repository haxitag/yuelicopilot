import type { SkillManifest } from './SkillManifestSchema';

export type ContextInjectionMode = 'pre_llm' | 'post_llm' | 'bidirectional';

/** manifest 声明优先；否则：有 tools → post_llm，否则 pre_llm */
export function resolveContextInjectionMode(manifest: SkillManifest | undefined): ContextInjectionMode {
  const m = manifest?.context_injection?.mode;
  if (m === 'pre_llm' || m === 'post_llm' || m === 'bidirectional') return m;
  const hasTools = Array.isArray(manifest?.tools) && manifest.tools.length > 0;
  return hasTools ? 'post_llm' : 'pre_llm';
}

export interface SkillInjectionPlan {
  /** LLM 调用前应执行并拼接进用户上下文的技能 */
  skillsPrePipeline: string[];
  /** 应注册为对话 tools（post_llm / bidirectional 且有 tools） */
  skillsToolEligible: string[];
}

export function buildSkillInjectionPlan(
  skillIds: string[],
  manifestsById: Map<string, SkillManifest | undefined>
): SkillInjectionPlan {
  const skillsPrePipeline: string[] = [];
  const skillsToolEligible: string[] = [];

  const seen = new Set<string>();
  for (const skillId of skillIds) {
    if (!skillId || seen.has(skillId)) continue;
    seen.add(skillId);

    const manifest = manifestsById.get(skillId);
    const mode = resolveContextInjectionMode(manifest);
    const hasTools = Array.isArray(manifest?.tools) && manifest!.tools!.length > 0;

    if (mode === 'pre_llm') {
      skillsPrePipeline.push(skillId);
    } else if (mode === 'post_llm') {
      if (hasTools) skillsToolEligible.push(skillId);
      else skillsPrePipeline.push(skillId);
    } else {
      skillsPrePipeline.push(skillId);
      if (hasTools) skillsToolEligible.push(skillId);
    }
  }

  return { skillsPrePipeline, skillsToolEligible };
}
