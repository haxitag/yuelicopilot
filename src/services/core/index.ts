// 核心管理系统入口文件

// 导出类型
export * from '../../types';

// 导出核心模块
import { CoreOrchestratorV2 } from './CoreOrchestratorV2';
export { EventManager, AuditSystem, ResourceManager, DataNormalizer, RepositoryParser } from './EventManager';
export { PluginManager } from './PluginManager';
export { ScheduleManager } from './ScheduleManager';
export { CoreOrchestratorV2 };
export { SkillInstaller } from './SkillInstaller';
export { SkillFileSystem, getSkillFileSystem } from './SkillFileSystem';
export type { DiscoveredSkill } from './SkillInstaller';

// 单例模式
let defaultOrchestrator: CoreOrchestratorV2 | null = null;

export function getDefaultOrchestrator(): CoreOrchestratorV2 {
  if (!defaultOrchestrator) {
    defaultOrchestrator = new CoreOrchestratorV2();
  }
  return defaultOrchestrator;
}
