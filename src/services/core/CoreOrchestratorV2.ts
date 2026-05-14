import { 
  Message, 
  ExecutionResult, 
  NormalizedData,
  ScheduleTask,
  ScheduleConfig,
  ScheduleStatus,
  ScheduleStrategy,
  TaskCallback,
  PluginStatus,
  ExecutionState,
  PluginEvent,
  UpdateScheduleConfig,
  AuditType,
  ResourceInfo,
  SkillAnalysis,
  SkillInstallRequest
} from '../../types';
import {
  EventManager,
  AuditSystem,
  ResourceManager,
  DataNormalizer,
  RepositoryParser
} from './EventManager';
import { PluginManager } from './PluginManager';
import { SkillInstaller } from './SkillInstaller';
import { ScheduleManager } from './ScheduleManager';
import { SkillExecutor } from '../SkillExecutor';
import { MCPConnectorManager } from '../MCPConnectorManager';
import { TemplateEngine } from '../TemplateEngine';

/**
 * 核心编排器 V2 - 完整的技能与连接器管理系统
 */
export class CoreOrchestratorV2 {
  private eventManager: EventManager;
  private auditSystem: AuditSystem;
  private resourceManager: ResourceManager;
  private dataNormalizer: DataNormalizer;
  private pluginManager: PluginManager;
  private skillInstaller: SkillInstaller;
  private scheduleManager: ScheduleManager;
  private skillExecutor: SkillExecutor;
  private connectorManager: MCPConnectorManager;
  private templateEngine: TemplateEngine;
  private repositoryParser: RepositoryParser;

  private isInitialized = false;
  private emitStage(runId: string, stage: string, payload?: Record<string, any>) {
    void this.eventManager.emit('orchestrator:stage', {
      runId,
      stage,
      at: Date.now(),
      ...payload
    });
  }

  onOrchestratorStage(handler: (event: any) => void, priority = 0) {
    this.eventManager.on('orchestrator:stage', handler as any, priority);
    return () => this.eventManager.off('orchestrator:stage', handler as any);
  }

  constructor() {
    this.eventManager = new EventManager();
    this.auditSystem = new AuditSystem(this.eventManager);
    this.resourceManager = new ResourceManager(this.eventManager);
    this.dataNormalizer = new DataNormalizer();
    this.repositoryParser = new RepositoryParser();
    this.scheduleManager = new ScheduleManager();
    
    this.pluginManager = new PluginManager(
      this.eventManager,
      this.auditSystem,
      this.resourceManager,
      this.dataNormalizer
    );

    this.skillInstaller = new SkillInstaller(
      this.eventManager,
      this.auditSystem,
      this.resourceManager,
      this.dataNormalizer,
      this.pluginManager
    );

    // 兼容旧版
    this.skillExecutor = new SkillExecutor();
    this.connectorManager = new MCPConnectorManager();
    this.templateEngine = new TemplateEngine();
  }

  /**
   * 初始化系统
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    // 注册默认事件监听
    this.setupEventListeners();

    // 注册默认数据转换器
    this.setupDataTransformers();

    // 注册默认资源
    this.setupDefaultResources();

    // 初始化 SkillExecutor（确保 skillConfigs 加载完成）
    await this.skillExecutor.initialize();

    // 同步 SkillExecutor 发现的本地技能到 PluginManager（确保 .skills/ 目录的技能在 UI 中显示）
    await this.syncSkillsFromExecutorToPluginManager();

    this.isInitialized = true;
    await this.eventManager.emit('system:initialized');
  }

  /**
   * 设置事件监听器
   */
  private setupEventListeners(): void {
    // 技能事件
    this.eventManager.on('skill:installed', (event) => {
      console.log('Skill installed:', event.pluginId, event.data);
    });

    this.eventManager.on('skill:enabled', (event) => {
      console.log('Skill enabled:', event.pluginId);
    });

    this.eventManager.on('skill:execution:start', (event) => {
      console.log('Skill execution started:', event.pluginId, event.data);
    });

    this.eventManager.on('skill:execution:complete', (event) => {
      console.log('Skill execution complete:', event.pluginId, event.data);
    });

    this.eventManager.on('skill:execution:error', (event) => {
      console.error('Skill execution error:', event.pluginId, event.data);
    });

    // 连接器事件
    this.eventManager.on('connector:connected', (event) => {
      console.log('Connector connected:', event.pluginId);
    });

    // 资源事件
    this.eventManager.on('resource:acquired', (event) => {
      console.log('Resource acquired:', event.data);
    });

    // 审计事件
    this.eventManager.on('audit:record', (event) => {
      console.log('Audit record:', event.data);
    });
  }

