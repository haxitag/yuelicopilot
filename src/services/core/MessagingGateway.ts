/**
 * Messaging Gateway System - 消息网关系统
 * 基于Hermes-agent的Messaging Gateway设计
 * 核心功能：
 * 1. 多平台消息统一接入（Telegram, Discord, Slack, WhatsApp, Signal）
 * 2. 消息格式标准化
 * 3. 跨会话上下文连续性
 * 4. 消息路由与分发
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { EventEmitter } from 'events';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type Platform = 'telegram' | 'discord' | 'slack' | 'whatsapp' | 'signal' | 'cli';

export interface PlatformConfig {
  id: string;
  platform: Platform;
  name: string;
  enabled: boolean;
  settings: Record<string, any>;
  credentials?: Record<string, string>;
  webhookUrl?: string;
  botToken?: string;
  createdAt: Date;
  lastActive?: Date;
}

export interface Message {
  id: string;
  platform: Platform;
  platformMessageId: string;
  sessionId: string;
  userId: string;
  userName?: string;
  content: string;
  timestamp: Date;
  metadata?: Record<string, any>;
  attachments?: MessageAttachment[];
}

export interface MessageAttachment {
  type: 'text' | 'image' | 'audio' | 'video' | 'file';
  url?: string;
  content?: string;
  name?: string;
  size?: number;
}

export interface Session {
  id: string;
  platform: Platform;
  platformChatId: string;
  userId: string;
  userName?: string;
  createdAt: Date;
  lastMessageAt: Date;
  messageCount: number;
  metadata?: Record<string, any>;
}

export interface GatewayStats {
  totalPlatforms: number;
  activePlatforms: number;
  totalSessions: number;
  totalMessages: number;
  messagesPerPlatform: Record<Platform, number>;
}

interface GatewayStore {
  platforms: PlatformConfig[];
  sessions: Session[];
  messages: Message[];
  lastCleanup: Date;
}

class MessagingGateway extends EventEmitter {
  private static instance: MessagingGateway;
  private storePath: string;
  private store: GatewayStore = {
    platforms: [],
    sessions: [],
    messages: [],
    lastCleanup: new Date()
  };
  private platformHandlers: Map<Platform, any> = new Map();
  private maxMessagesPerSession = 1000;

  private constructor() {
    super();
    this.storePath = path.join(__dirname, '../../../data/messaging_gateway.json');
    this.loadStore();
  }

  static getInstance(): MessagingGateway {
    if (!MessagingGateway.instance) {
      MessagingGateway.instance = new MessagingGateway();
    }
    return MessagingGateway.instance;
  }

  private async loadStore(): Promise<void> {
    try {
      const dir = path.dirname(this.storePath);
      await fs.mkdir(dir, { recursive: true });
      const data = await fs.readFile(this.storePath, 'utf-8');
      const parsed = JSON.parse(data);
      this.store = {
        platforms: (parsed.platforms || []).map((p: any) => ({
          ...p,
          createdAt: new Date(p.createdAt),
          lastActive: p.lastActive ? new Date(p.lastActive) : undefined
        })),
        sessions: (parsed.sessions || []).map((s: any) => ({
          ...s,
          createdAt: new Date(s.createdAt),
          lastMessageAt: new Date(s.lastMessageAt)
        })),
        messages: (parsed.messages || []).map((m: any) => ({
          ...m,
          timestamp: new Date(m.timestamp)
        })),
        lastCleanup: new Date(parsed.lastCleanup || Date.now())
      };
    } catch {
      this.store = {
        platforms: [],
        sessions: [],
        messages: [],
        lastCleanup: new Date()
      };
    }
  }

  private async saveStore(): Promise<void> {
    try {
      const dir = path.dirname(this.storePath);
      await fs.mkdir(dir, { recursive: true });
      this.store.lastCleanup = new Date();
      await fs.writeFile(this.storePath, JSON.stringify(this.store, null, 2));
    } catch (e) {
      console.error('[MessagingGateway] Failed to save store:', e);
    }
  }

  async configurePlatform(config: {
    platform: Platform;
    name: string;
    settings: Record<string, any>;
    credentials?: Record<string, string>;
    webhookUrl?: string;
    botToken?: string;
  }): Promise<PlatformConfig> {
    const platformConfig: PlatformConfig = {
      id: `platform_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      platform: config.platform,
      name: config.name,
      enabled: true,
      settings: config.settings,
      credentials: config.credentials,
      webhookUrl: config.webhookUrl,
      botToken: config.botToken,
      createdAt: new Date()
    };

    const existing = this.store.platforms.findIndex(p => p.platform === config.platform);
    if (existing >= 0) {
      this.store.platforms[existing] = platformConfig;
    } else {
      this.store.platforms.push(platformConfig);
    }

    await this.saveStore();
    this.emit('platform:configured', platformConfig);

    return platformConfig;
  }

  async removePlatform(platformId: string): Promise<boolean> {
    const index = this.store.platforms.findIndex(p => p.id === platformId);
    if (index >= 0) {
      this.store.platforms.splice(index, 1);
      this.platformHandlers.delete(this.store.platforms[index].platform);
      await this.saveStore();
      return true;
    }
    return false;
  }

  async togglePlatform(platformId: string): Promise<boolean> {
    const platform = this.store.platforms.find(p => p.id === platformId);
    if (!platform) return false;

    platform.enabled = !platform.enabled;
    await this.saveStore();
    this.emit('platform:toggled', platform);

    return true;
  }

  getPlatforms(): PlatformConfig[] {
    return [...this.store.platforms];
  }

  getPlatform(platform: Platform): PlatformConfig | undefined {
    return this.store.platforms.find(p => p.platform === platform && p.enabled);
  }

  async receiveMessage(
    platform: Platform,
    platformMessageId: string,
    userId: string,
    userName: string | undefined,
    content: string,
    metadata?: Record<string, any>,
    attachments?: MessageAttachment[]
  ): Promise<Message> {
    const sessionId = this.getOrCreateSession(platform, userId, userName);

    const message: Message = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      platform,
      platformMessageId,
      sessionId,
      userId,
      userName,
      content,
      timestamp: new Date(),
      metadata,
      attachments
    };

    this.store.messages.push(message);

    const session = this.store.sessions.find(s => s.id === sessionId);
    if (session) {
      session.lastMessageAt = new Date();
      session.messageCount++;
    }

    if (this.store.messages.length > 10000) {
      this.store.messages = this.store.messages.slice(-5000);
    }

    await this.saveStore();
    this.emit('message:received', message);

    return message;
  }

  private getOrCreateSession(
    platform: Platform,
    userId: string,
    userName?: string
  ): string {
    let session = this.store.sessions.find(
      s => s.platform === platform && s.userId === userId
    );

    if (!session) {
      session = {
        id: `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        platform,
        platformChatId: `${platform}:${userId}`,
        userId,
        userName,
        createdAt: new Date(),
        lastMessageAt: new Date(),
        messageCount: 0
      };
      this.store.sessions.push(session);
    }

    return session.id;
  }

  getSession(sessionId: string): Session | undefined {
    return this.store.sessions.find(s => s.id === sessionId);
  }

  getSessionsByUser(userId: string): Session[] {
    return this.store.sessions.filter(s => s.userId === userId);
  }

  getSessionMessages(sessionId: string, limit = 50): Message[] {
    return this.store.messages
      .filter(m => m.sessionId === sessionId)
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
      .slice(-limit);
  }

  async sendMessage(
    platform: Platform,
    userId: string,
    content: string,
    options?: {
      attachments?: MessageAttachment[];
      replyTo?: string;
      metadata?: Record<string, any>;
    }
  ): Promise<boolean> {
    const platformConfig = this.getPlatform(platform);
    if (!platformConfig) {
      console.error(`[MessagingGateway] Platform ${platform} not configured`);
      return false;
    }

    this.emit('message:send', {
      platform,
      userId,
      content,
      options
    });

    return true;
  }

  broadcastToUser(userId: string, content: string): Promise<number> {
    let sent = 0;

    for (const session of this.store.sessions) {
      if (session.userId === userId) {
        this.sendMessage(session.platform, session.userId, content).then(() => {
          sent++;
        });
      }
    }

    return Promise.resolve(sent);
  }

  getCrossPlatformSessions(userId: string): Session[] {
    return this.store.sessions.filter(s => s.userId === userId);
  }

  mergeSessionContext(userId: string, recentMessages = 10): {
    platform: Platform;
    messages: Message[];
  }[] {
    const userSessions = this.getCrossPlatformSessions(userId);

    return userSessions.map(session => ({
      platform: session.platform,
      messages: this.getSessionMessages(session.id, recentMessages)
    }));
  }

  async cleanupSessions(olderThanDays = 30): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);

    const toRemove = this.store.sessions.filter(
      s => s.lastMessageAt < cutoff
    );

    for (const session of toRemove) {
      this.store.messages = this.store.messages.filter(
        m => m.sessionId !== session.id
      );
    }

    this.store.sessions = this.store.sessions.filter(
      s => s.lastMessageAt >= cutoff
    );

    await this.saveStore();
    return toRemove.length;
  }

  getStats(): GatewayStats {
    const activePlatforms = this.store.platforms.filter(p => p.enabled);

    const messagesPerPlatform: Record<Platform, number> = {
      telegram: 0,
      discord: 0,
      slack: 0,
      whatsapp: 0,
      signal: 0,
      cli: 0
    };

    for (const msg of this.store.messages) {
      messagesPerPlatform[msg.platform]++;
    }

    return {
      totalPlatforms: this.store.platforms.length,
      activePlatforms: activePlatforms.length,
      totalSessions: this.store.sessions.length,
      totalMessages: this.store.messages.length,
      messagesPerPlatform
    };
  }

  formatMessageForPlatform(platform: Platform, content: string): string {
    switch (platform) {
      case 'discord':
        return content.slice(0, 2000);
      case 'slack':
        return content.slice(0, 30000);
      case 'telegram':
        return content.slice(0, 4096);
      default:
        return content;
    }
  }
}

export const messagingGateway = MessagingGateway.getInstance();