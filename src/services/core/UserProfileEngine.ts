import fs from 'fs';
import path from 'path';

export interface UserPreference {
  category: string;
  value: string;
  count: number;
  lastUsed: Date;
  confidence: number;
}

export interface SkillPreference {
  skillId: string;
  skillName: string;
  executionCount: number;
  successCount: number;
  avgDurationMs: number;
  lastUsed: Date;
  preferredArgs: Record<string, any>;
  successRate: number;
}

export interface UserProfile {
  userId: string;
  createdAt: Date;
  updatedAt: Date;
  skillPreferences: Record<string, SkillPreference>;
  categoryPreferences: Record<string, UserPreference[]>;
  interactionHistory: InteractionRecord[];
  learnedPatterns: LearnedPattern[];
  preferredOutputFormats: string[];
  preferredLanguage: string;
  timezone: string;
}

export interface InteractionRecord {
  id: string;
  timestamp: Date;
  skillId: string;
  skillName: string;
  inputLength: number;
  outputLength: number;
  success: boolean;
  durationMs: number;
  feedback?: number;
}

export interface LearnedPattern {
  id: string;
  pattern: string;
  skillId: string;
  occurrences: number;
  avgSuccess: number;
  context: string[];
}

interface UserProfileStore {
  profiles: Record<string, UserProfile>;
}

const DATA_DIR = path.join(process.cwd(), 'data', 'user-profiles');

class UserProfileEngine {
  private static instance: UserProfileEngine;
  private store: UserProfileStore = { profiles: {} };
  private initialized = false;

  private constructor() {}

  static getInstance(): UserProfileEngine {
    if (!UserProfileEngine.instance) {
      UserProfileEngine.instance = new UserProfileEngine();
    }
    return UserProfileEngine.instance;
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    this.loadStore();
    this.initialized = true;
    console.log('[UserProfile] Initialized with', Object.keys(this.store.profiles).length, 'profiles');
  }

  private getStorePath(): string {
    return path.join(DATA_DIR, 'profiles.json');
  }

  private loadStore(): void {
    try {
      const filePath = this.getStorePath();
      if (fs.existsSync(filePath)) {
        const data = fs.readFileSync(filePath, 'utf-8');
        this.store = JSON.parse(data);
        for (const userId in this.store.profiles) {
          const profile = this.store.profiles[userId];
          profile.createdAt = new Date(profile.createdAt);
          profile.updatedAt = new Date(profile.updatedAt);
          for (const skillId in profile.skillPreferences) {
            profile.skillPreferences[skillId].lastUsed = new Date(
              profile.skillPreferences[skillId].lastUsed
            );
          }
          profile.interactionHistory = profile.interactionHistory.map((r: any) => ({
            ...r,
            timestamp: new Date(r.timestamp)
          }));
        }
      }
    } catch (error) {
      console.error('[UserProfile] Failed to load store:', error);
      this.store = { profiles: {} };
    }
  }

  private async saveStore(): Promise<void> {
    try {
      const filePath = this.getStorePath();
      fs.writeFileSync(filePath, JSON.stringify(this.store, null, 2));
    } catch (error) {
      console.error('[UserProfile] Failed to save store:', error);
    }
  }

  private getOrCreateProfile(userId: string): UserProfile {
    if (!this.store.profiles[userId]) {
      this.store.profiles[userId] = {
        userId,
        createdAt: new Date(),
        updatedAt: new Date(),
        skillPreferences: {},
        categoryPreferences: {},
        interactionHistory: [],
        learnedPatterns: [],
        preferredOutputFormats: ['markdown', 'pptx'],
        preferredLanguage: 'zh-CN',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
      };
    }
    return this.store.profiles[userId];
  }

