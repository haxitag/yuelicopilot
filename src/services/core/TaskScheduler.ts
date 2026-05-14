/**
 * Task Scheduler - 定时任务调度系统
 * 核心功能：
 * 1. 管理定时任务的创建、删除、启用/禁用
 * 2. 支持 Cron 表达式
 * 3. 任务结果通过回调或WebSocket通知
 * 4. 支持自然语言创建任务
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';
import cron from 'node-cron';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface ScheduledTask {
  id: string;
  name: string;
  description?: string;
  cron: string;
  skillName: string;
  args: Record<string, any>;
  enabled: boolean;
  createdAt: Date;
  lastRun?: Date;
  nextRun?: Date;
  lastResult?: TaskResult;
  lastError?: string;
  runCount: number;
}

export interface TaskResult {
  success: boolean;
  output?: string;
  error?: string;
  durationMs: number;
  timestamp: Date;
}

export interface CreateTaskRequest {
  name: string;
  description?: string;
  cron: string;
  skillName: string;
  args?: Record<string, any>;
  enabled?: boolean;
}

class TaskScheduler extends EventEmitter {
  private static instance: TaskScheduler;
  private tasks: Map<string, ScheduledTask> = new Map();
  private cronJobs: Map<string, any> = new Map();
  private storePath: string;
  private skillExecutor?: any;
  private isRunning = false;

  private constructor() {
    super();
    this.storePath = path.join(__dirname, '../../../data/scheduled_tasks.json');
    this.loadTasks();
  }

  static getInstance(): TaskScheduler {
    if (!TaskScheduler.instance) {
      TaskScheduler.instance = new TaskScheduler();
    }
    return TaskScheduler.instance;
  }

  setSkillExecutor(executor: any): void {
    this.skillExecutor = executor;
  }

  private async loadTasks(): Promise<void> {
    try {
      const dir = path.dirname(this.storePath);
      await fs.mkdir(dir, { recursive: true });
      const data = await fs.readFile(this.storePath, 'utf-8');
      const parsed = JSON.parse(data);

      for (const task of parsed.tasks || []) {
        task.createdAt = new Date(task.createdAt);
        task.lastRun = task.lastRun ? new Date(task.lastRun) : undefined;
        task.nextRun = task.nextRun ? new Date(task.nextRun) : undefined;
        task.lastResult = task.lastResult ? {
          ...task.lastResult,
          timestamp: new Date(task.lastResult.timestamp)
        } : undefined;

        this.tasks.set(task.id, task);

        if (task.enabled && cron.validate(task.cron)) {
          this.scheduleTask(task);
        }
      }

      console.log(`[TaskScheduler] Loaded ${this.tasks.size} tasks`);
    } catch {
      console.log('[TaskScheduler] No existing tasks found');
    }
  }

  private async saveTasks(): Promise<void> {
    try {
      const dir = path.dirname(this.storePath);
      await fs.mkdir(dir, { recursive: true });
      const tasksArray = Array.from(this.tasks.values());
      await fs.writeFile(this.storePath, JSON.stringify({ tasks: tasksArray }, null, 2));
    } catch (e) {
      console.error('[TaskScheduler] Failed to save tasks:', e);
    }
  }

  private scheduleTask(task: ScheduledTask): void {
    if (this.cronJobs.has(task.id)) {
      this.cronJobs.get(task.id)?.stop();
    }

    try {
      const cronJob = cron.schedule(task.cron, async () => {
        await this.executeTask(task);
      });

      this.cronJobs.set(task.id, cronJob);
      task.nextRun = this.getNextRunTime(task.cron);

    } catch (e) {
      console.error(`[TaskScheduler] Failed to schedule task ${task.id}:`, e);
    }
  }

  private getNextRunTime(cronExpression: string): Date | undefined {
    try {
      const cronToText = (expr: string): string => {
        const parts = expr.split(' ');
        if (parts.length !== 5) return 'unknown';
        const [min, hour, day, month, dow] = parts;
        return `At ${min} minutes, ${hour} hours`;
      };
      const now = new Date();
      return new Date(now.getTime() + 60000);
    } catch {
      return undefined;
    }
  }

  async createTask(request: CreateTaskRequest): Promise<ScheduledTask> {
    if (!cron.validate(request.cron)) {
      throw new Error(`Invalid cron expression: ${request.cron}`);
    }

    const id = `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const task: ScheduledTask = {
      id,
      name: request.name,
      description: request.description,
      cron: request.cron,
      skillName: request.skillName,
      args: request.args || {},
      enabled: request.enabled ?? true,
      createdAt: new Date(),
      runCount: 0,
      nextRun: this.getNextRunTime(request.cron)
    };

    this.tasks.set(id, task);

    if (task.enabled) {
      this.scheduleTask(task);
    }

    await this.saveTasks();
    this.emit('task:created', task);

    return task;
  }

  async updateTask(id: string, updates: Partial<CreateTaskRequest>): Promise<ScheduledTask | null> {
    const task = this.tasks.get(id);
    if (!task) return null;

    if (updates.cron && !cron.validate(updates.cron)) {
      throw new Error(`Invalid cron expression: ${updates.cron}`);
    }

    if (updates.name !== undefined) task.name = updates.name;
    if (updates.description !== undefined) task.description = updates.description;
    if (updates.cron !== undefined) task.cron = updates.cron;
    if (updates.skillName !== undefined) task.skillName = updates.skillName;
    if (updates.args !== undefined) task.args = updates.args;
    if (updates.enabled !== undefined) {
      task.enabled = updates.enabled;
      if (task.enabled) {
        this.scheduleTask(task);
      } else {
        this.cronJobs.get(id)?.stop();
        this.cronJobs.delete(id);
      }
    }

    task.nextRun = this.getNextRunTime(task.cron);
    await this.saveTasks();
    this.emit('task:updated', task);

    return task;
  }

  async deleteTask(id: string): Promise<boolean> {
    const task = this.tasks.get(id);
    if (!task) return false;

    this.cronJobs.get(id)?.stop();
    this.cronJobs.delete(id);
    this.tasks.delete(id);

    await this.saveTasks();
    this.emit('task:deleted', id);

    return true;
  }

  async getTask(id: string): Promise<ScheduledTask | null> {
    return this.tasks.get(id) || null;
  }

  async getAllTasks(): Promise<ScheduledTask[]> {
    return Array.from(this.tasks.values()).sort((a, b) =>
      b.createdAt.getTime() - a.createdAt.getTime()
    );
  }

  async getEnabledTasks(): Promise<ScheduledTask[]> {
    return Array.from(this.tasks.values()).filter(t => t.enabled);
  }

  async runTaskNow(id: string): Promise<TaskResult | null> {
    const task = this.tasks.get(id);
    if (!task) return null;

    return await this.executeTask(task, true);
  }

  private async executeTask(task: ScheduledTask, manual = false): Promise<TaskResult> {
    const startTime = Date.now();
    const result: TaskResult = {
      success: false,
      durationMs: 0,
      timestamp: new Date()
    };

    this.emit('task:start', task);

    try {
      if (!this.skillExecutor) {
        throw new Error('Skill executor not configured');
      }

      const executionResult = await this.skillExecutor.executeSkill(
        task.skillName,
        task.args
      );

      result.success = true;
      result.output = typeof executionResult === 'string'
        ? executionResult
        : JSON.stringify(executionResult);

    } catch (e: any) {
      result.success = false;
      result.error = e.message || String(e);
    }

    result.durationMs = Date.now() - startTime;
    task.lastRun = new Date();
    task.lastResult = result;
    task.lastError = result.error;
    task.runCount++;
    task.nextRun = this.getNextRunTime(task.cron);

    await this.saveTasks();
    this.emit('task:completed', task, result);

    return result;
  }

  parseNaturalLanguage(text: string): CreateTaskRequest | null {
    const lower = text.toLowerCase();

    const cronPatterns = [
      { pattern: /每天早上(\d+)[点:]/, getCron: (h: number) => `0 ${h} * * *` },
      { pattern: /每天(\d+)[点:]/, getCron: (h: number) => `0 ${h} * * *` },
      { pattern: /每天午夜/, getCron: () => '0 0 * * *' },
      { pattern: /每天中午/, getCron: () => '0 12 * * *' },
      { pattern: /每小时/, getCron: () => '0 * * * *' },
      { pattern: /每半小时/, getCron: () => '30 * * * *' },
      { pattern: /每分钟/, getCron: () => '* * * * *' },
      { pattern: /每周一/, getCron: () => '0 9 * * 1' },
      { pattern: /每周五/, getCron: () => '0 9 * * 5' },
      { pattern: /每月1号/, getCron: () => '0 9 1 * *' },
      { pattern: /工作日/, getCron: () => '0 9 * * 1-5' }
    ];

    let skillName = 'generic';
    let cronExpression = '0 9 * * *';

    if (lower.includes('日报')) {
      skillName = 'daily_report';
      if (lower.includes('早上') || lower.includes('上午')) {
        cronExpression = '0 8 * * *';
      }
    } else if (lower.includes('周报')) {
      skillName = 'weekly_report';
      cronExpression = '0 9 * * 1';
    } else if (lower.includes('搜索') || lower.includes('搜索')) {
      skillName = 'web_search';
    } else if (lower.includes('备份') || lower.includes('backup')) {
      skillName = 'backup';
      cronExpression = '0 2 * * *';
    }

    for (const { pattern, getCron } of cronPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        cronExpression = getCron(parseInt(match[1]));
        break;
      } else if (text.match(pattern)) {
        cronExpression = getCron(0);
        break;
      }
    }

    return {
      name: text.slice(0, 50),
      skillName,
      cron: cronExpression,
      enabled: true
    };
  }

  async getTaskStats(): Promise<{
    totalTasks: number;
    enabledTasks: number;
    disabledTasks: number;
    totalRuns: number;
    successRate: number;
    upcomingTasks: ScheduledTask[];
  }> {
    const tasks = Array.from(this.tasks.values());
    const enabledTasks = tasks.filter(t => t.enabled);
    const totalRuns = tasks.reduce((sum, t) => sum + t.runCount, 0);
    const successfulRuns = tasks.reduce((sum, t) =>
      sum + (t.lastResult?.success ? 1 : 0), 0
    );

    return {
      totalTasks: tasks.length,
      enabledTasks: enabledTasks.length,
      disabledTasks: tasks.length - enabledTasks.length,
      totalRuns,
      successRate: totalRuns > 0 ? successfulRuns / Math.max(totalRuns, 1) : 0,
      upcomingTasks: enabledTasks
        .filter(t => t.nextRun)
        .sort((a, b) => (a.nextRun?.getTime() || 0) - (b.nextRun?.getTime() || 0))
        .slice(0, 5)
    };
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    for (const task of this.tasks.values()) {
      if (task.enabled) {
        this.scheduleTask(task);
      }
    }

    console.log('[TaskScheduler] Started');
    this.emit('scheduler:started');
  }

  stop(): void {
    for (const cronJob of this.cronJobs.values()) {
      cronJob.stop();
    }
    this.cronJobs.clear();
    this.isRunning = false;
    console.log('[TaskScheduler] Stopped');
    this.emit('scheduler:stopped');
  }
}

export const taskScheduler = TaskScheduler.getInstance();