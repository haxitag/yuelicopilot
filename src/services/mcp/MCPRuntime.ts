/**
 * MCP Runtime - 真实的 MCP 容器实现
 * 支持运行 MCP 配置，管理 MCP server 连接，处理 tool call 协议
 */

import { resolveSkillExecutorAuthHeaders, resolveSkillExecutorBaseUrl } from '../../utils/skillExecutorUrl';

export interface MCPServerConfig {
  id: string;
  name: string;
  type: 'stdio' | 'http' | 'sse' | 'websocket';
  // stdio 类型
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  // http/sse/websocket 类型
  url?: string;
  headers?: Record<string, string>;
  // 通用
  timeout?: number;
  enabled: boolean;
  description?: string;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
  serverId?: string;
}

export interface MCPToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface MCPToolResult {
  toolCallId: string;
  content: Array<{
    type: 'text' | 'image' | 'resource';
    text?: string;
    data?: string;
    mimeType?: string;
    uri?: string;
  }>;
  isError?: boolean;
}

export interface MCPServerStatus {
  id: string;
  connected: boolean;
  tools: MCPTool[];
  error?: string;
  lastConnected?: Date;
}

type MessageHandler = (message: any) => void;

/**
 * MCP HTTP/SSE 客户端
 */
class MCPHttpClient {
  private url: string;
  private headers: Record<string, string>;
  private timeout: number;

  constructor(url: string, headers: Record<string, string> = {}, timeout = 30000) {
    this.url = url;
    this.headers = headers;
    this.timeout = timeout;
  }