  /**
   * 设置数据转换器
   */
  private setupDataTransformers(): void {
    // JSON转换器
    this.dataNormalizer.registerTransformer('json', (data) => ({
      type: 'json',
      format: 'standard',
      data: typeof data === 'string' ? JSON.parse(data) : data,
      metadata: {
        source: 'internal',
        timestamp: new Date(),
        validated: true
      }
    }));

    // 文本转换器
    this.dataNormalizer.registerTransformer('text', (data) => ({
      type: 'text',
      format: 'plain',
      data: String(data),
      metadata: {
        source: 'internal',
        timestamp: new Date(),
        validated: true
      }
    }));

    // Markdown转换器
    this.dataNormalizer.registerTransformer('markdown', (data) => ({
      type: 'markdown',
      format: 'gfm',
      data: String(data),
      metadata: {
        source: 'internal',
        timestamp: new Date(),
        validated: true
      }
    }));
  }

  /**
   * 设置默认资源
   */
  private setupDefaultResources(): void {
    // 注册一些默认资源
    const defaultResources: ResourceInfo[] = [
      { resourceId: 'memory:default', resourceType: 'memory' as const, status: 'available' as const },
      { resourceId: 'network:default', resourceType: 'network' as const, status: 'available' as const },
      { resourceId: 'api:default', resourceType: 'api' as const, status: 'available' as const }
    ];

    defaultResources.forEach(resource => {
      this.resourceManager.registerResource(resource);
    });
  }

  /**
   * 处理用户输入 - 主链路入口
   */
  async processInput(
    input: string,
    history: Message[],
    options: {
      selectedSkills?: string[];
      selectedConnectors?: any[];
      selectedTemplate?: string;
      userId?: string;
    } = {}
  ): Promise<ExecutionResult> {
    await this.initialize();
    const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const result: ExecutionResult = {
      success: true,
      skillResults: {},
      connectorResults: {}
    };

    try {
      // 1. 分析阶段
      this.emitStage(runId, 'analyze:start');
      const analysis = await this.analyzeInput(input, history, options);
      this.emitStage(runId, 'analyze:end');

      // 2. 准备阶段
      this.emitStage(runId, 'prepare:start');
      await this.prepareExecution(analysis);
      this.emitStage(runId, 'prepare:end');

      // 3. 执行阶段
      this.emitStage(runId, 'execute:start');
      const executionResult = await this.executePipeline(analysis);
      this.emitStage(runId, 'execute:end');

      // 4. 转换阶段
      this.emitStage(runId, 'transform:start');
      const transformedResult = await this.transformResults(executionResult);
      this.emitStage(runId, 'transform:end');

      // 5. 完成阶段
      result.skillResults = transformedResult.skillResults;
      result.connectorResults = transformedResult.connectorResults;
      result.renderedOutput = transformedResult.renderedOutput;

      this.emitStage(runId, 'complete:start');
      await this.completeExecution(result);
      this.emitStage(runId, 'complete:end');

    } catch (error) {
      result.success = false;
      result.error = error instanceof Error ? error.message : 'Unknown error';
      this.emitStage(runId, 'error', { message: result.error });
      
      await this.handleExecutionError(error);
    }

    return result;
  }

