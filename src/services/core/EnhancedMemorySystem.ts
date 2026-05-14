/**
 * Enhanced Memory System with FTS5 + LLM Summarization
 * 基于Hermes-agent的Enhanced Memory设计
 * 核心功能：
 * 1. FTS5全文搜索
 * 2. LLM摘要生成
 * 3. 跨会话记忆召回
 * 4. 语义相似度搜索
 * 5. Honcho用户建模
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from '../../utils/BrowserEventEmitter';
import { promptRegistry } from '../PromptRegistry';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type MemoryType = 'conversation' | 'skill' | 'preference' | 'fact' | 'todo' | 'summary';
export type SearchMode = 'fts5' | 'semantic' | 'hybrid';

export interface MemoryEntry {
  id: string;
  type: MemoryType;
  content: string;
  summary?: string;
  embedding?: number[];
  source?: string;
  skillName?: string;
  userId?: string;
  sessionId?: string;
  importance: number;
  tags: string[];
  createdAt: Date;
  updatedAt: Date;
  lastAccessedAt?: Date;
  accessCount: number;
  metadata?: Record<string, any>;
}

export interface SemanticSearchOptions {
  query: string;
  limit?: number;
  threshold?: number;
  mode?: SearchMode;
  userId?: string;
  sessionId?: string;
  type?: MemoryType;
  tags?: string[];
}

export interface LLMConfig {
  /** local：OpenAI 兼容接口（默认走 KGM `/v1`，与主对话同源）；openai/anthropic：直连厂商 API（浏览器端常被 CORS 拦截） */
  provider: 'openai' | 'anthropic' | 'local';
  model: string;
  apiKey?: string;
  endpoint?: string;
  temperature?: number;
}

export interface UserProfile {
  userId: string;
  preferences: Record<string, any>;
  interactionPatterns: InteractionPattern[];
  topSkills: TopSkill[];
  createdAt: Date;
  updatedAt: Date;
}

export interface InteractionPattern {
  pattern: string;
  frequency: number;
  lastSeen: Date;
}

export interface TopSkill {
  skillId: string;
  skillName: string;
  score: number;
  executionCount: number;
  successRate: number;
}

interface MemoryStore {
  memories: MemoryEntry[];
  profiles: UserProfile[];
  config: {
    ftsEnabled: boolean;
    llmEnabled: boolean;
    llmConfig: LLMConfig;
    autoSummarize: boolean;
    summarizeAfterMessages: number;
    maxMemoriesPerSession: number;
  };
}

class EnhancedMemorySystem extends EventEmitter {
  private static instance: EnhancedMemorySystem;
  private storePath: string;
  private store: MemoryStore = {
    memories: [],
    profiles: [],
    config: {
      ftsEnabled: true,
      llmEnabled: false,
      llmConfig: {
        provider: 'local',
        model: 'gpt-4o-mini',
        temperature: 0.3
      },
      autoSummarize: false,
      summarizeAfterMessages: 10,
      maxMemoriesPerSession: 100
    }
  };

  private ftsIndex: Map<string, string[]> = new Map();

  private constructor() {
    super();
    this.storePath = path.join(__dirname, '../../../data/enhanced_memory.json');
    this.loadStore();
    this.buildFTSIndex();
    this.listenPromptRegistryUpdates();
  }

  private listenPromptRegistryUpdates(): void {
    promptRegistry.on('prompt:updated', (event: { id: string }) => {
      if (event.id === 'system-memory-summary') {
        console.log('[EnhancedMemorySystem] Summary prompt updated from PromptRegistry, will take effect on next summary generation');
      }
    });
  }

  static getInstance(): EnhancedMemorySystem {
    if (!EnhancedMemorySystem.instance) {
      EnhancedMemorySystem.instance = new EnhancedMemorySystem();
    }
    return EnhancedMemorySystem.instance;
  }

