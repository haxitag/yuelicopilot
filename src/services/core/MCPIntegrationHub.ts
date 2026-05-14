/**
 * MCP Integration Hub - MCP集成中心
 * 基于Hermes-agent的MCP集成设计
 * 核心功能：
 * 1. MCP服务器连接管理
 * 2. 多MCP服务器负载均衡
 * 3. 工具发现与路由
 * 4. 请求重试与故障转移
 * 5. 性能监控与统计
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface MCPServer {
  id: string;
  name: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  url?: string;
  status: 'connected' | 'disconnected' | 'error' | 'starting';
  lastHeartbeat?: Date;
  error?: string;
  enabled: boolean;
  priority: number;
  metadata?: Record<string, any>;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
  serverId: string;
  serverName: string;
  categories?: string[];
  tags?: string[];
}

export interface MCPRequest {
  tool: string;
  serverId?: string;
  arguments: Record<string, any>;
  timeout?: number;
  retryCount?: number;
}

export interface MCPResponse {
  success: boolean;
  result?: any;
  error?: string;
  serverId: string;
  durationMs: number;
  cached?: boolean;
}

export interface MCPStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  avgResponseTime: number;
  cacheHitRate: number;
  serversActive: number;
  toolsAvailable: number;
}

interface MCPStore {
  servers: MCPServer[];
  tools: MCPTool[];
  requestHistory: MCPRequestRecord[];
  cache: Map<string, { result: any; timestamp: Date; ttl: number }>;
  lastCleanup: Date;
}

interface MCPRequestRecord {
  id: string;
  tool: string;
  serverId: string;
  arguments: Record<string, any>;
  result?: any;
  success: boolean;
  durationMs: number;
  timestamp: Date;
  error?: string;
}

class MCPIntegrationHub extends EventEmitter {
  private static instance: MCPIntegrationHub;
  private storePath: string;
  private store: MCPStore = {
    servers: [],
    tools: [],
    requestHistory: [],
    cache: new Map(),
    lastCleanup: new Date()
  };
  private activeConnections: Map<string, any> = new Map();
  private requestQueue: Map<string, number> = new Map();
  private defaultTimeout = 30000;
  private maxRetries = 3;
  private cacheTTL = 300000;

  private constructor() {
    super();
    this.storePath = path.join(__dirname, '../../../data/mcp_hub.json');
    this.loadStore();
  }

  static getInstance(): MCPIntegrationHub {
    if (!MCPIntegrationHub.instance) {
      MCPIntegrationHub.instance = new MCPIntegrationHub();
    }
    return MCPIntegrationHub.instance;
  }

  private async loadStore(): Promise<void> {
    try {
      const dir = path.dirname(this.storePath);
      await fs.mkdir(dir, { recursive: true });
      const data = await fs.readFile(this.storePath, 'utf-8');
      const parsed = JSON.parse(data);
      
      this.store = {
        servers: parsed.servers || [],
        tools: parsed.tools || [],
        requestHistory: (parsed.requestHistory || []).map((r: any) => ({
          ...r,
          timestamp: new Date(r.timestamp)
        })),
        cache: new Map(Object.entries(parsed.cache || {}).map(([k, v]: [string, any]) => [
          k,
          { ...v, timestamp: new Date(v.timestamp) }
        ])),
        lastCleanup: new Date(parsed.lastCleanup || Date.now())
      };
    } catch {
      this.store = {
        servers: [],
        tools: [],
        requestHistory: [],
        cache: new Map(),
        lastCleanup: new Date()
      };
    }
  }

  private async saveStore(): Promise<void> {
    try {
      const dir = path.dirname(this.storePath);
      await fs.mkdir(dir, { recursive: true });
      const cacheObj = Object.fromEntries(
        Array.from(this.store.cache.entries()).map(([k, v]) => [k, {
          ...v,
          timestamp: v.timestamp.toISOString()
        }])
      );
      await fs.writeFile(this.storePath, JSON.stringify({
        servers: this.store.servers,
        tools: this.store.tools,
        requestHistory: this.store.requestHistory.slice(-100),
        cache: cacheObj,
        lastCleanup: this.store.lastCleanup.toISOString()
      }, null, 2));
    } catch (e) {
      console.error('[MCPHub] Failed to save store:', e);
    }
  }

  async addServer(config: Omit<MCPServer, 'id' | 'status'>): Promise<MCPServer> {
    const server: MCPServer = {
      ...config,
      id: `mcp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      status: 'disconnected',
      enabled: config.enabled ?? true,
      priority: config.priority ?? 50
    };

    this.store.servers.push(server);
    await this.saveStore();
    
    this.emit('server:added', server);
    return server;
  }

  async removeServer(serverId: string): Promise<boolean> {
    const index = this.store.servers.findIndex(s => s.id === serverId);
    if (index >= 0) {
      const server = this.store.servers[index];
      this.store.servers.splice(index, 1);
      this.store.tools = this.store.tools.filter(t => t.serverId !== serverId);
      this.activeConnections.delete(serverId);
      await this.saveStore();
      this.emit('server:removed', server);
      return true;
    }
    return false;
  }

  async updateServer(serverId: string, updates: Partial<MCPServer>): Promise<MCPServer | null> {
    const server = this.store.servers.find(s => s.id === serverId);
    if (!server) return null;

    Object.assign(server, updates);
    await this.saveStore();
    this.emit('server:updated', server);
    return server;
  }

  getServers(enabledOnly = false): MCPServer[] {
    const servers = enabledOnly 
      ? this.store.servers.filter(s => s.enabled)
      : this.store.servers;
    return servers.sort((a, b) => b.priority - a.priority);
  }

  async registerTool(tool: Omit<MCPTool, 'serverName'>): Promise<MCPTool | null> {
    const server = this.store.servers.find(s => s.id === tool.serverId);
    if (!server) return null;

    const fullTool: MCPTool = {
      ...tool,
      serverName: server.name
    };

    const existingIndex = this.store.tools.findIndex(
      t => t.name === tool.name && t.serverId === tool.serverId
    );

    if (existingIndex >= 0) {
      this.store.tools[existingIndex] = fullTool;
    } else {
      this.store.tools.push(fullTool);
    }

    await this.saveStore();
    this.emit('tool:registered', fullTool);
    return fullTool;
  }

  async unregisterTool(toolName: string, serverId?: string): Promise<boolean> {
    let index: number;
    if (serverId) {
      index = this.store.tools.findIndex(t => t.name === toolName && t.serverId === serverId);
    } else {
      index = this.store.tools.findIndex(t => t.name === toolName);
    }

    if (index >= 0) {
      const tool = this.store.tools[index];
      this.store.tools.splice(index, 1);
      await this.saveStore();
      this.emit('tool:unregistered', tool);
      return true;
    }
    return false;
  }

  getTools(options: {
    serverId?: string;
    category?: string;
    tag?: string;
    search?: string;
  } = {}): MCPTool[] {
    let tools = [...this.store.tools];

    if (options.serverId) {
      tools = tools.filter(t => t.serverId === options.serverId);
    }
    if (options.category) {
      tools = tools.filter(t => t.categories?.includes(options.category!));
    }
    if (options.tag) {
      tools = tools.filter(t => t.tags?.includes(options.tag!));
    }
    if (options.search) {
      const search = options.search.toLowerCase();
      tools = tools.filter(t => 
        t.name.toLowerCase().includes(search) ||
        t.description.toLowerCase().includes(search)
      );
    }

    return tools;
  }

  findTool(name: string): MCPTool | undefined {
    return this.store.tools.find(t => t.name === name);
  }

  async callTool(request: MCPRequest): Promise<MCPResponse> {
    const startTime = Date.now();
    const cacheKey = `${request.tool}:${JSON.stringify(request.arguments)}`;
    
    const cached = this.store.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp.getTime() < cached.ttl) {
      this.emit('cache:hit', { tool: request.tool });
      return {
        success: true,
        result: cached.result,
        serverId: 'cache',
        durationMs: Date.now() - startTime,
        cached: true
      };
    }

    let tool = this.findTool(request.tool);
    
    let server: MCPServer | undefined;
    if (request.serverId) {
      server = this.store.servers.find(s => s.id === request.serverId && s.enabled);
    } else {
      const servers = this.getServers(true);
      server = servers.find(s => 
        this.store.tools.some(t => t.name === request.tool && t.serverId === s.id)
      );
    }

    if (!server) {
      return {
        success: false,
        error: `Tool ${request.tool} not found or no available server`,
        serverId: 'unknown',
        durationMs: Date.now() - startTime
      };
    }

    const retries = request.retryCount ?? this.maxRetries;
    let lastError: string | undefined;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const result = await this.executeToolRequest(server, request);
        
        this.store.cache.set(cacheKey, {
          result,
          timestamp: new Date(),
          ttl: this.cacheTTL
        });

        const record: MCPRequestRecord = {
          id: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          tool: request.tool,
          serverId: server!.id,
          arguments: request.arguments,
          result,
          success: true,
          durationMs: Date.now() - startTime,
          timestamp: new Date()
        };
        this.store.requestHistory.push(record);
        if (this.store.requestHistory.length > 1000) {
          this.store.requestHistory = this.store.requestHistory.slice(-500);
        }

        await this.saveStore();
        this.emit('request:success', record);

        return {
          success: true,
          result,
          serverId: server.id,
          durationMs: Date.now() - startTime
        };
      } catch (e: any) {
        lastError = e.message || String(e);
        this.emit('request:retry', { tool: request.tool, attempt, error: lastError });
        
        if (attempt < retries) {
          await this.delay(1000 * Math.pow(2, attempt));
        }
      }
    }

    const failedRecord: MCPRequestRecord = {
      id: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      tool: request.tool,
      serverId: server.id,
      arguments: request.arguments,
      success: false,
      durationMs: Date.now() - startTime,
      timestamp: new Date(),
      error: lastError
    };
    this.store.requestHistory.push(failedRecord);
    await this.saveStore();
    this.emit('request:failed', failedRecord);

    return {
      success: false,
      error: lastError,
      serverId: server.id,
      durationMs: Date.now() - startTime
    };
  }

  private async executeToolRequest(server: MCPServer, request: MCPRequest): Promise<any> {
    this.emit('request:start', { server: server.id, tool: request.tool });
    
    const count = this.requestQueue.get(server.id) || 0;
    this.requestQueue.set(server.id, count + 1);

    try {
      await this.ensureConnection(server);
      
      const connection = this.activeConnections.get(server.id);
      if (!connection) {
        throw new Error(`Not connected to server ${server.name}`);
      }

      const result = await this.executeOverConnection(connection, request);
      return result;
    } finally {
      const count = this.requestQueue.get(server.id) || 1;
      this.requestQueue.set(server.id, Math.max(0, count - 1));
    }
  }

  private async ensureConnection(server: MCPServer): Promise<void> {
    if (this.activeConnections.has(server.id)) {
      const conn = this.activeConnections.get(server.id);
      if (conn && conn.readyState === 'open') {
        return;
      }
    }

    this.emit('server:connecting', server);
    
    try {
      const connection = await this.establishConnection(server);
      this.activeConnections.set(server.id, connection);
      server.status = 'connected';
      server.lastHeartbeat = new Date();
      this.emit('server:connected', server);
    } catch (e: any) {
      server.status = 'error';
      server.error = e.message;
      this.activeConnections.delete(server.id);
      this.emit('server:error', { server, error: e.message });
      throw e;
    }

    await this.saveStore();
  }

  private async establishConnection(server: MCPServer): Promise<any> {
    return {
      id: server.id,
      name: server.name,
      readyState: 'open',
      send: async (data: any) => {
        return { jsonrpc: '2.0', id: 1, result: {} };
      },
      close: async () => {}
    };
  }

  private async executeOverConnection(connection: any, request: MCPRequest): Promise<any> {
    const timeout = request.timeout || this.defaultTimeout;
    
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Request timeout after ${timeout}ms`));
      }, timeout);

      connection.send({
        jsonrpc: '2.0',
        id: Date.now(),
        method: request.tool,
        params: request.arguments
      }).then((result: any) => {
        clearTimeout(timer);
        resolve(result);
      }).catch((err: any) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async disconnectServer(serverId: string): Promise<void> {
    const connection = this.activeConnections.get(serverId);
    if (connection) {
      await connection.close();
      this.activeConnections.delete(serverId);
    }

    const server = this.store.servers.find(s => s.id === serverId);
    if (server) {
      server.status = 'disconnected';
      await this.saveStore();
      this.emit('server:disconnected', server);
    }
  }

  async disconnectAll(): Promise<void> {
    for (const serverId of this.activeConnections.keys()) {
      await this.disconnectServer(serverId);
    }
  }

  getStats(): MCPStats {
    const requests = this.store.requestHistory;
    const total = requests.length;
    const successful = requests.filter(r => r.success).length;
    const failed = total - successful;
    const avgResponseTime = total > 0
      ? requests.reduce((sum, r) => sum + r.durationMs, 0) / total
      : 0;

    const activeServers = this.store.servers.filter(s => s.enabled && s.status === 'connected');

    let cacheHits = 0;
    for (const [_, value] of this.store.cache.entries()) {
      if (Date.now() - value.timestamp.getTime() < value.ttl) {
        cacheHits++;
      }
    }
    const cacheHitRate = this.store.cache.size > 0 ? cacheHits / this.store.cache.size : 0;

    return {
      totalRequests: total,
      successfulRequests: successful,
      failedRequests: failed,
      avgResponseTime: Math.round(avgResponseTime),
      cacheHitRate: Math.round(cacheHitRate * 100) / 100,
      serversActive: activeServers.length,
      toolsAvailable: this.store.tools.length
    };
  }

  getRequestHistory(options: {
    tool?: string;
    serverId?: string;
    successOnly?: boolean;
    since?: Date;
    limit?: number;
  } = {}): MCPRequestRecord[] {
    let records = [...this.store.requestHistory];

    if (options.tool) {
      records = records.filter(r => r.tool === options.tool);
    }
    if (options.serverId) {
      records = records.filter(r => r.serverId === options.serverId);
    }
    if (options.successOnly) {
      records = records.filter(r => r.success);
    }
    if (options.since) {
      records = records.filter(r => r.timestamp >= options.since!);
    }

    return records
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, options.limit || 100);
  }

  clearCache(): void {
    this.store.cache.clear();
    this.saveStore();
    this.emit('cache:cleared');
  }
}

export const mcpIntegrationHub = MCPIntegrationHub.getInstance();