import { 
  LocalSkillSource, 
  LocalSkillManifest, 
  Skill, 
  SkillCategory
} from '../../types';
import { resolveSkillExecutorAuthHeaders, resolveSkillExecutorBaseUrl } from '../../utils/skillExecutorUrl';
import { adaptOpenCodeManifest } from './OpenCodeSkillAdapter';

export interface SkillPackage {
  id: string;
  name: string;
  path: string;
  manifest: LocalSkillManifest;
  sourceType: 'agent-directory' | 'custom-directory' | 'workspace';
}

export class LocalSkillScanner {
  private get executorUrl(): string {
    return resolveSkillExecutorBaseUrl();
  }

  private knownDirectories: Array<{
    path: string;
    platform: LocalSkillSource['platform'];
    description: string;
  }> = [];

  private supportedManifestFiles = [
    'skill.json',
    'manifest.json',
    'agent.json',
    'plugin.json',
    'opencode.json',
    'SKILL.md',
    'skill.md',
    '.skill/manifest.json',
    '.agent/manifest.json',
    '.codex-plugin/plugin.json'
  ];

  constructor() {
    this.initKnownDirectories();
  }

  /**
   * 初始化已知的技能目录路径
   */
  private initKnownDirectories(): void {
    try {
      const homeDir = this.getHomeDirectory();
      
      // ====== 工作区技能目录 (Yueli Copilot) ======
      try {
        if (typeof process !== 'undefined' && process?.env?.PWD) {
          this.addKnownDirectory(`${process.env.PWD}/.skills`, 'yueli', 'Yueli Copilot 工作区技能');
        }
      } catch {}
      
      if (homeDir) {
        // 用户 home 下通用 .skills（与项目内 .skills 并列）
        this.addKnownDirectory(`${homeDir}/.skills`, 'other', '用户主目录 .skills');

        // Agent / agentic skills（兼容 .agent 与 .agents 两种约定）
        this.addKnownDirectory(`${homeDir}/.agent/skills`, 'other', 'Agent Skills (.agent/skills)');
        this.addKnownDirectory(`${homeDir}/.agents/skills`, 'other', '标准 Agent Skills 目录 (.agents/skills)');
        
        // Trae AI 目录
        this.addKnownDirectory(`${homeDir}/.trae/skills`, 'trae', 'Trae AI Skills');
        this.addKnownDirectory(`${homeDir}/.trae/agents`, 'trae', 'Trae AI Agents');
        
        // Claude Code 目录
        this.addKnownDirectory(`${homeDir}/.claude/skills`, 'claude-code', 'Claude Code Skills');
        this.addKnownDirectory(`${homeDir}/.anthropic/skills`, 'claude-code', 'Anthropic Skills');
        
        // Cursor 目录
        this.addKnownDirectory(`${homeDir}/.cursor/skills`, 'cursor', 'Cursor Skills');
        this.addKnownDirectory(`${homeDir}/.cursor/agents`, 'cursor', 'Cursor Agents');
        
        // Continue AI 目录
        this.addKnownDirectory(`${homeDir}/.continue/skills`, 'other', 'Continue AI Skills');
        this.addKnownDirectory(`${homeDir}/.continue/plugins`, 'other', 'Continue AI Plugins');
        
        // CodeLlama 目录
        this.addKnownDirectory(`${homeDir}/.codellama/skills`, 'other', 'CodeLlama Skills');
        
        // Ollama 目录
        this.addKnownDirectory(`${homeDir}/.ollama/skills`, 'other', 'Ollama Skills');
        this.addKnownDirectory(`${homeDir}/.ollama/modelfiles`, 'other', 'Ollama Models');
        
        // skills-manage 目录
        this.addKnownDirectory(`${homeDir}/.skills-manage/skills`, 'skills-manage', 'Skills Manage');
        this.addKnownDirectory(`${homeDir}/skills-manage/skills`, 'skills-manage', 'Skills Manage (备用)');
        
        // Yueli Copilot 主目录
        this.addKnownDirectory(`${homeDir}/.yueli/skills`, 'yueli', 'Yueli Copilot 全局技能');

        // ====== OpenCode / OpenWork 相关 ======
        this.addKnownDirectory(`${homeDir}/.opencode/skills`, 'other', 'OpenCode Skills (.opencode/skills)');
        
        // JetBrains AI Assistant 目录
        this.addKnownDirectory(`${homeDir}/.jetbrains/ai-assistant/skills`, 'other', 'JetBrains AI Assistant');
        
        // VS Code 扩展目录
        this.addKnownDirectory(`${homeDir}/.vscode/extensions`, 'other', 'VS Code Extensions');
        
        // ====== Codex & OpenAI 相关 ======
        this.addKnownDirectory(`${homeDir}/.codex/skills`, 'codex', 'OpenAI Codex Skills');
        this.addKnownDirectory(`${homeDir}/.openai/skills`, 'codex', 'OpenAI Skills');
        this.addKnownDirectory(`${homeDir}/.openai/plugins`, 'codex', 'OpenAI Plugins');
        
        // ====== GitHub Copilot 相关 ======
        this.addKnownDirectory(`${homeDir}/.github-copilot/skills`, 'copilot', 'GitHub Copilot Skills');
        this.addKnownDirectory(`${homeDir}/.github/copilot`, 'copilot', 'GitHub Copilot');
        
        // ====== Amazon CodeWhisperer 相关 ======
        this.addKnownDirectory(`${homeDir}/.aws/codewhisperer`, 'codewhisperer', 'AWS CodeWhisperer');
        this.addKnownDirectory(`${homeDir}/.amazon/codewhisperer`, 'codewhisperer', 'Amazon CodeWhisperer');
        
        // ====== Tabnine 相关 ======
        this.addKnownDirectory(`${homeDir}/.tabnine/skills`, 'tabnine', 'Tabnine Skills');
        this.addKnownDirectory(`${homeDir}/.tabnine/plugins`, 'tabnine', 'Tabnine Plugins');
        
        // ====== Sourcery 相关 ======
        this.addKnownDirectory(`${homeDir}/.sourcery/skills`, 'other', 'Sourcery Skills');
        
        // ====== Kite 相关 ======
        this.addKnownDirectory(`${homeDir}/.kite/skills`, 'other', 'Kite Skills');
        
        // ====== Codeium 相关 ======
        this.addKnownDirectory(`${homeDir}/.codeium/skills`, 'other', 'Codeium Skills');
        
        // ====== Replit 相关 ======
        this.addKnownDirectory(`${homeDir}/.replit/skills`, 'other', 'Replit Skills');
      }
    } catch (error) {
      console.warn('Could not initialize skill directories:', error);
    }
  }

