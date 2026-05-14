/**
 * Skills Service - 统一技能服务
 * 整合 SkillTool, BundledSkills, MCP, WebTools
 * 支持自进化引擎、跨会话记忆、子代理并行执行
 */

import { skillTool, SkillResult } from './core/SkillTool';
import { registerBundledSkill, getBundledSkills, findBundledSkill, BundledSkillDefinition } from './core/BundledSkills';
import { getMCPRuntime, MCPServerConfig } from './mcp/MCPRuntime';
import { webSearchTool } from './mcp/tools/WebSearchTool';
import { webFetchTool } from './mcp/tools/WebFetchTool';
import { LocalSkillScanner } from './core/LocalSkillScanner';
import { SandboxManager } from './core/SandboxManager';
import { EventManager, AuditSystem } from './core/EventManager';
import { skillEvolutionEngine, SkillExecutionFeedback } from './core/SkillEvolutionEngine';
import { taskScheduler } from './core/TaskScheduler';
import { sessionMemorySystem, SessionMemory } from './core/SessionMemory';
import { subAgentExecutor, SubAgentExecutor, SubAgentTask, SubAgentResult, ParallelExecutionResult } from './core/SubAgentExecutor';
import { resolveSkillExecutorBaseUrl } from '../utils/skillExecutorUrl';

export interface SkillsServiceConfig {
  mcpServers?: MCPServerConfig[];
  enableWebSearch?: boolean;
  enableWebFetch?: boolean;
  sandboxTimeout?: number;
}

class SkillsService {
  private static instance: SkillsService;
  private initialized = false;
  private eventManager: EventManager;
  private auditSystem: AuditSystem;
  private sandboxManager: SandboxManager;
  private localSkillScanner: LocalSkillScanner;
  private webToolsRegistered = false;
  private evolutionEngine: typeof skillEvolutionEngine;
  private taskScheduler: typeof taskScheduler;
  private subAgentExecutor: typeof subAgentExecutor;

  private constructor() {
    this.eventManager = new EventManager();
    this.auditSystem = new AuditSystem(this.eventManager);
    this.sandboxManager = SandboxManager.getInstance(this.auditSystem, this.eventManager);
    this.localSkillScanner = new LocalSkillScanner();
    this.evolutionEngine = skillEvolutionEngine;
    this.taskScheduler = taskScheduler;
    this.subAgentExecutor = subAgentExecutor;
  }

  static getInstance(): SkillsService {
    if (!SkillsService.instance) {
      SkillsService.instance = new SkillsService();
    }
    return SkillsService.instance;
  }

  async initialize(config?: SkillsServiceConfig): Promise<void> {
    if (this.initialized) return;

    try {
      await skillTool.initialize();
      
      if (config?.enableWebSearch || config?.enableWebFetch) {
        this.registerWebTools(config?.enableWebSearch, config?.enableWebFetch);
      }

      if (config?.mcpServers?.length) {
        await this.connectMCPServers(config.mcpServers);
      }

      this.initialized = true;
      console.log('[SkillsService] Initialized successfully');
    } catch (error) {
      console.error('[SkillsService] Initialization failed:', error);
      throw error;
    }
  }

  private registerWebTools(enableSearch: boolean = true, enableFetch: boolean = true): void {
    if (this.webToolsRegistered) return;
    
    const runtime = getMCPRuntime();
    
    const executorBase = resolveSkillExecutorBaseUrl();

    if (enableSearch) {
      runtime.addServer({
        id: 'builtin-search',
        name: 'Web Search',
        type: 'http',
        url: executorBase,
        enabled: true,
        description: 'Web search tool'
      });
    }
    
    if (enableFetch) {
      runtime.addServer({
        id: 'builtin-fetch',
        name: 'Web Fetch',
        type: 'http',
        url: executorBase,
        enabled: true,
        description: 'Web fetch tool'
      });
    }
    
    this.webToolsRegistered = true;
    console.log('[SkillsService] Web tools registered');
  }

  private async connectMCPServers(servers: MCPServerConfig[]): Promise<void> {
    const runtime = getMCPRuntime();
    
    for (const server of servers) {
      if (server.enabled) {
        try {
          runtime.addServer(server);
          await runtime.connectServer(server.id);
          console.log(`[SkillsService] MCP server connected: ${server.name}`);
        } catch (error) {
          console.warn(`[SkillsService] Failed to connect MCP server ${server.name}:`, error);
        }
      }
    }
  }

  async executeSkill(
    skillName: string,
    args?: string,
    executionMode?: 'inline' | 'fork'
  ): Promise<SkillResult> {
    return skillTool.execute({
      skillName,
      args,
      executionMode,
      onProgress: (progress) => {
        this.eventManager.emit('skill:progress', progress);
      }
    });
  }

