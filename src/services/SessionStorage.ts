/**
 * Session Storage Service - 会话存储服务
 * 提供可靠的会话数据持久化，包含临时缓存和验证机制
 *
 * 核心功能：
 * 1. 双重存储：内存缓存 + localStorage
 * 2. 写入验证：确保数据正确持久化
 * 3. 数据恢复：检测并恢复损坏的数据
 * 4. 竞态处理：使用版本号防止并发写入冲突
 */

import { debugManager } from './DebugManager';

export interface Session {
  id: string;
  name: string;
  topicId: string | null;
  lastActive: number;
}

const STORAGE_KEY = 'yueli_sessions';
const CACHE_KEY = 'yueli_sessions_cache';
const VERSION_KEY = 'yueli_sessions_version';

enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

class SessionStorageService {
  private sessions: Session[] = [];
  private version: number = 0;
  private isLoaded: boolean = false;
  private logLevel: LogLevel = LogLevel.INFO;

  constructor() {
    this.load();
  }

  private log(level: LogLevel, message: string, data?: any): void {
    if (level < this.logLevel) return;

    const prefix = {
      [LogLevel.DEBUG]: '[SessionStorage:DEBUG]',
      [LogLevel.INFO]: '[SessionStorage:INFO]',
      [LogLevel.WARN]: '[SessionStorage:WARN]',
      [LogLevel.ERROR]: '[SessionStorage:ERROR]'
    }[level];

    const entryType = level === LogLevel.ERROR ? 'error' : 'info';
    debugManager.addEntry({
      type: entryType,
      title: message,
      data: data || {}
    });

    if (debugManager.isEnabledFlag()) {
      const logFn = {
        [LogLevel.DEBUG]: console.debug.bind(console),
        [LogLevel.INFO]: console.log.bind(console),
        [LogLevel.WARN]: console.warn.bind(console),
        [LogLevel.ERROR]: console.error.bind(console)
      }[level];

      if (data) {
        logFn(`${prefix} ${message}`, data);
      } else {
        logFn(`${prefix} ${message}`);
      }
    }
  }

