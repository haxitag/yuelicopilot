/**
 * 将 localStorage 中已存的 yueli_session_messages 按 KGM 助手 Markdown 归一化规则批量清洗。
 * 与 finalizeKgmAssistantMarkdown / normalizeBotMessagesForDisplay 使用同一套逻辑。
 */

import type { Message } from '../../types';
import {
  finalizeKgmAssistantMarkdownIfNeeded,
  isBuiltinAssistantPlaceholder,
  normalizeBotMessagesForDisplay
} from './kgmAssistantContent';
import { devLog, devWarn } from '../../utils/devConsole';

export const SESSION_MESSAGES_STORAGE_KEY = 'yueli_session_messages';
/** 标记已完成 Markdown 归一化迁移（可 force 重跑） */
export const SESSION_MESSAGES_MIGRATION_FLAG_KEY = 'yueli_session_messages_markdown_v1';
/** v8：`--##` 无空格 ATX、行内表格、`###结论>` 等截图坏样本修复 */
export const SESSION_MESSAGES_MIGRATION_VERSION = 8;

export type SessionMessagesStore = Record<string, Message[]>;

export interface SessionMessagesMigrationResult {
  migrated: boolean;
  skippedReason?: 'already_migrated' | 'no_localStorage' | 'empty_store';
  sessionsTotal: number;
  sessionsTouched: number;
  messagesTotal: number;
  messagesUpdated: number;
  bytesBefore: number;
  bytesAfter: number;
}

function getLocalStorage(): Storage | null {
  try {
    const ls = globalThis.localStorage;
    return ls && typeof ls.getItem === 'function' ? ls : null;
  } catch {
    return null;
  }
}

function estimateJsonBytes(value: unknown): number {
  try {
    return new Blob([JSON.stringify(value)]).size;
  } catch {
    return JSON.stringify(value).length;
  }
}

function coerceMessageRow(raw: unknown): Message | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Partial<Message>;
  if (typeof m.id !== 'string' || typeof m.role !== 'string') return null;
  return {
    ...m,
    id: m.id,
    role: m.role,
    content: typeof m.content === 'string' ? m.content : String(m.content ?? ''),
    sender: typeof m.sender === 'string' ? m.sender : '',
    time: typeof m.time === 'string' ? m.time : '',
    isThinking: Boolean(m.isThinking)
  } as Message;
}

function normalizeMessageList(messages: unknown[]): Message[] {
  const rows: Message[] = [];
  for (const raw of messages) {
    const row = coerceMessageRow(raw);
    if (row) rows.push(row);
  }
  return normalizeBotMessagesForDisplay(rows);
}

function countContentChanges(before: Message[], after: Message[]): number {
  let n = 0;
  const len = Math.min(before.length, after.length);
  for (let i = 0; i < len; i++) {
    if (before[i]?.content !== after[i]?.content) n++;
  }
  return n;
}

/**
 * 纯函数：清洗整个 sessionId -> messages 映射（可用于单测 / 导入备份 JSON）。
 */
export function migrateSessionMessagesStore(
  store: SessionMessagesStore
): { store: SessionMessagesStore; result: Omit<SessionMessagesMigrationResult, 'migrated' | 'skippedReason'> } {
  const next: SessionMessagesStore = {};
  let sessionsTouched = 0;
  let messagesTotal = 0;
  let messagesUpdated = 0;

  for (const [sessionId, list] of Object.entries(store)) {
    if (!Array.isArray(list)) {
      next[sessionId] = list as unknown as Message[];
      continue;
    }
    messagesTotal += list.length;
    const before = list.map((m) => coerceMessageRow(m)).filter(Boolean) as Message[];
    const after = normalizeMessageList(list);
    const changed = countContentChanges(before, after);
    if (changed > 0) sessionsTouched++;
    messagesUpdated += changed;
    next[sessionId] = after;
  }

  const bytesBefore = estimateJsonBytes(store);
  const bytesAfter = estimateJsonBytes(next);

  return {
    store: next,
    result: {
      sessionsTotal: Object.keys(store).length,
      sessionsTouched,
      messagesTotal,
      messagesUpdated,
      bytesBefore,
      bytesAfter
    }
  };
}

