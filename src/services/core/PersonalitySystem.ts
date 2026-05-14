/**
 * Personality System - 人格系统
 * 基于Hermes-agent的personality设计
 * 核心功能：
 * 1. 多人格切换
 * 2. 系统提示词管理
 * 3. 对话风格定制
 * 4. 人格记忆与学习
 */

import { promptRegistry } from '../PromptRegistry';

// 使用localStorage作为浏览器环境的存储
const STORAGE_KEY = 'yueli_personality_system_v1';

export interface Personality {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  behaviorRules: BehaviorRule[];
  responseTemplates: ResponseTemplate[];
  enabled: boolean;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
  metadata?: {
    author?: string;
    version?: string;
    tags?: string[];
    lastSynced?: string;
    [key: string]: any;
  };
}

export interface BehaviorRule {
  pattern: string;
  response: string;
  priority: number;
  conditions?: Record<string, any>;
}

export interface ResponseTemplate {
  trigger: string;
  template: string;
  variables?: string[];
}

export interface PersonalityConfig {
  activePersonalityId?: string;
  userPreferences?: {
    tone?: 'formal' | 'casual' | 'friendly';
    verbosity?: 'brief' | 'moderate' | 'detailed';
    language?: string;
  };
}

export interface PersonalityStats {
  totalPersonas: number;
  activePersona?: string;
  usageCount: Record<string, number>;
  lastUsed: Record<string, Date>;
}

interface PersonalityStore {
  personalities: Personality[];
  activePersonalityId: string | null;
  usageHistory: { personaId: string; timestamp: Date }[];
}

class PersonalitySystem {
  private static instance: PersonalitySystem;
  private store: PersonalityStore = {
    personalities: [],
    activePersonalityId: null,
    usageHistory: []
  };

  private constructor() {
    this.loadStore();
    this.initializeDefaultPersonalities();
  }

  static getInstance(): PersonalitySystem {
    if (!PersonalitySystem.instance) {
      PersonalitySystem.instance = new PersonalitySystem();
    }
    return PersonalitySystem.instance;
  }