  private async loadStore(): Promise<void> {
    try {
      const dir = path.dirname(this.storePath);
      await fs.mkdir(dir, { recursive: true });
      const data = await fs.readFile(this.storePath, 'utf-8');
      const parsed = JSON.parse(data);
      this.store = {
        memories: (parsed.memories || []).map((m: any) => ({
          ...m,
          createdAt: new Date(m.createdAt),
          updatedAt: new Date(m.updatedAt),
          lastAccessedAt: m.lastAccessedAt ? new Date(m.lastAccessedAt) : undefined
        })),
        profiles: (parsed.profiles || []).map((p: any) => ({
          ...p,
          createdAt: new Date(p.createdAt),
          updatedAt: new Date(p.updatedAt),
          interactionPatterns: (p.interactionPatterns || []).map((ip: any) => ({
            ...ip,
            lastSeen: new Date(ip.lastSeen)
          }))
        })),
        config: { ...this.store.config, ...parsed.config }
      };
      const prov = this.store.config.llmConfig?.provider as string | undefined;
      if (prov === 'mock') {
        this.store.config.llmConfig = {
          ...this.store.config.llmConfig,
          provider: 'local'
        };
        this.store.config.llmEnabled = false;
        void this.saveStore();
      }
    } catch {}
  }

  private async saveStore(): Promise<void> {
    try {
      const dir = path.dirname(this.storePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(this.storePath, JSON.stringify(this.store, null, 2));
    } catch (e) {
      console.error('[EnhancedMemory] Failed to save store:', e);
    }
  }

  private buildFTSIndex(): void {
    this.ftsIndex.clear();
    for (const memory of this.store.memories) {
      const words = this.tokenize(memory.content);
      for (const word of words) {
        if (!this.ftsIndex.has(word)) {
          this.ftsIndex.set(word, []);
        }
        if (!this.ftsIndex.get(word)!.includes(memory.id)) {
          this.ftsIndex.get(word)!.push(memory.id);
        }
      }
    }
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2);
  }

  async updateConfig(updates: Partial<MemoryStore['config']>): Promise<MemoryStore['config']> {
    this.store.config = { ...this.store.config, ...updates };
    await this.saveStore();
    this.emit('config:updated', this.store.config);
    return this.store.config;
  }

  getConfig(): MemoryStore['config'] {
    return { ...this.store.config };
  }

