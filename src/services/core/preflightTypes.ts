/** Preflight 校验结果（SkillStorage 与 SkillPreflight 共用，避免循环依赖） */

export interface PreflightCheckRow {
  name: string;
  ok: boolean;
  detail?: string;
  skipped?: boolean;
}

export interface PreflightResult {
  ok: boolean;
  checks: PreflightCheckRow[];
  cachedAt: number;
  /** 用于缓存失效判断：manifest 变化应重新预检 */
  manifestHash?: string;
  /** 用于缓存失效判断：executor 连接地址变化应重新预检 */
  executorBaseUrl?: string;
}
