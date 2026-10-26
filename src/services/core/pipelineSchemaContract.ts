import type { SkillManifest } from './SkillManifestSchema';
import { parseSkillOutput } from './ResultParser';

export interface PipelineInputBinding {
  fromSkill: string;
  /** 注入 variables.pipelineInputs 的键，默认 fromSkill */
  as?: string;
  /** 从结构化产出中选取的 dot 路径；空则整对象 */
  paths?: string[];
  required?: boolean;
}

export interface PipelinePriorArtifact {
  skillId: string;
  text: string;
  structured: unknown | null;
  result_valid: boolean;
}

function getByDotPath(obj: unknown, path: string): unknown {
  const parts = path.split('.').filter(Boolean);
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur === null || cur === undefined || typeof cur !== 'object' || Array.isArray(cur)) {
      return undefined;
    }
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function validateJsonSchemaLite(data: unknown, schema: Record<string, unknown>): boolean {
  const t = schema.type as string | undefined;
  if (t === 'object') {
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return false;
    const required = (schema.required as string[]) || [];
    for (const key of required) {
      if (!(key in (data as Record<string, unknown>))) return false;
    }
    return true;
  }
  if (t === 'array') return Array.isArray(data);
  if (t === 'string') return typeof data === 'string';
  if (t === 'number') return typeof data === 'number';
  if (t === 'boolean') return typeof data === 'boolean';
  return true;
}

/** 从管道执行结果构建可传递的结构化制品 */
export function pipelineArtifactFromSkillResult(
  skillId: string,
  skillResult: unknown,
  producerManifest?: SkillManifest
): PipelinePriorArtifact {
  const text = skillResultToText(skillResult);
  const parsed = parseSkillOutput(text, producerManifest);
  if (parsed.kind === 'structured') {
    return {
      skillId,
      text: formatStructuredForPrompt(parsed.data),
      structured: parsed.data,
      result_valid: parsed.result_valid
    };
  }
  return {
    skillId,
    text,
    structured: null,
    result_valid: parsed.result_valid
  };
}

function skillResultToText(skillResult: unknown): string {
  if (!skillResult) return '';
  const r = skillResult as Record<string, unknown>;
  if (typeof r.result === 'string') return r.result;
  const d = (r.data as Record<string, unknown> | undefined)?.data ?? r.data ?? r.normalized ?? r;
  if (typeof d === 'string') return d;
  if (d && typeof (d as Record<string, unknown>).result === 'string') {
    return (d as Record<string, unknown>).result as string;
  }
  try {
    return JSON.stringify(d);
  } catch {
    return String(d);
  }
}

function formatStructuredForPrompt(data: unknown): string {
  return typeof data === 'string' ? data : JSON.stringify(data, null, 2);
}

function readPipelineBindings(manifest: SkillManifest): PipelineInputBinding[] {
  const pipe = manifest.pipeline as { inputs?: PipelineInputBinding[] } | undefined;
  if (!pipe?.inputs?.length) return [];
  return pipe.inputs;
}

/**
 * 按 consumer manifest.pipeline.inputs 从上游结构化产出组装 pipelineInputs。
 * 若上游声明 output_schema 且 structured 存在，做轻量 schema 校验。
 */
export function buildPipelineInputs(
  consumerManifest: SkillManifest,
  priors: Record<string, PipelinePriorArtifact>,
  producerManifests: Record<string, SkillManifest | undefined> = {}
): Record<string, unknown> {
  const bindings = readPipelineBindings(consumerManifest);
  if (bindings.length === 0) return {};

  const out: Record<string, unknown> = {};
  const errors: string[] = [];

  for (const binding of bindings) {
    const fromId = binding.fromSkill;
    const key = binding.as?.trim() || fromId;
    const prior = priors[fromId];
    if (!prior) {
      if (binding.required) errors.push(`缺少上游技能产出: ${fromId}`);
      continue;
    }

    const producerManifest = producerManifests[fromId];
    const outputSchema = producerManifest?.context_injection?.output_schema as
      | Record<string, unknown>
      | undefined;

    let value: unknown;
    if (prior.structured !== null) {
      if (outputSchema && !validateJsonSchemaLite(prior.structured, outputSchema)) {
        errors.push(`上游 ${fromId} 产出不符合 output_schema`);
        if (binding.required) continue;
      }
      const paths = binding.paths?.filter(Boolean) ?? [];
      if (paths.length === 0) {
        value = prior.structured;
      } else if (paths.length === 1) {
        value = getByDotPath(prior.structured, paths[0]);
      } else {
        const picked: Record<string, unknown> = {};
        for (const p of paths) {
          picked[p] = getByDotPath(prior.structured, p);
        }
        value = picked;
      }
    } else {
      if (binding.required) {
        errors.push(`上游 ${fromId} 无结构化产出（仅有文本）`);
        continue;
      }
      value = prior.text;
    }

    out[key] = value;
  }

  if (errors.length > 0) {
    out._pipelineContractErrors = errors;
  }

  return out;
}

/** 文本摘要 map（兼容旧 pipelinePriorOutputs） */
export function pipelinePriorOutputsAsText(
  priors: Record<string, PipelinePriorArtifact>
): Record<string, string> {
  const text: Record<string, string> = {};
  for (const [id, a] of Object.entries(priors)) {
    if (a.text.trim()) text[id] = a.text;
  }
  return text;
}
