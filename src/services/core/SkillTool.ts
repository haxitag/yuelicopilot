/**
 * Skill Tool - 技能执行工具
 * 支持 inline 和 fork 两种执行模式
 * 参考 Claude Code 的 SkillTool.ts 实现
 */

import { SkillExecutionContext } from '../../types';
import { findBundledSkill, executeBundledSkill } from './BundledSkills';
import { parseSkillFromJson, buildSkillPrompt, type ParsedSkill } from './SkillLoader';
import { LocalSkillScanner } from './LocalSkillScanner';
import { SandboxManager } from './SandboxManager';
import { EventManager } from './EventManager';
import { AuditSystem } from './EventManager';
import { promptRegistry } from '../PromptRegistry';

export interface SkillToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, any>;
      required?: string[];
    };
  };
}

export interface SkillExecutionOptions {
  skillName: string;
  args?: string;
  context?: SkillExecutionContext;
  executionMode?: 'inline' | 'fork';
  availableTools?: SkillToolDefinition[];
  canUseTool?: (toolName: string) => boolean;
  onProgress?: (progress: SkillProgress) => void;
}

export interface SkillProgress {
  type: 'skill_progress' | 'tool_use' | 'complete' | 'error';
  skillName: string;
  message?: string;
  data?: any;
  agentId?: string;
}

export interface SkillResult {
  success: boolean;
  skillName: string;
  status: 'inline' | 'forked';
  agentId?: string;
  result?: string;
  error?: string;
  durationMs?: number;
}

type ToolUseContext = {
  messages: any[];
  getAppState: () => any;
  setAppState?: (f: (prev: any) => any) => void;
  options?: {
    tools: SkillToolDefinition[];
    commands: any[];
    mcpClients?: any[];
    [key: string]: any;
  };
  abortController?: AbortController;
  [key: string]: any;
};

type ContentBlockParam = {
  type: 'text';
  text: string;
} | {
  type: 'image';
  source: { type: 'base64' | 'url'; media_type: string; data: string };
} | {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, any>;
};

export class SkillTool {
  private static instance: SkillTool;
  private skillScanner: LocalSkillScanner;
  private sandboxManager: SandboxManager;
  private eventManager: EventManager;
  private auditSystem: AuditSystem;
  private loadedSkills: Map<string, ParsedSkill> = new Map();
  private skillPrompts: Map<string, (args: string, context: ToolUseContext) => Promise<ContentBlockParam[]>> = new Map();
  private executionInstances: Map<string, string> = new Map();

  private constructor() {
    this.skillScanner = new LocalSkillScanner();
    this.eventManager = new EventManager();
    this.auditSystem = new AuditSystem(this.eventManager);
    this.sandboxManager = SandboxManager.getInstance(this.auditSystem, this.eventManager);
  }

  static getInstance(): SkillTool {
    if (!SkillTool.instance) {
      SkillTool.instance = new SkillTool();
    }
    return SkillTool.instance;
  }

  async initialize(): Promise<void> {
    await this.scanLocalSkills();
    this.registerBuiltInSkills();
    this.listenPromptRegistryUpdates();
  }

  private listenPromptRegistryUpdates(): void {
    promptRegistry.on('prompt:updated', (event: { id: string }) => {
      if (event.id.startsWith('tool-')) {
        console.log(`[SkillTool] Tool prompt '${event.id}' updated from PromptRegistry, will take effect on next use`);
      }
    });
  }

  private async scanLocalSkills(): Promise<void> {
    try {
      const sources = await this.skillScanner.scanAllDirectories();
      
      for (const source of sources) {
        for (const skill of source.skills) {
          const m = skill.manifest || {};
          const mf = (skill as { manifestFile?: string }).manifestFile || '';
          const looksMarkdown =
            typeof mf === 'string' && mf.toLowerCase().includes('skill.md');
          if (
            m.entry ||
            m.prompt ||
            m.systemPrompt ||
            m.instructions ||
            looksMarkdown
          ) {
            const parsed = parseSkillFromJson(skill.manifest, skill.path, source.platform as any);
            if (parsed) {
              this.loadedSkills.set(parsed.id, parsed);
              this.registerSkillPrompt(parsed);
            }
          }
        }
      }
    } catch (error) {
      console.warn('Failed to scan local skills:', error);
    }
  }

