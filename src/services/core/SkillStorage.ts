import type { InstalledSkillData } from './SkillManifestSchema';
import type { PreflightResult } from './preflightTypes';

export class SkillStorage {
  private dbName = 'yueli_skills_db';
  private readonly dbVersion = 2;
  private storeName = 'skills';
  private preflightStoreName = 'preflight';
  private db: IDBDatabase | null = null;

  async open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const oldVersion = event.oldVersion;

        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'id' });
        }

        if (oldVersion < 2 && !db.objectStoreNames.contains(this.preflightStoreName)) {
          db.createObjectStore(this.preflightStoreName, { keyPath: 'id' });
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
  }

  async save(skillId: string, data: InstalledSkillData): Promise<void> {
    if (!this.db) await this.open();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.put({ id: skillId, ...data });

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async get(skillId: string): Promise<InstalledSkillData | null> {
    if (!this.db) await this.open();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(skillId);

      request.onsuccess = () => {
        const result = request.result;
        resolve(result || null);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getAll(): Promise<InstalledSkillData[]> {
    if (!this.db) await this.open();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.getAll();

      request.onsuccess = () => {
        resolve(request.result || []);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async delete(skillId: string): Promise<void> {
    if (!this.db) await this.open();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.delete(skillId);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async savePreflight(skillId: string, result: PreflightResult): Promise<void> {
    if (!this.db) await this.open();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.preflightStoreName], 'readwrite');
      const store = transaction.objectStore(this.preflightStoreName);
      const row = {
        id: skillId,
        ok: result.ok,
        checks: result.checks,
        cachedAt: result.cachedAt,
        manifestHash: result.manifestHash,
        executorBaseUrl: result.executorBaseUrl
      };
      const request = store.put(row);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getPreflight(skillId: string): Promise<PreflightResult | null> {
    if (!this.db) await this.open();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.preflightStoreName], 'readonly');
      const store = transaction.objectStore(this.preflightStoreName);
      const request = store.get(skillId);

      request.onsuccess = () => {
        const row = request.result as
          | {
              id: string;
              ok: boolean;
              checks: PreflightResult['checks'];
              cachedAt: number;
              manifestHash?: string;
              executorBaseUrl?: string;
            }
          | undefined;
        if (!row) {
          resolve(null);
          return;
        }
        resolve({
          ok: row.ok,
          checks: row.checks,
          cachedAt: row.cachedAt,
          manifestHash: row.manifestHash,
          executorBaseUrl: row.executorBaseUrl
        });
      };
      request.onerror = () => reject(request.error);
    });
  }

  async deletePreflight(skillId: string): Promise<void> {
    if (!this.db) await this.open();

    return new Promise((resolve, reject) => {
      try {
        if (!this.db!.objectStoreNames.contains(this.preflightStoreName)) {
          resolve();
          return;
        }
      } catch {
        resolve();
        return;
      }

      const transaction = this.db!.transaction([this.preflightStoreName], 'readwrite');
      const store = transaction.objectStore(this.preflightStoreName);
      const request = store.delete(skillId);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
}
