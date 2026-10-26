import axios from 'axios';
import { io, Socket } from 'socket.io-client';
import { ApiConfig, type MessageMetrics } from '../../types';
import {
  accumulateInvocationUsage,
  buildInvocationMetrics,
  buildGenerationInfoFromAgg,
  extractUsageFromSsePayload,
  isPureOpenAiUsageChunk,
  type StreamUsagePatch,
  type GenerationInfoEnvelope
} from './streamUsage';
import { readOpenAiStreamIncludeUsagePreference } from './streamRequestOptions';
import { readOllamaThinkModePreference } from './ollamaThinkOptions';
import { responseTransformer, TransformContext, NormalizedResponse, ResponseTransformer } from '../../services/core/ResponseTransformer';
import { debugManager } from '../../services/DebugManager';
import { devLog, devWarn, devDebug, devError } from '../../utils/devConsole';
import {
  readCloudProvidersFromLocalStorage,
  readYueliaiFreemodelProvider
} from '../../utils/defaultCloudProviders';
import { getSecret, setSecret } from '../../utils/secretStore';
import { resolveYueliaiChatUrlForApp } from '../../utils/yueliaiChatEndpoint';
import {
  resolveCloudProviderChatUrl,
  resolveOpenAiCompatibleModelsListUrl
} from '../../utils/inferenceChatEndpoint';
import {
  coerceKgmStreamTextChunk,
  extractVisibleAnswerFromThinking,
  finalizeKgmAssistantMarkdownIfNeeded
} from '../../services/chat/kgmAssistantContent';
import { normalizeKgmRequestModelForApi } from '../../utils/kgmRequestModel';
import {
  migrateMisconfiguredLocalServiceUrls,
  normalizeBrowserKgmBaseUrl,
  shouldUseSameOriginKgmProxy
} from '../../utils/kgmBrowserBaseUrl';
import {
  decideKgmChatTransport,
  kgmRequestUsesStream,
  type KgmChatTransport
} from './kgmChatTransport';
import {
  formatKgmFetchAbortMessage,
  isFetchAbortError,
  resolveKgmChatTimeoutMs,
  scheduleFetchAbort
} from './kgmRequestTimeout';
import { clampKgmMessagesForRequest } from '../../utils/kgmRequestPayload';
import { readStreamChunkWithIdleTimeout } from './kgmStreamIdleRead';
import { formatKgmHttpError } from './kgmHttpError';
import { createLLMAdapter } from '../llm/createLLMAdapter';
import {
  applyL2RoutingMetaToKgmBody,
  resolveInferenceRoute,
  resolveTransportPolicy,
  type InferenceRoutePlan
} from '../../services/chat/InferenceRouter';
import { isStreamDisconnectError } from '../../services/chat/streamReconnectPolicy';
import type { ParsedAnthropicToolCall } from '../llm/anthropicBridge';
import type { UnifiedChatParams } from '../llm/types';

/** KGM 聊天预检金丝雀结果缓存（sessionStorage） */
export const KGM_CANARY_CACHE_KEY = 'yueli_canary_result_v3';
// 条件导入，只在非浏览器环境中导入KGM SDK
let createRuntimeWithStorage: any = null;
let ConfigStore: any = null;

// 注意：在浏览器环境中，KGM SDK将不会被加载
// 这是因为KGM SDK是为Node.js环境设计的，在浏览器环境中会出现错误

export type ApiProvider = 'kgm' | 'ollama' | 'anthropic' | 'yueliai';

/** 单轮对话工具循环总时长上限（毫秒） */
export const CHAT_TOOL_SESSION_MAX_MS = 8 * 60 * 1000;

/** 与 start.sh / 仓库 .env 中 KGM 默认监听端口一致（历史代码曾误用 3000）。 */
const DEFAULT_KGM_PORT_FALLBACK = '3080';

/**
 * 替换 `VITE_KGM_BASE_URL` 中字面量 `${KGM_PORT}` 时使用。
 * 优先 `VITE_KGM_PORT`；否则从已展开的 `VITE_KGM_BASE_URL` 提取端口；再否则 {@link DEFAULT_KGM_PORT_FALLBACK}。
 */
function resolveKgmPortPlaceholder(viteEnv: Record<string, string | undefined> | undefined): string {
  const e = viteEnv || {};
  if (e.VITE_KGM_PORT) return String(e.VITE_KGM_PORT);
  const base = e.VITE_KGM_BASE_URL;
  if (typeof base === 'string') {
    const m = base.match(/:(\d+)(?:\/|$)/);
    if (m) return m[1];
  }
  return DEFAULT_KGM_PORT_FALLBACK;
}

// 消息去重追踪器
interface DeduplicationTracker {
  seenContentHashes: Set<string>;
  lastSeenHash: string;
  createdAt: number;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: any;
  };
}

export interface ToolCallHandler {
  (toolName: string, args: Record<string, any>): Promise<string>;
}

export interface EmbeddingConfig {
  preset: string;
  endpoint: string;
  model: string;
  dimension: number;
  batchSize: number;
  timeout: number;
  apiKey: string;
  format: string;
}

class ApiService {
  private baseUrl: string;
  private apiKey: string;
  private timeout: number;
  private socket: Socket | null = null;
  private ollamaBaseUrl: string;
  private kgmBaseUrl: string;
  private kgmApiKey: string;
  private kgmTimeout: number;
  private anthropicBaseUrl: string;
  private anthropicApiKey: string;
  private selectedProvider: ApiProvider;
  private runtime: any = null;
  private embeddingConfig: EmbeddingConfig;
  
  // P2-1: 消息去重追踪器（按会话维度隔离）
  private deduplicationTrackers: Map<string, DeduplicationTracker> = new Map();
  
  // P2-3: 监控指标
  private metrics = {
    totalRequests: 0,
    failedRequests: 0,
    toolCallRounds: 0,
    averageLatency: 0,
    lastRequestTime: 0
  };

  constructor() {
    // 安全访问环境变量
    const viteEnv = (import.meta as any).env || {};
    const desktopProfile = viteEnv.VITE_DEPLOY_PROFILE === 'desktop';
    migrateMisconfiguredLocalServiceUrls();
    let kgmBaseUrl = normalizeBrowserKgmBaseUrl(
      localStorage.getItem('kgmBaseUrl') || viteEnv.VITE_KGM_BASE_URL || '/kgm',
      viteEnv
    );

    const userConfiguredUrl = localStorage.getItem('kgmBaseUrl');
    if (
      !userConfiguredUrl &&
      !desktopProfile &&
      !shouldUseSameOriginKgmProxy(viteEnv) &&
      (kgmBaseUrl.startsWith('http://') || kgmBaseUrl.startsWith('https://'))
    ) {
      const h = new URL(kgmBaseUrl).hostname;
      if (h === 'localhost' || h === '127.0.0.1') {
        kgmBaseUrl = '/kgm';
      }
    }
    
    // 替换 ${KGM_PORT} 占位符为实际端口号
    if (kgmBaseUrl.includes('${KGM_PORT}')) {
      const kgmPort = resolveKgmPortPlaceholder(viteEnv);
      kgmBaseUrl = kgmBaseUrl.replace('${KGM_PORT}', kgmPort);
    }
    
    this.kgmBaseUrl = kgmBaseUrl;
    
    // API Key 仅存 sessionStorage（secretStore）；关闭标签页即失效
    this.kgmApiKey = getSecret('kgmApiKey');

    this.kgmTimeout = parseInt(localStorage.getItem('kgmTimeout') || '60000');
    this.ollamaBaseUrl = localStorage.getItem('ollamaBaseUrl') || 'http://localhost:11434';
    this.anthropicBaseUrl =
      localStorage.getItem('anthropicBaseUrl') ||
      ((import.meta as any).env?.VITE_ANTHROPIC_BASE_URL as string | undefined) ||
      'https://api.anthropic.com';
    this.anthropicApiKey = getSecret('anthropicApiKey');
    this.selectedProvider = (localStorage.getItem('selectedProvider') as ApiProvider) || 'kgm';
    this.baseUrl = this.kgmBaseUrl;
    this.apiKey = this.kgmApiKey;
    this.timeout = this.kgmTimeout;
    this.embeddingConfig = this.loadEmbeddingConfig();
    this.initRuntime();
  }

  private loadEmbeddingConfig(): EmbeddingConfig {
    return {
      preset: localStorage.getItem('embeddingPreset') || 'ollama-nomic',
      endpoint: localStorage.getItem('embeddingEndpoint') || 'http://127.0.0.1:11434/v1/embeddings',
      model: localStorage.getItem('embeddingModel') || 'nomic-embed-text:latest',
      dimension: parseInt(localStorage.getItem('embeddingDimension') || '768'),
      batchSize: parseInt(localStorage.getItem('embeddingBatchSize') || '32'),
      timeout: parseInt(localStorage.getItem('embeddingTimeout') || '60'),
      apiKey: getSecret('embeddingApiKey'),
      format: localStorage.getItem('embeddingFormat') || 'ollama'
    };
  }

  getEmbeddingConfig(): EmbeddingConfig {
    return { ...this.embeddingConfig };
  }

  private parseCloudProvidersList(): any[] | null {
    try {
      return readCloudProvidersFromLocalStorage();
    } catch {
      return null;
    }
  }

  /**
   * 与 sendOllamaMessageWithMessages / ModelOptions 一致：
   * enabled + model + (apiUrl 或 presetId)；apiUrl 会按服务商规范补全为可 POST 的 chat completions 地址。
   */
  private getEnabledKgmCloudProvider(): any | undefined {
    const list = this.parseCloudProvidersList();
    if (!Array.isArray(list)) return undefined;
    const p = list.find((x: any) => x?.enabled && x?.model && (x?.apiUrl || x?.presetId));
    if (!p) return undefined;
    const apiUrl = resolveCloudProviderChatUrl(p);
    if (!apiUrl) return undefined;
    return { ...p, apiUrl };
  }

  /** UI `kgm:kgm-dynamic` / `kgm:cloud` → KGM `auto`；L2 管理中心 MaaS 优先于 L1 Playground，由 KGM 路由 */
  private normalizeKgmRequestModel(model: string): string {
    return normalizeKgmRequestModelForApi(model);
  }

  /** 第3层：Yueli AI 云端聚合（经同源 /yueliai 代理或直连） */
  private resolveYueliaiChatHttpEndpoint(): { apiUrl: string; model: string; hasApiKey: boolean } {
    const row = readYueliaiFreemodelProvider();
    const apiUrl = resolveYueliaiChatUrlForApp(row);
    return {
      apiUrl,
      model: (row.model || 'freemodel').trim(),
      hasApiKey: Boolean(row.apiKey?.trim())
    };
  }

  /** KGM 聊天 HTTP：始终同源 `/kgm/v1/chat/completions`，不在浏览器直连 cloudProviders 里的外网 URL */
  private resolveKgmChatHttpEndpoint(): { fetchRoot: string; apiUrl: string } {
    let baseUrl = this.kgmBaseUrl;
    const viteEnv = (import.meta as any).env || {};
    if (baseUrl.includes('${KGM_PORT}')) {
      baseUrl = baseUrl.replace('${KGM_PORT}', resolveKgmPortPlaceholder(viteEnv));
    }
    const fetchRoot = `${this.resolveBrowserKgmFetchBase(baseUrl, false)}`.replace(/\/$/, '');
    return { fetchRoot, apiUrl: `${fetchRoot}/v1/chat/completions` };
  }

  /** 流式 sources 按 type/name/url 去重，与 StreamEventReducer 语义一致 */
  private mergeDedupedStreamSources(existing: any[], incoming: any[]): any[] {
    const key = (s: any) =>
      `${String(s?.type ?? '')}::${String(s?.name ?? s?.title ?? '')}::${String(s?.url ?? '')}`;
    const seen = new Set(existing.map(key));
    const next = [...existing];
    for (const s of incoming) {
      const k = key(s);
      if (seen.has(k)) continue;
      seen.add(k);
      next.push(s);
    }
    return next;
  }

  setEmbeddingConfig(config: Partial<EmbeddingConfig>): void {
    this.embeddingConfig = { ...this.embeddingConfig, ...config };
    if (config.preset !== undefined) localStorage.setItem('embeddingPreset', config.preset);
    if (config.endpoint !== undefined) localStorage.setItem('embeddingEndpoint', config.endpoint);
    if (config.model !== undefined) localStorage.setItem('embeddingModel', config.model);
    if (config.dimension !== undefined) localStorage.setItem('embeddingDimension', config.dimension.toString());
    if (config.batchSize !== undefined) localStorage.setItem('embeddingBatchSize', config.batchSize.toString());
    if (config.timeout !== undefined) localStorage.setItem('embeddingTimeout', config.timeout.toString());
    if (config.apiKey !== undefined) setSecret('embeddingApiKey', config.apiKey);
    if (config.format !== undefined) localStorage.setItem('embeddingFormat', config.format);
  }

  private async initRuntime() {
    // 检查是否在浏览器环境中
    if (typeof window !== 'undefined') {
      devLog('Running in browser environment, KGM runtime initialization skipped');
      return;
    }
    
    try {
      const configStore = new ConfigStore({
        vector: { backend: "memory" },
        database: { provider: "sqlite", filePath: "data/kgm.sqlite" }
      });
      this.runtime = await createRuntimeWithStorage({ configStore });
      devLog('KGM runtime initialized successfully');
    } catch (error) {
      console.error('Failed to initialize KGM runtime:', error);
    }
  }