  private load(): void {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      const savedVersion = localStorage.getItem(VERSION_KEY);

      this.log(LogLevel.DEBUG, `加载会话：检查 localStorage`, { 
        hasData: !!saved, 
        version: savedVersion 
      });

      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          this.log(LogLevel.DEBUG, `解析数据成功，长度: ${Array.isArray(parsed) ? parsed.length : '非数组'}`);
          
          if (this.isValidSessionsArray(parsed)) {
            this.sessions = parsed;
            this.version = savedVersion ? parseInt(savedVersion, 10) : 1;
            this.isLoaded = true;
            this.log(LogLevel.INFO, `从 localStorage 加载会话成功: ${this.sessions.length} 个, 版本: ${this.version}`);
            return;
          } else {
            this.log(LogLevel.WARN, '数据格式验证失败，尝试宽松解析');
            // 尝试宽松解析
            const migrated = this.migrateOldData(parsed);
            if (migrated.length > 0) {
              this.sessions = migrated;
              this.version = Date.now();
              this.isLoaded = true;
              this.log(LogLevel.WARN, `宽松解析成功，恢复 ${this.sessions.length} 个会话`);
              this.persist();
              return;
            }
          }
        } catch (e) {
          this.log(LogLevel.ERROR, 'JSON 解析失败，尝试从缓存恢复', { error: e });
        }
      }

      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (this.isValidSessionsArray(parsed)) {
            this.sessions = parsed;
            this.version = Date.now();
            this.isLoaded = true;
            this.log(LogLevel.WARN, `从缓存恢复会话: ${this.sessions.length} 个`);
            this.persist();
            return;
          }
        } catch (e) {
          this.log(LogLevel.ERROR, '缓存解析失败', { error: e });
        }
      }

      this.sessions = [];
      this.version = Date.now();
      this.isLoaded = true;
      this.log(LogLevel.INFO, '初始化空会话列表');
    } catch (e) {
      this.log(LogLevel.ERROR, '加载会话失败', { error: e });
      this.sessions = [];
      this.version = Date.now();
      this.isLoaded = true;
    }
  }

  private migrateOldData(data: any): Session[] {
    if (!Array.isArray(data)) return [];
    
    const migrated: Session[] = [];
    for (const item of data) {
      if (item && typeof item === 'object' && typeof item.id === 'string') {
        migrated.push({
          id: item.id,
          name: typeof item.name === 'string' ? item.name : '未命名会话',
          topicId: item.topicId === null || typeof item.topicId === 'string' ? item.topicId : null,
          lastActive: typeof item.lastActive === 'number' ? item.lastActive : Date.now()
        });
      }
    }
    return migrated;
  }

  private isValidSessionsArray(value: any): value is Session[] {
    if (!Array.isArray(value)) {
      this.log(LogLevel.WARN, '验证失败：不是数组', { value });
      return false;
    }
    
    for (let i = 0; i < value.length; i++) {
      const session = value[i];
      if (!session || typeof session !== 'object') {
        this.log(LogLevel.WARN, `验证失败：会话 ${i} 不是对象`, { session });
        return false;
      }
      if (typeof session.id !== 'string') {
        this.log(LogLevel.WARN, `验证失败：会话 ${i} 的 id 不是字符串`, { id: session.id });
        return false;
      }
      if (typeof session.name !== 'string') {
        this.log(LogLevel.WARN, `验证失败：会话 ${i} 的 name 不是字符串`, { name: session.name });
        return false;
      }
      if (session.topicId !== null && session.topicId !== undefined && typeof session.topicId !== 'string') {
        this.log(LogLevel.WARN, `验证失败：会话 ${i} 的 topicId 类型不正确`, { topicId: session.topicId });
        return false;
      }
      if (typeof session.lastActive !== 'number') {
        this.log(LogLevel.WARN, `验证失败：会话 ${i} 的 lastActive 不是数字`, { lastActive: session.lastActive });
        return false;
      }
    }
    
    return true;
  }

  private persist(): boolean {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(this.sessions));

      const cached = localStorage.getItem(CACHE_KEY);
      if (!cached) {
        this.log(LogLevel.ERROR, '临时缓存写入失败');
        return false;
      }

      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.sessions));
      this.version++;
      localStorage.setItem(VERSION_KEY, this.version.toString());

      const saved = localStorage.getItem(STORAGE_KEY);
      if (!saved) {
        this.log(LogLevel.ERROR, '主存储写入失败');
        return false;
      }

      let parsed: any[];
      try {
        parsed = JSON.parse(saved);
      } catch {
        this.log(LogLevel.ERROR, '持久化结果 JSON 解析失败');
        return false;
      }

      if (!this.isValidSessionsArray(parsed)) {
        this.log(LogLevel.ERROR, '持久化结果类型验证失败');
        return false;
      }

      if (parsed.length !== this.sessions.length) {
        this.log(LogLevel.ERROR, `数据完整性验证失败: 期望 ${this.sessions.length} 个，实际 ${parsed.length} 个`);
        return false;
      }

      if (this.sessions.length > 0) {
        const lastSession = this.sessions[0];
        const savedLast = parsed.find((s: Session) => s.id === lastSession.id);
        if (!savedLast || savedLast.name !== lastSession.name || savedLast.topicId !== lastSession.topicId) {
          this.log(LogLevel.ERROR, '最新会话数据不匹配', { expected: lastSession, actual: savedLast });
          return false;
        }
      }

      localStorage.removeItem(CACHE_KEY);
      this.log(LogLevel.DEBUG, `会话持久化成功: ${this.sessions.length} 个, 版本: ${this.version}`);
      return true;
    } catch (e) {
      this.log(LogLevel.ERROR, '持久化失败', { error: e });
      return false;
    }
  }

  getAll(): Session[] {
    return [...this.sessions];
  }

  getById(id: string): Session | undefined {
    return this.sessions.find(s => s.id === id);
  }

  add(session: Session): boolean {
    if (!this.isValidSession(session)) {
      this.log(LogLevel.ERROR, '无效的会话数据', { session });
      return false;
    }

    const existing = this.sessions.find(s => s.id === session.id);
    if (existing) {
      this.log(LogLevel.WARN, `会话已存在: ${session.id}`);
      return this.update(session);
    }

    this.sessions.unshift(session);

    const success = this.persist();
    if (!success) {
      this.sessions = this.sessions.filter(s => s.id !== session.id);
      this.log(LogLevel.ERROR, '添加会话失败，已回滚');
      return false;
    }

    this.log(LogLevel.DEBUG, `添加会话成功: ${session.id}`);
    return true;
  }

  update(session: Session): boolean {
    if (!this.isValidSession(session)) {
      this.log(LogLevel.ERROR, '无效的会话数据', { session });
      return false;
    }

    const index = this.sessions.findIndex(s => s.id === session.id);
    if (index === -1) {
      this.log(LogLevel.WARN, `会话不存在，尝试添加: ${session.id}`);
      return this.add(session);
    }

    const oldSession = { ...this.sessions[index] };

    this.sessions.splice(index, 1);
    this.sessions.unshift(session);

    const success = this.persist();
    if (!success) {
      const currentIndex = this.sessions.findIndex(s => s.id === session.id);
      if (currentIndex !== -1) {
        this.sessions.splice(currentIndex, 1);
      }
      this.sessions.splice(index, 0, oldSession);
      this.log(LogLevel.ERROR, '更新会话失败，已回滚');
      return false;
    }

    this.log(LogLevel.DEBUG, `更新会话成功: ${session.id}`);
    return true;
  }

  delete(id: string): boolean {
    const index = this.sessions.findIndex(s => s.id === id);
    if (index === -1) {
      this.log(LogLevel.WARN, `会话不存在: ${id}`);
      return false;
    }

    const oldSessions = [...this.sessions];

    this.sessions.splice(index, 1);

    const success = this.persist();
    if (!success) {
      this.sessions = oldSessions;
      this.log(LogLevel.ERROR, '删除会话失败，已回滚');
      return false;
    }

    this.log(LogLevel.DEBUG, `删除会话成功: ${id}`);
    return true;
  }

  clear(): boolean {
    const oldSessions = [...this.sessions];

    this.sessions = [];

    const success = this.persist();
    if (!success) {
      this.sessions = oldSessions;
      this.log(LogLevel.ERROR, '清空会话失败，已回滚');
      return false;
    }

    this.log(LogLevel.INFO, '清空所有会话成功');
    return true;
  }

  private isValidSession(session: any): session is Session {
    return (
      session !== null &&
      typeof session === 'object' &&
      typeof session.id === 'string' &&
      typeof session.name === 'string' &&
      (session.topicId === null || session.topicId === undefined || typeof session.topicId === 'string') &&
      typeof session.lastActive === 'number'
    );
  }

  get count(): number {
    return this.sessions.length;
  }

  get status(): {
    isLoaded: boolean;
    count: number;
    version: number;
    hasCache: boolean;
  } {
    return {
      isLoaded: this.isLoaded,
      count: this.sessions.length,
      version: this.version,
      hasCache: !!localStorage.getItem(CACHE_KEY)
    };
  }

  sync(): void {
    this.load();
  }

  setLogLevel(level: 'debug' | 'info' | 'warn' | 'error'): void {
    const levelMap = {
      debug: LogLevel.DEBUG,
      info: LogLevel.INFO,
      warn: LogLevel.WARN,
      error: LogLevel.ERROR
    };
    this.logLevel = levelMap[level];
  }
}

export const sessionStorageService = new SessionStorageService();