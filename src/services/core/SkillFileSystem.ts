/**
 * 技能文件系统存储
 * 使用 File System Access API 实现文件级技能存储
 * 同时与 IndexedDB 保持同步用于向量召回
 */

import type { RepositoryInfo } from '../../types';
import { SkillManifest } from './SkillInstaller';

export interface SkillFileData {
  manifest: SkillManifest;
  files: Record<string, string>;
  installedAt: Date;
  repository?: Pick<RepositoryInfo, 'type' | 'url' | 'ref'>;
}

export interface SkillFileSystemConfig {
  rootDirectoryHandle?: FileSystemDirectoryHandle;
  rootPath?: string;
}

const STORAGE_KEY_SKILLS_DIR_HANDLE = 'yueli_skills_dir_handle';

export class SkillFileSystem {
  private rootHandle: FileSystemDirectoryHandle | null = null;
  private db: IDBDatabase | null = null;
  private dbName = 'yueli_skills_vector_db';
  private storeName = 'skill_vectors';

  async initialize(): Promise<void> {
    await this.openDB();
    await this.loadStoredHandle();
  }

  private async openDB(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          const store = db.createObjectStore(this.storeName, { keyPath: 'skillId' });
          store.createIndex('category', 'category', { unique: false });
        }
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onerror = () => reject(request.error);
    });
  }

  private async loadStoredHandle(): Promise<void> {
    try {
      const serializedHandle = localStorage.getItem(STORAGE_KEY_SKILLS_DIR_HANDLE);
      if (serializedHandle) {
        const handle = await (window as any).structuredClone(JSON.parse(serializedHandle));
        const permission = await handle.queryPermission({ mode: 'readwrite' });
        if (permission === 'granted') {
          this.rootHandle = handle;
        }
      }
    } catch (error) {
      console.warn('Failed to restore skills directory handle:', error);
    }
  }

  async selectSkillsDirectory(): Promise<boolean> {
    if (typeof window === 'undefined' || !('showDirectoryPicker' in window)) {
      console.warn('File System Access API not supported');
      return false;
    }

    try {
      const handle = await (window as any).showDirectoryPicker({
        mode: 'readwrite',
        startIn: 'documents'
      });

      this.rootHandle = handle;

      const serialized = JSON.stringify(await (window as any).structuredClone(handle));
      localStorage.setItem(STORAGE_KEY_SKILLS_DIR_HANDLE, serialized);

      await this.ensureSkillsDirectoryStructure();
      return true;
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        console.error('Failed to select skills directory:', error);
      }
      return false;
    }
  }

  private async ensureSkillsDirectoryStructure(): Promise<void> {
    if (!this.rootHandle) return;

    try {
      await this.rootHandle.getDirectoryHandle('skills', { create: true });
    } catch (error) {
      console.error('Failed to create skills directory structure:', error);
    }
  }

  hasDirectoryAccess(): boolean {
    return this.rootHandle !== null;
  }

  async getSkillsRootHandle(): Promise<FileSystemDirectoryHandle | null> {
    if (!this.rootHandle) {
      await this.loadStoredHandle();
    }
    return this.rootHandle;
  }

  async saveSkill(skillId: string, data: SkillFileData): Promise<void> {
    if (!this.rootHandle) {
      throw new Error('Skills directory not selected. Please select a skills directory first.');
    }

    await this.writeToFileSystem(skillId, data);
    await this.writeToIndexedDB(skillId, data);
  }

  private async writeToFileSystem(skillId: string, data: SkillFileData): Promise<void> {
    if (!this.rootHandle) return;

    const skillDir = await this.rootHandle.getDirectoryHandle(skillId, { create: true });

    const manifestFile = await skillDir.getFileHandle('manifest.json', { create: true });
    const writable = await manifestFile.createWritable();
    await writable.write(JSON.stringify(data.manifest, null, 2));
    await writable.close();

    if (data.files) {
      const actionsDir = await skillDir.getDirectoryHandle('actions', { create: true });
      const promptsDir = await skillDir.getDirectoryHandle('prompts', { create: true });

      for (const [filePath, content] of Object.entries(data.files)) {
        const normalizedPath = this.normalizeFilePath(filePath);

        if (normalizedPath.startsWith('actions/')) {
          const fileName = normalizedPath.replace('actions/', '');
          const fileHandle = await actionsDir.getFileHandle(fileName, { create: true });
          const writer = await fileHandle.createWritable();
          await writer.write(content);
          await writer.close();
        } else if (normalizedPath.startsWith('prompts/')) {
          const fileName = normalizedPath.replace('prompts/', '');
          const fileHandle = await promptsDir.getFileHandle(fileName, { create: true });
          const writer = await fileHandle.createWritable();
          await writer.write(content);
          await writer.close();
        } else {
          const fileHandle = await skillDir.getFileHandle(normalizedPath, { create: true });
          const writer = await fileHandle.createWritable();
          await writer.write(content);
          await writer.close();
        }
      }
    }
  }

  private normalizeFilePath(path: string): string {
    if (path.startsWith('./')) {
      return path.slice(2);
    }
    return path;
  }

  private async writeToIndexedDB(skillId: string, data: SkillFileData): Promise<void> {
    if (!this.db) await this.openDB();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);

      const vectorData = {
        skillId,
        category: data.manifest.category || 'other',
        tags: data.manifest.tags || [],
        description: data.manifest.description,
        installedAt: data.installedAt,
        manifest: data.manifest,
        repository: data.repository
      };

      const request = store.put(vectorData);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getSkill(skillId: string): Promise<SkillFileData | null> {
    if (!this.db) await this.openDB();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.get(skillId);

      request.onsuccess = () => {
        const result = request.result;
        if (result) {
          resolve({
            manifest: result.manifest,
            files: {},
            installedAt: result.installedAt,
            repository: result.repository
          });
        } else {
          resolve(null);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getAllSkills(): Promise<Array<{ skillId: string; manifest: SkillManifest; category: string }>> {
    if (!this.db) await this.openDB();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readonly');
      const store = transaction.objectStore(this.storeName);
      const request = store.getAll();

      request.onsuccess = () => {
        const results = request.result.map((item: any) => ({
          skillId: item.skillId,
          manifest: item.manifest,
          category: item.category
        }));
        resolve(results);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async deleteSkill(skillId: string): Promise<void> {
    if (this.rootHandle) {
      try {
        await this.rootHandle.removeEntry(skillId, { recursive: true });
      } catch (error) {
        console.warn(`Failed to delete skill directory ${skillId}:`, error);
      }
    }

    if (!this.db) await this.openDB();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([this.storeName], 'readwrite');
      const store = transaction.objectStore(this.storeName);
      const request = store.delete(skillId);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async listSkillsFromFileSystem(): Promise<string[]> {
    if (!this.rootHandle) {
      return [];
    }

    try {
      const skillsDir = await this.rootHandle.getDirectoryHandle('skills');
      const skillIds: string[] = [];

      const entries = (skillsDir as any).entries();
      for await (const entry of entries) {
        if (entry[1].kind === 'directory') {
          skillIds.push(entry[0]);
        }
      }

      return skillIds;
    } catch (error) {
      console.warn('Failed to list skills from filesystem:', error);
      return [];
    }
  }

  async readSkillManifestFromFileSystem(skillId: string): Promise<SkillManifest | null> {
    if (!this.rootHandle) {
      return null;
    }

    try {
      const skillDir = await this.rootHandle.getDirectoryHandle(skillId);
      const manifestFile = await skillDir.getFileHandle('manifest.json');
      const file = await manifestFile.getFile();
      const content = await file.text();
      return JSON.parse(content);
    } catch (error) {
      console.warn(`Failed to read manifest for skill ${skillId}:`, error);
      return null;
    }
  }
}

let fileSystemInstance: SkillFileSystem | null = null;

export function getSkillFileSystem(): SkillFileSystem {
  if (!fileSystemInstance) {
    fileSystemInstance = new SkillFileSystem();
  }
  return fileSystemInstance;
}
