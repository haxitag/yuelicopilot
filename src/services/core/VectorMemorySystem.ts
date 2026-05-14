/**
 * Vector Memory System - 向量记忆系统
 * 基于Hermes-agent的Memory设计
 * 支持语义搜索和相似度匹配
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface VectorMemory {
  id: string;
  content: string;
  embedding: number[];
  metadata: VectorMetadata;
}

export interface VectorMetadataInput {
  source: 'skill' | 'chat' | 'task' | 'user';
  skillName?: string;
  sessionId?: string;
  userId?: string;
  tags: string[];
}

export interface VectorMetadata extends VectorMetadataInput {
  createdAt: Date;
}

export interface VectorSearchResult {
  memory: VectorMemory;
  similarity: number;
  rank: number;
}

export interface VectorSearchOptions {
  limit?: number;
  threshold?: number;
  filter?: {
    source?: VectorMemory['metadata']['source'];
    skillName?: string;
    sessionId?: string;
    userId?: string;
    tags?: string[];
  };
}

interface VectorStore {
  memories: VectorMemory[];
  lastUpdated: Date;
}

class VectorMemorySystem {
  private static instance: VectorMemorySystem;
  private storePath: string;
  private store: VectorStore = { memories: [], lastUpdated: new Date() };
  private embeddingCache: Map<string, number[]> = new Map();

  private constructor() {
    this.storePath = path.join(__dirname, '../../../data/vector_memories.json');
    this.loadStore();
  }

  static getInstance(): VectorMemorySystem {
    if (!VectorMemorySystem.instance) {
      VectorMemorySystem.instance = new VectorMemorySystem();
    }
    return VectorMemorySystem.instance;
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
          metadata: {
            ...m.metadata,
            createdAt: new Date(m.metadata.createdAt)
          }
        })),
        lastUpdated: new Date(parsed.lastUpdated || Date.now())
      };
    } catch {
      this.store = { memories: [], lastUpdated: new Date() };
    }
  }

  private async saveStore(): Promise<void> {
    try {
      const dir = path.dirname(this.storePath);
      await fs.mkdir(dir, { recursive: true });
      this.store.lastUpdated = new Date();
      await fs.writeFile(this.storePath, JSON.stringify(this.store, null, 2));
    } catch (e) {
      console.error('[VectorMemorySystem] Failed to save store:', e);
    }
  }

  private generateSimpleEmbedding(text: string): number[] {
    const words = text.toLowerCase().split(/\s+/);
    const vocabSize = 256;
    const embedding = new Array(vocabSize).fill(0);
    
    for (const word of words) {
      let hash = 0;
      for (let i = 0; i < word.length; i++) {
        hash = ((hash << 5) - hash) + word.charCodeAt(i);
        hash = hash & hash;
      }
      const index = Math.abs(hash) % vocabSize;
      embedding[index] += 1;
    }
    
    const magnitude = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    if (magnitude > 0) {
      for (let i = 0; i < embedding.length; i++) {
        embedding[i] /= magnitude;
      }
    }
    
    return embedding;
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    
    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }

  async addMemory(
    content: string,
    metadataInput: VectorMetadataInput
  ): Promise<VectorMemory> {
    const id = `vmem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const embedding = this.generateSimpleEmbedding(content);
    
    const memory: VectorMemory = {
      id,
      content,
      embedding,
      metadata: {
        ...metadataInput,
        createdAt: new Date()
      }
    };
    
    this.store.memories.push(memory);
    await this.saveStore();
    
    return memory;
  }

  async search(
    query: string,
    options: VectorSearchOptions = {}
  ): Promise<VectorSearchResult[]> {
    const queryEmbedding = this.generateSimpleEmbedding(query);
    const limit = options.limit || 10;
    const threshold = options.threshold || 0.1;
    
    let candidates = this.store.memories;
    
    if (options.filter) {
      candidates = candidates.filter(memory => {
        if (options.filter!.source && memory.metadata.source !== options.filter!.source) {
          return false;
        }
        if (options.filter!.skillName && memory.metadata.skillName !== options.filter!.skillName) {
          return false;
        }
        if (options.filter!.sessionId && memory.metadata.sessionId !== options.filter!.sessionId) {
          return false;
        }
        if (options.filter!.userId && memory.metadata.userId !== options.filter!.userId) {
          return false;
        }
        if (options.filter!.tags && options.filter!.tags.length > 0) {
          const hasMatchingTag = options.filter!.tags.some(tag => 
            memory.metadata.tags.includes(tag)
          );
          if (!hasMatchingTag) return false;
        }
        return true;
      });
    }
    
    const results: VectorSearchResult[] = candidates.map(memory => ({
      memory,
      similarity: this.cosineSimilarity(queryEmbedding, memory.embedding),
      rank: 0
    }));
    
    results.sort((a, b) => b.similarity - a.similarity);
    
    const filtered = results
      .filter(r => r.similarity >= threshold)
      .slice(0, limit)
      .map((r, index) => ({ ...r, rank: index + 1 }));
    
    return filtered;
  }

  async semanticSearch(
    query: string,
    options: VectorSearchOptions = {}
  ): Promise<VectorSearchResult[]> {
    return this.search(query, options);
  }

  async addSkillMemory(
    skillName: string,
    content: string,
    userId?: string,
    sessionId?: string
  ): Promise<VectorMemory> {
    return this.addMemory(content, {
      source: 'skill',
      skillName,
      userId,
      sessionId,
      tags: [skillName, 'skill', 'procedure']
    });
  }

  async addChatMemory(
    content: string,
    userId: string,
    sessionId: string,
    tags: string[] = []
  ): Promise<VectorMemory> {
    return this.addMemory(content, {
      source: 'chat',
      userId,
      sessionId,
      tags: ['chat', 'conversation', ...tags]
    });
  }

  async addTaskMemory(
    content: string,
    taskId: string,
    outcome: 'success' | 'failure',
    userId?: string
  ): Promise<VectorMemory> {
    return this.addMemory(content, {
      source: 'task',
      userId,
      tags: ['task', 'task-result', outcome, `task:${taskId}`]
    });
  }

  async getMemoriesBySkill(skillName: string, limit = 20): Promise<VectorMemory[]> {
    const results = await this.search('', {
      limit,
      filter: { skillName }
    });
    return results.map(r => r.memory);
  }

  async getMemoriesBySession(sessionId: string): Promise<VectorMemory[]> {
    return this.store.memories
      .filter(m => m.metadata.sessionId === sessionId)
      .sort((a, b) => 
        new Date(b.metadata.createdAt).getTime() - new Date(a.metadata.createdAt).getTime()
      );
  }

  async deleteMemory(id: string): Promise<boolean> {
    const index = this.store.memories.findIndex(m => m.id === id);
    if (index >= 0) {
      this.store.memories.splice(index, 1);
      await this.saveStore();
      return true;
    }
    return false;
  }

  async getStats(): Promise<{
    totalMemories: number;
    bySource: Record<string, number>;
    bySkill: Record<string, number>;
    avgSimilarity: number;
  }> {
    const bySource: Record<string, number> = {};
    const bySkill: Record<string, number> = {};
    let totalSimilarity = 0;
    
    for (const memory of this.store.memories) {
      bySource[memory.metadata.source] = (bySource[memory.metadata.source] || 0) + 1;
      if (memory.metadata.skillName) {
        bySkill[memory.metadata.skillName] = (bySkill[memory.metadata.skillName] || 0) + 1;
      }
    }
    
    if (this.store.memories.length > 1) {
      for (let i = 0; i < Math.min(this.store.memories.length, 100); i++) {
        const a = this.store.memories[i].embedding;
        const b = this.store.memories[(i + 1) % this.store.memories.length].embedding;
        totalSimilarity += this.cosineSimilarity(a, b);
      }
      totalSimilarity /= Math.min(this.store.memories.length, 100);
    }
    
    return {
      totalMemories: this.store.memories.length,
      bySource,
      bySkill,
      avgSimilarity: totalSimilarity
    };
  }

  async clear(olderThan?: Date): Promise<number> {
    let initialCount = this.store.memories.length;
    
    if (olderThan) {
      this.store.memories = this.store.memories.filter(
        m => new Date(m.metadata.createdAt) > olderThan
      );
    } else {
      this.store.memories = [];
    }
    
    await this.saveStore();
    return initialCount - this.store.memories.length;
  }
}

export const vectorMemorySystem = VectorMemorySystem.getInstance();