  private loadStore(): void {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (data) {
        const parsed = JSON.parse(data);
        this.store = {
          personalities: (parsed.personalities || []).map((p: any) => ({
            ...p,
            createdAt: new Date(p.createdAt),
            updatedAt: new Date(p.updatedAt)
          })),
          activePersonalityId: parsed.activePersonalityId || null,
          usageHistory: (parsed.usageHistory || []).map((u: any) => ({
            ...u,
            timestamp: new Date(u.timestamp)
          }))
        };
      }
    } catch {
      this.store = {
        personalities: [],
        activePersonalityId: null,
        usageHistory: []
      };
    }
  }

  private saveStore(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.store, null, 2));
    } catch (e) {
      console.error('[PersonalitySystem] Failed to save store:', e);
    }
  }

  private initializeDefaultPersonalities(): void {
    if (this.store.personalities.length === 0) {
      // 从PromptRegistry获取personality类别prompts
      const registryPersonas = promptRegistry.getByCategory('personality');
      
      const defaultPersonas: Personality[] = registryPersonas.map(p => ({
        id: p.id,
        name: p.name,
        description: p.description,
        systemPrompt: p.systemPrompt,
        behaviorRules: this.getDefaultBehaviorRules(p.id),
        responseTemplates: [],
        enabled: true,
        isDefault: p.id === 'persona_default',
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: {
          author: 'System',
          version: p.version,
          tags: [p.category]
        }
      }));

      this.store.personalities = defaultPersonas;
      this.store.activePersonalityId = 'persona_default';
      this.saveStore();

      // 监听PromptRegistry更新，实现热更新
      promptRegistry.on('prompt:updated', (event: { id: string }) => {
        if (event.id.startsWith('persona_')) {
          this.updatePersonalityFromRegistry(event.id);
        }
      });
    }
  }

  private getDefaultBehaviorRules(personaId: string): BehaviorRule[] {
    const rules: Record<string, BehaviorRule[]> = {
      'persona_default': [
        { pattern: 'greeting', response: 'Hello! How can I help you today?', priority: 1 },
        { pattern: 'thanks', response: "You're welcome! Is there anything else I can help with?", priority: 1 }
      ],
      'persona_coder': [
        { pattern: 'code_request', response: 'I\'ll write efficient and well-documented code for you.', priority: 1 },
        { pattern: 'debug', response: 'Let me analyze the issue and provide a solution.', priority: 1 }
      ],
      'persona_creative': [
        { pattern: 'write_story', response: 'Let\'s create something amazing together!', priority: 1 },
        { pattern: 'brainstorm', response: 'Great! Let\'s explore creative possibilities.', priority: 1 }
      ],
      'persona_analyst': [
        { pattern: 'analyze', response: 'I\'ll provide a detailed analysis.', priority: 1 },
        { pattern: 'report', response: 'Here\'s your comprehensive report.', priority: 1 }
      ]
    };
    return rules[personaId] || [];
  }

  private updatePersonalityFromRegistry(personaId: string): void {
    const prompt = promptRegistry.getPrompt(personaId);
    if (!prompt) return;

    const personality = this.store.personalities.find(p => p.id === personaId);
    if (personality) {
      personality.name = prompt.name;
      personality.description = prompt.description;
      personality.systemPrompt = prompt.systemPrompt;
      personality.updatedAt = new Date();
      personality.metadata = {
        ...personality.metadata,
        version: prompt.version,
        lastSynced: new Date().toISOString()
      };
      this.saveStore();
      console.log(`[PersonalitySystem] 人格 '${personaId}' 已从PromptRegistry更新`);
    }
  }

  async createPersonality(config: {
    name: string;
    description: string;
    systemPrompt: string;
    behaviorRules?: BehaviorRule[];
    responseTemplates?: ResponseTemplate[];
    metadata?: Personality['metadata'];
  }): Promise<Personality> {
    const personality: Personality = {
      id: `persona_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: config.name,
      description: config.description,
      systemPrompt: config.systemPrompt,
      behaviorRules: config.behaviorRules || [],
      responseTemplates: config.responseTemplates || [],
      enabled: true,
      isDefault: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: config.metadata
    };

    this.store.personalities.push(personality);
    this.saveStore();
    return personality;
  }

  async updatePersonality(id: string, updates: Partial<Personality>): Promise<Personality | null> {
    const personality = this.store.personalities.find(p => p.id === id);
    if (!personality) return null;

    Object.assign(personality, updates, { updatedAt: new Date() });
    this.saveStore();
    return personality;
  }

  async deletePersonality(id: string): Promise<boolean> {
    const index = this.store.personalities.findIndex(p => p.id === id);
    if (index < 0) return false;

    const personality = this.store.personalities[index];
    if (personality.isDefault) return false;

    this.store.personalities.splice(index, 1);
    if (this.store.activePersonalityId === id) {
      this.store.activePersonalityId = 'persona_default';
    }
    this.saveStore();
    return true;
  }

  async setActivePersonality(id: string): Promise<boolean> {
    const personality = this.store.personalities.find(p => p.id === id);
    if (!personality || !personality.enabled) return false;

    this.store.activePersonalityId = id;
    this.store.usageHistory.push({ personaId: id, timestamp: new Date() });

    if (this.store.usageHistory.length > 1000) {
      this.store.usageHistory = this.store.usageHistory.slice(-500);
    }

    this.saveStore();
    return true;
  }

  getActivePersonality(): Personality | undefined {
    if (!this.store.activePersonalityId) {
      return this.store.personalities.find(p => p.isDefault);
    }
    return this.store.personalities.find(p => p.id === this.store.activePersonalityId);
  }

  getAllPersonalities(): Personality[] {
    return [...this.store.personalities];
  }

  getPersonality(id: string): Personality | undefined {
    return this.store.personalities.find(p => p.id === id);
  }

  async togglePersonality(id: string): Promise<boolean> {
    const personality = this.store.personalities.find(p => p.id === id);
    if (!personality || personality.isDefault) return false;

    personality.enabled = !personality.enabled;
    personality.updatedAt = new Date();
    this.saveStore();
    return true;
  }

  generateSystemPrompt(context?: {
    userName?: string;
    conversationHistory?: any[];
    task?: string;
  }): string {
    const personality = this.getActivePersonality();
    if (!personality) {
      // 从PromptRegistry获取默认prompt
      return promptRegistry.getSystemPrompt('persona_default') || 'You are a helpful AI assistant.';
    }

    // 优先从PromptRegistry获取最新版本
    const registryPrompt = promptRegistry.getSystemPrompt(personality.id);
    let prompt = registryPrompt || personality.systemPrompt;

    if (context?.userName) {
      prompt += `\n\nThe user's name is ${context.userName}.`;
    }

    if (context?.task) {
      prompt += `\n\nCurrent task: ${context.task}`;
    }

    if (context?.conversationHistory && context.conversationHistory.length > 0) {
      const recentCount = Math.min(5, context.conversationHistory.length);
      prompt += `\n\nRecent conversation context:\n`;
      for (let i = context.conversationHistory.length - recentCount; i < context.conversationHistory.length; i++) {
        const msg = context.conversationHistory[i];
        prompt += `- ${msg.role}: ${msg.content.slice(0, 100)}...\n`;
      }
    }

    return prompt;
  }

  findMatchingResponse(input: string, context?: Record<string, any>): string | null {
    const personality = this.getActivePersonality();
    if (!personality) return null;

    const lowerInput = input.toLowerCase();

    const matchingRules = personality.behaviorRules
      .filter(rule => lowerInput.includes(rule.pattern.toLowerCase()))
      .sort((a, b) => b.priority - a.priority);

    if (matchingRules.length > 0) {
      return matchingRules[0].response;
    }

    for (const template of personality.responseTemplates) {
      if (lowerInput.includes(template.trigger.toLowerCase())) {
        let response = template.template;
        if (template.variables && context) {
          for (const variable of template.variables) {
            response = response.replace(`{${variable}}`, context[variable] || '');
          }
        }
        return response;
      }
    }

    return null;
  }

  getStats(): PersonalityStats {
    const usageCount: Record<string, number> = {};
    const lastUsed: Record<string, Date> = {};

    for (const usage of this.store.usageHistory) {
      usageCount[usage.personaId] = (usageCount[usage.personaId] || 0) + 1;
      if (!lastUsed[usage.personaId] || usage.timestamp > lastUsed[usage.personaId]) {
        lastUsed[usage.personaId] = usage.timestamp;
      }
    }

    return {
      totalPersonas: this.store.personalities.length,
      activePersona: this.store.activePersonalityId || undefined,
      usageCount,
      lastUsed
    };
  }

  async clonePersonality(sourceId: string, newName: string): Promise<Personality | null> {
    const source = this.getPersonality(sourceId);
    if (!source) return null;

    return this.createPersonality({
      name: newName,
      description: `Cloned from ${source.name}`,
      systemPrompt: source.systemPrompt,
      behaviorRules: [...source.behaviorRules],
      responseTemplates: [...source.responseTemplates],
      metadata: { ...source.metadata, version: '1.0.0' }
    });
  }

  async mergePersonalities(sourceIds: string[], newName: string): Promise<Personality | null> {
    const sources = sourceIds.map(id => this.getPersonality(id)).filter(Boolean) as Personality[];
    if (sources.length < 2) return null;

    const mergedRules: BehaviorRule[] = [];
    const seenPatterns = new Set<string>();

    for (const source of sources) {
      for (const rule of source.behaviorRules) {
        if (!seenPatterns.has(rule.pattern)) {
          mergedRules.push(rule);
          seenPatterns.add(rule.pattern);
        }
      }
    }

    const mergedSystemPrompt = sources.map(s => `[${s.name}]: ${s.systemPrompt}`).join('\n\n');

    return this.createPersonality({
      name: newName,
      description: `Merged from: ${sources.map(s => s.name).join(', ')}`,
      systemPrompt: mergedSystemPrompt,
      behaviorRules: mergedRules
    });
  }
}

export const personalitySystem = PersonalitySystem.getInstance();