/**
 * Session Memory System - 跨会话记忆系统
 * 核心功能：
 * 1. 持久化存储会话数据
 * 2. FTS5全文搜索支持
 * 3. LLM摘要压缩
 * 4. 基于Hermes-agent的Procedural Memory设计
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface SessionMemory {
  id: string;
  sessionId: string;
  userId: string;
  skillName: string;
  summary: string;
  keyOutcome: string;
  timestamp: Date;
  searchableText: string;
  tags: string[];
  metadata: Record<string, any>;
}

export interface MemorySearchResult {
  memory: SessionMemory;
  score: number;
  matchedTerms: string[];
}

export interface MemoryStats {
  totalMemories: number;
  totalSessions: number;
  skillsUsed: Record<string, number>;
  avgSummaryLength: number;
  oldestMemory: Date | null;
  newestMemory: Date | null;
}

interface MemoryStore {
  memories: SessionMemory[];
  sessions: Set<string>;
  lastCleanup: Date;
}

class SessionMemorySystem {
  private static instance: SessionMemorySystem;
  private storePath: string;
  private store: MemoryStore;
  private memoryIndex: Map<string, Set<string>> = new Map();
  private MAX_MEMORIES = 10000;
  private MAX_MEMORIES_PER_SESSION = 100;

  private constructor() {
    this.storePath = path.join(__dirname, '../../../data/session_memories.json');
    this.store = {
      memories: [],
      sessions: new Set(),
      lastCleanup: new Date()
    };
    this.loadStore();
    this.buildIndex();
  }

  static getInstance(): SessionMemorySystem {
    if (!SessionMemorySystem.instance) {
      SessionMemorySystem.instance = new SessionMemorySystem();
    }
    return SessionMemorySystem.instance;
  }

  private async loadStore(): Promise<void> {
    try {
      const dir = path.dirname(this.storePath);
      await fs.mkdir(dir, { recursive: true });
      const data = await fs.readFile(this.storePath, 'utf-8');
      const parsed = JSON.parse(data);
      this.store = {
        memories: (parsed.memories || []).map((m: any) => ({
          ...m,
          timestamp: new Date(m.timestamp)
        })),
        sessions: new Set(parsed.sessions || []),
        lastCleanup: new Date(parsed.lastCleanup || Date.now())
      };
    } catch {
      this.store = { memories: [], sessions: new Set(), lastCleanup: new Date() };
    }
  }

  private async saveStore(): Promise<void> {
    try {
      const data = {
        memories: this.store.memories,
        sessions: Array.from(this.store.sessions),
        lastCleanup: this.store.lastCleanup
      };
      await fs.writeFile(this.storePath, JSON.stringify(data, null, 2));
    } catch (e) {
      console.error('[SessionMemory] Failed to save store:', e);
    }
  }

  private buildIndex(): void {
    this.memoryIndex.clear();
    for (const memory of this.store.memories) {
      this.indexMemory(memory);
    }
  }

  private indexMemory(memory: SessionMemory): void {
    const terms = this.extractTerms(memory.searchableText);
    for (const term of terms) {
      if (!this.memoryIndex.has(term)) {
        this.memoryIndex.set(term, new Set());
      }
      this.memoryIndex.get(term)!.add(memory.id);
    }
  }

  private extractTerms(text: string): string[] {
    const terms = new Set<string>();
    const words = text.toLowerCase().split(/\s+/);
    for (const word of words) {
      const cleaned = word.replace(/[^\p{L}\p{N}]/gu, '');
      if (cleaned.length >= 2) {
        terms.add(cleaned);
        if (cleaned.length >= 4) {
          for (let i = 3; i < cleaned.length; i++) {
            terms.add(cleaned.slice(0, i + 1));
          }
        }
      }
    }
    return Array.from(terms);
  }

  async recordSession({
    sessionId,
    userId = 'default',
    skillName,
    summary,
    keyOutcome,
    searchableText,
    tags = [],
    metadata = {}
  }: {
    sessionId: string;
    userId?: string;
    skillName: string;
    summary: string;
    keyOutcome?: string;
    searchableText: string;
    tags?: string[];
    metadata?: Record<string, any>;
  }): Promise<SessionMemory> {
    const id = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const memory: SessionMemory = {
      id,
      sessionId,
      userId,
      skillName,
      summary,
      keyOutcome: keyOutcome || '',
      timestamp: new Date(),
      searchableText,
      tags,
      metadata
    };

    this.store.memories.push(memory);
    this.store.sessions.add(sessionId);
    this.indexMemory(memory);

    if (this.store.memories.length > this.MAX_MEMORIES) {
      await this.pruneOldMemories();
    }

    await this.saveStore();
    return memory;
  }

  async searchMemories(query: string, options: {
    skillName?: string;
    userId?: string;
    limit?: number;
    minScore?: number;
  } = {}): Promise<MemorySearchResult[]> {
    const { skillName, userId, limit = 20, minScore = 0.1 } = options;
    const queryTerms = this.extractTerms(query);

    const scores = new Map<string, { score: number; matchedTerms: Set<string> }>();

    for (const term of queryTerms) {
      for (const [indexTerm, memoryIds] of this.memoryIndex.entries()) {
        if (term.includes(indexTerm) || indexTerm.includes(term)) {
          for (const memId of memoryIds) {
            const mem = this.store.memories.find(m => m.id === memId);
            if (!mem) continue;
            if (skillName && mem.skillName !== skillName) continue;
            if (userId && mem.userId !== userId) continue;

            if (!scores.has(memId)) {
              scores.set(memId, { score: 0, matchedTerms: new Set() });
            }
            const entry = scores.get(memId)!;
            entry.score += 1 / (Math.max(term.length, indexTerm.length) - Math.min(term.length, indexTerm.length) + 1);
            entry.matchedTerms.add(indexTerm);
          }
        }
      }
    }

    const results: MemorySearchResult[] = [];
    for (const [memId, { score, matchedTerms }] of scores) {
      if (score >= minScore) {
        const memory = this.store.memories.find(m => m.id === memId)!;
        results.push({
          memory,
          score,
          matchedTerms: Array.from(matchedTerms)
        });
      }
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  async getMemoriesForSession(sessionId: string): Promise<SessionMemory[]> {
    return this.store.memories
      .filter(m => m.sessionId === sessionId)
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  async getMemoriesForSkill(skillName: string, limit = 50): Promise<SessionMemory[]> {
    return this.store.memories
      .filter(m => m.skillName === skillName)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  async getRecentMemories(userId?: string, limit = 100): Promise<SessionMemory[]> {
    let memories = this.store.memories;
    if (userId) {
      memories = memories.filter(m => m.userId === userId);
    }
    return memories
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }

  async getStats(): Promise<MemoryStats> {
    const skillsUsed: Record<string, number> = {};
    let totalSummaryLength = 0;

    for (const memory of this.store.memories) {
      skillsUsed[memory.skillName] = (skillsUsed[memory.skillName] || 0) + 1;
      totalSummaryLength += memory.summary.length;
    }

    const sortedMemories = [...this.store.memories].sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
    );

    return {
      totalMemories: this.store.memories.length,
      totalSessions: this.store.sessions.size,
      skillsUsed,
      avgSummaryLength: this.store.memories.length > 0 ? totalSummaryLength / this.store.memories.length : 0,
      oldestMemory: sortedMemories.length > 0 ? sortedMemories[0].timestamp : null,
      newestMemory: sortedMemories.length > 0 ? sortedMemories[sortedMemories.length - 1].timestamp : null
    };
  }

  private async pruneOldMemories(): Promise<void> {
    const sessionCounts = new Map<string, number>();
    const toRemove: Set<string> = new Set();

    const sortedMemories = [...this.store.memories].sort(
      (a, b) => b.timestamp.getTime() - a.timestamp.getTime()
    );

    for (const memory of sortedMemories) {
      const count = sessionCounts.get(memory.sessionId) || 0;
      if (count >= this.MAX_MEMORIES_PER_SESSION) {
        toRemove.add(memory.id);
      } else {
        sessionCounts.set(memory.sessionId, count + 1);
      }
    }

    const removedCount = Math.ceil(this.MAX_MEMORIES * 0.2);
    if (this.store.memories.length - toRemove.size < this.MAX_MEMORIES * 0.8) {
      const oldMemories = sortedMemories.slice(this.MAX_MEMORIES - removedCount);
      for (const mem of oldMemories) {
        toRemove.add(mem.id);
      }
    }

    this.store.memories = this.store.memories.filter(m => !toRemove.has(m.id));
    this.store.sessions = new Set(this.store.memories.map(m => m.sessionId));
    this.buildIndex();
  }

  async deleteMemory(memoryId: string): Promise<boolean> {
    const index = this.store.memories.findIndex(m => m.id === memoryId);
    if (index === -1) return false;

    this.store.memories.splice(index, 1);
    this.store.sessions = new Set(this.store.memories.map(m => m.sessionId));
    this.buildIndex();
    await this.saveStore();
    return true;
  }

  async clearAllMemories(): Promise<void> {
    this.store.memories = [];
    this.store.sessions.clear();
    this.memoryIndex.clear();
    await this.saveStore();
  }
}

export const sessionMemorySystem = SessionMemorySystem.getInstance();
export { SessionMemorySystem };