  async recordInteraction(
    userId: string,
    interaction: Omit<InteractionRecord, 'id' | 'timestamp'>
  ): Promise<void> {
    await this.initialize();

    const profile = this.getOrCreateProfile(userId);
    const id = `int_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const record: InteractionRecord = {
      ...interaction,
      id,
      timestamp: new Date()
    };

    profile.interactionHistory.push(record);
    profile.updatedAt = new Date();

    if (profile.interactionHistory.length > 1000) {
      profile.interactionHistory = profile.interactionHistory.slice(-500);
    }

    this.updateSkillPreference(profile, interaction);
    this.updateCategoryPreference(profile, interaction);
    this.updateLearnedPatterns(profile, interaction);

    await this.saveStore();
  }

  private updateSkillPreference(
    profile: UserProfile,
    interaction: Omit<InteractionRecord, 'id' | 'timestamp'>
  ): void {
    const { skillId, skillName, success, durationMs } = interaction;

    if (!profile.skillPreferences[skillId]) {
      profile.skillPreferences[skillId] = {
        skillId,
        skillName,
        executionCount: 0,
        successCount: 0,
        avgDurationMs: 0,
        lastUsed: new Date(),
        preferredArgs: {},
        successRate: 1.0
      };
    }

    const pref = profile.skillPreferences[skillId];
    pref.executionCount++;
    pref.lastUsed = new Date();

    if (success) {
      pref.successCount++;
    }

    pref.successRate = pref.successCount / pref.executionCount;
    pref.avgDurationMs =
      (pref.avgDurationMs * (pref.executionCount - 1) + durationMs) / pref.executionCount;
  }

  private updateCategoryPreference(
    profile: UserProfile,
    interaction: Omit<InteractionRecord, 'id' | 'timestamp'>
  ): void {
    const skillId = interaction.skillId;
    const category = this.extractCategory(skillId);

    if (!profile.categoryPreferences[category]) {
      profile.categoryPreferences[category] = [];
    }

    const prefs = profile.categoryPreferences[category];
    const existing = prefs.find((p) => p.category === category);

    if (existing) {
      existing.count++;
      existing.lastUsed = new Date();
      existing.confidence = Math.min(1.0, existing.count / 10);
    } else {
      prefs.push({
        category,
        value: category,
        count: 1,
        lastUsed: new Date(),
        confidence: 0.1
      });
    }
  }

  private extractCategory(skillId: string): string {
    const parts = skillId.split('_');
    return parts[0] || 'general';
  }

  private updateLearnedPatterns(
    profile: UserProfile,
    interaction: Omit<InteractionRecord, 'id' | 'timestamp'>
  ): void {
    const inputLength = interaction.inputLength;

    if (inputLength < 10) return;

    let pattern = 'short_input';
    if (inputLength > 100) pattern = 'long_input';
    else if (inputLength > 50) pattern = 'medium_input';

    const existing = profile.learnedPatterns.find(
      (p) => p.pattern === pattern && p.skillId === interaction.skillId
    );

    if (existing) {
      existing.occurrences++;
      existing.avgSuccess = (existing.avgSuccess * (existing.occurrences - 1) +
        (interaction.success ? 1 : 0)) / existing.occurrences;
      if (!existing.context.includes(pattern)) {
        existing.context.push(pattern);
      }
    } else {
      profile.learnedPatterns.push({
        id: `pattern_${Date.now()}`,
        pattern,
        skillId: interaction.skillId,
        occurrences: 1,
        avgSuccess: interaction.success ? 1 : 0,
        context: [pattern]
      });
    }

    if (profile.learnedPatterns.length > 100) {
      profile.learnedPatterns = profile.learnedPatterns.slice(-50);
    }
  }

  async getProfile(userId: string): Promise<UserProfile | null> {
    await this.initialize();
    return this.store.profiles[userId] || null;
  }

  async getTopSkills(
    userId: string,
    limit = 5
  ): Promise<Array<{ skillId: string; score: number }>> {
    await this.initialize();

    const profile = this.store.profiles[userId];
    if (!profile) return [];

    return Object.values(profile.skillPreferences)
      .map((pref) => ({
        skillId: pref.skillId,
        score: pref.executionCount * pref.successRate * 0.8 + pref.executionCount * 0.2
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  async getSkillRecommendations(
    userId: string,
    context: { inputLength?: number; category?: string },
    availableSkills: Array<{ id: string; name: string; category?: string }>
  ): Promise<Array<{ skill: any; score: number; reason: string }>> {
    await this.initialize();

    const profile = this.store.profiles[userId];
    if (!profile) {
      return availableSkills.map((skill) => ({
        skill,
        score: 1.0,
        reason: '新用户，默认推荐'
      }));
    }

    const recommendations: Array<{ skill: any; score: number; reason: string }> = [];

    for (const skill of availableSkills) {
      let score = 0.5;
      let reason = '';

      const pref = profile.skillPreferences[skill.id];
      if (pref) {
        score += pref.successRate * 0.3 + (pref.executionCount / 50) * 0.2;
        reason = `使用${pref.executionCount}次，成功率${(pref.successRate * 100).toFixed(0)}%`;
      }

      if (context.category && skill.category === context.category) {
        score += 0.2;
        reason += ', 类别匹配';
      }

      const patterns = profile.learnedPatterns.filter((p) => p.skillId === skill.id);
      if (patterns.length > 0) {
        const avgPatternSuccess = patterns.reduce((sum, p) => sum + p.avgSuccess, 0) / patterns.length;
        score += avgPatternSuccess * 0.2;
        reason += `, 模式匹配`;
      }

      recommendations.push({ skill, score: Math.min(1.0, score), reason: reason || '通用推荐' });
    }

    return recommendations.sort((a, b) => b.score - a.score);
  }

  async getStats(): Promise<{
    totalUsers: number;
    totalInteractions: number;
    topSkills: Array<{ skillId: string; count: number }>;
    avgSuccessRate: number;
  }> {
    await this.initialize();

    const profiles = Object.values(this.store.profiles);
    const totalInteractions = profiles.reduce(
      (sum, p) => sum + p.interactionHistory.length,
      0
    );

    const skillCounts: Record<string, number> = {};
    let totalSuccess = 0;
    let totalExecutions = 0;

    for (const profile of profiles) {
      for (const interaction of profile.interactionHistory) {
        skillCounts[interaction.skillId] = (skillCounts[interaction.skillId] || 0) + 1;
        totalExecutions++;
        if (interaction.success) totalSuccess++;
      }
    }

    const topSkills = Object.entries(skillCounts)
      .map(([skillId, count]) => ({ skillId, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return {
      totalUsers: profiles.length,
      totalInteractions,
      topSkills,
      avgSuccessRate: totalExecutions > 0 ? totalSuccess / totalExecutions : 0
    };
  }

  async resetProfile(userId: string): Promise<void> {
    await this.initialize();
    delete this.store.profiles[userId];
    await this.saveStore();
  }
}

export const userProfileEngine = UserProfileEngine.getInstance();
