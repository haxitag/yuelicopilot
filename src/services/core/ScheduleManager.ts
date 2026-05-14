import {
  ScheduleTask,
  ScheduleConfig,
  ScheduleStatus,
  ScheduleStrategy,
  TaskCallback,
  StatusCallbackRegistration,
  PluginStatus,
  ExecutionState,
  PluginEvent,
  UpdateScheduleConfig
} from '../../types';

/**
 * 定时任务管理器
 * 负责技能/连接器的定时执行、回调管理和状态更新
 */
export class ScheduleManager {
  private tasks: Map<string, ScheduleTask> = new Map();
  private timers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private statusCallbacks: Map<string, StatusCallbackRegistration[]> = new Map();
  private updateSchedules: Map<string, UpdateScheduleConfig> = new Map();
  private updateTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private executionQueue: Set<string> = new Set();
  private isRunning: boolean = false;

  constructor() {
    this.startLoop();
  }

  /**
   * 创建定时任务
   */
  createTask(options: {
    pluginId: string;
    pluginType: 'skill' | 'connector';
    name: string;
    description?: string;
    config: ScheduleConfig;
    callback?: TaskCallback;
    metadata?: Record<string, any>;
  }): ScheduleTask {
    const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const task: ScheduleTask = {
      taskId,
      pluginId: options.pluginId,
      pluginType: options.pluginType,
      name: options.name,
      description: options.description,
      config: options.config,
      status: ScheduleStatus.PENDING,
      callback: options.callback,
      createdAt: new Date(),
      updatedAt: new Date(),
      executionCount: 0,
      metadata: options.metadata
    };

    // 计算下次执行时间
    task.nextExecuteTime = this.calculateNextExecuteTime(task);
    
    this.tasks.set(taskId, task);
    
    return task;
  }

  /**
   * 启动任务
   */
  async startTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    if (task.status === ScheduleStatus.RUNNING) {
      return;
    }

    task.status = ScheduleStatus.RUNNING;
    task.updatedAt = new Date();
    
