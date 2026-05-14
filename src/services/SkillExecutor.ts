import {
  Skill,
  SkillConfig,
  SkillExecutionContext,
  SkillPermission,
  PermissionCheckResult,
  SkillCategory,
  AuditType
} from '../types';
import { getMCPRuntime } from './mcp/MCPRuntime';
import { MCPConnectorManager } from './MCPConnectorManager';
import { SandboxManager } from './core/SandboxManager';
import { PermissionManager } from './core/PermissionManager';
import { EventManager, AuditSystem } from './core/EventManager';
import { promptRegistry } from './PromptRegistry';
import { PermissionRequiredError } from './core/PermissionRequiredError';
import { recordRecentSkillId } from './chat/ToolSelection';
import {
  migrateLegacyManifest,
  normalizeSkillManifest,
  type SkillManifest
} from './core/SkillManifestSchema';
import { SkillStorage } from './core/SkillStorage';
import { LocalSkillScanner } from './core/LocalSkillScanner';
import {
  normalizeSkillExecutorBaseUrl,
  resolveSkillExecutorAuthHeaders,
  resolveSkillExecutorBaseUrl
} from '../utils/skillExecutorUrl';

export interface SkillToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, any>;
      required?: string[];
    };
  };
}

export interface SkillExecutionResult {
  success: boolean;
  result?: string;
  toolCalls?: Array<{ name: string; args: any; result: string }>;
  error?: string;
  sandboxMetrics?: any;
  permissions?: PermissionCheckResult[];
}

export class SkillExecutor {
  private skills: Map<string, Skill> = new Map();
  private skillConfigs: Map<string, SkillConfig> = new Map();
  private connectorManager: MCPConnectorManager | null = null;
  private sandboxManager: SandboxManager;
  private permissionManager: PermissionManager;
  private eventManager: EventManager;
  private auditSystem: AuditSystem;
  private readonly STORAGE_KEY = 'yueli_skills';
  private skillManifests: Map<string, SkillManifest> = new Map();

  private initialized = false;
  
  constructor() {
    this.eventManager = new EventManager();
    this.auditSystem = new AuditSystem(this.eventManager);
    // 使用单例模式获取沙箱管理器
    this.sandboxManager = SandboxManager.getInstance(this.auditSystem, this.eventManager);
    this.permissionManager = new PermissionManager(this.auditSystem, this.eventManager);
    this.initializeDefaultSkills();
    this.loadSkillsFromStorage(); // fire and forget, async
  }

  async initialize() {
    if (!this.initialized) {
      await this.loadSkillsFromStorage();
      await this.hydrateSkillsFromLocalScan();
      this.listenPromptRegistryUpdates();
      this.initialized = true;
    }
  }

  private listenPromptRegistryUpdates(): void {
    promptRegistry.on('prompt:updated', (event: { id: string }) => {
      if (event.id.startsWith('skill-')) {
        console.log(`[SkillExecutor] Skill prompt '${event.id}' updated from PromptRegistry, will take effect on next use`);
      }
    });
  }

  /**
   * 将 LocalSkillScanner 发现的技能注册进 SkillExecutor，并推送 manifest 到 skill-executor 注册表，
   * 使 /v1/skill/execute 能对任意已扫描技能走通用分支（tool_ready / prompt_enhanced）。
   */
  private async hydrateSkillsFromLocalScan(): Promise<void> {
    try {
      const scanner = new LocalSkillScanner();
      const dirs = scanner.getKnownDirectories();
      const seenPath = new Set<string>();
      const packages: Array<{ id: string; manifest: SkillManifest; path?: string }> = [];

      let scanned = 0;
      const maxDirs = 28;

      for (const dir of dirs) {
        if (seenPath.has(dir.path)) continue;
        seenPath.add(dir.path);
        if (scanned >= maxDirs) break;

        const source = await scanner.scanDirectory(dir.path, dir.platform);
        scanned++;

        for (const sk of source.skills) {
          const manifest = SkillExecutor.scanRowToManifest(sk);
          if (!manifest?.id) continue;
          this.registerSkillFromManifest(manifest.id, manifest);
          packages.push({
            id: manifest.id,
            manifest,
            path: typeof sk.path === 'string' ? sk.path : undefined
          });
        }
      }

      await SkillExecutor.syncSkillRegistryRemote(packages);
    } catch (e) {
      console.warn('[SkillExecutor] hydrateSkillsFromLocalScan:', e);
    }
  }

  private static scanRowToManifest(sk: {
    id?: string;
    name?: string;
    path?: string;
    manifest?: Record<string, unknown>;
  }): SkillManifest | null {
    const m = sk.manifest || {};
    const id = (typeof m.id === 'string' && m.id) || (typeof sk.id === 'string' && sk.id);
    if (!id) return null;

    const toolsRaw = m.tools;
    const tools: SkillManifest['tools'] = Array.isArray(toolsRaw)
      ? toolsRaw.map((t: unknown) => {
          if (typeof t === 'string') {
            return {
              name: t,
              description: t,
              parameters: { type: 'object' as const, properties: {} }
            };
          }
          const o = t as { name?: string; description?: string; parameters?: any };
          const name = o.name || 'tool';
          return {
            name,
            description: o.description || name,
            parameters: o.parameters || { type: 'object', properties: {} }
          };
        })
      : [];

    const permissionsRaw = m.permissions;
    const permissions = Array.isArray(permissionsRaw)
      ? (permissionsRaw as SkillManifest['permissions'])
      : [];

    const raw: Record<string, unknown> = {
      id,
      name: (typeof m.name === 'string' && m.name) || sk.name || id,
      version: (typeof m.version === 'string' && m.version) || '1.0.0',
      author: (typeof m.author === 'string' && m.author) || 'Unknown',
      description: (typeof m.description === 'string' && m.description) || '',
      category: typeof m.category === 'string' ? m.category : undefined,
      tags: Array.isArray(m.tags) ? (m.tags as string[]) : [],
      permissions,
      dependencies:
        m.dependencies !== undefined && m.dependencies !== null ? m.dependencies : [],
      tools,
      systemPrompt:
        (typeof m.systemPrompt === 'string' && m.systemPrompt) ||
        (typeof m.prompt === 'string' && m.prompt) ||
        (typeof m.instructions === 'string' && m.instructions) ||
        '',
      entry: typeof m.entry === 'string' && m.entry.trim() ? m.entry.trim() : undefined
    };

    if (m.runtime && typeof m.runtime === 'object') raw.runtime = m.runtime;
    if (m.capabilities && typeof m.capabilities === 'object') raw.capabilities = m.capabilities;
    if (m.context_injection && typeof m.context_injection === 'object') {
      raw.context_injection = m.context_injection;
    }

    const normalized = normalizeSkillManifest(raw);
    if (normalized.ok) return normalized.manifest;

    const retry = normalizeSkillManifest(migrateLegacyManifest(raw));
    if (retry.ok) return retry.manifest;

    console.warn('[SkillExecutor] scanRowToManifest failed:', id, !normalized.ok ? normalized.errors : []);
    return null;
  }