  /**
   * 分析输入
   */
  private async analyzeInput(
    input: string,
    history: Message[],
    options: any
  ): Promise<any> {
    console.log('Analyzing input:', input);

    const analysis = {
      input,
      history,
      options,
      skillsToExecute: options.selectedSkills || [],
      connectorsToUse: options.selectedConnectors || [],
      templateToUse: options.selectedTemplate,
      detectedSkills: [] as string[],
      detectedConnectors: [] as any[],
      requiresResources: [] as string[],
      skillUrlsToInstall: [] as SkillInstallRequest[]
    };

    // 1. 自动检测技能仓库 URL
    const skillUrls = this.extractSkillRepositoryUrls(input);
    for (const url of skillUrls) {
      try {
        const discovered = await this.skillInstaller.discoverSkillsFromUrl(url);
        if (discovered.length > 0) {
          const skill = discovered[0];
          const manifest = skill.manifest || {};
          
          analysis.skillUrlsToInstall.push({
            url,
            skillId: skill.id,
            name: skill.name,
            description: skill.description,
            version: skill.version,
            author: skill.author,
            source: skill.repository?.type ?? 'unknown',
            permissions: manifest.permissions || [],
            dependencies: manifest.dependencies || [],
            tools: manifest.tools || [],
            tags: manifest.tags || [],
            analysis: this.analyzeSkillDetails(manifest)
          });
        }
      } catch (error) {
        console.warn('Failed to discover skill from URL:', url, error);
      }
    }

    // 2. 自动检测技能调用
    const enabledSkills = this.pluginManager.getEnabledSkills();
    for (const skill of enabledSkills) {
      if (input.includes(skill.name) || input.includes(`@${skill.id}`)) {
        analysis.skillsToExecute.push(skill.id);
        analysis.detectedSkills.push(skill.id);
      }
    }

    // 3. 自动检测连接器需求
    if (input.includes('天气') || input.includes('weather')) {
      analysis.requiresResources.push('api');
    }

    return analysis;
  }

  /**
   * 从输入中提取技能仓库 URL
   */
  private extractSkillRepositoryUrls(input: string): string[] {
    // 匹配所有支持的技能仓库 URL
    const pattern = /https?:\/\/[^\s]*(?:github\.com|gist\.github\.com|gitlab\.com|skill\.sh|skillhub\.cn|skillhub\.cloud\.tencent\.com|skillshub\.wtf)[^\s]*/gi;
    const matches = input.match(pattern) || [];
    
    // 过滤出有效的技能仓库 URL
    return matches.filter(url => this.repositoryParser.isSkillRepository(url));
  }

  /**
   * 分析技能详情 - 功能、用例、价值、权限和风险
   */
  private analyzeSkillDetails(manifest: any): SkillAnalysis {
    const analysis: SkillAnalysis = {
      capabilities: [],
      useCases: [],
      value: '',
      risks: [],
      privacyConcerns: []
    };

    if (!manifest) return analysis;

    // 提取功能描述
    const description = manifest.description || manifest.name || '';
    if (description) {
      analysis.capabilities.push(description);
    }

    // 从 tags 推断用例
    const tags = manifest.tags || [];
    const tagUseCases: Record<string, string[]> = {
      'coding': ['代码生成', '代码审查', '代码补全'],
      'writing': ['文章撰写', '文案生成', '内容优化'],
      'data': ['数据分析', '数据可视化', '报表生成'],
      'ppt': ['PPT 生成', '幻灯片制作', '演示文稿'],
      'translate': ['翻译', '语言转换', '多语言支持'],
      'search': ['信息搜索', '文档检索', '知识查询'],
      'api': ['API 调用', '数据获取', '服务集成'],
      'file': ['文件处理', '文档操作', '文件系统'],
      'browser': ['网页浏览', '自动化操作', 'UI 测试'],
      'agent': ['智能体', '自动化流程', '任务编排']
    };

    for (const tag of tags) {
      const lowerTag = tag.toLowerCase();
      if (tagUseCases[lowerTag]) {
        analysis.useCases.push(...tagUseCases[lowerTag]);
      }
    }

    // 从描述推断用例
    if (description) {
      const lowerDesc = description.toLowerCase();
      if (lowerDesc.includes('code') || lowerDesc.includes('代码')) {
        analysis.useCases.push('代码开发');
      }
      if (lowerDesc.includes('write') || lowerDesc.includes('生成') || lowerDesc.includes('撰写')) {
        analysis.useCases.push('内容生成');
      }
      if (lowerDesc.includes('search') || lowerDesc.includes('搜索')) {
        analysis.useCases.push('信息检索');
      }
    }

    // 评估价值
    analysis.value = this.evaluateSkillValue(manifest);

    // 分析权限和风险
    const permissions = manifest.permissions || [];
    for (const perm of permissions) {
      if (perm.includes('file') || perm.includes('文件')) {
        analysis.risks.push('需要读写本地文件系统，可能访问敏感文件');
        analysis.privacyConcerns.push('文件系统访问');
      }
      if (perm.includes('network') || perm.includes('网络')) {
        analysis.risks.push('需要网络访问，可能向外部服务发送数据');
        analysis.privacyConcerns.push('网络请求');
      }
      if (perm.includes('exec') || perm.includes('执行')) {
        analysis.risks.push('需要执行命令，存在代码执行风险');
        analysis.privacyConcerns.push('命令执行');
      }
      if (perm.includes('api') || perm.includes('密钥')) {
        analysis.risks.push('可能需要 API 密钥，存在密钥泄露风险');
        analysis.privacyConcerns.push('凭证访问');
      }
    }

    // 如果没有特殊权限
    if (permissions.length === 0) {
      analysis.risks.push('权限未知，请查看技能源码了解详情');
    }

    // 去重
    analysis.useCases = [...new Set(analysis.useCases)];
    analysis.risks = [...new Set(analysis.risks)];
    analysis.privacyConcerns = [...new Set(analysis.privacyConcerns)];

    return analysis;
  }

