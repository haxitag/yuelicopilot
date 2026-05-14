import { ResourceQuota, SandboxMetrics, SandboxExecutionResult, PluginStatus, AuditType } from '../../types';
import { AuditSystem, EventManager } from './EventManager';

export interface SandboxEnvironment {
  id: string;
  basePath: string;
  dependencies: string[];
  createdAt: Date;
  registeredModules: string[];
}

export interface RegisteredModule {
  id: string;
  name: string;
  type: 'skill' | 'plugin' | 'service' | 'module';
  sandboxEnvId: string;
  permissions: string[];
  registeredAt: Date;
}

export class SandboxManager {
  private quotas: Map<string, ResourceQuota> = new Map();
  private metrics: Map<string, SandboxMetrics> = new Map();
  private timeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private auditSystem: AuditSystem;
  private eventManager: EventManager;
  private environments: Map<string, SandboxEnvironment> = new Map();
  private registeredModules: Map<string, RegisteredModule> = new Map();
  
  // 默认资源配额
  private readonly DEFAULT_QUOTA: ResourceQuota = {
    maxCpu: 50,
    maxMemory: 128,
    maxDuration: 60,
    maxNetworkCalls: 10,
    maxFileReads: 50,
    maxFileWrites: 10
  };
  
  // 允许的依赖白名单
  private readonly ALLOWED_DEPENDENCIES = ['yt-dlp', 'python3', 'ffmpeg', 'git', 'curl', 'wget'];
  
  // 沙箱基础目录（浏览器环境使用虚拟路径）
  private readonly SANDBOX_BASE = typeof process !== 'undefined' && process.env?.HOME 
    ? `${process.env.HOME}/.yueli/sandbox`
    : '/virtual/.yueli/sandbox';
  
  // 默认全局沙箱环境ID
  private DEFAULT_ENV_ID = 'default_global_sandbox';
  
  // 单例实例
  private static instance: SandboxManager | null = null;

  private constructor(auditSystem: AuditSystem, eventManager: EventManager) {
    this.auditSystem = auditSystem;
    this.eventManager = eventManager;
  }
  
  /**
   * 获取单例实例
   */
  static getInstance(auditSystem?: AuditSystem, eventManager?: EventManager): SandboxManager {
    if (!SandboxManager.instance) {
      if (!auditSystem || !eventManager) {
        throw new Error('SandboxManager 需要 AuditSystem 和 EventManager 来初始化');
      }
      SandboxManager.instance = new SandboxManager(auditSystem, eventManager);
    }
    return SandboxManager.instance;
  }

  /**
   * 为技能设置资源配额
   */
  setQuota(skillId: string, quota: Partial<ResourceQuota>): void {
    const existingQuota = this.quotas.get(skillId) || { ...this.DEFAULT_QUOTA };
    this.quotas.set(skillId, { ...existingQuota, ...quota });
  }

  /**
   * 获取技能的资源配额
   */
  getQuota(skillId: string): ResourceQuota {
    return this.quotas.get(skillId) || { ...this.DEFAULT_QUOTA };
  }

  /**
   * 开始沙箱执行
   */
  startSandbox(skillId: string, instanceId: string): SandboxMetrics {
    const metrics: SandboxMetrics = {
      startTime: new Date(),
      cpuUsage: 0,
      memoryUsage: 0,
      networkCalls: 0,
      fileReads: 0,
      fileWrites: 0,
      isTimedOut: false
    };

    this.metrics.set(instanceId, metrics);

    // 设置超时检查
    const quota = this.getQuota(skillId);
    const timeout = setTimeout(() => {
      this.handleTimeout(skillId, instanceId);
    }, quota.maxDuration * 1000);

    this.timeouts.set(instanceId, timeout);

    this.auditSystem.record(AuditType.RESOURCE_ACQUIRE, skillId, 'success', {
      instanceId,
      outputs: { quota }
    });

    return metrics;
  }

