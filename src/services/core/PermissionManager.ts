import { 
  SkillPermission, 
  PermissionCheckResult, 
  PermissionPolicy,
  AuditType
} from '../../types';
import { AuditSystem, EventManager } from './EventManager';

export class PermissionManager {
  private policies: Map<string, PermissionPolicy> = new Map();
  private auditSystem: AuditSystem;
  private eventManager: EventManager;

  // 默认策略：默认拒绝，需要用户显式授权
  private readonly DEFAULT_POLICY: PermissionPolicy = {
    skillId: 'default',
    permissions: [],
    mode: 'deny-all'
  };

  constructor(auditSystem: AuditSystem, eventManager: EventManager) {
    this.auditSystem = auditSystem;
    this.eventManager = eventManager;
    this.loadFromStorage();
  }

  /**
   * 从本地存储加载权限策略
   */
  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem('yueli_permission_policies');
      if (stored) {
        const policies = JSON.parse(stored);
        policies.forEach((policy: PermissionPolicy) => {
          this.policies.set(policy.skillId, policy);
        });
      }
    } catch (error) {
      console.error('Failed to load permission policies:', error);
    }
  }

  /**
   * 保存权限策略到本地存储
   */
  private saveToStorage(): void {
    try {
      const policies = Array.from(this.policies.values());
      localStorage.setItem('yueli_permission_policies', JSON.stringify(policies));
    } catch (error) {
      console.error('Failed to save permission policies:', error);
    }
  }

  /**
   * 获取技能的权限策略
   */
  getPolicy(skillId: string): PermissionPolicy {
    return this.policies.get(skillId) || { ...this.DEFAULT_POLICY, skillId };
  }

  /**
   * 设置技能的权限策略
   */
  setPolicy(skillId: string, policy: Omit<PermissionPolicy, 'skillId'>): void {
    const fullPolicy: PermissionPolicy = {
      ...policy,
      skillId
    };
    this.policies.set(skillId, fullPolicy);
    this.saveToStorage();

    this.auditSystem.record(AuditType.CONNECT, skillId, 'success', {
      outputs: { policy: fullPolicy }
    });
  }

  /**
   * 检查权限
   */
  checkPermission(skillId: string, permission: SkillPermission): PermissionCheckResult {
    const policy = this.getPolicy(skillId);
    const timestamp = new Date();

    let allowed = false;
    let reason = '';

    switch (policy.mode) {
      case 'allow-all':
        allowed = true;
        reason = 'Allow-all policy';
        break;
      case 'deny-all':
        allowed = false;
        reason = 'Deny-all policy';
        break;
      case 'custom':
        if (policy.customRules) {
          const rule = policy.customRules.find(r => r.permission === permission);
          if (rule) {
            allowed = rule.allowed;
            reason = rule.allowed ? 'Custom rule: allowed' : 'Custom rule: denied';
          } else {
            allowed = policy.permissions.includes(permission);
            reason = allowed ? 'Permission in whitelist' : 'Permission not in whitelist';
          }
        } else {
          allowed = policy.permissions.includes(permission);
          reason = allowed ? 'Permission in whitelist' : 'Permission not in whitelist';
        }
        break;
    }

    const result: PermissionCheckResult = {
      allowed,
      reason,
      requested: permission,
      timestamp
    };

    this.auditSystem.record(AuditType.RESOURCE_ACQUIRE, skillId, allowed ? 'success' : 'failed', {
      inputs: { permission },
      outputs: { result }
    });

    return result;
  }

  /**
   * 批量检查权限
   */
  checkPermissions(skillId: string, permissions: SkillPermission[]): PermissionCheckResult[] {
    return permissions.map(permission => this.checkPermission(skillId, permission));
  }

  /**
   * 请求权限
   */
  async requestPermission(skillId: string, permission: SkillPermission): Promise<PermissionCheckResult> {
    const result = this.checkPermission(skillId, permission);
    
    if (!result.allowed) {
      await this.eventManager.emitForPlugin('permission:request', skillId, skillId, {
        permission,
        currentPolicy: this.getPolicy(skillId)
      });
    }

    return result;
  }

  /**
   * 授予权限
   */
  grantPermission(skillId: string, permission: SkillPermission): void {
    const policy = this.getPolicy(skillId);
    
    if (policy.mode !== 'custom') {
      // 转换为自定义模式
      policy.mode = 'custom';
      policy.customRules = [];
    }

    if (!policy.customRules) {
      policy.customRules = [];
    }

    // 检查是否已有相同权限规则
    const existingRule = policy.customRules.find(r => r.permission === permission);
    if (existingRule) {
      existingRule.allowed = true;
    } else {
      policy.customRules.push({
        permission,
        allowed: true
      });
    }

    this.setPolicy(skillId, policy);
  }

  /**
   * 撤销权限
   */
  revokePermission(skillId: string, permission: SkillPermission): void {
    const policy = this.getPolicy(skillId);
    
    if (policy.mode !== 'custom') {
      policy.mode = 'custom';
      policy.customRules = [];
    }

    if (!policy.customRules) {
      policy.customRules = [];
    }

    const existingRule = policy.customRules.find(r => r.permission === permission);
    if (existingRule) {
      existingRule.allowed = false;
    } else {
      policy.customRules.push({
        permission,
        allowed: false
      });
    }

    this.setPolicy(skillId, policy);
  }

  /**
   * 重置权限策略
   */
  resetPolicy(skillId: string): void {
    this.policies.delete(skillId);
    this.saveToStorage();
  }

  /**
   * 获取权限类别描述
   */
  getPermissionDescription(permission: SkillPermission): string {
    const descriptions: Record<SkillPermission, string> = {
      'file.read': '读取文件',
      'file.write': '写入文件',
      'file.delete': '删除文件',
      'network.http': '发送HTTP请求',
      'network.api': '调用API接口',
      'process.execute': '执行系统命令',
      'environment.read': '读取环境变量',
      'localStorage.access': '访问本地存储',
      'notification.send': '发送通知',
      'clipboard.read': '读取剪贴板',
      'clipboard.write': '写入剪贴板'
    };
    return descriptions[permission] || permission;
  }

  /**
   * 获取权限类别的风险等级
   */
  getPermissionRiskLevel(permission: SkillPermission): 'low' | 'medium' | 'high' | 'critical' {
    const riskLevels: Partial<Record<SkillPermission, 'low' | 'medium' | 'high' | 'critical'>> = {
      'localStorage.access': 'low',
      'notification.send': 'low',
      'file.read': 'medium',
      'file.write': 'medium',
      'environment.read': 'medium',
      'clipboard.read': 'medium',
      'clipboard.write': 'medium',
      'network.http': 'high',
      'network.api': 'high',
      'file.delete': 'high',
      'process.execute': 'critical'
    };
    return riskLevels[permission] || 'medium';
  }

  /**
   * 按风险等级分组权限
   */
  groupPermissionsByRisk(permissions: SkillPermission[]): Record<string, SkillPermission[]> {
    const groups: Record<string, SkillPermission[]> = {
      'critical': [],
      'high': [],
      'medium': [],
      'low': []
    };

    permissions.forEach(permission => {
      const level = this.getPermissionRiskLevel(permission);
      groups[level].push(permission);
    });

    return groups;
  }
}