  /**
   * 评估技能价值
   */
  private evaluateSkillValue(manifest: any): string {
    const tags = manifest.tags || [];
    const description = manifest.description || '';
    
    // 高价值标签组合
    const highValueTags = ['coding', 'agent', 'automation', 'api', 'analysis'];
    const hasHighValue = tags.some((t: string) => highValueTags.includes(t.toLowerCase()));
    
    // 检查是否有实用工具
    const usefulKeywords = ['generate', 'create', 'build', 'make', 'help', 'assist', '自动', '生成', '创建', '辅助'];
    const isUseful = usefulKeywords.some(k => description.toLowerCase().includes(k));

    if (hasHighValue && isUseful) {
      return '高价值 - 可显著提升工作效率的实用技能';
    } else if (isUseful) {
      return '中等价值 - 提供有用的辅助功能';
    } else {
      return '价值待评估 - 请查看技能详情了解具体用途';
    }
  }

  /**
   * 安装发现的技能
   */
  async installSkillFromUrl(url: string): Promise<{ success: boolean; skill?: any; error?: string }> {
    try {
      const discovered = await this.skillInstaller.discoverSkillsFromUrl(url);
      if (discovered.length === 0) {
        return { success: false, error: '未发现技能' };
      }

      const skill = discovered[0];
      await this.skillInstaller.installDiscoveredSkill(skill);
      
      return { success: true, skill };
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : '安装失败' 
      };
    }
  }

  /**
   * 获取技能 URL 分析结果（用于在 UI 中展示）
   */
  async analyzeSkillUrls(input: string): Promise<SkillInstallRequest[]> {
    const urls = this.extractSkillRepositoryUrls(input);
    const results: SkillInstallRequest[] = [];

    for (const url of urls) {
      try {
        const discovered = await this.skillInstaller.discoverSkillsFromUrl(url);
        if (discovered.length > 0) {
          const skill = discovered[0];
          const manifest = skill.manifest || {};
          
          results.push({
            url,
            skillId: skill.id,
            name: skill.name,
            description: skill.description,
            version: skill.version,
            author: skill.author,
            source: skill.repository?.type ?? 'unknown',
            permissions: manifest.permissions || [],
            dependencies: manifest.dependencies || [],
            tools: manifest.tools || [],
            tags: manifest.tags || [],
            analysis: this.analyzeSkillDetails(manifest)
          });
        }
      } catch (error) {
        console.warn('Failed to analyze skill URL:', url, error);
      }
    }

    return results;
  }

  /**
   * 准备执行
   */
  private async prepareExecution(analysis: any): Promise<void> {
    console.log('Preparing execution:', analysis);

    // 获取所需资源
    for (const resourceType of analysis.requiresResources) {
      try {
        await this.resourceManager.acquireResource(resourceType, 'system');
      } catch (error) {
        console.warn('Failed to acquire resource, continuing anyway:', error);
      }
    }

    // 创建技能执行实例
    for (const skillId of analysis.skillsToExecute) {
      try {
        this.pluginManager.createSkillExecution(skillId, { input: analysis.input });
      } catch (error) {
        console.warn('Failed to create skill execution:', error);
      }
    }
  }

  /**
   * 执行管道
   */
  private async executePipeline(analysis: any): Promise<any> {
    console.log('Executing pipeline:', analysis);

    const results: {
      skillResults: Record<string, any>;
      connectorResults: Record<string, any>;
    } = {
      skillResults: {},
      connectorResults: {}
    };

    // 执行技能
    for (const skillId of analysis.skillsToExecute) {
      try {
        const skillResult = await this.executeSkill(skillId, analysis);
        results.skillResults[skillId] = skillResult;
        
        await this.pluginManager.updateExecutionState(skillId, 'skill', {
          progress: 50,
          progressMessage: 'Skill executed successfully'
        });
      } catch (error) {
        console.error('Skill execution failed:', skillId, error);
        await this.pluginManager.handleExecutionError(skillId, 'skill', error as Error);
      }
    }

    // 执行连接器
    for (const connector of analysis.connectorsToUse) {
      try {
        const connectorResult = await this.executeConnector(connector, analysis);
        results.connectorResults[connector.id] = connectorResult;
      } catch (error) {
        console.error('Connector execution failed:', connector.id, error);
      }
    }

    return results;
  }

  /**
   * 执行单个技能
   */
  private async executeSkill(skillId: string, analysis: any): Promise<any> {
    const skill = this.pluginManager.getSkill(skillId);
    if (!skill) {
      throw new Error(`Skill ${skillId} not found`);
    }

    // 使用旧版SkillExecutor兼容执行
    const oldSkill = this.skillExecutor.getSkill(skillId);
    if (oldSkill) {
      const context = {
        skill: oldSkill,
        userInput: analysis.input,
        history: analysis.history,
        variables: {}
      };
      const result = await this.skillExecutor.executeSkill(skillId, context);
      return result;
    }

    // 简单的执行模拟
    return {
      success: true,
      result: `Executed skill: ${skill.name}`,
      metadata: { timestamp: new Date() }
    };
  }

  /**
   * 执行单个连接器
   */
  private async executeConnector(connector: any, analysis: any): Promise<any> {
    // 使用旧版ConnectorManager兼容执行
    return {
      success: true,
      data: null,
      metadata: { timestamp: new Date() }
    };
  }

  /**
   * 转换结果
   */
  private async transformResults(executionResult: any): Promise<any> {
    console.log('Transforming results:', executionResult);

    const transformed = {
      ...executionResult,
      renderedOutput: undefined
    };

    // 归一化技能结果
    for (const [skillId, result] of Object.entries(executionResult.skillResults || {})) {
      const normalized = this.dataNormalizer.normalize(
        result,
        'json',
        'standard',
        `skill:${skillId}`
      );
      transformed.skillResults[skillId] = normalized;
    }

    // 归一化连接器结果
    for (const [connectorId, result] of Object.entries(executionResult.connectorResults || {})) {
      const normalized = this.dataNormalizer.normalize(
        result,
        'json',
        'standard',
        `connector:${connectorId}`
      );
      transformed.connectorResults[connectorId] = normalized;
    }

    return transformed;
  }

  /**
   * 完成执行
   */
  private async completeExecution(result: ExecutionResult): Promise<void> {
    console.log('Completing execution:', result);

    // 释放资源
    const resources = this.resourceManager.getPoolStatus('api');
    // 实际应用中需要具体的释放逻辑

    // 标记执行完成
    const executedSkills = Object.keys(result.skillResults || {});
    for (const skillId of executedSkills) {
      await this.pluginManager.completeExecution(
        skillId,
        'skill',
        result.skillResults![skillId] as any,
        result.success
      );
    }
  }

  /**
   * 处理执行错误
   */
  private async handleExecutionError(error: any): Promise<void> {
    console.error('Execution error:', error);

    // 记录错误到审计系统
    this.auditSystem.record(AuditType.EXECUTE, 'system', 'failed', {
      error: error instanceof Error ? error.message : String(error)
    });
  }

  // ==================== 便捷访问方法 ====================

  /**
   * 获取插件管理器
   */
  getPluginManager(): PluginManager {
    return this.pluginManager;
  }

  /**
   * 获取技能安装器
   */
  getSkillInstaller(): SkillInstaller {
    return this.skillInstaller;
  }

  /**
   * 获取事件管理器
   */
  getEventManager(): EventManager {
    return this.eventManager;
  }

  /**
   * 获取审计系统
   */
  getAuditSystem(): AuditSystem {
    return this.auditSystem;
  }

  /**
   * 获取资源管理器
   */
  getResourceManager(): ResourceManager {
    return this.resourceManager;
  }

  /**
   * 获取数据归一化器
   */
  getDataNormalizer(): DataNormalizer {
    return this.dataNormalizer;
  }

  /**
   * 获取仓库解析器
   */
  getRepositoryParser(): RepositoryParser {
    return this.repositoryParser;
  }

  // ==================== 兼容性方法 ====================

  /**
   * 兼容旧版 - 获取SkillExecutor
   */
  getSkillExecutor(): SkillExecutor {
    return this.skillExecutor;
  }

  /**
   * 重新同步技能（用于运行 skills.sh scan 后刷新技能列表）
   */
  async resyncSkills(): Promise<{ synced: number; total: number }> {
    await this.skillExecutor.initialize();
    await this.syncSkillsFromExecutorToPluginManager();
    const executorSkills = this.skillExecutor.getAllSkills();
    const pluginSkills = this.pluginManager.getAllSkills();
    return {
      synced: pluginSkills.length,
      total: executorSkills.length
    };
  }

  /**
   * 兼容旧版 - 获取ConnectorManager
   */
  getConnectorManager(): MCPConnectorManager {
    return this.connectorManager;
  }

  /**
   * 兼容旧版 - 获取TemplateEngine
   */
  getTemplateEngine(): TemplateEngine {
    return this.templateEngine;
  }

  /**
   * 同步 SkillExecutor 中的技能到 PluginManager
   * 确保从 .skills/ 目录扫描发现的技能在 UI 中正确显示
   */
  private async syncSkillsFromExecutorToPluginManager(): Promise<void> {
    try {
      const executorSkills = this.skillExecutor.getAllSkills();
      let syncedCount = 0;

      for (const skill of executorSkills) {
        // 检查技能是否已在 PluginManager 中
        const existingSkill = this.pluginManager.getSkill(skill.id);
        if (!existingSkill) {
          // 获取技能配置
          const skillConfig = this.skillExecutor.getSkillConfig(skill.id);

          // 注册到 PluginManager
          await this.pluginManager.installSkill(skill.id, {
            id: skill.id,
            name: skill.name,
            description: skill.description,
            version: skill.version,
            author: skill.author,
            type: 'skill',
            dependencies: [],
            capabilities: [],
            permissions: skill.permissions || [],
            configuration: {}
          }, {
            url: skill.url,
            config: {
              enabled: skill.id === 'context-recall-constraint', // 默认只启用上下文召回约束技能
              systemPrompt: skillConfig?.systemPrompt
            }
          });

          syncedCount++;
        }
      }

      if (syncedCount > 0) {
        console.log(`[CoreOrchestratorV2] 已同步 ${syncedCount} 个技能从 SkillExecutor 到 PluginManager`);
      }
    } catch (error) {
      console.warn('[CoreOrchestratorV2] 同步技能到 PluginManager 失败:', error);
    }
  }

  /**
   * LLM 可见的技能工具：优先使用 UI 传入的 skill id；为空则回落到 PluginManager 中「已启用」的技能。
   */
  resolveToolSkillIds(explicitSelection?: string[]): string[] {
    const picked = (explicitSelection || []).filter(Boolean);
    if (picked.length > 0) return picked;
    return this.pluginManager.getEnabledSkills().map(s => s.id);
  }

  /**
   * 兼容旧版 - processMessage
   */
  async processMessage(
    input: string,
    history: Message[],
    selectedSkills?: string[],
    selectedConnectors?: any[],
    selectedTemplate?: string
  ): Promise<any> {
    const result = await this.processInput(input, history, {
      selectedSkills,
      selectedConnectors,
      selectedTemplate
    });

    return {
      enhancedPrompt: input,
      connectorData: result.connectorResults,
      renderedOutput: result.renderedOutput,
      shouldUseLLM: true
    };
  }

  // ==================== 定时任务管理方法 ====================

  /**
   * 获取定时任务管理器
   */
  getScheduleManager(): ScheduleManager {
    return this.scheduleManager;
  }

  /**
   * 创建定时任务
   */
  createScheduleTask(options: {
    pluginId: string;
    pluginType: 'skill' | 'connector';
    name: string;
    description?: string;
    config: ScheduleConfig;
    callback?: TaskCallback;
    metadata?: Record<string, any>;
  }): ScheduleTask {
    return this.scheduleManager.createTask(options);
  }

  /**
   * 启动定时任务
   */
  async startScheduleTask(taskId: string): Promise<void> {
    await this.scheduleManager.startTask(taskId);
  }

  /**
   * 暂停定时任务
   */
  pauseScheduleTask(taskId: string): void {
    this.scheduleManager.pauseTask(taskId);
  }

  /**
   * 恢复定时任务
   */
  resumeScheduleTask(taskId: string): void {
    this.scheduleManager.resumeTask(taskId);
  }

  /**
   * 取消定时任务
   */
  cancelScheduleTask(taskId: string): void {
    this.scheduleManager.cancelTask(taskId);
  }

  /**
   * 立即执行任务
   */
  async executeTaskNow(taskId: string, context: any = {}): Promise<any> {
    return this.scheduleManager.executeTaskNow(taskId, context);
  }

  /**
   * 获取任务
   */
  getScheduleTask(taskId: string): ScheduleTask | undefined {
    return this.scheduleManager.getTask(taskId);
  }

  /**
   * 获取所有任务
   */
  getAllScheduleTasks(): ScheduleTask[] {
    return this.scheduleManager.getAllTasks();
  }

  /**
   * 获取插件的任务
   */
  getPluginScheduleTasks(pluginId: string): ScheduleTask[] {
    return this.scheduleManager.getPluginTasks(pluginId);
  }

  // ==================== 状态回调管理方法 ====================

  /**
   * 注册状态回调
   */
  registerStatusCallback(
    pluginId: string,
    pluginType: 'skill' | 'connector',
    events: PluginStatus[],
    callback: (state: ExecutionState, event: PluginEvent) => void | Promise<void>,
    options: { once?: boolean } = {}
  ): string {
    return this.scheduleManager.registerStatusCallback(
      pluginId,
      pluginType,
      events,
      callback,
      options
    );
  }

  /**
   * 注销状态回调
   */
  unregisterStatusCallback(callbackId: string): void {
    this.scheduleManager.unregisterStatusCallback(callbackId);
  }

  /**
   * 触发状态回调
   */
  async triggerStatusCallbacks(
    pluginId: string,
    state: ExecutionState,
    event: PluginEvent
  ): Promise<void> {
    await this.scheduleManager.triggerStatusCallbacks(pluginId, state, event);
  }

  // ==================== 定时更新管理方法 ====================

  /**
   * 注册定时更新
   */
  registerUpdateSchedule(config: UpdateScheduleConfig): string {
    return this.scheduleManager.registerUpdateSchedule(config);
  }

  /**
   * 取消定时更新
   */
  unregisterUpdateSchedule(scheduleId: string): void {
    this.scheduleManager.unregisterUpdateSchedule(scheduleId);
  }

  /**
   * 启用定时更新
   */
  enableUpdateSchedule(scheduleId: string): void {
    this.scheduleManager.enableUpdateSchedule(scheduleId);
  }

  /**
   * 禁用定时更新
   */
  disableUpdateSchedule(scheduleId: string): void {
    this.scheduleManager.disableUpdateSchedule(scheduleId);
  }
}
