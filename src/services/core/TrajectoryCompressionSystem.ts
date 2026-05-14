/**
 * Trajectory Compression System - 轨迹压缩系统
 * 基于Hermes-agent的Trajectory Compression设计
 * 核心功能：
 * 1. 轨迹压缩（用于训练下一代tool-calling模型）
 * 2. Atropos RL环境支持
 * 3. 批量轨迹生成
 * 4. 轨迹格式转换（支持多种RL框架）
 * 5. 训练数据导出
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type CompressionMethod = 'full' | 'key-steps' | 'summarized' | 'hierarchical';
export type ExportFormat = 'openai' | 'anthropic' | 'atrac' | 'sharegpt' | 'jsonl';
export type RewardType = 'success' | 'preference' | 'multi-objective';

export interface TrajectoryStep {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
  metadata?: Record<string, any>;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface Trajectory {
  id: string;
  sessionId: string;
  task: string;
  steps: TrajectoryStep[];
  compressed?: TrajectoryStep[];
  summary?: string;
  reward?: number;
  rewardType?: RewardType;
  success: boolean;
  duration: number;
  model?: string;
  createdAt: Date;
  metadata?: Record<string, any>;
}

export interface CompressedTrajectory {
  originalId: string;
  compressed: TrajectoryStep[];
  compressionRatio: number;
  method: CompressionMethod;
  keyStepIndices: number[];
}

export interface RLEnvironment {
  id: string;
  name: string;
  type: 'code' | 'reasoning' | 'conversation' | 'tool_use';
  config: Record<string, any>;
  metrics: string[];
}

export interface BatchGenerationConfig {
  taskPrompts: string[];
  parallel: boolean;
  maxSteps: number;
  model?: string;
  temperature?: number;
}

interface TrajectoryStore {
  trajectories: Trajectory[];
  compressedTrajectories: CompressedTrajectory[];
  rlEnvironments: RLEnvironment[];
  config: {
    defaultCompressionMethod: CompressionMethod;
    maxStepsKept: number;
    keyStepThreshold: number;
    exportFormat: ExportFormat;
  };
}

class TrajectoryCompressionSystem extends EventEmitter {
  private static instance: TrajectoryCompressionSystem;
  private storePath: string;
  private store: TrajectoryStore = {
    trajectories: [],
    compressedTrajectories: [],
    rlEnvironments: [],
    config: {
      defaultCompressionMethod: 'key-steps',
      maxStepsKept: 20,
      keyStepThreshold: 0.8,
      exportFormat: 'openai'
    }
  };

  private constructor() {
    super();
    this.storePath = path.join(__dirname, '../../../data/trajectory_compression.json');
    this.loadStore();
    this.initializeDefaultEnvironments();
  }

  static getInstance(): TrajectoryCompressionSystem {
    if (!TrajectoryCompressionSystem.instance) {
      TrajectoryCompressionSystem.instance = new TrajectoryCompressionSystem();
    }
    return TrajectoryCompressionSystem.instance;
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
        compressedTrajectories: parsed.compressedTrajectories || [],
        rlEnvironments: parsed.rlEnvironments || [],
        config: { ...this.store.config, ...parsed.config }
      };
    } catch {}
  }

  private async saveStore(): Promise<void> {
    try {
      const dir = path.dirname(this.storePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(this.storePath, JSON.stringify(this.store, null, 2));
    } catch (e) {
      console.error('[TrajectoryCompression] Failed to save store:', e);
    }
  }

  private initializeDefaultEnvironments(): void {
    if (this.store.rlEnvironments.length === 0) {
      this.store.rlEnvironments = [
        {
          id: 'atropos_code',
          name: 'Atropos Code',
          type: 'code',
          config: { difficulty: 'adaptive', timeLimit: 300 },
          metrics: ['compilation', 'test_pass', 'style_score']
        },
        {
          id: 'atropos_reasoning',
          name: 'Atropos Reasoning',
          type: 'reasoning',
          config: { difficulty: 'adaptive', domains: ['math', 'logic', 'commonsense'] },
          metrics: ['accuracy', 'steps', 'confidence']
        },
        {
          id: 'atropos_conversation',
          name: 'Atropos Conversation',
          type: 'conversation',
          config: { personas: 5, turns: 10 },
          metrics: ['engagement', 'coherence', 'helpfulness']
        },
        {
          id: 'atropos_tool_use',
          name: 'Atropos Tool Use',
          type: 'tool_use',
          config: { tools: ['search', 'calculator', 'file_ops'], maxCalls: 20 },
          metrics: ['success_rate', 'efficiency', 'error_rate']
        }
      ];
      this.saveStore();
    }
  }

  async updateConfig(updates: Partial<TrajectoryStore['config']>): Promise<TrajectoryStore['config']> {
    this.store.config = { ...this.store.config, ...updates };
    await this.saveStore();
    this.emit('config:updated', this.store.config);
    return this.store.config;
  }

  getConfig(): TrajectoryStore['config'] {
    return { ...this.store.config };
  }

  async addTrajectory(trajectory: Omit<Trajectory, 'id' | 'createdAt'>): Promise<Trajectory> {
    const entry: Trajectory = {
      ...trajectory,
      id: `traj_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      createdAt: new Date()
    };

    this.store.trajectories.push(entry);
    await this.saveStore();
    this.emit('trajectory:added', entry);

    return entry;
  }

  async compress(trajectoryId: string, method?: CompressionMethod): Promise<CompressedTrajectory | null> {
    const trajectory = this.store.trajectories.find(t => t.id === trajectoryId);
    if (!trajectory) return null;

    const compressionMethod = method || this.store.config.defaultCompressionMethod;
    let compressed: TrajectoryStep[] = [];
    let keyStepIndices: number[] = [];

    switch (compressionMethod) {
      case 'full':
        compressed = trajectory.steps;
        keyStepIndices = trajectory.steps.map((_, i) => i);
        break;

      case 'key-steps':
        ({ compressed, keyStepIndices } = this.compressKeySteps(trajectory.steps));
        break;

      case 'summarized':
        compressed = await this.compressSummarized(trajectory.steps);
        keyStepIndices = this.findKeyStepIndices(trajectory.steps);
        break;

      case 'hierarchical':
        compressed = this.compressHierarchical(trajectory.steps);
        keyStepIndices = this.findKeyStepIndices(trajectory.steps);
        break;
    }

    const result: CompressedTrajectory = {
      originalId: trajectoryId,
      compressed,
      compressionRatio: trajectory.steps.length / Math.max(compressed.length, 1),
      method: compressionMethod,
      keyStepIndices
    };

    trajectory.compressed = compressed;
    this.store.compressedTrajectories.push(result);

    await this.saveStore();
    this.emit('trajectory:compressed', result);

    return result;
  }

  private compressKeySteps(steps: TrajectoryStep[]): {
    compressed: TrajectoryStep[];
    keyStepIndices: number[];
  } {
    const keyIndices: number[] = [0];

    for (let i = 1; i < steps.length; i++) {
      const step = steps[i];

      if (step.tool_calls && step.tool_calls.length > 0) {
        if (!keyIndices.includes(i - 1)) keyIndices.push(i - 1);
        keyIndices.push(i);
      }

      if (step.role === 'tool' && (i === steps.length - 1 || steps[i + 1].role !== 'tool')) {
        keyIndices.push(i);
      }
    }

    if (!keyIndices.includes(steps.length - 1)) {
      keyIndices.push(steps.length - 1);
    }

    const keyStepIndices = [...new Set(keyIndices)].sort((a, b) => a - b);

    return {
      compressed: keyStepIndices.map(i => steps[i]),
      keyStepIndices
    };
  }

  private async compressSummarized(steps: TrajectoryStep[]): Promise<TrajectoryStep[]> {
    const compressed: TrajectoryStep[] = [];

    compressed.push(steps[0]);

    let currentSummary = '';
    let summarySteps: TrajectoryStep[] = [];

    for (let i = 1; i < steps.length; i++) {
      const step = steps[i];

      if (step.role === 'tool') {
        summarySteps.push(step);

        if (summarySteps.length >= 3) {
          currentSummary += `[${summarySteps.length} tool calls executed] `;
          compressed.push({
            role: 'assistant',
            content: currentSummary || 'Tools executed',
            metadata: { type: 'compressed_tool_block', count: summarySteps.length }
          });
          currentSummary = '';
          summarySteps = [];
        }
      } else {
        if (summarySteps.length > 0) {
          compressed.push({
            role: 'assistant',
            content: `[${summarySteps.length} tool results]`,
            metadata: { type: 'compressed_tool_results' }
          });
          summarySteps = [];
        }
        compressed.push(step);
      }
    }

    return compressed;
  }

  private compressHierarchical(steps: TrajectoryStep[]): TrajectoryStep[] {
    const segments: TrajectoryStep[][] = [];
    let currentSegment: TrajectoryStep[] = [];

    for (const step of steps) {
      currentSegment.push(step);

      if (step.role === 'tool') {
        const nextIndex = steps.indexOf(step) + 1;
        if (nextIndex >= steps.length || steps[nextIndex].role !== 'tool') {
          segments.push([...currentSegment]);
          currentSegment = [];
        }
      } else if (step.tool_calls) {
        segments.push([...currentSegment]);
        currentSegment = [];
      }
    }

    if (currentSegment.length > 0) {
      segments.push(currentSegment);
    }

    const hierarchical: TrajectoryStep[] = [];

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];

      if (segment.length === 1) {
        hierarchical.push(segment[0]);
      } else {
        hierarchical.push(segment[0]);

        const toolCalls = segment.filter(s => s.role === 'tool' || s.tool_calls);
        if (toolCalls.length > 0) {
          hierarchical.push({
            role: 'assistant',
            content: `[${toolCalls.length} steps executed in segment ${i + 1}]`,
            metadata: { type: 'hierarchical_segment', segmentIndex: i, stepCount: toolCalls.length }
          });
        }

        const lastStep = segment[segment.length - 1];
        if (lastStep !== segment[0]) {
          hierarchical.push(lastStep);
        }
      }
    }

    return hierarchical;
  }

  private findKeyStepIndices(steps: TrajectoryStep[]): number[] {
    const keyIndices: number[] = [0];

    for (let i = 1; i < steps.length; i++) {
      const step = steps[i];

      if (step.tool_calls && step.tool_calls.length > 0) {
        keyIndices.push(i);
      }

      if (step.content && step.content.length > 200) {
        if (keyIndices[keyIndices.length - 1] !== i - 1) {
          keyIndices.push(i);
        }
      }
    }

    if (keyIndices[keyIndices.length - 1] !== steps.length - 1) {
      keyIndices.push(steps.length - 1);
    }

    return [...new Set(keyIndices)].sort((a, b) => a - b);
  }

  async generateBatch(config: BatchGenerationConfig): Promise<{
    batchId: string;
    trajectories: Trajectory[];
    stats: {
      total: number;
      successful: number;
      failed: number;
      avgDuration: number;
    };
  }> {
    const batchId = `batch_${Date.now()}`;

    const trajectories: Trajectory[] = [];

    for (const prompt of config.taskPrompts) {
      try {
        const trajectory = await this.simulateTrajectoryGeneration(prompt, config);
        trajectories.push(trajectory);
      } catch (error) {
        console.error(`Failed to generate trajectory for: ${prompt}`);
      }
    }

    const stats = {
      total: trajectories.length,
      successful: trajectories.filter(t => t.success).length,
      failed: trajectories.filter(t => !t.success).length,
      avgDuration: trajectories.length > 0
        ? trajectories.reduce((sum, t) => sum + t.duration, 0) / trajectories.length
        : 0
    };

    this.store.trajectories.push(...trajectories);
    await this.saveStore();

    this.emit('batch:generated', { batchId, trajectories, stats });

    return { batchId, trajectories, stats };
  }

  private async simulateTrajectoryGeneration(
    task: string,
    config: BatchGenerationConfig
  ): Promise<Trajectory> {
    await new Promise(resolve => setTimeout(resolve, 100));

    const steps: TrajectoryStep[] = [
      { role: 'user', content: task }
    ];

    const numSteps = Math.floor(Math.random() * config.maxSteps) + 1;

    for (let i = 0; i < numSteps; i++) {
      steps.push({
        role: 'assistant',
        content: `Step ${i + 1}: Analyzing and working on the task...`,
        tool_calls: i < numSteps - 1 ? [{
          id: `call_${i}`,
          name: 'search',
          arguments: { query: `subtask ${i}` }
        }] : undefined
      });

      if (i < numSteps - 1) {
        steps.push({
          role: 'tool',
          content: `Tool result for step ${i + 1}`,
          tool_call_id: `call_${i}`,
          name: 'search'
        });
      }
    }

    steps.push({
      role: 'assistant',
      content: 'Task completed successfully.'
    });

    const success = Math.random() > 0.1;

    return {
      id: `traj_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      sessionId: `session_${Date.now()}`,
      task,
      steps,
      success,
      duration: Math.floor(Math.random() * 5000) + 1000,
      model: config.model || 'gpt-4',
      createdAt: new Date()
    };
  }

  async exportTrajectories(options: {
    format: ExportFormat;
    filter?: {
      successOnly?: boolean;
      minReward?: number;
      since?: Date;
    };
    compression?: CompressionMethod;
  }): Promise<string> {
    let trajectories = [...this.store.trajectories];

    if (options.filter?.successOnly) {
      trajectories = trajectories.filter(t => t.success);
    }
    if (options.filter?.minReward !== undefined) {
      trajectories = trajectories.filter(t => (t.reward || 0) >= options.filter!.minReward!);
    }
    if (options.filter?.since) {
      trajectories = trajectories.filter(t => t.createdAt >= options.filter!.since!);
    }

    if (options.compression) {
      for (const traj of trajectories) {
        if (!traj.compressed) {
          await this.compress(traj.id, options.compression);
        }
      }
    }

    switch (options.format) {
      case 'openai':
        return this.exportToOpenAI(trajectories);
      case 'anthropic':
        return this.exportToAnthropic(trajectories);
      case 'sharegpt':
        return this.exportToShareGPT(trajectories);
      case 'atrac':
        return this.exportToAtrac(trajectories);
      case 'jsonl':
        return trajectories.map(t => JSON.stringify(t)).join('\n');
      default:
        return JSON.stringify(trajectories, null, 2);
    }
  }

  private exportToOpenAI(trajectories: Trajectory[]): string {
    const formatted = trajectories.map(t => ({
      messages: (t.compressed || t.steps).map(s => ({
        role: s.role,
        content: s.content
      }))
    }));

    return formatted.map(f => JSON.stringify(f)).join('\n');
  }

  private exportToAnthropic(trajectories: Trajectory[]): string {
    const formatted = trajectories.map(t => ({
      conversations: [
        { role: 'user', content: t.task },
        ...(t.compressed || t.steps).map(s => ({
          role: s.role === 'tool' ? 'assistant' : s.role,
          content: s.content
        }))
      ],
      reward: t.reward || (t.success ? 1 : 0)
    }));

    return formatted.map(f => JSON.stringify(f)).join('\n');
  }

  private exportToShareGPT(trajectories: Trajectory[]): string {
    const formatted = trajectories.map(t => ({
      id: t.id,
      conversations: (t.compressed || t.steps).map(s => ({
        from: s.role === 'tool' ? 'gpt' : s.role,
        value: s.content,
        tool_calls: s.tool_calls
      })),
      metadata: {
        success: t.success,
        reward: t.reward,
        duration: t.duration
      }
    }));

    return JSON.stringify(formatted, null, 2);
  }

  private exportToAtrac(trajectories: Trajectory[]): string {
    const formatted = trajectories.map(t => ({
      id: t.id,
      task: t.task,
      trajectory: (t.compressed || t.steps).map(s => ({
        role: s.role,
        content: s.content,
        tool_calls: s.tool_calls
      })),
      reward: t.reward || (t.success ? 1 : 0),
      environment: t.metadata?.environment || 'default'
    }));

    return JSON.stringify(formatted, null, 2);
  }

  getTrajectory(trajectoryId: string): Trajectory | undefined {
    return this.store.trajectories.find(t => t.id === trajectoryId);
  }

  getTrajectories(options?: {
    successOnly?: boolean;
    limit?: number;
    since?: Date;
  }): Trajectory[] {
    let trajectories = [...this.store.trajectories];

    if (options?.successOnly) {
      trajectories = trajectories.filter(t => t.success);
    }
    if (options?.since) {
      trajectories = trajectories.filter(t => t.createdAt >= options.since!);
    }

    return trajectories
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, options?.limit || 100);
  }

  getCompressedTrajectories(): CompressedTrajectory[] {
    return [...this.store.compressedTrajectories];
  }

  getRLEnvironments(): RLEnvironment[] {
    return [...this.store.rlEnvironments];
  }

  async addRLEnvironment(env: Omit<RLEnvironment, 'id'>): Promise<RLEnvironment> {
    const entry: RLEnvironment = {
      ...env,
      id: `env_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    };

    this.store.rlEnvironments.push(entry);
    await this.saveStore();
    this.emit('environment:added', entry);

    return entry;
  }

  async cleanup(olderThanDays = 30): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    const before = this.store.trajectories.length;

    this.store.trajectories = this.store.trajectories.filter(t => t.createdAt >= cutoff);

    await this.saveStore();
    return before - this.store.trajectories.length;
  }

  getStats(): {
    totalTrajectories: number;
    successfulTrajectories: number;
    compressedTrajectories: number;
    avgCompressionRatio: number;
    byEnvironment: Record<string, number>;
    totalExports: number;
  } {
    const byEnvironment: Record<string, number> = {};

    for (const traj of this.store.trajectories) {
      const env = traj.metadata?.environment || 'default';
      byEnvironment[env] = (byEnvironment[env] || 0) + 1;
    }

    const compressionRatios = this.store.compressedTrajectories
      .map(c => c.compressionRatio);

    const avgCompressionRatio = compressionRatios.length > 0
      ? compressionRatios.reduce((a, b) => a + b, 0) / compressionRatios.length
      : 0;

    return {
      totalTrajectories: this.store.trajectories.length,
      successfulTrajectories: this.store.trajectories.filter(t => t.success).length,
      compressedTrajectories: this.store.compressedTrajectories.length,
      avgCompressionRatio,
      byEnvironment,
      totalExports: this.store.compressedTrajectories.length
    };
  }
}

export const trajectoryCompressionSystem = TrajectoryCompressionSystem.getInstance();