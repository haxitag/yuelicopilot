import type { SkillManifest } from './SkillManifestSchema';

export type ParsedSkillOutput =
  | { kind: 'structured'; data: unknown; result_valid: true }
  | { kind: 'text'; text: string; result_valid: boolean }
  | { kind: 'empty'; text: ''; result_valid: false };

const SKILL_OUTPUT_TAG = /<skill_output>([\s\S]*?)<\/skill_output>/i;

/** 极简 JSON Schema 校验（顶层 type + required + properties 类型） */
function validateJsonSchema(data: unknown, schema: Record<string, unknown>): boolean {
  if (!schema || typeof schema !== 'object') return true;
  const t = schema.type as string | undefined;
  if (t === 'object') {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return false;
    const required = (schema.required as string[]) || [];
    for (const key of required) {
      if (!(key in (data as Record<string, unknown>))) return false;
    }
    const props = (schema.properties as Record<string, { type?: string }>) || {};
    for (const [key, spec] of Object.entries(props)) {
      if (!(key in (data as Record<string, unknown>))) continue;
      const val = (data as Record<string, unknown>)[key];
      if (spec.type === 'string' && typeof val !== 'string') return false;
      if (spec.type === 'number' && typeof val !== 'number') return false;
      if (spec.type === 'boolean' && typeof val !== 'boolean') return false;
      if (spec.type === 'array' && !Array.isArray(val)) return false;
      if (spec.type === 'object' && (typeof val !== 'object' || val === null || Array.isArray(val))) {
        return false;
      }
    }
    return true;
  }
  if (t === 'array') return Array.isArray(data);
  if (t === 'string') return typeof data === 'string';
  if (t === 'number') return typeof data === 'number';
  if (t === 'boolean') return typeof data === 'boolean';
  return true;
}

function tryParseJson(raw: string): unknown | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
    if (fence) {
      try {
        return JSON.parse(fence[1].trim());
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * 解析技能输出：tool JSON → skill_output 标签 → 启发式 JSON → 纯文本。
 */
export function parseSkillOutput(raw: string | undefined, manifest?: SkillManifest): ParsedSkillOutput {
  if (!raw || !raw.trim()) {
    return { kind: 'empty', text: '', result_valid: false };
  }

  const schema = manifest?.context_injection?.output_schema as Record<string, unknown> | undefined;

  const tagMatch = raw.match(SKILL_OUTPUT_TAG);
  const candidate = tagMatch ? tagMatch[1].trim() : raw;
  const parsed = tryParseJson(candidate);

  if (parsed !== null && schema) {
    const valid = validateJsonSchema(parsed, schema);
    if (valid) {
      return { kind: 'structured', data: parsed, result_valid: true };
    }
  }

  if (parsed !== null && !schema) {
    return { kind: 'structured', data: parsed, result_valid: true };
  }

  if (schema) {
    return { kind: 'text', text: raw, result_valid: false };
  }

  return { kind: 'text', text: raw, result_valid: true };
}

export function formatParsedSkillOutput(parsed: ParsedSkillOutput): string {
  if (parsed.kind === 'structured') {
    return typeof parsed.data === 'string' ? parsed.data : JSON.stringify(parsed.data, null, 2);
  }
  return parsed.text;
}