  // 内置工具技能映射 - 使用引用ID而非直接存储prompt
  private readonly builtInToolMap: Record<string, { description: string; promptRef: string }> = {
    'pptx': {
      description: 'PPT generation expert - creates professional presentations',
      promptRef: 'tool-pptx-expert'
    },
    'markdown': {
      description: 'Markdown writing expert - creates long-form content',
      promptRef: 'tool-markdown-expert'
    },
    'code': {
      description: 'Code generation expert - generates and validates code',
      promptRef: 'tool-code-expert'
    },
    'data': {
      description: 'Data analysis expert - analyzes data and creates visualizations',
      promptRef: 'tool-data-expert'
    },
    'translate': {
      description: 'Translation expert - provides high-quality translations',
      promptRef: 'tool-translate-expert'
    }
  };

  private registerBuiltInSkills(): void {
    for (const [name, skill] of Object.entries(this.builtInToolMap)) {
      const parsed: ParsedSkill = {
        id: name,
        name,
        displayName: name,
        description: skill.description,
        hasUserSpecifiedDescription: true,
        disableModelInvocation: false,
        userInvocable: true,
        allowedTools: [],
        argumentNames: [],
        markdownContent: this.getBuiltInSkillPrompt(skill.promptRef),
        source: 'builtin',
        loadedFrom: 'bundled',
        contentLength: this.getBuiltInSkillPrompt(skill.promptRef).length,
        isHidden: false,
        progressMessage: 'running'
      };
      
      this.loadedSkills.set(name, parsed);
      this.registerSkillPrompt(parsed);
    }
  }

  // 从PromptRegistry获取最新的工具prompt内容
  private getBuiltInSkillPrompt(promptRef: string): string {
    return promptRegistry.getSystemPrompt(promptRef) || `You are a ${promptRef.replace('tool-', '').replace('-expert', '')} expert.`;
  }

  private registerSkillPrompt(parsed: ParsedSkill): void {
    this.skillPrompts.set(parsed.id, async (args: string, context: ToolUseContext) => {
      // 对于内置工具技能，运行时动态获取最新的prompt内容
      let currentParsed = parsed;
      if (parsed.source === 'builtin') {
        const promptRef = this.builtInToolMap[parsed.id]?.promptRef;
        if (promptRef) {
          const latestPrompt = this.getBuiltInSkillPrompt(promptRef);
          currentParsed = {
            ...parsed,
            markdownContent: latestPrompt,
            contentLength: latestPrompt.length
          };
        }
      }
      
      const prompt = buildSkillPrompt(currentParsed, args, context.messages?.[0]?.sessionId);
      return [{ type: 'text' as const, text: prompt }];
    });
  }

  registerBundledSkillHandler(skillName: string, handler: (args: string, context: ToolUseContext) => Promise<ContentBlockParam[]>): void {
    this.skillPrompts.set(skillName, handler);
  }

  async execute(options: SkillExecutionOptions): Promise<SkillResult> {
    const startTime = Date.now();
    const { skillName, args = '', executionMode = 'inline', onProgress } = options;

    try {
      const parsed = this.loadedSkills.get(skillName);
      if (!parsed) {
        const bundled = findBundledSkill(skillName);
        if (bundled) {
          const context = this.buildToolUseContext(options);
          const result = await executeBundledSkill(skillName, args, context);
          return {
            success: true,
            skillName,
            status: 'inline',
            result: result.map(r => r.type === 'text' ? r.text : JSON.stringify(r)).join('\n'),
            durationMs: Date.now() - startTime
          };
        }
        throw new Error(`Skill not found: ${skillName}`);
      }

      if (parsed.executionContext === 'fork' || executionMode === 'fork') {
        return await this.executeForked(parsed, args, options);
      }

      return await this.executeInline(parsed, args, options);
    } catch (error) {
      return {
        success: false,
        skillName,
        status: 'inline',
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime
      };
    }
  }

