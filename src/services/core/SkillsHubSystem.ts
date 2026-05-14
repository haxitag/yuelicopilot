/**
 * Skills Hub System - Skills Hub集成系统
 * 基于Hermes-agent的Skills Hub设计（兼容agentskills.io标准）
 * 核心功能：
 * 1. Skills Hub浏览和安装
 * 2. agentskills.io标准兼容
 * 3. 技能自动创建
 * 4. 技能自改进
 * 5. 技能市场浏览
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';
import https from 'https';
import http from 'http';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type SkillSource = 'local' | 'hub' | 'created';
export type SkillStatus = 'active' | 'inactive' | 'updating' | 'error';

export interface Skill {
  id: string;
  name: string;
  description: string;
  version: string;
  author?: string;
  source: SkillSource;
  status: SkillStatus;
  installedAt?: Date;
  lastUsed?: Date;
  usageCount: number;
  successRate: number;
  avgDuration: number;
  tags: string[];
  config?: Record<string, any>;
  prompt?: string;
  tools?: string[];
  metadata?: Record<string, any>;
}

export interface SkillHubListing {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  downloads: number;
  rating: number;
  tags: string[];
  categories: string[];
  installed: boolean;
  verified: boolean;
}

export interface SkillTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  steps: TemplateStep[];
  estimatedTime?: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
}

export interface TemplateStep {
  action: string;
  tool?: string;
  description: string;
  expectedOutput?: string;
}

export interface HubConfig {
  hubUrl: string;
  autoUpdate: boolean;
  updateInterval: number;
  cacheEnabled: boolean;
  cacheDuration: number;
}

interface SkillsHubStore {
  skills: Skill[];
  templates: SkillTemplate[];
  installedHubSkills: string[];
  config: HubConfig;
  stats: {
    totalInstalls: number;
    totalCreates: number;
    totalUpdates: number;
  };
}

class SkillsHubSystem extends EventEmitter {
  private static instance: SkillsHubSystem;
  private storePath: string;
  private store: SkillsHubStore = {
    skills: [],
    templates: [],
    installedHubSkills: [],
    config: {
      hubUrl: 'https://skillshub.wtf/api/v1',
      autoUpdate: false,
      updateInterval: 86400000,
      cacheEnabled: true,
      cacheDuration: 3600000
    },
    stats: {
      totalInstalls: 0,
      totalCreates: 0,
      totalUpdates: 0
    }
  };

  private hubCache: Map<string, { data: any; timestamp: number }> = new Map();

  private constructor() {
    super();
    this.storePath = path.join(__dirname, '../../../data/skills_hub.json');
    this.loadStore();
    this.initializeDefaultSkills();
  }

  static getInstance(): SkillsHubSystem {
    if (!SkillsHubSystem.instance) {
      SkillsHubSystem.instance = new SkillsHubSystem();
    }
    return SkillsHubSystem.instance;
  }

  private async loadStore(): Promise<void> {
    try {
      const dir = path.dirname(this.storePath);
      await fs.mkdir(dir, { recursive: true });
      const data = await fs.readFile(this.storePath, 'utf-8');
      const parsed = JSON.parse(data);
      this.store = {
        skills: (parsed.skills || []).map((s: any) => ({
          ...s,
          installedAt: s.installedAt ? new Date(s.installedAt) : undefined,
          lastUsed: s.lastUsed ? new Date(s.lastUsed) : undefined
        })),
        templates: parsed.templates || [],
        installedHubSkills: parsed.installedHubSkills || [],
        config: { ...this.store.config, ...parsed.config },
        stats: { ...this.store.stats, ...parsed.stats }
      };
    } catch {}
  }

  private async saveStore(): Promise<void> {
    try {
      const dir = path.dirname(this.storePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(this.storePath, JSON.stringify(this.store, null, 2));
    } catch (e) {
      console.error('[SkillsHub] Failed to save store:', e);
    }
  }

  private initializeDefaultSkills(): void {
    if (this.store.skills.length === 0) {
      this.store.skills = [
        {
          id: 'skill_code_generator',
          name: 'Code Generator',
          description: 'Generate code snippets in various programming languages',
          version: '1.0.0',
          source: 'local',
          status: 'active',
          usageCount: 0,
          successRate: 0,
          avgDuration: 0,
          tags: ['coding', 'programming', 'development']
        },
        {
          id: 'skill_docs_writer',
          name: 'Documentation Writer',
          description: 'Generate documentation for code and projects',
          version: '1.0.0',
          source: 'local',
          status: 'active',
          usageCount: 0,
          successRate: 0,
          avgDuration: 0,
          tags: ['documentation', 'writing']
        },
        {
          id: 'skill_test_creator',
          name: 'Test Creator',
          description: 'Create unit tests and integration tests',
          version: '1.0.0',
          source: 'local',
          status: 'active',
          usageCount: 0,
          successRate: 0,
          avgDuration: 0,
          tags: ['testing', 'quality']
        }
      ];
      this.saveStore();
    }
  }

  async updateConfig(updates: Partial<HubConfig>): Promise<HubConfig> {
    this.store.config = { ...this.store.config, ...updates };
    await this.saveStore();
    this.emit('config:updated', this.store.config);
    return this.store.config;
  }

  getConfig(): HubConfig {
    return { ...this.store.config };
  }

  async browseHub(category?: string, search?: string): Promise<SkillHubListing[]> {
    const cacheKey = `hub_${category || 'all'}_${search || ''}`;
    const cached = this.hubCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.store.config.cacheDuration) {
      return cached.data;
    }

    const listings = await this.fetchHubListings(category, search);
    this.hubCache.set(cacheKey, { data: listings, timestamp: Date.now() });
    return listings;
  }

  /**
   * Hub 请求失败时不伪造列表：供 UI/调用方捕获错误或使用 skills.sh / GitHub 安装。
   */
  private hubUnavailableMessage(): string {
    return `[SkillsHub] 无法连接 Hub (${this.store.config.hubUrl})。请检查网络与 Hub 可用性，或通过 skills.sh / GitHub URL 安装技能。`;
  }

  private httpGet(urlString: string, timeoutMs = 8000): Promise<{ statusCode: number; body: string }> {
    return new Promise((resolve, reject) => {
      const url = new URL(urlString);
      const protocol = url.protocol === 'https:' ? https : http;
      const req = protocol.get(
        urlString,
        { timeout: timeoutMs, headers: { 'User-Agent': 'YueliCopilot/1.0' } },
        (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            resolve({ statusCode: res.statusCode || 0, body: data });
          });
        }
      );
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Skills Hub request timeout'));
      });
    });
  }

  /**
   * 获取热门技能列表
   */
  async getTrendingSkills(limit: number = 10): Promise<SkillHubListing[]> {
    const cacheKey = `trending_${limit}`;
    const cached = this.hubCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.store.config.cacheDuration) {
      return cached.data;
    }

    const url = new URL(this.store.config.hubUrl + '/skills/trending');
    url.searchParams.set('limit', String(Math.min(limit, 50)));

    const { statusCode, body } = await this.httpGet(url.toString());
    if (statusCode < 200 || statusCode >= 300) {
      throw new Error(`${this.hubUnavailableMessage()} HTTP ${statusCode}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch (e) {
      throw new Error(`${this.hubUnavailableMessage()} 响应非 JSON`);
    }
    const skills: SkillHubListing[] = (Array.isArray(parsed) ? parsed : []).map((s: any) => ({
      id: s.id || s.name?.toLowerCase().replace(/\s+/g, '-') || 'unknown',
      name: s.name || s.id || 'Unknown Skill',
      description: s.description || '',
      author: s.owner || 'Unknown',
      version: s.version || '1.0.0',
      downloads: s.downloads || s.fetchCount || 0,
      rating: s.rating || s.helpfulRate || s.trustScore || 4.0,
      tags: s.tags || [],
      categories: s.tags || [],
      installed: this.store.installedHubSkills.includes(s.id || s.name),
      verified: true
    }));
    this.hubCache.set(cacheKey, { data: skills, timestamp: Date.now() });
    return skills;
  }

  /**
   * 自然语言技能匹配 - 使用 resolve API
   */
  async resolveSkills(task: string): Promise<Array<{ skill: SkillHubListing; score: number; confidence: number }>> {
    const url = new URL(this.store.config.hubUrl + '/skills/resolve');
    url.searchParams.set('task', task);

    const { statusCode, body } = await this.httpGet(url.toString());
    if (statusCode < 200 || statusCode >= 300) {
      throw new Error(`${this.hubUnavailableMessage()} HTTP ${statusCode}`);
    }
    let parsed: any;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new Error(`${this.hubUnavailableMessage()} resolve 响应非 JSON`);
    }
    const results = (parsed.data || []).map((r: any) => ({
      skill: {
        id: r.skill?.id || r.skill?.name?.toLowerCase().replace(/\s+/g, '-') || 'unknown',
        name: r.skill?.name || r.skill?.id || 'Unknown Skill',
        description: r.skill?.description || '',
        author: r.skill?.owner || 'Unknown',
        version: r.skill?.version || '1.0.0',
        downloads: r.skill?.downloads || r.skill?.fetchCount || 0,
        rating: r.skill?.rating || r.skill?.helpfulRate || r.skill?.trustScore || 4.0,
        tags: r.skill?.tags || [],
        categories: r.skill?.tags || [],
        installed: this.store.installedHubSkills.includes(r.skill?.id || r.skill?.name),
        verified: true
      } as SkillHubListing,
      score: r.score || r.relativeScore || 0,
      confidence: r.confidence || 0
    }));
    return results;
  }

  private async fetchHubListings(category?: string, search?: string): Promise<SkillHubListing[]> {
    const url = new URL(this.store.config.hubUrl + '/skills/search');
    if (search) url.searchParams.set('q', search);
    if (category) url.searchParams.set('tags', category);
    url.searchParams.set('limit', '50');

    const { statusCode, body } = await this.httpGet(url.toString());
    if (statusCode < 200 || statusCode >= 300) {
      throw new Error(`${this.hubUnavailableMessage()} HTTP ${statusCode}`);
    }
    let parsed: any;
    try {
      parsed = JSON.parse(body);
    } catch (e) {
      console.error('[SkillsHub] Failed to parse API response:', e);
      throw new Error(`${this.hubUnavailableMessage()} search 响应非 JSON`);
    }
    return (parsed.data || []).map((s: any) => ({
      id: s.id || s.name?.toLowerCase().replace(/\s+/g, '-') || 'unknown',
      name: s.name || s.id || 'Unknown Skill',
      description: s.description || '',
      author: s.owner || 'Unknown',
      version: s.version || '1.0.0',
      downloads: s.downloads || s.fetchCount || 0,
      rating: s.rating || s.helpfulRate || s.trustScore || 4.0,
      tags: s.tags || [],
      categories: s.tags || [],
      installed: this.store.installedHubSkills.includes(s.id || s.name),
      verified: true
    }));
  }

  /** Hub 不可用时返回空列表（不伪造条目），并打日志 */
  private async browseHubSafe(): Promise<SkillHubListing[]> {
    try {
      return await this.browseHub();
    } catch (e) {
      console.warn('[SkillsHub] browseHub 失败:', e instanceof Error ? e.message : e);
      return [];
    }
  }

  async installFromHub(hubSkillId: string): Promise<Skill> {
    const existing = this.store.skills.find(s => s.id === `hub_${hubSkillId}`);
    if (existing) {
      return existing;
    }

    const hubListings = await this.browseHubSafe();
    const listing = hubListings.find(l => l.id === hubSkillId);

    const skill: Skill = {
      id: `hub_${hubSkillId}`,
      name: listing?.name || hubSkillId,
      description: listing?.description || 'Hub skill',
      version: listing?.version || '1.0.0',
      author: listing?.author,
      source: 'hub',
      status: 'active',
      installedAt: new Date(),
      usageCount: 0,
      successRate: 0,
      avgDuration: 0,
      tags: listing?.tags || []
    };

    this.store.skills.push(skill);
    this.store.installedHubSkills.push(hubSkillId);
    this.store.stats.totalInstalls++;

    await this.saveStore();
    this.emit('skill:installed', skill);

    return skill;
  }

  async createSkill(params: {
    name: string;
    description: string;
    prompt?: string;
    tools?: string[];
    tags?: string[];
    config?: Record<string, any>;
  }): Promise<Skill> {
    const skill: Skill = {
      id: `custom_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: params.name,
      description: params.description,
      version: '1.0.0',
      source: 'created',
      status: 'active',
      installedAt: new Date(),
      usageCount: 0,
      successRate: 0,
      avgDuration: 0,
      tags: params.tags || [],
      prompt: params.prompt,
      tools: params.tools,
      config: params.config
    };

    this.store.skills.push(skill);
    this.store.stats.totalCreates++;

    await this.saveStore();
    this.emit('skill:created', skill);

    return skill;
  }

  async updateSkill(skillId: string, updates: Partial<Skill>): Promise<Skill | null> {
    const skill = this.store.skills.find(s => s.id === skillId);
    if (!skill) return null;

    Object.assign(skill, updates);
    this.store.stats.totalUpdates++;

    await this.saveStore();
    this.emit('skill:updated', skill);

    return skill;
  }

  async deleteSkill(skillId: string): Promise<boolean> {
    const index = this.store.skills.findIndex(s => s.id === skillId);
    if (index < 0) return false;

    const skill = this.store.skills[index];
    if (skill.source === 'hub') {
      const hubId = skillId.replace('hub_', '');
      const hubIndex = this.store.installedHubSkills.indexOf(hubId);
      if (hubIndex >= 0) {
        this.store.installedHubSkills.splice(hubIndex, 1);
      }
    }

    this.store.skills.splice(index, 1);
    await this.saveStore();

    return true;
  }

  async recordUsage(skillId: string, durationMs: number, success: boolean): Promise<void> {
    const skill = this.store.skills.find(s => s.id === skillId);
    if (!skill) return;

    skill.usageCount++;
    skill.lastUsed = new Date();
    skill.avgDuration = (skill.avgDuration * (skill.usageCount - 1) + durationMs) / skill.usageCount;
    skill.successRate = (skill.successRate * (skill.usageCount - 1) + (success ? 1 : 0)) / skill.usageCount;

    await this.saveStore();
  }

  getSkill(skillId: string): Skill | undefined {
    return this.store.skills.find(s => s.id === skillId);
  }

  getSkills(filter?: {
    source?: SkillSource;
    status?: SkillStatus;
    tags?: string[];
  }): Skill[] {
    let skills = [...this.store.skills];

    if (filter?.source) {
      skills = skills.filter(s => s.source === filter.source);
    }
    if (filter?.status) {
      skills = skills.filter(s => s.status === filter.status);
    }
    if (filter?.tags && filter.tags.length > 0) {
      skills = skills.filter(s => filter.tags!.some(tag => s.tags.includes(tag)));
    }

    return skills.sort((a, b) => b.usageCount - a.usageCount);
  }

  getTemplates(): SkillTemplate[] {
    if (this.store.templates.length === 0) {
      this.store.templates = [
        {
          id: 'template_code_review',
          name: 'Code Review Automation',
          description: 'Create a skill that automates code review tasks',
          category: 'development',
          difficulty: 'intermediate',
          estimatedTime: '30 minutes',
          steps: [
            { action: 'Initialize', tool: 'file_writer', description: 'Create skill configuration' },
            { action: 'Implement', tool: 'code_writer', description: 'Add review logic' },
            { action: 'Test', tool: 'test_runner', description: 'Verify with sample code' }
          ]
        },
        {
          id: 'template_data_pipeline',
          name: 'Data Pipeline Builder',
          description: 'Build an automated data processing pipeline',
          category: 'data-science',
          difficulty: 'advanced',
          estimatedTime: '1 hour',
          steps: [
            { action: 'Design', description: 'Define pipeline stages' },
            { action: 'Implement', tool: 'data_processor', description: 'Create processors' },
            { action: 'Test', tool: 'data_tester', description: 'Validate output' }
          ]
        },
        {
          id: 'template_api_wrapper',
          name: 'API Wrapper Creator',
          description: 'Create a skill that wraps external APIs',
          category: 'integration',
          difficulty: 'beginner',
          estimatedTime: '15 minutes',
          steps: [
            { action: 'Define', description: 'Document API endpoints' },
            { action: 'Implement', tool: 'api_writer', description: 'Create wrapper functions' },
            { action: 'Test', tool: 'api_tester', description: 'Test against the real API or staging endpoint' }
          ]
        }
      ];
      this.saveStore();
    }

    return this.store.templates;
  }

  async checkForUpdates(): Promise<{ skillId: string; currentVersion: string; newVersion: string }[]> {
    const updates: { skillId: string; currentVersion: string; newVersion: string }[] = [];

    const hubSkills = this.store.skills.filter(s => s.source === 'hub');
    const hubListings = await this.browseHubSafe();

    for (const skill of hubSkills) {
      const hubId = skill.id.replace('hub_', '');
      const listing = hubListings.find(l => l.id === hubId);

      if (listing && this.compareVersions(listing.version, skill.version) > 0) {
        updates.push({
          skillId: skill.id,
          currentVersion: skill.version,
          newVersion: listing.version
        });
      }
    }

    return updates;
  }

  private compareVersions(a: string, b: string): number {
    const partsA = a.split('.').map(Number);
    const partsB = b.split('.').map(Number);

    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
      const numA = partsA[i] || 0;
      const numB = partsB[i] || 0;
      if (numA > numB) return 1;
      if (numA < numB) return -1;
    }
    return 0;
  }

  async applyUpdate(skillId: string): Promise<boolean> {
    const skill = this.store.skills.find(s => s.id === skillId);
    if (!skill || skill.source !== 'hub') return false;

    const hubListings = await this.browseHubSafe();
    const hubId = skill.id.replace('hub_', '');
    const listing = hubListings.find(l => l.id === hubId);

    if (listing && this.compareVersions(listing.version, skill.version) > 0) {
      skill.version = listing.version;
      await this.saveStore();
      this.emit('skill:updated', skill);
      return true;
    }

    return false;
  }

  getStats(): {
    totalSkills: number;
    localSkills: number;
    hubSkills: number;
    createdSkills: number;
    totalInstalls: number;
    totalCreates: number;
    totalUpdates: number;
    topSkills: { id: string; name: string; usageCount: number }[];
  } {
    const topSkills = [...this.store.skills]
      .sort((a, b) => b.usageCount - a.usageCount)
      .slice(0, 5)
      .map(s => ({ id: s.id, name: s.name, usageCount: s.usageCount }));

    return {
      totalSkills: this.store.skills.length,
      localSkills: this.store.skills.filter(s => s.source === 'local').length,
      hubSkills: this.store.skills.filter(s => s.source === 'hub').length,
      createdSkills: this.store.skills.filter(s => s.source === 'created').length,
      totalInstalls: this.store.stats.totalInstalls,
      totalCreates: this.store.stats.totalCreates,
      totalUpdates: this.store.stats.totalUpdates,
      topSkills
    };
  }
}

export const skillsHubSystem = SkillsHubSystem.getInstance();