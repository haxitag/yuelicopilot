export type ScriptConsentDecision = 'allow_once' | 'allow_always' | 'deny';

/** 解析 skill__<skillId>__<toolFnName>（skillId 可含下划线，取最后一次 __ 分段） */
export function parseSkillToolName(toolName: string): { skillId: string; fn: string } | null {
  if (!toolName.startsWith('skill__')) return null;
  const rest = toolName.slice('skill__'.length);
  const idx = rest.lastIndexOf('__');
  if (idx <= 0) return null;
  const skillId = rest.slice(0, idx);
  const fn = rest.slice(idx + 2);
  if (!skillId || !fn) return null;
  return { skillId, fn };
}

function alwaysKey(skillId: string, kind: 'runtime' | 'entry'): string {
  return kind === 'runtime'
    ? `yueli_consent_always_skill_runtime_${skillId}`
    : `yueli_consent_always_skill_entry_${skillId}`;
}

function sessionKey(skillId: string, kind: 'runtime' | 'entry'): string {
  return kind === 'runtime'
    ? `yueli_consent_session_skill_runtime_${skillId}`
    : `yueli_consent_session_skill_entry_${skillId}`;
}

export function hasScriptConsent(skillId: string, kind: 'runtime' | 'entry'): boolean {
  try {
    if (typeof window === 'undefined') return false;
    if (window.localStorage?.getItem(alwaysKey(skillId, kind)) === '1') return true;
    if (window.sessionStorage?.getItem(sessionKey(skillId, kind)) === '1') return true;
    return false;
  } catch {
    return false;
  }
}

export function applyScriptConsent(skillId: string, kind: 'runtime' | 'entry', decision: ScriptConsentDecision): void {
  if (typeof window === 'undefined') return;
  try {
    if (decision === 'deny') return;
    if (decision === 'allow_always') {
      window.localStorage?.setItem(alwaysKey(skillId, kind), '1');
      return;
    }
    window.sessionStorage?.setItem(sessionKey(skillId, kind), '1');
  } catch {
    // ignore quota / private mode
  }
}
