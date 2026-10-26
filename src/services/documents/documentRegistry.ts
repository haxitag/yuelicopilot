import type { ChatDocumentRecord } from './types';

const STORAGE_KEY = 'yueli_chat_documents';

function readAll(): ChatDocumentRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(records: ChatDocumentRecord[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(-200)));
}

export function registerChatDocument(
  record: Omit<ChatDocumentRecord, 'createdAt'> & { createdAt?: string }
): ChatDocumentRecord {
  const full: ChatDocumentRecord = {
    ...record,
    createdAt: record.createdAt ?? new Date().toISOString()
  };
  const all = readAll().filter((d) => d.id !== full.id);
  all.push(full);
  writeAll(all);
  return full;
}

export function listDocumentsBySession(sessionId: string): ChatDocumentRecord[] {
  return readAll().filter((d) => d.sessionId === sessionId);
}

export function getChatDocument(documentId: string): ChatDocumentRecord | undefined {
  return readAll().find((d) => d.id === documentId);
}

export function updateChatDocument(
  documentId: string,
  patch: Partial<Omit<ChatDocumentRecord, 'id' | 'createdAt'>>
): ChatDocumentRecord | undefined {
  const all = readAll();
  const idx = all.findIndex((d) => d.id === documentId);
  if (idx < 0) return undefined;
  const next: ChatDocumentRecord = { ...all[idx], ...patch };
  all[idx] = next;
  writeAll(all);
  return next;
}