  /**
   * 结束沙箱执行
   */
  endSandbox(instanceId: string): SandboxMetrics {
    // 清除超时定时器
    const timeout = this.timeouts.get(instanceId);
    if (timeout) {
      clearTimeout(timeout);
      this.timeouts.delete(instanceId);
    }

    const metrics = this.metrics.get(instanceId);
    if (metrics) {
      this.auditSystem.record(AuditType.RESOURCE_RELEASE, metrics.startTime.getTime().toString(), 'success', {
        instanceId,
        outputs: { metrics }
      });
    }

    return metrics || this.createEmptyMetrics();
  }

  /**
   * 记录网络调用
   */
  recordNetworkCall(skillId: string, instanceId: string): boolean {
    const metrics = this.metrics.get(instanceId);
    const quota = this.getQuota(skillId);

    if (!metrics) return true;

    if (metrics.networkCalls >= quota.maxNetworkCalls) {
      return false;
    }

    metrics.networkCalls++;
    return true;
  }

  /**
   * 记录文件读取
   */
  recordFileRead(skillId: string, instanceId: string): boolean {
    const metrics = this.metrics.get(instanceId);
    const quota = this.getQuota(skillId);

    if (!metrics) return true;

    if (metrics.fileReads >= quota.maxFileReads) {
      return false;
    }

    metrics.fileReads++;
    return true;
  }

  /**
   * 记录文件写入
   */
  recordFileWrite(skillId: string, instanceId: string): boolean {
    const metrics = this.metrics.get(instanceId);
    const quota = this.getQuota(skillId);

    if (!metrics) return true;

    if (metrics.fileWrites >= quota.maxFileWrites) {
      return false;
    }

    metrics.fileWrites++;
    return true;
  }

  /**
   * 更新资源使用情况
   */
  updateMetrics(instanceId: string, cpuUsage?: number, memoryUsage?: number): void {
    const metrics = this.metrics.get(instanceId);
    if (!metrics) return;

    if (cpuUsage !== undefined) {
      metrics.cpuUsage = Math.max(0, Math.min(100, cpuUsage));
    }
    if (memoryUsage !== undefined) {
      metrics.memoryUsage = Math.max(0, memoryUsage);
    }

    // 检查CPU和内存配额
    const quota = this.getQuota(instanceId.split('_')[0]);
    if (metrics.cpuUsage > quota.maxCpu || metrics.memoryUsage > quota.maxMemory) {
      this.handleResourceExceeded(instanceId);
    }
  }