  async executeBundledSkill(
    skillName: string,
    args: string,
    context?: any
  ): Promise<any> {
    const { executeBundledSkill } = await import('./core/BundledSkills');
    return executeBundledSkill(skillName, args, context);
  }

  getLoadedSkills(): any[] {
    return skillTool.getLoadedSkills();
  }

  getSkillDefinitions(): any[] {
    return skillTool.getToolDefinitions();
  }

  getBundledSkills(): BundledSkillDefinition[] {
    return getBundledSkills();
  }

  findBundledSkill(name: string): BundledSkillDefinition | undefined {
    return findBundledSkill(name);
  }

  registerBundledSkill(definition: BundledSkillDefinition): void {
    registerBundledSkill(definition);
  }

  registerSkillFromManifest(skillId: string, manifest: any, baseDir: string, source?: string): void {
    skillTool.registerSkillFromManifest(skillId, manifest, baseDir, source as any);
  }

  async scanLocalSkills(): Promise<any[]> {
    const sources = await this.localSkillScanner.scanAllDirectories();
    return sources;
  }

  getMCPRuntime() {
    return getMCPRuntime();
  }

  getSandboxManager(): SandboxManager {
    return this.sandboxManager;
  }

  getEventManager(): EventManager {
    return this.eventManager;
  }

  async executeToolCall(toolName: string, args: Record<string, any>): Promise<string> {
    const runtime = getMCPRuntime();
    const result = await runtime.executeLLMToolCall({ id: `tool_${Date.now()}`, name: toolName, arguments: args });
    if (result.isError) {
      throw new Error(result.content?.[0]?.text || 'Tool execution failed');
    }
    return result.content?.[0]?.text || '';
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  async recordSkillFeedback(feedback: SkillExecutionFeedback): Promise<void> {
    return skillEvolutionEngine.recordFeedback(feedback);
  }

  async getSkillEvolution(skillId?: string): Promise<any> {
    if (skillId) {
      return skillEvolutionEngine.getEvolution(skillId);
    }
    return skillEvolutionEngine.getAllEvolutions();
  }

  async getEvolutionStats(): Promise<any> {
    return skillEvolutionEngine.getStats();
  }

  async getImprovementSuggestions(skillId?: string): Promise<Record<string, string[]>> {
    return skillEvolutionEngine.getImprovementSuggestions(skillId);
  }

  async createScheduledTask(request: {
    name: string;
    description?: string;
    cron: string;
    skillName: string;
    args?: Record<string, any>;
    enabled?: boolean;
  }): Promise<any> {
    return taskScheduler.createTask(request);
  }

  async getScheduledTasks(): Promise<any[]> {
    return taskScheduler.getAllTasks();
  }

  async deleteScheduledTask(taskId: string): Promise<boolean> {
    return taskScheduler.deleteTask(taskId);
  }

  async runTaskNow(taskId: string): Promise<any> {
    return taskScheduler.runTaskNow(taskId);
  }

  parseNaturalLanguageToTask(text: string): any {
    return taskScheduler.parseNaturalLanguage(text);
  }

  async recordMemory(memory: {
    sessionId: string;
    userId?: string;
    skillName: string;
    summary: string;
    keyOutcome?: string;
    searchableText: string;
    tags?: string[];
    metadata?: Record<string, any>;
  }): Promise<SessionMemory> {
    return sessionMemorySystem.recordSession(memory);
  }

  async searchMemory(query: string, options?: {
    skillName?: string;
    userId?: string;
    limit?: number;
    minScore?: number;
  }): Promise<any[]> {
    return sessionMemorySystem.searchMemories(query, options || {});
  }

  async getRecentMemories(userId?: string, limit?: number): Promise<SessionMemory[]> {
    return sessionMemorySystem.getRecentMemories(userId, limit);
  }

  async executeParallelTasks(tasks: SubAgentTask[]): Promise<ParallelExecutionResult> {
    return subAgentExecutor.executeParallel(tasks);
  }

  killAllSubAgents(): void {
    subAgentExecutor.killAllTasks();
  }

  getActiveSubAgents(): SubAgentTask[] {
    return subAgentExecutor.getActiveTasks();
  }
}

export const skillsService = SkillsService.getInstance();

export {
  skillTool,
  registerBundledSkill,
  getBundledSkills,
  findBundledSkill,
  getMCPRuntime,
  webSearchTool,
  webFetchTool,
  LocalSkillScanner,
  skillEvolutionEngine,
  taskScheduler,
  sessionMemorySystem,
  subAgentExecutor
};
