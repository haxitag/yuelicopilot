/**
 * 真实连接器实现 - 替代 MCPConnectorManager 中的 mock 实现
 */

import { resolveSkillExecutorAuthHeaders, resolveSkillExecutorBaseUrl } from '../../utils/skillExecutorUrl';

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  type: 'postgresql' | 'mysql' | 'sqlite';
}

export interface FileSystemConfig {
  basePath: string;
  allowedExtensions?: string[];
  maxFileSize?: number; // bytes
}

export interface ApiConnectorConfig {
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
  timeout?: number;
}

export type ConnectorQueryResult = {
  success: boolean;
  data?: any;
  error?: string;
  metadata?: Record<string, any>;
};

/**
 * 数据库连接器 - 通过 KGM 后端代理执行真实 SQL
 */
export class DatabaseConnector {
  private config: DatabaseConfig;
  private executorUrl: string;
  private connected = false;

  constructor(config: DatabaseConfig) {
    this.config = config;
    this.executorUrl = resolveSkillExecutorBaseUrl();
  }

  async connect(): Promise<void> {
    const response = await this.proxyRequest('/v1/db/connect', {
      type: this.config.type,
      host: this.config.host,
      port: this.config.port,
      database: this.config.database,
      user: this.config.user,
      password: this.config.password
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`数据库连接失败: ${err}`);
    }
    this.connected = true;
  }

  async query(sql: string, params?: any[]): Promise<ConnectorQueryResult> {
    if (!this.connected) {
      return { success: false, error: '数据库未连接' };
    }

    try {
      const response = await this.proxyRequest('/v1/db/query', {
        type: this.config.type,
        host: this.config.host,
        port: this.config.port,
        database: this.config.database,
        user: this.config.user,
        password: this.config.password,
        sql,
        params: params || []
      });

      if (!response.ok) {
        const err = await response.text();
        return { success: false, error: `查询失败: ${err}` };
      }

      const data = await response.json();
      return {
        success: true,
        data: data.rows || data,
        metadata: {
          rowCount: data.rowCount,
          fields: data.fields,
          executedAt: new Date().toISOString()
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '查询执行失败'
      };
    }
  }

  async execute(sql: string, params?: any[]): Promise<ConnectorQueryResult> {
    return this.query(sql, params);
  }

  isConnected(): boolean {
    return this.connected;
  }

  private async proxyRequest(path: string, body: any): Promise<Response> {
    return fetch(`${this.executorUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...resolveSkillExecutorAuthHeaders() },
      body: JSON.stringify(body)
    });
  }
}

/**
 * 文件系统连接器 - 使用 File System Access API + KGM 代理
 */
export class FileSystemConnector {
  private config: FileSystemConfig;
  private executorUrl: string;
  private directoryHandle: FileSystemDirectoryHandle | null = null;

  constructor(config: FileSystemConfig) {
    this.config = config;
    this.executorUrl = resolveSkillExecutorBaseUrl();
  }

  /**
   * 请求用户授权访问目录 (File System Access API)
   */
  async requestDirectoryAccess(): Promise<boolean> {
    try {
      if ('showDirectoryPicker' in window) {
        this.directoryHandle = await (window as any).showDirectoryPicker({
          mode: 'readwrite'
        });
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  async readFile(path: string): Promise<ConnectorQueryResult> {
    // 优先使用 File System Access API
    if (this.directoryHandle) {
      try {
        const parts = path.split('/').filter(Boolean);
        let current: FileSystemDirectoryHandle = this.directoryHandle;
        for (let i = 0; i < parts.length - 1; i++) {
          current = await current.getDirectoryHandle(parts[i]);
        }
        const fileHandle = await current.getFileHandle(parts[parts.length - 1]);
        const file = await fileHandle.getFile();
        const content = await file.text();
        return {
          success: true,
          data: { content, name: file.name, size: file.size, type: file.type },
          metadata: { path, readAt: new Date().toISOString() }
        };
      } catch (error) {
        return { success: false, error: `读取文件失败: ${error}` };
      }
    }

    // 回退到 KGM 代理
    return this.proxyFileOperation('read', { path });
  }

  async writeFile(path: string, content: string): Promise<ConnectorQueryResult> {
    if (this.directoryHandle) {
      try {
        const parts = path.split('/').filter(Boolean);
        let current: FileSystemDirectoryHandle = this.directoryHandle;
        for (let i = 0; i < parts.length - 1; i++) {
          current = await current.getDirectoryHandle(parts[i], { create: true });
        }
        const fileHandle = await current.getFileHandle(parts[parts.length - 1], { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(content);
        await writable.close();
        return { success: true, data: { path, written: content.length } };
      } catch (error) {
        return { success: false, error: `写入文件失败: ${error}` };
      }
    }

    return this.proxyFileOperation('write', { path, content });
  }

  async listDirectory(path: string = '/'): Promise<ConnectorQueryResult> {
    if (this.directoryHandle) {
      try {
        const parts = path.split('/').filter(Boolean);
        let current: FileSystemDirectoryHandle = this.directoryHandle;
        for (const part of parts) {
          current = await current.getDirectoryHandle(part);
        }
        const entries: any[] = [];
        for await (const [name, handle] of (current as any).entries()) {
          entries.push({ name, type: handle.kind });
        }
        return { success: true, data: { path, entries } };
      } catch (error) {
        return { success: false, error: `列出目录失败: ${error}` };
      }
    }

    return this.proxyFileOperation('list', { path });
  }

  async deleteFile(path: string): Promise<ConnectorQueryResult> {
    return this.proxyFileOperation('delete', { path });
  }

  private async proxyFileOperation(operation: string, params: any): Promise<ConnectorQueryResult> {
    try {
      const response = await fetch(`${this.executorUrl}/v1/fs/${operation}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...resolveSkillExecutorAuthHeaders() },
        body: JSON.stringify({ basePath: this.config.basePath, ...params })
      });

