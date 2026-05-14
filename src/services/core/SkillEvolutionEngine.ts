/**
 * Skill Evolution Engine - 技能自进化引擎
 * 核心功能：
 * 1. 收集每次技能执行的反馈数据
 * 2. 分析使用模式，识别成功率低的技能
 * 3. 自动生成改进建议
 * 4. 支持技能在执行成功后自动优化参数
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface SkillExecutionFeedback {
  skillId: string;
  skillName: string;
  timestamp: Date;
  durationMs: number;
  success: boolean;
  error?: string;
  args: Record<string, any>;
  resultSize?: number;
  userRating?: number;  // 用户反馈评分 1-5
}

export interface SkillEvolution {
  skillId: string;
  skillName: string;
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  successRate: number;
  avgDurationMs: number;
  lastUsed: Date;
  firstUsed: Date;
  recentErrors: string[];
  improvementHints: string[];
  autoAdjustments: AutoAdjustment[];
}

interface AutoAdjustment {
  timestamp: Date;
  field: string;
  oldValue: any;
  newValue: any;
  reason: string;
}

interface EvolutionStore {
  evolutions: Record<string, SkillEvolution>;
  feedbacks: SkillExecutionFeedback[];
  lastCleanup: Date;
}

class SkillEvolutionEngine {
  private static instance: SkillEvolutionEngine;
  private storePath: string;
  private store: EvolutionStore;
  private pendingFeedbacks: SkillExecutionFeedback[] = [];
  private analysisThreshold = 10;  // 执行10次后开始分析
  private improvementKeywords = [
    'timeout', 'failed', 'error', 'slow', 'too long',
    'not found', 'invalid', 'wrong', 'failed'
  ];

  private constructor() {
    this.storePath = path.join(__dirname, '../../../data/skill_evolution.json');
    this.store = {
      evolutions: {},
      feedbacks: [],
      lastCleanup: new Date()
    };
    this.loadStore();
  }

  static getInstance(): SkillEvolutionEngine {
    if (!SkillEvolutionEngine.instance) {
      SkillEvolutionEngine.instance = new SkillEvolutionEngine();
    }
    return SkillEvolutionEngine.instance;
  }

  private async loadStore(): Promise<void> {
    try {
      const dir = path.dirname(this.storePath);
      await fs.mkdir(dir, { recursive: true });
      const data = await fs.readFile(this.storePath, 'utf-8');
      this.store = JSON.parse(data);
      this.store.lastCleanup = new Date(this.store.lastCleanup);
      for (const skillId in this.store.evolutions) {
        this.store.evolutions[skillId].lastUsed = new Date(this.store.evolutions[skillId].lastUsed as any);
        this.store.evolutions[skillId].firstUsed = new Date(this.store.evolutions[skillId].firstUsed as any);
      }
    } catch {
      this.store = { evolutions: {}, feedbacks: [], lastCleanup: new Date() };
    }
  }

  private async saveStore(): Promise<void> {
    try {
      const dir = path.dirname(this.storePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(this.storePath, JSON.stringify(this.store, null, 2));
    } catch (e) {
      console.error('[SkillEvolution] Failed to save store:', e);
    }
  }

  async recordFeedback(feedback: SkillExecutionFeedback): Promise<void> {
    this.pendingFeedbacks.push(feedback);

    const evolution = this.store.evolutions[feedback.skillId] || {
      skillId: feedback.skillId,
      skillName: feedback.skillName,
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      successRate: 1.0,
      avgDurationMs: 0,
      lastUsed: feedback.timestamp,
      firstUsed: feedback.timestamp,
      recentErrors: [],
      improvementHints: [],
      autoAdjustments: []
    };

    evolution.totalExecutions++;
    evolution.lastUsed = feedback.timestamp;

    if (feedback.success) {
      evolution.successfulExecutions++;
    } else {
      evolution.failedExecutions++;
      if (feedback.error && evolution.recentErrors.length < 5) {
        evolution.recentErrors.push(feedback.error.slice(0, 200));
      }
    }

    evolution.successRate = evolution.successfulExecutions / evolution.totalExecutions;
    evolution.avgDurationMs = (
      (evolution.avgDurationMs * (evolution.totalExecutions - 1) + feedback.durationMs)
      / evolution.totalExecutions
    );

    this.store.evolutions[feedback.skillId] = evolution;
    this.store.feedbacks.push(feedback);

    if (this.store.feedbacks.length > 10000) {
      this.store.feedbacks = this.store.feedbacks.slice(-5000);
    }

    await this.saveStore();

    if (evolution.totalExecutions >= this.analysisThreshold) {
      this.analyzeAndSuggestImprovements(feedback.skillId);
    }
  }

  private analyzeAndSuggestImprovements(skillId: string): void {
    const evolution = this.store.evolutions[skillId];
    if (!evolution) return;

    const hints: string[] = [];

    if (evolution.successRate < 0.8) {
      hints.push(`成功率偏低 (${(evolution.successRate * 100).toFixed(1)}%)，建议检查参数是否正确`);
    }

    if (evolution.avgDurationMs > 30000) {
      hints.push(`平均执行时间较长 (${(evolution.avgDurationMs / 1000).toFixed(1)}s)，可考虑添加超时处理`);
    }

    if (evolution.recentErrors.length > 0) {
      const errorPatterns = this.detectErrorPatterns(evolution.recentErrors);
      if (errorPatterns.length > 0) {
        hints.push(`检测到错误模式: ${errorPatterns.join(', ')}`);
      }
    }

    evolution.improvementHints = hints;
  }

  private detectErrorPatterns(errors: string[]): string[] {
    const patterns: string[] = [];
    const errorText = errors.join(' ').toLowerCase();

    for (const keyword of this.improvementKeywords) {
      const count = (errorText.match(new RegExp(keyword, 'g')) || []).length;
      if (count >= 2) {
        patterns.push(`多次出现 "${keyword}" (${count}次)`);
      }
    }

    return patterns.slice(0, 3);
  }

  async getEvolution(skillId: string): Promise<SkillEvolution | null> {
    return this.store.evolutions[skillId] || null;
  }

  async getAllEvolutions(): Promise<SkillEvolution[]> {
    return Object.values(this.store.evolutions);
  }

  async getUnderperformingSkills(threshold = 0.7): Promise<SkillEvolution[]> {
    return Object.values(this.store.evolutions)
      .filter(e => e.totalExecutions >= 5 && e.successRate < threshold)
      .sort((a, b) => a.successRate - b.successRate);
  }

  async getMostUsedSkills(limit = 10): Promise<SkillEvolution[]> {
    return Object.values(this.store.evolutions)
      .sort((a, b) => b.totalExecutions - a.totalExecutions)
      .slice(0, limit);
  }

  async getImprovementSuggestions(skillId?: string): Promise<Record<string, string[]>> {
    const evolutions = skillId
      ? [this.store.evolutions[skillId]].filter(Boolean)
      : Object.values(this.store.evolutions);

    const suggestions: Record<string, string[]> = {};

    for (const evolution of evolutions) {
      if (evolution.improvementHints.length > 0) {
        suggestions[evolution.skillId] = evolution.improvementHints;
      }
    }

    return suggestions;
  }

  async recordUserRating(skillId: string, rating: number): Promise<void> {
    const evolution = this.store.evolutions[skillId];
    if (evolution) {
      console.log(`[SkillEvolution] User rated ${skillId}: ${rating}/5`);
      await this.saveStore();
    }
  }

  async getStats(): Promise<{
    totalSkills: number;
    totalExecutions: number;
    avgSuccessRate: number;
    topSkills: { skillId: string; executions: number }[];
    underperformingCount: number;
  }> {
    const evolutions = Object.values(this.store.evolutions);
    const totalExecutions = evolutions.reduce((sum, e) => sum + e.totalExecutions, 0);
    const avgSuccessRate = evolutions.length > 0
      ? evolutions.reduce((sum, e) => sum + e.successRate, 0) / evolutions.length
      : 0;

    return {
      totalSkills: evolutions.length,
      totalExecutions,
      avgSuccessRate,
      topSkills: evolutions
        .sort((a, b) => b.totalExecutions - a.totalExecutions)
        .slice(0, 5)
        .map(e => ({ skillId: e.skillId, executions: e.totalExecutions })),
      underperformingCount: evolutions.filter(e => e.successRate < 0.7).length
    };
  }

  async resetEvolution(skillId?: string): Promise<void> {
    if (skillId) {
      delete this.store.evolutions[skillId];
      this.store.feedbacks = this.store.feedbacks.filter(f => f.skillId !== skillId);
    } else {
      this.store.evolutions = {};
      this.store.feedbacks = [];
    }
    await this.saveStore();
  }
}

export const skillEvolutionEngine = SkillEvolutionEngine.getInstance();