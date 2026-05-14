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
  AuditRecord,
  PluginEvent,
  EventHandler,
  SkillInstance,
  ConnectorInstance,
  RepositoryInfo,
  NormalizedData,
  ResourceInfo,
  ReplaySession
} from '../../types';

/**
 * 事件管理器 - 负责插件事件的分发与处理
 */
export class EventManager {
  private eventHandlers: Map<string, EventHandler[]> = new Map();
  private eventQueue: PluginEvent[] = [];
  private isProcessing = false;

  /**
   * 注册事件处理器
   */
  on(eventName: string, handler: (event: PluginEvent) => void | Promise<void>, priority: number = 0): void {
    if (!this.eventHandlers.has(eventName)) {
      this.eventHandlers.set(eventName, []);
    }
    this.eventHandlers.get(eventName)!.push({ eventName, handler, priority, once: false });
    this.eventHandlers.get(eventName)!.sort((a, b) => b.priority - a.priority);
  }

  /**
   * 注册一次性事件处理器
   */
  once(eventName: string, handler: (event: PluginEvent) => void | Promise<void>, priority: number = 0): void {
    if (!this.eventHandlers.has(eventName)) {
      this.eventHandlers.set(eventName, []);
    }
    this.eventHandlers.get(eventName)!.push({ eventName, handler, priority, once: true });
    this.eventHandlers.get(eventName)!.sort((a, b) => b.priority - a.priority);
  }

  /**
   * 移除事件处理器
   */
  off(eventName: string, handler?: (event: PluginEvent) => void | Promise<void>): void {
    if (!this.eventHandlers.has(eventName)) return;
    
    if (handler) {
      this.eventHandlers.set(
        eventName,
        this.eventHandlers.get(eventName)!.filter(h => h.handler !== handler)
      );
    } else {
      this.eventHandlers.delete(eventName);
    }
  }

  /**
   * 触发事件
   */
  async emit(eventName: string, data?: any, metadata?: Record<string, any>): Promise<void> {
    const event: PluginEvent = {
      eventName,
      timestamp: new Date(),
      data,
      metadata
    };

    this.eventQueue.push(event);
    await this.processQueue();
  }

  /**
   * 触发带插件ID的事件
   */
  async emitForPlugin(
    eventName: string,
    pluginId: string,
    instanceId?: string,
    data?: any,
    metadata?: Record<string, any>
  ): Promise<void> {
    const event: PluginEvent = {
      eventName,
      pluginId,
      instanceId,
      timestamp: new Date(),
      data,
      metadata
    };

    this.eventQueue.push(event);
    await this.processQueue();
  }

  /**
   * 处理事件队列
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.eventQueue.length === 0) return;

    this.isProcessing = true;
    while (this.eventQueue.length > 0) {
      const event = this.eventQueue.shift()!;
      await this.processEvent(event);
    }
    this.isProcessing = false;
  }

  /**
   * 处理单个事件
   */
  private async processEvent(event: PluginEvent): Promise<void> {
    const handlers = this.eventHandlers.get(event.eventName) || [];
    const onceHandlers: EventHandler[] = [];

    for (const handler of handlers) {
      try {
        await handler.handler(event);
        if (handler.once) {
          onceHandlers.push(handler);
        }
      } catch (error) {
        console.error(`Error handling event ${event.eventName}:`, error);
      }
    }

    // 移除一次性处理器
    if (onceHandlers.length > 0) {
      const remainingHandlers = this.eventHandlers.get(event.eventName)!
        .filter(h => !onceHandlers.includes(h));
      this.eventHandlers.set(event.eventName, remainingHandlers);
    }
  }
}

/**
 * 审计系统 - 记录所有操作并支持回放
 */
export class AuditSystem {
  private auditRecords: Map<string, AuditRecord> = new Map();
  private readonly STORAGE_KEY = 'yueli_audit_records';
  private eventManager: EventManager;

  constructor(eventManager: EventManager) {
    this.eventManager = eventManager;
    this.loadFromStorage();
  }

