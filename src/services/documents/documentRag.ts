import type defaultApiService from '../../api/services/apiService';
import { recallChatDocumentChunks } from './documentVectorIndex';
import {
  fetchServerRagSearch,
  type RagSearchHit
} from './documentServerStore';
import { reciprocalRankFusion, deduplicateRagHits } from '../../utils/ragFusion';

type SearchClient = Pick<typeof defaultApiService, 'kgmMemorySearch'>;

export type HybridRagHit = {
  content: string;
  documentId?: string;
  chunkIndex?: number;
  score?: number;
  channel?: string;
  metadata?: Record<string, unknown>;
};

/**
 * 混合 RAG：KGM 向量 + Executor BM25/向量 RRF + 可选长期记忆（对标 xiaoyan）
 */
export async function hybridDocumentRetrieve(params: {
  documentIds: string[];
  query: string;
  sessionId: string;
  userId?: string;
  apiService: SearchClient;
  topK?: number;
}): Promise<{
  hits: HybridRagHit[];
  rewrite?: { rewritten?: string; keywords?: string[] } | null;
}> {
  const topK = params.topK ?? 8;
  const userId = params.userId ?? 'default';

  const [serverOut, kgmRows] = await Promise.all([
    fetchServerRagSearch({
      documentIds: params.documentIds,
      query: params.query,
      sessionId: params.sessionId,
      userId,
      topK: topK * 2,
      rewrite: true
    }),
    recallChatDocumentChunks({
      apiService: params.apiService,
      query: params.query,
      documentIds: params.documentIds,
      topK: topK * 2
    })
  ]);
  if (serverOut.degraded) {
    // 与「无命中」区分：调用方可观测；此处仍用 KGM 通道继续融合
    console.warn('[hybridDocumentRetrieve] server rag-search degraded:', serverOut.error);
  }

  const kgmHits: RagSearchHit[] = kgmRows.map((r, i) => {
    const meta = r.metadata as { documentId?: string; chunkIndex?: number; fileName?: string };
    return {
      documentId: meta?.documentId ?? `kgm-${i}`,
      chunkIndex: meta?.chunkIndex ?? i,
      content: r.content,
      score: 0.5,
      channel: 'kgm_vector' as const
    };
  });

  const fused = reciprocalRankFusion(
    [serverOut.results, kgmHits],
    topK * 2
  );
  const hits = deduplicateRagHits(fused, 0.85).slice(0, topK);

  return {
    hits: hits.map((h) => ({
      content: h.content,
      documentId: h.documentId,
      chunkIndex: h.chunkIndex,
      score: h.score,
      channel: h.channel
    })),
    rewrite: serverOut.rewrite
  };
}

const MAX_RAG_CHUNK_CHARS = 2000;

export function formatRagHitsForPrompt(hits: HybridRagHit[], userNote: string): string {
  if (!hits.length) {
    return '（向量、BM25 与 RRF 融合均未召回片段；请确认文档已入库且 embedding 可用。）';
  }
  const body = hits
    .map((h, i) => {
      const label =
        h.channel === 'long_memory'
          ? `memory#${i + 1}`
          : `${h.documentId ?? 'doc'}#${h.chunkIndex ?? i} [${h.channel ?? 'rrf'}]`;
      let text = h.content.trim();
      if (text.length > MAX_RAG_CHUNK_CHARS) {
        text = `${text.slice(0, MAX_RAG_CHUNK_CHARS)}\n[片段已截断]`;
      }
      return `#### [${label}]\n${text}`;
    })
    .join('\n\n');
  return `针对「${userNote}」混合检索（RRF）召回：\n\n${body}`;
}
