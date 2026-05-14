/**
 * Toolset Management System - 工具集管理系统
 * 基于Hermes-agent的Toolset System设计
 * 核心功能：
 * 1. 工具集分组管理
 * 2. 工具批量启用/禁用
 * 3. 工具依赖管理
 * 4. 工具使用统计
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface Tool {
  name: string;
  description: string;
  category: string;
  enabled: boolean;
  parameters?: Record<string, any>;
  returns?: Record<string, any>;
  examples?: string[];
  tags?: string[];
}

export interface Toolset {
  id: string;
  name: string;
  description: string;
  tools: string[];
  enabled: boolean;
  isDefault: boolean;
  dependencies: string[];
  settings?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
  metadata?: {
    author?: string;
    version?: string;
  };
}

export interface ToolExecution {
  toolName: string;
  toolsetId?: string;
  args?: Record<string, any>;
  result?: any;
  success: boolean;
  durationMs: number;
  timestamp: Date;
  error?: string;
}

export interface ToolsetStats {
  totalToolsets: number;
  totalTools: number;
  enabledToolsets: number;
  enabledTools: number;
  topTools: { name: string; count: number }[];
}

interface ToolsetStore {
  toolsets: Toolset[];
  tools: Tool[];
  executions: ToolExecution[];
  lastCleanup: Date;
}

class ToolsetManager {
  private static instance: ToolsetManager;
  private storePath: string;
  private store: ToolsetStore = {
    toolsets: [],
    tools: [],
    executions: [],
    lastCleanup: new Date()
  };

  private constructor() {
    this.storePath = path.join(__dirname, '../../../data/toolset_manager.json');
    this.loadStore();
    this.initializeDefaultToolsets();
  }

  static getInstance(): ToolsetManager {
    if (!ToolsetManager.instance) {
      ToolsetManager.instance = new ToolsetManager();
    }
    return ToolsetManager.instance;
  }

  private async loadStore(): Promise<void> {
    try {
      const dir = path.dirname(this.storePath);
      await fs.mkdir(dir, { recursive: true });
      const data = await fs.readFile(this.storePath, 'utf-8');
      const parsed = JSON.parse(data);
      this.store = {
        toolsets: (parsed.toolsets || []).map((t: any) => ({
          ...t,
          createdAt: new Date(t.createdAt),
          updatedAt: new Date(t.updatedAt)
        })),
        tools: parsed.tools || [],
        executions: (parsed.executions || []).map((e: any) => ({
          ...e,
          timestamp: new Date(e.timestamp)
        })),
        lastCleanup: new Date(parsed.lastCleanup || Date.now())
      };
    } catch {
      this.store = {
        toolsets: [],
        tools: [],
        executions: [],
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
      console.error('[ToolsetManager] Failed to save store:', e);
    }
  }

  private initializeDefaultToolsets(): void {
    if (this.store.toolsets.length === 0) {
      const defaultToolsets: Toolset[] = [
        {
          id: 'toolset_filesystem',
          name: 'File System',
          description: 'File operations tools',
          tools: ['read_file', 'write_file', 'list_directory', 'delete_file', 'create_directory'],
          enabled: true,
          isDefault: true,
          dependencies: [],
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          id: 'toolset_web',
          name: 'Web Tools',
          description: 'Web search and fetching tools',
          tools: ['web_search', 'fetch_url', 'parse_html'],
          enabled: true,
          isDefault: false,
          dependencies: [],
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          id: 'toolset_code',
          name: 'Code Tools',
          description: 'Programming and code generation tools',
          tools: ['code_generator', 'code_executor', 'code_formatter', 'git_operations'],
          enabled: true,
          isDefault: false,
          dependencies: ['toolset_filesystem'],
          createdAt: new Date(),
          updatedAt: new Date()
        },
        {
          id: 'toolset_document',
          name: 'Document Tools',
          description: 'Document creation and conversion tools',
          tools: ['create_markdown', 'create_pptx', 'create_pdf', 'export_document'],
          enabled: true,
          isDefault: false,
          dependencies: ['toolset_filesystem'],
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ];

      const defaultTools: Tool[] = [
        { name: 'read_file', description: 'Read file contents', category: 'filesystem', enabled: true },
        { name: 'write_file', description: 'Write content to file', category: 'filesystem', enabled: true },
        { name: 'list_directory', description: 'List directory contents', category: 'filesystem', enabled: true },
        { name: 'delete_file', description: 'Delete a file', category: 'filesystem', enabled: true },
        { name: 'create_directory', description: 'Create a directory', category: 'filesystem', enabled: true },
        { name: 'web_search', description: 'Search the web', category: 'web', enabled: true },
        { name: 'fetch_url', description: 'Fetch URL content', category: 'web', enabled: true },
        { name: 'parse_html', description: 'Parse HTML content', category: 'web', enabled: true },
        { name: 'code_generator', description: 'Generate code', category: 'code', enabled: true },
        { name: 'code_executor', description: 'Execute code', category: 'code', enabled: true },
        { name: 'code_formatter', description: 'Format code', category: 'code', enabled: true },
        { name: 'git_operations', description: 'Git operations', category: 'code', enabled: true },
        { name: 'create_markdown', description: 'Create markdown document', category: 'document', enabled: true },
        { name: 'create_pptx', description: 'Create PowerPoint', category: 'document', enabled: true },
        { name: 'create_pdf', description: 'Create PDF', category: 'document', enabled: true },
        { name: 'export_document', description: 'Export document', category: 'document', enabled: true }
      ];

      this.store.toolsets = defaultToolsets;
      this.store.tools = defaultTools;
      this.saveStore();
    }
  }

  async createToolset(config: {
    name: string;
    description: string;
    tools: string[];
    dependencies?: string[];
    settings?: Record<string, any>;
    metadata?: Toolset['metadata'];
  }): Promise<Toolset> {
    const toolset: Toolset = {
      id: `toolset_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: config.name,
      description: config.description,
      tools: config.tools,
      enabled: true,
      isDefault: false,
      dependencies: config.dependencies || [],
      settings: config.settings,
      createdAt: new Date(),
      updatedAt: new Date(),
      metadata: config.metadata
    };

    this.store.toolsets.push(toolset);
    await this.saveStore();
    return toolset;
  }

  async updateToolset(id: string, updates: Partial<Toolset>): Promise<Toolset | null> {
    const toolset = this.store.toolsets.find(t => t.id === id);
    if (!toolset) return null;

    Object.assign(toolset, updates, { updatedAt: new Date() });
    await this.saveStore();
    return toolset;
  }

  async deleteToolset(id: string): Promise<boolean> {
    const index = this.store.toolsets.findIndex(t => t.id === id);
    if (index < 0) return false;

    const toolset = this.store.toolsets[index];
    if (toolset.isDefault) return false;

    this.store.toolsets.splice(index, 1);
    await this.saveStore();
    return true;
  }

  async addToolToToolset(toolsetId: string, toolName: string): Promise<boolean> {
    const toolset = this.store.toolsets.find(t => t.id === toolsetId);
    if (!toolset) return false;

    if (!toolset.tools.includes(toolName)) {
      toolset.tools.push(toolName);
      toolset.updatedAt = new Date();
      await this.saveStore();
    }
    return true;
  }

  async removeToolFromToolset(toolsetId: string, toolName: string): Promise<boolean> {
    const toolset = this.store.toolsets.find(t => t.id === toolsetId);
    if (!toolset) return false;

    const index = toolset.tools.indexOf(toolName);
    if (index >= 0) {
      toolset.tools.splice(index, 1);
      toolset.updatedAt = new Date();
      await this.saveStore();
    }
    return true;
  }

  async toggleToolset(id: string): Promise<boolean> {
    const toolset = this.store.toolsets.find(t => t.id === id);
    if (!toolset || toolset.isDefault) return false;

    toolset.enabled = !toolset.enabled;
    toolset.updatedAt = new Date();
    await this.saveStore();
    return true;
  }

  async enableTool(toolName: string): Promise<boolean> {
    const tool = this.store.tools.find(t => t.name === toolName);
    if (!tool) return false;

    tool.enabled = true;
    await this.saveStore();
    return true;
  }

  async disableTool(toolName: string): Promise<boolean> {
    const tool = this.store.tools.find(t => t.name === toolName);
    if (!tool) return false;

    tool.enabled = false;
    await this.saveStore();
    return true;
  }

  registerTool(tool: Tool): void {
    const existing = this.store.tools.findIndex(t => t.name === tool.name);
    if (existing >= 0) {
      this.store.tools[existing] = tool;
    } else {
      this.store.tools.push(tool);
    }
    this.saveStore();
  }

  getTools(options: {
    toolsetId?: string;
    category?: string;
    enabledOnly?: boolean;
    search?: string;
  } = {}): Tool[] {
    let tools = [...this.store.tools];

    if (options.toolsetId) {
      const toolset = this.store.toolsets.find(t => t.id === options.toolsetId);
      if (toolset) {
        tools = tools.filter(t => toolset.tools.includes(t.name));
      }
    }

    if (options.category) {
      tools = tools.filter(t => t.category === options.category);
    }

    if (options.enabledOnly) {
      tools = tools.filter(t => t.enabled);
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

  getToolsets(options: {
    enabledOnly?: boolean;
    hasTool?: string;
  } = {}): Toolset[] {
    let toolsets = [...this.store.toolsets];

    if (options.enabledOnly) {
      toolsets = toolsets.filter(t => t.enabled);
    }

    if (options.hasTool) {
      toolsets = toolsets.filter(t => t.tools.includes(options.hasTool!));
    }

    return toolsets;
  }

  getToolset(id: string): Toolset | undefined {
    return this.store.toolsets.find(t => t.id === id);
  }

  getTool(name: string): Tool | undefined {
    return this.store.tools.find(t => t.name === name);
  }

  async checkDependencies(toolsetId: string): Promise<{
    satisfied: boolean;
    missing: string[];
  }> {
    const toolset = this.store.toolsets.find(t => t.id === toolsetId);
    if (!toolset) return { satisfied: false, missing: [] };

    const missing = toolset.dependencies.filter(depId => {
      const dep = this.store.toolsets.find(t => t.id === depId);
      return !dep || !dep.enabled;
    });

    return {
      satisfied: missing.length === 0,
      missing
    };
  }

  async enableToolsetWithDeps(id: string): Promise<boolean> {
    const visited = new Set<string>();
    const toEnable: string[] = [];

    const collect = (toolsetId: string): boolean => {
      if (visited.has(toolsetId)) return true;
      visited.add(toolsetId);

      const toolset = this.store.toolsets.find(t => t.id === toolsetId);
      if (!toolset) return false;

      for (const depId of toolset.dependencies) {
        if (!collect(depId)) return false;
        if (!toEnable.includes(depId)) {
          toEnable.push(depId);
        }
      }

      return true;
    };

    if (!collect(id)) return false;

    for (const toolsetId of toEnable) {
      const toolset = this.store.toolsets.find(t => t.id === toolsetId);
      if (toolset) {
        toolset.enabled = true;
        toolset.updatedAt = new Date();
      }
    }

    const mainToolset = this.store.toolsets.find(t => t.id === id);
    if (mainToolset) {
      mainToolset.enabled = true;
      mainToolset.updatedAt = new Date();
    }

    await this.saveStore();
    return true;
  }

  recordExecution(execution: Omit<ToolExecution, 'timestamp'>): void {
    const record: ToolExecution = {
      ...execution,
      timestamp: new Date()
    };

    this.store.executions.push(record);

    if (this.store.executions.length > 10000) {
      this.store.executions = this.store.executions.slice(-5000);
    }

    this.saveStore();
  }

  getToolExecutions(options: {
    toolName?: string;
    toolsetId?: string;
    successOnly?: boolean;
    since?: Date;
    limit?: number;
  } = {}): ToolExecution[] {
    let records = [...this.store.executions];

    if (options.toolName) {
      records = records.filter(e => e.toolName === options.toolName);
    }

    if (options.toolsetId) {
      const toolset = this.store.toolsets.find(t => t.id === options.toolsetId);
      if (toolset) {
        records = records.filter(e => toolset.tools.includes(e.toolName));
      }
    }

    if (options.successOnly) {
      records = records.filter(e => e.success);
    }

    if (options.since) {
      records = records.filter(e => e.timestamp >= options.since!);
    }

    return records
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, options.limit || 100);
  }

  getStats(): ToolsetStats {
    const enabledToolsets = this.store.toolsets.filter(t => t.enabled);
    const enabledTools = this.store.tools.filter(t => t.enabled);

    const toolCounts: Record<string, number> = {};
    for (const exec of this.store.executions) {
      toolCounts[exec.toolName] = (toolCounts[exec.toolName] || 0) + 1;
    }

    const topTools = Object.entries(toolCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totalToolsets: this.store.toolsets.length,
      totalTools: this.store.tools.length,
      enabledToolsets: enabledToolsets.length,
      enabledTools: enabledTools.length,
      topTools
    };
  }

  async cloneToolset(sourceId: string, newName: string): Promise<Toolset | null> {
    const source = this.getToolset(sourceId);
    if (!source) return null;

    return this.createToolset({
      name: newName,
      description: `Cloned from ${source.name}`,
      tools: [...source.tools],
      dependencies: [...source.dependencies],
      settings: { ...source.settings },
      metadata: { ...source.metadata }
    });
  }
}

export const toolsetManager = ToolsetManager.getInstance();