  /**
   * 记录审计事件
   */
  record(
    type: AuditType,
    pluginId: string,
    status: 'success' | 'failed',
    options: {
      instanceId?: string;
      userId?: string;
      inputs?: Record<string, any>;
      outputs?: Record<string, any>;
      duration?: number;
      error?: string;
      metadata?: Record<string, any>;
    } = {}
  ): AuditRecord {
    const record: AuditRecord = {
      id: `audit_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      type,
      pluginId,
      status,
      ...options
    };

    this.auditRecords.set(record.id, record);
    this.saveToStorage();

    this.eventManager.emit('audit:record', record);

    return record;
  }

  /**
   * 获取审计记录
   */
  getRecord(recordId: string): AuditRecord | undefined {
    return this.auditRecords.get(recordId);
  }

  /**
   * 查询审计记录
   */
  queryRecords(options: {
    pluginId?: string;
    type?: AuditType;
    startTime?: Date;
    endTime?: Date;
    status?: 'success' | 'failed';
    limit?: number;
    offset?: number;
  } = {}): AuditRecord[] {
    let records = Array.from(this.auditRecords.values());

    if (options.pluginId) {
      records = records.filter(r => r.pluginId === options.pluginId);
    }
    if (options.type) {
      records = records.filter(r => r.type === options.type);
    }
    if (options.startTime) {
      records = records.filter(r => r.timestamp >= options.startTime!);
    }
    if (options.endTime) {
      records = records.filter(r => r.timestamp <= options.endTime!);
    }
    if (options.status) {
      records = records.filter(r => r.status === options.status);
    }

    records.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    if (options.offset) {
      records = records.slice(options.offset);
    }
    if (options.limit) {
      records = records.slice(0, options.limit);
    }

    return records;
  }

  /**
   * 创建回放会话
   */
  createReplaySession(startAuditId: string, endAuditId?: string): ReplaySession {
    const startRecord = this.auditRecords.get(startAuditId);
    if (!startRecord) {
      throw new Error(`Start audit record ${startAuditId} not found`);
    }

    let records = this.queryRecords({
      startTime: startRecord.timestamp,
      endTime: endAuditId ? this.auditRecords.get(endAuditId)?.timestamp : undefined
    });

    const session: ReplaySession = {
      sessionId: `replay_${Date.now()}`,
      startAuditId,
      endAuditId,
      createdAt: new Date(),
      status: 'ready',
      currentIndex: 0,
      speed: 1,
      auditRecords: records
    };

    return session;
  }

  /**
   * 开始回放
   */
  async startReplay(session: ReplaySession): Promise<void> {
    session.status = 'playing';
    this.eventManager.emit('replay:start', session);

    for (let i = session.currentIndex; i < session.auditRecords.length; i++) {
      if (session.status !== 'playing') break;

      const record = session.auditRecords[i];
      session.currentIndex = i;

      await this.replayRecord(record);

      // 根据速度调整延迟
      if (session.speed < 1) {
        await new Promise(resolve => setTimeout(resolve, 1000 / session.speed));
      }
    }

    session.status = 'completed';
    this.eventManager.emit('replay:complete', session);
  }

  /**
   * 暂停回放
   */
  pauseReplay(session: ReplaySession): void {
    session.status = 'paused';
    this.eventManager.emit('replay:pause', session);
  }

  /**
   * 恢复回放
   */
  resumeReplay(session: ReplaySession): Promise<void> {
    return this.startReplay(session);
  }

  /**
   * 回放单个记录
   */
  private async replayRecord(record: AuditRecord): Promise<void> {
    this.eventManager.emit('replay:record', record);
    console.log(`Replaying audit record: ${record.id}`, record);
  }

  /**
   * 导出审计记录
   */
  exportRecords(records: AuditRecord[]): string {
    return JSON.stringify(records, null, 2);
  }

  /**
   * 从存储加载
   */
  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        const records = JSON.parse(stored);
        records.forEach((record: any) => {
          record.timestamp = new Date(record.timestamp);
          this.auditRecords.set(record.id, record);
        });
      }
    } catch (error) {
      console.error('Failed to load audit records from storage:', error);
    }
  }

  /**
   * 保存到存储
   */
  private saveToStorage(): void {
    try {
      const records = Array.from(this.auditRecords.values());
      // 只保存最近的1000条记录
      const recentRecords = records.slice(-1000);
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(recentRecords));
    } catch (error) {
      console.error('Failed to save audit records to storage:', error);
    }
  }

  /**
   * 清理旧记录
   */
  cleanupOldRecords(days: number = 30): number {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    let deletedCount = 0;

    for (const [id, record] of this.auditRecords.entries()) {
      if (record.timestamp < cutoff) {
        this.auditRecords.delete(id);
        deletedCount++;
      }
    }

    this.saveToStorage();
    return deletedCount;
  }
}

/**
 * 资源管理器 - 管理共享资源的调度与访问
 */
export class ResourceManager {
  private resources: Map<string, ResourceInfo> = new Map();
  private resourcePool: Map<string, ResourceInfo[]> = new Map();
  private eventManager: EventManager;

  constructor(eventManager: EventManager) {
    this.eventManager = eventManager;
  }

  /**
   * 注册资源
   */
  registerResource(resource: ResourceInfo): void {
    this.resources.set(resource.resourceId, resource);
    
    const type = resource.resourceType;
    if (!this.resourcePool.has(type)) {
      this.resourcePool.set(type, []);
    }
    this.resourcePool.get(type)!.push(resource);

    this.eventManager.emit('resource:registered', resource);
  }

  /**
   * 获取资源
   */
  acquireResource(resourceType: string, owner: string, options: {
    priority?: number;
    timeout?: number;
    metadata?: Record<string, any>;
  } = {}): Promise<ResourceInfo> {
    return new Promise((resolve, reject) => {
      const timeout = options.timeout || 30000;
      const startTime = Date.now();

      const checkAvailability = () => {
        const pool = this.resourcePool.get(resourceType) || [];
        const available = pool.find(r => r.status === 'available');

        if (available) {
          available.status = 'acquired';
          available.owner = owner;
          available.acquireTime = new Date();
          available.metadata = { ...available.metadata, ...options.metadata };
          
          this.eventManager.emit('resource:acquired', { resource: available, owner });
          resolve(available);
        } else if (Date.now() - startTime > timeout) {
          reject(new Error(`Resource ${resourceType} acquisition timed out`));
        } else {
          setTimeout(checkAvailability, 100);
        }
      };

      checkAvailability();
    });
  }

  /**
   * 释放资源
   */
  releaseResource(resourceId: string): void {
    const resource = this.resources.get(resourceId);
    if (resource && resource.status === 'acquired') {
      resource.status = 'released';
      resource.releaseTime = new Date();
      
      this.eventManager.emit('resource:released', resource);
    }
  }

  /**
   * 获取资源状态
   */
  getResourceStatus(resourceId: string): ResourceInfo | undefined {
    return this.resources.get(resourceId);
  }

  /**
   * 获取资源池状态
   */
  getPoolStatus(resourceType: string): {
    total: number;
    available: number;
    acquired: number;
    released: number;
  } {
    const pool = this.resourcePool.get(resourceType) || [];
    return {
      total: pool.length,
      available: pool.filter(r => r.status === 'available').length,
      acquired: pool.filter(r => r.status === 'acquired').length,
      released: pool.filter(r => r.status === 'released').length
    };
  }
}

/**
 * 数据归一化器 - 统一数据格式与处理
 */
export class DataNormalizer {
  private transformers: Map<string, (data: any) => NormalizedData> = new Map();
  private validators: Map<string, (data: any) => boolean> = new Map();

  /**
   * 注册数据转换器
   */
  registerTransformer(type: string, transformer: (data: any) => NormalizedData): void {
    this.transformers.set(type, transformer);
  }

  /**
   * 注册数据验证器
   */
  registerValidator(type: string, validator: (data: any) => boolean): void {
    this.validators.set(type, validator);
  }

  /**
   * 归一化数据
   */
  normalize(
    data: any,
    type: string,
    format: string,
    source: string,
    metadata?: Record<string, any>
  ): NormalizedData {
    const transformer = this.transformers.get(type);
    let normalizedData: NormalizedData;

    if (transformer) {
      normalizedData = transformer(data);
    } else {
      normalizedData = {
        type,
        format,
        data,
        metadata: {
          source,
          timestamp: new Date(),
          validated: false,
          ...metadata
        }
      };
    }

    // 验证数据
    const validator = this.validators.get(type);
    if (validator) {
      normalizedData.metadata.validated = validator(data);
    }

    return normalizedData;
  }

  /**
   * 批量归一化
   */
  normalizeBatch(
    items: Array<{ data: any; type: string; format: string; source: string; metadata?: Record<string, any> }>
  ): NormalizedData[] {
    return items.map(item => this.normalize(item.data, item.type, item.format, item.source, item.metadata));
  }

  /**
   * 数据转换链
   */
  transformChain(data: any, transforms: string[]): any {
    let result = data;
    for (const transformName of transforms) {
      const transformer = this.transformers.get(transformName);
      if (transformer) {
        result = transformer(result).data;
      }
    }
    return result;
  }
}

/**
 * 仓库解析器 - 解析GitHub等仓库URL
 */
export class RepositoryParser {
  /**
   * 解析仓库URL
   */
  parseUrl(url: string): RepositoryInfo | null {
    let match: RegExpMatchArray | null;

    // GitHub
    match = url.match(/^https?:\/\/github\.com\/([^\/]+)\/([^\/]+)(\/.*)?$/);
    if (match) {
      return {
        type: 'github',
        owner: match[1],
        repo: match[2],
        url,
        rawUrl: `https://raw.githubusercontent.com/${match[1]}/${match[2]}/main/`
      };
    }

