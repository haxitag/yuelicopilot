import type { Message, ThinkingRecord, ToolCallRecord } from '../../types';

export type StreamSource = { name: string; type: string; url?: string };

export type ToolExecutingEvent = { id?: string; name: string; args: any };
export type ToolResultEvent = { id?: string; name: string; result: string };
export type ToolErrorEvent = { id?: string; name: string; error: string };

export type StreamEvent =
  | { kind: 'tool_executing'; payload: ToolExecutingEvent }
  | { kind: 'tool_result'; payload: ToolResultEvent }
  | { kind: 'tool_error'; payload: ToolErrorEvent }
  | { kind: 'message_delta'; payload: { content?: string; thinking?: string; reasoning_content?: string } }
  | { kind: 'sources'; payload: StreamSource[] }
  | { kind: 'error'; payload: { message?: string; code?: string } };

export interface StreamReducerState {
  accumulatedContent: string;
  thinkingContent: string;
  reasoningContent: string;
  sources: StreamSource[];
  toolCallRecords: ToolCallRecord[];
  thinkingRecords: ThinkingRecord[];
}

export interface ReduceResult {
  state: StreamReducerState;
  /** Patch to merge into current bot message */
  patch: Partial<Message>;
}

function sourceKey(s: StreamSource): string {
  return `${s.type}::${s.name}::${s.url || ''}`;
}

function dedupeSources(existing: StreamSource[], incoming: StreamSource[]): StreamSource[] {
  const seen = new Set(existing.map(sourceKey));
  const next = [...existing];
  for (const s of incoming) {
    const key = sourceKey(s);
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(s);
  }
  return next;
}

function findToolRecordIndex(records: ToolCallRecord[], id?: string, name?: string): number {
  if (id) {
    const idx = records.findIndex((r) => r.id === id);
    if (idx >= 0) return idx;
  }
  if (name) {
    // fallback: last matching name
    for (let i = records.length - 1; i >= 0; i--) {
      if (records[i]?.name === name) return i;
    }
  }
  return -1;
}

export function normalizeRawStreamEvent(data: any): StreamEvent | null {
  if (data?.tool_call_executing) return { kind: 'tool_executing', payload: data.tool_call_executing };
  if (data?.tool_call_result) return { kind: 'tool_result', payload: data.tool_call_result };
  if (data?.tool_call_error) return { kind: 'tool_error', payload: data.tool_call_error };
  if (Array.isArray(data?.sources) && data.sources.length > 0) return { kind: 'sources', payload: data.sources };
  if (data?.error) return { kind: 'error', payload: data.error };
  if (data?.message) {
    const m = data.message;
    return {
      kind: 'message_delta',
      payload: {
        content: m.content,
        thinking: m.thinking,
        reasoning_content: m.reasoning_content
      }
    };
  }
  return null;
}

/**
 * Reduce one incoming stream chunk into stable message fields.
 * Note: we deliberately do NOT inject thinking/tool markdown into `content`;
 * those are rendered by dedicated UI blocks.
 */
export function reduceStreamEvent(prev: StreamReducerState, event: StreamEvent, nowMs = Date.now()): ReduceResult {
  const state: StreamReducerState = {
    accumulatedContent: prev.accumulatedContent,
    thinkingContent: prev.thinkingContent,
    reasoningContent: prev.reasoningContent,
    sources: prev.sources,
    toolCallRecords: prev.toolCallRecords,
    thinkingRecords: prev.thinkingRecords
  };

  switch (event.kind) {
    case 'tool_executing': {
      const { id, name, args } = event.payload;
      const record: ToolCallRecord = {
        id,
        name,
        args,
        type: 'tool',
        status: 'running',
        startedAt: nowMs
      };
      state.toolCallRecords = [...state.toolCallRecords, record];
      return { state, patch: { toolCallRecords: state.toolCallRecords, finalStatus: 'in_progress' } };
    }
    case 'tool_result': {
      const { id, name, result } = event.payload;
      const next = [...state.toolCallRecords];
      const idx = findToolRecordIndex(next, id, name);
      if (idx >= 0) {
        const startedAt = next[idx].startedAt;
        next[idx] = {
          ...next[idx],
          result,
          error: undefined,
          status: 'success',
          durationMs: typeof startedAt === 'number' ? Math.max(0, nowMs - startedAt) : undefined
        };
      } else {
        next.push({ id, name, args: {}, result, type: 'tool', status: 'success' });
      }
      state.toolCallRecords = next;
      return { state, patch: { toolCallRecords: state.toolCallRecords } };
    }
    case 'tool_error': {
      const { id, name, error } = event.payload;
      const next = [...state.toolCallRecords];
      const idx = findToolRecordIndex(next, id, name);
      if (idx >= 0) {
        const startedAt = next[idx].startedAt;
        next[idx] = {
          ...next[idx],
          error,
          status: 'error',
          durationMs: typeof startedAt === 'number' ? Math.max(0, nowMs - startedAt) : undefined
        };
      } else {
        next.push({ id, name, args: {}, error, type: 'tool', status: 'error' });
      }
      state.toolCallRecords = next;
      return { state, patch: { toolCallRecords: state.toolCallRecords } };
    }
    case 'message_delta': {
      const { content, thinking, reasoning_content } = event.payload;
      if (typeof content === 'string' && content.length > 0) {
        state.accumulatedContent += content;
      }
      if (typeof thinking === 'string' && thinking.length > 0) {
        // keep the latest full thinking snapshot (providers often stream as prefix growth)
        if (!state.thinkingContent || thinking.startsWith(state.thinkingContent)) {
          state.thinkingContent = thinking;
        } else if (!state.thinkingContent.startsWith(thinking)) {
          state.thinkingContent += thinking;
        }
        state.thinkingRecords = [...state.thinkingRecords, { content: state.thinkingContent, timestamp: nowMs }];
      }
      if (typeof reasoning_content === 'string' && reasoning_content.length > 0) {
        if (!state.reasoningContent || reasoning_content.startsWith(state.reasoningContent)) {
          state.reasoningContent = reasoning_content;
        } else if (!state.reasoningContent.startsWith(reasoning_content)) {
          state.reasoningContent += reasoning_content;
        }
      }

      return {
        state,
        patch: {
          content: state.accumulatedContent,
          reasoningContent: state.reasoningContent || undefined,
          thinkingRecords: state.thinkingRecords.length > 0 ? state.thinkingRecords : undefined,
          finalStatus: 'in_progress'
        }
      };
    }
    case 'sources': {
      state.sources = dedupeSources(state.sources, event.payload);
      return { state, patch: { sources: state.sources.length ? state.sources : undefined } };
    }
    case 'error': {
      const msg = event.payload?.message || event.payload?.code || 'unknown error';
      state.accumulatedContent = `${state.accumulatedContent}\n\n❌ 错误: ${msg}`;
      return { state, patch: { content: state.accumulatedContent, finalStatus: 'error' } };
    }
  }
}

export function createInitialStreamReducerState(): StreamReducerState {
  return {
    accumulatedContent: '',
    thinkingContent: '',
    reasoningContent: '',
    sources: [],
    toolCallRecords: [],
    thinkingRecords: []
  };
}

