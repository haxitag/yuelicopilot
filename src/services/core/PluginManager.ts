import {
  PluginStatus,
  ConnectorStatus,
  ExecutionPhase,
  ErrorLevel,
  AuditType,
  PluginMetadata,
  PluginConfig,
  ExecutionState,
  ErrorInfo,
  SkillInstance,
  ConnectorInstance,
  RepositoryInfo,
  SkillPermission
} from '../../types';
import { EventManager, AuditSystem, ResourceManager, DataNormalizer, RepositoryParser } from './EventManager';
import { SkillStorage } from './SkillStorage';
import { runPreflightWithCache } from './SkillPreflight';
import { normalizeSkillManifest } from './SkillManifestSchema';
import type { SkillManifest } from './SkillManifestSchema';

/**
 * 插件管理器 - 负责技能和连接器的完整生命周期管理
 */
export class PluginManager {
  private skills: Map<string, SkillInstance> = new Map();
  private connectors: Map<string, ConnectorInstance> = new Map();
  private skillInstances: Map<string, SkillInstance> = new Map();
  private connectorInstances: Map<string, ConnectorInstance> = new Map();
  
  private eventManager: EventManager;
  private auditSystem: AuditSystem;
  private resourceManager: ResourceManager;
  private dataNormalizer: DataNormalizer;
  private repositoryParser: RepositoryParser;

  private readonly SKILL_STORAGE_KEY = 'yueli_skill_instances';
  private readonly CONNECTOR_STORAGE_KEY = 'yueli_connector_instances';

  constructor(
    eventManager: EventManager,
    auditSystem: AuditSystem,
    resourceManager: ResourceManager,
    dataNormalizer: DataNormalizer
  ) {
    this.eventManager = eventManager;
    this.auditSystem = auditSystem;
    this.resourceManager = resourceManager;
    this.dataNormalizer = dataNormalizer;
    this.repositoryParser = new RepositoryParser();
    
    this.loadFromStorage();
  }

  // ==================== 技能管理 ====================

