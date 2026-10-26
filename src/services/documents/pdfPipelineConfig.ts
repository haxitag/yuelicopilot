export type PdfPipelineMode = 'heuristic' | 'llm_committee' | 'hybrid';

export type PdfRoleExecutionMode = 'in_process' | 'executor_pipeline' | 'executor_skills';

const MODE_KEY = 'yueli_pdf_pipeline_mode';
const ROLE_EXEC_KEY = 'yueli_pdf_role_execution';

export function readPdfPipelineMode(): PdfPipelineMode {
  try {
    const v = localStorage.getItem(MODE_KEY);
    if (v === 'llm_committee' || v === 'hybrid' || v === 'heuristic') return v;
  } catch {
    /* ignore */
  }
  return 'hybrid';
}

export function writePdfPipelineMode(mode: PdfPipelineMode): void {
  localStorage.setItem(MODE_KEY, mode);
}

export function shouldRunLlmCommittee(mode: PdfPipelineMode = readPdfPipelineMode()): boolean {
  return mode === 'llm_committee' || mode === 'hybrid';
}

/** 默认走 Executor 多角色 Skill 管道（可改回 in_process） */
export function readPdfRoleExecutionMode(): PdfRoleExecutionMode {
  try {
    const v = localStorage.getItem(ROLE_EXEC_KEY);
    if (v === 'in_process' || v === 'executor_pipeline' || v === 'executor_skills') return v;
  } catch {
    /* ignore */
  }
  return 'executor_pipeline';
}

export function writePdfRoleExecutionMode(mode: PdfRoleExecutionMode): void {
  localStorage.setItem(ROLE_EXEC_KEY, mode);
}

export type { PdfAttachmentChatMode } from './pdfAttachmentChatPrompt';
export {
  readPdfAttachmentChatMode,
  writePdfAttachmentChatMode,
  buildAttachmentChatPromptForLlm
} from './pdfAttachmentChatPrompt';
