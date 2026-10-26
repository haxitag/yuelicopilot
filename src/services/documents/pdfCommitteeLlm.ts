import type defaultApiService from '../../api/services/apiService';
import { devWarn } from '../../utils/devConsole';
import type { PdfPipelineRoleOutput } from './types';

type CommitteeApi = Pick<typeof defaultApiService, 'kgmCommitteeComplete'>;

const COMMITTEE_EXCERPT_MAX = 12_000;

export type CommitteeLlmJson = {
  structural?: string;
  summary?: string;
  paraphrase?: string;
  dataPoints?: string[] | string;
};

export function parseCommitteeLlmJson(raw: string): CommitteeLlmJson | null {
  const trimmed = raw.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1].trim() : trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as CommitteeLlmJson;
  } catch {
    return null;
  }
}

export function committeeJsonToRoleOutputs(
  json: CommitteeLlmJson,
  fileName: string
): PdfPipelineRoleOutput[] {
  const out: PdfPipelineRoleOutput[] = [];
  if (json.structural?.trim()) {
    out.push({
      roleId: 'structural_analyst',
      displayName: '结构分析员',
      content: `### ${fileName}（LLM）\n\n${json.structural.trim()}`
    });
  }
  if (json.summary?.trim()) {
    out.push({
      roleId: 'summarizer',
      displayName: '摘要员',
      content: `### ${fileName}（LLM）\n\n${json.summary.trim()}`
    });
  }
  if (json.paraphrase?.trim()) {
    out.push({
      roleId: 'paraphraser',
      displayName: '转述员',
      content: `### ${fileName}（LLM）\n\n${json.paraphrase.trim()}`
    });
  }
  const dp = json.dataPoints;
  if (dp) {
    const body = Array.isArray(dp) ? dp.map((p) => `- ${p}`).join('\n') : String(dp);
    out.push({
      roleId: 'data_extractor',
      displayName: '数据抽取员',
      content: `### ${fileName}（LLM）\n\n${body}`
    });
  }
  return out;
}

/**
 * 单次 KGM 调用模拟委员会多角色（结构/摘要/转述/数据），避免 4 次串行超时。
 */
export async function runLlmCommitteeForDocument(params: {
  apiService: CommitteeApi;
  model: string;
  fileName: string;
  rawText: string;
  userNote: string;
}): Promise<PdfPipelineRoleOutput[] | null> {
  const excerpt = params.rawText.slice(0, COMMITTEE_EXCERPT_MAX);
  const system = [
    '你是 PDF 处理委员会，需以 JSON 一次性输出各角色结果，不要输出其它说明。',
    '字段：structural（章节骨架 Markdown）、summary（500字内摘要）、paraphrase（核心转述）、dataPoints（字符串数组，关键数字/实体/日期）。',
    '仅输出一个 JSON 对象。'
  ].join('\n');

  const user = [
    `文档：${params.fileName}`,
    `用户任务：${params.userNote || '总结与提取关键信息'}`,
    '---',
    excerpt
  ].join('\n\n');

  try {
    const raw = await params.apiService.kgmCommitteeComplete(params.model, [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ]);
    if (!raw?.trim()) return null;
    const json = parseCommitteeLlmJson(raw);
    if (!json) {
      devWarn('[pdfCommitteeLlm] JSON 解析失败，回退启发式');
      return null;
    }
    const roles = committeeJsonToRoleOutputs(json, params.fileName);
    return roles.length > 0 ? roles : null;
  } catch (e) {
    devWarn('[pdfCommitteeLlm] 委员会 LLM 失败', e);
    return null;
  }
}

/** 用 LLM 产出覆盖同 roleId 的启发式结果 */
export function mergeRoleOutputs(
  heuristic: PdfPipelineRoleOutput[],
  llm: PdfPipelineRoleOutput[]
): PdfPipelineRoleOutput[] {
  const llmByRole = new Map(llm.map((r) => [r.roleId, r]));
  const merged = heuristic.map((h) => llmByRole.get(h.roleId) ?? h);
  for (const r of llm) {
    if (!merged.some((m) => m.roleId === r.roleId)) merged.push(r);
  }
  return merged;
}
