/** 聊天附件文档在向量库与本地注册表中的实体 */

export type PdfPipelineRoleId =
  | 'indexer'
  | 'structural_analyst'
  | 'summarizer'
  | 'paraphraser'
  | 'data_extractor'
  | 'rag_curator';

export interface PdfPipelineRoleMeta {
  id: PdfPipelineRoleId;
  displayName: string;
  perspective: string;
}

export interface PdfPipelineRoleOutput {
  roleId: PdfPipelineRoleId;
  displayName: string;
  content: string;
}

export interface ChatDocumentRecord {
  id: string;
  sessionId: string;
  fileName: string;
  charCount: number;
  chunkCount: number;
  indexed: boolean;
  indexingStatus?: 'queued' | 'running' | 'paused' | 'completed' | 'failed';
  indexingJobId?: string;
  indexedChunkCount?: number;
  indexError?: string;
  indexedAt?: string;
  createdAt: string;
}

export type PdfPipelineMode = import('./pdfPipelineConfig').PdfPipelineMode;

export interface PdfIngestResult {
  documents: ChatDocumentRecord[];
  roleOutputs: PdfPipelineRoleOutput[];
  promptForLlm: string;
  indexedChunkCount: number;
  pipelineMode?: PdfPipelineMode;
}
