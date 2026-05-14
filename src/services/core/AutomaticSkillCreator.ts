/**
 * Automatic Skill Creator - 自动技能创建系统
 * 基于Hermes-agent的Autonomous skill creation设计
 * 核心功能：
 * 1. 分析复杂任务执行轨迹
 * 2. 从经验中自动创建新技能
 * 3. 提取可复用的工作流程
 * 4. 技能版本管理和优化
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface SkillTemplate {
  id: string;
  name: string;
  description: string;
  triggers: string[];
  steps: SkillStep[];
  parameters: SkillParameter[];
  createdAt: Date;
  sourceTask?: string;
  confidence: number;
  usageCount: number;
  lastUsed?: Date;
  metadata: {
    originalComplexity: number;
    estimatedTime: number;
    successRate: number;
  };
}

export interface SkillStep {
  order: number;
  action: string;
  tool?: string;
  args?: Record<string, any>;
  expectedOutcome?: string;
  fallbackAction?: string;
}

export interface SkillParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  required: boolean;
  defaultValue?: any;
  description?: string;
}

export interface TaskTrace {
  id: string;
  taskDescription: string;
  steps: {
    action: string;
    tool?: string;
    args?: Record<string, any>;
    result?: any;
    success: boolean;
    timestamp: Date;
    durationMs: number;
  }[];
  overallSuccess: boolean;
  startTime: Date;
  endTime: Date;
  userId?: string;
}

export interface SkillCreationRequest {
  taskTrace: TaskTrace;
  name?: string;
  description?: string;
  minConfidence?: number;
}

export interface SkillCreationResult {
  success: boolean;
  skill?: SkillTemplate;
  warnings?: string[];
  error?: string;
}

interface SkillCreatorStore {
  templates: SkillTemplate[];
  traces: TaskTrace[];
  learningHistory: LearningEvent[];
  lastCleanup: Date;
}

interface LearningEvent {
  timestamp: Date;
  type: 'skill_created' | 'skill_used' | 'skill_improved' | 'skill_merged';
  skillId?: string;
  details: string;
}

class AutomaticSkillCreator {
  private static instance: AutomaticSkillCreator;
  private storePath: string;
  private store: SkillCreatorStore = {
    templates: [],
    traces: [],
    learningHistory: [],
    lastCleanup: new Date()
  };
  private minConfidenceThreshold = 0.6;
  private maxTracesPerTemplate = 50;

  private constructor() {
    this.storePath = path.join(__dirname, '../../../data/skill_creator.json');
    this.loadStore();
  }

  static getInstance(): AutomaticSkillCreator {
    if (!AutomaticSkillCreator.instance) {
      AutomaticSkillCreator.instance = new AutomaticSkillCreator();
    }
    return AutomaticSkillCreator.instance;
  }

  private async loadStore(): Promise<void> {
    try {
      const dir = path.dirname(this.storePath);
      await fs.mkdir(dir, { recursive: true });
      const data = await fs.readFile(this.storePath, 'utf-8');
      const parsed = JSON.parse(data);
      this.store = {
        templates: (parsed.templates || []).map((t: any) => ({
          ...t,
          createdAt: new Date(t.createdAt),
          lastUsed: t.lastUsed ? new Date(t.lastUsed) : undefined
        })),
        traces: (parsed.traces || []).map((tr: any) => ({
          ...tr,
          startTime: new Date(tr.startTime),
          endTime: new Date(tr.endTime),
          steps: tr.steps.map((s: any) => ({ ...s, timestamp: new Date(s.timestamp) }))
        })),
        learningHistory: (parsed.learningHistory || []).map((l: any) => ({
          ...l,
          timestamp: new Date(l.timestamp)
        })),
        lastCleanup: new Date(parsed.lastCleanup || Date.now())
      };
    } catch {
      this.store = {
        templates: [],
        traces: [],
        learningHistory: [],
        lastCleanup: new Date()
      };
    }
  }

  private async saveStore(): Promise<void> {
    try {
      const dir = path.dirname(this.storePath);
      await fs.mkdir(dir, { recursive: true });
      this.store.lastCleanup = new Date();
      await fs.writeFile(this.storePath, JSON.stringify(this.store, null, 2));
    } catch (e) {
      console.error('[AutomaticSkillCreator] Failed to save store:', e);
    }
  }

  recordTaskTrace(trace: TaskTrace): void {
    this.store.traces.push(trace);
    if (this.store.traces.length > 1000) {
      this.store.traces = this.store.traces.slice(-500);
    }
    this.saveStore();
  }

  async createSkillFromTrace(request: SkillCreationRequest): Promise<SkillCreationResult> {
    const { taskTrace, name, description, minConfidence = 0.6 } = request;
    
    if (taskTrace.steps.length < 2) {
      return {
        success: false,
        error: 'Task trace must have at least 2 steps to create a skill'
      };
    }

    const warnings: string[] = [];
    
    const confidence = this.calculateConfidence(taskTrace);
    
    if (confidence < minConfidence) {
      warnings.push(`Confidence ${confidence.toFixed(2)} is below threshold ${minConfidence}`);
    }

    const skillName = name || this.generateSkillName(taskTrace);
    const skillDescription = description || taskTrace.taskDescription;
    const triggers = this.extractTriggers(taskTrace);
    const parameters = this.extractParameters(taskTrace);
    const steps = this.convertTraceToSteps(taskTrace);

    const template: SkillTemplate = {
      id: `skill_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: skillName,
      description: skillDescription,
      triggers,
      steps,
      parameters,
      createdAt: new Date(),
      sourceTask: taskTrace.id,
      confidence,
      usageCount: 0,
      metadata: {
        originalComplexity: taskTrace.steps.length,
        estimatedTime: taskTrace.endTime.getTime() - taskTrace.startTime.getTime(),
        successRate: taskTrace.overallSuccess ? 1 : 0
      }
    };

    this.store.templates.push(template);
    this.store.learningHistory.push({
      timestamp: new Date(),
      type: 'skill_created',
      skillId: template.id,
      details: `Created skill "${skillName}" from task trace`
    });

    await this.saveStore();

    return {
      success: true,
      skill: template,
      warnings: warnings.length > 0 ? warnings : undefined
    };
  }

  private calculateConfidence(trace: TaskTrace): number {
    let score = 0.5;

    if (trace.overallSuccess) {
      score += 0.2;
    }

    const avgStepDuration = trace.steps.reduce((sum, s) => sum + s.durationMs, 0) / trace.steps.length;
    if (avgStepDuration > 1000 && avgStepDuration < 60000) {
      score += 0.1;
    }

    if (trace.steps.length >= 3 && trace.steps.length <= 10) {
      score += 0.1;
    }

    const uniqueTools = new Set(trace.steps.filter(s => s.tool).map(s => s.tool));
    if (uniqueTools.size >= 2) {
      score += 0.1;
    }

    return Math.min(1, Math.max(0, score));
  }

  private generateSkillName(trace: TaskTrace): string {
    const keywords: string[] = [];
    for (const step of trace.steps) {
      const words = step.action.toLowerCase().split(/\s+/);
      const important = words.filter(w => w.length > 4);
      keywords.push(...important.slice(0, 2));
    }
    
    const unique = [...new Set(keywords)];
    const prefix = unique.slice(0, 3).join('_') || 'custom';
    return `${prefix}_skill_${Date.now() % 1000}`;
  }

  private extractTriggers(trace: TaskTrace): string[] {
    const triggers: string[] = [];
    const desc = trace.taskDescription.toLowerCase();
    
    const patterns = [
      /(?:how to|create|generate|build|make)\s+(.+)/i,
      /(?:can you|could you)\s+(.+)/i,
      /(?:need|want)\s+(.+)/i
    ];
    
    for (const pattern of patterns) {
      const match = desc.match(pattern);
      if (match) {
        triggers.push(match[1].trim());
      }
    }
    
    if (triggers.length === 0) {
      triggers.push(desc.slice(0, 100));
    }
    
    return [...new Set(triggers)];
  }

  private extractParameters(trace: TaskTrace): SkillParameter[] {
    const params: Map<string, SkillParameter> = new Map();
    
    for (const step of trace.steps) {
      if (step.args) {
        for (const [key, value] of Object.entries(step.args)) {
          if (!params.has(key)) {
            params.set(key, {
              name: key,
              type: typeof value as 'string' | 'number' | 'boolean' | 'array' | 'object',
              required: false,
              description: `Parameter ${key} from original task`
            });
          }
        }
      }
    }
    
    return Array.from(params.values());
  }

  private convertTraceToSteps(trace: TaskTrace): SkillStep[] {
    return trace.steps.map((step, index) => ({
      order: index + 1,
      action: step.action,
      tool: step.tool,
      args: step.args,
      expectedOutcome: step.success ? 'Success' : 'Failed',
      fallbackAction: step.success ? undefined : `Retry or skip step ${index + 1}`
    }));
  }

  async improveSkill(skillId: string, newTrace: TaskTrace): Promise<SkillCreationResult> {
    const skill = this.store.templates.find(s => s.id === skillId);
    if (!skill) {
      return { success: false, error: 'Skill not found' };
    }

    const newSteps = this.convertTraceToSteps(newTrace);
    const improvedSteps = this.mergeSteps(skill.steps, newSteps);
    
    skill.steps = improvedSteps;
    skill.usageCount++;
    skill.lastUsed = new Date();
    skill.metadata.successRate = 
      (skill.metadata.successRate * (skill.usageCount - 1) + (newTrace.overallSuccess ? 1 : 0)) / skill.usageCount;

    this.store.learningHistory.push({
      timestamp: new Date(),
      type: 'skill_improved',
      skillId,
      details: `Improved skill with ${newTrace.steps.length} new steps`
    });

    await this.saveStore();

    return { success: true, skill };
  }

  private mergeSteps(existing: SkillStep[], newSteps: SkillStep[]): SkillStep[] {
    const merged = [...existing];
    
    for (const newStep of newSteps) {
      const existingIndex = merged.findIndex(
        s => s.action === newStep.action && s.tool === newStep.tool
      );
      
      if (existingIndex >= 0) {
        if (newStep.fallbackAction && !merged[existingIndex].fallbackAction) {
          merged[existingIndex].fallbackAction = newStep.fallbackAction;
        }
      } else {
        merged.push({ ...newStep, order: merged.length + 1 });
      }
    }
    
    return merged.map((s, i) => ({ ...s, order: i + 1 }));
  }

  findSimilarSkills(taskDescription: string): SkillTemplate[] {
    const desc = taskDescription.toLowerCase();
    const keywords = desc.split(/\s+/).filter(w => w.length > 3);
    
    return this.store.templates
      .map(skill => {
        let score = 0;
        
        for (const keyword of keywords) {
          if (skill.description.toLowerCase().includes(keyword)) {
            score += 0.3;
          }
          if (skill.triggers.some(t => t.toLowerCase().includes(keyword))) {
            score += 0.4;
          }
        }
        
        for (const trigger of skill.triggers) {
          const triggerWords = trigger.toLowerCase().split(/\s+/);
          for (const tw of triggerWords) {
            if (desc.includes(tw)) {
              score += 0.1;
            }
          }
        }
        
        return { skill, score };
      })
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(r => r.skill);
  }

  getAllTemplates(): SkillTemplate[] {
    return [...this.store.templates];
  }

  getTemplate(skillId: string): SkillTemplate | undefined {
    return this.store.templates.find(s => s.id === skillId);
  }

  getRecentTraces(limit = 50): TaskTrace[] {
    return this.store.traces.slice(-limit).reverse();
  }

  getLearningHistory(limit = 50): LearningEvent[] {
    return this.store.learningHistory.slice(-limit).reverse();
  }

  async deleteTemplate(skillId: string): Promise<boolean> {
    const index = this.store.templates.findIndex(s => s.id === skillId);
    if (index >= 0) {
      this.store.templates.splice(index, 1);
      await this.saveStore();
      return true;
    }
    return false;
  }

  getStats(): {
    totalTemplates: number;
    totalTraces: number;
    avgConfidence: number;
    mostUsedSkill?: SkillTemplate;
  } {
    const totalTemplates = this.store.templates.length;
    const totalTraces = this.store.traces.length;
    const avgConfidence = totalTemplates > 0
      ? this.store.templates.reduce((sum, t) => sum + t.confidence, 0) / totalTemplates
      : 0;
    const mostUsedSkill = totalTemplates > 0
      ? this.store.templates.reduce((max, t) => t.usageCount > max.usageCount ? t : max)
      : undefined;

    return { totalTemplates, totalTraces, avgConfidence, mostUsedSkill };
  }
}

export const automaticSkillCreator = AutomaticSkillCreator.getInstance();