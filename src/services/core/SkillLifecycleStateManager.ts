import { SkillLifecycleStatus, SkillLifecycleTransition, AuditType } from '../../types';
import { AuditSystem } from './EventManager';

export class SkillLifecycleStateManager {
  private auditSystem: AuditSystem;
  private validTransitions: Map<SkillLifecycleStatus, SkillLifecycleStatus[]>;

  constructor(auditSystem: AuditSystem) {
    this.auditSystem = auditSystem;
    this.validTransitions = this.buildValidTransitions();
  }

  private buildValidTransitions(): Map<SkillLifecycleStatus, SkillLifecycleStatus[]> {
    return new Map([
      [SkillLifecycleStatus.DISCOVERED, [SkillLifecycleStatus.INSTALLING, SkillLifecycleStatus.INSTALLED]],
      [SkillLifecycleStatus.INSTALLING, [SkillLifecycleStatus.INSTALLED, SkillLifecycleStatus.ERROR, SkillLifecycleStatus.FAILED]],
      [SkillLifecycleStatus.INSTALLED, [SkillLifecycleStatus.ENABLING, SkillLifecycleStatus.UNINSTALLING, SkillLifecycleStatus.DISABLED]],
      [SkillLifecycleStatus.ENABLING, [SkillLifecycleStatus.ENABLED, SkillLifecycleStatus.ERROR, SkillLifecycleStatus.FAILED]],
      [SkillLifecycleStatus.ENABLED, [SkillLifecycleStatus.ACTIVE, SkillLifecycleStatus.DISABLING, SkillLifecycleStatus.EXECUTING]],
      [SkillLifecycleStatus.ACTIVE, [SkillLifecycleStatus.ENABLED, SkillLifecycleStatus.EXECUTING, SkillLifecycleStatus.FAILED, SkillLifecycleStatus.ERROR]],
      [SkillLifecycleStatus.EXECUTING, [SkillLifecycleStatus.COMPLETED, SkillLifecycleStatus.FAILED, SkillLifecycleStatus.ERROR, SkillLifecycleStatus.ACTIVE]],
      [SkillLifecycleStatus.COMPLETED, [SkillLifecycleStatus.ACTIVE, SkillLifecycleStatus.DISABLING, SkillLifecycleStatus.ENABLED]],
      [SkillLifecycleStatus.FAILED, [SkillLifecycleStatus.EXECUTING, SkillLifecycleStatus.DISABLING, SkillLifecycleStatus.ENABLED]],
      [SkillLifecycleStatus.DISABLING, [SkillLifecycleStatus.DISABLED, SkillLifecycleStatus.ERROR]],
      [SkillLifecycleStatus.DISABLED, [SkillLifecycleStatus.ENABLING, SkillLifecycleStatus.UNINSTALLING, SkillLifecycleStatus.INSTALLED]],
      [SkillLifecycleStatus.UNINSTALLING, [SkillLifecycleStatus.UNINSTALLED, SkillLifecycleStatus.ERROR]],
      [SkillLifecycleStatus.ERROR, [SkillLifecycleStatus.DISABLING, SkillLifecycleStatus.ENABLING, SkillLifecycleStatus.EXECUTING]],
    ]);
  }

  canTransition(from: SkillLifecycleStatus, to: SkillLifecycleStatus): boolean {
    const allowed = this.validTransitions.get(from);
    if (!allowed) return false;
    return allowed.includes(to);
  }

  getNextStatus(current: SkillLifecycleStatus, action: string): SkillLifecycleStatus | null {
    const transitionMap: Record<string, SkillLifecycleStatus> = {
      'install': SkillLifecycleStatus.INSTALLING,
      'install_complete': SkillLifecycleStatus.INSTALLED,
      'enable': SkillLifecycleStatus.ENABLING,
      'enable_complete': SkillLifecycleStatus.ENABLED,
      'activate': SkillLifecycleStatus.ACTIVE,
      'execute': SkillLifecycleStatus.EXECUTING,
      'execute_complete': SkillLifecycleStatus.COMPLETED,
      'fail': SkillLifecycleStatus.FAILED,
      'disable': SkillLifecycleStatus.DISABLING,
      'disable_complete': SkillLifecycleStatus.DISABLED,
      'uninstall': SkillLifecycleStatus.UNINSTALLING,
      'uninstall_complete': SkillLifecycleStatus.UNINSTALLED,
      'error': SkillLifecycleStatus.ERROR,
      'recover': SkillLifecycleStatus.ENABLED,
    };

    const next = transitionMap[action];
    if (next && this.canTransition(current, next)) {
      return next;
    }
    return null;
  }

  transition(skillId: string, from: SkillLifecycleStatus, to: SkillLifecycleStatus, action: string, metadata?: Record<string, any>): boolean {
    if (!this.canTransition(from, to)) {
      this.auditSystem.record(AuditType.EXECUTE, skillId, 'failed', {
        metadata: {
          error: `Invalid transition from ${from} to ${to} for action ${action}`,
          currentStatus: from,
          attemptedStatus: to
        }
      });
      return false;
    }

    this.auditSystem.record(AuditType.EXECUTE, skillId, 'success', {
      metadata: {
        action,
        from,
        to,
        ...metadata
      }
    });

    return true;
  }

  getValidTransitions(from: SkillLifecycleStatus): SkillLifecycleStatus[] {
    return this.validTransitions.get(from) || [];
  }

  isTerminalState(status: SkillLifecycleStatus): boolean {
    return status === SkillLifecycleStatus.UNINSTALLED;
  }

  isActiveState(status: SkillLifecycleStatus): boolean {
    return status === SkillLifecycleStatus.ACTIVE || 
           status === SkillLifecycleStatus.EXECUTING ||
           status === SkillLifecycleStatus.ENABLING ||
           status === SkillLifecycleStatus.INSTALLING ||
           status === SkillLifecycleStatus.DISABLING ||
           status === SkillLifecycleStatus.UNINSTALLING;
  }

  getStateDescription(status: SkillLifecycleStatus): string {
    const descriptions: Record<SkillLifecycleStatus, string> = {
      [SkillLifecycleStatus.DISCOVERED]: '技能已发现，待安装',
      [SkillLifecycleStatus.INSTALLING]: '技能安装中',
      [SkillLifecycleStatus.INSTALLED]: '技能已安装，待启用',
      [SkillLifecycleStatus.ENABLING]: '技能启用中',
      [SkillLifecycleStatus.ENABLED]: '技能已启用',
      [SkillLifecycleStatus.ACTIVE]: '技能处于活跃状态',
      [SkillLifecycleStatus.EXECUTING]: '技能执行中',
      [SkillLifecycleStatus.COMPLETED]: '技能执行完成',
      [SkillLifecycleStatus.FAILED]: '技能执行失败',
      [SkillLifecycleStatus.DISABLING]: '技能禁用中',
      [SkillLifecycleStatus.DISABLED]: '技能已禁用',
      [SkillLifecycleStatus.UNINSTALLING]: '技能卸载中',
      [SkillLifecycleStatus.UNINSTALLED]: '技能已卸载',
      [SkillLifecycleStatus.ERROR]: '技能处于错误状态'
    };
    return descriptions[status] || '未知状态';
  }
}