    // Gist
    match = url.match(/^https?:\/\/gist\.github\.com\/([^\/]+)\/([^\/]+)$/);
    if (match) {
      return {
        type: 'gist',
        owner: match[1],
        id: match[2],
        url,
        rawUrl: `https://gist.githubusercontent.com/${match[1]}/${match[2]}/raw/`
      };
    }

    // GitLab
    match = url.match(/^https?:\/\/gitlab\.com\/([^\/]+)\/([^\/]+)(\/.*)?$/);
    if (match) {
      return {
        type: 'gitlab',
        owner: match[1],
        repo: match[2],
        url,
        rawUrl: `https://gitlab.com/${match[1]}/${match[2]}/-/raw/main/`
      };
    }

    // Skill.sh
    match = url.match(/^https?:\/\/skill\.sh\/([^\/]+)$/);
    if (match) {
      return {
        type: 'skillsh',
        id: match[1],
        url
      };
    }

    // SkillHub.cn
    match = url.match(/^https?:\/\/skillhub\.cn\/([^\/]+)$/);
    if (match) {
      return {
        type: 'skillhub',
        id: match[1],
        url
      };
    }

    // SkillHub.cn with path
    match = url.match(/^https?:\/\/skillhub\.cn\/skills\/([^\/]+)$/);
    if (match) {
      return {
        type: 'skillhub',
        id: match[1],
        url
      };
    }

