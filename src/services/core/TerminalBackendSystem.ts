/**
 * Terminal Backend System - 终端后端系统
 * 基于Hermes-agent的Terminal Backend设计
 * 支持：Local, Docker, SSH, Daytona, Singularity, Modal
 * 核心功能：
 * 1. 多后端类型支持
 * 2. 远程SSH执行
 * 3. Docker容器管理
 * 4. 统一命令执行接口
 * 5. 连接状态管理
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';
import { spawn, exec } from 'child_process';
import net from 'net';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type BackendType = 'local' | 'docker' | 'ssh' | 'daytona' | 'singularity' | 'modal';
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface BackendConfig {
  type: BackendType;
  name: string;
  enabled: boolean;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  privateKeyPath?: string;
  containerId?: string;
  image?: string;
  workspacePath?: string;
  environment?: Record<string, string>;
  timeout?: number;
}

export interface ExecutionResult {
  id: string;
  backend: BackendType;
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
  timestamp: Date;
  success: boolean;
}

export interface Session {
  id: string;
  backendType: BackendType;
  backendName: string;
  status: ConnectionStatus;
  connectedAt?: Date;
  lastCommandAt?: Date;
  commandCount: number;
  metadata?: Record<string, any>;
}

interface BackendStore {
  backends: BackendConfig[];
  sessions: Session[];
  executions: ExecutionResult[];
  activeSessionId?: string;
}

class TerminalBackendSystem extends EventEmitter {
  private static instance: TerminalBackendSystem;
  private storePath: string;
  private store: BackendStore = {
    backends: [],
    sessions: [],
    executions: []
  };
  private activeProcesses: Map<string, any> = new Map();

  private constructor() {
    super();
    this.storePath = path.join(__dirname, '../../../data/terminal_backends.json');
    this.loadStore();
    this.initializeDefaultBackends();
  }

  static getInstance(): TerminalBackendSystem {
    if (!TerminalBackendSystem.instance) {
      TerminalBackendSystem.instance = new TerminalBackendSystem();
    }
    return TerminalBackendSystem.instance;
  }

  private async loadStore(): Promise<void> {
    try {
      const dir = path.dirname(this.storePath);
      await fs.mkdir(dir, { recursive: true });
      const data = await fs.readFile(this.storePath, 'utf-8');
      const parsed = JSON.parse(data);
      this.store = {
        backends: parsed.backends || [],
        sessions: (parsed.sessions || []).map((s: any) => ({
          ...s,
          connectedAt: s.connectedAt ? new Date(s.connectedAt) : undefined,
          lastCommandAt: s.lastCommandAt ? new Date(s.lastCommandAt) : undefined
        })),
        executions: (parsed.executions || []).map((e: any) => ({
          ...e,
          timestamp: new Date(e.timestamp)
        })),
        activeSessionId: parsed.activeSessionId
      };
    } catch {}
  }

  private async saveStore(): Promise<void> {
    try {
      const dir = path.dirname(this.storePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(this.storePath, JSON.stringify(this.store, null, 2));
    } catch (e) {
      console.error('[TerminalBackend] Failed to save store:', e);
    }
  }

  private initializeDefaultBackends(): void {
    if (this.store.backends.length === 0) {
      this.store.backends = [
        {
          type: 'local',
          name: 'Local',
          enabled: true,
          workspacePath: process.cwd(),
          timeout: 60000
        }
      ];
      this.saveStore();
    }
  }

  async addBackend(config: Omit<BackendConfig, 'type' | 'name'> & {
    type: BackendType;
    name: string;
  }): Promise<BackendConfig> {
    const backend: BackendConfig = {
      ...config,
      enabled: true
    };

    this.store.backends.push(backend);
    await this.saveStore();
    this.emit('backend:added', backend);

    return backend;
  }

  async updateBackend(name: string, updates: Partial<BackendConfig>): Promise<BackendConfig | null> {
    const backend = this.store.backends.find(b => b.name === name);
    if (!backend) return null;

    Object.assign(backend, updates);
    await this.saveStore();
    this.emit('backend:updated', backend);

    return backend;
  }

  async removeBackend(name: string): Promise<boolean> {
    const index = this.store.backends.findIndex(b => b.name === name);
    if (index < 0) return false;

    const session = this.store.sessions.find(s => s.backendName === name);
    if (session) {
      await this.disconnect(session.id);
    }

    this.store.backends.splice(index, 1);
    await this.saveStore();
    return true;
  }

  getBackends(): BackendConfig[] {
    return [...this.store.backends];
  }

  getBackend(name: string): BackendConfig | undefined {
    return this.store.backends.find(b => b.name === name);
  }

  async connect(backendName: string): Promise<Session> {
    const backend = this.store.backends.find(b => b.name === backendName);
    if (!backend) {
      throw new Error(`Backend ${backendName} not found`);
    }

    const existingSession = this.store.sessions.find(
      s => s.backendName === backendName && s.status === 'connected'
    );
    if (existingSession) {
      return existingSession;
    }

    const session: Session = {
      id: `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      backendType: backend.type,
      backendName: backend.name,
      status: 'connecting',
      commandCount: 0
    };

    this.store.sessions.push(session);
    this.emit('session:connecting', session);

    try {
      const connected = await this.testConnection(backend);

      if (connected) {
        session.status = 'connected';
        session.connectedAt = new Date();
        this.store.activeSessionId = session.id;
        this.emit('session:connected', session);
      } else {
        session.status = 'error';
        this.emit('session:error', session);
      }
    } catch (error: any) {
      session.status = 'error';
      this.emit('session:error', session, error);
    }

    await this.saveStore();
    return session;
  }

  private testConnection(backend: BackendConfig): Promise<boolean> {
    return new Promise((resolve) => {
      switch (backend.type) {
        case 'local':
          exec('echo "test" > /dev/null', (error) => {
            resolve(!error);
          });
          break;

        case 'ssh':
          if (backend.host) {
            const socket = net.createConnection({
              host: backend.host,
              port: backend.port || 22
            }, () => {
              socket.destroy();
              resolve(true);
            });
            socket.on('error', () => resolve(false));
            socket.setTimeout(5000, () => {
              socket.destroy();
              resolve(false);
            });
          } else {
            resolve(false);
          }
          break;

        case 'docker':
          exec('docker ps', (error) => {
            resolve(!error);
          });
          break;

        default:
          resolve(true);
      }
    });
  }

  async disconnect(sessionId: string): Promise<boolean> {
    const session = this.store.sessions.find(s => s.id === sessionId);
    if (!session) return false;

    const process = this.activeProcesses.get(sessionId);
    if (process) {
      try { process.kill(); } catch {}
      this.activeProcesses.delete(sessionId);
    }

    session.status = 'disconnected';

    if (this.store.activeSessionId === sessionId) {
      this.store.activeSessionId = undefined;
    }

    await this.saveStore();
    this.emit('session:disconnected', session);

    return true;
  }

  async execute(command: string, options?: {
    sessionId?: string;
    backendName?: string;
    timeout?: number;
    cwd?: string;
    env?: Record<string, string>;
  }): Promise<ExecutionResult> {
    let session: Session | undefined;
    let backend: BackendConfig | undefined;

    if (options?.sessionId) {
      session = this.store.sessions.find(s => s.id === options.sessionId);
      if (session) {
        backend = this.store.backends.find(b => b.name === session!.backendName);
      }
    } else if (options?.backendName) {
      backend = this.store.backends.find(b => b.name === options.backendName);
    } else {
      backend = this.store.backends.find(b => b.enabled && b.type === 'local');
    }

    if (!backend) {
      throw new Error('No available backend found');
    }

    const startTime = Date.now();
    const result: ExecutionResult = {
      id: `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      backend: backend.type,
      command,
      exitCode: -1,
      stdout: '',
      stderr: '',
      duration: 0,
      timestamp: new Date(),
      success: false
    };

    try {
      const execResult = await this.executeOnBackend(backend, command, options);
      result.exitCode = execResult.exitCode;
      result.stdout = execResult.stdout;
      result.stderr = execResult.stderr;
      result.success = execResult.exitCode === 0;
    } catch (error: any) {
      result.stderr = error.message;
      result.exitCode = -1;
      result.success = false;
    }

    result.duration = Date.now() - startTime;

    this.store.executions.push(result);
    if (session) {
      session.lastCommandAt = new Date();
      session.commandCount++;
    }

    if (this.store.executions.length > 1000) {
      this.store.executions = this.store.executions.slice(-500);
    }

    await this.saveStore();
    this.emit('execution:completed', result);

    return result;
  }

  private executeOnBackend(
    backend: BackendConfig,
    command: string,
    options?: { timeout?: number; cwd?: string; env?: Record<string, string> }
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      const timeout = options?.timeout || backend.timeout || 60000;
      let cmd: string;
      let args: string[];

      switch (backend.type) {
        case 'local':
          cmd = 'bash';
          args = ['-c', command];
          break;

        case 'ssh':
          if (backend.host && backend.username) {
            const sshCmd = this.buildSSHCommand(backend, command);
            cmd = 'bash';
            args = ['-c', sshCmd];
          } else {
            resolve({ exitCode: -1, stdout: '', stderr: 'SSH not configured' });
            return;
          }
          break;

        case 'docker':
          cmd = 'docker';
          args = ['exec', backend.containerId || 'container', 'bash', '-c', command];
          break;

        case 'daytona':
          cmd = 'daytona';
          args = ['run', command];
          break;

        default:
          cmd = 'bash';
          args = ['-c', command];
      }

      const proc = spawn(cmd, args, {
        cwd: options?.cwd || backend.workspacePath || process.cwd(),
        env: { ...process.env, ...backend.environment, ...options?.env },
        timeout
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        resolve({ exitCode: code || 0, stdout, stderr });
      });

      proc.on('error', (error) => {
        resolve({ exitCode: -1, stdout: '', stderr: error.message });
      });

      setTimeout(() => {
        proc.kill();
        resolve({ exitCode: -1, stdout, stderr: 'Command timed out' });
      }, timeout);
    });
  }

  private buildSSHCommand(backend: BackendConfig, command: string): string {
    let sshCmd = 'ssh';

    if (backend.port && backend.port !== 22) {
      sshCmd += ` -p ${backend.port}`;
    }

    if (backend.privateKeyPath) {
      sshCmd += ` -i "${backend.privateKeyPath}"`;
    }

    const user = backend.username || 'root';
    const host = backend.host || 'localhost';

    sshCmd += ` ${user}@${host}`;

    if (backend.password) {
      sshCmd = `sshpass -p "${backend.password}" ${sshCmd}`;
    }

    sshCmd += ` "${command.replace(/"/g, '\\"')}"`;

    return sshCmd;
  }

  async startInteractiveSession(backendName: string): Promise<string> {
    const backend = this.store.backends.find(b => b.name === backendName);
    if (!backend) {
      throw new Error(`Backend ${backendName} not found`);
    }

    const session = await this.connect(backendName);
    return session.id;
  }

  getSessions(): Session[] {
    return [...this.store.sessions];
  }

  getSession(sessionId: string): Session | undefined {
    return this.store.sessions.find(s => s.id === sessionId);
  }

  getActiveSession(): Session | undefined {
    if (!this.store.activeSessionId) return undefined;
    return this.getSession(this.store.activeSessionId);
  }

  async setActiveSession(sessionId: string): Promise<boolean> {
    const session = this.store.sessions.find(s => s.id === sessionId);
    if (!session || session.status !== 'connected') return false;

    this.store.activeSessionId = sessionId;
    await this.saveStore();
    return true;
  }

  getExecutions(options?: {
    backend?: BackendType;
    limit?: number;
    since?: Date;
  }): ExecutionResult[] {
    let executions = [...this.store.executions];

    if (options?.backend) {
      executions = executions.filter(e => e.backend === options.backend);
    }
    if (options?.since) {
      executions = executions.filter(e => e.timestamp >= options.since!);
    }

    return executions
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, options?.limit || 100);
  }

  async cleanupOldExecutions(olderThanDays = 7): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
    const before = this.store.executions.length;

    this.store.executions = this.store.executions.filter(e => e.timestamp >= cutoff);

    await this.saveStore();
    return before - this.store.executions.length;
  }

  getStats(): {
    totalBackends: number;
    activeBackends: number;
    totalSessions: number;
    connectedSessions: number;
    totalExecutions: number;
    successfulExecutions: number;
    failedExecutions: number;
    byBackend: Record<BackendType, number>;
  } {
    const byBackend: Record<BackendType, number> = {
      local: 0,
      docker: 0,
      ssh: 0,
      daytona: 0,
      singularity: 0,
      modal: 0
    };

    for (const exec of this.store.executions) {
      byBackend[exec.backend]++;
    }

    return {
      totalBackends: this.store.backends.length,
      activeBackends: this.store.backends.filter(b => b.enabled).length,
      totalSessions: this.store.sessions.length,
      connectedSessions: this.store.sessions.filter(s => s.status === 'connected').length,
      totalExecutions: this.store.executions.length,
      successfulExecutions: this.store.executions.filter(e => e.success).length,
      failedExecutions: this.store.executions.filter(e => !e.success).length,
      byBackend
    };
  }
}

export const terminalBackendSystem = TerminalBackendSystem.getInstance();