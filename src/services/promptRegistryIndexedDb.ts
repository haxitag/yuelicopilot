/**
 * PromptRegistry 的浏览器端持久化：使用 IndexedDB（本地嵌入式数据库），
 * 与 localStorage 相比容量更大、适合存全文 systemPrompt。
 */

import { devWarn } from '../utils/devConsole';

const DB_NAME = 'yueli_copilot';
const DB_VERSION = 1;
const STORE_NAME = 'prompt_registry';
/** 单条记录存整表 JSON，与 localStorage yueli_prompt_registry_v1 结构一致 */
const REGISTRY_KEY = 'prompt_registry_v1';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error('indexedDB.open failed'));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

export async function loadPromptRegistryFromIndexedDb(): Promise<string | null> {
  if (typeof indexedDB === 'undefined') {
    return null;
  }
  try {
    const db = await openDb();
    return await new Promise<string | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const g = store.get(REGISTRY_KEY);
      g.onerror = () => reject(g.error ?? new Error('IDB get failed'));
      g.onsuccess = () => {
        const v = g.result;
        resolve(typeof v === 'string' ? v : null);
      };
      tx.oncomplete = () => db.close();
      tx.onerror = () => {
        db.close();
        reject(tx.error ?? new Error('IDB tx failed'));
      };
    });
  } catch (e) {
    devWarn('[promptRegistryIndexedDb] 读取失败:', e);
    return null;
  }
}

export async function savePromptRegistryToIndexedDb(json: string): Promise<void> {
  if (typeof indexedDB === 'undefined') {
    return;
  }
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const p = store.put(json, REGISTRY_KEY);
    p.onerror = () => reject(p.error ?? new Error('IDB put failed'));
    p.onsuccess = () => resolve();
    tx.oncomplete = () => db.close();
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('IDB tx failed'));
    };
  });
}