    // 腾讯 SkillHub: skillhub.cloud.tencent.com/skills/{owner}/{name}
    match = url.match(/^https?:\/\/skillhub\.cloud\.tencent\.com\/skills\/([^\/]+)\/([^\/]+)$/);
    if (match) {
      return {
        type: 'tencent_skillhub',
        owner: match[1],
        id: match[2],
        url
      };
    }

    // 腾讯 SkillHub 简化格式: skillhub.cloud.tencent.com/{owner}/{name}
    match = url.match(/^https?:\/\/skillhub\.cloud\.tencent\.com\/([^\/]+)\/([^\/]+)$/);
    if (match && match[1] !== 'skills' && match[1] !== 'developers' && match[1] !== 'about') {
      return {
        type: 'tencent_skillhub',
        owner: match[1],
        id: match[2],
        url
      };
    }

    // skillshub.wtf 格式
    match = url.match(/^https?:\/\/skillshub\.wtf\/([^\/]+)\/([^\/]+)$/);
    if (match) {
      return {
        type: 'skillhub_wtf',
        owner: match[1],
        id: match[2],
        url
      };
    }

    // 本地 .skills 目录格式: .skills/{skill-name} 或 /path/to/.skills/{skill-name}
    match = url.match(/^\.?\.?\/.*?\.skills\/([^\/]+)$/);
    if (match) {
      return {
        type: 'local',
        id: match[1],
        repo: match[1],
        url
      };
    }

    return null;
  }

  /**
   * 检查URL是否是技能仓库
   */
  isSkillRepository(url: string): boolean {
    const info = this.parseUrl(url);
    return info !== null;
  }
}