    this.scheduleTask(task);
  }

  /**
   * 暂停任务
   */
  pauseTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    task.status = ScheduleStatus.PAUSED;
    task.updatedAt = new Date();
    
    const timer = this.timers.get(taskId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(taskId);
    }
  }

  /**
   * 恢复任务
   */
  resumeTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    task.status = ScheduleStatus.RUNNING;
    task.updatedAt = new Date();
    
    this.scheduleTask(task);
  }

  /**
   * 取消任务
   */
  cancelTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      return;
    }

    task.status = ScheduleStatus.CANCELLED;
    task.updatedAt = new Date();
    
    const timer = this.timers.get(taskId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(taskId);
    }
  }

  /**
   * 删除任务
   */
  deleteTask(taskId: string): void {
    this.cancelTask(taskId);
    this.tasks.delete(taskId);
  }

  /**
   * 获取任务
   */
  getTask(taskId: string): ScheduleTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * 获取所有任务
   */
  getAllTasks(): ScheduleTask[] {
    return Array.from(this.tasks.values());
  }

  /**
   * 获取插件的任务
   */
  getPluginTasks(pluginId: string): ScheduleTask[] {
    return Array.from(this.tasks.values()).filter(t => t.pluginId === pluginId);
  }

  /**
   * 立即执行任务
   */
  async executeTaskNow(taskId: string, context: any = {}): Promise<any> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    return this.executeTask(task, context);
  }

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
    const id = `callback_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const registration: StatusCallbackRegistration = {
      id,
      pluginId,
      pluginType,
      events,
      callback,
      once: options.once,
      createdAt: new Date()
    };

    if (!this.statusCallbacks.has(pluginId)) {
      this.statusCallbacks.set(pluginId, []);
    }
    
    this.statusCallbacks.get(pluginId)!.push(registration);
    
    return id;
  }

  /**
   * 注销状态回调
   */
  unregisterStatusCallback(callbackId: string): void {
    for (const [pluginId, callbacks] of this.statusCallbacks.entries()) {
      const index = callbacks.findIndex(c => c.id === callbackId);
      if (index !== -1) {
        callbacks.splice(index, 1);
        if (callbacks.length === 0) {
          this.statusCallbacks.delete(pluginId);
        }
        break;
      }
    }
  }

  /**
   * 触发状态回调
   */
  async triggerStatusCallbacks(
    pluginId: string,
    state: ExecutionState,
    event: PluginEvent
  ): Promise<void> {
    const callbacks = this.statusCallbacks.get(pluginId);
    if (!callbacks) {
      return;
    }

    const toRemove: string[] = [];
    
    for (const registration of callbacks) {
      if (registration.events.includes(state.status)) {
        try {
          await registration.callback(state, event);
          if (registration.once) {
            toRemove.push(registration.id);
          }
        } catch (error) {
          console.error(`Error in status callback for ${pluginId}:`, error);
        }
      }
    }

    // 移除一次性回调
    for (const id of toRemove) {
      this.unregisterStatusCallback(id);
    }
  }

  /**
   * 注册定时更新
   */
  registerUpdateSchedule(config: UpdateScheduleConfig): string {
    const id = `update_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const scheduleConfig = {
      ...config,
      enabled: config.enabled !== false
    };
    
    this.updateSchedules.set(id, scheduleConfig);
    
    if (scheduleConfig.enabled) {
      this.startUpdateSchedule(id);
    }
    
    return id;
  }

  /**
   * 取消定时更新
   */
  unregisterUpdateSchedule(scheduleId: string): void {
    const timer = this.updateTimers.get(scheduleId);
    if (timer) {
      clearInterval(timer);
      this.updateTimers.delete(scheduleId);
    }
    this.updateSchedules.delete(scheduleId);
  }

  /**
   * 启用定时更新
   */
  enableUpdateSchedule(scheduleId: string): void {
    const schedule = this.updateSchedules.get(scheduleId);
    if (!schedule) {
      throw new Error(`Update schedule ${scheduleId} not found`);
    }
    
    schedule.enabled = true;
    this.startUpdateSchedule(scheduleId);
  }

  /**
   * 禁用定时更新
   */
  disableUpdateSchedule(scheduleId: string): void {
    const schedule = this.updateSchedules.get(scheduleId);
    if (!schedule) {
      return;
    }
    
    schedule.enabled = false;
    const timer = this.updateTimers.get(scheduleId);
    if (timer) {
      clearInterval(timer);
      this.updateTimers.delete(scheduleId);
    }
  }

  /**
   * 启动主循环
   */
  private startLoop(): void {
    if (this.isRunning) {
      return;
    }
    
    this.isRunning = true;
    
    // 每秒检查一次待执行任务
    const loopInterval = setInterval(() => {
      this.checkAndExecuteTasks();
    }, 1000);
    
    // 保存定时器引用以便清理
    if (typeof window !== 'undefined') {
      (window as any).__scheduleLoopInterval = loopInterval;
    }
  }

  /**
   * 检查并执行待执行任务
   */
  private checkAndExecuteTasks(): void {
    const now = Date.now();
    
    for (const [taskId, task] of this.tasks.entries()) {
      if (task.status !== ScheduleStatus.RUNNING) {
        continue;
      }
      
      if (!task.nextExecuteTime) {
        continue;
      }
      
      if (task.nextExecuteTime.getTime() <= now && !this.executionQueue.has(taskId)) {
        this.executionQueue.add(taskId);
        this.executeTask(task, {}).finally(() => {
          this.executionQueue.delete(taskId);
        });
      }
    }
  }

  /**
   * 安排任务下次执行
   */
  private scheduleTask(task: ScheduleTask): void {
    // 清除现有定时器
    const existingTimer = this.timers.get(task.taskId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    
    if (!task.nextExecuteTime) {
      return;
    }
    
    const delay = Math.max(0, task.nextExecuteTime.getTime() - Date.now());
    
    const timer = setTimeout(() => {
      if (task.status === ScheduleStatus.RUNNING && !this.executionQueue.has(task.taskId)) {
        this.executionQueue.add(task.taskId);
        this.executeTask(task, {}).finally(() => {
          this.executionQueue.delete(task.taskId);
        });
      }
    }, delay);
    
    this.timers.set(task.taskId, timer);
  }

  /**
   * 执行任务
   */
  private async executeTask(task: ScheduleTask, context: any): Promise<any> {
    let result: any;
    let error: Error | undefined;
    let retryCount = 0;
    
    // 更新任务状态
    task.lastExecuteTime = new Date();
    task.executionCount++;
    task.updatedAt = new Date();
    
    // 触发开始回调
    if (task.callback?.onStart) {
      try {
        await task.callback.onStart(task, context);
      } catch (e) {
        console.error('Error in onStart callback:', e);
      }
    }

    while (true) {
      try {
        // 这里应该调用实际的插件执行
        // 暂时用占位符，实际需要集成到CoreOrchestrator
        result = await this.executePlugin(task, context);
        
        // 触发进度回调
        if (task.callback?.onProgress) {
          try {
            await task.callback.onProgress(task, 100, 'Executed');
          } catch (e) {
            console.error('Error in onProgress callback:', e);
          }
        }
        
        break;
      } catch (e) {
        error = e as Error;
        
        // 触发错误回调
        if (task.callback?.onError) {
          try {
            await task.callback.onError(task, error);
          } catch (cbError) {
            console.error('Error in onError callback:', cbError);
          }
        }
        
        // 检查是否需要重试
        const maxRetries = task.config.maxRetries || 0;
        if (retryCount >= maxRetries) {
          task.status = ScheduleStatus.FAILED;
          break;
        }
        
        retryCount++;
        
        // 触发重试回调
        if (task.callback?.onRetry) {
          try {
            await task.callback.onRetry(task, retryCount, error);
          } catch (cbError) {
            console.error('Error in onRetry callback:', cbError);
          }
        }
        
        // 等待一段时间后重试
        await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
      }
    }

    // 计算下次执行时间
    task.nextExecuteTime = this.calculateNextExecuteTime(task);
    
    // 根据策略决定任务状态
    if (task.config.strategy === ScheduleStrategy.ONCE) {
      task.status = error ? ScheduleStatus.FAILED : ScheduleStatus.COMPLETED;
    }
    
    task.updatedAt = new Date();
    
    // 触发完成回调
    if (task.callback?.onComplete) {
      try {
        await task.callback.onComplete(task, result);
      } catch (e) {
        console.error('Error in onComplete callback:', e);
      }
    }
    
    // 如果需要继续执行，重新安排
    if (task.status === ScheduleStatus.RUNNING) {
      this.scheduleTask(task);
    }
    
    if (error) {
      throw error;
    }
    
    return result;
  }

  /**
   * 执行插件（占位方法，实际需集成到CoreOrchestrator）
   */
  private async executePlugin(task: ScheduleTask, context: any): Promise<any> {
    // 这里只是占位，实际应该调用CoreOrchestrator的processInput或类似方法
    console.log(`Executing ${task.pluginType} ${task.pluginId}:`, task.name);
    return { success: true, task: task.taskId };
  }

  /**
   * 计算下次执行时间
   */
  private calculateNextExecuteTime(task: ScheduleTask): Date {
    const now = new Date();
    
    switch (task.config.strategy) {
      case ScheduleStrategy.ONCE:
        // 一次性任务不安排下次执行
        return task.lastExecuteTime || now;
        
      case ScheduleStrategy.INTERVAL:
        if (task.config.interval) {
          return new Date(now.getTime() + task.config.interval);
        }
        return now;
        
      case ScheduleStrategy.REPEAT:
        if (task.config.repeatCount && task.executionCount >= task.config.repeatCount) {
          return now;
        }
        if (task.config.interval) {
          return new Date(now.getTime() + task.config.interval);
        }
        return now;
        
      case ScheduleStrategy.CRON:
        // Cron表达式解析（简化实现）
        return this.parseCronExpression(task.config.cronExpression || '', now);
        
      default:
        return now;
    }
  }

  /**
   * 解析Cron表达式（简化实现）
   */
  private parseCronExpression(cron: string, now: Date): Date {
    // 简化的Cron解析，实际项目可以使用cron-parser等库
    const parts = cron.split(' ');
    if (parts.length < 5) {
      return new Date(now.getTime() + 60000); // 默认1分钟后
    }
    
    // 暂时简化处理，实际需要完整的Cron解析
    return new Date(now.getTime() + 60000);
  }

  /**
   * 启动更新定时器
   */
  private startUpdateSchedule(scheduleId: string): void {
    const schedule = this.updateSchedules.get(scheduleId);
    if (!schedule || !schedule.enabled) {
      return;
    }
    
    // 先取消现有定时器
    const existingTimer = this.updateTimers.get(scheduleId);
    if (existingTimer) {
      clearInterval(existingTimer);
    }
    
    // 创建新定时器
    const timer = setInterval(async () => {
      try {
        // 执行更新
        const data = await this.executeUpdate(schedule);
        if (schedule.callback) {
          await schedule.callback(data);
        }
      } catch (error) {
        console.error(`Error in update schedule ${scheduleId}:`, error);
      }
    }, schedule.interval);
    
    this.updateTimers.set(scheduleId, timer);
  }

  /**
   * 执行更新（占位方法）
   */
  private async executeUpdate(schedule: UpdateScheduleConfig): Promise<any> {
    console.log(`Updating ${schedule.pluginType} ${schedule.pluginId}`);
    return { updated: true, timestamp: new Date() };
  }

  /**
   * 清理所有资源
   */
  destroy(): void {
    this.isRunning = false;
    
    // 清除所有任务定时器
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
    
    // 清除所有更新定时器
    for (const timer of this.updateTimers.values()) {
      clearInterval(timer);
    }
    this.updateTimers.clear();
    
    // 清除主循环
    if (typeof window !== 'undefined') {
      const loopInterval = (window as any).__scheduleLoopInterval;
      if (loopInterval) {
        clearInterval(loopInterval);
        delete (window as any).__scheduleLoopInterval;
      }
    }
  }
}