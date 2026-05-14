/**
 * Batch Trajectory Generator - 批量轨迹生成系统
 * 基于Hermes-agent的Research-ready轨迹生成设计
 * 核心功能：
 * 1. 批量任务轨迹生成
 * 2. 轨迹压缩与优化
 * 3. RL环境数据生成
 * 4. 轨迹分析与统计
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface Trajectory {
  id: string;
  taskPrompt: string;
  steps: TrajectoryStep[];
  finalResult?: any;
  success: boolean;
  reward?: number;
  totalTokens?: number;
  durationMs: number;
  createdAt: Date;
  metadata?: Record<string, any>;
}

export interface TrajectoryStep {
  order: number;
  action: string;
  tool?: string;
  args?: Record<string, any>;
  observation?: any;
  reward?: number;
  done?: boolean;
  info?: Record<string, any>;
}

export interface BatchConfig {
  taskPrompts: string[];
  model?: string;
  temperature?: number;
  maxSteps?: number;
  parallel?: boolean;
  maxParallel?: number;
}

export interface BatchResult {
  batchId: string;
  totalTasks: number;
  completedTasks: number;
  successfulTasks: number;
  failedTasks: number;
  trajectories: Trajectory[];
  statistics: BatchStatistics;
  createdAt: Date;
  completedAt?: Date;
}

export interface BatchStatistics {
  totalDurationMs: number;
  avgDurationMs: number;
  successRate: number;
  avgStepsPerTrajectory: number;
  avgReward: number;
  totalTokens: number;
  tokensPerSecond: number;
}

export interface RLEnvironment {
  id: string;
  name: string;
  description: string;
  stateSpace: string[];
  actionSpace: string[];
  rewardFunction: string;
  trajectories: Trajectory[];
  createdAt: Date;
  updatedAt: Date;
}

interface TrajectoryStore {
  trajectories: Trajectory[];
  batches: BatchResult[];
  environments: RLEnvironment[];
  lastCleanup: Date;
}

interface TrajectoryGenerator extends EventEmitter {
  generate(prompt: string, options?: any): Promise<Trajectory>;
  abort(): void;
}

class BatchTrajectoryGenerator {
  private static instance: BatchTrajectoryGenerator;
  private storePath: string;
  private store: TrajectoryStore = {
    trajectories: [],
    batches: [],
    environments: [],
    lastCleanup: new Date()
  };
  private activeGenerators: Map<string, TrajectoryGenerator> = new Map();
  private defaultMaxSteps = 20;
  private defaultParallel = 3;

  private constructor() {
    this.storePath = path.join(__dirname, '../../../data/trajectory_generator.json');
    this.loadStore();
  }

  static getInstance(): BatchTrajectoryGenerator {
    if (!BatchTrajectoryGenerator.instance) {
      BatchTrajectoryGenerator.instance = new BatchTrajectoryGenerator();
    }
    return BatchTrajectoryGenerator.instance;
  }

  private async loadStore(): Promise<void> {
    try {
      const dir = path.dirname(this.storePath);
      await fs.mkdir(dir, { recursive: true });
      const data = await fs.readFile(this.storePath, 'utf-8');
      const parsed = JSON.parse(data);
      this.store = {
        trajectories: (parsed.trajectories || []).map((t: any) => ({
          ...t,
          createdAt: new Date(t.createdAt)
        })),
        batches: (parsed.batches || []).map((b: any) => ({
          ...b,
          createdAt: new Date(b.createdAt),
          completedAt: b.completedAt ? new Date(b.completedAt) : undefined
        })),
        environments: (parsed.environments || []).map((e: any) => ({
          ...e,
          createdAt: new Date(e.createdAt),
          updatedAt: new Date(e.updatedAt)
        })),
        lastCleanup: new Date(parsed.lastCleanup || Date.now())
      };
    } catch {
      this.store = {
        trajectories: [],
        batches: [],
        environments: [],
        lastCleanup: new Date()
      };
    }
  }

  private async saveStore(): Promise<void> {
    try {
      const dir = path.dirname(this.storePath);
      await fs.mkdir(dir, { recursive: true });
      this.store.lastCleanup = new Date();
      await fs.writeFile(this.storePath, JSON.stringify(this.store, null, 2));
    } catch (e) {
      console.error('[BatchTrajectoryGenerator] Failed to save store:', e);
    }
  }

  async generateSingleTrajectory(
    prompt: string,
    options: {
      model?: string;
      maxSteps?: number;
      temperature?: number;
      skillName?: string;
    } = {}
  ): Promise<Trajectory> {
    const maxSteps = options.maxSteps || this.defaultMaxSteps;
    const startTime = Date.now();
    const steps: TrajectoryStep[] = [];

    let currentStep = 0;
    let done = false;
    let finalResult: any;
    let totalTokens = 0;

    while (currentStep < maxSteps && !done) {
      const step = await this.simulateStep(prompt, {
        stepNumber: currentStep,
        previousSteps: steps,
        model: options.model,
        temperature: options.temperature,
        skillName: options.skillName
      });

      steps.push({
        order: currentStep + 1,
        action: step.action,
        tool: step.tool,
        args: step.args,
        observation: step.observation,
        reward: step.reward,
        done: step.done,
        info: step.info
      });

      totalTokens += step.tokens || 0;

      if (step.done) {
        done = true;
        finalResult = step.observation;
      }

      currentStep++;
    }

    const success = done;
    const reward = steps.reduce((sum, s) => sum + (s.reward || 0), 0);

    const trajectory: Trajectory = {
      id: `traj_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      taskPrompt: prompt,
      steps,
      finalResult,
      success,
      reward,
      totalTokens,
      durationMs: Date.now() - startTime,
      createdAt: new Date()
    };

    this.store.trajectories.push(trajectory);
    if (this.store.trajectories.length > 10000) {
      this.store.trajectories = this.store.trajectories.slice(-5000);
    }

    await this.saveStore();
    this.emit('trajectory:generated', trajectory);

    return trajectory;
  }

  private async simulateStep(
    prompt: string,
    context: {
      stepNumber: number;
      previousSteps: TrajectoryStep[];
      model?: string;
      temperature?: number;
      skillName?: string;
    }
  ): Promise<{
    action: string;
    tool?: string;
    args?: Record<string, any>;
    observation?: any;
    reward: number;
    done: boolean;
    tokens: number;
    info?: Record<string, any>;
  }> {
    const actions = [
      'Search for relevant information',
      'Execute skill',
      'Analyze data',
      'Generate content',
      'Review and validate',
      'Finalize result'
    ];

    const tools = ['web_search', 'code_generator', 'file_writer', 'data_processor', 'api_caller'];

    const action = actions[Math.min(context.stepNumber, actions.length - 1)];
    const tool = context.stepNumber < tools.length ? tools[context.stepNumber] : undefined;

    const done = context.stepNumber >= 4;

    const reward = done ? 1.0 : 0.1 * (1 - context.stepNumber / 10);

    return {
      action,
      tool,
      args: { prompt, step: context.stepNumber },
      observation: done ? { result: 'Task completed successfully', output: 'Generated content' } : undefined,
      reward,
      done,
      tokens: Math.floor(Math.random() * 500) + 200,
      info: { thinking: `Step ${context.stepNumber + 1}: ${action}` }
    };
  }

  async runBatch(config: BatchConfig): Promise<BatchResult> {
    const batchId = `batch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();
    const trajectories: Trajectory[] = [];
    let completed = 0;
    let succeeded = 0;
    let failed = 0;

    const parallel = config.parallel ?? true;
    const maxParallel = config.maxParallel || this.defaultParallel;

    this.emit('batch:started', { batchId, total: config.taskPrompts.length });

    if (parallel) {
      const chunks: string[][] = [];
      for (let i = 0; i < config.taskPrompts.length; i += maxParallel) {
        chunks.push(config.taskPrompts.slice(i, i + maxParallel));
      }

      for (const chunk of chunks) {
        const promises = chunk.map(prompt => 
          this.generateSingleTrajectory(prompt, {
            model: config.model,
            maxSteps: config.maxSteps,
            temperature: config.temperature
          })
        );

        const results = await Promise.allSettled(promises);
        
        for (const result of results) {
          completed++;
          if (result.status === 'fulfilled') {
            trajectories.push(result.value);
            if (result.value.success) succeeded++;
            else failed++;
          } else {
            failed++;
          }
        }

        this.emit('batch:progress', {
          batchId,
          completed,
          total: config.taskPrompts.length
        });
      }
    } else {
      for (const prompt of config.taskPrompts) {
        try {
          const trajectory = await this.generateSingleTrajectory(prompt, {
            model: config.model,
            maxSteps: config.maxSteps,
            temperature: config.temperature
          });
          trajectories.push(trajectory);
          completed++;
          if (trajectory.success) succeeded++;
          else failed++;
        } catch {
          failed++;
        }

        this.emit('batch:progress', {
          batchId,
          completed,
          total: config.taskPrompts.length
        });
      }
    }

    const totalDuration = Date.now() - startTime;
    const totalTokens = trajectories.reduce((sum, t) => sum + (t.totalTokens || 0), 0);
    const avgSteps = trajectories.length > 0
      ? trajectories.reduce((sum, t) => sum + t.steps.length, 0) / trajectories.length
      : 0;
    const avgReward = trajectories.length > 0
      ? trajectories.reduce((sum, t) => sum + (t.reward || 0), 0) / trajectories.length
      : 0;

    const batchResult: BatchResult = {
      batchId,
      totalTasks: config.taskPrompts.length,
      completedTasks: completed,
      successfulTasks: succeeded,
      failedTasks: failed,
      trajectories,
      statistics: {
        totalDurationMs: totalDuration,
        avgDurationMs: completed > 0 ? totalDuration / completed : 0,
        successRate: completed > 0 ? succeeded / completed : 0,
        avgStepsPerTrajectory: avgSteps,
        avgReward,
        totalTokens,
        tokensPerSecond: totalDuration > 0 ? (totalTokens / totalDuration) * 1000 : 0
      },
      createdAt: new Date(),
      completedAt: new Date()
    };

    this.store.batches.push(batchResult);
    if (this.store.batches.length > 100) {
      this.store.batches = this.store.batches.slice(-50);
    }

    await this.saveStore();
    this.emit('batch:completed', batchResult);

    return batchResult;
  }

  private emit(event: string, data?: any): void {
    console.log(`[BatchTrajectoryGenerator] ${event}`, data || '');
  }

  compressTrajectory(trajectory: Trajectory, method: 'last-k' | 'reward-weighted' | 'importance'): Trajectory {
    if (method === 'last-k') {
      const keptSteps = trajectory.steps.slice(-5);
      return { ...trajectory, steps: keptSteps };
    }

    if (method === 'reward-weighted') {
      const avgReward = trajectory.steps.reduce((sum, s) => sum + (s.reward || 0), 0) / trajectory.steps.length;
      const keptSteps = trajectory.steps.filter(s => (s.reward || 0) >= avgReward);
      return { ...trajectory, steps: keptSteps };
    }

    if (method === 'importance') {
      const highRewardSteps = trajectory.steps.filter(s => (s.reward || 0) > 0.5);
      const lowRewardSteps = trajectory.steps.filter(s => (s.reward || 0) <= 0.5);
      const sampledLow = lowRewardSteps.filter((_, i) => i % 2 === 0);
      const keptSteps = [...highRewardSteps, ...sampledLow].sort((a, b) => a.order - b.order);
      return { ...trajectory, steps: keptSteps };
    }

    return trajectory;
  }

  async createRLEnvironment(config: {
    name: string;
    description: string;
    stateSpace: string[];
    actionSpace: string[];
    rewardFunction: string;
  }): Promise<RLEnvironment> {
    const env: RLEnvironment = {
      id: `env_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      ...config,
      trajectories: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    this.store.environments.push(env);
    await this.saveStore();
    this.emit('environment:created', env);

    return env;
  }

  addTrajectoriesToEnvironment(envId: string, trajectoryIds: string[]): boolean {
    const env = this.store.environments.find(e => e.id === envId);
    if (!env) return false;

    for (const trajId of trajectoryIds) {
      const traj = this.store.trajectories.find(t => t.id === trajId);
      if (traj && !env.trajectories.some(t => t.id === trajId)) {
        env.trajectories.push(traj);
      }
    }

    env.updatedAt = new Date();
    this.saveStore();
    return true;
  }

  getTrajectories(options: {
    successOnly?: boolean;
    minReward?: number;
    since?: Date;
    limit?: number;
  } = {}): Trajectory[] {
    let result = [...this.store.trajectories];

    if (options.successOnly) {
      result = result.filter(t => t.success);
    }
    if (options.minReward !== undefined) {
      result = result.filter(t => (t.reward || 0) >= options.minReward!);
    }
    if (options.since) {
      result = result.filter(t => t.createdAt >= options.since!);
    }

    return result
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, options.limit || 100);
  }

  getBatches(limit = 20): BatchResult[] {
    return this.store.batches
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }

  getEnvironments(): RLEnvironment[] {
    return [...this.store.environments];
  }

  getStats(): {
    totalTrajectories: number;
    totalBatches: number;
    avgSuccessRate: number;
    avgReward: number;
    totalTokens: number;
    environmentsCount: number;
  } {
    const trajectories = this.store.trajectories;
    const total = trajectories.length;
    const successful = trajectories.filter(t => t.success).length;
    const avgReward = total > 0
      ? trajectories.reduce((sum, t) => sum + (t.reward || 0), 0) / total
      : 0;
    const totalTokens = trajectories.reduce((sum, t) => sum + (t.totalTokens || 0), 0);

    return {
      totalTrajectories: total,
      totalBatches: this.store.batches.length,
      avgSuccessRate: total > 0 ? successful / total : 0,
      avgReward,
      totalTokens,
      environmentsCount: this.store.environments.length
    };
  }

  async exportTrajectories(format: 'json' | 'jsonl', filters?: {
    successOnly?: boolean;
    since?: Date;
  }): Promise<string> {
    let trajectories = this.getTrajectories({ limit: 10000 });

    if (filters?.successOnly) {
      trajectories = trajectories.filter(t => t.success);
    }
    if (filters?.since) {
      trajectories = trajectories.filter(t => t.createdAt >= filters.since!);
    }

    if (format === 'json') {
      return JSON.stringify(trajectories, null, 2);
    }

    return trajectories.map(t => JSON.stringify(t)).join('\n');
  }

  async deleteBatch(batchId: string): Promise<boolean> {
    const index = this.store.batches.findIndex(b => b.batchId === batchId);
    if (index >= 0) {
      this.store.batches.splice(index, 1);
      await this.saveStore();
      return true;
    }
    return false;
  }

  async deleteTrajectory(trajectoryId: string): Promise<boolean> {
    const index = this.store.trajectories.findIndex(t => t.id === trajectoryId);
    if (index >= 0) {
      this.store.trajectories.splice(index, 1);
      await this.saveStore();
      return true;
    }
    return false;
  }
}

export const batchTrajectoryGenerator = BatchTrajectoryGenerator.getInstance();