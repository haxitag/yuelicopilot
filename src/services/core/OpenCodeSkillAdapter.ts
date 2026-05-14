import { migrateLegacyManifest } from './SkillManifestSchema';

/**
 * OpenCode/OpenWork 的 opencode.json 在生态中存在多种字段命名。
 * 这里做一个“向你们 SkillManifestSchema 靠拢”的轻量映射：
 * - slug -> id
 * - prompt/system_prompt/instructions -> systemPrompt
 * - entrypoint/runtime.entrypoint -> entry / runtime.entrypoint
 * - tools 保持 {name, description, parameters} 结构（尽量不丢字段）
 */
export function adaptOpenCodeManifest(raw: unknown): Record<string, unknown> {
  const migrated = migrateLegacyManifest(raw);
  const o = migrated as Record<string, any>;

  const id = (typeof o.id === 'string' && o.id.trim()) || (typeof o.slug === 'string' && o.slug.trim()) || undefined;
  const name = (typeof o.name === 'string' && o.name.trim()) || id || 'opencode-skill';

  const systemPrompt =
    (typeof o.systemPrompt === 'string' && o.systemPrompt) ||
    (typeof o.system_prompt === 'string' && o.system_prompt) ||
    (typeof o.prompt === 'string' && o.prompt) ||
    (typeof o.instructions === 'string' && o.instructions) ||
    '';

  const entry =
    (typeof o.entry === 'string' && o.entry.trim()) ||
    (typeof o.entrypoint === 'string' && o.entrypoint.trim()) ||
    (typeof o.runtime?.entrypoint === 'string' && o.runtime.entrypoint.trim()) ||
    undefined;

  const runtimeType =
    (typeof o.runtime?.type === 'string' && o.runtime.type) ||
    (typeof o.language === 'string' && o.language) ||
    undefined;

  const tools = Array.isArray(o.tools)
    ? o.tools
        .map((t: any) => {
          if (!t || typeof t !== 'object') return null;
          const name = t.name || t.id || t.tool || t.function;
          if (!name) return null;
          return {
            name: String(name),
            description: typeof t.description === 'string' ? t.description : undefined,
            parameters: t.parameters ?? t.schema ?? t.input_schema ?? undefined
          };
        })
        .filter(Boolean)
    : undefined;

  // permissions 有的叫 permissions，有的塞在 capabilities / allowlist 里；先尽量合并为 string[]
  const permissions: string[] = [];
  if (Array.isArray(o.permissions)) permissions.push(...o.permissions.map(String));
  if (Array.isArray(o.capabilities)) permissions.push(...o.capabilities.map(String));
  if (o.capabilities && typeof o.capabilities === 'object') {
    for (const [k, v] of Object.entries(o.capabilities)) {
      if (v === true) permissions.push(String(k));
    }
  }

  const next: Record<string, unknown> = {
    ...o,
    id: id || String((migrated as any).id),
    name: String(name),
    systemPrompt,
    entry: entry,
    runtime: o.runtime || (runtimeType || entry ? { type: runtimeType || 'node', entrypoint: entry } : undefined),
    permissions: permissions.length > 0 ? Array.from(new Set(permissions)) : (o.permissions as any),
    tools: tools || o.tools
  };

  return next;
}