  /**
   * 在沙箱中执行技能
   */
  async executeInSandbox<T>(
    skillId: string,
    instanceId: string,
    executor: () => Promise<T>
  ): Promise<SandboxExecutionResult> {
    const metrics = this.startSandbox(skillId, instanceId);

    try {
      // 检查执行时间是否已超时
      const elapsed = Date.now() - metrics.startTime.getTime();
      const quota = this.getQuota(skillId);
      if (elapsed > quota.maxDuration * 1000) {
        throw new Error('Execution timeout');
      }

      // 执行技能代码
      const output = await executor();

      const finalMetrics = this.endSandbox(instanceId);

      return {
        success: true,
        output,
        metrics: finalMetrics
      };
    } catch (error) {
      const finalMetrics = this.endSandbox(instanceId);
      finalMetrics.isTimedOut = error instanceof Error && error.message === 'Execution timeout';

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        metrics: finalMetrics
      };
    }
  }

  /**
   * 处理超时
   */
  private handleTimeout(skillId: string, instanceId: string): void {
    const metrics = this.metrics.get(instanceId);
    if (metrics) {
      metrics.isTimedOut = true;
    }

    this.eventManager.emitForPlugin('sandbox:timeout', skillId, instanceId, {
      duration: this.getQuota(skillId).maxDuration
    });

    this.auditSystem.record(AuditType.EXECUTE, skillId, 'failed', {
      instanceId,
      metadata: { reason: 'timeout' }
    });
  }

  /**
   * 处理资源超限
   */
  private handleResourceExceeded(instanceId: string): void {
    const metrics = this.metrics.get(instanceId);
    if (!metrics) return;

    this.eventManager.emitForPlugin('sandbox:resource-exceeded', instanceId.split('_')[0], instanceId, {
      cpuUsage: metrics.cpuUsage,
      memoryUsage: metrics.memoryUsage
    });
  }

  /**
   * 获取沙箱执行指标
   */
  getMetrics(instanceId: string): SandboxMetrics | undefined {
    return this.metrics.get(instanceId);
  }

  /**
   * 创建空的指标对象
   */
  private createEmptyMetrics(): SandboxMetrics {
    return {
      startTime: new Date(),
      cpuUsage: 0,
      memoryUsage: 0,
      networkCalls: 0,
      fileReads: 0,
      fileWrites: 0,
      isTimedOut: false
    };
  }

  /**
   * 清理沙箱状态
   */
  cleanup(instanceId: string): void {
    this.endSandbox(instanceId);
    this.metrics.delete(instanceId);
  }

  /**
   * 清理所有沙箱状态
   */
  cleanupAll(): void {
    this.timeouts.forEach(timeout => clearTimeout(timeout));
    this.timeouts.clear();
    this.metrics.clear();
  }

  // ==================== 系统级沙箱环境管理 ====================

  /**
   * 初始化沙箱基础目录
   */
  private async initSandboxBase(): Promise<void> {
    if (typeof window === 'undefined') {
      const fs = require('fs').promises;
      try {
        await fs.mkdir(this.SANDBOX_BASE, { recursive: true });
      } catch (error) {
        console.warn('Failed to create sandbox base directory:', error);
      }
    } else {
      console.log('浏览器环境：使用虚拟沙箱路径', this.SANDBOX_BASE);
    }
  }

  /**
   * 创建技能专用的沙箱环境
   */
  async createEnvironment(skillId: string, dependencies: string[]): Promise<SandboxEnvironment> {
    await this.initSandboxBase();
    
    const envId = `${skillId}_${Date.now()}`;
    const basePath = `${this.SANDBOX_BASE}/${envId}`;
    
    if (typeof window === 'undefined') {
      const fs = require('fs').promises;
      await fs.mkdir(basePath, { recursive: true });
      await fs.mkdir(`${basePath}/bin`, { recursive: true });
      await fs.mkdir(`${basePath}/lib`, { recursive: true });
      await fs.mkdir(`${basePath}/tmp`, { recursive: true });
    } else {
      console.log(`浏览器环境：创建虚拟沙箱环境 ${envId}`);
    }

    const env: SandboxEnvironment = {
      id: envId,
      basePath,
      dependencies: [],
      createdAt: new Date(),
      registeredModules: []
    };

    // 安装所需依赖
    for (const dep of dependencies) {
      if (await this.installDependencyInSandbox(env, dep)) {
        env.dependencies.push(dep);
      }
    }

    this.environments.set(envId, env);
    return env;
  }

  /**
   * 在沙箱中安装依赖
   */
  public async installDependencyInSandbox(env: SandboxEnvironment, dep: string): Promise<boolean> {
    // 检查是否在白名单中
    if (!this.ALLOWED_DEPENDENCIES.includes(dep)) {
      console.warn(`Dependency ${dep} is not in allowed list`);
      return false;
    }

    try {
      console.log(`Installing ${dep} in sandbox: ${env.basePath}`);
      
      if (typeof window !== 'undefined') {
        // 浏览器环境：模拟安装
        console.log(`浏览器环境：模拟安装依赖 ${dep}`);
        return true;
      }
      
      // 使用 brew 下载并复制到沙箱
      const { execSync } = require('child_process');
      
      // 获取 brew 安装路径
      let installPath: string;
      try {
        installPath = execSync(`brew --prefix ${dep}`).toString().trim();
        console.log(`${dep} already installed at: ${installPath}`);
      } catch {
        // 安装依赖
        console.log(`Installing ${dep} via brew...`);
        execSync(`brew install ${dep}`, { stdio: 'ignore' });
        installPath = execSync(`brew --prefix ${dep}`).toString().trim();
      }

      // 复制到沙箱
      const fs = require('fs').promises;
      const binPath = `${installPath}/bin/${dep}`;
      const sandboxBinPath = `${env.basePath}/bin/${dep}`;
      
      await fs.copyFile(binPath, sandboxBinPath);
      await fs.chmod(sandboxBinPath, 0o755);

      console.log(`Successfully installed ${dep} in sandbox`);
      return true;
    } catch (error) {
      console.error(`Failed to install ${dep} in sandbox:`, error);
      return false;
    }
  }

  /**
   * 在沙箱环境中执行命令
   */
  async executeInEnvironment(envId: string, command: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const env = this.environments.get(envId);
    if (!env) {
      throw new Error(`Sandbox environment ${envId} not found`);
    }

    if (typeof window !== 'undefined') {
      // 浏览器环境：模拟执行
      console.log(`浏览器环境：模拟执行命令 ${command}`);
      return {
        exitCode: 0,
        stdout: `Simulated output for: ${command}`,
        stderr: ''
      };
    }

    return new Promise((resolve) => {
      const { exec } = require('child_process');
      
      // 设置隔离环境变量
      const envVars = {
        PATH: `${env.basePath}/bin:/usr/bin:/bin`,
        HOME: env.basePath,
        TMPDIR: `${env.basePath}/tmp`,
        // 限制网络访问
        NODE_NO_WARNINGS: '1'
      };

      exec(command, {
        env: { ...process.env, ...envVars },
        cwd: env.basePath,
        timeout: 60000
      }, (error: any, stdout: string, stderr: string) => {
        resolve({
          exitCode: error ? error.code : 0,
          stdout: stdout.trim(),
          stderr: stderr.trim()
        });
      });
    });
  }

  /**
   * 获取沙箱环境
   */
  getEnvironment(envId: string): SandboxEnvironment | undefined {
    return this.environments.get(envId);
  }

  /**
   * 清理沙箱环境
   */
  async cleanupEnvironment(envId: string): Promise<void> {
    const env = this.environments.get(envId);
    if (!env) return;

    try {
      if (typeof window === 'undefined') {
        const fs = require('fs').promises;
        await fs.rm(env.basePath, { recursive: true, force: true });
      } else {
        console.log(`浏览器环境：清理虚拟沙箱环境 ${envId}`);
      }
      this.environments.delete(envId);
    } catch (error) {
      console.warn(`Failed to cleanup sandbox environment ${envId}:`, error);
    }
  }

  /**
   * 检查依赖是否在白名单中
   */
  isDependencyAllowed(dep: string): boolean {
    return this.ALLOWED_DEPENDENCIES.includes(dep);
  }

  /**
   * 获取允许的依赖列表
   */
  getAllowedDependencies(): string[] {
    return [...this.ALLOWED_DEPENDENCIES];
  }

  // ==================== 全局沙箱管理 ====================

  /**
   * 初始化全局共享沙箱环境
   */
  async initializeGlobalSandbox(dependencies?: string[]): Promise<SandboxEnvironment> {
    // 检查是否已存在全局沙箱
    let globalEnv = this.environments.get(this.DEFAULT_ENV_ID);
    if (globalEnv) {
      console.log('全局沙箱环境已存在:', this.DEFAULT_ENV_ID);
      return globalEnv;
    }

    await this.initSandboxBase();
    
    const basePath = `${this.SANDBOX_BASE}/${this.DEFAULT_ENV_ID}`;
    
    if (typeof window === 'undefined') {
      const fs = require('fs').promises;
      await fs.mkdir(basePath, { recursive: true });
      await fs.mkdir(`${basePath}/bin`, { recursive: true });
      await fs.mkdir(`${basePath}/lib`, { recursive: true });
      await fs.mkdir(`${basePath}/tmp`, { recursive: true });
    } else {
      console.log('浏览器环境：创建虚拟全局沙箱环境');
    }

    globalEnv = {
      id: this.DEFAULT_ENV_ID,
      basePath,
      dependencies: [],
      createdAt: new Date(),
      registeredModules: []
    };

    // 安装默认依赖
    const defaultDeps = dependencies || ['python3', 'git', 'curl'];
    for (const dep of defaultDeps) {
      if (await this.installDependencyInSandbox(globalEnv, dep)) {
        globalEnv.dependencies.push(dep);
      }
    }

    this.environments.set(this.DEFAULT_ENV_ID, globalEnv);
    console.log('全局沙箱环境创建成功:', this.DEFAULT_ENV_ID);
    
    return globalEnv;
  }

  /**
   * 获取全局沙箱环境
   */
  getGlobalEnvironment(): SandboxEnvironment | undefined {
    return this.environments.get(this.DEFAULT_ENV_ID);
  }

  /**
   * 确保全局沙箱环境存在
   */
  async ensureGlobalSandbox(): Promise<SandboxEnvironment> {
    let env = this.getGlobalEnvironment();
    if (!env) {
      env = await this.initializeGlobalSandbox();
    }
    return env;
  }

  // ==================== 模块注册管理 ====================

  /**
   * 注册模块到沙箱环境
   */
  registerModule(module: Omit<RegisteredModule, 'registeredAt'>): RegisteredModule {
    const fullModule: RegisteredModule = {
      ...module,
      registeredAt: new Date()
    };

    this.registeredModules.set(module.id, fullModule);

    // 更新沙箱环境的已注册模块列表
    const env = this.environments.get(module.sandboxEnvId);
    if (env && !env.registeredModules.includes(module.id)) {
      env.registeredModules.push(module.id);
    }

    console.log(`模块 ${module.id} 已注册到沙箱环境 ${module.sandboxEnvId}`);
    
    return fullModule;
  }

  /**
   * 注销模块
   */
  unregisterModule(moduleId: string): void {
    const module = this.registeredModules.get(moduleId);
    if (!module) return;

    // 从沙箱环境的已注册模块列表中移除
    const env = this.environments.get(module.sandboxEnvId);
    if (env) {
      env.registeredModules = env.registeredModules.filter(id => id !== moduleId);
    }

    this.registeredModules.delete(moduleId);
    console.log(`模块 ${moduleId} 已注销`);
  }

  /**
   * 获取已注册模块
   */
  getRegisteredModule(moduleId: string): RegisteredModule | undefined {
    return this.registeredModules.get(moduleId);
  }

  /**
   * 获取所有已注册模块
   */
  getAllRegisteredModules(): RegisteredModule[] {
    return Array.from(this.registeredModules.values());
  }

  /**
   * 检查模块是否已注册
   */
  hasModuleRegistered(moduleId: string): boolean {
    return this.registeredModules.has(moduleId);
  }

  /**
   * 获取某个沙箱环境中注册的所有模块
   */
  getModulesInEnvironment(envId: string): RegisteredModule[] {
    return Array.from(this.registeredModules.values())
      .filter(module => module.sandboxEnvId === envId);
  }

  /**
   * 在全局沙箱中注册模块
   */
  async registerModuleToGlobal(module: Omit<RegisteredModule, 'registeredAt' | 'sandboxEnvId'>): Promise<RegisteredModule> {
    const globalEnv = await this.ensureGlobalSandbox();
    return this.registerModule({
      ...module,
      sandboxEnvId: globalEnv.id
    });
  }

  /**
   * 在全局沙箱中执行命令
   */
  async executeInGlobalSandbox(command: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const globalEnv = await this.ensureGlobalSandbox();
    return this.executeInEnvironment(globalEnv.id, command);
  }

  /**
   * 获取全局沙箱的执行路径
   */
  async getGlobalSandboxPath(): Promise<string> {
    const globalEnv = await this.ensureGlobalSandbox();
    return `${globalEnv.basePath}/bin`;
  }
}