  private addKnownDirectory(path: string, platform: LocalSkillSource['platform'], description: string): void {
    this.knownDirectories.push({ path, platform, description });
  }

  /**
   * 获取用户主目录（跨平台兼容）
   */
  private getHomeDirectory(): string | null {
    if (typeof process !== 'undefined' && process?.env) {
      return process.env.HOME || process.env.USERPROFILE || null;
    }
    return null;
  }

  /**
   * 获取所有已知目录列表
   */
  getKnownDirectories(): Array<{ path: string; platform: LocalSkillSource['platform']; description: string }> {
    return this.knownDirectories;
  }

  /**
   * 添加自定义技能目录
   */
  addCustomDirectory(path: string, platform: LocalSkillSource['platform'] = 'other', description: string = '自定义目录'): void {
    this.knownDirectories.push({ path, platform, description });
  }

  /**
   * 扫描所有已知目录
   */
  async scanAllDirectories(): Promise<LocalSkillSource[]> {
    const sources: LocalSkillSource[] = [];

    for (const dir of this.knownDirectories) {
      try {
        const source = await this.scanDirectory(dir.path, dir.platform);
        if (source.skills.length > 0) {
          sources.push(source);
        }
      } catch (error) {
        console.warn(`Failed to scan directory ${dir.path}:`, error);
      }
    }

    return sources;
  }

