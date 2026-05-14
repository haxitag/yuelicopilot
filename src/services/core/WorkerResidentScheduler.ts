/**
 * Worker Resident Scheduler - Worker常驻调度系统
 * 基于Hermes-agent的Scheduled Automations设计
 * 支持常驻任务调度、自动重试、状态监控
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';
import cron from 'node-cron';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface WorkerTask {
  id: string;
  name: string;
  description?: string;
  cron: string;
  skillName: string;
  args: Record<string, any>;
  enabled: boolean;
  persistent: boolean;
  retryPolicy: RetryPolicy;
  notification: NotificationConfig;
  createdAt: Date;
  lastRun?: Date;
  nextRun?: Date;
  lastResult?: WorkerResult;
  lastError?: string;
  runCount: number;
  successCount: number;
  failureCount: number;
  avgDurationMs: number;
  consecutiveFailures: number;
}

export interface RetryPolicy {
  enabled: boolean;
  maxRetries: number;
  retryDelayMs: number;
  backoffMultiplier: number;
}

export interface NotificationConfig {
  enabled: boolean;
  onSuccess: boolean;
  onFailure: boolean;
  channels: ('log' | 'webhook' | 'email')[];
  webhookUrl?: string;
}

export interface WorkerResult {
  success: boolean;
  output?: string;
  error?: string;
  durationMs: number;
  timestamp: Date;
  retryAttempt?: number;
}

export interface CreateWorkerTaskRequest {
  name: string;
  description?: string;
  cron: string;
  skillName: string;
  args?: Record<string, any>;
  enabled?: boolean;
  persistent?: boolean;
  retryPolicy?: Partial<RetryPolicy>;
  notification?: Partial<NotificationConfig>;
}

export interface WorkerStats {
  totalTasks: number;
  enabledTasks: number;
  runningTasks: number;
  totalRuns: number;
  totalSuccess: number;
  totalFailure: number;
  avgSuccessRate: number;
  avgDurationMs: number;
}

interface WorkerStore {
  tasks: WorkerTask[];
  lastCleanup: Date;
}

class WorkerResidentScheduler extends EventEmitter {
  private static instance: WorkerResidentScheduler;
  private storePath: string;
  private store: WorkerStore = { tasks: [], lastCleanup: new Date() };
  private cronJobs: Map<string, any> = new Map();
  private runningTasks: Set<string> = new Set();
  private isRunning = false;
  private skillExecutor?: any;

  private constructor() {
    super();
    this.storePath = path.join(__dirname, '../../../data/worker_tasks.json');
    this.loadStore();
  }

  static getInstance(): WorkerResidentScheduler {
    if (!WorkerResidentScheduler.instance) {
      WorkerResidentScheduler.instance = new WorkerResidentScheduler();
    }
    return WorkerResidentScheduler.instance;
  }

  setSkillExecutor(executor: any): void {
    this.skillExecutor = executor;
  }

  private async loadStore(): Promise<void> {
    try {
      const dir = path.dirname(this.storePath);
      await fs.mkdir(dir, { recursive: true });
      const data = await fs.readFile(this.storePath, 'utf-8');
      const parsed = JSON.parse(data);
      this.store = {
        tasks: (parsed.tasks || []).map((t: any) => ({
          ...t,
          createdAt: new Date(t.createdAt),
          lastRun: t.lastRun ? new Date(t.lastRun) : undefined,
          nextRun: t.nextRun ? new Date(t.nextRun) : undefined,
          lastResult: t.lastResult ? {
            ...t.lastResult,
            timestamp: new Date(t.lastResult.timestamp)
          } : undefined
        })),
        lastCleanup: new Date(parsed.lastCleanup || Date.now())
      };
    } catch {
      this.store = { tasks: [], lastCleanup: new Date() };
    }
  }

  private async saveStore(): Promise<void> {
    try {
      const dir = path.dirname(this.storePath);
      await fs.mkdir(dir, { recursive: true });
      this.store.lastCleanup = new Date();
      await fs.writeFile(this.storePath, JSON.stringify(this.store, null, 2));
    } catch (e) {
      console.error('[WorkerResidentScheduler] Failed to save store:', e);
    }
  }

  async createTask(request: CreateWorkerTaskRequest): Promise<WorkerTask> {
    const task: WorkerTask = {
      id: `worker_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: request.name,
      description: request.description,
      cron: request.cron,
      skillName: request.skillName,
      args: request.args || {},
      enabled: request.enabled ?? true,
      persistent: request.persistent ?? true,
      retryPolicy: {
        enabled: request.retryPolicy?.enabled ?? true,
        maxRetries: request.retryPolicy?.maxRetries ?? 3,
        retryDelayMs: request.retryPolicy?.retryDelayMs ?? 5000,
        backoffMultiplier: request.retryPolicy?.backoffMultiplier ?? 2
      },
      notification: {
        enabled: request.notification?.enabled ?? false,
        onSuccess: request.notification?.onSuccess ?? false,
        onFailure: request.notification?.onFailure ?? true,
        channels: request.notification?.channels ?? ['log'],
        webhookUrl: request.notification?.webhookUrl
      },
      createdAt: new Date(),
      runCount: 0,
      successCount: 0,
      failureCount: 0,
      avgDurationMs: 0,
      consecutiveFailures: 0
    };

    this.store.tasks.push(task);
    await this.saveStore();

    if (task.enabled && cron.validate(task.cron)) {
      this.scheduleTask(task);
    }

    this.emit('task:created', task);
    return task;
  }

  async updateTask(taskId: string, updates: Partial<CreateWorkerTaskRequest>): Promise<WorkerTask | null> {
    const task = this.store.tasks.find(t => t.id === taskId);
    if (!task) return null;

    if (updates.name !== undefined) task.name = updates.name;
    if (updates.description !== undefined) task.description = updates.description;
    if (updates.cron !== undefined) task.cron = updates.cron;
    if (updates.skillName !== undefined) task.skillName = updates.skillName;
    if (updates.args !== undefined) task.args = updates.args;
    if (updates.enabled !== undefined) task.enabled = updates.enabled;
    if (updates.persistent !== undefined) task.persistent = updates.persistent;
    if (updates.retryPolicy !== undefined) {
      task.retryPolicy = { ...task.retryPolicy, ...updates.retryPolicy };
    }
    if (updates.notification !== undefined) {
      task.notification = { ...task.notification, ...updates.notification };
    }

    this.cronJobs.get(taskId)?.stop();
    this.cronJobs.delete(taskId);

    if (task.enabled && cron.validate(task.cron)) {
      this.scheduleTask(task);
    }

    await this.saveStore();
    this.emit('task:updated', task);
    return task;
  }

  async deleteTask(taskId: string): Promise<boolean> {
    const index = this.store.tasks.findIndex(t => t.id === taskId);
    if (index < 0) return false;

    this.cronJobs.get(taskId)?.stop();
    this.cronJobs.delete(taskId);
    this.runningTasks.delete(taskId);

    const removed = this.store.tasks.splice(index, 1)[0];
    await this.saveStore();
    this.emit('task:deleted', removed);
    return true;
  }

  async enableTask(taskId: string): Promise<boolean> {
    const task = this.store.tasks.find(t => t.id === taskId);
    if (!task) return false;

    task.enabled = true;
    if (cron.validate(task.cron)) {
      this.scheduleTask(task);
    }

    await this.saveStore();
    this.emit('task:enabled', task);
    return true;
  }

  async disableTask(taskId: string): Promise<boolean> {
    const task = this.store.tasks.find(t => t.id === taskId);
    if (!task) return false;

    task.enabled = false;
    this.cronJobs.get(taskId)?.stop();
    this.cronJobs.delete(taskId);

    await this.saveStore();
    this.emit('task:disabled', task);
    return true;
  }

  private scheduleTask(task: WorkerTask): void {
    if (this.cronJobs.has(task.id)) {
      this.cronJobs.get(task.id)?.stop();
    }

    const cronJob = cron.schedule(task.cron, async () => {
      await this.executeTask(task.id);
    });

    this.cronJobs.set(task.id, cronJob);
    cronJob.start();

    task.nextRun = new Date(Date.now() + 60000);
  }

  async executeTask(taskId: string, manualTrigger = false): Promise<WorkerResult | null> {
    const task = this.store.tasks.find(t => t.id === taskId);
    if (!task) return null;

    if (this.runningTasks.has(taskId) && !manualTrigger) {
      console.log(`[WorkerResidentScheduler] Task ${task.name} is already running, skipping`);
      return null;
    }

    this.runningTasks.add(taskId);
    this.emit('task:running', task);

    let lastError: string | undefined;
    let retryAttempt = 0;
    const maxRetries = task.retryPolicy.enabled ? task.retryPolicy.maxRetries : 0;
    const startTime = Date.now();

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      retryAttempt = attempt;
      const attemptStartTime = Date.now();

      try {
        if (this.skillExecutor) {
          const result = await this.skillExecutor.executeSkill(task.skillName, task.args);
          const durationMs = Date.now() - attemptStartTime;

          if (result.success) {
            const resultObj: WorkerResult = {
              success: true,
              output: JSON.stringify(result.result),
              durationMs,
              timestamp: new Date(),
              retryAttempt
            };

            task.lastResult = resultObj;
            task.lastRun = new Date();
            task.runCount++;
            task.successCount++;
            task.consecutiveFailures = 0;
            task.avgDurationMs = (task.avgDurationMs * (task.runCount - 1) + durationMs) / task.runCount;
            task.nextRun = new Date(Date.now() + 60000);

            await this.saveStore();
            this.runningTasks.delete(taskId);
            this.emit('task:completed', task, resultObj);
            this.emitNotification(task, resultObj);

            return resultObj;
          } else {
            lastError = result.error || 'Unknown error';
          }
        } else {
          await new Promise(resolve => setTimeout(resolve, 1000));
          const durationMs = Date.now() - attemptStartTime;
          
          const resultObj: WorkerResult = {
            success: true,
            output: `Task ${task.name} executed (no executor configured)`,
            durationMs,
            timestamp: new Date(),
            retryAttempt
          };

          task.lastResult = resultObj;
          task.lastRun = new Date();
          task.runCount++;
          task.successCount++;
          task.consecutiveFailures = 0;

          await this.saveStore();
          this.runningTasks.delete(taskId);
          this.emit('task:completed', task, resultObj);

          return resultObj;
        }
      } catch (error: any) {
        lastError = error.message || String(error);
      }

      if (attempt < maxRetries) {
        const delay = task.retryPolicy.retryDelayMs * 
          Math.pow(task.retryPolicy.backoffMultiplier, attempt);
        console.log(`[WorkerResidentScheduler] Task ${task.name} failed, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    const durationMs = Date.now() - startTime;
    const resultObj: WorkerResult = {
      success: false,
      error: lastError,
      durationMs,
      timestamp: new Date(),
      retryAttempt
    };

    task.lastResult = resultObj;
    task.lastError = lastError;
    task.lastRun = new Date();
    task.runCount++;
    task.failureCount++;
    task.consecutiveFailures++;
    task.nextRun = new Date(Date.now() + 60000);

    await this.saveStore();
    this.runningTasks.delete(taskId);
    this.emit('task:failed', task, resultObj);
    this.emitNotification(task, resultObj);

    return resultObj;
  }

  private async emitNotification(task: WorkerTask, result: WorkerResult): Promise<void> {
    if (!task.notification.enabled) return;
    if (result.success && !task.notification.onSuccess) return;
    if (!result.success && !task.notification.onFailure) return;

    for (const channel of task.notification.channels) {
      switch (channel) {
        case 'log':
          if (result.success) {
            console.log(`[WorkerResidentScheduler] Task ${task.name} succeeded:`, result.output);
          } else {
            console.error(`[WorkerResidentScheduler] Task ${task.name} failed:`, result.error);
          }
          break;
        case 'webhook':
          if (task.notification.webhookUrl) {
            try {
              await fetch(task.notification.webhookUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ task, result })
              });
            } catch (e) {
              console.error('[WorkerResidentScheduler] Webhook notification failed:', e);
            }
          }
          break;
      }
    }
  }

  async runTaskNow(taskId: string): Promise<WorkerResult | null> {
    const task = this.store.tasks.find(t => t.id === taskId);
    if (!task) return null;

    this.emit('task:manual_trigger', task);
    return this.executeTask(taskId, true);
  }

  getTask(taskId: string): WorkerTask | undefined {
    return this.store.tasks.find(t => t.id === taskId);
  }

  getAllTasks(): WorkerTask[] {
    return [...this.store.tasks];
  }

  getEnabledTasks(): WorkerTask[] {
    return this.store.tasks.filter(t => t.enabled);
  }

  getRunningTasks(): string[] {
    return Array.from(this.runningTasks);
  }

  getStats(): WorkerStats {
    const tasks = this.store.tasks;
    const enabledTasks = tasks.filter(t => t.enabled);
    const totalRuns = tasks.reduce((sum, t) => sum + t.runCount, 0);
    const totalSuccess = tasks.reduce((sum, t) => sum + t.successCount, 0);
    const totalFailure = tasks.reduce((sum, t) => sum + t.failureCount, 0);
    const avgSuccessRate = totalRuns > 0 ? totalSuccess / totalRuns : 0;
    const totalDuration = tasks.reduce((sum, t) => sum + t.avgDurationMs * t.runCount, 0);
    const avgDurationMs = totalRuns > 0 ? totalDuration / totalRuns : 0;

    return {
      totalTasks: tasks.length,
      enabledTasks: enabledTasks.length,
      runningTasks: this.runningTasks.size,
      totalRuns,
      totalSuccess,
      totalFailure,
      avgSuccessRate,
      avgDurationMs
    };
  }

  async cleanupOldTasks(olderThanDays = 30): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    const initialCount = this.store.tasks.length;

    this.store.tasks = this.store.tasks.filter(t => {
      if (t.persistent) return true;
      if (!t.lastRun) return true;
      return new Date(t.lastRun) > cutoff;
    });

    await this.saveStore();
    return initialCount - this.store.tasks.length;
  }

  async startAll(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    for (const task of this.store.tasks) {
      if (task.enabled && cron.validate(task.cron)) {
        this.scheduleTask(task);
      }
    }

    console.log(`[WorkerResidentScheduler] Started ${this.cronJobs.size} worker tasks`);
    this.emit('scheduler:started');
  }

  async stopAll(): Promise<void> {
    if (!this.isRunning) return;

    for (const [taskId, cronJob] of this.cronJobs) {
      cronJob.stop();
    }
    this.cronJobs.clear();
    this.isRunning = false;

    console.log('[WorkerResidentScheduler] Stopped all worker tasks');
    this.emit('scheduler:stopped');
  }
}

export const workerResidentScheduler = WorkerResidentScheduler.getInstance();