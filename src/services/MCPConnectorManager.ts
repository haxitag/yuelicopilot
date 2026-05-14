import { MCPConnector, MCPConnectorConfig, MCPQuery, MCPResponse } from '../types';
import { DatabaseConnector, FileSystemConnector, HttpApiConnector } from './mcp/RealConnectors';
import { getMCPRuntime } from './mcp/MCPRuntime';

export class MCPConnectorManager {
  private connectors: Map<string, MCPConnector> = new Map();
  private dbConnectors: Map<string, DatabaseConnector> = new Map();
  private fsConnectors: Map<string, FileSystemConnector> = new Map();
  private apiConnectors: Map<string, HttpApiConnector> = new Map();

  constructor() {
    this.initializeDefaultConnectors();
  }

  private initializeDefaultConnectors() {
    const weatherConnector: MCPConnector = {
      id: 'weather-api',
      name: '天气API',
      type: 'api',
      config: {
        baseUrl: 'https://api.openweathermap.org/data/2.5',
        apiKey: '',
      },
      connected: false,
    };
    this.connectors.set('weather-api', weatherConnector);

    const dbConnector: MCPConnector = {
      id: 'local-db',
      name: '本地数据库',
      type: 'database',
      config: {
        type: 'sqlite',
        host: 'localhost',
        port: 5432,
        database: 'yueli',
        user: '',
        password: '',
      },
      connected: false,
    };
    this.connectors.set('local-db', dbConnector);

    const fileConnector: MCPConnector = {
      id: 'file-system',
      name: '文件系统',
      type: 'file',
      config: {
        basePath: '/',
      },
      connected: false,
    };
    this.connectors.set('file-system', fileConnector);
  }

  registerConnector(connector: MCPConnector) {
    this.connectors.set(connector.id, connector);
  }

  getConnector(connectorId: string): MCPConnector | undefined {
    return this.connectors.get(connectorId);
  }

  getAllConnectors(): MCPConnector[] {
    return Array.from(this.connectors.values());
  }

  async connect(connectorId: string, config?: MCPConnectorConfig): Promise<MCPResponse> {
    const connector = this.connectors.get(connectorId);
    if (!connector) {
      return { success: false, error: `连接器 "${connectorId}" 未找到` };
    }

    try {
      if (config) {
        connector.config = { ...connector.config, ...config };
      }

      switch (connector.type) {
        case 'api':
          await this.connectApi(connector);
          break;
        case 'database':
          await this.connectDatabase(connector);
          break;
        case 'file':
          await this.connectFile(connector);
          break;
        case 'web':
          await this.connectWeb(connector);
          break;
        case 'custom':
          await this.connectCustom(connector);
          break;
        default:
          return { success: false, error: `不支持的连接器类型: ${connector.type}` };
      }

      connector.connected = true;
      this.connectors.set(connectorId, connector);

      return {
        success: true,
        metadata: { connectorId, connectedAt: new Date().toISOString() },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '连接失败',
      };
    }
  }

  async disconnect(connectorId: string): Promise<MCPResponse> {
    const connector = this.connectors.get(connectorId);
    if (!connector) {
      return { success: false, error: `连接器 "${connectorId}" 未找到` };
    }

    connector.connected = false;
    this.connectors.set(connectorId, connector);

    // 清理实际连接
    this.dbConnectors.delete(connectorId);
    this.fsConnectors.delete(connectorId);
    this.apiConnectors.delete(connectorId);

    return {
      success: true,
      metadata: { connectorId, disconnectedAt: new Date().toISOString() },
    };
  }