      if (!response.ok) {
        return { success: false, error: `文件操作失败: ${response.status}` };
      }

      const data = await response.json();
      return { success: true, data };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '文件操作失败'
      };
    }
  }
}

/**
 * HTTP API 连接器 - 真实 HTTP 请求
 */
export class HttpApiConnector {
  private config: ApiConnectorConfig;

  constructor(config: ApiConnectorConfig) {
    this.config = config;
  }

  async get(path: string, params?: Record<string, string>): Promise<ConnectorQueryResult> {
    return this.request('GET', path, undefined, params);
  }

  async post(path: string, body: any): Promise<ConnectorQueryResult> {
    return this.request('POST', path, body);
  }

  async put(path: string, body: any): Promise<ConnectorQueryResult> {
    return this.request('PUT', path, body);
  }

  async delete(path: string): Promise<ConnectorQueryResult> {
    return this.request('DELETE', path);
  }

  async testConnection(): Promise<boolean> {
    try {
      const result = await this.get('/');
      return result.success;
    } catch {
      return false;
    }
  }

  private async request(
    method: string,
    path: string,
    body?: any,
    queryParams?: Record<string, string>
  ): Promise<ConnectorQueryResult> {
    try {
      let url = `${this.config.baseUrl}${path}`;
      if (queryParams) {
        url += '?' + new URLSearchParams(queryParams).toString();
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...this.config.headers
      };

      if (this.config.apiKey) {
        headers['Authorization'] = `Bearer ${this.config.apiKey}`;
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.timeout || 30000);

      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });

      clearTimeout(timer);

      const contentType = response.headers.get('content-type') || '';
      let data: any;
      if (contentType.includes('application/json')) {
        data = await response.json();
      } else {
        data = await response.text();
      }

      return {
        success: response.ok,
        data,
        error: response.ok ? undefined : `HTTP ${response.status}: ${response.statusText}`,
        metadata: {
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          url
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '请求失败'
      };
    }
  }
}