  async addMemory(memory: Omit<MemoryEntry, 'id' | 'createdAt' | 'updatedAt' | 'accessCount'>): Promise<MemoryEntry> {
    const entry: MemoryEntry = {
      ...memory,
      id: `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      createdAt: new Date(),
      updatedAt: new Date(),
      accessCount: 0
    };

    this.store.memories.push(entry);

    const words = this.tokenize(entry.content);
    for (const word of words) {
      if (!this.ftsIndex.has(word)) {
        this.ftsIndex.set(word, []);
      }
      if (!this.ftsIndex.get(word)!.includes(entry.id)) {
        this.ftsIndex.get(word)!.push(entry.id);
      }
    }

    await this.saveStore();
    this.emit('memory:added', entry);

    return entry;
  }

  async generateSummary(content: string): Promise<string> {
    if (!this.store.config.llmEnabled) {
      return content.length <= 500 ? content : `${content.slice(0, 500)}…`;
    }

    const config = this.store.config.llmConfig;
    // 从PromptRegistry获取摘要systemPrompt（支持热更新）
    const sys = promptRegistry.getSystemPrompt('system-memory-summary') ||
      'You summarize user text concisely in the same language as the input. Output plain text only, no preamble.';

    switch (config.provider) {
      case 'local':
        return await this.generateSummaryLocal(content, config, sys);
      case 'openai':
        return await this.generateSummaryWithOpenAI(content, config, sys);
      case 'anthropic':
        return await this.generateSummaryWithAnthropic(content, config, sys);
      default: {
        const _exhaustive: never = config.provider;
        throw new Error(`不支持的 LLM provider: ${_exhaustive}`);
      }
    }
  }

  private resolveOpenAIKey(config: LLMConfig): string | undefined {
    const k = config.apiKey?.trim();
    if (k) return k;
    try {
      const v = (import.meta as any).env?.VITE_OPENAI_API_KEY;
      return typeof v === 'string' && v.trim() ? v.trim() : undefined;
    } catch {
      return undefined;
    }
  }

  private resolveAnthropicKey(config: LLMConfig): string | undefined {
    const k = config.apiKey?.trim();
    if (k) return k;
    try {
      const v = (import.meta as any).env?.VITE_ANTHROPIC_API_KEY;
      return typeof v === 'string' && v.trim() ? v.trim() : undefined;
    } catch {
      return undefined;
    }
  }

  /** OpenAI 兼容 Chat Completions（stream: false） */
  private async completeOpenAICompatible(params: {
    baseUrl: string;
    apiKey: string;
    model: string;
    system: string;
    user: string;
    temperature?: number;
  }): Promise<string> {
    const base = params.baseUrl.replace(/\/$/, '');
    const url = `${base}/chat/completions`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (params.apiKey) headers.Authorization = `Bearer ${params.apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: params.model,
        messages: [
          { role: 'system', content: params.system },
          { role: 'user', content: params.user }
        ],
        temperature: params.temperature ?? 0.3,
        max_tokens: 512,
        stream: false
      })
    });

    if (!response.ok) {
      const t = await response.text();
      throw new Error(`摘要模型请求失败 ${response.status}: ${t}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) {
      throw new Error('摘要模型返回异常：缺少 choices[0].message.content');
    }
    return text.trim();
  }

  private resolveLocalOpenAIBase(config: LLMConfig): string | undefined {
    const ep = config.endpoint?.trim();
    if (ep) return ep.replace(/\/$/, '');

    if (typeof window !== 'undefined') {
      try {
        let kgm = localStorage.getItem('kgmBaseUrl')?.trim();
        const viteEnv = (import.meta as any).env || {};
        if (!kgm) kgm = viteEnv.VITE_KGM_BASE_URL;
        if (!kgm) return undefined;
        if (kgm.includes('${KGM_PORT}')) {
          const port = viteEnv.VITE_KGM_PORT
            || (typeof viteEnv.VITE_KGM_BASE_URL === 'string'
              ? (viteEnv.VITE_KGM_BASE_URL.match(/:(\d+)(?:\/|$)/)?.[1])
              : undefined)
            || '3080';
          kgm = kgm.replace(/\$\{KGM_PORT\}/g, port);
        }
        const base = kgm.replace(/\/$/, '');
        return `${base}/v1`;
      } catch {
        return undefined;
      }
    }

    return undefined;
  }

  private resolveKgmApiKey(config: LLMConfig): string {
    const k = config.apiKey?.trim();
    if (k) return k;
    if (typeof window !== 'undefined') {
      try {
        return localStorage.getItem('kgmApiKey')?.trim() || '';
      } catch {
        return '';
      }
    }
    return '';
  }

  private async generateSummaryLocal(content: string, config: LLMConfig, system: string): Promise<string> {
    const base = this.resolveLocalOpenAIBase(config);
    if (!base) {
      throw new Error(
        '未配置本地/OpenAI 兼容摘要端点：请在 Enhanced Memory 的 llmConfig.endpoint 中设置（例如 KGM 的 .../v1），或在应用中配置 kgmBaseUrl。'
      );
    }
    const apiKey = this.resolveKgmApiKey(config);
    return await this.completeOpenAICompatible({
      baseUrl: base,
      apiKey,
      model: config.model,
      system,
      user: content,
      temperature: config.temperature
    });
  }

  private async generateSummaryWithOpenAI(content: string, config: LLMConfig, system: string): Promise<string> {
    const apiKey = this.resolveOpenAIKey(config);
    if (!apiKey) {
      throw new Error(
        'OpenAI 摘要需要 apiKey 或环境变量 VITE_OPENAI_API_KEY。浏览器直连 api.openai.com 常被 CORS 禁止，建议使用 provider=local 走 KGM。'
      );
    }
    const base = (config.endpoint?.trim() || 'https://api.openai.com/v1').replace(/\/$/, '');
    return await this.completeOpenAICompatible({
      baseUrl: base,
      apiKey,
      model: config.model,
      system,
      user: content,
      temperature: config.temperature
    });
  }

  private async generateSummaryWithAnthropic(content: string, config: LLMConfig, system: string): Promise<string> {
    const apiKey = this.resolveAnthropicKey(config);
    if (!apiKey) {
      throw new Error('Anthropic 摘要需要 apiKey 或环境变量 VITE_ANTHROPIC_API_KEY。');
    }

    const model = config.model || 'claude-3-5-haiku-20241022';
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model,
        max_tokens: 512,
        system,
        messages: [{ role: 'user', content }]
      })
    });

    if (!response.ok) {
      const t = await response.text();
      throw new Error(`Anthropic 摘要失败 ${response.status}: ${t}`);
    }

    const data = (await response.json()) as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const block = data.content?.find((c) => c.type === 'text');
    const text = block?.text;
    if (typeof text !== 'string' || !text.trim()) {
      throw new Error('Anthropic 返回异常：缺少文本块');
    }
    return text.trim();
  }

  async search(options: SemanticSearchOptions): Promise<{
    memories: MemoryEntry[];
    scores: number[];
    mode: SearchMode;
  }> {
    const limit = options.limit || 10;
    const mode = options.mode || 'fts5';

    let results: MemoryEntry[] = [];
    let scores: number[] = [];

    if (mode === 'fts5' || mode === 'hybrid') {
      const ftsResults = this.ftsSearch(options.query, options);
      results = ftsResults.memories;
      scores = ftsResults.scores;
    }

    if (mode === 'semantic' || (mode === 'hybrid' && results.length < limit)) {
      const semanticResults = this.semanticSearch(options.query, limit);
      if (mode === 'semantic') {
        results = semanticResults.memories;
        scores = semanticResults.scores;
      } else {
        for (const mem of semanticResults.memories) {
          if (!results.find(r => r.id === mem.id)) {
            results.push(mem);
            scores.push(0.5);
          }
        }
      }
    }

    for (const memory of results) {
      memory.accessCount++;
      memory.lastAccessedAt = new Date();
    }

    await this.saveStore();

    return { memories: results.slice(0, limit), scores: scores.slice(0, limit), mode };
  }

  private ftsSearch(query: string, options: SemanticSearchOptions): {
    memories: MemoryEntry[];
    scores: number[];
  } {
    const queryWords = this.tokenize(query);
    const scores: Map<string, number> = new Map();

    for (const word of queryWords) {
      const matchingIds = this.ftsIndex.get(word);
      if (matchingIds) {
        for (const id of matchingIds) {
          const currentScore = scores.get(id) || 0;
          scores.set(id, currentScore + 1);
        }
      }
    }

    let filteredMemories = this.store.memories.filter(m => {
      if (options.userId && m.userId !== options.userId) return false;
      if (options.sessionId && m.sessionId !== options.sessionId) return false;
      if (options.type && m.type !== options.type) return false;
      if (options.tags && options.tags.length > 0) {
        if (!options.tags.some(tag => m.tags.includes(tag))) return false;
      }
      return true;
    });

    const sorted = filteredMemories
      .map(m => ({
        memory: m,
        score: (scores.get(m.id) || 0) / Math.max(this.tokenize(m.content).length, 1)
      }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score);

    return {
      memories: sorted.map(item => item.memory),
      scores: sorted.map(item => item.score)
    };
  }

  private semanticSearch(query: string, limit: number): {
    memories: MemoryEntry[];
    scores: number[];
  } {
    const queryEmbedding = this.simpleEmbedding(query);

    const memoriesWithScore = this.store.memories
      .map(m => ({
        memory: m,
        score: this.cosineSimilarity(queryEmbedding, m.embedding || this.simpleEmbedding(m.content))
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return {
      memories: memoriesWithScore.map(item => item.memory),
      scores: memoriesWithScore.map(item => item.score)
    };
  }

  private simpleEmbedding(text: string): number[] {
    const dim = 128;
    const embedding = new Array(dim).fill(0);
    const words = this.tokenize(text);

    for (let i = 0; i < words.length; i++) {
      const hash = this.hashString(words[i]);
      for (let j = 0; j < dim; j++) {
        embedding[j] += Math.sin(hash * (j + 1) * 0.1) * (i + 1);
      }
    }

    const norm = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    return embedding.map(val => val / (norm || 1));
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash) + str.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }

  async getUserProfile(userId: string): Promise<UserProfile | undefined> {
    return this.store.profiles.find(p => p.userId === userId);
  }

  async updateUserProfile(userId: string, updates: Partial<UserProfile>): Promise<UserProfile> {
    let profile = this.store.profiles.find(p => p.userId === userId);

    if (!profile) {
      profile = {
        userId,
        preferences: {},
        interactionPatterns: [],
        topSkills: [],
        createdAt: new Date(),
        updatedAt: new Date()
      };
      this.store.profiles.push(profile);
    }

    Object.assign(profile, updates);
    profile.updatedAt = new Date();

    await this.saveStore();
    this.emit('profile:updated', profile);

    return profile;
  }

  async recordInteraction(userId: string, skillId: string, skillName: string, success: boolean): Promise<void> {
    let profile = await this.getUserProfile(userId);
    if (!profile) {
      profile = await this.updateUserProfile(userId, {});
    }

    const existingSkill = profile.topSkills.find(s => s.skillId === skillId);
    if (existingSkill) {
      existingSkill.executionCount++;
      existingSkill.successRate = (existingSkill.successRate * (existingSkill.executionCount - 1) + (success ? 1 : 0)) / existingSkill.executionCount;
      existingSkill.score = existingSkill.successRate * Math.log(existingSkill.executionCount + 1);
    } else {
      profile.topSkills.push({
        skillId,
        skillName,
        score: success ? 1 : 0,
        executionCount: 1,
        successRate: success ? 1 : 0
      });
    }

    profile.topSkills.sort((a, b) => b.score - a.score);
    profile.topSkills = profile.topSkills.slice(0, 10);

    await this.saveStore();
  }

  async deleteMemory(memoryId: string): Promise<boolean> {
    const index = this.store.memories.findIndex(m => m.id === memoryId);
    if (index >= 0) {
      this.store.memories.splice(index, 1);
      this.buildFTSIndex();
      await this.saveStore();
      return true;
    }
    return false;
  }

  async cleanup(olderThanDays = 90): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    const before = this.store.memories.length;

    this.store.memories = this.store.memories.filter(m => m.createdAt >= cutoff);

    this.buildFTSIndex();
    await this.saveStore();

    return before - this.store.memories.length;
  }

  getStats(): {
    totalMemories: number;
    byType: Record<MemoryType, number>;
    bySource: Record<string, number>;
    totalProfiles: number;
    ftsIndexSize: number;
    avgAccessCount: number;
  } {
    const byType: Record<MemoryType, number> = {
      conversation: 0,
      skill: 0,
      preference: 0,
      fact: 0,
      todo: 0,
      summary: 0
    };

    const bySource: Record<string, number> = {};

    for (const memory of this.store.memories) {
      byType[memory.type]++;
      if (memory.source) {
        bySource[memory.source] = (bySource[memory.source] || 0) + 1;
      }
    }

    const totalAccessCount = this.store.memories.reduce((sum, m) => sum + m.accessCount, 0);
    const avgAccessCount = this.store.memories.length > 0 ? totalAccessCount / this.store.memories.length : 0;

    return {
      totalMemories: this.store.memories.length,
      byType,
      bySource,
      totalProfiles: this.store.profiles.length,
      ftsIndexSize: this.ftsIndex.size,
      avgAccessCount
    };
  }
}

export const enhancedMemorySystem = EnhancedMemorySystem.getInstance();