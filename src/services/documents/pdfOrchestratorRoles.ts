import { devLog } from '../../utils/devConsole';
import type { PdfPipelineRoleId, PdfPipelineRoleOutput } from './types';
import { mergeRoleOutputs, runLlmCommitteeForDocument } from './pdfCommitteeLlm';
import type defaultApiService from '../../api/services/apiService';
import {
  readPdfRoleExecutionMode,
  shouldRunLlmCommittee,
  type PdfPipelineMode,
  type PdfRoleExecutionMode
} from './pdfPipelineConfig';
import { runHeuristicRolesParallel } from './pdfParallelRoles';
import {
  runPdfRolesViaExecutorPipeline,
  runPdfRolesViaSkillExecute
} from './pdfSkillPipelineClient';
import { devWarn } from '../../utils/devConsole';

/** 虚拟 Skill 清单：与 CoreOrchestrator 管道对齐的 PDF 角色拓扑 */
export const PDF_ORCHESTRATOR_ROLE_GRAPH: Array<{
  skillId: PdfPipelineRoleId;
  displayName: string;
  dependsOn: PdfPipelineRoleId[];
  parallelGroup: number;
}> = [
  { skillId: 'indexer', displayName: '索引员', dependsOn: [], parallelGroup: 0 },
  { skillId: 'structural_analyst', displayName: '结构分析员', dependsOn: ['indexer'], parallelGroup: 1 },
  { skillId: 'summarizer', displayName: '摘要员', dependsOn: ['indexer'], parallelGroup: 1 },
  { skillId: 'paraphraser', displayName: '转述员', dependsOn: ['indexer'], parallelGroup: 1 },
  { skillId: 'data_extractor', displayName: '数据抽取员', dependsOn: ['indexer'], parallelGroup: 1 },
  { skillId: 'rag_curator', displayName: 'RAG 策展员', dependsOn: ['summarizer', 'data_extractor'], parallelGroup: 2 }
];

type CommitteeApi = Pick<typeof defaultApiService, 'kgmCommitteeComplete'>;

/**
 * 阶段 1：并行四角色（启发式）+ 可选 LLM 委员会合并。
 * 阶段 2 由 ingest 在索引/RAG 后完成。
 */
export async function runPdfOrchestratorRoleStage(params: {
  rawText: string;
  fileName: string;
  userNote: string;
  apiService?: CommitteeApi;
  model?: string;
  pipelineMode?: PdfPipelineMode;
  roleExecutionMode?: PdfRoleExecutionMode;
}): Promise<PdfPipelineRoleOutput[]> {
  const mode = params.pipelineMode ?? 'hybrid';
  const execMode = params.roleExecutionMode ?? readPdfRoleExecutionMode();
  devLog('[pdfOrchestrator] parallel group 1', params.fileName, execMode);

  let roles: PdfPipelineRoleOutput[] = [];
  if (execMode === 'executor_pipeline') {
    roles = await runPdfRolesViaExecutorPipeline({
      text: params.rawText,
      fileName: params.fileName,
      userNote: params.userNote
    });
  } else if (execMode === 'executor_skills') {
    roles = await runPdfRolesViaSkillExecute({
      text: params.rawText,
      fileName: params.fileName,
      userNote: params.userNote
    });
  }
  if (roles.length < 4) {
    if (roles.length > 0) {
      devWarn('[pdfOrchestrator] Executor 角色不足，回退 in_process');
    }
    roles = await runHeuristicRolesParallel(params.rawText, params.fileName);
  }

  if (shouldRunLlmCommittee(mode) && params.apiService && params.model?.trim()) {
    const llmRoles = await runLlmCommitteeForDocument({
      apiService: params.apiService,
      model: params.model,
      fileName: params.fileName,
      rawText: params.rawText,
      userNote: params.userNote
    });
    if (llmRoles?.length) {
      roles = mode === 'llm_committee' ? llmRoles : mergeRoleOutputs(roles, llmRoles);
    }
  }

  return roles;
}
