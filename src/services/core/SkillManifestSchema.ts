import { z } from 'zod';
import type { PluginDependency, RepositoryInfo } from '../../types';
import type { SkillLockfile } from './skillLockfile';

const runtimeSchema = z
  .object({
    type: z.enum(['node', 'python', 'wasm', 'rest', 'prompt']).optional(),
    entrypoint: z.string().optional(),
    min_runtime_version: z.string().optional()
  })
  .optional();

const capabilitiesSchema = z
  .object({
    network: z.boolean().optional(),
    filesystem: z.boolean().optional(),
    process: z.boolean().optional(),
    allowed_domains: z.array(z.string()).optional(),
    /** 与文档一致的子工具白名单 */
    tools: z.array(z.string()).optional(),
    declared_tools: z.array(z.string()).optional()
  })
  .optional();

const contextInjectionSchema = z
  .object({
    mode: z.enum(['pre_llm', 'post_llm', 'bidirectional']).optional(),
    template: z.string().optional(),
    output_schema: z.record(z.string(), z.unknown()).optional()
  })
  .optional();

/** 执行剖面：决定浏览器 / 计算 microVM / Docker Linux runner / CI Emulator 等运行时 */
const executionSchema = z
  .object({
    profile: z
      .enum([
        'process_host',
        'browser_local_playwright',
        'compute_firecracker_linux',
        'compute_docker_linux_runner',
        'mobile_ci_emulator'
      ])
      .optional(),
    mobile: z
      .object({
        platform: z.enum(['android', 'ios']).optional(),
        avd: z.string().optional()
      })
      .optional()
  })
  .optional();

const toolDefSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  parameters: z.unknown().optional()
});

const dependenciesStructuredSchema = z.object({
  npm: z.record(z.string()).optional(),
  system: z.array(z.string()).optional(),
  env_vars: z.array(z.string()).optional()
});

const dependenciesSchema = z
  .union([z.array(z.string()), dependenciesStructuredSchema])
  .optional();

const triggersSchema = z
  .object({
    keywords: z.array(z.string()).default([]),
    intent_patterns: z.array(z.string()).default([])
  })
  .optional();

const pipelineInputBindingSchema = z.object({
  fromSkill: z.string(),
  as: z.string().optional(),
  paths: z.array(z.string()).optional(),
  required: z.boolean().optional()
});

const pipelineSchema = z
  .object({
    /** 从已执行的上游 skill 结构化产出映射到本 skill 的输入 */
    inputs: z.array(pipelineInputBindingSchema).optional()
  })
  .optional();

/** Zod 校验后的技能 manifest（含 .passthrough 保留未知字段） */
export const SkillManifestSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    version: z.string().min(1),
    author: z.string().min(1),
    description: z.string(),
    category: z.string().optional(),
    tags: z.array(z.string()).optional(),
    triggers: triggersSchema,
    /** pre_llm 管道内拓扑依赖：先于本 skill 执行的其它 skill id（仅作用于 skillsPrePipeline 排序）；可写 `id@^1.0.0` */
    requires: z.array(z.string()).optional(),
    /** 依赖 skill 的 semver 范围，如 `{ "other-skill": "^1.0.0" }` */
    requiresSemver: z.record(z.string()).optional(),
    pipeline: pipelineSchema,
    permissions: z.array(z.string()).optional(),
    dependencies: dependenciesSchema,
    tools: z.array(toolDefSchema).optional(),
    systemPrompt: z.string().optional(),
    entry: z.string().optional(),
    runtime: runtimeSchema,
    capabilities: capabilitiesSchema,
    context_injection: contextInjectionSchema,
    execution: executionSchema
  })
  .passthrough();

export type SkillManifest = z.infer<typeof SkillManifestSchema>;

/** IndexedDB / 文件系统存储的已安装技能包 */
export interface InstalledSkillData {
  manifest: SkillManifest;
  files: Record<string, string>;
  installedAt: Date;
  repository?: RepositoryInfo;
  /** 安装锁：manifest + 包载荷指纹，用于跳过重复安装 */
  lockfile?: SkillLockfile;
}

export interface ManifestNormalizationResult {
  ok: true;
  manifest: SkillManifest;
}

export interface ManifestNormalizationError {
  ok: false;
  errors: string[];
}

export type NormalizeSkillManifestResult = ManifestNormalizationResult | ManifestNormalizationError;