  private getClient() {
    const client = axios.create({
      baseURL: this.baseUrl,
      timeout: this.timeout,
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }
    });
    if (this.apiKey) {
      client.defaults.headers.common['Authorization'] = `Bearer ${this.apiKey}`;
    }
    return client;
  }

  setProvider(provider: ApiProvider) {
    this.selectedProvider = provider;
    localStorage.setItem('selectedProvider', provider);
    if (provider === 'kgm') {
      this.baseUrl = this.kgmBaseUrl;
      this.apiKey = this.kgmApiKey;
      this.timeout = this.kgmTimeout;
    } else if (provider === 'yueliai') {
      const row = readYueliaiFreemodelProvider();
      this.baseUrl = resolveYueliaiChatUrlForApp(row);
      this.apiKey = row.apiKey || '';
      this.timeout = Math.max(parseInt(localStorage.getItem('kgmTimeout') || '120000'), 60_000);
    } else if (provider === 'anthropic') {
      this.baseUrl = this.anthropicBaseUrl;
      this.apiKey = this.anthropicApiKey;
      this.timeout = Math.max(parseInt(localStorage.getItem('anthropicTimeout') || '120000'), 60000);
    } else {
      this.baseUrl = this.ollamaBaseUrl;
      this.apiKey = '';
      this.timeout = parseInt(localStorage.getItem('ollamaTimeout') || '60000');
    }
  }

  /** 保存 ApiConfigModal 等处写入的 Anthropic localStorage，刷新内存字段 */
  reloadAnthropicFromStorage(): void {
    const viteEnv = (import.meta as any).env || {};
    this.anthropicBaseUrl =
      localStorage.getItem('anthropicBaseUrl') ||
      (viteEnv?.VITE_ANTHROPIC_BASE_URL as string | undefined) ||
      'https://api.anthropic.com';
    this.anthropicApiKey = getSecret('anthropicApiKey');
    if (this.selectedProvider === 'anthropic') {
      this.baseUrl = this.anthropicBaseUrl;
      this.apiKey = this.anthropicApiKey;
      this.timeout = Math.max(parseInt(localStorage.getItem('anthropicTimeout') || '120000'), 60000);
    }
  }

  getProvider(): ApiProvider { return this.selectedProvider; }
  getBaseUrl(): string { return this.baseUrl; }
  getOllamaBaseUrl(): string { return this.ollamaBaseUrl; }
  getKgmBaseUrl(): string { return this.kgmBaseUrl; }

  /**
   * 解析当前聊天请求将使用的 provider / model / HTTP URL（与 sendOllamaMessageWithMessages 一致），不发起网络。
   * 用于管理口令门控等本地展示；KGM 动态路由下的「真实上游模型」仍以服务端为准。
   */
  resolveChatRuntimeSnapshot(
    requestModel: string,
    /** 与 React 状态同步：渲染帧内可能尚未执行 `setProvider` 的 effect */
    providerOverride?: ApiProvider
  ): {
    provider: ApiProvider;
    apiUrl: string;
    model: string;
    isCloudProvider: boolean;
    cloudProviderName?: string;
    /** KGM 模式下用于展示的 HTTP 根（开发环境本地 KGM 可能为 `/kgm`） */
    kgmHttpRootDisplay: string;
  } {
    const provider = providerOverride ?? this.selectedProvider;
    let baseUrl =
      provider === 'kgm'
        ? this.kgmBaseUrl
        : provider === 'anthropic'
          ? this.anthropicBaseUrl
          : provider === 'yueliai'
            ? resolveYueliaiChatUrlForApp(readYueliaiFreemodelProvider())
            : this.ollamaBaseUrl;
    let targetModel = requestModel;
    let isCloudProvider = false;
    let cloudProviderName: string | undefined;

    const viteEnv = (import.meta as any).env || {};
    if (provider !== 'anthropic' && provider !== 'yueliai' && baseUrl.includes('${KGM_PORT}')) {
      const kgmPort = resolveKgmPortPlaceholder(viteEnv);
      baseUrl = baseUrl.replace('${KGM_PORT}', kgmPort);
    }

    if (provider === 'yueliai') {
      const row = readYueliaiFreemodelProvider();
      const apiUrl = resolveYueliaiChatUrlForApp(row);
      const model = requestModel?.trim() || row.model || 'freemodel';
      return {
        provider,
        apiUrl,
        model,
        isCloudProvider: true,
        cloudProviderName: 'Yueli AI',
        kgmHttpRootDisplay: apiUrl.replace(/\/api\/yueliai\/.*$/i, '')
      };
    }

    if (provider === 'anthropic') {
      const apiUrl = `${this.anthropicBaseUrl.replace(/\/$/, '')}/v1/messages`;
      return {
        provider,
        apiUrl,
        model: targetModel,
        isCloudProvider: true,
        cloudProviderName: 'Anthropic',
        kgmHttpRootDisplay: this.anthropicBaseUrl.replace(/\/$/, '')
      };
    }

    if (provider === 'kgm') {
      targetModel = this.normalizeKgmRequestModel(targetModel);
      const { fetchRoot, apiUrl: kgmApiUrl } = this.resolveKgmChatHttpEndpoint();
      return {
        provider,
        apiUrl: kgmApiUrl,
        model: targetModel,
        isCloudProvider: false,
        kgmHttpRootDisplay: fetchRoot
      };
    }

    const apiUrl = `${baseUrl}`.replace(/\/$/, '') + '/api/generate';

    return {
      provider,
      apiUrl,
      model: targetModel,
      isCloudProvider,
      cloudProviderName,
      kgmHttpRootDisplay: `${baseUrl}`.replace(/\/$/, '')
    };
  }

  updateConfig(config: Partial<ApiConfig>) {
    if (config.baseUrl) { this.baseUrl = config.baseUrl; localStorage.setItem('apiBaseUrl', config.baseUrl); }
    if (config.apiKey !== undefined) { this.apiKey = config.apiKey; setSecret('apiKey', config.apiKey); }
    if (config.timeout !== undefined) { this.timeout = config.timeout; localStorage.setItem('apiTimeout', this.timeout.toString()); }
    if (config.ollamaBaseUrl) { this.ollamaBaseUrl = config.ollamaBaseUrl; localStorage.setItem('ollamaBaseUrl', config.ollamaBaseUrl); }
  }

  setKgmConfig(baseUrl: string, apiKey: string, timeout: number, ollamaBaseUrl: string) {
    const viteEnv = (import.meta as any).env || {};
    if (baseUrl.includes('${KGM_PORT}')) {
      const kgmPort = resolveKgmPortPlaceholder(viteEnv);
      baseUrl = baseUrl.replace('${KGM_PORT}', kgmPort);
    }
    baseUrl = normalizeBrowserKgmBaseUrl(baseUrl, viteEnv);

    this.kgmBaseUrl = baseUrl;
    this.kgmApiKey = apiKey;
    this.kgmTimeout = timeout;
    this.ollamaBaseUrl = ollamaBaseUrl;
    
    localStorage.setItem('kgmBaseUrl', baseUrl);
    setSecret('kgmApiKey', apiKey);
    localStorage.setItem('kgmTimeout', timeout.toString());
    localStorage.setItem('kgmOllamaBaseUrl', ollamaBaseUrl);
    
    if (this.selectedProvider === 'kgm') {
      this.baseUrl = baseUrl;
      this.apiKey = apiKey;
      this.timeout = timeout;
    }
  }

  connectWebSocket(onMessage: (data: any) => void, onError: (error: any) => void) {
    this.disconnectWebSocket();
    this.socket = io(this.baseUrl, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000
    });
    this.socket.on('message', onMessage);
    this.socket.on('error', onError);
    this.socket.on('connect_error', onError);
    return this.socket;
  }

  disconnectWebSocket() {
    if (this.socket) { this.socket.disconnect(); this.socket = null; }
  }

  /**
   * KGM 侧 executeToolCalls=false，工具在 skill-executor 执行。
   * 有 tools 定义时首轮必须下发 schema，否则模型无法产出 tool_calls，agentic loop 无法启动。
   * （旧策略「首轮剥离 tools」会导致 OpenAI FC 死锁；transport 已不再因 toolCount 强制 blocking。）
   */
  private shouldSendOpenAiToolsToKgm(
    _messages: unknown[],
    hasTools: boolean
  ): boolean {
    return hasTools;
  }

  /** 限制 KGM 出站 messages 体积；保留 tools schema 以启动 function calling */
  private prepareKgmOutboundPayload(
    requestBody: Record<string, unknown>,
    messagesForPolicy: unknown[]
  ): {
    estimatedChars: number;
    clamped: boolean;
    toolsCount: number;
    toolsSentToKgm: boolean;
  } {
    const hasTools = Array.isArray(requestBody.tools) && requestBody.tools.length > 0;
    let toolsSentToKgm = hasTools && this.shouldSendOpenAiToolsToKgm(messagesForPolicy, hasTools);
    if (hasTools && !toolsSentToKgm) {
      delete requestBody.tools;
      delete requestBody.tool_choice;
    }

    const toolsCount = toolsSentToKgm && Array.isArray(requestBody.tools) ? requestBody.tools.length : 0;
    const messages = requestBody.messages;
    if (!Array.isArray(messages)) {
      return { estimatedChars: 0, clamped: false, toolsCount, toolsSentToKgm };
    }
    const { clamped, estimatedChars } = clampKgmMessagesForRequest(
      messages as Array<{ role?: string; content?: unknown }>
    );
    if (clamped) {
      devWarn(`[ApiService] KGM 上下文已截断至约 ${estimatedChars} 字符（避免推理超时）`);
    }
    if (estimatedChars > 28_000) {
      const prev = requestBody.max_tokens;
      const largeCtxCap = 2048;
      const capped =
        typeof prev === 'number' && prev > 0 ? Math.min(prev, largeCtxCap) : largeCtxCap;
      requestBody.max_tokens = capped;
      devLog(`[ApiService] KGM 大上下文：max_tokens 限制为 ${capped}`);
    }
    return { estimatedChars, clamped, toolsCount, toolsSentToKgm };
  }

  /** 将 Failed to fetch / Abort 转为可操作的提示（网关/KGM 未启动等） */
  private formatLlmFetchError(
    err: unknown,
    apiUrl: string,
    opts?: {
      timeoutMs?: number;
      kgmTimeoutMode?: 'blocking' | 'stream';
      kgmAbortHints?: { payloadChars?: number; toolsCount?: number };
    }
  ): Error {
    const raw = err instanceof Error ? err.message : String(err || '未知错误');
    if (isFetchAbortError(err)) {
      const timeoutMs = resolveKgmChatTimeoutMs(
        opts?.timeoutMs ?? this.timeout,
        opts?.kgmTimeoutMode ?? 'stream'
      );
      const hints = opts?.kgmAbortHints;
      return new Error(formatKgmFetchAbortMessage(timeoutMs, hints));
    }
    if (raw.includes('Failed to fetch') && apiUrl.startsWith('/kgm')) {
      return new Error(
        '无法连接本地 KGM（/kgm）。请确认应用内后台已启动：完全退出后重开，或执行 npm run start:desktop 查看 KGM 日志。'
      );
    }
    return err instanceof Error ? err : new Error(raw);
  }

  /**
   * Vite 开发环境通过同源 `/kgm` 代理到 KGM（见 vite.config.ts）。
   * 若在配置里写 `http://127.0.0.1:3080` 等绝对地址，浏览器 `fetch` 会因跨端口 CORS 报 `TypeError: Failed to fetch`。
   * 本地页面对本机 KGM 的 HTTP(S) 请求统一改走 `/kgm`，由开发服务器转发。
   */
  private resolveBrowserKgmFetchBase(baseUrl: string, isCloudProvider: boolean): string {
    if (isCloudProvider) return baseUrl;
    if (typeof window === 'undefined') return baseUrl;
    const viteEnv = (import.meta as any).env || {};
    if (!shouldUseSameOriginKgmProxy(viteEnv)) return baseUrl;
    if (this.selectedProvider !== 'kgm') return baseUrl;
    return normalizeBrowserKgmBaseUrl(baseUrl, viteEnv);
  }

  sendWebSocketMessage(data: any) {
    if (this.socket && this.socket.connected) this.socket.emit('message', data);
  }

  async getOllamaModels() {
    const response = await axios.get(`${this.ollamaBaseUrl}/api/tags`);
    return response.data;
  }

  async getKgmModels() {
    let baseUrl = this.kgmBaseUrl;
    const viteEnv = (import.meta as any).env || {};
    if (baseUrl.includes('${KGM_PORT}')) {
      const kgmPort = resolveKgmPortPlaceholder(viteEnv);
      baseUrl = baseUrl.replace('${KGM_PORT}', kgmPort);
    }
    const { fetchRoot } = this.resolveKgmChatHttpEndpoint();
    const response = await axios.get(`${fetchRoot}/v1/models`, {
      headers: this.kgmApiKey ? { Authorization: `Bearer ${this.kgmApiKey}` } : {}
    });
    return response.data;
  }

  /**
   * 聊天前的预检：在真正调用 LLM 之前，把"可预测的失败原因"以结构化形式返回出来，
   * 让上层把具体的问题直接展示给用户。
   *
   * 设计原则（重要）：
   * - 前端只对接 KGM 中间层，**不替 KGM 决策路由**。
   *   KGM 的三种路径（推理引擎路由 / 模型路由 / 原生推理）由 KGM 内部根据 KGM_LLM_*、
   *   autoRouting、native 等配置自动选择，谁有效谁工作。
   * - 因此本方法只做诊断，**不会**改变 sendOllamaMessageWithMessages 走的 baseUrl / model；
   *   也不会自动 fallback 到 Ollama。需要修复时返回 issue 指引到 KGM 配置。
   * - 不会抛错，所有问题都通过返回值传出去。
   */
  async runChatPreflight(model: string): Promise<{
    ok: boolean;
    issues: Array<{
      severity: 'error' | 'warn' | 'info';
      code: string;
      message: string;
      hint?: string;
    }>;
    resolved: {
      provider: ApiProvider;
      apiUrl: string;
      model: string;
      isCloudProvider: boolean;
      cloudProviderName?: string;
      hasApiKey: boolean;
    };
  }> {
    const issues: Array<{ severity: 'error' | 'warn' | 'info'; code: string; message: string; hint?: string }> = [];

    if (this.selectedProvider === 'yueliai') {
      const row = readYueliaiFreemodelProvider();
      const apiUrl = resolveYueliaiChatUrlForApp(row);
      const targetModel = model?.trim() || row.model || 'freemodel';
      if (!row.apiKey?.trim()) {
        issues.push({
          severity: 'error',
          code: 'YUELIAI_NO_API_KEY',
          message: 'Yueli AI 未配置 API Key',
          hint: '在「配置管理 → 云端推理 → Yueli AI」填写 Key，或完成首次引导'
        });
      }
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 5000);
        const res = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(row.apiKey?.trim() ? { Authorization: `Bearer ${row.apiKey.trim()}` } : {})
          },
          body: JSON.stringify({
            model: targetModel,
            messages: [{ role: 'user', content: 'ping' }],
            max_tokens: 1,
            stream: false
          }),
          signal: ctrl.signal
        }).finally(() => clearTimeout(t));
        if (!res.ok) {
          issues.push({
            severity: 'error',
            code: 'YUELIAI_PREFLIGHT_FAILED',
            message: `Yueli AI 预检 HTTP ${res.status}`,
            hint: '检查 API Key 与网络；桌面端需 gateway /yueliai 代理可用'
          });
        }
      } catch (e: unknown) {
        issues.push({
          severity: 'error',
          code: 'YUELIAI_UNREACHABLE',
          message: `无法连接 Yueli AI：${e instanceof Error ? e.message : String(e)}`,
          hint: '确认 gateway 已启动且 /yueliai 路由正常'
        });
      }
      return {
        ok: !issues.some((i) => i.severity === 'error'),
        issues,
        resolved: {
          provider: 'yueliai',
          apiUrl,
          model: targetModel,
          isCloudProvider: true,
          cloudProviderName: 'Yueli AI',
          hasApiKey: Boolean(row.apiKey?.trim())
        }
      };
    }

    // 1) 解析当前真实的调用配置（与 sendOllamaMessageWithMessages 中保持一致）
    let baseUrl = this.selectedProvider === 'kgm' ? this.kgmBaseUrl : this.ollamaBaseUrl;
    let apiKey = this.selectedProvider === 'kgm' ? this.kgmApiKey : '';
    let targetModel = model;
    let isCloudProvider = false;
    let cloudProviderName: string | undefined;

    const viteEnv = (import.meta as any).env || {};
    if (baseUrl.includes('${KGM_PORT}')) {
      const kgmPort = resolveKgmPortPlaceholder(viteEnv);
      baseUrl = baseUrl.replace('${KGM_PORT}', kgmPort);
    }

    if (this.selectedProvider === 'kgm') {
      targetModel = this.normalizeKgmRequestModel(targetModel);
    }

    if (this.selectedProvider === 'kgm') {
      const cloudProviders = this.parseCloudProvidersList();
      if (cloudProviders === null) {
        issues.push({
          severity: 'warn',
          code: 'CLOUD_PROVIDER_PARSE_FAILED',
          message: 'localStorage 中的 cloudProviders 配置解析失败',
          hint: '请在 "配置管理 → 云端推理" 中重新保存配置'
        });
      } else {
        const enabledFull = cloudProviders.find(
          (p: any) => p?.enabled && p?.model && (p?.apiUrl || p?.presetId)
        );
        const enabledIncomplete = cloudProviders.find(
          (p: any) => p?.enabled && (p?.apiUrl || p?.presetId) && !p?.model
        );
        if (enabledIncomplete && !enabledFull) {
          const nm = enabledIncomplete.name || enabledIncomplete.provider || '(未命名)';
          issues.push({
            severity: 'warn',
            code: 'CLOUD_PROVIDER_INCOMPLETE',
            message: `云端推理「${nm}」已启用但未指定 model；该配置供 KGM 路由参考，对话仍经 /kgm 由 KGM 选用上游。`,
            hint: '在 "配置管理 → 云端推理" 中补全 model，或关闭该 provider'
          });
        }
        if (enabledFull && !enabledFull.apiKey) {
          const nm = enabledFull.name || enabledFull.provider || '(未命名)';
          issues.push({
            severity: 'warn',
            code: 'CLOUD_PROVIDER_NO_API_KEY',
            message: `云端推理「${nm}」未配置 apiKey（供 KGM 路由上游使用，非浏览器直连）`,
            hint:
              '请在「配置管理 → 云端推理」填写 apiKey，并确保 KGM Playground / routes 已配置对应上游（freemodel、DeepSeek 等由 KGM 选用）。'
          });
        }
      }
    }

    const kgmHttp =
      this.selectedProvider === 'kgm' ? this.resolveKgmChatHttpEndpoint() : null;
    const apiUrl =
      this.selectedProvider === 'kgm'
        ? kgmHttp!.apiUrl
        : `${baseUrl}/api/generate`;

    const kgmHttpFetchRoot = kgmHttp?.fetchRoot ?? this.resolveBrowserKgmFetchBase(baseUrl, false);

    // 2) KGM / Ollama 探活（KGM 含 freemodel/Ollama/DeepSeek 等上游，由中间层路由）
    if (this.selectedProvider === 'kgm' || !isCloudProvider) {
      // 2a) 探活：尝试 /v1/models（KGM）或 /api/tags（Ollama）
      const probeUrl = this.selectedProvider === 'kgm'
        ? `${kgmHttpFetchRoot}`.replace(/\/$/, '') + '/v1/models'
        : `${baseUrl}`.replace(/\/$/, '') + '/api/tags';
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4000);
        const resp = await fetch(probeUrl, {
          method: 'GET',
          headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
          signal: controller.signal
        }).finally(() => clearTimeout(timer));

        if (!resp.ok) {
          issues.push({
            severity: 'error',
            code: 'PROVIDER_NOT_HEALTHY',
            message: `推理服务返回 HTTP ${resp.status}（${probeUrl}）`,
            hint: resp.status === 401 || resp.status === 403
              ? '可能是 apiKey 缺失或无效，请检查 "配置管理 → KGM SDK" 中的 apiKey 配置'
              : `请确认推理服务已启动并监听 ${baseUrl}，必要时检查 KGM_PORT 是否一致`
          });
        } else {
          // 服务可达即可。注意：KGM 对用户端隐藏真实模型，
          // /v1/models 返回的更多是 KGM Playground 自动路由的候选 label，
          // 因此**不**以"model 是否出现在该列表"判定可用性——
          // 真实可用性放到 2c 的金丝雀里去探测（直接发一个最小 chat 请求看真实返回）。
          // 故意不再解析返回的模型列表——KGM 端的 /v1/models 列表只是 Playground
          // 自动路由的候选 label，不代表用户必须从中选择，所以拿它做匹配反而会误报。
        }
      } catch (e: any) {
        const reason = e?.name === 'AbortError' ? '探活超时' : (e?.message || String(e));
        issues.push({
          severity: 'error',
          code: 'PROVIDER_UNREACHABLE',
          message: `无法连接推理服务 ${baseUrl}: ${reason}`,
          hint: [
            '请确认 KGM / Ollama 服务已启动；如未启动，可执行 ./start.sh 一键启动。',
            '若在浏览器开发环境看到 Failed to fetch，多为跨端口 CORS：请在「配置管理」中将 KGM 地址留空或设为 `/kgm`，并确保启动前端时 `KGM_PORT` 与 KGM 监听端口一致（由 Vite 代理转发）。'
          ].join('')
        });
      }

      // 2c) KGM 路由通道金丝雀：
      //     注意：KGM 对前端隐藏真实模型，由 Playground 按策略自动路由到底层推理服务。
      //     因此不能从前端的"模型 label"判断可用性，只能通过一次确定性 prompt 看 KGM
      //     的真实响应——并以响应里的 `kgm.routing.selected` 元数据 + 内容形状判定路由
      //     是否真的把请求送达了一个真实推理服务。
      //
      //     如果返回的内容是 "ok" / 极短 / 缺失 routing 元数据，说明 KGM 没真正路由（典型
      //     原因：KGM_MOCK_MODE=1；或 Playground 没配置任何有效 provider，路由空转返回占位）。
      const CANARY_TTL_MS = 5 * 60 * 1000;
      const stored = typeof sessionStorage !== 'undefined'
        ? sessionStorage.getItem(KGM_CANARY_CACHE_KEY) : null;
      let cached: { ts: number; baseUrl: string; routingOk: boolean; content: string; selected?: string } | null = null;
      try {
        if (stored) cached = JSON.parse(stored);
      } catch { cached = null; }
      const canaryCacheBase = this.selectedProvider === 'kgm' ? kgmHttpFetchRoot : baseUrl;
      const cachedFresh = cached && cached.baseUrl === canaryCacheBase
        && (Date.now() - cached.ts) < CANARY_TTL_MS;

      const onlyHasErrors = issues.some(i => i.severity === 'error');

      // KGM 三种路径（推理引擎路由 / 模型路由 / 原生推理）都没工作时，给出可操作的诊断。
      // 注意：前端不替 KGM 决策路由，只告诉用户去修 KGM 这一层。
      const buildRoutingIssue = (content: string, selected?: string) => ({
        severity: 'error' as const,
        code: 'KGM_NO_REAL_ROUTING',
        message: `KGM 中间层没有把请求路由到任何真实推理通道：探针 prompt "请只回复 ping-pong-canary-2026" 得到的回复是 "${content || '(空)'}"${selected ? `（KGM 自报的路由目标: ${selected}）` : ''}，与预期不符。`,
        hint: [
          'KGM 内部有三条路径，按 KGM 内部策略选择，前端不替它决策：',
          '  ① 推理引擎路由 (inference engine routing) — 走外部 OpenAI/Anthropic 兼容上游 LLM',
          '  ② 模型路由 (model routing) — L2 管理中心 MaaS（含 freemodel）优先于 L1 Playground；按 routes / autoRouting 在多个 provider 间挑选',
          '  ③ 原生推理 (native inference) — 进程内 GPU/MLX，加载本地 GGUF / Apple MLX 等',
          '',
          '当前所有路径都未提供有效回复，请按以下顺序排查：',
          '  1. 检查 `start.sh` 启动 KGM 时是否带了 `KGM_MOCK_MODE=1` —— 这是个测试开关，会让所有 chat 返回 "ok"，正常运行应去掉。',
          '  2. 检查 KGM_LLM_BASE_URL / KGM_LLM_API_KEY / KGM_LLM_MODEL 是否指向一个真实可用的 LLM（路径①）。本机如有 Ollama，可设为 http://127.0.0.1:11434/v1。',
          '  3. 在 KGM Playground (http://localhost:3080) 的 routes / autoRouting 配置里，确认至少有一个候选 provider 的 apiKey 有效（路径②）。',
          '  4. 如果要走原生推理（路径③），确保已通过 KGM 的 modelManager 拉取/挂载本地权重，并且 native 引擎在 KGM 启动日志里有"engine ready"之类的提示。',
          '',
          '在 KGM Playground 的"调用历史/审计"里能看到 KGM 选了哪条路径以及为什么失败。'
        ].join('\n')
      });

      if (cachedFresh && !cached!.routingOk) {
        issues.push(buildRoutingIssue(cached!.content, cached!.selected));
      } else if (!onlyHasErrors && this.selectedProvider === 'kgm' && !cachedFresh) {
        try {
          const canaryUrl = `${kgmHttpFetchRoot}`.replace(/\/$/, '') + '/v1/chat/completions';
          const canaryController = new AbortController();
          const canaryTimer = setTimeout(() => canaryController.abort(), 6000);
          const canaryResp = await fetch(canaryUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {})
            },
            // model 字段只是给 KGM 一个 hint，真正由 Playground 路由策略决定。这里发一个
            // 内容确定的 prompt，方便判定返回是真实模型生成还是占位字符串。
            body: JSON.stringify({
              model: targetModel,
              messages: [
                { role: 'system', content: 'You are a concise assistant. Reply exactly what the user asks for.' },
                { role: 'user', content: 'Please reply with the exact phrase: ping-pong-canary-2026' }
              ],
              stream: false,
              max_tokens: 128,
              think: false,
              kgm: {
                capabilities: { executeToolCalls: false },
                ollama: { think: false }
              }
            }),
            signal: canaryController.signal
          }).finally(() => clearTimeout(canaryTimer));

          if (canaryResp.ok) {
            const j = await canaryResp.json().catch(() => null);
            const canaryContent: string = (j?.choices?.[0]?.message?.content ?? '').toString().trim();
            const completionTokens: number | undefined = j?.usage?.completion_tokens;
            const selected: string | undefined = j?.kgm?.routing?.selected?.label
              || j?.kgm?.routing?.selected?.routeKey;

            // 判定：含预期短语 → OK；或 KGM 已选中真实路由且非占位短回复（避免工具模式未回 canary 短语误报）
            const containsExpected = canaryContent.toLowerCase().includes('ping-pong-canary');
            const hasRoutingMeta = Boolean(
              j?.kgm?.routing?.selected?.routeKey || j?.kgm?.routing?.selected?.label
            );
            const trimmed = canaryContent.trim();
            const looksLikeMockOk = /^ok\.?$/i.test(trimmed);
            const hasSubstantiveReply =
              trimmed.length > 16 &&
              (typeof completionTokens !== 'number' || completionTokens > 5);
            const looksLikePlaceholder =
              !containsExpected &&
              !hasRoutingMeta &&
              (trimmed.length <= 4 ||
                looksLikeMockOk ||
                (typeof completionTokens === 'number' &&
                  completionTokens <= 2 &&
                  trimmed.length < 16));
            const routingOk =
              containsExpected || (hasRoutingMeta && hasSubstantiveReply && !looksLikeMockOk);

            if (!routingOk) {
              issues.push(buildRoutingIssue(canaryContent, selected));
            }
            // 只缓存「通过」的金丝雀结果：失败若写入 sessionStorage，会在 CANARY_TTL_MS 内
            // 反复命中 `cachedFresh && !routingOk` 分支而不再重试，用户修好 KGM 后仍会一直误报。
            if (typeof sessionStorage !== 'undefined') {
              if (routingOk) {
                sessionStorage.setItem(KGM_CANARY_CACHE_KEY, JSON.stringify({
                  ts: Date.now(), baseUrl: canaryCacheBase, routingOk, content: canaryContent, selected
                }));
              } else {
                sessionStorage.removeItem(KGM_CANARY_CACHE_KEY);
              }
            }
          }
        } catch (e) {
          // AbortError 属于预期可控的超时/取消，不应当在控制台刷“失败”
          if ((e as any)?.name !== 'AbortError') {
            devDebug('[Preflight] canary skipped:', e);
          }
        }
      }
    }

    const errorCount = issues.filter(i => i.severity === 'error').length;
    return {
      ok: errorCount === 0,
      issues,
      resolved: {
        provider: this.selectedProvider,
        apiUrl,
        model: targetModel,
        isCloudProvider,
        cloudProviderName,
        hasApiKey: !!apiKey
      }
    };
  }

  /**
   * 发送消息（支持 function calling / agentic loop）
   * KGM 侧始终设 executeToolCalls: false，工具执行在 skill-executor 完成
   */
  /** 清除 sessionStorage 中的 KGM 金丝雀预检缓存（removeItem 返回 undefined 属正常） */
  clearKgmCanaryCache(): { ok: true; message: string } {
    try {
      if (typeof sessionStorage !== 'undefined') {
        sessionStorage.removeItem(KGM_CANARY_CACHE_KEY);
      }
    } catch {
      /* ignore */
    }
    return {
      ok: true,
      message:
        '已清除 KGM 预检金丝雀缓存 (yueli_canary_result_v3)。removeItem 返回 undefined 是正常现象；下次发送将重新探针。'
    };
  }

  async sendOllamaMessageWithMessages(
    model: string,
    messages: any[],
    onData: (data: any) => void,
    options?: {
      tools?: ToolDefinition[];
      toolCallHandler?: ToolCallHandler;
      maxToolRounds?: number;
      /** 仅影响出站传输策略，不会发给 KGM HTTP body */
      kgmRequestHints?: {
        compactAttachmentChat?: boolean;
        /** 流式无正文时不回退 blocking（避免再卡 300s） */
        suppressBlockingFallback?: boolean;
      };
    }
  ): Promise<
    | undefined
    | {
        reasoningContent?: string;
        thinkingContent?: string;
        content?: string;
        invocation?: MessageMetrics;
        transportMeta?: { fallback?: string };
        /** OpenAI 兼容用量形状，与 {@link invocation} 中 token 聚合一致（多轮工具循环为累加值） */
        generationInfo?: GenerationInfoEnvelope;
      }
  > {
    const { tools, toolCallHandler, maxToolRounds = 5 } = options || {};
    const invokeStartedAt = Date.now();

    // 检查是否使用本地KGM运行时
    if (this.selectedProvider === 'kgm' && this.runtime) {
      try {
        // 使用本地KGM运行时处理请求
        const requestBody: any = {
          model,
          messages,
          stream: true,
          kgm: {
            capabilities: {
              executeToolCalls: false
            }
          }
        };

        if (tools && tools.length > 0 && toolCallHandler) {
          requestBody.tools = tools;
          requestBody.tool_choice = 'auto';
        }

        // 调用KGM运行时的execute方法
        const result = await this.runtime.execute(requestBody);
        
        // 处理返回结果
        if (result.content) {
          const finalized = finalizeKgmAssistantMarkdownIfNeeded(result.content);
          onData({
            message: {
              content: finalized,
              role: 'assistant'
            },
            done: true
          });
        }

        const kgmHttpBaseline = this.metrics.toolCallRounds - (result.content ? 1 : 0);
        const zeroAgg = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
        const inv = buildInvocationMetrics(
          this.metrics.toolCallRounds,
          kgmHttpBaseline,
          invokeStartedAt,
          zeroAgg
        );
        return {
          invocation: inv,
          generationInfo: buildGenerationInfoFromAgg(
            zeroAgg,
            this.metrics.toolCallRounds - kgmHttpBaseline,
            model
          )
        };
      } catch (error) {
        console.error('KGM runtime execution failed:', error);
        // 失败时回退到网络请求
      }
    }

    if (this.selectedProvider === 'anthropic') {
      return await this.sendAnthropicMessageWithMessages(model, messages, onData, {
        tools,
        toolCallHandler,
        maxToolRounds,
        invokeStartedAt
      });
    }

    const isYueliai = this.selectedProvider === 'yueliai';
    const isKgm = this.selectedProvider === 'kgm';
    const routePlan: InferenceRoutePlan = resolveInferenceRoute(
      this.selectedProvider,
      model
    );
    const transportPolicy = resolveTransportPolicy(routePlan);
    let transportFallback: string | undefined;

    // 回退到网络请求
    let baseUrl = isKgm ? this.kgmBaseUrl : isYueliai ? this.baseUrl : this.ollamaBaseUrl;
    let apiKey = isKgm ? this.kgmApiKey : isYueliai ? this.apiKey : '';
    let targetModel = isKgm ? routePlan.requestModel : isYueliai ? routePlan.requestModel : model;

    const viteEnv = (import.meta as any).env || {};
    if (isKgm && baseUrl.includes('${KGM_PORT}')) {
      const kgmPort = resolveKgmPortPlaceholder(viteEnv);
      baseUrl = baseUrl.replace('${KGM_PORT}', kgmPort);
    }

    const apiUrl = isKgm
      ? this.resolveKgmChatHttpEndpoint().apiUrl
      : isYueliai
        ? this.resolveYueliaiChatHttpEndpoint().apiUrl
        : `${baseUrl}/api/generate`;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
    // 设置 Accept-Language 头部，避免浏览器自动添加不支持的语言代码
    headers['Accept-Language'] = 'en';
    let currentMessages = [...messages];
    let round = 0;
    
    // P0-2: 工具调用循环增强：追踪重复调用模式
    // 修复：降低阈值，提前检测
    const recentToolCalls: string[] = [];
    const RECENT_CALLS_WINDOW = 5;  // 修复：10 → 5，提前触发检测
    const MAX_RECENT_TOOL_CALLS = 50;
    const LOOP_DETECTION_THRESHOLD = 2;  // 新增：早期预警阈值
    const LOOP_CRITICAL_THRESHOLD = 3;  // 连续 3 次触发强制中断
    let consecutiveEmptyResponses = 0;

    const baselineToolHttp = this.metrics.toolCallRounds;
    const usageAgg = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    // 工具循环可能以「最后一轮仅有 tool_calls」结束：保留最后一轮流式文本，避免仅返回 invocation 丢失助手可见内容
    let lastStreamText = '';
    let lastThinkingAccum = '';
    let lastReasoningAccum = '';
    let lastKgmTimeoutMode: 'blocking' | 'stream' = 'stream';

    // P2-3: 更新监控指标
    const requestStartTime = Date.now();
    const toolSessionStartedAt = Date.now();
    this.metrics.totalRequests++;

    while (round < maxToolRounds) {
      if (Date.now() - toolSessionStartedAt > CHAT_TOOL_SESSION_MAX_MS) {
        onData({
          error: {
            code: 'TOOL_SESSION_TIMEOUT',
            message: `工具调用会话超过 ${CHAT_TOOL_SESSION_MAX_MS / 60_000} 分钟上限，已中止`
          }
        });
        break;
      }
      round++;
      
      // P0-2 修复：改进的循环检测逻辑
      // 修复：移除 round > 1 条件，从第一轮就开始检测
      // 修复：降低阈值，从 5 次调用就开始检测
      if (recentToolCalls.length >= RECENT_CALLS_WINDOW) {
        const recentCalls = recentToolCalls.slice(-RECENT_CALLS_WINDOW);
        const uniqueCalls = new Set(recentCalls);
        
        // P0-2 修复：如果所有调用都是同一个工具，检查是否有进展
        if (uniqueCalls.size === 1) {
          // 计算该工具被调用的连续轮次
          let consecutiveCount = 0;
          const lastCallName = recentCalls[0];
          for (let i = recentCalls.length - 1; i >= 0; i--) {
            if (recentCalls[i] === lastCallName) {
              consecutiveCount++;
            } else {
              break;
            }
          }
          
          // P0-2 修复：降低触发阈值，增加早期预警
          if (consecutiveCount >= LOOP_DETECTION_THRESHOLD) {
            devWarn(`⚠️ 工具调用预警: ${lastCallName} 被连续调用 ${consecutiveCount} 次`);
            
            if (consecutiveCount >= LOOP_CRITICAL_THRESHOLD) {
              devWarn('⚠️ 检测到可能的工具调用循环，中止工具调用');
              onData({
                error: {
                  code: 'TOOL_CALL_LOOP_DETECTED',
                  message: `检测到工具 "${lastCallName}" 被连续调用 ${consecutiveCount} 次，可能陷入循环`
                }
              });
              break;  // 强制中断
            }
          }
        }
      }

      let kgmPayloadMeta = { estimatedChars: 0, toolsCount: 0 };
      lastKgmTimeoutMode = 'stream';
      try {
        // P0-2 & P0-3: 根据 Provider 构建请求体
        const requestBody = this.buildRequestBody({
          provider: isYueliai ? 'yueliai' : this.selectedProvider,
          model: targetModel,
          messages: currentMessages,
          tools,
          toolCallHandler
        });

        if (isKgm) {
          applyL2RoutingMetaToKgmBody(requestBody, routePlan);
          kgmPayloadMeta = this.prepareKgmOutboundPayload(requestBody, currentMessages);
          if (options?.kgmRequestHints?.compactAttachmentChat) {
            const cur = Number(requestBody.max_tokens);
            const floor = 2048;
            requestBody.max_tokens =
              Number.isFinite(cur) && cur > 0 ? Math.max(cur, floor) : floor;
            const kgm = (requestBody.kgm as Record<string, unknown>) || {};
            const routing =
              kgm.routing && typeof kgm.routing === 'object'
                ? (kgm.routing as Record<string, unknown>)
                : {};
            requestBody.kgm = {
              ...kgm,
              routing: { ...routing, profile: 'latency_first' }
            };
          }
        }

        const kgmTransport: KgmChatTransport = isKgm
            ? decideKgmChatTransport({
                toolCount: Array.isArray(requestBody.tools) ? requestBody.tools.length : 0,
                estimatedPayloadChars: kgmPayloadMeta.estimatedChars,
                compactAttachmentChat: Boolean(options?.kgmRequestHints?.compactAttachmentChat)
              })
            : 'stream';

        if (isKgm) {
          requestBody.stream = kgmRequestUsesStream(kgmTransport);
        } else if (isYueliai) {
          requestBody.stream = true;
        }

        // P2-3: 记录请求日志
        debugManager.logRequest(`发送请求 (Round ${round})`, {
          provider: this.selectedProvider,
          model: targetModel,
          apiUrl,
          messagesCount: currentMessages.length,
          toolsCount: requestBody.tools?.length || 0,
          hasKgmConfig: !!requestBody.kgm,
          kgmTransport: isKgm ? kgmTransport : undefined,
          kgmPayloadChars: isKgm ? kgmPayloadMeta.estimatedChars : undefined
        }, requestStartTime);

        if (isKgm && kgmTransport === 'blocking') {
          lastKgmTimeoutMode = 'blocking';
          this.metrics.toolCallRounds++;
          const kgmBlockingTimeoutMs = resolveKgmChatTimeoutMs(this.timeout, 'blocking', {
            compactAttachmentChat: Boolean(options?.kgmRequestHints?.compactAttachmentChat)
          });
          const blocking = await this.fetchKgmNonStreamCompletion(
            apiUrl,
            headers,
            requestBody,
            targetModel,
            onData,
            kgmBlockingTimeoutMs
          );
          accumulateInvocationUsage(usageAgg, blocking.usage);

          lastStreamText = blocking.content || lastStreamText;
          lastThinkingAccum = blocking.thinkingContent || lastThinkingAccum;
          lastReasoningAccum = blocking.reasoningContent || lastReasoningAccum;

          const blockingTools = blocking.toolCalls ?? [];
          if (blockingTools.length === 0) {
            this.metrics.lastRequestTime = Date.now() - requestStartTime;
            this.metrics.averageLatency =
              (this.metrics.averageLatency * (this.metrics.totalRequests - 1) +
                this.metrics.lastRequestTime) /
              this.metrics.totalRequests;
            const httpRounds = this.metrics.toolCallRounds - baselineToolHttp;
            return {
              reasoningContent: blocking.reasoningContent,
              thinkingContent: blocking.thinkingContent,
              content: blocking.content
                ? finalizeKgmAssistantMarkdownIfNeeded(blocking.content)
                : blocking.content,
              invocation: buildInvocationMetrics(
                this.metrics.toolCallRounds,
                baselineToolHttp,
                invokeStartedAt,
                usageAgg
              ),
              generationInfo: buildGenerationInfoFromAgg(usageAgg, httpRounds, targetModel)
            };
          }

          if (!toolCallHandler) break;

          const assistantMessage: any = {
            role: 'assistant',
            content: blocking.content || null,
            tool_calls: blockingTools
          };
          if (blocking.reasoningContent) {
            assistantMessage.reasoning_content = blocking.reasoningContent;
          }
          currentMessages.push(assistantMessage);
          for (const toolCall of blockingTools) {
            let toolResult: string;
            try {
              let args: Record<string, any>;
              try {
                args =
                  typeof toolCall.function.arguments === 'string'
                    ? JSON.parse(toolCall.function.arguments)
                    : toolCall.function.arguments;
              } catch (parseError) {
                toolResult = `参数解析失败: ${parseError instanceof Error ? parseError.message : String(parseError)}`;
                currentMessages.push({
                  role: 'tool',
                  tool_call_id: toolCall.id,
                  content: toolResult
                });
                continue;
              }
              toolResult = await toolCallHandler(toolCall.function.name, args);
            } catch (toolErr: any) {
              toolResult = `工具执行失败: ${toolErr?.message || String(toolErr)}`;
            }
            currentMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: toolResult
            });
          }
          continue;
        }

        // P1-1: 使用带超时的 fetch 请求
        // 注意：这里是流式响应（SSE/stream）。如果用默认 60s 总超时，会在模型生成较慢时被前端主动 abort，
        // 表现为“发送卡死/失败：signal is aborted without reason”。
        // 这里把“总超时”放宽到更合理的上限，避免误伤；真正的“卡死”更应由后端/连接层的 idle timeout 兜底。
        const controller = new AbortController();
        const requestTimeoutMs = isKgm
            ? resolveKgmChatTimeoutMs(this.timeout, 'stream', {
                compactAttachmentChat: Boolean(options?.kgmRequestHints?.compactAttachmentChat)
              })
            : isYueliai
              ? Math.max(this.timeout, 10 * 60 * 1000)
              : Math.max(this.timeout, 10 * 60 * 1000);
        if (isKgm) {
          lastKgmTimeoutMode = 'stream';
        }
        const timeoutId = scheduleFetchAbort(controller, requestTimeoutMs);

        const response = await fetch(apiUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(requestBody),
          signal: controller.signal
        }).finally(() => clearTimeout(timeoutId));

        if (!response.ok) {
          const errorText = await response.text();
          console.error('API Error:', response.status, errorText);
          throw new Error(
            isKgm
              ? formatKgmHttpError(response.status, errorText)
              : `HTTP error! status: ${response.status} - ${errorText}`
          );
        }

        // P2-3: 更新工具调用轮次监控
        this.metrics.toolCallRounds++;
        const kgmRouteHeaders = isKgm ? this.collectKgmRouteHeaders(response) : undefined;
        const kgmStreamStartedAt = Date.now();
        if (isKgm) {
          debugManager.logInfo('KGM 路由响应头', {
            model: targetModel,
            transport: kgmTransport,
            routeHeaders: kgmRouteHeaders
          });
        }

        // 🔧 修复: 生成 sessionId 用于去重追踪
        const streamSessionId = `stream-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        let _content = '';
        let toolCalls: any[] = [];
        let _thinkingContent = '';
        let _reasoningContent = '';
        let roundUsage: StreamUsagePatch | undefined;
        try {
          const streamResult = await this.collectStreamResponse(
            response,
            onData,
            isYueliai ? 'yueliai' : this.selectedProvider,
            targetModel,
            streamSessionId,
            { abortConnection: () => controller.abort() }
          );
          _content = streamResult.content;
          toolCalls = streamResult.toolCalls;
          _thinkingContent = streamResult.thinkingContent;
          _reasoningContent = streamResult.reasoningContent;
          roundUsage = streamResult.usage;
        } catch (streamErr) {
          if (
            isKgm &&
            transportPolicy.allowStreamDisconnectRetry &&
            isStreamDisconnectError(streamErr)
          ) {
            transportFallback = 'stream-disconnect-retry';
            debugManager.logInfo('KGM 流式中断，尝试非流式回退', {
              model: targetModel,
              error: streamErr instanceof Error ? streamErr.message : String(streamErr)
            });
            const fbTimeout = resolveKgmChatTimeoutMs(this.timeout, 'blocking');
            const fallback = await this.fetchKgmNonStreamCompletion(
              apiUrl,
              headers,
              requestBody,
              targetModel,
              onData,
              fbTimeout
            );
            _content = fallback.content;
            toolCalls = fallback.toolCalls ?? [];
            _thinkingContent = fallback.thinkingContent || '';
            _reasoningContent = fallback.reasoningContent || '';
            roundUsage = fallback.usage;
          } else {
            throw streamErr;
          }
        }

        const compactAttachment = Boolean(options?.kgmRequestHints?.compactAttachmentChat);
        const streamEmpty =
          !(_content || '').trim() && (!toolCalls || toolCalls.length === 0);
        if (isKgm && streamEmpty && transportPolicy.allowKgmNonStreamFallback) {
          console.warn(
            '[YueliCopilot] KGM 流式未收到可见正文，尝试非流式回退（stream=false）…'
          );
          debugManager.logInfo('KGM 触发非流式回退', {
            model: targetModel,
            reason: 'stream_empty_without_content_or_tool_calls',
            streamDurationMs: Date.now() - kgmStreamStartedAt,
            routeHeaders: kgmRouteHeaders,
            compactAttachment
          });
          try {
            await new Promise((r) => setTimeout(r, 1500));
            const fbTimeout = resolveKgmChatTimeoutMs(this.timeout, 'blocking');
            const fallback = await this.fetchKgmNonStreamCompletion(
              apiUrl,
              headers,
              requestBody,
              targetModel,
              onData,
              fbTimeout
            );
            if (fallback.content?.trim() || (fallback.toolCalls?.length ?? 0) > 0) {
              transportFallback = transportFallback || 'stream-empty-non-stream';
              _content = fallback.content;
              toolCalls = fallback.toolCalls?.length ? fallback.toolCalls : toolCalls;
              _thinkingContent = fallback.thinkingContent || _thinkingContent;
              _reasoningContent = fallback.reasoningContent || _reasoningContent;
              if (fallback.usage) {
                roundUsage = { ...roundUsage, ...fallback.usage };
              }
              debugManager.logInfo('KGM 非流式回退成功', {
                model: targetModel,
                contentLen: fallback.content?.length ?? 0,
                toolCallCount: fallback.toolCalls?.length ?? 0,
                fallbackDurationMs: Date.now() - kgmStreamStartedAt
              });
            }
          } catch (fallbackErr) {
            console.warn('[YueliCopilot] KGM 非流式回退失败:', fallbackErr);
            debugManager.logError('KGM 非流式回退失败', {
              model: targetModel,
              error: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
              routeHeaders: kgmRouteHeaders
            });
          }
        }

        accumulateInvocationUsage(usageAgg, roundUsage);

        lastStreamText = _content || lastStreamText;
        lastThinkingAccum = _thinkingContent || lastThinkingAccum;
        lastReasoningAccum = _reasoningContent || lastReasoningAccum;

        // 即使没有 tool calls，也可能有 reasoning content，需要返回
        if (!toolCalls || toolCalls.length === 0) {
          // P2-3: 更新延迟指标
          this.metrics.lastRequestTime = Date.now() - requestStartTime;
          this.metrics.averageLatency = 
            (this.metrics.averageLatency * (this.metrics.totalRequests - 1) + this.metrics.lastRequestTime) 
            / this.metrics.totalRequests;
          const httpRounds = this.metrics.toolCallRounds - baselineToolHttp;
          return {
            reasoningContent: _reasoningContent,
            thinkingContent: _thinkingContent,
            content: _content ? finalizeKgmAssistantMarkdownIfNeeded(_content) : _content,
            transportMeta: transportFallback ? { fallback: transportFallback } : undefined,
            invocation: buildInvocationMetrics(
              this.metrics.toolCallRounds,
              baselineToolHttp,
              invokeStartedAt,
              usageAgg
            ),
            generationInfo: buildGenerationInfoFromAgg(usageAgg, httpRounds, targetModel)
          };
        }

        if (!toolCallHandler) break;

        // P0-3: 记录工具调用以检测循环
        toolCalls.forEach(tc => {
          recentToolCalls.push(tc.function.name);
          if (recentToolCalls.length > MAX_RECENT_TOOL_CALLS) {
            recentToolCalls.shift();
          }
        });

        const assistantMessage: any = {
          role: 'assistant',
          content: _content || null,
          tool_calls: toolCalls
        };

        if (_reasoningContent) {
          assistantMessage.reasoning_content = _reasoningContent;
        }

        currentMessages.push(assistantMessage);

        // 🔧 修复: 在工具循环外追踪空响应
        let thisRoundEmptyCount = 0;

        for (const toolCall of toolCalls) {
          let toolResult: string;
          try {
            // P1-1: 安全的 JSON 解析
            let args: Record<string, any>;
            try {
              args = typeof toolCall.function.arguments === 'string'
                ? JSON.parse(toolCall.function.arguments)
                : toolCall.function.arguments;
            } catch (parseError) {
              // P2-1: 增强错误信息，提供更多调试上下文
              const rawArgs = toolCall.function.arguments;
              const errorDetail = parseError instanceof Error ? parseError.message : String(parseError);
              const truncatedArgs = typeof rawArgs === 'string' 
                ? (rawArgs.length > 200 ? rawArgs.substring(0, 200) + '...' : rawArgs)
                : JSON.stringify(rawArgs);
              
              console.error('Tool arguments parse error:', {
                toolName: toolCall.function.name,
                toolId: toolCall.id,
                rawArgs: truncatedArgs,
                error: errorDetail
              });
              
              onData({
                tool_call_error: {
                  id: toolCall.id,
                  name: toolCall.function.name,
                  error: `参数解析失败: ${errorDetail}，原始参数: ${truncatedArgs}`
                }
              });
              toolResult = `参数解析失败: ${errorDetail}`;
              currentMessages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: toolResult
              });
              continue;
            }

            onData({
              tool_call_executing: {
                id: toolCall.id,
                name: toolCall.function.name,
                args
              }
            });

            toolResult = await toolCallHandler(toolCall.function.name, args);

            onData({
              tool_call_result: {
                id: toolCall.id,
                name: toolCall.function.name,
                result: toolResult
              }
            });
          } catch (e) {
            toolResult = `工具执行失败: ${e instanceof Error ? e.message : String(e)}`;
            onData({
              tool_call_error: {
                id: toolCall.id,
                name: toolCall.function.name,
                error: toolResult
              }
            });
          }

          currentMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: toolResult
          });
          
          // 如果工具返回空结果，增加计数
          if (!toolResult || toolResult.trim() === '') {
            thisRoundEmptyCount++;
          }
        }
        
        // 🔧 修复: 累积空响应计数而不是重置
        consecutiveEmptyResponses += thisRoundEmptyCount;
        
        // P0-3: 如果累积的连续空响应过多，可能陷入循环
        if (consecutiveEmptyResponses >= 3) {
          devWarn('⚠️ 检测到连续空响应，可能陷入循环');
          onData({
            error: {
              code: 'TOOL_CALL_LOOP_DETECTED',
              message: `检测到连续 ${consecutiveEmptyResponses} 次空响应，可能陷入循环`
            }
          });
          break;
        }
      } catch (e) {
        // P1-1: 错误处理
        const error = e instanceof Error ? e : new Error(String(e));
        
        // P1-3: 通知上层异常状态（仅在非中断请求时）
        if (error.message !== 'The user aborted a request') {
          const friendly = this.formatLlmFetchError(error, apiUrl, {
            timeoutMs: this.selectedProvider === 'kgm' ? this.timeout : undefined,
            kgmTimeoutMode: this.selectedProvider === 'kgm' ? lastKgmTimeoutMode : undefined,
            kgmAbortHints:
              this.selectedProvider === 'kgm'
                ? {
                    payloadChars: kgmPayloadMeta.estimatedChars,
                    toolsCount: kgmPayloadMeta.toolsCount
                  }
                : undefined
          });
          onData({
            error: {
              code: isFetchAbortError(error) ? 'REQUEST_TIMEOUT' : 'REQUEST_FAILED',
              message: friendly.message
            }
          });
        }

        // P2-3: 更新失败指标
        this.metrics.failedRequests++;
        throw this.formatLlmFetchError(error, apiUrl, {
          timeoutMs: this.selectedProvider === 'kgm' ? this.timeout : undefined,
          kgmTimeoutMode: this.selectedProvider === 'kgm' ? lastKgmTimeoutMode : undefined,
          kgmAbortHints:
            this.selectedProvider === 'kgm'
              ? {
                  payloadChars: kgmPayloadMeta.estimatedChars,
                  toolsCount: kgmPayloadMeta.toolsCount
                }
              : undefined
        });
      }
    }

    // P2-3: 最终更新延迟指标
    this.metrics.lastRequestTime = Date.now() - requestStartTime;

    const httpRoundsEnd = this.metrics.toolCallRounds - baselineToolHttp;
    return {
      content: lastStreamText ? finalizeKgmAssistantMarkdownIfNeeded(lastStreamText) : lastStreamText,
      thinkingContent: lastThinkingAccum,
      reasoningContent: lastReasoningAccum,
      transportMeta: transportFallback ? { fallback: transportFallback } : undefined,
      invocation: buildInvocationMetrics(
        this.metrics.toolCallRounds,
        baselineToolHttp,
        invokeStartedAt,
        usageAgg
      ),
      generationInfo: buildGenerationInfoFromAgg(usageAgg, httpRoundsEnd, targetModel)
    };
  }

  /**
   * 收集流式响应，返回完整内容和 tool_calls
   * 使用 ResponseTransformer 进行规则化转换
   * 
   * 修复内容：
   * - P0-1: response.body 空值检查，防止 null 访问
   * - P0-2: Thinking/Reasoning 内容追加而非覆盖
   * - P2-1: 消息去重机制，防止重复chunk
   */
  private async collectStreamResponse(
    response: Response,
    onData: (data: any) => void,
    provider: ApiProvider,
    model?: string,
    sessionId?: string,
    streamOpts?: { abortConnection?: () => void }
  ): Promise<{
    content: string;
    toolCalls: any[];
    thinkingContent: string;
    reasoningContent: string;
    sources?: any[];
    usage?: StreamUsagePatch;
  }> {
    // P0-1: response.body 空值检查
    if (!response.body) {
      throw new Error('Response body is null - 服务器返回了空响应体，可能为错误状态码或连接中断');
    }
    
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let accumulatedData = '';
    let fullContent = '';
    // P0-2: 修正：thinking/reasoning 使用增量累积而非覆盖
    let thinkingContent = '';
    let reasoningContent = '';
    let sources: any[] = [];
    const toolCallsMap: Map<string, any> = new Map();
    let roundUsagePatch: StreamUsagePatch = {};
    let kgmRouteEventLogged = false;
    
    // P2-1: 初始化去重追踪器
    let seenContentHashes: Set<string> = new Set();
    if (sessionId) {
      if (!this.deduplicationTrackers.has(sessionId)) {
        this.deduplicationTrackers.set(sessionId, { 
          seenContentHashes: new Set(), 
          lastSeenHash: '',
          createdAt: Date.now() 
        });
      }
      seenContentHashes = this.deduplicationTrackers.get(sessionId)!.seenContentHashes;
    }

    // 构建转换上下文
    const transformContext: TransformContext = {
      provider,
      model
    };

    /** KGM/YueliAI 流式：按「有意义内容」判空闲；心跳/role 帧不重置计时 */
    const openAiStreamCompat = provider === 'kgm' || provider === 'yueliai';
    const kgmNoContentIdleMs = openAiStreamCompat ? 35000 : 0;
    /** 无可见正文时尽早结束流并走非流式回退（原 120s 易空回复） */
    const kgmNoContentMaxMs = provider === 'kgm' ? 90000 : provider === 'yueliai' ? 120000 : 0;
    const streamStartedAt = Date.now();
    let lastMeaningfulAt = Date.now();

    const touchMeaningfulStreamActivity = () => {
      lastMeaningfulAt = Date.now();
    };

    const shouldAbortKgmEmptyStream = () => {
      if (kgmNoContentIdleMs <= 0 || fullContent.trim() || toolCallsMap.size > 0) return false;
      const sinceStart = Date.now() - streamStartedAt;
      const sinceMeaningful = Date.now() - lastMeaningfulAt;
      return (
        sinceStart > 5000 &&
        (sinceMeaningful > kgmNoContentIdleMs ||
          (kgmNoContentMaxMs > 0 && sinceStart > kgmNoContentMaxMs))
      );
    };

    const computeKgmReadIdleMs = (): number => {
      if (kgmNoContentIdleMs <= 0 || fullContent.trim() || toolCallsMap.size > 0) {
        return 60_000;
      }
      const sinceStart = Date.now() - streamStartedAt;
      const sinceMeaningful = Date.now() - lastMeaningfulAt;
      const untilIdle = Math.max(500, kgmNoContentIdleMs - sinceMeaningful);
      const untilMax =
        kgmNoContentMaxMs > 0 && sinceStart > 5000
          ? Math.max(500, kgmNoContentMaxMs - sinceStart)
          : untilIdle;
      return Math.min(untilIdle, untilMax);
    };

    try {
      while (true) {
        if (shouldAbortKgmEmptyStream()) {
          devWarn(
            `[ApiService] KGM 流式无可见正文，提前结束（将尝试非流式回退）`
          );
          try {
            await reader.cancel();
          } catch {
            /* ignore */
          }
          streamOpts?.abortConnection?.();
          break;
        }

        const readIdleMs = openAiStreamCompat ? computeKgmReadIdleMs() : 0;
        const readResult = await readStreamChunkWithIdleTimeout(reader, readIdleMs);
        if (readResult === 'idle') {
          continue;
        }
        const { done, value } = readResult;
        if (done) {
          const tail = decoder.decode();
          if (tail) accumulatedData += tail;
          if (!accumulatedData.trim()) break;
          accumulatedData += '\n';
        } else {
          accumulatedData += decoder.decode(value, { stream: true });
        }

        // P1-2: 改进 SSE 行分割逻辑
        // 处理 \r\n (Windows) 和 \n (Unix) 两种换行符
        const lines = accumulatedData.split(/\r?\n/);
        // 保留最后一个可能不完整的行到缓冲区
        accumulatedData = lines.pop() || '';

        for (const line of lines) {
          // P1-2: 处理可能的 \r 结尾（某些服务器使用 \r\n）
          const trimmed = line.replace(/\r$/, '').trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;

          // SSE format
          const dataLine = trimmed.startsWith('data: ') ? trimmed.slice(6) : trimmed;
          if (!dataLine) continue;

          try {
            const rawData = JSON.parse(dataLine);
            if (provider === 'kgm' && rawData?.kgm && !kgmRouteEventLogged) {
              kgmRouteEventLogged = true;
              debugManager.logInfo('KGM 流式路由元数据', {
                model,
                kgm: rawData.kgm
              });
            }

            const usagePatch = extractUsageFromSsePayload(rawData);
            if (usagePatch) {
              roundUsagePatch = { ...roundUsagePatch, ...usagePatch };
            }

            if (isPureOpenAiUsageChunk(rawData)) {
              continue;
            }
            
            // P2-1: 内容去重 - 计算内容hash
            const contentHash = this.hashContent(rawData);
            if (contentHash && seenContentHashes.has(contentHash)) {
              // 跳过重复内容
              continue;
            }
            if (contentHash) {
              seenContentHashes.add(contentHash);
              // 更新 lastSeenHash
              if (sessionId && this.deduplicationTrackers.has(sessionId)) {
                this.deduplicationTrackers.get(sessionId)!.lastSeenHash = contentHash;
              }
            }

            // 使用 ResponseTransformer 进行规则化转换
            const normalizedResponse = responseTransformer.transform(rawData, transformContext);

            // P1-2: 响应验证失败处理 - 严重错误时中断流程
            const validation = responseTransformer.validate(normalizedResponse);
            if (!validation.valid) {
              devWarn('⚠️ Response validation failed:', validation.errors);
              // 检查是否为严重错误（tool_call缺少必要字段）
              const hasCriticalError = validation.errors.some(e => 
                e.includes('Tool call') && e.includes('missing')
              );
              if (hasCriticalError) {
                devError('Critical validation error detected, aborting stream');
                break;
              }
            }

            // P0-2: 收集数据 - 使用追加而非覆盖
            if (normalizedResponse.content) {
              fullContent += coerceKgmStreamTextChunk(normalizedResponse.content);
              touchMeaningfulStreamActivity();
            }
            // P0-2 关键修复：thinking 内容应该追加而非覆盖
            if (normalizedResponse.thinking) {
              thinkingContent += normalizedResponse.thinking;
              touchMeaningfulStreamActivity();
            }
            // P0-2 关键修复：reasoning 内容应该追加而非覆盖
            if (normalizedResponse.reasoning) {
              reasoningContent += normalizedResponse.reasoning;
              touchMeaningfulStreamActivity();
            }
            if (normalizedResponse.sources && normalizedResponse.sources.length > 0) {
              sources = this.mergeDedupedStreamSources(sources, normalizedResponse.sources);
            }
            if (normalizedResponse.toolCalls && normalizedResponse.toolCalls.length > 0) {
              touchMeaningfulStreamActivity();
              const toolCalls = normalizedResponse.toolCalls;
              for (const tc of toolCalls) {
                // 使用 tool_call id 作为唯一键，避免重复
                const toolId = tc.id || `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                if (!toolCallsMap.has(toolId)) {
                  toolCallsMap.set(toolId, {
                    id: toolId,
                    type: 'function',
                    function: {
                      name: tc.name,
                      arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments)
                    }
                  });
                }
              }
            }

            // 构建回调数据
            const callbackData: any = {};

            if (normalizedResponse.type === 'content' || normalizedResponse.type === 'thinking') {
              callbackData.message = {
                content: normalizedResponse.content,
                role: 'assistant',
                // P0-2: 传递累积的 thinking/reasoning 内容
                thinking: thinkingContent || undefined,
                reasoning_content: reasoningContent || undefined
              };

              if (provider === 'kgm' && rawData.choices && rawData.choices[0]) {
                const choice = rawData.choices[0];
                callbackData.done = choice.finish_reason === 'stop' || choice.finish_reason === 'tool_calls';
              }

              if (sources.length > 0) {
                callbackData.sources = sources;
              }
            } else if (normalizedResponse.type === 'tool_call') {
              callbackData.message = {
                content: normalizedResponse.content,
                role: 'assistant'
              };
            }

            onData(callbackData);

          } catch (e) {
            // 解析错误通常是非JSON行，静默忽略
            // 但记录调试信息
            debugManager.logTransform('JSON解析错误', { line: dataLine?.substring(0, 100), error: String(e) });
          }
        }

        if (done) break;
      }
    } finally {
      // P0-1: 确保 reader 被正确释放，防止内存泄漏
      try {
        await reader.cancel();
      } catch (e) {
        // 忽略取消错误
      }
      
      // P1-6: 改进清理逻辑 - 基于时间和使用状态，而非简单保留最后 N 个
      // 只清理超过 5 分钟且不是当前 session 的追踪器
      const CLEANUP_THRESHOLD_MS = 5 * 60 * 1000; // 5 分钟
      const now = Date.now();
      
      if (this.deduplicationTrackers.size > 5) {
        const keysToDelete: string[] = [];
        
        for (const [key, tracker] of this.deduplicationTrackers.entries()) {
          // 不清理当前 session
          if (key === sessionId) continue;
          
          // 清理超过阈值的旧追踪器
          if (now - tracker.createdAt > CLEANUP_THRESHOLD_MS) {
            keysToDelete.push(key);
          }
        }
        
        keysToDelete.forEach(key => this.deduplicationTrackers.delete(key));
        
        if (keysToDelete.length > 0) {
          devDebug(`[ApiService] 清理了 ${keysToDelete.length} 个过期的去重追踪器`);
        }
      }
    }

    const toolCalls = Array.from(toolCallsMap.values());
    const usage = Object.keys(roundUsagePatch).length > 0 ? roundUsagePatch : undefined;

    let resolvedContent = fullContent;
    if (!resolvedContent.trim() && thinkingContent.trim()) {
      const extracted = extractVisibleAnswerFromThinking(thinkingContent);
      if (extracted) resolvedContent = extracted;
    }

    if (!resolvedContent.trim()) {
      this.logEmptyChatStreamDiagnostic({
        provider,
        model,
        thinkingChars: thinkingContent.length,
        reasoningChars: reasoningContent.length,
        usage,
        toolCallCount: toolCalls.length
      });
    }

    return {
      content: resolvedContent ? finalizeKgmAssistantMarkdownIfNeeded(resolvedContent) : resolvedContent,
      toolCalls,
      thinkingContent,
      reasoningContent,
      sources: sources.length > 0 ? sources : undefined,
      usage
    };
  }

  private collectKgmRouteHeaders(response: Response): Record<string, string> {
    const out: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      const k = key.toLowerCase();
      if (
        k === 'x-request-id' ||
        k === 'x-trace-id' ||
        k === 'x-kgm-trace-id' ||
        k === 'x-kgm-route' ||
        k === 'x-kgm-upstream' ||
        k === 'x-kgm-model' ||
        k === 'x-kgm-fallback' ||
        k.startsWith('x-kgm-')
      ) {
        out[k] = value;
      }
    });
    return out;
  }

  /**
   * KGM 流式无正文时回退：与 curl 非 stream 一致（用户侧验证 stream=false 可出字）
   */
  private async fetchKgmNonStreamCompletion(
    apiUrl: string,
    headers: Record<string, string>,
    requestBody: Record<string, unknown>,
    model: string,
    onData?: (data: any) => void,
    timeoutMs?: number
  ): Promise<{
    content: string;
    toolCalls: any[];
    thinkingContent: string;
    reasoningContent: string;
    usage?: StreamUsagePatch;
  }> {
    const body = { ...requestBody, stream: false };
    delete (body as { stream_options?: unknown }).stream_options;

    const controller = new AbortController();
    const effectiveTimeoutMs =
      typeof timeoutMs === 'number' && timeoutMs >= 60_000
        ? Math.min(timeoutMs, 900_000)
        : resolveKgmChatTimeoutMs(timeoutMs ?? this.timeout, 'blocking');
    const timeoutId = scheduleFetchAbort(controller, effectiveTimeoutMs);

    let resp: Response;
    try {
      resp = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      throw new Error(formatKgmHttpError(resp.status, errText));
    }

    const json = await resp.json().catch(() => null);
    const usage = extractUsageFromSsePayload(json) ?? undefined;
    const choice = json?.choices?.[0];
    const msg = choice?.message ?? {};
    let content = coerceKgmStreamTextChunk(msg.content ?? '');
    const thinkingContent = typeof msg.thinking === 'string' ? msg.thinking : '';
    const reasoningContent =
      typeof msg.reasoning_content === 'string' ? msg.reasoning_content : '';

    const toolCalls: any[] = [];
    const rawTools = msg.tool_calls;
    if (Array.isArray(rawTools)) {
      for (let idx = 0; idx < rawTools.length; idx++) {
        const tc = rawTools[idx];
        toolCalls.push({
          id: tc?.id || `call_${idx}_${Date.now()}`,
          type: 'function',
          function: {
            name: tc?.function?.name || '',
            arguments:
              typeof tc?.function?.arguments === 'string'
                ? tc.function.arguments
                : JSON.stringify(tc?.function?.arguments ?? {})
          }
        });
      }
    }

    if (!content.trim() && thinkingContent.trim()) {
      const extracted = extractVisibleAnswerFromThinking(thinkingContent);
      if (extracted) content = extracted;
    }

    if ((content || toolCalls.length > 0) && onData) {
      onData({
        message: {
          content: content || undefined,
          role: 'assistant',
          thinking: thinkingContent || undefined,
          reasoning_content: reasoningContent || undefined
        },
        done: !toolCalls.length
      });
    }

    debugManager.logInfo('KGM 阻塞式响应完成', {
      model,
      contentLen: content.length,
      toolCallCount: toolCalls.length,
      completionTokens: usage?.completionTokens,
      kgm: json?.kgm
    });

    return {
      content: content ? finalizeKgmAssistantMarkdownIfNeeded(content) : content,
      toolCalls,
      thinkingContent,
      reasoningContent,
      usage
    };
  }

  /** 上游 SSE 结束但正文为空时写入控制台与 Debug 面板（便于 Electron 右键 Inspect 排查） */
  private logEmptyChatStreamDiagnostic(payload: Record<string, unknown>): void {
    const title = '[YueliCopilot] 聊天流结束但正文为空';
    // 生产 Electron 构建也输出，devConsole 在 PROD 下静默
    console.warn(title, payload);
    debugManager.logError(title, payload);
  }
  
  /**
   * P0-1: 计算内容hash用于去重
   * 修复：同时考虑 content、thinking、reasoning_content 字段
   * 避免因 content 相同但 thinking 不同导致的误去重
   */
  private hashContent(data: any): string | null {
    try {
      // 提取所有相关内容字段
      const content =
        data?.choices?.[0]?.delta?.content ||
        data?.message?.content ||
        data?.content ||
        data?.response;
      
      // P0-1 修复：同时提取 thinking 和 reasoning 字段
      const thinking =
        data?.choices?.[0]?.delta?.thinking || data?.message?.thinking || data?.thinking;

      const reasoning =
        data?.choices?.[0]?.delta?.reasoning_content ||
        data?.message?.reasoning_content ||
        data?.reasoning_content ||
        data?.reasoning;

      const toolDelta = data?.choices?.[0]?.delta?.tool_calls;
      const toolSig =
        Array.isArray(toolDelta) && toolDelta.length > 0 ? JSON.stringify(toolDelta) : '';

      // 如果所有字段都为空，返回 null（不进行去重）
      if (!content && !thinking && !reasoning && !toolSig) {
        return null;
      }
      
      // 组合所有内容字段，确保任一字段变化都会导致不同的 hash（含 tool_calls，避免多轮仅工具增量被误判重复）
      const combined = `${content || ''}|${thinking || ''}|${reasoning || ''}|${toolSig}`;
      
      // 使用更可靠的 hash 算法
      let hash = 0;
      for (let i = 0; i < combined.length; i++) {
        const char = combined.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
      }
      return hash.toString(36);
    } catch {
      return null;
    }
  }

  /** Anthropic Messages SSE（stream=true）：解析 content_block_*、tool_use JSON delta、message_delta.usage */
  private async collectAnthropicStreamResponse(
    response: Response,
    onData: (data: any) => void
  ): Promise<{ content: string; toolCalls: ParsedAnthropicToolCall[]; usage?: StreamUsagePatch }> {
    if (!response.body) {
      throw new Error('Anthropic: response body is null');
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    type Block =
      | { kind: 'text'; text: string }
      | { kind: 'tool'; id: string; name: string; json: string };
    const blocks = new Map<number, Block>();
    let usagePatch: StreamUsagePatch | undefined;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const sseBlocks = buffer.split('\n\n');
      buffer = sseBlocks.pop() || '';

      for (const block of sseBlocks) {
        let eventType = '';
        const dataPieces: string[] = [];
        for (const rawLine of block.split('\n')) {
          const line = rawLine.replace(/\r$/, '').trim();
          if (!line) continue;
          if (line.startsWith('event:')) eventType = line.slice(6).trim();
          else if (line.startsWith('data:')) dataPieces.push(line.slice(5).trim());
        }
        const dataStr = dataPieces.join('');
        if (!dataStr || dataStr === '[DONE]') continue;
        try {
          const data = JSON.parse(dataStr);
          const typ =
            (data && typeof data === 'object' && typeof data.type === 'string' ? data.type : '') ||
            eventType;

          if (typ === 'content_block_start' && data.content_block) {
            const cb = data.content_block as Record<string, unknown>;
            if (cb.type === 'text') blocks.set(data.index, { kind: 'text', text: '' });
            else if (cb.type === 'tool_use' && typeof cb.id === 'string' && typeof cb.name === 'string') {
              blocks.set(data.index, { kind: 'tool', id: cb.id, name: cb.name, json: '' });
            }
          }

          if (typ === 'content_block_delta') {
            const b = blocks.get(data.index);
            if (!b) continue;
            const delta = data.delta as Record<string, unknown> | undefined;
            if (
              b.kind === 'text' &&
              delta?.type === 'text_delta' &&
              typeof delta.text === 'string'
            ) {
              b.text += delta.text;
              onData({
                message: { content: delta.text, role: 'assistant' },
                done: false
              });
            }
            if (b.kind === 'tool' && delta?.type === 'input_json_delta') {
              const pj = delta.partial_json;
              if (typeof pj === 'string') b.json += pj;
            }
          }

          if (typ === 'message_delta' && data.usage && typeof data.usage === 'object') {
            const u = data.usage as Record<string, unknown>;
            const inp = u.input_tokens;
            const outTok = u.output_tokens;
            usagePatch = {};
            if (typeof inp === 'number' && Number.isFinite(inp)) usagePatch.promptTokens = inp;
            if (typeof outTok === 'number' && Number.isFinite(outTok)) usagePatch.completionTokens = outTok;
            if (
              typeof inp === 'number' &&
              typeof outTok === 'number' &&
              Number.isFinite(inp) &&
              Number.isFinite(outTok)
            ) {
              usagePatch.totalTokens = inp + outTok;
            }
          }
        } catch {
          /* 跳过畸形帧 */
        }
      }
    }

    const indices = [...blocks.keys()].sort((a, b) => a - b);
    let fullContent = '';
    const toolCalls: ParsedAnthropicToolCall[] = [];

    for (const i of indices) {
      const b = blocks.get(i)!;
      if (b.kind === 'text') fullContent += b.text;
      if (b.kind === 'tool') {
        let input: Record<string, unknown> = {};
        try {
          input = b.json ? (JSON.parse(b.json) as Record<string, unknown>) : {};
        } catch {
          input = {};
        }
        toolCalls.push({ id: b.id, name: b.name, input });
      }
    }

    return { content: fullContent, toolCalls, usage: usagePatch };
  }

  /** Claude Messages API：tools 流式 + OpenAI 风格多轮 tool 循环对齐 */
  private async sendAnthropicMessageWithMessages(
    model: string,
    messages: any[],
    onData: (data: any) => void,
    options: {
      tools?: ToolDefinition[];
      toolCallHandler?: ToolCallHandler;
      maxToolRounds?: number;
      invokeStartedAt: number;
    }
  ): Promise<
    | undefined
    | {
        reasoningContent?: string;
        thinkingContent?: string;
        content?: string;
        invocation?: MessageMetrics;
        generationInfo?: GenerationInfoEnvelope;
      }
  > {
    const { tools, toolCallHandler, maxToolRounds = 5 } = options;
    const invokeStartedAt = options.invokeStartedAt;
    const rawModel = model.includes(':') ? model.split(':').slice(1).join(':') : model;
    const adapter = createLLMAdapter('anthropic');
    const apiUrl = adapter.resolveApiUrl(this.anthropicBaseUrl.replace(/\/$/, ''), false);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01',
      Accept: 'application/json',
      'Accept-Language': 'en'
    };
    if (this.anthropicApiKey) {
      headers['x-api-key'] = this.anthropicApiKey;
    }

    let currentMessages = [...messages];
    let round = 0;
    const baselineToolHttp = this.metrics.toolCallRounds;
    const usageAgg = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let lastStreamText = '';

    while (round < maxToolRounds) {
      round++;

      const body = adapter.buildRequestBody({
        model: rawModel,
        messages: currentMessages,
        tools,
        stream: true
      });

      const controller = new AbortController();
      const requestTimeoutMs = Math.max(this.timeout, 10 * 60 * 1000);
      const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs);

      let response: Response;
      try {
        response = await fetch(apiUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
          signal: controller.signal
        });
      } finally {
        clearTimeout(timeoutId);
      }

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Anthropic API error ${response.status}: ${errText}`);
      }

      this.metrics.toolCallRounds++;

      const { content, toolCalls, usage } = await this.collectAnthropicStreamResponse(response, onData);
      accumulateInvocationUsage(usageAgg, usage);

      lastStreamText = content || lastStreamText;

      const openAiToolCalls =
        toolCalls?.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: {
            name: tc.name,
            arguments: JSON.stringify(tc.input ?? {})
          }
        })) ?? [];

      if (!openAiToolCalls.length) {
        const finalized = lastStreamText ? finalizeKgmAssistantMarkdownIfNeeded(lastStreamText) : lastStreamText;
        onData({ done: true });
        const httpRounds = this.metrics.toolCallRounds - baselineToolHttp;
        return {
          content: finalized,
          invocation: buildInvocationMetrics(
            this.metrics.toolCallRounds,
            baselineToolHttp,
            invokeStartedAt,
            usageAgg
          ),
          generationInfo: buildGenerationInfoFromAgg(usageAgg, httpRounds, model)
        };
      }

      if (!toolCallHandler) {
        const finalized = lastStreamText ? finalizeKgmAssistantMarkdownIfNeeded(lastStreamText) : lastStreamText;
        onData({ done: true });
        const httpRounds = this.metrics.toolCallRounds - baselineToolHttp;
        return {
          content: finalized,
          invocation: buildInvocationMetrics(
            this.metrics.toolCallRounds,
            baselineToolHttp,
            invokeStartedAt,
            usageAgg
          ),
          generationInfo: buildGenerationInfoFromAgg(usageAgg, httpRounds, model)
        };
      }

      currentMessages.push({
        role: 'assistant',
        content: content || null,
        tool_calls: openAiToolCalls
      });

      for (const toolCall of openAiToolCalls) {
        let toolResult = '';
        try {
          let args: Record<string, any>;
          try {
            args =
              typeof toolCall.function.arguments === 'string'
                ? JSON.parse(toolCall.function.arguments)
                : toolCall.function.arguments;
          } catch (parseError) {
            const rawArgs = toolCall.function.arguments;
            const errorDetail =
              parseError instanceof Error ? parseError.message : String(parseError);
            const truncatedArgs =
              typeof rawArgs === 'string'
                ? rawArgs.length > 200
                  ? rawArgs.substring(0, 200) + '...'
                  : rawArgs
                : JSON.stringify(rawArgs);

            onData({
              tool_call_error: {
                id: toolCall.id,
                name: toolCall.function.name,
                error: `参数解析失败: ${errorDetail}，原始参数: ${truncatedArgs}`
              }
            });
            toolResult = `参数解析失败: ${errorDetail}`;
            currentMessages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: toolResult
            });
            continue;
          }

          onData({
            tool_call_executing: {
              id: toolCall.id,
              name: toolCall.function.name,
              args
            }
          });

          toolResult = await toolCallHandler(toolCall.function.name, args);

          onData({
            tool_call_result: {
              id: toolCall.id,
              name: toolCall.function.name,
              result: toolResult
            }
          });
        } catch (e) {
          toolResult = `工具执行失败: ${e instanceof Error ? e.message : String(e)}`;
          onData({
            tool_call_error: {
              id: toolCall.id,
              name: toolCall.function.name,
              error: toolResult
            }
          });
        }

        currentMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: toolResult
        });
      }
    }

    onData({ done: true });
    const finalized = lastStreamText ? finalizeKgmAssistantMarkdownIfNeeded(lastStreamText) : lastStreamText;
    const httpRounds = this.metrics.toolCallRounds - baselineToolHttp;
    return {
      content: finalized,
      invocation: buildInvocationMetrics(
        this.metrics.toolCallRounds,
        baselineToolHttp,
        invokeStartedAt,
        usageAgg
      ),
      generationInfo: buildGenerationInfoFromAgg(usageAgg, httpRounds, model)
    };
  }

  /**
   * P0-3: 根据 Provider 构建请求体
   * 修复：Ollama 使用 prompt 而非 messages 数组
   */
  private buildRequestBody(options: {
    provider: ApiProvider;
    model: string;
    messages: any[];
    tools?: any[];
    toolCallHandler?: Function;
    provider_hints?: UnifiedChatParams['provider_hints'];
    structured_output?: UnifiedChatParams['structured_output'];
  }): any {
    const { provider, model, messages, tools, toolCallHandler, provider_hints, structured_output } =
      options;
    const adapter = createLLMAdapter(provider);
    const toolCount = tools?.length ?? 0;
    const kgmTransport =
      provider === 'kgm' ? decideKgmChatTransport({ toolCount }) : 'stream';
    const stream =
      provider === 'kgm'
        ? kgmRequestUsesStream(kgmTransport)
        : provider === 'yueliai'
          ? true
          : true;
    return adapter.buildRequestBody({
      model,
      messages,
      tools,
      toolCallHandler,
      stream,
      provider_hints,
      structured_output
    });
  }
  
  /**
   * P2-3: 获取监控指标
   */
  getMetrics() {
    return { ...this.metrics };
  }
  
  /**
   * P2-3: 重置监控指标
   */
  resetMetrics() {
    this.metrics = {
      totalRequests: 0,
      failedRequests: 0,
      toolCallRounds: 0,
      averageLatency: 0,
      lastRequestTime: 0
    };
  }

  async sendOllamaMessage(
    model: string,
    message: string,
    stream: boolean = true,
    onData?: (data: any) => void
  ) {
    if (stream && onData) {
      await this.sendOllamaMessageWithMessages(model, [{ role: 'user', content: message }], onData);
      return;
    }

    // 检查是否使用本地KGM运行时
    if (this.selectedProvider === 'kgm' && this.runtime) {
      try {
        // 使用本地KGM运行时处理请求
        const requestBody = {
          model,
          messages: [{ role: 'user', content: message }],
          stream: false
        };

        // 调用KGM运行时的execute方法
        const result = await this.runtime.execute(requestBody);
        return result;
      } catch (error) {
        console.error('KGM runtime execution failed:', error);
        // 失败时回退到网络请求
      }
    }

    // 回退到网络请求
    let baseUrl = this.selectedProvider === 'kgm' ? this.kgmBaseUrl : this.ollamaBaseUrl;
    let apiKey = this.selectedProvider === 'kgm' ? this.kgmApiKey : '';
    let targetModel =
      this.selectedProvider === 'kgm' ? this.normalizeKgmRequestModel(model) : model;

    const viteEnv = (import.meta as any).env || {};
    if (baseUrl.includes('${KGM_PORT}')) {
      const kgmPort = resolveKgmPortPlaceholder(viteEnv);
      baseUrl = baseUrl.replace('${KGM_PORT}', kgmPort);
    }

    const apiUrl =
      this.selectedProvider === 'kgm'
        ? this.resolveKgmChatHttpEndpoint().apiUrl
        : `${baseUrl}/api/generate`;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
    // 设置 Accept-Language 头部，避免浏览器自动添加不支持的语言代码
    headers['Accept-Language'] = 'en';

    const body =
      this.selectedProvider === 'ollama'
        ? {
            model: targetModel,
            prompt: `[User] ${message}`,
            stream: false,
            options: { temperature: 0.7, num_predict: 2048 }
          }
        : {
            model: targetModel,
            messages: [{ role: 'user', content: message }],
            stream: false
          };

    const response = await axios.post(apiUrl, body, { headers });

    return response.data;
  }

  async getKnowledgeBases() {
    const client = this.getClient();
    const response = await client.get('/v1/kgm/models');
    return response.data;
  }

  // ==================== KGM 沙箱管理 ====================

  async listSandboxes() {
    const response = await fetch(`${this.kgmBaseUrl}/v1/kgm/sandboxes`, {
      headers: this.kgmApiKey ? { 'Authorization': `Bearer ${this.kgmApiKey}` } : {}
    });
    if (!response.ok) throw new Error(`Failed to list sandboxes: ${response.status}`);
    return response.json();
  }

  async createSandbox(kind: 'computer' | 'browser' | 'mobile' = 'computer', options: Record<string, any> = {}) {
    const response = await fetch(`${this.kgmBaseUrl}/v1/kgm/sandboxes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.kgmApiKey ? { 'Authorization': `Bearer ${this.kgmApiKey}` } : {})
      },
      body: JSON.stringify({ kind, ...options })
    });
    if (!response.ok) throw new Error(`Failed to create sandbox: ${response.status}`);
    return response.json();
  }

  async startSandbox(sandboxId: string) {
    const response = await fetch(`${this.kgmBaseUrl}/v1/kgm/sandboxes/${sandboxId}/start`, {
      method: 'POST',
      headers: this.kgmApiKey ? { 'Authorization': `Bearer ${this.kgmApiKey}` } : {}
    });
    if (!response.ok) throw new Error(`Failed to start sandbox: ${response.status}`);
    return response.json();
  }

  async stopSandbox(sandboxId: string) {
    const response = await fetch(`${this.kgmBaseUrl}/v1/kgm/sandboxes/${sandboxId}/stop`, {
      method: 'POST',
      headers: this.kgmApiKey ? { 'Authorization': `Bearer ${this.kgmApiKey}` } : {}
    });
    if (!response.ok) throw new Error(`Failed to stop sandbox: ${response.status}`);
    return response.json();
  }

  async getSandbox(sandboxId: string) {
    const response = await fetch(`${this.kgmBaseUrl}/v1/kgm/sandboxes/${sandboxId}`, {
      headers: this.kgmApiKey ? { 'Authorization': `Bearer ${this.kgmApiKey}` } : {}
    });
    if (!response.ok) throw new Error(`Failed to get sandbox: ${response.status}`);
    return response.json();
  }

  /**
   * PDF 委员会：单次非流式短推理（max_tokens 受限，超时 120s）。
   */
  async kgmCommitteeComplete(
    model: string,
    messages: Array<{ role: string; content: string }>
  ): Promise<string | null> {
    const fetchRoot = this.resolveKgmApiFetchRoot();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120_000);
    try {
      const resp = await fetch(`${fetchRoot}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.kgmApiKey ? { Authorization: `Bearer ${this.kgmApiKey}` } : {})
        },
        body: JSON.stringify({
          model,
          messages,
          stream: false,
          max_tokens: 1400,
          think: false
        }),
        signal: controller.signal
      });
      if (!resp.ok) return null;
      const json = await resp.json();
      const msg = json?.choices?.[0]?.message;
      const content = msg?.content;
      return typeof content === 'string' ? content : null;
    } catch (e) {
      devWarn('[ApiService] kgmCommitteeComplete 失败', e);
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // ==================== KGM 向量/记忆 ====================

  private resolveKgmApiFetchRoot(): string {
    let baseUrl = this.kgmBaseUrl;
    const viteEnv = (import.meta as any).env || {};
    if (baseUrl.includes('${KGM_PORT}')) {
      baseUrl = baseUrl.replace('${KGM_PORT}', resolveKgmPortPlaceholder(viteEnv));
    }
    return `${this.resolveBrowserKgmFetchBase(baseUrl, false)}`.replace(/\/$/, '');
  }

  async kgmMemorySearch(query: string, collection?: string, topK = 5) {
    const { buildKgmMemorySearchBody, normalizeKgmMemorySearchResponse } = await import(
      './kgmMemoryApi'
    );
    const fetchRoot = this.resolveKgmApiFetchRoot();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch(`${fetchRoot}/v1/kgm/memory/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.kgmApiKey ? { Authorization: `Bearer ${this.kgmApiKey}` } : {})
        },
        body: JSON.stringify(buildKgmMemorySearchBody(query, collection, topK)),
        signal: controller.signal
      });
      if (!response.ok) {
        devWarn(`[ApiService] kgmMemorySearch HTTP ${response.status}`);
        return null;
      }
      const data = await response.json();
      return normalizeKgmMemorySearchResponse(data);
    } catch (e) {
      if (isFetchAbortError(e)) {
        devWarn('[ApiService] kgmMemorySearch 超时或已取消');
      }
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async kgmMemoryStore(content: string, metadata?: Record<string, any>, collection?: string) {
    const { buildKgmMemoryStoreBody } = await import('./kgmMemoryApi');
    const fetchRoot = this.resolveKgmApiFetchRoot();
    const response = await fetch(`${fetchRoot}/v1/kgm/memory`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.kgmApiKey ? { 'Authorization': `Bearer ${this.kgmApiKey}` } : {})
      },
      body: JSON.stringify(buildKgmMemoryStoreBody(content, metadata, collection))
    });
    if (!response.ok) {
      let detail = '';
      try {
        const err = await response.json();
        detail = err?.error?.message || err?.message || JSON.stringify(err);
      } catch {
        detail = await response.text().catch(() => '');
      }
      devWarn(`[ApiService] kgmMemoryStore HTTP ${response.status}`, detail.slice(0, 200));
      return null;
    }
    return response.json();
  }

  // ==================== KGM 工具清单 ====================

  async getKgmTools() {
    const response = await fetch(`${this.kgmBaseUrl}/v1/kgm/tools`, {
      headers: this.kgmApiKey ? { 'Authorization': `Bearer ${this.kgmApiKey}` } : {}
    });
    if (!response.ok) return [];
    const data = await response.json();
    return data.tools || data || [];
  }

  async generateTitle(userMessage: string, model: string = 'qwen3.5:latest'): Promise<string> {
    const prompt = `请为以下用户对话生成一个简短、有意义的标题（不超过30个字符）：

用户消息：${userMessage}

要求：
1. 标题要简洁明了，能够概括对话主题
2. 不要使用泛泛的标题如"新对话"、"关于某主题"
3. 使用中文
4. 最多30个字符

请只返回标题内容，不要添加其他文字。`;

    try {
      if (this.selectedProvider === 'kgm' && this.runtime) {
        const result = await this.runtime.execute({
          model,
          messages: [{ role: 'user', content: prompt }],
          stream: false
        });
        return result.content?.trim() || userMessage.substring(0, 30);
      }

      let baseUrl = this.selectedProvider === 'kgm' ? this.kgmBaseUrl : this.ollamaBaseUrl;
      let apiKey = this.selectedProvider === 'kgm' ? this.kgmApiKey : '';
      const targetModel =
        this.selectedProvider === 'kgm' ? this.normalizeKgmRequestModel(model) : model;

      const viteEnv = (import.meta as any).env || {};
      if (baseUrl.includes('${KGM_PORT}')) {
        const kgmPort = resolveKgmPortPlaceholder(viteEnv);
        baseUrl = baseUrl.replace('${KGM_PORT}', kgmPort);
      }
      const apiUrl =
        this.selectedProvider === 'kgm'
          ? this.resolveKgmChatHttpEndpoint().apiUrl
          : `${baseUrl}/api/generate`;

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`;
      }
      headers['Accept-Language'] = 'en';

      const response = await axios.post(apiUrl, {
        model: targetModel,
        messages: [{ role: 'user', content: prompt }],
        stream: false
      }, { headers });

      if (response.data.choices && response.data.choices[0] && response.data.choices[0].message) {
        return response.data.choices[0].message.content?.trim() || userMessage.substring(0, 30);
      } else if (response.data.message) {
        return response.data.message.content?.trim() || userMessage.substring(0, 30);
      } else if (response.data.content) {
        return response.data.content?.trim() || userMessage.substring(0, 30);
      }
      
      return userMessage.substring(0, 30);
    } catch (error) {
      console.error('Failed to generate title:', error);
      return userMessage.trim().substring(0, 30);
    }
  }
}

const apiService = new ApiService();
export { apiService };
export default apiService;
