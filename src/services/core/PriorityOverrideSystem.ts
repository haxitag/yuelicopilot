/**
 * Priority Override System - 优先级覆盖系统
 * 支持YAML配置和运行时动态覆盖
 * Hermes最佳实践：支持多层级优先级覆盖
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface PriorityConfig {
  skills?: Record<string, number>;
  tasks?: Record<string, number>;
  agents?: Record<string, number>;
  global?: number;
}

export interface PriorityOverride {
  id: string;
  targetType: 'skill' | 'task' | 'agent' | 'global';
  targetId: string;
  priority: number;
  reason?: string;
  source: 'yaml' | 'runtime' | 'user' | 'system';
  expiresAt?: Date;
  createdAt: Date;
  active: boolean;
}

export interface PriorityContext {
  userId?: string;
  sessionId?: string;
  platform?: string;
  timeOfDay?: 'morning' | 'afternoon' | 'evening' | 'night';
  dayOfWeek?: number;
}

interface PriorityStore {
  yamlConfig: PriorityConfig;
  runtimeOverrides: PriorityOverride[];
  history: PriorityOverride[];
  lastUpdated: Date;
}

class PriorityOverrideSystem {
  private static instance: PriorityOverrideSystem;
  private storePath: string;
  private store: PriorityStore = {
    yamlConfig: {},
    runtimeOverrides: [],
    history: [],
    lastUpdated: new Date()
  };
  private defaultPriorities: Record<string, number> = {
    skill: 50,
    task: 50,
    agent: 50,
    global: 50
  };

  private constructor() {
    this.storePath = path.join(__dirname, '../../../data/priority_config.json');
    this.loadStore();
  }

  static getInstance(): PriorityOverrideSystem {
    if (!PriorityOverrideSystem.instance) {
      PriorityOverrideSystem.instance = new PriorityOverrideSystem();
    }
    return PriorityOverrideSystem.instance;
  }

  private async loadStore(): Promise<void> {
    try {
      const dir = path.dirname(this.storePath);
      await fs.mkdir(dir, { recursive: true });
      const data = await fs.readFile(this.storePath, 'utf-8');
      this.store = JSON.parse(data);
      this.store.lastUpdated = new Date(this.store.lastUpdated);
      for (const override of this.store.runtimeOverrides) {
        override.createdAt = new Date(override.createdAt);
        if (override.expiresAt) {
          override.expiresAt = new Date(override.expiresAt);
        }
      }
      for (const override of this.store.history) {
        override.createdAt = new Date(override.createdAt);
        if (override.expiresAt) {
          override.expiresAt = new Date(override.expiresAt);
        }
      }
    } catch {
      this.store = {
        yamlConfig: {},
        runtimeOverrides: [],
        history: [],
        lastUpdated: new Date()
      };
    }
  }

  private async saveStore(): Promise<void> {
    try {
      const dir = path.dirname(this.storePath);
      await fs.mkdir(dir, { recursive: true });
      this.store.lastUpdated = new Date();
      await fs.writeFile(this.storePath, JSON.stringify(this.store, null, 2));
    } catch (e) {
      console.error('[PriorityOverrideSystem] Failed to save store:', e);
    }
  }

  async loadYamlConfig(yamlPath: string): Promise<void> {
    try {
      const content = await fs.readFile(yamlPath, 'utf-8');
      const config = this.parseYamlConfig(content);
      this.store.yamlConfig = config;
      await this.saveStore();
    } catch (e) {
      console.error('[PriorityOverrideSystem] Failed to load YAML config:', e);
      throw e;
    }
  }

  private parseYamlConfig(content: string): PriorityConfig {
    const config: PriorityConfig = { skills: {}, tasks: {}, agents: {}, global: 50 };
    const lines = content.split('\n');
    
    let currentSection: 'skills' | 'tasks' | 'agents' | 'global' | null = null;
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      if (trimmed === 'skills:' || trimmed === 'skills') {
        currentSection = 'skills';
        continue;
      }
      if (trimmed === 'tasks:' || trimmed === 'tasks') {
        currentSection = 'tasks';
        continue;
      }
      if (trimmed === 'agents:' || trimmed === 'agents') {
        currentSection = 'agents';
        continue;
      }
      if (trimmed === 'global:' || trimmed === 'global') {
        currentSection = 'global';
        continue;
      }
      
      if (trimmed.startsWith('#') || trimmed === '') {
        continue;
      }
      
      const colonIndex = trimmed.indexOf(':');
      if (colonIndex > 0 && currentSection) {
        const key = trimmed.substring(0, colonIndex).trim();
        const valueStr = trimmed.substring(colonIndex + 1).trim();
        const value = parseInt(valueStr, 10);
        
        if (currentSection === 'global') {
          config.global = isNaN(value) ? 50 : Math.max(0, Math.min(100, value));
        } else {
          if (!config[currentSection]) {
            config[currentSection] = {};
          }
          config[currentSection]![key] = isNaN(value) ? 50 : Math.max(0, Math.min(100, value));
        }
      }
    }
    
    return config;
  }

  getPriority(
    type: 'skill' | 'task' | 'agent' | 'global',
    id: string,
    context?: PriorityContext
  ): number {
    const activeOverrides = this.store.runtimeOverrides.filter(
      o => o.active && o.targetType === type && o.targetId === id &&
           (!o.expiresAt || o.expiresAt > new Date())
    );
    
    if (activeOverrides.length > 0) {
      const runtimePriority = activeOverrides[0].priority;
      const yamlPriority = this.getYamlPriority(type, id);
      return Math.max(runtimePriority, yamlPriority ?? runtimePriority);
    }
    
    const yamlPriority = this.getYamlPriority(type, id);
    if (yamlPriority !== undefined) {
      return yamlPriority;
    }
    
    const contextBonus = this.getContextBonus(context);
    return this.defaultPriorities[type] + contextBonus;
  }

  private getYamlPriority(type: 'skill' | 'task' | 'agent' | 'global', id: string): number | undefined {
    if (type === 'global') {
      return this.store.yamlConfig.global;
    }
    const pluralMap: Record<string, keyof PriorityConfig> = {
      skill: 'skills',
      task: 'tasks',
      agent: 'agents'
    };
    const pluralType = pluralMap[type];
    const typeConfig = this.store.yamlConfig[pluralType] as Record<string, number> | undefined;
    return typeConfig?.[id];
  }

  private getContextBonus(context?: PriorityContext): number {
    if (!context) return 0;
    
    let bonus = 0;
    
    if (context.timeOfDay === 'morning' || context.timeOfDay === 'afternoon') {
      bonus += 5;
    }
    
    if (context.dayOfWeek === 0 || context.dayOfWeek === 6) {
      bonus -= 10;
    }
    
    return bonus;
  }

  async setOverride(
    targetType: 'skill' | 'task' | 'agent' | 'global',
    targetId: string,
    priority: number,
    options?: {
      reason?: string;
      source?: 'runtime' | 'user';
      expiresAt?: Date;
    }
  ): Promise<PriorityOverride> {
    const existingIndex = this.store.runtimeOverrides.findIndex(
      o => o.targetType === targetType && o.targetId === targetId && o.active
    );
    
    if (existingIndex >= 0) {
      const old = this.store.runtimeOverrides[existingIndex];
      this.store.history.push({ ...old });
      this.store.runtimeOverrides.splice(existingIndex, 1);
    }
    
    const override: PriorityOverride = {
      id: `override_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      targetType,
      targetId,
      priority: Math.max(0, Math.min(100, priority)),
      reason: options?.reason,
      source: options?.source || 'runtime',
      expiresAt: options?.expiresAt,
      createdAt: new Date(),
      active: true
    };
    
    this.store.runtimeOverrides.push(override);
    await this.saveStore();
    
    return override;
  }

  async removeOverride(overrideId: string): Promise<boolean> {
    const index = this.store.runtimeOverrides.findIndex(o => o.id === overrideId);
    if (index >= 0) {
      const removed = this.store.runtimeOverrides.splice(index, 1)[0];
      removed.active = false;
      this.store.history.push(removed);
      await this.saveStore();
      return true;
    }
    return false;
  }

  getActiveOverrides(): PriorityOverride[] {
    return this.store.runtimeOverrides.filter(
      o => o.active && (!o.expiresAt || o.expiresAt > new Date())
    );
  }

  getOverrideHistory(limit = 50): PriorityOverride[] {
    return this.store.history.slice(-limit).reverse();
  }

  async updateYamlConfig(config: PriorityConfig): Promise<void> {
    this.store.yamlConfig = config;
    await this.saveStore();
  }

  getYamlConfig(): PriorityConfig {
    return { ...this.store.yamlConfig };
  }

  async exportConfig(): Promise<string> {
    const lines: string[] = [
      '# Priority Configuration',
      `# Last Updated: ${this.store.lastUpdated.toISOString()}`,
      '',
      'global: ' + (this.store.yamlConfig.global || 50),
      '',
      'skills:'
    ];
    
    if (this.store.yamlConfig.skills) {
      for (const [id, priority] of Object.entries(this.store.yamlConfig.skills)) {
        lines.push(`  ${id}: ${priority}`);
      }
    }
    
    lines.push('', 'tasks:');
    if (this.store.yamlConfig.tasks) {
      for (const [id, priority] of Object.entries(this.store.yamlConfig.tasks)) {
        lines.push(`  ${id}: ${priority}`);
      }
    }
    
    lines.push('', 'agents:');
    if (this.store.yamlConfig.agents) {
      for (const [id, priority] of Object.entries(this.store.yamlConfig.agents)) {
        lines.push(`  ${id}: ${priority}`);
      }
    }
    
    return lines.join('\n');
  }
}

export const priorityOverrideSystem = PriorityOverrideSystem.getInstance();