  async initialize(): Promise<{ tools: MCPTool[]; serverId: string }> {
    const response = await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      clientInfo: { name: 'yueli-copilot', version: '1.0.0' }
    });
    return response;
  }

  async listTools(serverId: string): Promise<MCPTool[]> {
    const response = await this.sendRequest('tools/list', {});
    const tools = (response.tools || []).map((t: any) => ({ ...t, serverId }));
    return tools;
  }

  async callTool(name: string, args: Record<string, any>): Promise<MCPToolResult> {
    const id = `call_${Date.now()}`;
    const response = await this.sendRequest('tools/call', { name, arguments: args });
    return {
      toolCallId: id,
      content: response.content || [{ type: 'text', text: JSON.stringify(response) }],
      isError: response.isError || false
    };
  }

  private async sendRequest(method: string, params: any): Promise<any> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.headers
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method,
          params
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`MCP HTTP error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      if (data.error) {
        throw new Error(`MCP error: ${data.error.message}`);
      }
      return data.result;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * MCP WebSocket 客户端
 */
class MCPWebSocketClient {
  private url: string;
  private ws: WebSocket | null = null;
  private pendingRequests: Map<number, { resolve: Function; reject: Function }> = new Map();
  private messageHandlers: MessageHandler[] = [];
  private requestId = 0;
  private tools: MCPTool[] = [];

  constructor(url: string) {
    this.url = url;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => resolve();
      this.ws.onerror = (_e) => reject(new Error('WebSocket connection failed'));
      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.id !== undefined && this.pendingRequests.has(data.id)) {
            const { resolve, reject } = this.pendingRequests.get(data.id)!;
            this.pendingRequests.delete(data.id);
            if (data.error) {
              reject(new Error(data.error.message));
            } else {
              resolve(data.result);
            }
          }
          this.messageHandlers.forEach(h => h(data));
        } catch (e) {
          console.error('MCP WS parse error:', e);
        }
      };
    });
  }

  async sendRequest(method: string, params: any): Promise<any> {
    const id = ++this.requestId;
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.ws?.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('MCP request timeout'));
        }
      }, 30000);
    });
  }

  async listTools(serverId: string): Promise<MCPTool[]> {
    const result = await this.sendRequest('tools/list', {});
    this.tools = (result.tools || []).map((t: any) => ({ ...t, serverId }));
    return this.tools;
  }

  async callTool(name: string, args: Record<string, any>): Promise<MCPToolResult> {
    const id = `call_${Date.now()}`;
    const result = await this.sendRequest('tools/call', { name, arguments: args });
    return {
      toolCallId: id,
      content: result.content || [{ type: 'text', text: JSON.stringify(result) }],
      isError: result.isError || false
    };
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
  }
}

/**
 * MCP Runtime 主类 - 管理所有 MCP server 连接
 */
export class MCPRuntime {
  private servers: Map<string, MCPServerConfig> = new Map();
  private serverStatus: Map<string, MCPServerStatus> = new Map();
  private httpClients: Map<string, MCPHttpClient> = new Map();
  private wsClients: Map<string, MCPWebSocketClient> = new Map();
  private allTools: Map<string, MCPTool> = new Map(); // toolName -> tool
  private readonly STORAGE_KEY = 'yueli_mcp_servers';

  constructor() {
    this.loadFromStorage();
  }

  // ==================== Server 管理 ====================

  addServer(config: MCPServerConfig): void {
    this.servers.set(config.id, config);
    this.serverStatus.set(config.id, {
      id: config.id,
      connected: false,
      tools: []
    });
    this.saveToStorage();
  }

  updateServer(id: string, updates: Partial<MCPServerConfig>): void {
    const existing = this.servers.get(id);
    if (existing) {
      this.servers.set(id, { ...existing, ...updates });
      this.saveToStorage();
    }
  }

  removeServer(id: string): void {
    this.disconnectServer(id);
    this.servers.delete(id);
    this.serverStatus.delete(id);
    this.saveToStorage();
  }

  getServer(id: string): MCPServerConfig | undefined {
    return this.servers.get(id);
  }

  getAllServers(): MCPServerConfig[] {
    return Array.from(this.servers.values());
  }

  getServerStatus(id: string): MCPServerStatus | undefined {
    return this.serverStatus.get(id);
  }

  getAllServerStatuses(): MCPServerStatus[] {
    return Array.from(this.serverStatus.values());
  }

  // ==================== 连接管理 ====================

  async connectServer(id: string): Promise<void> {
    const config = this.servers.get(id);
    if (!config) throw new Error(`MCP server ${id} not found`);
    if (!config.enabled) throw new Error(`MCP server ${id} is disabled`);

    const status = this.serverStatus.get(id) || { id, connected: false, tools: [] };

    try {
      let tools: MCPTool[] = [];

      if (config.type === 'http' || config.type === 'sse') {
        const client = new MCPHttpClient(
          config.url!,
          config.headers || {},
          config.timeout || 30000
        );
        await client.initialize();
        tools = await client.listTools(id);
        this.httpClients.set(id, client);
      } else if (config.type === 'websocket') {
        const client = new MCPWebSocketClient(config.url!);
        await client.connect();
        await client.sendRequest('initialize', {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          clientInfo: { name: 'yueli-copilot', version: '1.0.0' }
        });
        tools = await client.listTools(id);
        this.wsClients.set(id, client);
      } else if (config.type === 'stdio') {
        // stdio 类型在浏览器环境中需要通过后端代理
        // 通过 yueli-kgm-computing 的 /v1/mcp/proxy 端点代理
        tools = await this.connectViaProxy(config);
      }

      // 注册所有工具
      tools.forEach(tool => {
        this.allTools.set(`${id}:${tool.name}`, tool);
      });

      status.connected = true;
      status.tools = tools;
      status.error = undefined;
      status.lastConnected = new Date();
      this.serverStatus.set(id, status);

      console.log(`MCP server ${id} connected with ${tools.length} tools`);
    } catch (error) {
      status.connected = false;
      status.error = error instanceof Error ? error.message : String(error);
      this.serverStatus.set(id, status);
      throw error;
    }
  }

  async disconnectServer(id: string): Promise<void> {
    const wsClient = this.wsClients.get(id);
    if (wsClient) {
      wsClient.disconnect();
      this.wsClients.delete(id);
    }
    this.httpClients.delete(id);

    // 移除该 server 的所有工具
    for (const _key of this.allTools.keys()) {
      if (_key.startsWith(`${id}:`)) {
        this.allTools.delete(_key);
      }
    }

    const status = this.serverStatus.get(id);
    if (status) {
      status.connected = false;
      status.tools = [];
      this.serverStatus.set(id, status);
    }
  }

  async connectAll(): Promise<void> {
    const servers = this.getAllServers().filter(s => s.enabled);
    await Promise.allSettled(servers.map(s => this.connectServer(s.id)));
  }

  // ==================== Tool 调用 ====================

  getAllTools(): MCPTool[] {
    return Array.from(this.allTools.values());
  }

  getToolsForLLM(): Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: any;
    };
  }> {
    return this.getAllTools().map(tool => ({
      type: 'function' as const,
      function: {
        name: `mcp__${tool.serverId}__${tool.name}`,
        description: `[MCP:${tool.serverId}] ${tool.description}`,
        parameters: tool.inputSchema
      }
    }));
  }

  async callTool(serverId: string, toolName: string, args: Record<string, any>): Promise<MCPToolResult> {
    const config = this.servers.get(serverId);
    if (!config) throw new Error(`MCP server ${serverId} not found`);

    const status = this.serverStatus.get(serverId);
    if (!status?.connected) {
      // 尝试重连
      await this.connectServer(serverId);
    }

    if (config.type === 'http' || config.type === 'sse') {
      const client = this.httpClients.get(serverId);
      if (!client) throw new Error(`No HTTP client for server ${serverId}`);
      return await client.callTool(toolName, args);
    } else if (config.type === 'websocket') {
      const client = this.wsClients.get(serverId);
      if (!client) throw new Error(`No WS client for server ${serverId}`);
      return await client.callTool(toolName, args);
    } else if (config.type === 'stdio') {
      return await this.callToolViaProxy(config, toolName, args);
    }

    throw new Error(`Unsupported server type: ${config.type}`);
  }

  /**
   * 解析 LLM 返回的 tool call 名称，执行对应 MCP tool
   */
  async executeLLMToolCall(toolCall: MCPToolCall): Promise<MCPToolResult> {
    // 格式: mcp__serverId__toolName
    const match = toolCall.name.match(/^mcp__([^_]+(?:_[^_]+)*)__(.+)$/);
    if (match) {
      const serverId = match[1];
      const toolName = match[2];
      return await this.callTool(serverId, toolName, toolCall.arguments);
    }

    // 直接工具名查找
    for (const [_key, tool] of this.allTools) {
      if (tool.name === toolCall.name) {
        if (!tool.serverId) {
          throw new Error(`Tool ${toolCall.name} has no serverId`);
        }
        return await this.callTool(tool.serverId, tool.name, toolCall.arguments);
      }
    }

    throw new Error(`Tool ${toolCall.name} not found in any MCP server`);
  }

  // ==================== 代理支持 (stdio 类型) ====================

  private async connectViaProxy(config: MCPServerConfig): Promise<MCPTool[]> {
    // MCP stdio 代理走 skill-executor 服务，不走 KGM
    const executorUrl = resolveSkillExecutorBaseUrl();

    const response = await fetch(`${executorUrl}/v1/mcp/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...resolveSkillExecutorAuthHeaders() },
      body: JSON.stringify({
        serverId: config.id,
        command: config.command,
        args: config.args || [],
        env: config.env || {}
      })
    });

    if (!response.ok) {
      throw new Error(`MCP proxy connect failed: ${response.status}`);
    }

    const data = await response.json();
    return (data.tools || []).map((t: any) => ({ ...t, serverId: config.id }));
  }

  private async callToolViaProxy(
    config: MCPServerConfig,
    toolName: string,
    args: Record<string, any>
  ): Promise<MCPToolResult> {
    const executorUrl = resolveSkillExecutorBaseUrl();
    const id = `call_${Date.now()}`;

    const response = await fetch(`${executorUrl}/v1/mcp/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...resolveSkillExecutorAuthHeaders() },
      body: JSON.stringify({
        serverId: config.id,
        toolName,
        arguments: args
      })
    });

    if (!response.ok) {
      return {
        toolCallId: id,
        content: [{ type: 'text', text: `MCP proxy call failed: ${response.status}` }],
        isError: true
      };
    }

    const data = await response.json();
    return {
      toolCallId: id,
      content: data.content || [{ type: 'text', text: JSON.stringify(data) }],
      isError: data.isError || false
    };
  }

  // ==================== 持久化 ====================

  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem(this.STORAGE_KEY);
      if (stored) {
        const configs: MCPServerConfig[] = JSON.parse(stored);
        configs.forEach(config => {
          this.servers.set(config.id, config);
          this.serverStatus.set(config.id, { id: config.id, connected: false, tools: [] });
        });
      } else {
        this.initializeDefaultServers();
      }
    } catch (e) {
      console.error('Failed to load MCP servers:', e);
      this.initializeDefaultServers();
    }
  }

  private initializeDefaultServers(): void {
    const defaults: MCPServerConfig[] = [
      {
        id: 'filesystem',
        name: '文件系统',
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
        enabled: false,
        description: '本地文件系统访问 (需要 Node.js)'
      },
      {
        id: 'brave-search',
        name: 'Brave 搜索',
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-brave-search'],
        env: { BRAVE_API_KEY: '' },
        enabled: false,
        description: 'Brave 搜索引擎 (需要 API Key)'
      },
      {
        id: 'sqlite',
        name: 'SQLite 数据库',
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-sqlite', '--db-path', '/tmp/yueli.db'],
        enabled: false,
        description: 'SQLite 数据库操作'
      }
    ];
    defaults.forEach(s => {
      this.servers.set(s.id, s);
      this.serverStatus.set(s.id, { id: s.id, connected: false, tools: [] });
    });
    this.saveToStorage();
  }

  private saveToStorage(): void {
    try {
      const configs = Array.from(this.servers.values());
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(configs));
    } catch (e) {
      console.error('Failed to save MCP servers:', e);
    }
  }
}

// 单例
let runtimeInstance: MCPRuntime | null = null;
export function getMCPRuntime(): MCPRuntime {
  if (!runtimeInstance) {
    runtimeInstance = new MCPRuntime();
  }
  return runtimeInstance;
}
