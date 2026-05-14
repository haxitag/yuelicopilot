/**
 * Context Compressor - 上下文压缩系统
 * 基于Hermes-agent的上下文压缩设计
 * 核心功能：
 * 1. 消息历史压缩
 * 2. LLM summarization for cross-session recall
 * 3. 关键信息提取
 * 4. 会话上下文优化
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export interface CompressionOptions {
  maxTokens?: number;
  preserveSystem?: boolean;
  preserveLastN?: number;
  extractKeyInfo?: boolean;
  summarizeOld?: boolean;
}

export interface CompressionResult {
  originalMessages: Message[];
  compressedMessages: Message[];
  summary?: string;
  removedCount: number;
  compressionRatio: number;
  keyInfoExtracted: KeyInformation[];
}

export interface KeyInformation {
  type: 'fact' | 'preference' | 'task' | 'constraint' | 'context';
  content: string;
  sourceMessageId?: string;
  importance: 'high' | 'medium' | 'low';
  extractedAt: Date;
}

export interface CompressedSession {
  sessionId: string;
  originalMessageCount: number;
  compressedMessageCount: number;
  summary: string;
  keyInfo: KeyInformation[];
  createdAt: Date;
  lastAccessed: Date;
  accessCount: number;
}

interface ContextCompressorStore {
  sessions: CompressedSession[];
  keyInfoDatabase: KeyInformation[];
  compressionHistory: CompressionHistoryEntry[];
}

interface CompressionHistoryEntry {
  timestamp: Date;
  sessionId: string;
  originalCount: number;
  compressedCount: number;
  ratio: number;
  method: 'summarize' | 'prune' | 'merge' | 'hybrid';
}

class ContextCompressor {
  private static instance: ContextCompressor;
  private storePath: string;
  private store: ContextCompressorStore = {
    sessions: [],
    keyInfoDatabase: [],
    compressionHistory: []
  };
  private maxTokensDefault = 8000;
  private keyInfoRetentionDays = 30;

  private constructor() {
    this.storePath = path.join(__dirname, '../../../data/context_compressor.json');
    this.loadStore();
  }

  static getInstance(): ContextCompressor {
    if (!ContextCompressor.instance) {
      ContextCompressor.instance = new ContextCompressor();
    }
    return ContextCompressor.instance;
  }

  private async loadStore(): Promise<void> {
    try {
      const dir = path.dirname(this.storePath);
      await fs.mkdir(dir, { recursive: true });
      const data = await fs.readFile(this.storePath, 'utf-8');
      const parsed = JSON.parse(data);
      this.store = {
        sessions: (parsed.sessions || []).map((s: any) => ({
          ...s,
          createdAt: new Date(s.createdAt),
          lastAccessed: new Date(s.lastAccessed)
        })),
        keyInfoDatabase: (parsed.keyInfoDatabase || []).map((k: any) => ({
          ...k,
          extractedAt: new Date(k.extractedAt)
        })),
        compressionHistory: (parsed.compressionHistory || []).map((c: any) => ({
          ...c,
          timestamp: new Date(c.timestamp)
        }))
      };
    } catch {
      this.store = {
        sessions: [],
        keyInfoDatabase: [],
        compressionHistory: []
      };
    }
  }

  private async saveStore(): Promise<void> {
    try {
      const dir = path.dirname(this.storePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(this.storePath, JSON.stringify(this.store, null, 2));
    } catch (e) {
      console.error('[ContextCompressor] Failed to save store:', e);
    }
  }

  compress(
    messages: Message[],
    sessionId: string,
    options: CompressionOptions = {}
  ): CompressionResult {
    const maxTokens = options.maxTokens || this.maxTokensDefault;
    const preserveLastN = options.preserveLastN || 5;
    const extractKeyInfo = options.extractKeyInfo ?? true;

    if (messages.length <= preserveLastN) {
      return {
        originalMessages: messages,
        compressedMessages: messages,
        removedCount: 0,
        compressionRatio: 1,
        keyInfoExtracted: []
      };
    }

    const systemMessages = options.preserveSystem
      ? messages.filter(m => m.role === 'system')
      : [];
    const nonSystemMessages = messages.filter(m => m.role !== 'system');

    const lastMessages = nonSystemMessages.slice(-preserveLastN);
    const messagesToCompress = nonSystemMessages.slice(0, -preserveLastN);

    const keyInfo: KeyInformation[] = extractKeyInfo
      ? this.extractKeyInformation(messagesToCompress)
      : [];

    let summary = '';
    if (messagesToCompress.length > 0 && options.summarizeOld !== false) {
      summary = this.generateSummary(messagesToCompress);
    }

    const compressedMessages: Message[] = [
      ...systemMessages,
      ...(summary ? [{
        id: `summary_${Date.now()}`,
        role: 'system' as const,
        content: `[Previous conversation summary]\n${summary}`,
        timestamp: new Date(),
        metadata: { isSummary: true }
      }] : []),
      ...(keyInfo.length > 0 ? [{
        id: `keyinfo_${Date.now()}`,
        role: 'system' as const,
        content: `[Key information from conversation]\n${keyInfo.map(k => `- ${k.content}`).join('\n')}`,
        timestamp: new Date(),
        metadata: { isKeyInfo: true }
      }] : []),
      ...lastMessages
    ];

    this.saveCompressedSession(sessionId, messages, compressedMessages, summary, keyInfo);

    return {
      originalMessages: messages,
      compressedMessages,
      summary,
      removedCount: messages.length - compressedMessages.length,
      compressionRatio: compressedMessages.length / messages.length,
      keyInfoExtracted: keyInfo
    };
  }

  private extractKeyInformation(messages: Message[]): KeyInformation[] {
    const keyInfo: KeyInformation[] = [];

    for (const msg of messages) {
      const content = msg.content.toLowerCase();

      const preferencePatterns = [
        /(?:i prefer|i like|i hate|i want|i need|i don't like)\s+(.+)/gi,
        /(?:always|never|usually)\s+(.+)/gi
      ];
      for (const pattern of preferencePatterns) {
        let match;
        while ((match = pattern.exec(content)) !== null) {
          keyInfo.push({
            type: 'preference',
            content: match[0],
            sourceMessageId: msg.id,
            importance: 'medium',
            extractedAt: new Date()
          });
        }
      }

      const constraintPatterns = [
        /(?:must|should|have to|need to|don't|not allowed)\s+(.+)/gi,
        /(?:remember|keep in mind|note that)\s+(.+)/gi
      ];
      for (const pattern of constraintPatterns) {
        let match;
        while ((match = pattern.exec(content)) !== null) {
          keyInfo.push({
            type: 'constraint',
            content: match[0],
            sourceMessageId: msg.id,
            importance: 'high',
            extractedAt: new Date()
          });
        }
      }

      const factPatterns = [
        /(?:my name is|i am|i'm)\s+(.+)/gi,
        /(?:i work at|i live in|i'm from)\s+(.+)/gi
      ];
      for (const pattern of factPatterns) {
        let match;
        while ((match = pattern.exec(content)) !== null) {
          keyInfo.push({
            type: 'fact',
            content: match[0],
            sourceMessageId: msg.id,
            importance: 'medium',
            extractedAt: new Date()
          });
        }
      }

      const taskPatterns = [
        /(?:task|goal|objective):\s*(.+)/gi,
        /(?:finish|complete|do|create|build|make)\s+(.+?)(?:\.|$)/gi
      ];
      for (const pattern of taskPatterns) {
        let match;
        while ((match = pattern.exec(content)) !== null) {
          keyInfo.push({
            type: 'task',
            content: match[0],
            sourceMessageId: msg.id,
            importance: 'high',
            extractedAt: new Date()
          });
        }
      }
    }

    const seen = new Set<string>();
    return keyInfo.filter(info => {
      const key = info.content.toLowerCase().trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 20);
  }

  private generateSummary(messages: Message[]): string {
    if (messages.length === 0) return '';

    const userMessages = messages.filter(m => m.role === 'user');
    const assistantMessages = messages.filter(m => m.role === 'assistant');

    const topics: string[] = [];
    const tasks: string[] = [];

    for (const msg of userMessages) {
      const sentences = msg.content.split(/[.!?]+/).filter(s => s.trim());
      if (sentences.length > 0) {
        topics.push(sentences[0].trim().slice(0, 100));
      }
    }

    for (const msg of assistantMessages) {
      if (msg.content.includes('Created') || msg.content.includes('Generated')) {
        tasks.push(msg.content.slice(0, 150));
      }
    }

    let summary = `Conversation回顾 (${messages.length} messages):\n`;
    
    if (topics.length > 0) {
      summary += `\nTopics discussed:\n`;
      for (const topic of [...new Set(topics)].slice(0, 5)) {
        summary += `- ${topic}\n`;
      }
    }

    if (tasks.length > 0) {
      summary += `\nTasks completed:\n`;
      for (const task of [...new Set(tasks)].slice(0, 3)) {
        summary += `- ${task}\n`;
      }
    }

    const duration = messages.length > 1
      ? `~${Math.round((messages[messages.length - 1].timestamp.getTime() - messages[0].timestamp.getTime()) / 60000)} min`
      : 'brief';

    summary += `\nDuration: ${duration}`;

    return summary;
  }

  private async saveCompressedSession(
    sessionId: string,
    original: Message[],
    compressed: Message[],
    summary: string,
    keyInfo: KeyInformation[]
  ): Promise<void> {
    const existing = this.store.sessions.findIndex(s => s.sessionId === sessionId);
    
    const session: CompressedSession = {
      sessionId,
      originalMessageCount: original.length,
      compressedMessageCount: compressed.length,
      summary,
      keyInfo,
      createdAt: existing >= 0 ? this.store.sessions[existing].createdAt : new Date(),
      lastAccessed: new Date(),
      accessCount: existing >= 0 ? this.store.sessions[existing].accessCount + 1 : 1
    };

    if (existing >= 0) {
      this.store.sessions[existing] = session;
    } else {
      this.store.sessions.push(session);
    }

    for (const info of keyInfo) {
      const existingInfo = this.store.keyInfoDatabase.find(
        k => k.content === info.content && k.type === info.type
      );
      if (!existingInfo) {
        this.store.keyInfoDatabase.push(info);
      }
    }

    this.store.compressionHistory.push({
      timestamp: new Date(),
      sessionId,
      originalCount: original.length,
      compressedCount: compressed.length,
      ratio: compressed.length / original.length,
      method: summary ? 'summarize' : 'prune'
    });

    if (this.store.sessions.length > 100) {
      this.store.sessions = this.store.sessions.slice(-50);
    }
    if (this.store.keyInfoDatabase.length > 500) {
      this.store.keyInfoDatabase = this.store.keyInfoDatabase.slice(-300);
    }
    if (this.store.compressionHistory.length > 500) {
      this.store.compressionHistory = this.store.compressionHistory.slice(-200);
    }

    await this.saveStore();
  }

  getSession(sessionId: string): CompressedSession | undefined {
    const session = this.store.sessions.find(s => s.sessionId === sessionId);
    if (session) {
      session.lastAccessed = new Date();
      session.accessCount++;
      this.saveStore();
    }
    return session;
  }

  getAllSessions(): CompressedSession[] {
    return [...this.store.sessions];
  }

  getKeyInfo(options: {
    type?: KeyInformation['type'];
    minImportance?: 'high' | 'medium' | 'low';
    since?: Date;
  } = {}): KeyInformation[] {
    let result = [...this.store.keyInfoDatabase];

    if (options.type) {
      result = result.filter(k => k.type === options.type);
    }

    if (options.minImportance) {
      const levels = { high: 3, medium: 2, low: 1 };
      const minLevel = levels[options.minImportance];
      result = result.filter(k => levels[k.importance] >= minLevel);
    }

    if (options.since) {
      result = result.filter(k => k.extractedAt >= options.since!);
    }

    return result.sort((a, b) => {
      const levels = { high: 3, medium: 2, low: 1 };
      return levels[b.importance] - levels[a.importance];
    });
  }

  getContextForNewSession(userId?: string): {
    recentSummary?: string;
    activeTasks: KeyInformation[];
    userPreferences: KeyInformation[];
  } {
    const recentSessions = this.store.sessions
      .filter(s => s.accessCount > 1)
      .sort((a, b) => b.lastAccessed.getTime() - a.lastAccessed.getTime())
      .slice(0, 3);

    const recentSummary = recentSessions
      .map(s => `[${s.sessionId}]: ${s.summary}`)
      .join('\n\n');

    const activeTasks = this.getKeyInfo({ type: 'task', minImportance: 'high' });
    const userPreferences = this.getKeyInfo({ type: 'preference' });

    return {
      recentSummary: recentSummary || undefined,
      activeTasks: activeTasks.slice(0, 5),
      userPreferences: userPreferences.slice(0, 10)
    };
  }

  getStats(): {
    totalSessions: number;
    totalCompressions: number;
    avgCompressionRatio: number;
    keyInfoCount: number;
    mostAccessedSession?: string;
  } {
    const totalSessions = this.store.sessions.length;
    const totalCompressions = this.store.compressionHistory.length;
    const avgCompressionRatio = totalCompressions > 0
      ? this.store.compressionHistory.reduce((sum, c) => sum + c.ratio, 0) / totalCompressions
      : 1;
    const mostAccessedSession = totalSessions > 0
      ? this.store.sessions.reduce((max, s) => s.accessCount > max.accessCount ? s : max).sessionId
      : undefined;

    return {
      totalSessions,
      totalCompressions,
      avgCompressionRatio,
      keyInfoCount: this.store.keyInfoDatabase.length,
      mostAccessedSession
    };
  }
}

export const contextCompressor = ContextCompressor.getInstance();