  private async executeInline(
    parsed: ParsedSkill,
    args: string,
    options: SkillExecutionOptions
  ): Promise<SkillResult> {
    const startTime = Date.now();
    const context = this.buildToolUseContext(options);
    const handler = this.skillPrompts.get(parsed.id);
    
    if (!handler) {
      throw new Error(`No handler registered for skill: ${parsed.id}`);
    }

    const result = await handler(args, context);
    
    return {
      success: true,
      skillName: parsed.id,
      status: 'inline',
      result: result.map(r => r.type === 'text' ? r.text : JSON.stringify(r)).join('\n'),
      durationMs: Date.now() - startTime
    };
  }

  private async executeForked(
    parsed: ParsedSkill,
    args: string,
    options: SkillExecutionOptions
  ): Promise<SkillResult> {
    const startTime = Date.now();
    const agentId = `skill_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const instanceId = `${parsed.id}_${agentId}`;
    
    options.onProgress?.({
      type: 'skill_progress',
      skillName: parsed.id,
      message: `Starting forked skill execution: ${parsed.id}`,
      agentId
    });

    try {
      const context = this.buildToolUseContext(options);
      const prompt = buildSkillPrompt(parsed, args, context.messages?.[0]?.sessionId);

      const result = await this.sandboxManager.executeInSandbox(
        parsed.id,
        instanceId,
        async () => {
          return {
            skillId: parsed.id,
            prompt,
            context: {
              tools: options.availableTools || [],
              commands: []
            }
          };
        }
      );

      options.onProgress?.({
        type: 'complete',
        skillName: parsed.id,
        agentId,
        data: result
      });

      this.executionInstances.set(agentId, instanceId);

      return {
        success: result.success,
        skillName: parsed.id,
        status: 'forked',
        agentId,
        result: typeof result.output === 'string' ? result.output : JSON.stringify(result.output),
        durationMs: Date.now() - startTime
      };
    } catch (error) {
      options.onProgress?.({
        type: 'error',
        skillName: parsed.id,
        agentId,
        message: error instanceof Error ? error.message : String(error)
      });

      return {
        success: false,
        skillName: parsed.id,
        status: 'forked',
        agentId,
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - startTime
      };
    }
  }

  private buildToolUseContext(options: SkillExecutionOptions): ToolUseContext {
    return {
      messages: options.context?.history || [],
      getAppState: () => ({}),
      options: {
        tools: options.availableTools || [],
        commands: []
      },
      abortController: new AbortController()
    };
  }

  getLoadedSkills(): ParsedSkill[] {
    return Array.from(this.loadedSkills.values());
  }

  getSkillNames(): string[] {
    return Array.from(this.loadedSkills.keys());
  }

  getToolDefinitions(): SkillToolDefinition[] {
    const tools: SkillToolDefinition[] = [];

    for (const skill of this.loadedSkills.values()) {
      if (skill.userInvocable && !skill.isHidden) {
        tools.push({
          type: 'function',
          function: {
            name: `skill__${skill.id}`,
            description: skill.description,
            parameters: {
              type: 'object',
              properties: {
                args: { type: 'string', description: 'Arguments for the skill' }
              }
            }
          }
        });
      }
    }

    return tools;
  }

  async executeToolCall(
    toolName: string,
    args: Record<string, any>,
    context?: SkillExecutionContext
  ): Promise<string> {
    const match = toolName.match(/^skill__(.+)$/);
    if (!match) {
      throw new Error(`Unknown tool format: ${toolName}`);
    }

    const skillName = match[1];
    const result = await this.execute({
      skillName,
      args: args.args || '',
      context,
      executionMode: 'inline'
    });

    if (!result.success) {
      throw new Error(result.error || 'Skill execution failed');
    }

    return result.result || '';
  }

  registerSkill(parsed: ParsedSkill): void {
    this.loadedSkills.set(parsed.id, parsed);
    this.registerSkillPrompt(parsed);
  }

  registerSkillFromManifest(skillId: string, manifest: any, baseDir: string, source: 'userSettings' | 'projectSettings' | 'policySettings' | 'plugin' | 'bundled' | 'mcp' = 'userSettings'): void {
    const parsed = parseSkillFromJson(manifest, baseDir, source);
    if (parsed) {
      parsed.id = skillId;
      this.registerSkill(parsed);
    }
  }
}

export const skillTool = SkillTool.getInstance();
