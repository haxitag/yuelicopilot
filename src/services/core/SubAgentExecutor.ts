/**
 * SubAgent Executor - 子代理并行执行器
 * 核心功能：
 * 1. 隔离的子进程执行环境
 * 2. 多任务并行执行
 * 3. 结果聚合
 * 4. 错误处理和超时控制
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { DEFAULT_SKILL_EXECUTOR_PORT } from '../../utils/skillExecutorUrl';

export interface SubAgentTask {
  id: string;
  skillName: string;
  args: Record<string, any>;
  timeout?: number;
  priority?: number;
}

export interface SubAgentResult {
  taskId: string;
  success: boolean;
  result?: any;
  error?: string;
  durationMs: number;
  exitCode?: number;
}

export interface ParallelExecutionResult {
  totalTasks: number;
  successfulTasks: number;
  failedTasks: number;
  results: SubAgentResult[];
  totalDurationMs: number;
}

export type SubAgentEventType = 'task:start' | 'task:complete' | 'task:error' | 'all:complete';

class SubAgentExecutor extends EventEmitter {
  private static instance: SubAgentExecutor;
  private runningTasks: Map<string, ChildProcess> = new Map();
  private activeTasks: Map<string, SubAgentTask> = new Map();
  private results: Map<string, SubAgentResult> = new Map();
  private defaultTimeout = 60000;
  private maxParallelTasks = 5;

  private constructor() {
    super();
  }

  static getInstance(): SubAgentExecutor {
    if (!SubAgentExecutor.instance) {
      SubAgentExecutor.instance = new SubAgentExecutor();
    }
    return SubAgentExecutor.instance;
  }

  async executeParallel(tasks: SubAgentTask[]): Promise<ParallelExecutionResult> {
    const startTime = Date.now();
    const results: SubAgentResult[] = [];
    const sortedTasks = [...tasks].sort((a, b) => (b.priority || 0) - (a.priority || 0));

    const chunks: SubAgentTask[][] = [];
    for (let i = 0; i < sortedTasks.length; i += this.maxParallelTasks) {
      chunks.push(sortedTasks.slice(i, i + this.maxParallelTasks));
    }

    for (const chunk of chunks) {
      const chunkResults = await Promise.all(
        chunk.map(task => this.executeTask(task))
      );
      results.push(...chunkResults);
    }

    const successfulTasks = results.filter(r => r.success).length;

    return {
      totalTasks: tasks.length,
      successfulTasks,
      failedTasks: tasks.length - successfulTasks,
      results,
      totalDurationMs: Date.now() - startTime
    };
  }

  async executeTask(task: SubAgentTask): Promise<SubAgentResult> {
    const startTime = Date.now();
    const timeout = task.timeout || this.defaultTimeout;

    this.activeTasks.set(task.id, task);
    this.emit('task:start', task);

    return new Promise((resolve) => {
      const timeoutHandle = setTimeout(() => {
        this.killTask(task.id);
        const result: SubAgentResult = {
          taskId: task.id,
          success: false,
          error: `Task timed out after ${timeout}ms`,
          durationMs: Date.now() - startTime
        };
        this.results.set(task.id, result);
        this.emit('task:error', task, result.error);
        resolve(result);
      }, timeout);

      try {
        const scriptContent = this.generateScript(task);
        const proc = spawn('node', ['-e', scriptContent], {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, SUBAGENT_TASK: JSON.stringify(task) }
        });

        this.runningTasks.set(task.id, proc);

        let stdout = '';
        let stderr = '';

        proc.stdout?.on('data', (data) => {
          stdout += data.toString();
        });

        proc.stderr?.on('data', (data) => {
          stderr += data.toString();
        });

        proc.on('close', (exitCode) => {
          clearTimeout(timeoutHandle);
          this.runningTasks.delete(task.id);
          this.activeTasks.delete(task.id);

          const success = exitCode === 0;
          const result: SubAgentResult = {
            taskId: task.id,
            success,
            result: success ? stdout : undefined,
            error: success ? undefined : (stderr || `Exit code: ${exitCode}`),
            durationMs: Date.now() - startTime,
            exitCode: exitCode || undefined
          };

          this.results.set(task.id, result);
          this.emit('task:complete', task, result);
          resolve(result);
        });

        proc.on('error', (err) => {
          clearTimeout(timeoutHandle);
          this.runningTasks.delete(task.id);
          this.activeTasks.delete(task.id);

          const result: SubAgentResult = {
            taskId: task.id,
            success: false,
            error: err.message,
            durationMs: Date.now() - startTime
          };

          this.results.set(task.id, result);
          this.emit('task:error', task, result.error);
          resolve(result);
        });
      } catch (err: any) {
        clearTimeout(timeoutHandle);
        this.runningTasks.delete(task.id);
        this.activeTasks.delete(task.id);

        const result: SubAgentResult = {
          taskId: task.id,
          success: false,
          error: err.message,
          durationMs: Date.now() - startTime
        };

        this.results.set(task.id, result);
        this.emit('task:error', task, result.error);
        resolve(result);
      }
    });
  }

  private generateScript(task: SubAgentTask): string {
    const portRaw = process.env.SKILL_EXECUTOR_PORT || String(DEFAULT_SKILL_EXECUTOR_PORT);
    const parsed = parseInt(portRaw, 10);
    const executorPort =
      Number.isFinite(parsed) && parsed > 0 && parsed < 65536 ? parsed : DEFAULT_SKILL_EXECUTOR_PORT;

    return `
      const task = JSON.parse(process.env.SUBAGENT_TASK || '{}');
      const { skillName, args } = task;

      async function main() {
        try {
          const result = await executeSkill(skillName, args);
          console.log(JSON.stringify(result));
          process.exit(0);
        } catch (error) {
          console.error(error.message);
          process.exit(1);
        }
      }

      async function executeSkill(skillName, args) {
        return new Promise((resolve, reject) => {
          const http = require('http');
          const postData = JSON.stringify({ skillName, args });

          const options = {
            hostname: 'localhost',
            port: ${executorPort},
            path: '/v1/skills/execute',
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(postData)
            }
          };

          const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
              if (res.statusCode === 200) {
                resolve(JSON.parse(data));
              } else {
                reject(new Error('Skill execution failed: ' + data));
              }
            });
          });

          req.on('error', reject);
          req.write(postData);
          req.end();
        });
      }

      main();
    `;
  }

  killTask(taskId: string): boolean {
    const proc = this.runningTasks.get(taskId);
    if (proc) {
      proc.kill('SIGTERM');
      this.runningTasks.delete(taskId);
      this.activeTasks.delete(taskId);
      return true;
    }
    return false;
  }

  killAllTasks(): void {
    for (const [taskId, proc] of this.runningTasks) {
      proc.kill('SIGTERM');
      this.activeTasks.delete(taskId);
    }
    this.runningTasks.clear();
  }

  getActiveTasks(): SubAgentTask[] {
    return Array.from(this.activeTasks.values());
  }

  getResult(taskId: string): SubAgentResult | undefined {
    return this.results.get(taskId);
  }

  getActiveCount(): number {
    return this.runningTasks.size;
  }

  setMaxParallelTasks(max: number): void {
    this.maxParallelTasks = Math.max(1, max);
  }

  setDefaultTimeout(ms: number): void {
    this.defaultTimeout = ms;
  }
}

export const subAgentExecutor = SubAgentExecutor.getInstance();
export { SubAgentExecutor };
