import { routeAndChunkText } from '../../utils/smartChunk';
import { devLog, devWarn } from '../../utils/devConsole';
import {
  resolveSkillExecutorAuthHeaders,
  resolveSkillExecutorBaseUrl
} from '../../utils/skillExecutorUrl';
import type { ChatDocumentRecord } from './types';

export type RagSearchHit = {
  documentId: string;
  chunkIndex: number;
  content: string;
  score: number;
  channel?: string;
};

function authHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...resolveSkillExecutorAuthHeaders()
  };
}

export async function persistChatDocumentToServer(params: {
  document: ChatDocumentRecord;
  rawText: string;
}): Promise<{ ok: boolean; backend?: string; chunkStrategy?: string }> {
  const { strategy, chunks: chunkTexts } = routeAndChunkText(params.rawText, {
    chunkSize: 900,
    overlap: 120
  });
  const chunks = chunkTexts.map((content, chunkIndex) => ({ chunkIndex, content }));

  const base = resolveSkillExecutorBaseUrl();
  const url = `${base}/v1/documents/ingest`;

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        id: params.document.id,
        sessionId: params.document.sessionId,
        fileName: params.document.fileName,
        charCount: params.document.charCount,
        chunkCount: chunks.length,
        indexed: params.document.indexed,
        rawTextPreview: params.rawText.slice(0, 8000),
        chunks,
        chunkStrategy: strategy
      })
    });
    if (!resp.ok) {
      devWarn('[documentServerStore] ingest HTTP', resp.status);
      return { ok: false };
    }
    const json = await resp.json();
    devLog('[documentServerStore] 已持久化', params.document.id, json?.backend, strategy);
    return { ok: true, backend: json?.backend, chunkStrategy: strategy };
  } catch (e) {
    devWarn('[documentServerStore] ingest 失败', e);
    return { ok: false };
  }
}

/** @deprecated 请用 fetchServerRagSearch（RRF + 查询重写） */
export async function fetchServerRagPreview(
  documentIds: string[],
  query: string,
  topK = 8
): Promise<RagSearchHit[]> {
  const out = await fetchServerRagSearch({
    documentIds,
    query,
    sessionId: 'legacy',
    topK,
    rewrite: false
  });
  return out.results;
}

export async function fetchServerRagSearch(params: {
  documentIds: string[];
  query: string;
  sessionId: string;
  userId?: string;
  topK?: number;
  rewrite?: boolean;
}): Promise<{
  results: RagSearchHit[];
  rewrite?: { rewritten?: string; keywords?: string[]; subQueries?: string[] } | null;
  mode?: string;
  /** 后端失败时为 true；与「无命中」区分 */
  degraded?: boolean;
  error?: string;
}> {
  const base = resolveSkillExecutorBaseUrl();
  try {
    const resp = await fetch(`${base}/v1/documents/rag-search`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        documentIds: params.documentIds,
        query: params.query,
        sessionId: params.sessionId,
        userId: params.userId ?? 'default',
        topK: params.topK ?? 8,
        rewrite: params.rewrite !== false
      })
    });
    if (!resp.ok) {
      let detail = `HTTP ${resp.status}`;
      try {
        const errBody = await resp.json();
        if (errBody?.error) detail = `${detail}: ${errBody.error}`;
      } catch {
        /* ignore */
      }
      devWarn('[fetchServerRagSearch] backend failed:', detail);
      return { results: [], rewrite: null, degraded: true, error: detail };
    }
    const json = await resp.json();
    return {
      results: json?.results ?? [],
      rewrite: json?.rewrite ?? null,
      mode: json?.mode
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    devWarn('[fetchServerRagSearch] network/error:', msg);
    return { results: [], rewrite: null, degraded: true, error: msg };
  }
}

export async function listSessionDocuments(
  sessionId: string
): Promise<Array<Record<string, unknown>>> {
  const base = resolveSkillExecutorBaseUrl();
  try {
    const resp = await fetch(`${base}/v1/documents/session/${encodeURIComponent(sessionId)}`, {
      headers: authHeaders()
    });
    if (!resp.ok) return [];
    const json = await resp.json();
    return json?.documents ?? [];
  } catch {
    return [];
  }
}

export async function deleteSessionDocument(documentId: string): Promise<boolean> {
  const base = resolveSkillExecutorBaseUrl();
  try {
    const resp = await fetch(`${base}/v1/documents/${encodeURIComponent(documentId)}`, {
      method: 'DELETE',
      headers: authHeaders()
    });
    if (!resp.ok) return false;
    const json = await resp.json();
    return Boolean(json?.success);
  } catch {
    return false;
  }
}

export async function appendSessionMemoryTurn(params: {
  sessionId: string;
  userId?: string;
  role: string;
  content: string;
}): Promise<void> {
  const base = resolveSkillExecutorBaseUrl();
  try {
    await fetch(`${base}/v1/session-memory/turn`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        sessionId: params.sessionId,
        userId: params.userId ?? 'default',
        role: params.role,
        content: params.content
      })
    });
  } catch {
    /* 非阻断 */
  }
}

export async function addLongTermMemory(params: {
  userId?: string;
  title: string;
  content: string;
  tags?: string;
}): Promise<{ ok: boolean; id?: string }> {
  const base = resolveSkillExecutorBaseUrl();
  try {
    const resp = await fetch(`${base}/v1/memories`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        userId: params.userId ?? 'default',
        title: params.title,
        content: params.content,
        tags: params.tags ?? ''
      })
    });
    if (!resp.ok) return { ok: false };
    const json = await resp.json();
    return { ok: true, id: json?.memory?.id };
  } catch {
    return { ok: false };
  }
}

export async function listLongTermMemories(userId = 'default'): Promise<
  Array<{ id: string; title: string; content: string; tags?: string }>
> {
  const base = resolveSkillExecutorBaseUrl();
  try {
    const resp = await fetch(
      `${base}/v1/memories?userId=${encodeURIComponent(userId)}`,
      { headers: authHeaders() }
    );
    if (!resp.ok) return [];
    const json = await resp.json();
    return json?.memories ?? [];
  } catch {
    return [];
  }
}