  /** 将 manifest 快照同步到 skill-executor（扫描或安装后调用） */
  static async syncSkillRegistryRemote(
    packages: Array<{ id: string; manifest: SkillManifest; path?: string }>
  ): Promise<void> {
    if (packages.length === 0 || typeof fetch === 'undefined') return;

    const executorUrl = normalizeSkillExecutorBaseUrl(resolveSkillExecutorBaseUrl());

    try {
      const body = {
        packages: packages.map((p) => ({
          id: p.id,
          manifest: p.manifest,
          path: p.path
        }))
      };

      await fetch(`${executorUrl}/v1/skills/registry/client-push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...resolveSkillExecutorAuthHeaders() },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(12000)
      });
    } catch {
      /* 服务端未启动时不阻断前端注册 */
    }
  }

  setConnectorManager(manager: MCPConnectorManager) {
    this.connectorManager = manager;
  }

  private async loadSkillsFromStorage() {
    try {
      // 从 localStorage 加载旧技能
      const storedSkills = localStorage.getItem(this.STORAGE_KEY);
      if (storedSkills) {
        const skills = JSON.parse(storedSkills);
        skills.forEach((skill: Skill) => {
          this.skills.set(skill.id, skill);
        });
      }
      
      // 从 SkillStorage (IndexedDB) 加载已安装的技能
      const skillStorage = new SkillStorage();
      const installedSkills = await skillStorage.getAll();
      
      installedSkills.forEach(skillData => {
        if (skillData.manifest) {
          this.registerSkillFromManifest(skillData.manifest.id, skillData.manifest);
        }
      });
    } catch (error) {
      console.error('从本地存储加载技能失败:', error);
    }
  }

  private saveSkillsToStorage() {
    try {
      const skills = Array.from(this.skills.values());
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(skills));
    } catch (error) {
      console.error('保存技能到本地存储失败:', error);
    }
  }

  private initializeDefaultSkills() {
    // AI写作优化技能 - 从PromptRegistry获取systemPrompt
    const writingSkillConfig: SkillConfig = {
      name: 'AI写作优化',
      description: '移除AI写作中的模式化表达，使文本更自然',
      systemPromptRef: 'skill-writing-optimization',
      systemPrompt: '',
      tools: []
    };
    this.skillConfigs.set('stop-slop', writingSkillConfig);

    // 注册写作技能
    this.registerSkill({
      id: 'stop-slop',
      name: 'AI写作优化',
      description: '移除AI写作中的模式化表达，使文本更自然',
      version: '1.0.0',
      author: 'System',
      installed: true,
      category: 'writing',
      tags: ['写作', '优化', 'prompt'],
      structure: {
        skimmable: true,
        files: []
      },
      permissions: [],
      source: 'local'
    });

    // PPT生成器技能 - 带工具调用
    const pptSkillConfig: SkillConfig = {
      name: 'PPT生成器',
      description: '将一句话需求转换为专业级PPTX文件',
      systemPromptRef: 'skill-ppt-generator',
      systemPrompt: '',
      tools: [
        {
          name: 'generate_ppt',
          description: '生成专业的 PPTX 文件并返回下载链接',
          parameters: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'PPT 主标题' },
              subtitle: { type: 'string', description: '副标题（可选）' },
              author: { type: 'string', description: '作者（可选）' },
              slides: {
                type: 'array',
                description: '幻灯片列表',
                items: {
                  type: 'object',
                  properties: {
                    type: { 
                      type: 'string', 
                      enum: ['title', 'toc', 'content', 'summary'],
                      description: '幻灯片类型：title=封面, toc=目录, content=内容, summary=总结'
                    },
                    title: { type: 'string', description: '幻灯片标题' },
                    subtitle: { type: 'string', description: '副标题（用于封面页）' },
                    items: { 
                      type: 'array', 
                      items: { type: 'string' },
                      description: '目录页的章节列表'
                    },
                    content: { 
                      type: 'array', 
                      items: { type: 'string' },
                      description: '内容页的要点列表' 
                    },
                    points: {
                      type: 'array',
                      items: { type: 'string' },
                      description: '总结页的要点'
                    },
                    chart: {
                      type: 'object',
                      description: '图表数据（可选）',
                      properties: {
                        type: { type: 'string', enum: ['bar', 'line', 'pie'] },
                        data: { type: 'array' }
                      }
                    },
                    image: { type: 'string', description: '图片URL（可选）' }
                  },
                  required: ['type']
                }
              },
              theme: { 
                type: 'string', 
                enum: ['default', 'dark', 'minimal', 'corporate'], 
                default: 'default',
                description: '配色主题'
              }
            },
            required: ['title', 'slides']
          },
          handler: async (params: any) => {
            return await SkillExecutor.callSkillTool('generate_ppt', params);
          }
        },
        {
          name: 'web_search',
          description: '联网搜索相关信息和图片资源',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: '搜索关键词' },
              allowed_domains: { type: 'array', items: { type: 'string' }, description: '限定搜索结果的域名' },
              blocked_domains: { type: 'array', items: { type: 'string' }, description: '排除搜索结果的域名' }
            },
            required: ['query']
          },
          handler: async (params: any) => {
            return await SkillExecutor.callSkillTool('web_search', params);
          }
        },
        {
          name: 'web_fetch',
          description: '获取网页内容，用于提取详细信息或图片URL',
          parameters: {
            type: 'object',
            properties: {
              url: { type: 'string', description: '网页URL' },
              prompt: { type: 'string', description: '处理内容的提示' },
              max_length: { type: 'number', description: '最大内容长度', default: 50000 }
            },
            required: ['url']
          },
          handler: async (params: any) => {
            return await SkillExecutor.callSkillTool('web_fetch', params);
          }
        }
      ]
    };
    this.skillConfigs.set('ppt-agent-skills', pptSkillConfig);

    // 注册PPT技能
    this.registerSkill({
      id: 'ppt-agent-skills',
      name: 'PPT生成器',
      description: '将一句话需求转换为专业级PPTX文件',
      version: '1.0.0',
      author: 'System',
      installed: true,
      category: 'productivity',
      tags: ['PPT', '文档', '工具'],
      structure: {
        skimmable: true,
        files: []
      },
      permissions: ['network.http'],
      source: 'local'
    });

    // Markdown 长文生成器技能 - 从PromptRegistry获取systemPrompt
    const markdownSkillConfig: SkillConfig = {
      name: 'Markdown长文生成器',
      description: '专业的Markdown长文生成器，支持递归规划、内容填充、质量评估与迭代改进',
      systemPromptRef: 'skill-markdown-writer',
      systemPrompt: '',
      tools: [
        {
          name: 'planning_document',
          description: '规划文章的整体结构和大纲',
          parameters: {
            type: 'object',
            properties: {
              topic: { type: 'string', description: '文章主题' },
              audience: { type: 'string', description: '目标读者群体' },
              length: { type: 'integer', description: '预估总字数', default: 3000 },
              tone: { 
                type: 'string', 
                enum: ['professional', 'casual', 'academic', 'practical'],
                default: 'professional',
                description: '文章风格'
              }
            },
            required: ['topic', 'audience']
          },
          handler: async (params: any) => {
            return await SkillExecutor.callSkillTool('planning_document', params);
          }
        },
        {
          name: 'write_section',
          description: '撰写具体章节内容',
          parameters: {
            type: 'object',
            properties: {
              section_id: { type: 'string', description: '章节唯一标识符' },
              title: { type: 'string', description: '章节标题' },
              key_points: { 
                type: 'array', 
                items: { type: 'string' },
                description: '章节核心要点'
              },
              context: { 
                type: 'string', 
                description: '前序章节的上下文信息，帮助保持连贯性'
              },
              word_target: { type: 'integer', description: '目标字数' }
            },
            required: ['section_id', 'title', 'key_points']
          },
          handler: async (params: any) => {
            return await SkillExecutor.callSkillTool('write_section', params);
          }
        },
        {
          name: 'evaluate_content',
          description: '评估已生成内容的质量',
          parameters: {
            type: 'object',
            properties: {
              document: { type: 'string', description: '完整文档内容' },
              sections: {
                type: 'array',
                description: '各章节列表',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    title: { type: 'string' }
                  }
                }
              }
            },
            required: ['document', 'sections']
          },
          handler: async (params: any) => {
            return await SkillExecutor.callSkillTool('evaluate_content', params);
          }
        },
        {
          name: 'revise_section',
          description: '修改和改进问题章节',
          parameters: {
            type: 'object',
            properties: {
              section_id: { type: 'string', description: '章节ID' },
              original_content: { type: 'string', description: '原始内容' },
              feedback: { type: 'string', description: '评估反馈和改进建议' },
              revision_level: {
                type: 'string',
                enum: ['minor', 'moderate', 'major'],
                default: 'moderate',
                description: '修订级别'
              }
            },
            required: ['section_id', 'original_content', 'feedback']
          },
          handler: async (params: any) => {
            return await SkillExecutor.callSkillTool('revise_section', params);
          }
        },
        {
          name: 'export_document',
          description: '导出最终文档，添加格式和元数据',
          parameters: {
            type: 'object',
            properties: {
              title: { type: 'string', description: '文章标题' },
              content: { type: 'string', description: '完整内容' },
              author: { type: 'string', description: '作者信息', default: 'Yueli Copilot' },
              metadata: {
                type: 'object',
                description: '元数据'
              }
            },
            required: ['title', 'content']
          },
          handler: async (params: any) => {
            return await SkillExecutor.callSkillTool('export_document', params);
          }
        }
      ]
    };
    this.skillConfigs.set('markdown-writer', markdownSkillConfig);

    // 注册 Markdown 技能
    this.registerSkill({
      id: 'markdown-writer',
      name: 'Markdown长文生成器',
      description: '专业的Markdown长文生成器，支持递归规划、内容填充、质量评估与迭代改进',
      version: '1.0.0',
      author: 'System',
      installed: true,
      category: 'writing',
      tags: ['Markdown', '写作', '长文', '文档'],
      structure: {
        skimmable: true,
        files: []
      },
      permissions: ['network.http'],
      source: 'local'
    });

    // 代码生成技能 - 从PromptRegistry获取systemPrompt
    const codeGenConfig: SkillConfig = {
      name: '代码生成',
      description: '生成并验证各种编程语言的代码',
      systemPromptRef: 'skill-code-generator',
      systemPrompt: '',
      tools: [
        {
          name: 'execute_code',
          description: '在沙盒环境中执行代码并返回结果',
          parameters: {
            type: 'object',
            properties: {
              language: { type: 'string', enum: ['python', 'javascript', 'typescript', 'bash', 'sql'] },
              code: { type: 'string', description: '要执行的代码' },
              timeout: { type: 'number', description: '超时时间(秒)', default: 30 }
            },
            required: ['language', 'code']
          },
          handler: async (params: any) => {
            return await SkillExecutor.callSkillTool('execute_code', params);
          }
        },
        {
          name: 'search_docs',
          description: '搜索编程文档和示例',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: '搜索关键词' },
              language: { type: 'string', description: '编程语言' }
            },
            required: ['query']
          },
          handler: async (params: any) => {
            return await SkillExecutor.callSkillTool('search_docs', params);
          }
        },
        {
          name: 'web_search',
          description: '联网搜索最新信息',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: '搜索关键词' },
              allowed_domains: { type: 'array', items: { type: 'string' }, description: '限定搜索结果的域名' },
              blocked_domains: { type: 'array', items: { type: 'string' }, description: '排除搜索结果的域名' }
            },
            required: ['query']
          },
          handler: async (params: any) => {
            return await SkillExecutor.callSkillTool('web_search', params);
          }
        },
        {
          name: 'web_fetch',
          description: '获取网页内容',
          parameters: {
            type: 'object',
            properties: {
              url: { type: 'string', description: '网页URL' },
              prompt: { type: 'string', description: '处理内容的提示' },
              max_length: { type: 'number', description: '最大内容长度', default: 50000 }
            },
            required: ['url']
          },
          handler: async (params: any) => {
            return await SkillExecutor.callSkillTool('web_fetch', params);
          }
        }
      ]
    };
    this.skillConfigs.set('code-generator', codeGenConfig);

    // 注册代码技能
    this.registerSkill({
      id: 'code-generator',
      name: '代码生成',
      description: '生成并验证各种编程语言的代码',
      version: '1.0.0',
      author: 'System',
      installed: true,
      category: 'coding',
      tags: ['代码', '编程', '工具'],
      structure: {
        skimmable: true,
        files: []
      },
      permissions: ['network.http', 'process.execute'],
      source: 'local'
    });

    // 数据分析技能 - 从PromptRegistry获取systemPrompt
    const dataAnalysisConfig: SkillConfig = {
      name: '数据分析',
      description: '分析数据并生成图表和洞察',
      systemPromptRef: 'skill-data-analysis',
      systemPrompt: '',
      tools: [
        {
          name: 'analyze_data',
          description: '分析数据集，返回统计信息和洞察',
          parameters: {
            type: 'object',
            properties: {
              data: { type: 'string', description: 'CSV 或 JSON 格式的数据' },
              analysis_type: {
                type: 'string',
                enum: ['descriptive', 'correlation', 'trend', 'anomaly'],
                description: '分析类型'
              }
            },
            required: ['data']
          },
          handler: async (params: any) => {
            return await SkillExecutor.callSkillTool('analyze_data', params);
          }
        },
        {
          name: 'create_chart',
          description: '创建数据可视化图表',
          parameters: {
            type: 'object',
            properties: {
              chart_type: { type: 'string', enum: ['bar', 'line', 'pie', 'scatter', 'heatmap'] },
              data: { type: 'object', description: '图表数据' },
              title: { type: 'string', description: '图表标题' }
            },
            required: ['chart_type', 'data']
          },
          handler: async (params: any) => {
            return await SkillExecutor.callSkillTool('create_chart', params);
          }
        }
      ]
    };
    this.skillConfigs.set('data-analyzer', dataAnalysisConfig);

    // 注册数据分析技能
    this.registerSkill({
      id: 'data-analyzer',
      name: '数据分析',
      description: '分析数据并生成图表和洞察',
      version: '1.0.0',
      author: 'System',
      installed: true,
      category: 'analysis',
      tags: ['数据', '分析', '图表'],
      structure: {
        skimmable: true,
        files: []
      },
      permissions: ['network.http'],
      source: 'local'
    });

    // 翻译技能 - 从PromptRegistry获取systemPrompt
    const translatorConfig: SkillConfig = {
      name: '翻译',
      description: '高质量多语言翻译',
      systemPromptRef: 'skill-translator',
      systemPrompt: '',
      tools: [
        {
          name: 'lookup_term',
          description: '查询专业术语的标准翻译',
          parameters: {
            type: 'object',
            properties: {
              term: { type: 'string', description: '要查询的术语' },
              source_lang: { type: 'string', description: '源语言代码，如 zh, en, ja' },
              target_lang: { type: 'string', description: '目标语言代码' }
            },
            required: ['term', 'target_lang']
          },
          handler: async (params: any) => {
            return await SkillExecutor.callSkillTool('lookup_term', params);
          }
        }
      ]
    };
    this.skillConfigs.set('translator', translatorConfig);

    // 注册翻译技能
    this.registerSkill({
      id: 'translator',
      name: '翻译',
      description: '高质量多语言翻译',
      version: '1.0.0',
      author: 'System',
      installed: true,
      category: 'productivity',
      tags: ['翻译', '语言', '工具'],
      structure: {
        skimmable: true,
        files: []
      },
      permissions: ['network.http'],
      source: 'local'
    });

    // 文本摘要技能 - 从PromptRegistry获取systemPrompt
    const summarizerConfig: SkillConfig = {
      name: '文本摘要',
      description: '智能提取文本核心内容',
      systemPromptRef: 'skill-summarizer',
      systemPrompt: '',
      tools: [
        {
          name: 'fetch_url',
          description: '获取网页内容',
          parameters: {
            type: 'object',
            properties: {
              url: { type: 'string', description: '要获取的网页 URL' }
            },
            required: ['url']
          },
          handler: async (params: any) => {
            // 通过 skill-executor 代理获取，避免 CORS 问题
            return await SkillExecutor.callSkillTool('web_fetch', { url: params.url, max_length: 5000 });
          }
        }
      ]
    };
    this.skillConfigs.set('text-summarizer', summarizerConfig);

    // 注册文本摘要技能
    this.registerSkill({
      id: 'text-summarizer',
      name: '文本摘要',
      description: '智能提取文本核心内容',
      version: '1.0.0',
      author: 'System',
      installed: true,
      category: 'writing',
      tags: ['摘要', '文本', '工具'],
      structure: {
        skimmable: true,
        files: []
      },
      permissions: ['network.http'],
      source: 'local'
    });

    // 上下文召回约束技能 - 从PromptRegistry获取systemPrompt
    const contextRecallConfig: SkillConfig = {
      name: '上下文召回约束',
      description: '确保AI严格基于项目主题上下文和知识库回答，不要编造信息',
      systemPromptRef: 'skill-context-recall',
      systemPrompt: '',
      tools: []
    };
    this.skillConfigs.set('context-recall-constraint', contextRecallConfig);

    // 注册上下文召回约束技能
    this.registerSkill({
      id: 'context-recall-constraint',
      name: '上下文召回约束',
      description: '确保AI严格基于项目主题上下文和知识库回答，不要编造信息',
      version: '1.0.0',
      author: 'System',
      installed: true,
      category: 'system',
      tags: ['上下文', '约束', '准确性', '系统'],
      structure: {
        skimmable: true,
        files: []
      },
      permissions: [],
      source: 'local'
    });
  }

  /**
   * 调用 Skill Executor 后端工具（本地服务，非 KGM）
   * 优先走本地 skill-executor（端口见 SKILL_EXECUTOR_PORT / VITE_SKILL_*，默认 3010），KGM 仅用于推理
   */
  /**
   * 执行技能包 manifest.entry（服务端白名单脚本；需 registry 中 skillDir）
   */
  static async invokeSkillEntryOnServer(skillId: string, args: string[] = []): Promise<any> {
    const executorUrl = normalizeSkillExecutorBaseUrl(resolveSkillExecutorBaseUrl());

    try {
      const response = await fetch(`${executorUrl}/v1/skills/execute-entry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...resolveSkillExecutorAuthHeaders() },
        body: JSON.stringify({
          skill_id: skillId,
          args,
          timeout_sec: 45
        }),
        signal: AbortSignal.timeout(120000)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        return {
          status: 'error',
          message: data.error || `execute-entry HTTP ${response.status}`,
          skillId
        };
      }
      return data;
    } catch (e) {
      return {
        status: 'error',
        message: e instanceof Error ? e.message : String(e),
        skillId
      };
    }
  }

  /**
   * 执行技能 runtime.entrypoint（服务端 pre-LLM 入口；由服务端环境变量控制是否允许）
   * 说明：服务端 `/v1/skill/execute` 会在允许时自动执行 runtime.entrypoint，并返回 stdout/stderr/elapsed_ms 等。
   */
  static async invokeSkillRuntimeOnServer(skillId: string, context: SkillExecutionContext): Promise<any> {
    const executorUrl = resolveSkillExecutorBaseUrl();
    if (!executorUrl) {
      return { success: false, error: 'Skill Executor URL 未配置' };
    }

    try {
      const response = await fetch(`${executorUrl}/v1/skill/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...resolveSkillExecutorAuthHeaders() },
        body: JSON.stringify({
          skill_id: skillId,
          context: {
            userInput: context.userInput,
            history: context.history.slice(-5).map((m) => ({ role: m.role, content: m.content })),
            variables: context.variables
          }
        }),
        signal: AbortSignal.timeout(120000)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        return { success: false, error: data.error || `skill/execute HTTP ${response.status}` };
      }
      return data;
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e.message : String(e)
      };
    }
  }

  // P2-2: 重试机制配置
  private static readonly RETRY_CONFIG = {
    maxAttempts: 3,
    baseDelayMs: 500,
    maxDelayMs: 3000
  };

  /**
   * P2-2: 通用重试请求方法
   */
  private static async fetchWithRetry<T>(
    url: string,
    options: RequestInit,
    attempt: number = 1
  ): Promise<Response> {
    const { maxAttempts, baseDelayMs, maxDelayMs } = this.RETRY_CONFIG;
    
    try {
      const response = await fetch(url, options);
      return response;
    } catch (error) {
      if (attempt >= maxAttempts) {
        throw error;
      }
      // 指数退避 + 抖动
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
      const jitter = delay * 0.2 * Math.random();
      console.warn(`[SkillExecutor] 请求失败 (尝试 ${attempt}/${maxAttempts})，${delay + jitter}ms 后重试...`);
      await new Promise(resolve => setTimeout(resolve, delay + jitter));
      return this.fetchWithRetry(url, options, attempt + 1);
    }
  }

  static async callSkillTool(toolName: string, params: any): Promise<any> {
    const executorUrl = resolveSkillExecutorBaseUrl();
    
    // P1-2: 空 URL 检查
    if (!executorUrl) {
      return {
        status: 'unavailable',
        message: 'Skill Executor URL 未配置',
        params,
        error: 'executorUrl is empty'
      };
    }

    try {
      // P2-2: 使用重试机制
      const response = await this.fetchWithRetry(
        `${executorUrl}/v1/tools/${toolName}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params)
        }
      );

      if (!response.ok) {
        const text = await response.text();
        return {
          status: 'error',
          message: `工具 ${toolName} 调用失败: ${response.status} ${text}`,
          params
        };
      }

      return await response.json();
    } catch (e) {
      return {
        status: 'unavailable',
        message: `Skill Executor 服务不可用 (${executorUrl})，请运行 server/index.js`,
        params,
        error: String(e)
      };
    }
  }

  /**
   * P2-2: 通过 Skill Executor 执行完整技能（服务端执行，非本地 prompt 拼接）
   */
  static async executeSkillOnServer(skillId: string, context: SkillExecutionContext): Promise<any> {
    const executorUrl = resolveSkillExecutorBaseUrl();
    
    // P1-2: 空 URL 检查
    if (!executorUrl) {
      return { success: false, error: 'Skill Executor URL 未配置' };
    }

    try {
      // 先检查服务是否可用（带重试）
      const healthCheck = await this.fetchWithRetry(
        `${executorUrl}/health`,
        { method: 'GET' }
      );
      if (!healthCheck.ok) {
        console.warn(`[SkillExecutor] Skill Executor 服务不可用: ${executorUrl}/health 返回 ${healthCheck.status}`);
        return { success: false, error: `Skill Executor 服务不可用 (${healthCheck.status})` };
      }

      // P2-2: 使用重试机制执行技能
      const response = await this.fetchWithRetry(
        `${executorUrl}/v1/skill/execute`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            skill_id: skillId,
            context: {
              userInput: context.userInput,
              history: context.history.slice(-5).map(m => ({ role: m.role, content: m.content })),
              variables: context.variables
            }
          })
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.warn(`[SkillExecutor] Skill 执行失败: ${response.status} - ${errorText}`);
        return { success: false, error: `Skill 执行失败: ${response.status} - ${errorText}` };
      }

      return await response.json();
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      console.warn(`[SkillExecutor] 无法连接到 Skill Executor (${executorUrl}): ${errorMsg}`);
      return { success: false, error: `无法连接到 Skill Executor: ${errorMsg}` };
    }
  }

  registerSkill(skill: Skill) {
    this.skills.set(skill.id, skill);
    this.saveSkillsToStorage();
  }

  registerSkillConfig(skillId: string, config: SkillConfig) {
    this.skillConfigs.set(skillId, config);
  }

  registerSkillFromManifest(skillId: string, manifestInput: SkillManifest | Record<string, unknown>) {
    const normalized = normalizeSkillManifest(manifestInput);
    if (!normalized.ok) {
      console.warn(
        `[SkillExecutor] registerSkillFromManifest: manifest invalid for ${skillId}`,
        normalized.errors
      );
      return;
    }
    const manifest = normalized.manifest;
    this.skillManifests.set(skillId, manifest);

    const manifestTools = (manifest.tools || []).map(tool => ({
      name: tool.name,
      description: tool.description ?? tool.name,
      parameters: tool.parameters as any,
      handler: async (params: any) => {
        return await SkillExecutor.callSkillTool(tool.name, params);
      }
    }));

    const allowEntry =
      typeof localStorage !== 'undefined' &&
      localStorage.getItem('yueli_allow_skill_entry') === '1' &&
      typeof manifest.entry === 'string' &&
      manifest.entry.trim().length > 0;

    if (allowEntry) {
      manifestTools.push({
        name: 'skill_entry',
        description: `执行技能包入口脚本（服务端）：${manifest.entry}`,
        parameters: {
          type: 'object',
          properties: {
            args: {
              type: 'array',
              items: { type: 'string' },
              description: '传递给入口脚本的 CLI 参数'
            }
          }
        } as any,
        handler: async (params: { args?: string[] }) => {
          const sid = manifest.id || skillId;
          return await SkillExecutor.invokeSkillEntryOnServer(sid, params?.args || []);
        }
      });
    }

    const allowRuntime =
      typeof localStorage !== 'undefined' &&
      localStorage.getItem('yueli_allow_skill_runtime') === '1' &&
      typeof manifest.runtime === 'object' &&
      manifest.runtime &&
      typeof (manifest.runtime as any).entrypoint === 'string' &&
      String((manifest.runtime as any).entrypoint).trim().length > 0;

    if (allowRuntime) {
      manifestTools.push({
        name: 'skill_runtime',
        description: `执行技能 runtime.entrypoint（服务端）：${String((manifest.runtime as any).entrypoint)}`,
        parameters: {
          type: 'object',
          properties: {
            userInput: { type: 'string', description: '传递给 runtime.entrypoint 的用户输入（可选）' },
            variables: { type: 'object', description: '传递给 runtime.entrypoint 的上下文变量（可选）' }
          }
        } as any,
        handler: async (params: { userInput?: string; variables?: Record<string, any> }) => {
          const sid = manifest.id || skillId;
          return await SkillExecutor.invokeSkillRuntimeOnServer(sid, {
            userInput: params?.userInput || '',
            history: [],
            variables: params?.variables || {}
          } as any);
        }
      });
    }

    const config: SkillConfig = {
      name: manifest.name,
      description: manifest.description,
      systemPrompt: manifest.systemPrompt || `你是 ${manifest.name} 技能的助手。`,
      tools: manifestTools
    };

    this.registerSkillConfig(skillId, config);
    
    // 从 manifest 生成 Skill 对象
    const skill: Skill = {
      id: manifest.id,
      name: manifest.name,
      description: manifest.description,
      version: manifest.version,
      author: manifest.author,
      installed: true,
      category: (manifest.category as SkillCategory) || 'other',
      tags: manifest.tags || [],
      structure: {
        skimmable: true,
        files: []
      },
      permissions: (manifest.permissions || []) as SkillPermission[],
      source: 'local'
    };
    
    this.registerSkill(skill);
  }

  getSkill(skillId: string): Skill | undefined {
    return this.skills.get(skillId);
  }

  getSkillConfig(skillId: string): SkillConfig | undefined {
    const config = this.skillConfigs.get(skillId);
    if (!config) return undefined;

    // 从PromptRegistry获取最新systemPrompt（支持热更新）
    const skillPromptMap: Record<string, string> = {
      'stop-slop': 'action-writing-optimization',
      'ppt-agent-skills': 'action-ppt-generator',
      'markdown-writer': 'action-markdown-writer',
      'code-generator': 'action-code-generator',
      'data-analyzer': 'action-data-analysis',
      'translator': 'action-translator',
      'text-summarizer': 'action-summarizer',
      'context-recall-constraint': 'context-recall'
    };

    const promptId = skillPromptMap[skillId];
    if (promptId) {
      const latestPrompt = promptRegistry.getSystemPrompt(promptId);
      if (latestPrompt) {
        return { ...config, systemPrompt: latestPrompt };
      }
    }

    return config;
  }

  getAllSkills(): Skill[] {
    return Array.from(this.skills.values());
  }

  removeSkill(skillId: string) {
    const removed = this.skills.delete(skillId);
    if (removed) {
      this.saveSkillsToStorage();
    }
    return removed;
  }

  /**
   * 获取技能的 tool definitions（用于 LLM function calling）
   */
  getSkillToolDefinitions(skillId: string): SkillToolDefinition[] {
    const config = this.skillConfigs.get(skillId);
    if (!config?.tools) return [];

    return config.tools.map(tool => ({
      type: 'function' as const,
      function: {
        name: `skill__${skillId}__${tool.name}`,
        description: tool.description,
        parameters: tool.parameters as any
      }
    }));
  }

  /**
   * 获取技能的 tool definitions（skillIds 由 CoreOrchestratorV2.resolveToolSkillIds 传入，与 Plugin 启用状态对齐）
   */
  getAllToolDefinitions(skillIdsForTools: string[]): SkillToolDefinition[] {
    const tools: SkillToolDefinition[] = [];
    const skillIds = skillIdsForTools.filter(Boolean);

    for (const skillId of skillIds) {
      tools.push(...this.getSkillToolDefinitions(skillId));
    }

    // 加入 MCP Runtime 的工具
    const runtime = getMCPRuntime();
    const mcpTools = runtime.getToolsForLLM();
    tools.push(...mcpTools as any);

    // 加入连接器工具
    if (this.connectorManager) {
      const connectorTools = this.connectorManager.getToolDefinitions();
      tools.push(...connectorTools as any);
    }

    return tools;
  }

  /**
   * 执行 LLM 返回的 tool call
   * 包含超时控制（默认30秒）和错误处理，防止挂死和对话中断
   */
  async executeToolCall(
    toolName: string,
    args: Record<string, any>,
    timeoutMs: number = 30000
  ): Promise<string> {
    const startTime = Date.now();
    
    try {
      // skill tool: skill__skillId__toolName
      const skillMatch = toolName.match(/^skill__([^_]+(?:_[^_]+)*)__(.+)$/);
      if (skillMatch) {
        const skillId = skillMatch[1];
        const toolFnName = skillMatch[2];
        // 记录最近使用：用于每轮 top-k 工具路由
        recordRecentSkillId(skillId);
        const skill = this.skills.get(skillId);
        if (skill?.permissions?.length) {
          const permissionResults = this.permissionManager.checkPermissions(
            skillId,
            skill.permissions as SkillPermission[]
          );
          const denied = permissionResults.filter((r) => !r.allowed).map((r) => r.requested);
          if (denied.length > 0) {
            throw new PermissionRequiredError(skillId, denied);
          }
        }
        const config = this.skillConfigs.get(skillId);
        const tool = config?.tools?.find(t => t.name === toolFnName);
        if (tool?.handler) {
          // P0-4 & P0-2 修复: 改进的超时控制 + 安全序列化
          // 使用 AbortController 模式替代 Promise.race，避免竞态条件
          let timeoutId: ReturnType<typeof setTimeout> | null = null;
          let settled = false;
          
          const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => {
              if (!settled) {
                reject(new Error(`Tool ${toolName} execution timeout (${timeoutMs}ms)`));
              }
            }, timeoutMs);
          });
          
          try {
            // 使用 Promise.race 结合标志位防止超时后继续执行
            const result = await Promise.race([
              tool.handler(args).finally(() => { settled = true; }),
              timeoutPromise
            ]);
            // P0-2: 使用安全序列化防止循环引用崩溃
            return typeof result === 'string' ? result : this.safeStringify(result);
          } finally {
            // P0-4: 确保清理定时器，防止内存泄漏
            if (timeoutId !== null) {
              clearTimeout(timeoutId);
              timeoutId = null;
            }
          }
        }
        return `Error: Tool handler not found for ${toolName}`;
      }

      // MCP tool: mcp__serverId__toolName
      if (toolName.startsWith('mcp__')) {
        const runtime = getMCPRuntime();
        const result = await runtime.executeLLMToolCall({
          id: `call_${Date.now()}`,
          name: toolName,
          arguments: args
        });
        if (result.isError) {
          return `Error: ${result.content[0]?.text || 'MCP tool call failed'}`;
        }
        return result.content.map(c => c.text || c.data || '').join('\n');
      }

      // connector tool: connector__connectorId__action
      if (toolName.startsWith('connector__') && this.connectorManager) {
        return await this.connectorManager.executeToolCall(toolName, args);
      }

      return `Error: Unknown tool ${toolName}`;
    } catch (error) {
      // 权限请求需要被 UI 捕获并交互处理（allow once / always / deny）
      if (error instanceof PermissionRequiredError) {
        throw error;
      }
      const elapsed = Date.now() - startTime;
      console.error(`[SkillExecutor] Tool ${toolName} failed after ${elapsed}ms:`, error);
      // 返回错误信息而不是抛出，防止对话中断
      return `Error: ${error instanceof Error ? error.message : 'Tool execution failed'}`;
    }
  }

  /**
   * 主执行入口 - 优先走 Skill Executor 服务端，回退到本地 prompt 模式
   * 执行完成后自动记录自进化反馈
   */
  async executeSkill(
    skillId: string,
    context: SkillExecutionContext
  ): Promise<SkillExecutionResult> {
    const startTime = Date.now();
    let result: SkillExecutionResult;

    try {
      const skill = this.skills.get(skillId);
      const config = this.skillConfigs.get(skillId);

      if (!skill) {
        result = { success: false, error: `技能 "${skillId}" 未找到` };
        return result;
      }
      if (!config) {
        result = { success: false, error: `技能 "${skillId}" 的配置未找到` };
        return result;
      }

      // 检查技能权限
      const permissionResults = this.permissionManager.checkPermissions(skillId, skill.permissions);
      const deniedPermissions = permissionResults.filter(r => !r.allowed);
      if (deniedPermissions.length > 0) {
        result = { success: false, error: `权限不足: ${deniedPermissions.map(r => r.requested).join(', ')}`, permissions: permissionResults };
        this.recordEvolutionFeedback(skillId, skill.name, result, startTime);
        return result;
      }

      const instanceId = `skill_${skillId}_${Date.now()}`;

      // 在沙箱中执行技能
      const sandboxResult = await this.sandboxManager.executeInSandbox(
        skillId,
        instanceId,
        async () => {
          // 优先尝试服务端执行
          const serverResult = await SkillExecutor.executeSkillOnServer(skillId, context);
          if (serverResult?.success) {
            return serverResult;
          }

          // 回退：本地 prompt 增强模式
          const enhancedPrompt = this.buildEnhancedPrompt(config, context);
          return { success: true, result: enhancedPrompt, toolCalls: [] };
        }
      );

      if (sandboxResult.success) {
        result = {
          success: true,
          result: sandboxResult.output?.result,
          toolCalls: sandboxResult.output?.toolCalls,
          sandboxMetrics: sandboxResult.metrics,
          permissions: permissionResults
        };
      } else {
        result = {
          success: false,
          error: sandboxResult.error,
          sandboxMetrics: sandboxResult.metrics,
          permissions: permissionResults
        };
      }
    } catch (error) {
      result = { success: false, error: error instanceof Error ? error.message : '未知错误' };
    }

    // 记录自进化反馈
    const skill = this.skills.get(skillId);
    this.recordEvolutionFeedback(skillId, skill?.name || skillId, result, startTime);

    // 记录会话记忆
    this.recordSessionMemory(skillId, skill?.name || skillId, result, context);

    // 记录用户偏好
    this.recordUserProfileInteraction(skillId, skill?.name || skillId, result, context, startTime);

    return result;
  }

  /**
   * 获取 Skill Executor URL（统一配置）
   */
  private getExecutorUrl(): string {
    return resolveSkillExecutorBaseUrl();
  }

  /**
   * P1-2: 记录用户偏好交互
   */
  private async recordUserProfileInteraction(
    skillId: string,
    skillName: string,
    result: SkillExecutionResult,
    context: SkillExecutionContext,
    startTime: number
  ): Promise<void> {
    const durationMs = Date.now() - startTime;
    const executorUrl = this.getExecutorUrl();
    
    // P1-2: 空 URL 检查，防止无效请求
    if (!executorUrl) return;

    try {
      await fetch(`${executorUrl}/v1/profile/interaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...resolveSkillExecutorAuthHeaders() },
        body: JSON.stringify({
          userId: 'default',
          skillId,
          skillName,
          inputLength: context.userInput.length,
          outputLength: result.result?.length || 0,
          success: result.success,
          durationMs,
          feedback: undefined
        })
      });
    } catch (e) {
      console.warn('[SkillExecutor] 无法记录用户偏好（服务可能未运行）:', e);
    }
  }

  /**
   * P1-2: 记录技能执行反馈到自进化引擎
   */
  private async recordEvolutionFeedback(
    skillId: string,
    skillName: string,
    result: SkillExecutionResult,
    startTime: number
  ): Promise<void> {
    const durationMs = Date.now() - startTime;
    const executorUrl = this.getExecutorUrl();
    
    // P1-2: 空 URL 检查，防止无效请求
    if (!executorUrl) return;

    try {
      await fetch(`${executorUrl}/v1/evolution/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...resolveSkillExecutorAuthHeaders() },
        body: JSON.stringify({
          skillId,
          skillName,
          durationMs,
          success: result.success,
          error: result.error,
          args: {},
          resultSize: result.result?.length || 0
        })
      });
    } catch (e) {
      console.warn('[SkillExecutor] 无法记录技能进化反馈（服务可能未运行）:', e);
    }
  }

  /**
   * P1-1 & P1-2: 记录会话记忆
   */
  private async recordSessionMemory(
    skillId: string,
    skillName: string,
    result: SkillExecutionResult,
    context: SkillExecutionContext
  ): Promise<void> {
    const executorUrl = this.getExecutorUrl();
    
    // P1-2: 空 URL 检查，防止无效请求
    if (!executorUrl) return;

    try {
      // P1-1: 修复 sessionId 唯一性，使用时间戳 + 随机字符串
      const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const summary = result.success
        ? `技能 "${skillName}" 执行成功`
        : `技能 "${skillName}" 执行失败: ${result.error}`;

      const response = await fetch(`${executorUrl}/v1/memory/record`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...resolveSkillExecutorAuthHeaders() },
        body: JSON.stringify({
          sessionId,
          skillName,
          summary,
          keyOutcome: result.success ? '执行成功' : '执行失败',
          searchableText: `${skillName} ${context.userInput} ${result.result || ''}`.slice(0, 500),
          tags: [skillId],
          metadata: { skillId }
        })
      });

      if (!response.ok) {
        console.warn(`[SkillExecutor] 记录会话记忆失败 (${response.status})`);
      }
    } catch (e) {
      console.warn('[SkillExecutor] 无法记录会话记忆（服务可能未运行）:', e);
    }
  }

  /**
   * Agentic loop - 执行 tool calls 并收集结果
   * 实际的多轮推理在 ChatContext/YueliCopilot 中通过 apiService 完成
   * 这里返回工具定义和初始 prompt，供上层使用
   * @deprecated 此方法已废弃，多轮推理在 apiService.sendOllamaMessageWithMessages 中实现
   */
  private async _runAgenticLoop(
    _skillId: string,
    _config: SkillConfig,
    _context: SkillExecutionContext,
    _enhancedPrompt: string
  ): Promise<Array<{ name: string; args: any; result: string }>> {
    return [];
  }

  /**
   * P0-2: 安全序列化对象，处理循环引用和特殊类型
   */
  private safeStringify(obj: any, space?: number): string {
    const seen = new WeakSet();
    try {
      return JSON.stringify(obj, (key, value) => {
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) {
            return '[Circular Reference]';
          }
          seen.add(value);
        }
        if (typeof value === 'bigint') {
          return value.toString();
        }
        if (value instanceof Error) {
          return `${value.name}: ${value.message}`;
        }
        return value;
      }, space);
    } catch (e) {
      console.error('[SkillExecutor] safeStringify failed:', e);
      return String(obj);
    }
  }

  private buildEnhancedPrompt(
    config: SkillConfig,
    context: SkillExecutionContext
  ): string {
    let prompt = config.systemPrompt;

    if (context.history.length > 0) {
      const recentHistory = context.history.slice(-3);
      prompt += '\n\n## 历史对话';
      recentHistory.forEach(msg => {
        const role = msg.role === 'user' ? '用户' : '助手';
        prompt += `\n${role}: ${msg.content}`;
      });
    }

    if (Object.keys(context.variables).length > 0) {
      prompt += '\n\n## 变量';
      Object.entries(context.variables).forEach(([key, value]) => {
        prompt += `\n${key}: ${value}`;
      });
    }

    prompt += `\n\n## 当前任务\n${context.userInput}`;
    return prompt;
  }

  extractSkillFromInput(input: string): string | null {
    const skillPatterns = [
      /调用技能[：:]\s*(\S+)/,
      /使用技能[：:]\s*(\S+)/,
      /\[skill:(\S+)\]/,
      /技能[：:]\s*(\S+)/,
    ];

    for (const pattern of skillPatterns) {
      const match = input.match(pattern);
      if (match && match[1]) {
        const skillId = match[1];
        if (this.skills.has(skillId)) return skillId;
        for (const [id, skill] of this.skills) {
          if (skill.name.includes(skillId) || id.includes(skillId)) return id;
        }
      }
    }

    return null;
  }

  // ==================== 沙箱管理 ====================

  /**
   * 设置技能的资源配额
   */
  setSkillQuota(skillId: string, quota: any) {
    this.sandboxManager.setQuota(skillId, quota);
  }

  /**
   * 获取技能的资源配额
   */
  getSkillQuota(skillId: string) {
    return this.sandboxManager.getQuota(skillId);
  }

  /**
   * 获取技能配置
   */
  getSkillConfigs() {
    return this.skillConfigs;
  }

  /**
   * 获取技能执行指标
   */
  getExecutionMetrics(instanceId: string) {
    return this.sandboxManager.getMetrics(instanceId);
  }

  // ==================== 权限管理 ====================

  /**
   * 设置技能的权限策略
   */
  setPermissionPolicy(skillId: string, policy: any) {
    this.permissionManager.setPolicy(skillId, policy);
  }

  /**
   * 获取技能的权限策略
   */
  getPermissionPolicy(skillId: string) {
    return this.permissionManager.getPolicy(skillId);
  }

  /**
   * 检查技能权限
   */
  checkPermissions(skillId: string, permissions: SkillPermission[]) {
    return this.permissionManager.checkPermissions(skillId, permissions);
  }

  /**
   * 授予权限
   */
  grantPermission(skillId: string, permission: SkillPermission) {
    this.permissionManager.grantPermission(skillId, permission);
  }

  /** 批量永久授予（聊天侧 allow_always / allow_once） */
  grantPermissions(skillId: string, permissions: SkillPermission[]): void {
    permissions.forEach((p) => this.grantPermission(skillId, p));
  }

  /**
   * 记录聊天权限弹窗中的用户决策（写入 AuditSystem，可与 SkillManager 审计列表对照）
   */
  recordPermissionUiDecision(
    skillId: string,
    decision: 'allow_once' | 'allow_always' | 'deny',
    permissions: SkillPermission[]
  ): void {
    this.auditSystem.record(AuditType.PERMISSION_UI, skillId, 'success', {
      metadata: {
        decision,
        permissions: [...permissions],
        source: 'chat_permission_modal'
      }
    });
  }

  /**
   * 撤销权限
   */
  revokePermission(skillId: string, permission: SkillPermission) {
    this.permissionManager.revokePermission(skillId, permission);
  }

  /**
   * 获取权限描述
   */
  getPermissionDescription(permission: SkillPermission) {
    return this.permissionManager.getPermissionDescription(permission);
  }

  /**
   * 获取权限风险等级
   */
  getPermissionRiskLevel(permission: SkillPermission) {
    return this.permissionManager.getPermissionRiskLevel(permission);
  }

  /**
   * 按风险等级分组权限
   */
  groupPermissionsByRisk(permissions: SkillPermission[]) {
    return this.permissionManager.groupPermissionsByRisk(permissions);
  }
}
