/**
 * Security Approval System - 安全命令审批系统
 * 基于Hermes-agent的Security设计
 * 核心功能：
 * 1. 命令风险评估
 * 2. 审批工作流
 * 3. 命令白名单/黑名单
 * 4. 审批历史追踪
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'auto_approved' | 'auto_rejected';
export type ApprovalMode = 'all' | 'high_risk_only' | 'none';

export interface ApprovalRule {
  id: string;
  name: string;
  pattern: string;
  riskLevel: RiskLevel;
  action: 'allow' | 'deny' | 'require_approval';
  conditions?: Record<string, any>;
  enabled: boolean;
  priority: number;
  createdAt: Date;
}

export interface ApprovalRequest {
  id: string;
  command: string;
  args?: Record<string, any>;
  riskLevel: RiskLevel;
  riskFactors: string[];
  requestedBy: string;
  requestedAt: Date;
  status: ApprovalStatus;
  approvedBy?: string;
  approvedAt?: Date;
  reason?: string;
  expiresAt?: Date;
  metadata?: Record<string, any>;
}

export interface SecurityConfig {
  approvalMode: ApprovalMode;
  autoApproveLowRisk: boolean;
  autoRejectCriticalRisk: boolean;
  approvalTimeout: number;
  requirePasswordForApproval: boolean;
  notifyOnApproval: boolean;
  notifyOnRejection: boolean;
}

interface SecurityStore {
  config: SecurityConfig;
  rules: ApprovalRule[];
  requests: ApprovalRequest[];
  whitelist: string[];
  blacklist: string[];
  history: ApprovalRequest[];
}

class SecurityApprovalSystem extends EventEmitter {
  private static instance: SecurityApprovalSystem;
  private storePath: string;
  private store: SecurityStore = {
    config: {
      approvalMode: 'high_risk_only',
      autoApproveLowRisk: true,
      autoRejectCriticalRisk: true,
      approvalTimeout: 300000,
      requirePasswordForApproval: false,
      notifyOnApproval: true,
      notifyOnRejection: true
    },
    rules: [],
    requests: [],
    whitelist: [],
    blacklist: [],
    history: []
  };

  private constructor() {
    super();
    this.storePath = path.join(__dirname, '../../../data/security_approval.json');
    this.loadStore();
    this.initializeDefaultRules();
  }

  static getInstance(): SecurityApprovalSystem {
    if (!SecurityApprovalSystem.instance) {
      SecurityApprovalSystem.instance = new SecurityApprovalSystem();
    }
    return SecurityApprovalSystem.instance;
  }

  private async loadStore(): Promise<void> {
    try {
      const dir = path.dirname(this.storePath);
      await fs.mkdir(dir, { recursive: true });
      const data = await fs.readFile(this.storePath, 'utf-8');
      const parsed = JSON.parse(data);
      this.store = {
        config: parsed.config || this.store.config,
        rules: (parsed.rules || []).map((r: any) => ({
          ...r,
          createdAt: new Date(r.createdAt)
        })),
        requests: (parsed.requests || []).map((r: any) => ({
          ...r,
          requestedAt: new Date(r.requestedAt),
          approvedAt: r.approvedAt ? new Date(r.approvedAt) : undefined
        })),
        whitelist: parsed.whitelist || [],
        blacklist: parsed.blacklist || [],
        history: (parsed.history || []).map((h: any) => ({
          ...h,
          requestedAt: new Date(h.requestedAt),
          approvedAt: h.approvedAt ? new Date(h.approvedAt) : undefined
        }))
      };
    } catch {
      this.store = {
        config: this.store.config,
        rules: [],
        requests: [],
        whitelist: [],
        blacklist: [],
        history: []
      };
    }
  }

  private async saveStore(): Promise<void> {
    try {
      const dir = path.dirname(this.storePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(this.storePath, JSON.stringify(this.store, null, 2));
    } catch (e) {
      console.error('[SecurityApproval] Failed to save store:', e);
    }
  }

  private initializeDefaultRules(): void {
    if (this.store.rules.length === 0) {
      const defaultRules: ApprovalRule[] = [
        {
          id: 'rule_delete_system',
          name: 'Block system file deletion',
          pattern: 'rm\\s+-rf\\s+/(|etc|var|usr)',
          riskLevel: 'critical',
          action: 'deny',
          enabled: true,
          priority: 100,
          createdAt: new Date()
        },
        {
          id: 'rule_network_change',
          name: 'Network configuration changes',
          pattern: '(iptables|ipfw|netsh)\\s+',
          riskLevel: 'high',
          action: 'require_approval',
          enabled: true,
          priority: 80,
          createdAt: new Date()
        },
        {
          id: 'rule_file_write',
          name: 'Write to sensitive directories',
          pattern: '(>|>>)\\s*(/etc/|/root/|/var/)',
          riskLevel: 'medium',
          action: 'require_approval',
          enabled: true,
          priority: 60,
          createdAt: new Date()
        },
        {
          id: 'rule_git_push',
          name: 'Git push operations',
          pattern: 'git\\s+push',
          riskLevel: 'low',
          action: 'allow',
          enabled: true,
          priority: 40,
          createdAt: new Date()
        },
        {
          id: 'rule_package_install',
          name: 'Package installation',
          pattern: '(npm|pip|yarn|apt-get|yum|brew)\\s+(install|add)',
          riskLevel: 'medium',
          action: 'require_approval',
          enabled: true,
          priority: 50,
          createdAt: new Date()
        }
      ];

      this.store.rules = defaultRules;

      this.store.whitelist = [
        'git status',
        'git log',
        'ls',
        'pwd',
        'echo',
        'cat',
        'head',
        'tail',
        'grep',
        'find'
      ];

      this.store.blacklist = [
        'rm -rf /',
        ':(){:|:&};:',
        'mkfs',
        'dd if='
      ];

      this.saveStore();
    }
  }

  async updateConfig(updates: Partial<SecurityConfig>): Promise<SecurityConfig> {
    this.store.config = { ...this.store.config, ...updates };
    await this.saveStore();
    this.emit('config:updated', this.store.config);
    return this.store.config;
  }

  getConfig(): SecurityConfig {
    return { ...this.store.config };
  }

  assessRisk(command: string, args?: Record<string, any>): {
    riskLevel: RiskLevel;
    riskFactors: string[];
    matchedRules: ApprovalRule[];
  } {
    const riskFactors: string[] = [];
    const matchedRules: ApprovalRule[] = [];

    for (const rule of this.store.rules) {
      if (!rule.enabled) continue;

      try {
        const regex = new RegExp(rule.pattern, 'i');
        if (regex.test(command)) {
          matchedRules.push(rule);
          riskFactors.push(rule.name);
        }
      } catch {}
    }

    if (this.store.blacklist.some(pattern => command.includes(pattern))) {
      riskFactors.push('Blacklisted command');
      matchedRules.push({
        id: 'blacklist',
        name: 'Blacklisted',
        pattern: '',
        riskLevel: 'critical',
        action: 'deny',
        enabled: true,
        priority: 200,
        createdAt: new Date()
      });
    }

    const whitelisted = this.store.whitelist.some(pattern => {
      try {
        const regex = new RegExp(pattern, 'i');
        return regex.test(command);
      } catch {
        return command.includes(pattern);
      }
    });

    if (whitelisted && matchedRules.length === 0) {
      return {
        riskLevel: 'low',
        riskFactors: ['Whitelisted command'],
        matchedRules: []
      };
    }

    const criticalMatches = matchedRules.filter(r => r.riskLevel === 'critical');
    if (criticalMatches.length > 0) {
      return { riskLevel: 'critical', riskFactors, matchedRules };
    }

    const highMatches = matchedRules.filter(r => r.riskLevel === 'high');
    if (highMatches.length > 0) {
      return { riskLevel: 'high', riskFactors, matchedRules };
    }

    const mediumMatches = matchedRules.filter(r => r.riskLevel === 'medium');
    if (mediumMatches.length > 0) {
      return { riskLevel: 'medium', riskFactors, matchedRules };
    }

    if (command.includes('sudo') || command.includes('chmod 777') || command.includes('curl | sh')) {
      return {
        riskLevel: 'high',
        riskFactors: [...riskFactors, 'Privileged execution detected'],
        matchedRules
      };
    }

    return {
      riskLevel: matchedRules.length > 0 ? 'medium' : 'low',
      riskFactors,
      matchedRules
    };
  }

  async requestApproval(request: {
    command: string;
    args?: Record<string, any>;
    requestedBy: string;
    metadata?: Record<string, any>;
  }): Promise<ApprovalRequest> {
    const assessment = this.assessRisk(request.command, request.args);

    let status: ApprovalStatus;

    if (this.store.config.approvalMode === 'none') {
      status = 'auto_approved';
    } else if (this.store.config.approvalMode === 'all') {
      status = 'pending';
    } else if (assessment.riskLevel === 'critical' && this.store.config.autoRejectCriticalRisk) {
      status = 'auto_rejected';
    } else if (assessment.riskLevel === 'low' && this.store.config.autoApproveLowRisk) {
      status = 'auto_approved';
    } else if (assessment.riskLevel === 'high' || assessment.riskLevel === 'critical') {
      status = 'pending';
    } else {
      status = 'auto_approved';
    }

    const approvalRequest: ApprovalRequest = {
      id: `approval_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      command: request.command,
      args: request.args,
      riskLevel: assessment.riskLevel,
      riskFactors: assessment.riskFactors,
      requestedBy: request.requestedBy,
      requestedAt: new Date(),
      status,
      metadata: request.metadata
    };

    if (status !== 'pending') {
      approvalRequest.approvedAt = new Date();
      approvalRequest.approvedBy = 'system';
      approvalRequest.reason = status === 'auto_approved'
        ? 'Auto-approved based on config'
        : 'Auto-rejected due to critical risk';
    }

    this.store.requests.push(approvalRequest);
    this.store.history.push(approvalRequest);

    if (this.store.requests.length > 1000) {
      this.store.requests = this.store.requests.slice(-500);
    }
    if (this.store.history.length > 5000) {
      this.store.history = this.store.history.slice(-2000);
    }

    await this.saveStore();
    this.emit('request:created', approvalRequest);

    return approvalRequest;
  }

  async approveRequest(requestId: string, approvedBy: string, reason?: string): Promise<boolean> {
    const request = this.store.requests.find(r => r.id === requestId);
    if (!request || request.status !== 'pending') return false;

    request.status = 'approved';
    request.approvedBy = approvedBy;
    request.approvedAt = new Date();
    request.reason = reason;

    const historyIndex = this.store.history.findIndex(r => r.id === requestId);
    if (historyIndex >= 0) {
      this.store.history[historyIndex] = request;
    }

    await this.saveStore();
    this.emit('request:approved', request);

    return true;
  }

  async rejectRequest(requestId: string, rejectedBy: string, reason?: string): Promise<boolean> {
    const request = this.store.requests.find(r => r.id === requestId);
    if (!request || request.status !== 'pending') return false;

    request.status = 'rejected';
    request.approvedBy = rejectedBy;
    request.approvedAt = new Date();
    request.reason = reason;

    const historyIndex = this.store.history.findIndex(r => r.id === requestId);
    if (historyIndex >= 0) {
      this.store.history[historyIndex] = request;
    }

    await this.saveStore();
    this.emit('request:rejected', request);

    return true;
  }

  getPendingRequests(): ApprovalRequest[] {
    return this.store.requests.filter(r => r.status === 'pending');
  }

  getRequest(requestId: string): ApprovalRequest | undefined {
    return this.store.requests.find(r => r.id === requestId);
  }

  getRequestsByUser(userId: string): ApprovalRequest[] {
    return this.store.requests.filter(r => r.requestedBy === userId);
  }

  async addRule(rule: Omit<ApprovalRule, 'id' | 'createdAt'>): Promise<ApprovalRule> {
    const newRule: ApprovalRule = {
      ...rule,
      id: `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      createdAt: new Date()
    };

    this.store.rules.push(newRule);
    await this.saveStore();
    this.emit('rule:added', newRule);

    return newRule;
  }

  async updateRule(ruleId: string, updates: Partial<ApprovalRule>): Promise<ApprovalRule | null> {
    const rule = this.store.rules.find(r => r.id === ruleId);
    if (!rule) return null;

    Object.assign(rule, updates);
    await this.saveStore();
    this.emit('rule:updated', rule);

    return rule;
  }

  async deleteRule(ruleId: string): Promise<boolean> {
    const index = this.store.rules.findIndex(r => r.id === ruleId);
    if (index < 0) return false;

    this.store.rules.splice(index, 1);
    await this.saveStore();
    return true;
  }

  getRules(): ApprovalRule[] {
    return [...this.store.rules].sort((a, b) => b.priority - a.priority);
  }

  async addToWhitelist(pattern: string): Promise<void> {
    if (!this.store.whitelist.includes(pattern)) {
      this.store.whitelist.push(pattern);
      await this.saveStore();
    }
  }

  async removeFromWhitelist(pattern: string): Promise<boolean> {
    const index = this.store.whitelist.indexOf(pattern);
    if (index >= 0) {
      this.store.whitelist.splice(index, 1);
      await this.saveStore();
      return true;
    }
    return false;
  }

  getWhitelist(): string[] {
    return [...this.store.whitelist];
  }

  async addToBlacklist(pattern: string): Promise<void> {
    if (!this.store.blacklist.includes(pattern)) {
      this.store.blacklist.push(pattern);
      await this.saveStore();
    }
  }

  async removeFromBlacklist(pattern: string): Promise<boolean> {
    const index = this.store.blacklist.indexOf(pattern);
    if (index >= 0) {
      this.store.blacklist.splice(index, 1);
      await this.saveStore();
      return true;
    }
    return false;
  }

  getBlacklist(): string[] {
    return [...this.store.blacklist];
  }

  getHistory(options: {
    status?: ApprovalStatus;
    riskLevel?: RiskLevel;
    since?: Date;
    limit?: number;
  } = {}): ApprovalRequest[] {
    let history = [...this.store.history];

    if (options.status) {
      history = history.filter(r => r.status === options.status);
    }
    if (options.riskLevel) {
      history = history.filter(r => r.riskLevel === options.riskLevel);
    }
    if (options.since) {
      history = history.filter(r => r.requestedAt >= options.since!);
    }

    return history
      .sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime())
      .slice(0, options.limit || 100);
  }

  getStats(): {
    totalRequests: number;
    pendingRequests: number;
    approvedRequests: number;
    rejectedRequests: number;
    autoApprovedRequests: number;
    autoRejectedRequests: number;
    byRiskLevel: Record<RiskLevel, number>;
  } {
    const byRiskLevel: Record<RiskLevel, number> = {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0
    };

    for (const request of this.store.history) {
      byRiskLevel[request.riskLevel]++;
    }

    return {
      totalRequests: this.store.history.length,
      pendingRequests: this.store.requests.filter(r => r.status === 'pending').length,
      approvedRequests: this.store.history.filter(r => r.status === 'approved').length,
      rejectedRequests: this.store.history.filter(r => r.status === 'rejected').length,
      autoApprovedRequests: this.store.history.filter(r => r.status === 'auto_approved').length,
      autoRejectedRequests: this.store.history.filter(r => r.status === 'auto_rejected').length,
      byRiskLevel
    };
  }
}

export const securityApprovalSystem = SecurityApprovalSystem.getInstance();