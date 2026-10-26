import type defaultApiService from '../../api/services/apiService';

export type DocumentMemoryStoreClient = Pick<typeof defaultApiService, 'kgmMemoryStore'>;
export type DocumentMemorySearchClient = Pick<typeof defaultApiService, 'kgmMemorySearch'>;
type DocumentMemoryClient = DocumentMemoryStoreClient & DocumentMemorySearchClient;
import { routeAndChunkText } from '../../utils/smartChunk';
import { devLog, devWarn } from '../../utils/devConsole';
import { documentIndexingQueue } from './documentIndexingQueue';
import { updateChatDocument } from './documentRegistry';

/** KGM memory collection：聊天 PDF/附件分块 */
export const CHAT_DOCUMENTS_COLLECTION = 'yueli_chat_documents';

function buildDocumentChunks(rawText: string): string[] {
  const { strategy, chunks: chunkList } = routeAndChunkText(rawText, {
    chunkSize: 900,
    overlap: 120
  });
  void strategy;
  return chunkList;
}

function buildStoreChunk(params: {
  apiService: DocumentMemoryClient;
  documentId: string;
  sessionId: string;
  fileName: string;
  rawText: string;
}) {
  return async (chunk: string, i: number, total: number) => {
    const result = await params.apiService.kgmMemoryStore(
      chunk,
      {
        documentId: params.documentId,
        sessionId: params.sessionId,
        fileName: params.fileName,
        chunkIndex: i,
        totalChunks: total,
        sourceType: 'chat_attachment',
        role: 'indexer_chunk'
      },
      CHAT_DOCUMENTS_COLLECTION
    );
    return Boolean(result);
  };
}

export async function indexChatDocumentVectors(params: {
  apiService: DocumentMemoryClient;
  documentId: string;
  sessionId: string;
  fileName: string;
  rawText: string;
}): Promise<{ chunkCount: number; indexed: boolean }> {
  const chunks = buildDocumentChunks(params.rawText);
  if (chunks.length === 0) return { chunkCount: 0, indexed: false };

  const result = await documentIndexingQueue.enqueue({
    documentId: params.documentId,
    fileName: params.fileName,
    chunks,
    storeChunk: buildStoreChunk(params)
  });

  if (!result.indexed) {
    devWarn('[documentVectorIndex] KGM 写入中断，embedding 可能未配置');
  }

  devLog(
    `[documentVectorIndex] ${params.fileName}: ${result.indexed ? 'indexed' : 'not indexed'} ${result.chunkCount} 块 → ${CHAT_DOCUMENTS_COLLECTION}`
  );
  return result;
}

export function queueChatDocumentVectorIndex(params: {
  apiService: DocumentMemoryClient;
  documentId: string;
  sessionId: string;
  fileName: string;
  rawText: string;
}): { jobId?: string; chunkCount: number } {
  const chunks = buildDocumentChunks(params.rawText);
  if (chunks.length === 0) return { chunkCount: 0 };

  const { jobId, promise } = documentIndexingQueue.enqueueWithHandle({
    documentId: params.documentId,
    fileName: params.fileName,
    chunks,
    storeChunk: buildStoreChunk(params),
    onUpdate: (job) => {
      updateChatDocument(params.documentId, {
        indexingStatus: job.status,
        indexedChunkCount: job.indexedChunks,
        indexError: job.error,
        indexed: job.status === 'completed',
        indexedAt: job.status === 'completed' ? new Date(job.updatedAt).toISOString() : undefined
      });
    }
  });

  void promise.then((result) => {
    if (!result.indexed) {
      devWarn('[documentVectorIndex] 后台 KGM 写入未完成，embedding 可能未配置');
    }
  });

  return { jobId, chunkCount: chunks.length };
}

export async function recallChatDocumentChunks(params: {
  apiService: DocumentMemorySearchClient;
  query: string;
  documentIds?: string[];
  topK?: number;
}): Promise<Array<{ content: string; metadata?: Record<string, unknown> }>> {
  const topK = params.topK ?? 10;
  const search = await params.apiService.kgmMemorySearch(
    params.query,
    CHAT_DOCUMENTS_COLLECTION,
    topK
  );
  const results = search?.results ?? [];
  const idSet = params.documentIds?.length ? new Set(params.documentIds) : null;

  return results
    .filter((r: { metadata?: { documentId?: string }; content?: string; text?: string }) => {
      if (!idSet) return true;
      const docId = r.metadata?.documentId;
      return docId && idSet.has(docId);
    })
    .map((r: { content?: string; text?: string; metadata?: Record<string, unknown> }) => ({
      content: String(r.content ?? r.text ?? ''),
      metadata: r.metadata
    }))
    .filter((r: { content: string }) => r.content.trim().length > 0);
}
