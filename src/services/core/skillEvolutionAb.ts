import { resolveSkillExecutorAuthHeaders, resolveSkillExecutorBaseUrl } from '../../utils/skillExecutorUrl';
import { devWarn } from '../../utils/devConsole';

export interface AbAssignment {
  assigned: boolean;
  variant: string | null;
  label?: string;
  systemPrompt: string | null;
}

export interface AbExperimentConfig {
  skillId: string;
  enabled: boolean;
  variants: {
    A: { label?: string; systemPrompt?: string };
    B: { label?: string; systemPrompt?: string };
  };
  buckets?: Record<string, { executions: number; successes: number; successRate: number }>;
}

/** 拉取 A/B 分桶与变体 system prompt（无实验时 assigned=false） */
export async function fetchAbAssignment(skillId: string, userId = 'default'): Promise<AbAssignment> {
  const base = resolveSkillExecutorBaseUrl();
  if (!base) {
    return { assigned: false, variant: null, systemPrompt: null };
  }
  try {
    const res = await fetch(`${base}/v1/evolution/ab/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...resolveSkillExecutorAuthHeaders() },
      body: JSON.stringify({ skillId, userId }),
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) {
      return { assigned: false, variant: null, systemPrompt: null };
    }
    const data = (await res.json()) as AbAssignment & { success?: boolean };
    return {
      assigned: !!data.assigned,
      variant: data.variant ?? null,
      label: data.label,
      systemPrompt: data.systemPrompt ?? null
    };
  } catch (e) {
    devWarn('[evolution/ab] assign failed:', e);
    return { assigned: false, variant: null, systemPrompt: null };
  }
}

export async function saveAbExperimentConfig(cfg: {
  skillId: string;
  enabled: boolean;
  variants: AbExperimentConfig['variants'];
}): Promise<boolean> {
  const base = resolveSkillExecutorBaseUrl();
  if (!base) return false;
  try {
    const res = await fetch(`${base}/v1/evolution/ab/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...resolveSkillExecutorAuthHeaders() },
      body: JSON.stringify(cfg),
      signal: AbortSignal.timeout(12000)
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchAbStats(skillId: string): Promise<Record<string, unknown> | null> {
  const base = resolveSkillExecutorBaseUrl();
  if (!base) return null;
  try {
    const res = await fetch(`${base}/v1/evolution/ab/stats/${encodeURIComponent(skillId)}`, {
      headers: resolveSkillExecutorAuthHeaders(),
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data as { stats?: Record<string, unknown> }).stats ?? null;
  } catch {
    return null;
  }
}

export async function fetchAbExperiment(skillId: string): Promise<AbExperimentConfig | null> {
  const base = resolveSkillExecutorBaseUrl();
  if (!base) return null;
  try {
    const res = await fetch(`${base}/v1/evolution/ab/config/${encodeURIComponent(skillId)}`, {
      headers: resolveSkillExecutorAuthHeaders(),
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data as { experiment?: AbExperimentConfig }).experiment ?? null;
  } catch {
    return null;
  }
}
