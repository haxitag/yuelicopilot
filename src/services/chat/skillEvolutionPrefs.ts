const SKILL_EVOLUTION_LS_KEY = 'yueli_skill_evolution_enabled';

export function isSkillEvolutionEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(SKILL_EVOLUTION_LS_KEY) !== '0';
}

export function setSkillEvolutionEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SKILL_EVOLUTION_LS_KEY, enabled ? '1' : '0');
}
