import type { AttachmentTextBlock } from '../../utils/chatFilePromptText';
import type defaultApiService from '../../api/services/apiService';
import { persistChatDocumentToServer } from './documentServerStore';
import { readPdfPipelineMode, shouldRunLlmCommittee, type PdfPipelineMode } from './pdfPipelineConfig';
import { registerChatDocument } from './documentRegistry';
import { queueChatDocumentVectorIndex } from './documentVectorIndex';
import { runIndexerRoleOutput, runRagCuratorRole, formatRoleOutputsAsPrompt } from './pdfRolePipeline';
import { runPdfOrchestratorRoleStage } from './pdfOrchestratorRoles';
import type { ChatDocumentRecord, PdfIngestResult, PdfPipelineRoleOutput } from './types';

type PdfIngestApiClient = Pick<
  typeof defaultApiService,
  'kgmMemoryStore' | 'kgmMemorySearch' | 'kgmCommitteeComplete'
>;

function newDocumentId(sessionId: string, fileName: string): string {
  return `doc-${sessionId}-${Date.now()}-${fileName.replace(/[^\w.-]+/g, '_').slice(0, 40)}`;
}

/**
 * 聊天附件 PDF 入库流程：
 * 1. 文档对象注册（localStorage + Executor SQLite）
 * 2. 分块向量写入 KGM memory
 * 3. 多角色分层产出（启发式 + 可选 LLM 委员会）合并为 LLM user prompt
 */
export async function ingestPdfAttachmentsForChat(params: {
  sessionId: string;
  blocks: AttachmentTextBlock[];
  userNote: string;
  apiService: PdfIngestApiClient;
  model?: string;
  pipelineMode?: PdfPipelineMode;
  /** 已由 CoreOrchestrator skillsPrePipeline 产出四角色时跳过重复执行 */
  skipRoleStage?: boolean;
  orchestratorRoleOutputs?: PdfPipelineRoleOutput[];
}): Promise<PdfIngestResult> {
  const mode = params.pipelineMode ?? readPdfPipelineMode();
  const runLlm = shouldRunLlmCommittee(mode) && Boolean(params.model?.trim());

  const documents: ChatDocumentRecord[] = [];
  let indexedChunkCount = 0;
  const roleOutputs: PdfPipelineRoleOutput[] = [];

  for (const block of params.blocks) {
    if (block.error || !block.text?.trim()) continue;

    const documentId = newDocumentId(params.sessionId, block.name);
    const { chunkCount, jobId } = queueChatDocumentVectorIndex({
      apiService: params.apiService,
      documentId,
      sessionId: params.sessionId,
      fileName: block.name,
      rawText: block.text
    });
    indexedChunkCount += 0;

    const record = registerChatDocument({
      id: documentId,
      sessionId: params.sessionId,
      fileName: block.name,
      charCount: block.text.length,
      chunkCount,
      indexed: false,
      indexingStatus: jobId ? 'queued' : 'completed',
      indexingJobId: jobId,
      indexedChunkCount: 0
    });
    documents.push(record);

    void persistChatDocumentToServer({ document: record, rawText: block.text });

    if (params.orchestratorRoleOutputs?.length) {
      roleOutputs.push(...params.orchestratorRoleOutputs);
    } else if (!params.skipRoleStage) {
      const fileRoles = await runPdfOrchestratorRoleStage({
        rawText: block.text,
        fileName: block.name,
        userNote: params.userNote,
        apiService: runLlm ? params.apiService : undefined,
        model: params.model,
        pipelineMode: mode
      });
      roleOutputs.push(...fileRoles);
    }
  }

  roleOutputs.unshift(runIndexerRoleOutput(documents, indexedChunkCount));

  const documentIds = documents.map((d) => d.id);
  const combinedText = params.blocks
    .filter((b) => b.text && !b.error)
    .map((b) => b.text)
    .join('\n\n');

  const ragOutput = await runRagCuratorRole({
    apiService: params.apiService,
    userQuery: params.userNote,
    documentIds,
    fallbackExcerpt: combinedText
  });
  roleOutputs.push(ragOutput);

  const promptForLlm = formatRoleOutputsAsPrompt(roleOutputs, params.userNote);

  return {
    documents,
    roleOutputs,
    promptForLlm,
    indexedChunkCount,
    pipelineMode: mode
  };
}