  /**
   * 扫描单个目录
   */
  async scanDirectory(
    directory: string,
    platform: LocalSkillSource['platform']
  ): Promise<LocalSkillSource> {
    const source: LocalSkillSource = {
      directory,
      platform,
      skills: []
    };

    if (typeof window !== 'undefined') {
      const serverSource = await this.scanDirectoryViaServer(directory, platform);
      return serverSource || this.scanFromLocalStorage(directory, platform);
    }

    return source;
  }

  async scanDirectoryViaServer(
    directory: string,
    platform: LocalSkillSource['platform'] = 'custom'
  ): Promise<LocalSkillSource | null> {
    try {
      // 确保 executorUrl 是有效的
      let executorUrl = this.executorUrl;
      
      // 检查 URL 是否包含未解析的环境变量
      if (executorUrl.includes('${')) {
        executorUrl = resolveSkillExecutorBaseUrl();
      }
      
      // 验证 URL 格式
      try {
        new URL(executorUrl);
      } catch {
        executorUrl = resolveSkillExecutorBaseUrl();
      }
      
      const response = await fetch(`${executorUrl}/v1/skills/scan-local`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...resolveSkillExecutorAuthHeaders() },
        body: JSON.stringify({ directory, platform })
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      if (!data.success || !data.source) {
        return null;
      }

      return data.source as LocalSkillSource;
    } catch (error) {
      console.warn(`Failed to scan ${directory} via Skill Executor:`, error);
      return null;
    }
  }

  /**
   * 从 localStorage 扫描已缓存的技能（浏览器环境）
   * 返回真实缓存的技能，不再生成假数据
   */
  private scanFromLocalStorage(
    directory: string,
    platform: LocalSkillSource['platform']
  ): LocalSkillSource {
    const source: LocalSkillSource = {
      directory,
      platform,
      skills: []
    };

    try {
      const storedSkills = localStorage.getItem(`yueli_local_skills_${platform}`);
      if (storedSkills) {
        const skills = JSON.parse(storedSkills);
        source.skills = skills;
        console.log(`[LocalSkillScanner] 从 localStorage 加载了 ${skills.length} 个技能`);
      } else {
        console.log(`[LocalSkillScanner] 未找到 ${platform} 平台的缓存技能，请先运行 skills.sh scan 安装技能`);
      }
    } catch (error) {
      console.warn('Failed to scan from localStorage:', error);
    }

    return source;
  }

  /**
   * 显示目录选择对话框
   */
  async showDirectoryPicker(): Promise<{ handle: any; name: string } | null> {
    if (typeof window !== 'undefined' && 'showDirectoryPicker' in window) {
      try {
        const handle = await (window as any).showDirectoryPicker({
          id: 'yueli-skill-directory-picker',
          mode: 'read',
          startIn: 'downloads',
          suggestedName: 'skills'
        });
        
        return { handle, name: handle.name };
      } catch (error) {
        console.warn('Directory picker cancelled:', error);
        return null;
      }
    }
    
    return null;
  }

  /**
   * 扫描用户选择的自定义目录
   */
  async scanCustomDirectory(dirHandle: any, directoryName: string): Promise<LocalSkillSource> {
    const source: LocalSkillSource = {
      directory: directoryName,
      platform: 'custom',
      skills: []
    };

    if (!dirHandle) {
      console.warn('No directory handle provided');
      return source;
    }

    try {
      const skills = await this.scanDirectoryHandle(dirHandle, directoryName);
      source.skills = skills;
      
      if (skills.length > 0) {
        this.saveLocalSkillToStorage('custom', { directory: directoryName, skills });
      }
    } catch (error) {
      console.error('Failed to scan custom directory:', error);
    }

    return source;
  }

  /**
   * 使用目录句柄扫描目录中的技能
   */
  private async scanDirectoryHandle(dirHandle: any, basePath: string): Promise<any[]> {
    const skills: any[] = [];

    try {
      const rootSkill = await this.scanSkillDirectoryHandle(dirHandle, basePath);
      if (rootSkill) {
        skills.push(rootSkill);
      }

      for await (const entry of dirHandle.values()) {
        if (entry.kind === 'directory') {
          const skill = await this.scanSkillDirectoryHandle(entry, basePath);
          if (skill) {
            skills.push(skill);
          }
        }
      }
    } catch (error) {
      console.error('Error scanning directory:', error);
    }

    return skills;
  }

