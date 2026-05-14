/**
 * Bundled Skills Registry - 内置技能注册表
 * 参考 Claude Code 的 bundledSkills.ts 实现
 */

import { Skill } from '../../types';
import type { ParsedSkill, SkillSource } from './SkillLoader';

export interface BundledSkillDefinition {
  name: string;
  description: string;
  aliases?: string[];
  whenToUse?: string;
  argumentHint?: string;
  allowedTools?: string[];
  model?: string;
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
  isEnabled?: () => boolean;
  hooks?: {
    preExecution?: string[];
    postExecution?: string[];
  };
  context?: 'inline' | 'fork';
  agent?: string;
  files?: Record<string, string>;
  getPromptForCommand: (args: string, context: ToolUseContext) => Promise<ContentBlockParam[]>;
}

interface ToolUseContext {
  messages: any[];
  getAppState: () => any;
  [key: string]: any;
}

interface ContentBlockParam {
  type: 'text';
  text: string;
}

const bundledSkillsRegistry: BundledSkillDefinition[] = [];

export function registerBundledSkill(definition: BundledSkillDefinition): void {
  bundledSkillsRegistry.push(definition);
}

export function getBundledSkills(): BundledSkillDefinition[] {
  return [...bundledSkillsRegistry];
}

export function getBundledSkillNames(): string[] {
  return bundledSkillsRegistry.map(s => s.name);
}

export function findBundledSkill(name: string): BundledSkillDefinition | undefined {
  return bundledSkillsRegistry.find(s => 
    s.name === name || s.aliases?.includes(name)
  );
}

export function clearBundledSkills(): void {
  bundledSkillsRegistry.length = 0;
}

export function bundledSkillToParsedSkill(
  definition: BundledSkillDefinition,
  source: SkillSource = 'bundled'
): ParsedSkill {
  return {
    id: definition.name,
    name: definition.name,
    displayName: definition.name,
    description: definition.description,
    hasUserSpecifiedDescription: true,
    allowedTools: definition.allowedTools || [],
    argumentHint: definition.argumentHint,
    argumentNames: definition.argumentHint 
      ? definition.argumentHint.match(/\$\{(\w+)\}/g)?.map(s => s.slice(2, -1)) || []
      : [],
    whenToUse: definition.whenToUse,
    version: '1.0.0',
    model: definition.model,
    disableModelInvocation: definition.disableModelInvocation || false,
    userInvocable: definition.userInvocable ?? true,
    hooks: definition.hooks,
    executionContext: definition.context,
    agent: definition.agent,
    effort: undefined,
    shell: undefined,
    paths: undefined,
    markdownContent: definition.getPromptForCommand.toString().slice(0, 100),
    source,
    baseDir: undefined,
    skillRoot: undefined,
    loadedFrom: 'bundled',
    contentLength: 0,
    isHidden: !(definition.userInvocable ?? true),
    progressMessage: 'running'
  };
}

export async function executeBundledSkill(
  skillName: string,
  args: string,
  context: ToolUseContext
): Promise<ContentBlockParam[]> {
  const skill = findBundledSkill(skillName);
  if (!skill) {
    throw new Error(`Bundled skill not found: ${skillName}`);
  }
  
  if (skill.isEnabled && !skill.isEnabled()) {
    throw new Error(`Bundled skill is disabled: ${skillName}`);
  }
  
  return await skill.getPromptForCommand(args, context);
}
