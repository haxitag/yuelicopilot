/**
 * KGM POST /v1/kgm/memory 与 /v1/kgm/memory/search 请求/响应适配。
 * KGM 当前契约：{ userId, text, source } / { userId, query, topK } → { evidence[] }
 */

export const DEFAULT_KGM_MEMORY_USER_ID = 'default';

export type KgmMemoryStoreBody = {
  userId: string;
  text: string;
  source: string;
};

export type KgmMemorySearchBody = {
  userId: string;
  query: string;
  topK: number;
};

export type KgmMemoryHit = {
  content: string;
  text: string;
  score?: number;
  metadata?: Record<string, unknown>;
};

export function buildKgmMemoryStoreBody(
  content: string,
  metadata?: Record<string, unknown>,
  collection?: string
): KgmMemoryStoreBody {
  const userId = (collection || DEFAULT_KGM_MEMORY_USER_ID).trim() || DEFAULT_KGM_MEMORY_USER_ID;
  let source = 'yuelicopilot';
  if (metadata && Object.keys(metadata).length > 0) {
    try {
      source = JSON.stringify({ ...metadata, _yc: 1 });
    } catch {
      source = String(metadata.sourceType ?? metadata.name ?? 'yuelicopilot');
    }
  }
  if (source.length > 4000) {
    source = source.slice(0, 4000);
  }
  return {
    userId,
    text: String(content ?? ''),
    source
  };
}

export function buildKgmMemorySearchBody(
  query: string,
  collection?: string,
  topK = 5
): KgmMemorySearchBody {
  return {
    userId: (collection || DEFAULT_KGM_MEMORY_USER_ID).trim() || DEFAULT_KGM_MEMORY_USER_ID,
    query: String(query ?? ''),
    topK: Math.max(1, Math.min(topK, 50))
  };
}

export function parseKgmMemorySourceMetadata(source: unknown): Record<string, unknown> | undefined {
  if (typeof source !== 'string' || !source.trim()) return undefined;
  if (!source.startsWith('{')) return { source };
  try {
    const parsed = JSON.parse(source) as Record<string, unknown>;
    if (parsed && typeof parsed === 'object') {
      const { _yc, ...rest } = parsed;
      return rest;
    }
  } catch {
    return { source };
  }
  return undefined;
}

/** 将 KGM `{ evidence }` 或旧式 `{ results }` 统一为 Copilot 使用的 results 列表 */
export function normalizeKgmMemorySearchResponse(data: unknown): { results: KgmMemoryHit[] } {
  const raw = data as { evidence?: unknown[]; results?: unknown[] } | null | undefined;
  const rows = Array.isArray(raw?.evidence)
    ? raw.evidence
    : Array.isArray(raw?.results)
      ? raw.results
      : [];

  const results: KgmMemoryHit[] = rows.map((row) => {
    const r = row as {
      text?: string;
      content?: string;
      score?: number;
      source?: string;
      metadata?: Record<string, unknown>;
    };
    const text = String(r.text ?? r.content ?? '');
    const metadata =
      r.metadata && typeof r.metadata === 'object'
        ? r.metadata
        : parseKgmMemorySourceMetadata(r.source);
    return {
      content: text,
      text,
      score: r.score,
      metadata
    };
  });

  return { results };
}