/** 将历史 / 外部松散 manifest 转为可校验结构（不保证通过 Zod，需再 normalizeSkillManifest） */
export function migrateLegacyManifest(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object') {
    return {
      id: 'unknown-skill',
      name: 'Unknown Skill',
      version: '1.0.0',
      author: 'Unknown',
      description: ''
    };
  }

  const o = raw as Record<string, unknown>;

  const id =
    (typeof o.id === 'string' && o.id.trim()) ||
    (typeof o.slug === 'string' && o.slug.trim()) ||
    (typeof o.name === 'string' &&
      o.name
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-')) ||
    'unknown-skill';

  const name = (typeof o.name === 'string' && o.name.trim()) || id;
  const version = (typeof o.version === 'string' && o.version.trim()) || '1.0.0';
  const author = (typeof o.author === 'string' && o.author.trim()) || 'Unknown';
  const description =
    (typeof o.description === 'string' && o.description) ||
    (typeof o.summary === 'string' && o.summary) ||
    '';

  const next: Record<string, unknown> = { ...o, id, name, version, author, description };

  if (!next.runtime && typeof o.entry === 'string' && o.entry.trim()) {
    next.runtime = {
      type: 'node',
      entrypoint: String(o.entry).trim().replace(/^\.\//, '')
    };
  }

  if (!next.capabilities && Array.isArray(o.permissions)) {
    const perms = o.permissions.map(String);
    const caps: Record<string, boolean> = {};
    if (perms.some((p) => p.includes('network'))) caps.network = true;
    if (perms.some((p) => p.includes('file'))) caps.filesystem = true;
    if (perms.some((p) => p.includes('process') || p.includes('execute'))) caps.process = true;
    if (Object.keys(caps).length > 0) next.capabilities = caps;
  }

  if (!next.requires && Array.isArray(o.requires)) {
    next.requires = o.requires.map(String).filter(Boolean);
  }

  if (!next.triggers && typeof o.triggers === 'object' && o.triggers !== null) {
    next.triggers = o.triggers;
  } else if (!next.triggers) {
    const keywords: string[] = [];
    if (typeof o.name === 'string' && o.name.trim()) keywords.push(o.name.trim());
    if (Array.isArray(o.tags)) {
      for (const t of o.tags) keywords.push(String(t));
    }
    if (keywords.length > 0) {
      next.triggers = { keywords, intent_patterns: [] };
    }
  }

  if (!next.runtime && (!o.tools || (Array.isArray(o.tools) && o.tools.length === 0))) {
    const hasEntry = typeof o.entry === 'string' && o.entry.trim();
    if (!hasEntry && (o.systemPrompt || o.description)) {
      next.runtime = { type: 'prompt' };
    }
  }

  const runtimeObj = next.runtime as { type?: string } | undefined;
  if (!next.context_injection && runtimeObj?.type === 'prompt') {
    next.context_injection = { mode: 'pre_llm' };
  }

  if (!next.execution && runtimeObj?.type === 'prompt') {
    next.execution = { profile: 'process_host' };
  }

  return next;
}

export function normalizeSkillManifest(raw: unknown): NormalizeSkillManifestResult {
  try {
    const migrated = migrateLegacyManifest(raw);
    const parsed = SkillManifestSchema.safeParse(migrated);
    if (!parsed.success) {
      return {
        ok: false,
        errors: parsed.error.errors.map((e) => `${e.path.join('.') || 'root'}: ${e.message}`)
      };
    }
    return { ok: true, manifest: parsed.data };
  } catch (e) {
    return { ok: false, errors: [e instanceof Error ? e.message : String(e)] };
  }
}

/** PluginMetadata.dependencies：兼容 string[] 或结构化 dependencies */
export function manifestDependenciesToPluginIds(manifest: SkillManifest): PluginDependency[] {
  const d = manifest.dependencies;
  if (!d) return [];
  if (Array.isArray(d)) {
    return d.map((id) => ({ id: String(id) }));
  }
  const out: PluginDependency[] = [];
  if (d.npm) {
    for (const [name, ver] of Object.entries(d.npm)) {
      out.push({ id: `npm:${name}`, version: ver });
    }
  }
  if (d.system) {
    for (const cmd of d.system) {
      out.push({ id: `system:${cmd}` });
    }
  }
  if (d.env_vars) {
    for (const v of d.env_vars) {
      out.push({ id: `env:${v}` });
    }
  }
  return out;
}