function readStoreFromLocalStorage(): SessionMessagesStore | null {
  const ls = getLocalStorage();
  if (!ls) return null;
  try {
    const raw = ls.getItem(SESSION_MESSAGES_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as SessionMessagesStore;
  } catch {
    return null;
  }
}

function writeStoreToLocalStorage(store: SessionMessagesStore): void {
  getLocalStorage()?.setItem(SESSION_MESSAGES_STORAGE_KEY, JSON.stringify(store));
}

function readMigrationFlag(): number {
  const ls = getLocalStorage();
  if (!ls) return 0;
  try {
    return Number(ls.getItem(SESSION_MESSAGES_MIGRATION_FLAG_KEY) || 0);
  } catch {
    return 0;
  }
}

function writeMigrationFlag(): void {
  getLocalStorage()?.setItem(
    SESSION_MESSAGES_MIGRATION_FLAG_KEY,
    String(SESSION_MESSAGES_MIGRATION_VERSION)
  );
}

/**
 * 浏览器启动时调用：一次性清洗 yueli_session_messages 并写入迁移标记。
 * @param force 为 true 时忽略已迁移标记，强制重跑（控制台 debugYueli.migrateSessionMessages({ force: true })）
 */
export function migrateSessionMessagesInLocalStorage(options?: {
  force?: boolean;
}): SessionMessagesMigrationResult {
  const force = options?.force === true;

  if (!getLocalStorage()) {
    return {
      migrated: false,
      skippedReason: 'no_localStorage',
      sessionsTotal: 0,
      sessionsTouched: 0,
      messagesTotal: 0,
      messagesUpdated: 0,
      bytesBefore: 0,
      bytesAfter: 0
    };
  }

  if (!force && readMigrationFlag() >= SESSION_MESSAGES_MIGRATION_VERSION) {
    return {
      migrated: false,
      skippedReason: 'already_migrated',
      sessionsTotal: 0,
      sessionsTouched: 0,
      messagesTotal: 0,
      messagesUpdated: 0,
      bytesBefore: 0,
      bytesAfter: 0
    };
  }

  const store = readStoreFromLocalStorage();
  if (store === null) {
    return {
      migrated: false,
      skippedReason: 'no_localStorage',
      sessionsTotal: 0,
      sessionsTouched: 0,
      messagesTotal: 0,
      messagesUpdated: 0,
      bytesBefore: 0,
      bytesAfter: 0
    };
  }

  if (Object.keys(store).length === 0) {
    // 勿写迁移标记：否则用户首次打开空应用后产生的历史将永远不会被清洗
    return {
      migrated: false,
      skippedReason: 'empty_store',
      sessionsTotal: 0,
      sessionsTouched: 0,
      messagesTotal: 0,
      messagesUpdated: 0,
      bytesBefore: 0,
      bytesAfter: 0
    };
  }

  const { store: next, result } = migrateSessionMessagesStore(store);
  writeStoreToLocalStorage(next);
  writeMigrationFlag();

  devLog('[sessionMessagesMigration] 已完成 Markdown 清洗', {
    force,
    ...result
  });

  return { migrated: true, ...result };
}

/** 单条 bot 消息（导入/调试）：与落盘逻辑一致 */
export function migrateSingleAssistantContent(raw: unknown): string {
  return finalizeKgmAssistantMarkdownIfNeeded(raw);
}

/** 加载/URL 打开某会话后：归一化 bot 正文并写回 localStorage */
export function persistNormalizedSessionMessages(
  sessionId: string,
  messages: Message[]
): Message[] {
  const normalized = normalizeBotMessagesForDisplay(messages);
  const ls = getLocalStorage();
  if (!ls || !sessionId) return normalized;
  try {
    const raw = ls.getItem(SESSION_MESSAGES_STORAGE_KEY);
    const store = raw ? (JSON.parse(raw) as SessionMessagesStore) : {};
    store[sessionId] = normalized;
    ls.setItem(SESSION_MESSAGES_STORAGE_KEY, JSON.stringify(store));
  } catch (e) {
    devWarn('[sessionMessagesMigration] persistNormalizedSessionMessages failed', e);
  }
  return normalized;
}

export { isBuiltinAssistantPlaceholder };