  async execute(query: MCPQuery): Promise<MCPResponse> {
    const connector = this.connectors.get(query.connectorId);
    if (!connector) {
      return { success: false, error: `连接器 "${query.connectorId}" 未找到` };
    }
    if (!connector.connected) {
      return { success: false, error: `连接器 "${query.connectorId}" 未连接` };
    }

    try {
      let result: any;

      switch (connector.type) {
        case 'api':
          result = await this.executeApi(connector, query);
          break;
        case 'database':
          result = await this.executeDatabase(connector, query);
          break;
        case 'file':
          result = await this.executeFile(connector, query);
          break;
        case 'web':
          result = await this.executeWeb(connector, query);
          break;
        case 'custom':
          result = await this.executeCustom(connector, query);
          break;
        default:
          return { success: false, error: `不支持的连接器类型: ${connector.type}` };
      }

      return {
        success: true,
        data: result,
        metadata: {
          connectorId: query.connectorId,
          action: query.action,
          executedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '执行失败',
      };
    }
  }

  // ==================== 真实连接实现 ====================

  private async connectApi(connector: MCPConnector): Promise<void> {
    const { baseUrl, apiKey, headers } = connector.config;
    if (!baseUrl) throw new Error('缺少 baseUrl 配置');

    const apiConnector = new HttpApiConnector({
      baseUrl,
      apiKey,
      headers,
      timeout: connector.config.timeout || 30000
    });

    // 测试连接
    const ok = await apiConnector.testConnection();
    if (!ok) {
      // 不强制失败，API 可能不支持 GET /
      console.warn(`API connector ${connector.id} test connection returned non-ok, proceeding anyway`);
    }
    this.apiConnectors.set(connector.id, apiConnector);
  }

  private async connectDatabase(connector: MCPConnector): Promise<void> {
    const { type = 'sqlite', host, port, database, user, password } = connector.config;

    const dbConnector = new DatabaseConnector({
      type: type as any,
      host: host || 'localhost',
      port: port || 5432,
      database: database || 'yueli',
      user: user || '',
      password: password || ''
    });

    await dbConnector.connect();
    this.dbConnectors.set(connector.id, dbConnector);
  }

  private async connectFile(connector: MCPConnector): Promise<void> {
    const { basePath = '/' } = connector.config;

    const fsConnector = new FileSystemConnector({ basePath });

    // 尝试请求文件系统访问权限
    const hasAccess = await fsConnector.requestDirectoryAccess();
    if (!hasAccess) {
      console.warn('File System Access API not available, will use KGM proxy for file operations');
    }

    this.fsConnectors.set(connector.id, fsConnector);
  }

  private async connectWeb(connector: MCPConnector): Promise<void> {
    const { baseUrl } = connector.config;
    if (!baseUrl) throw new Error('缺少 baseUrl 配置');

    const apiConnector = new HttpApiConnector({ baseUrl });
    const ok = await apiConnector.testConnection();
    if (!ok) throw new Error(`无法连接到 ${baseUrl}`);
    this.apiConnectors.set(connector.id, apiConnector);
  }

  private async connectCustom(connector: MCPConnector): Promise<void> {
    // 自定义连接器通过 MCP Runtime 处理
    const runtime = getMCPRuntime();
    const server = runtime.getServer(connector.id);
    if (server) {
      await runtime.connectServer(connector.id);
    }
  }

  // ==================== 真实执行实现 ====================

  private async executeApi(connector: MCPConnector, query: MCPQuery): Promise<any> {
    let apiConnector = this.apiConnectors.get(connector.id);
    if (!apiConnector) {
      apiConnector = new HttpApiConnector({
        baseUrl: connector.config.baseUrl,
        apiKey: connector.config.apiKey,
        headers: connector.config.headers,
        timeout: connector.config.timeout
      });
      this.apiConnectors.set(connector.id, apiConnector);
    }

    const { action, params } = query;
    const method = (params.method || 'GET').toUpperCase();

    let result: any;
    switch (method) {
      case 'GET':
        result = await apiConnector.get(`/${action}`, params.query);
        break;
      case 'POST':
        result = await apiConnector.post(`/${action}`, params.body);
        break;
      case 'PUT':
        result = await apiConnector.put(`/${action}`, params.body);
        break;
      case 'DELETE':
        result = await apiConnector.delete(`/${action}`);
        break;
      default:
        result = await apiConnector.get(`/${action}`, params.query);
    }

    if (!result.success) throw new Error(result.error);
    return result.data;
  }

  private async executeDatabase(connector: MCPConnector, query: MCPQuery): Promise<any> {
    let dbConnector = this.dbConnectors.get(connector.id);
    if (!dbConnector) {
      dbConnector = new DatabaseConnector({
        type: connector.config.type || 'sqlite',
        host: connector.config.host || 'localhost',
        port: connector.config.port || 5432,
        database: connector.config.database || 'yueli',
        user: connector.config.user || '',
        password: connector.config.password || ''
      });
      await dbConnector.connect();
      this.dbConnectors.set(connector.id, dbConnector);
    }

    const { action, params } = query;

    if (action === 'query' || action === 'select') {
      const result = await dbConnector.query(params.sql, params.params);
      if (!result.success) throw new Error(result.error);
      return result.data;
    } else if (action === 'execute' || action === 'insert' || action === 'update' || action === 'delete') {
      const result = await dbConnector.execute(params.sql, params.params);
      if (!result.success) throw new Error(result.error);
      return result.data;
    }

    throw new Error(`不支持的数据库操作: ${action}`);
  }

  private async executeFile(connector: MCPConnector, query: MCPQuery): Promise<any> {
    let fsConnector = this.fsConnectors.get(connector.id);
    if (!fsConnector) {
      fsConnector = new FileSystemConnector({ basePath: connector.config.basePath || '/' });
      this.fsConnectors.set(connector.id, fsConnector);
    }

    const { action, params } = query;

    switch (action) {
      case 'read':
        const readResult = await fsConnector.readFile(params.path);
        if (!readResult.success) throw new Error(readResult.error);
        return readResult.data;

      case 'write':
        const writeResult = await fsConnector.writeFile(params.path, params.content);
        if (!writeResult.success) throw new Error(writeResult.error);
        return writeResult.data;

      case 'list':
        const listResult = await fsConnector.listDirectory(params.path || '/');
        if (!listResult.success) throw new Error(listResult.error);
        return listResult.data;

      case 'delete':
        const deleteResult = await fsConnector.deleteFile(params.path);
        if (!deleteResult.success) throw new Error(deleteResult.error);
        return deleteResult.data;

      default:
        throw new Error(`不支持的文件操作: ${action}`);
    }
  }

  private async executeWeb(connector: MCPConnector, query: MCPQuery): Promise<any> {
    return this.executeApi(connector, query);
  }

  private async executeCustom(connector: MCPConnector, query: MCPQuery): Promise<any> {
    // 通过 MCP Runtime 执行
    const runtime = getMCPRuntime();
    const result = await runtime.callTool(connector.id, query.action, query.params);
    if (result.isError) {
      throw new Error(result.content[0]?.text || 'MCP tool call failed');
    }
    return result.content.map(c => c.text || c.data).join('\n');
  }

  extractConnectorFromInput(input: string): MCPQuery | null {
    const patterns = [
      /查询天气[：:]\s*(\S+)/,
      /获取数据[：:]\s*(\S+)/,
      /读取文件[：:]\s*(\S+)/,
      /\[connector:(\w+)\]/,
      /action:(\w+)/,
    ];

    for (const pattern of patterns) {
      const match = input.match(pattern);
      if (match) {
        if (input.includes('天气')) {
          return {
            connectorId: 'weather-api',
            action: 'weather',
            params: { city: match[1] || 'Beijing' },
          };
        }
        if (input.includes('文件')) {
          return {
            connectorId: 'file-system',
            action: 'read',
            params: { path: match[1] },
          };
        }
      }
    }

    return null;
  }

  /**
   * 获取所有连接器的 MCP tools（用于 LLM function calling）
   */
  getToolDefinitions(): Array<{
    type: 'function';
    function: { name: string; description: string; parameters: any };
  }> {
    const tools: any[] = [];

    for (const connector of this.connectors.values()) {
      if (!connector.connected) continue;

      switch (connector.type) {
        case 'database':
          tools.push({
            type: 'function',
            function: {
              name: `connector__${connector.id}__query`,
              description: `在 ${connector.name} 数据库中执行 SQL 查询`,
              parameters: {
                type: 'object',
                properties: {
                  sql: { type: 'string', description: 'SQL 查询语句' },
                  params: { type: 'array', items: { type: 'string' }, description: '查询参数' }
                },
                required: ['sql']
              }
            }
          });
          break;

        case 'file':
          tools.push(
            {
              type: 'function',
              function: {
                name: `connector__${connector.id}__read`,
                description: `从 ${connector.name} 读取文件内容`,
                parameters: {
                  type: 'object',
                  properties: { path: { type: 'string', description: '文件路径' } },
                  required: ['path']
                }
              }
            },
            {
              type: 'function',
              function: {
                name: `connector__${connector.id}__write`,
                description: `向 ${connector.name} 写入文件`,
                parameters: {
                  type: 'object',
                  properties: {
                    path: { type: 'string', description: '文件路径' },
                    content: { type: 'string', description: '文件内容' }
                  },
                  required: ['path', 'content']
                }
              }
            },
            {
              type: 'function',
              function: {
                name: `connector__${connector.id}__list`,
                description: `列出 ${connector.name} 目录内容`,
                parameters: {
                  type: 'object',
                  properties: { path: { type: 'string', description: '目录路径', default: '/' } }
                }
              }
            }
          );
          break;

        case 'api':
        case 'web':
          tools.push({
            type: 'function',
            function: {
              name: `connector__${connector.id}__request`,
              description: `通过 ${connector.name} 发送 HTTP 请求`,
              parameters: {
                type: 'object',
                properties: {
                  action: { type: 'string', description: 'API 路径/端点' },
                  method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE'], default: 'GET' },
                  body: { type: 'object', description: '请求体 (POST/PUT)' },
                  query: { type: 'object', description: '查询参数 (GET)' }
                },
                required: ['action']
              }
            }
          });
          break;
      }
    }

    return tools;
  }

  /**
   * 执行来自 LLM tool call 的连接器操作
   */
  async executeToolCall(toolName: string, args: Record<string, any>): Promise<string> {
    // 格式: connector__connectorId__action
    const match = toolName.match(/^connector__([^_]+(?:_[^_]+)*)__(.+)$/);
    if (!match) throw new Error(`Invalid connector tool name: ${toolName}`);

    const connectorId = match[1];
    const action = match[2];

    const result = await this.execute({
      connectorId,
      action,
      params: args
    });

    if (!result.success) throw new Error(result.error);
    return typeof result.data === 'string' ? result.data : JSON.stringify(result.data, null, 2);
  }
}