  /**
   * 扫描单个技能目录
   */
  private async scanSkillDirectoryHandle(dirHandle: any, basePath: string): Promise<any | null> {
    try {
      const manifestFile = await this.findManifestFile(dirHandle);
      if (!manifestFile) {
        return null;
      }

      const file = await manifestFile.getFile();
      const manifestContent = await file.text();
      const manifest = this.parseManifestContent(manifestContent, manifestFile.name, dirHandle.name);

      return {
        id: manifest.id || dirHandle.name,
        name: manifest.name || dirHandle.name,
        path: `${basePath}/${dirHandle.name}`,
        manifest,
        manifestFile: manifestFile.name,
        files: {
          [manifestFile.name]: manifestContent
        }
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * 查找目录中的 manifest 文件
   */
  private async findManifestFile(dirHandle: any): Promise<any | null> {
    for (const fileName of this.supportedManifestFiles) {
      try {
        if (fileName.includes('/')) {
          const parts = fileName.split('/');
          let currentHandle = dirHandle;
          for (let i = 0; i < parts.length - 1; i++) {
            currentHandle = await currentHandle.getDirectoryHandle(parts[i]);
          }
          return await currentHandle.getFileHandle(parts[parts.length - 1]);
        }
        return await dirHandle.getFileHandle(fileName);
      } catch {
        continue;
      }
    }
    return null;
  }

  /**
   * 解析 manifest 文件
   */
  parseManifest(_manifestPath: string): Promise<LocalSkillManifest | null> {
    return new Promise((resolve) => {
      resolve(null);
    });
  }

  private parseManifestContent(content: string, fileName: string, fallbackName: string): LocalSkillManifest & { id?: string; systemPrompt?: string; tools?: any[] } {
    if (fileName.toLowerCase().endsWith('.json')) {
      const parsed = JSON.parse(content);
      const adapted =
        fileName.toLowerCase() === 'opencode.json' ? adaptOpenCodeManifest(parsed) : parsed;
      return this.normalizeManifest(adapted as any, fallbackName);
    }

    return this.normalizeManifest(this.parseMarkdownManifest(content), fallbackName);
  }

  private parseMarkdownManifest(content: string): Record<string, any> {
    const manifest: Record<string, any> = {};
    const frontMatter = content.match(/^---\n([\s\S]*?)\n---/);

    if (frontMatter) {
      const lines = frontMatter[1].split('\n');
      for (let i = 0; i < lines.length; i++) {
        const match = lines[i].match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
        if (!match) continue;

        const key = match[1];
        let value = match[2].trim();
        if (value === '|' || value === '>') {
          const block: string[] = [];
          i++;
          while (i < lines.length && /^\s+/.test(lines[i])) {
            block.push(lines[i].replace(/^\s{2}/, ''));
            i++;
          }
          i--;
          value = block.join('\n').trim();
        }

        manifest[key] = value.replace(/^["']|["']$/g, '');
      }
    }

    const title = content.match(/^#\s+(.+)$/m);
    if (!manifest.name && title) manifest.name = title[1].trim();
    if (!manifest.description) {
      const paragraph = content
        .replace(/^---\n[\s\S]*?\n---/, '')
        .split('\n')
        .map(line => line.trim())
        .find(line => line && !line.startsWith('#') && !line.startsWith('---'));
      if (paragraph) manifest.description = paragraph;
    }

    manifest.systemPrompt = content;
    return manifest;
  }

  private normalizeManifest(manifest: Record<string, any>, fallbackName: string): LocalSkillManifest & { id?: string; systemPrompt?: string; tools?: any[] } {
    const name = manifest.name || fallbackName;
    return {
      id: manifest.id || this.slugify(name),
      name,
      description: manifest.description || '',
      version: manifest.version || '1.0.0',
      author: manifest.author || 'Local',
      category: this.normalizeCategory(manifest.category || 'other'),
      tags: Array.isArray(manifest.tags) ? manifest.tags : [],
      permissions: Array.isArray(manifest.permissions) ? manifest.permissions : [],
      files: Array.isArray(manifest.files) ? manifest.files : [],
      entry: manifest.entry,
      systemPrompt: manifest.systemPrompt || manifest.prompt || manifest.instructions || '',
      tools: Array.isArray(manifest.tools) ? manifest.tools : []
    };
  }

  private slugify(value: string): string {
    return String(value || 'local-skill')
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'local-skill';
  }

  /**
   * 将本地发现的技能转换为标准 Skill 对象
   */
  convertToSkill(localSkill: any, source: LocalSkillSource): Skill {
    const manifest = localSkill.manifest || {};
    
    let category: SkillCategory = 'other';
    if (manifest.category) {
      category = this.normalizeCategory(manifest.category);
    } else {
      category = this.inferCategory(localSkill.name, manifest.description);
    }

    return {
      id: `local_${source.platform}_${localSkill.id}`,
      name: localSkill.name || manifest.name || 'Unnamed Skill',
      description: manifest.description || '',
      version: manifest.version || '1.0.0',
      author: manifest.author || 'Unknown',
      installed: false,
      url: localSkill.path,
      category,
      tags: manifest.tags || [],
      structure: {
        skimmable: true,
        files: manifest.files || []
      },
      permissions: manifest.permissions || [],
      source: 'agent-skills'
    };
  }

  /**
   * 归一化分类名称
   */
  private normalizeCategory(category: string): SkillCategory {
    const categoryMap: Record<string, SkillCategory> = {
      'code': 'coding',
      'coding': 'coding',
      'dev': 'coding',
      'development': 'coding',
      'text': 'writing',
      'write': 'writing',
      'writing': 'writing',
      'analyze': 'analysis',
      'analysis': 'analysis',
      'data': 'analysis',
      'automation': 'automation',
      'auto': 'automation',
      'db': 'database',
      'database': 'database',
      'file': 'file',
      'files': 'file',
      'web': 'web',
      'api': 'web',
      'http': 'web',
      'productivity': 'productivity',
      'util': 'productivity',
      'utility': 'productivity'
    };

    const normalized = category.toLowerCase().trim();
    return categoryMap[normalized] || 'other';
  }

  /**
   * 根据名称和描述推断分类
   */
  private inferCategory(name: string, description?: string): SkillCategory {
    const text = `${name} ${description || ''}`.toLowerCase();
    
    const categoryKeywords: Record<SkillCategory, string[]> = {
      'coding': ['code', 'programming', 'python', 'javascript', 'typescript', 'function', 'class', 'api', 'developer'],
      'writing': ['write', 'text', 'document', 'essay', 'article', 'content', 'edit', 'grammar'],
      'analysis': ['analyze', 'data', 'chart', 'graph', 'statistics', 'insight', 'report'],
      'automation': ['automate', 'workflow', 'task', 'script', 'batch', 'process'],
      'database': ['database', 'sql', 'db', 'query', 'table', 'schema'],
      'file': ['file', 'read', 'write', 'directory', 'folder', 'storage'],
      'web': ['web', 'http', 'api', 'server', 'client', 'request'],
      'productivity': ['productivity', 'tool', 'utility', 'helper', 'manager', 'organize'],
      'system': ['system', 'constraint', 'rule', 'policy', 'context', 'recall'],
      'other': []
    };

    for (const [category, keywords] of Object.entries(categoryKeywords)) {
      if (keywords.some(keyword => text.includes(keyword))) {
        return category as SkillCategory;
      }
    }

    return 'other';
  }

  /**
   * 保存本地技能到 localStorage
   */
  saveLocalSkillToStorage(platform: string, skill: any): void {
    try {
      const key = `yueli_local_skills_${platform}`;
      let skills = [];
      const existing = localStorage.getItem(key);
      if (existing) {
        skills = JSON.parse(existing);
      }
      
      const index = skills.findIndex((s: any) => s.id === skill.id);
      if (index !== -1) {
        skills[index] = skill;
      } else {
        skills.push(skill);
      }
      
      localStorage.setItem(key, JSON.stringify(skills));
    } catch (error) {
      console.warn('Failed to save local skill:', error);
    }
  }
}
