/**
 * TopicFilesStore
 * 项目主题（topics）下文件内容的 IndexedDB 存储。
 *
 * 背景：原先 `topic.files[i].content` 直接序列化进 localStorage，
 * 但 localStorage 单源 ~5MB 配额，附带几个文档就会触发 QuotaExceededError。
 *
 * 方案：
 *  - 文件元数据（name / size / addedAt）继续放在 localStorage 的 `yueli_topics` 里，
 *    用于 UI 列表与轻量序列化；
 *  - 文件正文（content）落到 IndexedDB（同源容量通常 50MB ~ 数 GB），
 *    通过 `${topicId}::${fileName}` 复合主键定位；
 *  - 需要使用文件内容时（构造 LLM messages、向量召回）
 *    先调用 `hydrateTopicFiles(topic)` 把 content 还原到 topic.files。
 */

const DB_NAME = 'yueli_topic_files_db';
const DB_VERSION = 1;
const STORE_NAME = 'topic_files';

export interface TopicFileMeta {
  name: string;
  size: number;
  addedAt: number;
  content?: string;
}

export interface TopicLike {
  id: string;
  files?: TopicFileMeta[];
  [key: string]: any;
}

interface StoredFileRecord {
  key: string;
  topicId: string;
  fileName: string;
  content: string;
  updatedAt: number;
}

function makeKey(topicId: string, fileName: string): string {
  return `${topicId}::${fileName}`;
}

class TopicFilesStore {
  private db: IDBDatabase | null = null;
  private opening: Promise<void> | null = null;

  private async open(): Promise<void> {
    if (this.db) return;
    if (this.opening) return this.opening;
    this.opening = new Promise<void>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
          store.createIndex('topicId', 'topicId', { unique: false });
        }
      };
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };
      request.onerror = () => {
        reject(request.error);
      };
    });
    try {
      await this.opening;
    } finally {
      this.opening = null;
    }
  }

  async saveFile(topicId: string, fileName: string, content: string): Promise<void> {
    if (!topicId || !fileName) return;
    await this.open();
    if (!this.db) return;
    const record: StoredFileRecord = {
      key: makeKey(topicId, fileName),
      topicId,
      fileName,
      content: typeof content === 'string' ? content : String(content ?? ''),
      updatedAt: Date.now()
    };
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async getFile(topicId: string, fileName: string): Promise<string | null> {
    if (!topicId || !fileName) return null;
    await this.open();
    if (!this.db) return null;
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([STORE_NAME], 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(makeKey(topicId, fileName));
      req.onsuccess = () => {
        const r = req.result as StoredFileRecord | undefined;
        resolve(r?.content ?? null);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async getFilesForTopic(topicId: string): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (!topicId) return map;
    await this.open();
    if (!this.db) return map;
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([STORE_NAME], 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('topicId');
      const req = index.openCursor(IDBKeyRange.only(topicId));
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          const r = cursor.value as StoredFileRecord;
          map.set(r.fileName, r.content);
          cursor.continue();
        } else {
          resolve(map);
        }
      };
      req.onerror = () => reject(req.error);
    });
  }

  async deleteFile(topicId: string, fileName: string): Promise<void> {
    if (!topicId || !fileName) return;
    await this.open();
    if (!this.db) return;
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(makeKey(topicId, fileName));
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async deleteTopic(topicId: string): Promise<void> {
    if (!topicId) return;
    await this.open();
    if (!this.db) return;
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction([STORE_NAME], 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('topicId');
      const req = index.openCursor(IDBKeyRange.only(topicId));
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          resolve();
        }
      };
      req.onerror = () => reject(req.error);
    });
  }

  /** 持久化一个主题下所有 files 的 content，调用方负责保证 topic.files 有 content。 */
  async persistTopicFiles(topic: TopicLike): Promise<void> {
    if (!topic?.id || !Array.isArray(topic.files)) return;
    for (const f of topic.files) {
      if (typeof f?.content === 'string' && f.content.length > 0) {
        await this.saveFile(topic.id, f.name, f.content).catch(() => {});
      }
    }
  }

  /** 给定主题，从 IDB 读取 files 内容并返回新对象（不修改入参）。 */
  async hydrateTopicFiles<T extends TopicLike>(topic: T): Promise<T> {
    if (!topic || !Array.isArray(topic.files) || topic.files.length === 0) {
      return topic;
    }
    const map = await this.getFilesForTopic(topic.id).catch(() => new Map<string, string>());
    const files = topic.files.map((f) => {
      if (f && typeof f === 'object' && typeof f.content === 'string' && f.content.length > 0) {
        return f;
      }
      const content = map.get(f.name);
      return content !== undefined ? { ...f, content } : f;
    });
    return { ...topic, files };
  }
}

/** 不带 content 的 files 投影，用于 localStorage 序列化 */
export function stripFileContent<T extends TopicLike>(topics: T[]): T[] {
  if (!Array.isArray(topics)) return topics;
  return topics.map((t) => {
    if (!t || !Array.isArray(t.files)) return t;
    const files = t.files.map((f) => {
      if (!f || typeof f !== 'object') return f;
      const { content: _omit, ...rest } = f as TopicFileMeta & Record<string, unknown>;
      return rest as TopicFileMeta;
    });
    return { ...t, files };
  });
}

export const topicFilesStore = new TopicFilesStore();

/**
 * 统一的项目主题持久化入口：
 * 1. 把每个主题里的 file.content 写入 IndexedDB；
 * 2. 把不含 content 的元数据版本写入 localStorage（避免 QuotaExceededError）。
 * 失败时通过 onError 回调通知调用方，由调用方决定是否 toast。
 */
export async function persistTopicsToStorage(
  updated: TopicLike[] | null | undefined,
  onError?: (err: unknown) => void
): Promise<void> {
  if (Array.isArray(updated)) {
    for (const t of updated) {
      try {
        await topicFilesStore.persistTopicFiles(t);
      } catch {
        // 单个 topic 持久化失败不阻断
      }
    }
  }
  try {
    const stripped = stripFileContent(updated || []);
    localStorage.setItem('yueli_topics', JSON.stringify(stripped));
  } catch (err) {
    if (onError) {
      onError(err);
    } else {
      console.error('persistTopicsToStorage failed:', err);
    }
  }
}
