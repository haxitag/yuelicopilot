/**
 * Skill Loader - 解析和加载 SKILL.md 文件
 * 参考 Claude Code 的 loadSkillsDir.ts 实现
 */

import { Skill, SkillCategory, SkillPermission } from '../../types';

export interface SkillFrontmatter {
  name?: string;
  description?: string;
  allowedTools?: string[];
  argumentHint?: string;
  arguments?: string | string[];
  whenToUse?: string;
  when_to_use?: string;
  version?: string;
  model?: string;
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
  hooks?: SkillHooks;
  context?: 'inline' | 'fork';
  agent?: string;
  effort?: string;
  shell?: string | string[];
  paths?: string | string[];
}

export interface SkillHooks {
  preExecution?: string[];
  postExecution?: string[];
}

export interface ParsedSkill {
  id: string;
  name: string;
  displayName?: string;
  description: string;
  hasUserSpecifiedDescription: boolean;
  allowedTools: string[];
  argumentHint?: string;
  argumentNames: string[];
  whenToUse?: string;
  version?: string;
  model?: string;
  disableModelInvocation: boolean;
  userInvocable: boolean;
  hooks?: SkillHooks;
  executionContext?: 'inline' | 'fork';
  agent?: string;
  effort?: string;
  shell?: string | string[];
  paths?: string[];
  markdownContent: string;
  source: SkillSource;
  baseDir?: string;
  skillRoot?: string;
  loadedFrom: SkillLoadedFrom;
  contentLength: number;
  isHidden: boolean;
  progressMessage: string;
}

export type SkillSource = 'userSettings' | 'projectSettings' | 'policySettings' | 'plugin' | 'builtin' | 'bundled' | 'mcp' | 'commands_DEPRECATED';
export type SkillLoadedFrom = 'skills' | 'commands' | 'plugin' | 'managed' | 'bundled' | 'mcp';

export interface SkillFile {
  filePath: string;
  baseDir: string;
  frontmatter: SkillFrontmatter;
  content: string;
  source: SkillSource;
}

const FRONTMATTER_REGEX = /^---\s*\n([\s\S]*?)\n---\s*\n/;
const SKILL_FILE_NAMES = ['SKILL.md', 'skill.md', 'SKILL.MD'];
const SUPPORTED_MANIFEST_FILES = ['skill.json', 'manifest.json', 'agent.json', 'plugin.json', 'opencode.json'];