  /**
   * 安装技能
   */
  async installSkill(
    skillId: string,
    metadata: PluginMetadata,
    options: {
      url?: string;
      config?: PluginConfig;
    } = {}
  ): Promise<SkillInstance> {
    const audit = this.auditSystem.record(AuditType.INSTALL, skillId, 'success', {
      inputs: { metadata, options }
    });

    try {
      const skill: SkillInstance = {
        id: skillId,
        name: metadata.name,
        description: metadata.description,
        version: metadata.version,
        author: metadata.author,
        installed: true,
        category: 'other',
        tags: [],
        structure: {
          skimmable: true,
          files: []
        },
        permissions: (metadata.permissions || []) as SkillPermission[],
        source: options.url ? 'github' : 'local',
        instanceId: `skill_${Date.now()}`,
        status: PluginStatus.INSTALLING,
        enabled: false,
        metadata,
        config: options.config,
        createdAt: new Date(),
        updatedAt: new Date(),
        url: options.url
      };

      this.skills.set(skillId, skill);
      
      // 更新状态为已安装
      skill.status = PluginStatus.INSTALLED;
      
      this.saveToStorage();

      await this.eventManager.emitForPlugin('skill:installed', skillId, skill.instanceId, skill);

      this.auditSystem.record(AuditType.INSTALL, skillId, 'success', {
        instanceId: skill.instanceId,
        outputs: { skill }
      });

      return skill;
    } catch (error) {
      this.auditSystem.record(AuditType.INSTALL, skillId, 'failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw error;
    }
  }

  /**
   * 从URL安装技能
   */
  async installSkillFromUrl(url: string): Promise<SkillInstance> {
    const repoInfo = this.repositoryParser.parseUrl(url);
    if (!repoInfo) {
      throw new Error('Invalid repository URL');
    }

    const tempId = `temp_${Date.now()}`;
    
    this.auditSystem.record(AuditType.INSTALL, tempId, 'success', {
      inputs: { url, repoInfo }
    });

    // 模拟从仓库获取元数据
    const metadata: PluginMetadata = {
      id: repoInfo.repo || repoInfo.id || 'unknown',
      name: repoInfo.repo || repoInfo.id || 'Unknown Skill',
      version: '1.0.0',
      author: repoInfo.owner || 'Unknown',
      type: 'skill',
      description: `Installed from ${url}`,
      dependencies: [],
      capabilities: [],
      permissions: [],
      configuration: {},
      repository: {
        type: repoInfo.type,
        url: repoInfo.url,
        ref: repoInfo.ref
      }
    };

    return await this.installSkill(metadata.id, metadata, { url });
  }

  /**
   * 启用技能
   * @param opts.skipPreflight 测试或托管场景可跳过预检
   * @param opts.manifest 若已知 manifest（尚未写入 IndexedDB）可传入，避免重复读取
   */
  async enableSkill(
    skillId: string,
    opts?: { skipPreflight?: boolean; manifest?: SkillManifest }
  ): Promise<SkillInstance> {
    const skill = this.skills.get(skillId);
    if (!skill) {
      throw new Error(`Skill ${skillId} not found`);
    }

    if (!opts?.skipPreflight) {
      const storage = new SkillStorage();
      await storage.open();
      const installed = await storage.get(skillId);
      const manifestRaw = opts?.manifest ?? installed?.manifest;
      if (manifestRaw) {
        const n = normalizeSkillManifest(manifestRaw);
        if (n.ok) {
          const pf = await runPreflightWithCache(skillId, n.manifest, storage);
          if (!pf.ok) {
            const detail = pf.checks
              .filter((c) => !c.ok)
              .map((c) => `${c.name}${c.detail ? `: ${c.detail}` : ''}`)
              .join('; ');
            throw new Error(detail ? `技能预检未通过：${detail}` : '技能预检未通过');
          }
        }
      }
    }

    this.auditSystem.record(AuditType.ENABLE, skillId, 'success', {
      instanceId: skill.instanceId
    });

    skill.status = PluginStatus.ENABLED;
    skill.enabled = true;
    skill.updatedAt = new Date();

    this.saveToStorage();
    await this.eventManager.emitForPlugin('skill:enabled', skillId, skill.instanceId, skill);

    return skill;
  }

  /**
   * 禁用技能
   */
  async disableSkill(skillId: string): Promise<SkillInstance> {
    const skill = this.skills.get(skillId);
    if (!skill) {
      throw new Error(`Skill ${skillId} not found`);
    }

    this.auditSystem.record(AuditType.DISABLE, skillId, 'success', {
      instanceId: skill.instanceId
    });

    skill.status = PluginStatus.DISABLED;
    skill.enabled = false;
    skill.updatedAt = new Date();

    this.saveToStorage();
    await this.eventManager.emitForPlugin('skill:disabled', skillId, skill.instanceId, skill);

    return skill;
  }

  /**
   * 卸载技能
   */
  async uninstallSkill(skillId: string): Promise<void> {
    const skill = this.skills.get(skillId);
    if (!skill) {
      throw new Error(`Skill ${skillId} not found`);
    }

    this.auditSystem.record(AuditType.UNINSTALL, skillId, 'success', {
      instanceId: skill.instanceId
    });

    skill.status = PluginStatus.UNINSTALLING;
    await this.eventManager.emitForPlugin('skill:uninstalling', skillId, skill.instanceId);

    // 清理实例
    this.skills.delete(skillId);
    this.skillInstances.delete(skill.instanceId);

    this.saveToStorage();
    await this.eventManager.emitForPlugin('skill:uninstalled', skillId, skill.instanceId);
  }

  /**
   * 获取技能
   */
  getSkill(skillId: string): SkillInstance | undefined {
    return this.skills.get(skillId);
  }

  /**
   * 获取所有技能
   */
  getAllSkills(): SkillInstance[] {
    return Array.from(this.skills.values());
  }

  /**
   * 获取已启用的技能
   */
  getEnabledSkills(): SkillInstance[] {
    return this.getAllSkills().filter(s => s.enabled);
  }

  // ==================== 连接器管理 ====================

  /**
   * 安装连接器
   */
  async installConnector(
    connectorId: string,
    metadata: PluginMetadata,
    config: any = {}
  ): Promise<ConnectorInstance> {
    this.auditSystem.record(AuditType.INSTALL, connectorId, 'success', {
      inputs: { metadata, config }
    });

    const connector: ConnectorInstance = {
      id: connectorId,
      name: metadata.name,
      type: 'custom',
      config,
      connected: false,
      instanceId: `connector_${Date.now()}`,
      status: ConnectorStatus.DISCONNECTED,
      enabled: false,
      metadata,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.connectors.set(connectorId, connector);
    connector.status = ConnectorStatus.DISCONNECTED;
    
    this.saveToStorage();
    await this.eventManager.emitForPlugin('connector:installed', connectorId, connector.instanceId, connector);

    return connector;
  }

  /**
   * 连接连接器
   */
  async connectConnector(connectorId: string): Promise<ConnectorInstance> {
    const connector = this.connectors.get(connectorId);
    if (!connector) {
      throw new Error(`Connector ${connectorId} not found`);
    }

    this.auditSystem.record(AuditType.CONNECT, connectorId, 'success', {
      instanceId: connector.instanceId
    });

    connector.status = ConnectorStatus.CONNECTING;
    await this.eventManager.emitForPlugin('connector:connecting', connectorId, connector.instanceId);

    // 模拟连接过程
    await new Promise(resolve => setTimeout(resolve, 500));

    connector.status = ConnectorStatus.CONNECTED;
    connector.connected = true;
    connector.enabled = true;
    connector.updatedAt = new Date();

    this.saveToStorage();
    await this.eventManager.emitForPlugin('connector:connected', connectorId, connector.instanceId, connector);

    return connector;
  }

  /**
   * 断开连接器
   */
  async disconnectConnector(connectorId: string): Promise<ConnectorInstance> {
    const connector = this.connectors.get(connectorId);
    if (!connector) {
      throw new Error(`Connector ${connectorId} not found`);
    }

    this.auditSystem.record(AuditType.DISCONNECT, connectorId, 'success', {
      instanceId: connector.instanceId
    });

    connector.status = ConnectorStatus.DISCONNECTING;
    await this.eventManager.emitForPlugin('connector:disconnecting', connectorId, connector.instanceId);

    connector.status = ConnectorStatus.DISCONNECTED;
    connector.connected = false;
    connector.enabled = false;
    connector.updatedAt = new Date();

    this.saveToStorage();
    await this.eventManager.emitForPlugin('connector:disconnected', connectorId, connector.instanceId, connector);

    return connector;
  }

  /**
   * 卸载连接器
   */
  async uninstallConnector(connectorId: string): Promise<void> {
    const connector = this.connectors.get(connectorId);
    if (!connector) {
      throw new Error(`Connector ${connectorId} not found`);
    }

    this.auditSystem.record(AuditType.UNINSTALL, connectorId, 'success', {
      instanceId: connector.instanceId
    });

    if (connector.connected) {
      await this.disconnectConnector(connectorId);
    }

    this.connectors.delete(connectorId);
    this.connectorInstances.delete(connector.instanceId);

    this.saveToStorage();
    await this.eventManager.emitForPlugin('connector:uninstalled', connectorId, connector.instanceId);
  }

  /**
   * 获取连接器
   */
  getConnector(connectorId: string): ConnectorInstance | undefined {
    return this.connectors.get(connectorId);
  }

  /**
   * 获取所有连接器
   */
  getAllConnectors(): ConnectorInstance[] {
    return Array.from(this.connectors.values());
  }

  // ==================== 执行管理 ====================

  /**
   * 创建技能执行实例
   */
  createSkillExecution(skillId: string, inputs: Record<string, any> = {}): ExecutionState {
    const skill = this.skills.get(skillId);
    if (!skill) {
      throw new Error(`Skill ${skillId} not found`);
    }

    const executionState: ExecutionState = {
      instanceId: `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      pluginId: skillId,
      pluginType: 'skill',
      phase: ExecutionPhase.INIT,
      status: PluginStatus.ACTIVE,
      progress: 0,
      progressMessage: 'Initializing skill execution',
      startTime: new Date(),
      context: {},
      inputs
    };

    skill.executionState = executionState;
    skill.status = PluginStatus.EXECUTING;

    this.eventManager.emitForPlugin('skill:execution:start', skillId, executionState.instanceId, executionState);

    return executionState;
  }

  /**
   * 更新执行状态
   */
  async updateExecutionState(
    pluginId: string,
    pluginType: 'skill' | 'connector',
    updates: Partial<ExecutionState>
  ): Promise<void> {
    const instance = pluginType === 'skill' 
      ? this.skills.get(pluginId)
      : this.connectors.get(pluginId);

    if (!instance) {
      throw new Error(`${pluginType} ${pluginId} not found`);
    }

    instance.executionState = {
      ...instance.executionState!, ...updates };

    if (updates.status) {
      instance.status = updates.status as PluginStatus | ConnectorStatus;
    }

    this.saveToStorage();
    await this.eventManager.emitForPlugin(
      `${pluginType}:execution:update`,
      pluginId,
      instance.instanceId,
      instance.executionState
    );
  }

  /**
   * 完成执行
   */
  async completeExecution(
    pluginId: string,
    pluginType: 'skill' | 'connector',
    outputs: Record<string, any>,
    success: boolean = true
  ): Promise<void> {
    const instance = pluginType === 'skill'
      ? this.skills.get(pluginId)
      : this.connectors.get(pluginId);

    if (!instance || !instance.executionState) {
      throw new Error(`${pluginType} ${pluginId} not found or not executing`);
    }

    const executionState = instance.executionState;

    executionState.phase = ExecutionPhase.COMPLETE;
    executionState.status = success ? PluginStatus.COMPLETED : PluginStatus.FAILED;
    executionState.progress = 100;
    executionState.endTime = new Date();
    executionState.outputs = outputs;

    instance.status = success ? PluginStatus.COMPLETED : PluginStatus.FAILED;

    this.saveToStorage();

    await this.eventManager.emitForPlugin(
      `${pluginType}:execution:complete`,
      pluginId,
      executionState.instanceId,
      executionState
    );
  }

  /**
   * 处理执行错误
   */
  async handleExecutionError(
    pluginId: string,
    pluginType: 'skill' | 'connector',
    error: Error,
    errorLevel: ErrorLevel = ErrorLevel.ERROR
  ): Promise<void> {
    const instance = pluginType === 'skill'
      ? this.skills.get(pluginId)
      : this.connectors.get(pluginId);

    if (!instance || !instance.executionState) {
      return;
    }

    const errorInfo: ErrorInfo = {
      code: error.name,
      message: error.message,
      stack: error.stack,
      timestamp: new Date()
    };

    instance.executionState.phase = ExecutionPhase.ERROR;
    instance.executionState.status = PluginStatus.FAILED;
    instance.executionState.error = errorInfo;
    instance.executionState.endTime = new Date();

    instance.status = PluginStatus.ERROR;

    this.saveToStorage();

    await this.eventManager.emitForPlugin(
      `${pluginType}:execution:error`,
      pluginId,
      instance.instanceId,
      { error: errorInfo, level: errorLevel }
    );

    // 根据错误级别处理
    switch (errorLevel) {
      case ErrorLevel.FATAL:
        console.error('Fatal error, requires restart');
        break;
      case ErrorLevel.ERROR:
        console.error('Error occurred, attempting recovery');
        await this.attemptRecovery(pluginId, pluginType);
        break;
      case ErrorLevel.WARNING:
        console.warn('Warning, continuing execution');
        break;
    }
  }

  /**
   * 尝试恢复
   */
  private async attemptRecovery(
    pluginId: string,
    pluginType: 'skill' | 'connector'
  ): Promise<boolean> {
    console.log(`Attempting to recover`, pluginType, pluginId);
    
    // 简单的恢复策略
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    return true;
  }

  // ==================== 存储管理 ====================

  /**
   * 从存储加载
   */
  private loadFromStorage(): void {
    try {
      // 加载技能
      const storedSkills = localStorage.getItem(this.SKILL_STORAGE_KEY);
      if (storedSkills) {
        const skills = JSON.parse(storedSkills);
        skills.forEach((skill: any) => {
          skill.createdAt = new Date(skill.createdAt);
          skill.updatedAt = new Date(skill.updatedAt);
          this.skills.set(skill.id, skill);
        });
      } else {
        // 没有存储的技能，预装一些示例技能
        this.initializeDefaultSkills();
      }

      // 加载连接器
      const storedConnectors = localStorage.getItem(this.CONNECTOR_STORAGE_KEY);
      if (storedConnectors) {
        const connectors = JSON.parse(storedConnectors);
        connectors.forEach((connector: any) => {
          connector.createdAt = new Date(connector.createdAt);
          connector.updatedAt = new Date(connector.updatedAt);
          this.connectors.set(connector.id, connector);
        });
      }
    } catch (error) {
      console.error('Failed to load plugins from storage:', error);
    }
  }

  /**
   * 初始化默认示例技能
   */
  private initializeDefaultSkills(): void {
    const defaultSkills = [
      {
        id: 'stop-slop',
        name: 'AI写作优化',
        description: '移除AI写作中的模式化表达，使文本更自然',
        version: '1.0.0',
        author: 'Hardik Pandya',
        installed: true,
        structure: {
          skimmable: true,
          folders: [
            {
              name: 'references',
              files: [
                'phrases.md',
                'structures.md',
                'examples.md'
              ]
            }
          ],
          files: [
            'SKILL.md',
            'README.md',
            'LICENSE'
          ]
        },
        instanceId: 'skill_default_1',
        status: PluginStatus.INSTALLED,
        enabled: true,
        metadata: {
          id: 'stop-slop',
          name: 'AI写作优化',
          version: '1.0.0',
          author: 'Hardik Pandya',
          type: 'skill',
          description: '移除AI写作中的模式化表达，使文本更自然',
          dependencies: [],
          capabilities: ['text-generation', 'text-editing'],
          permissions: [],
          configuration: {}
        },
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 'ppt-agent-skills',
        name: 'PPT生成器',
        description: '将一句话需求转换为专业级PPTX文件',
        version: '1.0.0',
        author: 'sunbigfly',
        installed: false,
        structure: {
          skimmable: true,
          folders: [
            {
              name: 'scripts',
              files: [
                'validator.py',
                'harness.py',
                'exporter.py'
              ]
            },
            {
              name: 'references',
              folders: [
                { name: 'playbooks', files: [] },
                { name: 'styles', files: [] },
                { name: 'layouts', files: [] },
                { name: 'charts', files: [] },
                { name: 'blocks', files: [] }
              ]
            },
            { name: 'assets', files: [] }
          ],
          files: ['SKILL.md']
        },
        instanceId: 'skill_default_2',
        status: PluginStatus.DISABLED,
        enabled: false,
        metadata: {
          id: 'ppt-agent-skills',
          name: 'PPT生成器',
          version: '1.0.0',
          author: 'sunbigfly',
          type: 'skill',
          description: '将一句话需求转换为专业级PPTX文件',
          dependencies: [],
          capabilities: ['file-generation', 'presentation'],
          permissions: [],
          configuration: {}
        },
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 'code-generator',
        name: '代码生成',
        description: '生成各种编程语言的代码',
        version: '1.0.0',
        author: 'Yueli Copilot',
        installed: true,
        structure: {
          skimmable: true,
          files: ['SKILL.md']
        },
        instanceId: 'skill_default_3',
        status: PluginStatus.INSTALLED,
        enabled: true,
        metadata: {
          id: 'code-generator',
          name: '代码生成',
          version: '1.0.0',
          author: 'Yueli Copilot',
          type: 'skill',
          description: '生成各种编程语言的代码',
          dependencies: [],
          capabilities: ['code-generation', 'code-analysis'],
          permissions: [],
          configuration: {}
        },
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 'data-analyzer',
        name: '数据分析',
        description: '分析数据并生成图表',
        version: '1.0.0',
        author: 'Yueli Copilot',
        installed: true,
        structure: {
          skimmable: true,
          files: ['SKILL.md']
        },
        instanceId: 'skill_default_4',
        status: PluginStatus.INSTALLED,
        enabled: true,
        metadata: {
          id: 'data-analyzer',
          name: '数据分析',
          version: '1.0.0',
          author: 'Yueli Copilot',
          type: 'skill',
          description: '分析数据并生成图表',
          dependencies: [],
          capabilities: ['data-analysis', 'visualization'],
          permissions: [],
          configuration: {}
        },
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 'translator',
        name: '翻译',
        description: '翻译各种语言',
        version: '1.0.0',
        author: 'Yueli Copilot',
        installed: true,
        structure: {
          skimmable: true,
          files: ['SKILL.md']
        },
        instanceId: 'skill_default_5',
        status: PluginStatus.INSTALLED,
        enabled: true,
        metadata: {
          id: 'translator',
          name: '翻译',
          version: '1.0.0',
          author: 'Yueli Copilot',
          type: 'skill',
          description: '翻译各种语言',
          dependencies: [],
          capabilities: ['translation'],
          permissions: [],
          configuration: {}
        },
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 'text-summarizer',
        name: '文本摘要',
        description: '生成文本摘要',
        version: '1.0.0',
        author: 'Yueli Copilot',
        installed: false,
        structure: {
          skimmable: true,
          files: ['SKILL.md']
        },
        instanceId: 'skill_default_6',
        status: PluginStatus.DISABLED,
        enabled: false,
        metadata: {
          id: 'text-summarizer',
          name: '文本摘要',
          version: '1.0.0',
          author: 'Yueli Copilot',
          type: 'skill',
          description: '生成文本摘要',
          dependencies: [],
          capabilities: ['text-summarization'],
          permissions: [],
          configuration: {}
        },
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ];

    defaultSkills.forEach(skill => {
      this.skills.set(skill.id, skill as any);
    });

    // 保存到存储
    this.saveToStorage();
  }

  /**
   * 保存到存储
   */
  private saveToStorage(): void {
    try {
      // 保存技能
      const skills = Array.from(this.skills.values());
      localStorage.setItem(this.SKILL_STORAGE_KEY, JSON.stringify(skills));

      // 保存连接器
      const connectors = Array.from(this.connectors.values());
      localStorage.setItem(this.CONNECTOR_STORAGE_KEY, JSON.stringify(connectors));
    } catch (error) {
      console.error('Failed to save plugins to storage:', error);
    }
  }
}
