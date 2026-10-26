import type defaultApiService from '../../api/services/apiService';
import { buildDocumentFollowUpPrompt } from './pdfFollowUp';
import { formatRoleOutputsAsPrompt } from './pdfRolePipeline';
import type { PdfPipelineRoleOutput } from './types';

export type PdfAttachmentChatMode = 'compact' | 'full_committee';

const CHAT_MODE_KEY = 'yueli_pdf_attachment_chat_mode';

/** 默认 compact：仅 RAG + 用户问题，避免把四角色全文再塞进 KGM（易 300s 超时） */
export function readPdfAttachmentChatMode(): PdfAttachmentChatMode {
  try {
    const v = localStorage.getItem(CHAT_MODE_KEY);
    if (v === 'full_committee' || v === 'compact') return v;
  } catch {
    /* ignore */
  }
  return 'compact';
}

export function writePdfAttachmentChatMode(mode: PdfAttachmentChatMode): void {
  localStorage.setItem(CHAT_MODE_KEY, mode);
}

type FollowUpClient = Pick<typeof defaultApiService, 'kgmMemorySearch'>;

const ROLE_CHAR_BUDGET: Partial<Record<PdfPipelineRoleOutput['roleId'], number>> = {
  summarizer: 2800,
  structural_analyst: 1200,
  paraphraser: 2000,
  data_extractor: 1500,
  rag_curator: 6000
};

function truncateRoleContent(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content;
  return `${content.slice(0, maxChars)}\n\n[该角色产出已截断以控制推理耗时。]`;
}

/** 完整委员会模式：截断各角色后再拼 prompt */
export function buildFullCommitteeChatPrompt(
  roleOutputs: PdfPipelineRoleOutput[],
  userNote: string
): string {
  const trimmed = roleOutputs.map((r) => ({
    ...r,
    content: truncateRoleContent(r.content, ROLE_CHAR_BUDGET[r.roleId] ?? 2000)
  }));
  return formatRoleOutputsAsPrompt(trimmed, userNote);
}

/**
 * 附件首轮发给 KGM 的 user 内容。
 * compact：入库 + 向量 RAG，不重跑四 Skill 全文注入（推荐，显著降低超时）。
 */
export async function buildAttachmentChatPromptForLlm(params: {
  mode: PdfAttachmentChatMode;
  sessionId: string;
  documentIds: string[];
  userNote: string;
  apiService: FollowUpClient;
  committeeRoleOutputs?: PdfPipelineRoleOutput[];
}): Promise<{ prompt: string; mode: PdfAttachmentChatMode }> {
  if (params.mode === 'compact') {
    const follow = await buildDocumentFollowUpPrompt({
      sessionId: params.sessionId,
      documentIds: params.documentIds,
      userNote: params.userNote,
      apiService: params.apiService
    });
    return { prompt: follow.prompt, mode: 'compact' };
  }

  const roles = params.committeeRoleOutputs ?? [];
  return {
    prompt: buildFullCommitteeChatPrompt(roles, params.userNote),
    mode: 'full_committee'
  };
}