export function parseFrontmatter(content: string, filePath: string): { frontmatter: SkillFrontmatter; content: string } {
  const match = content.match(FRONTMATTER_REGEX);
  if (!match) {
    return { frontmatter: {}, content };
  }
  
  const frontmatterStr = match[1];
  const markdownContent = content.slice(match[0].length);
  
  const frontmatter: Record<string, any> = {};
  
  for (const line of frontmatterStr.split('\n')) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;
    
    const key = line.slice(0, colonIndex).trim();
    let value: any = line.slice(colonIndex + 1).trim();
    
    if (value.startsWith('[') && value.endsWith(']')) {
      value = value.slice(1, -1).split(',').map((v: string) => v.trim().replace(/^["']|["']$/g, ''));
    } else if (value === 'true') {
      value = true;
    } else if (value === 'false') {
      value = false;
    }
    
    frontmatter[key] = value;
  }
  
  return { frontmatter: frontmatter as SkillFrontmatter, content: markdownContent };
}

export function parseArgumentNames(args?: string | string[]): string[] {
  if (!args) return [];
  if (Array.isArray(args)) return args;
  return args.split(',').map(s => s.trim()).filter(Boolean);
}

export function parseToolPatterns(tools?: string[]): string[] {
  return tools || [];
}

export function parseEffortValue(effort?: string): number | undefined {
  if (!effort) return undefined;
  const parsed = parseInt(effort, 10);
  return isNaN(parsed) ? undefined : parsed;
}

export function parsePaths(paths?: string | string[]): string[] | undefined {
  if (!paths) return undefined;
  if (Array.isArray(paths)) return paths;
  return paths.split(',').map(s => s.trim()).filter(Boolean);
}

export function parseShell(shell?: string | string[]): string | string[] | undefined {
  if (!shell) return undefined;
  if (Array.isArray(shell)) return shell;
  return shell;
}

export function extractDescriptionFromMarkdown(content: string, fallback: string = 'Skill'): string {
  const firstLine = content.split('\n').find(line => line.trim() && !line.startsWith('#'));
  return firstLine?.trim() || fallback;
}

export function isSkillFile(fileName: string): boolean {
  return SKILL_FILE_NAMES.includes(fileName);
}

export function isSupportedManifest(fileName: string): boolean {
  return SUPPORTED_MANIFEST_FILES.includes(fileName);
}

export function parseSkillFromMarkdown(
  filePath: string,
  content: string,
  skillDirName: string,
  source: SkillSource
): ParsedSkill | null {
  try {
    const { frontmatter, content: markdownContent } = parseFrontmatter(content, filePath);
    
    const skillId = frontmatter.name || skillDirName;
    const description = frontmatter.description || extractDescriptionFromMarkdown(markdownContent, skillId);
    
    return {
      id: skillId,
      name: skillId,
      displayName: frontmatter.name,
      description,
      hasUserSpecifiedDescription: !!frontmatter.description,
      allowedTools: parseToolPatterns(frontmatter.allowedTools),
      argumentHint: frontmatter.argumentHint,
      argumentNames: parseArgumentNames(frontmatter.arguments),
      whenToUse: frontmatter.when_to_use || frontmatter.whenToUse,
      version: frontmatter.version,
      model: frontmatter.model,
      disableModelInvocation: frontmatter.disableModelInvocation === true,
      userInvocable: frontmatter.userInvocable !== false,
      hooks: frontmatter.hooks,
      executionContext: frontmatter.context === 'fork' ? 'fork' : frontmatter.context === 'inline' ? 'inline' : undefined,
      agent: frontmatter.agent,
      effort: frontmatter.effort,
      shell: parseShell(frontmatter.shell),
      paths: parsePaths(frontmatter.paths),
      markdownContent,
      source,
      baseDir: filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : undefined,
      skillRoot: filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : undefined,
      loadedFrom: 'skills',
      contentLength: markdownContent.length,
      isHidden: frontmatter.userInvocable === false,
      progressMessage: 'running'
    };
  } catch (error) {
    console.error(`Failed to parse skill from ${filePath}:`, error);
    return null;
  }
}

export function parseSkillFromJson(manifest: any, baseDir: string, source: SkillSource): ParsedSkill | null {
  try {
    const id = manifest.id || manifest.name || manifest.slug;
    if (!id) return null;
    
    return {
      id,
      name: id,
      displayName: manifest.displayName || manifest.name,
      description: manifest.description || `${id} skill`,
      hasUserSpecifiedDescription: !!manifest.description,
      allowedTools: manifest.allowedTools || [],
      argumentHint: manifest.argumentHint,
      argumentNames: parseArgumentNames(manifest.arguments),
      whenToUse: manifest.whenToUse || manifest.when_to_use,
      version: manifest.version,
      model: manifest.model,
      disableModelInvocation: manifest.disableModelInvocation === true,
      userInvocable: manifest.userInvocable !== false,
      hooks: manifest.hooks,
      executionContext: manifest.context === 'fork' ? 'fork' : manifest.context === 'inline' ? 'inline' : undefined,
      agent: manifest.agent,
      effort: manifest.effort,
      shell: parseShell(manifest.shell),
      paths: parsePaths(manifest.paths),
      markdownContent: manifest.prompt || manifest.systemPrompt || manifest.instructions || '',
      source,
      baseDir,
      skillRoot: baseDir,
      loadedFrom: source === 'mcp' ? 'mcp' : 'plugin',
      contentLength: (manifest.prompt || '').length,
      isHidden: manifest.userInvocable === false,
      progressMessage: 'running'
    };
  } catch (error) {
    console.error(`Failed to parse skill from manifest in ${baseDir}:`, error);
    return null;
  }
}

export function skillToSkillObject(parsed: ParsedSkill): Skill {
  return {
    id: parsed.id,
    name: parsed.name,
    description: parsed.description,
    version: parsed.version || '1.0.0',
    author: 'Unknown',
    installed: true,
    category: 'productivity' as SkillCategory,
    tags: [],
    structure: {
      skimmable: true,
      files: []
    },
    permissions: [],
    source: 'local'
  };
}

export function buildSkillPrompt(
  parsed: ParsedSkill,
  args?: string,
  sessionId?: string
): string {
  let prompt = parsed.markdownContent;
  
  if (args && parsed.argumentNames.length > 0) {
    for (const argName of parsed.argumentNames) {
      const placeholder = `\${${argName}}`;
      prompt = prompt.replace(new RegExp(placeholder, 'g'), args);
    }
    prompt = prompt.replace(/\$\{(\w+)\}/g, (_match, name) => {
      return args.split(' ')[parsed.argumentNames.indexOf(name)] || `\${${name}}`;
    });
  }
  
  if (parsed.baseDir) {
    prompt = `Base directory for this skill: ${parsed.baseDir}\n\n${prompt}`;
  }
  
  if (sessionId) {
    prompt = prompt.replace(/\$\{CLAUDE_SESSION_ID\}/g, sessionId);
  }
  
  if (parsed.skillRoot) {
    const skillDir = parsed.skillRoot.replace(/\\/g, '/');
    prompt = prompt.replace(/\$\{CLAUDE_SKILL_DIR\}/g, skillDir);
  }
  
  return prompt;
}
