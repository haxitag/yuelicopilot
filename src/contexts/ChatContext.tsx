import React, { createContext, useState, useContext, useCallback, useEffect, useRef } from 'react';
import { Message, MessageMetrics, RenderedOutput, SkillInstallRequest } from '../types';
import apiService, { ToolDefinition, ToolCallHandler } from '../api/services/apiService';
import { CoreOrchestratorV2, getDefaultOrchestrator } from '../services/core';
import { SkillExecutor } from '../services/SkillExecutor';
import { MCPConnectorManager } from '../services/MCPConnectorManager';
import { getMCPRuntime } from '../services/mcp/MCPRuntime';
import { readRecentSkillIds, selectSkillIdsForTools } from '../services/chat/ToolSelection';
import { recallSkillRoutingScoresFromMemory } from '../services/chat/ToolRoutingRecall';
import {
  filterSkillIdsByToolsetAllowlist,
  filterToolDefinitionsByAllowlist,
  resolveEnabledToolsetLogicalNames
} from '../services/chat/ToolsetToolFilter';
import { readKnowledgeScopeMode } from '../services/chat/KnowledgeScope';

export interface KnowledgeItem {
  id: string;
  name: string;
  content: string;
  type: 'file' | 'text' | 'url';
  indexed?: boolean;      // 是否已写入向量索引
  indexedAt?: string;     // 写入时间
  chunkCount?: number;    // 分块数量
}

interface ChatContextType {
  currentThread: string | null;
  setCurrentThread: (threadId: string | null) => void;
  messages: Message[];
  addMessage: (message: Message) => void;
  clearMessages: () => void;
  connectWebSocket: (onMessage: (data: any) => void, onError: (error: any) => void) => void;
  disconnectWebSocket: () => void;
  sendWebSocketMessage: (data: any) => void;
  loadOllamaModels: () => Promise<any>;
  sendOllamaMessage: (model: string, message: string, stream: boolean, onData: (data: any) => void) => Promise<void>;
  sendOllamaMessageWithMessages: (
    model: string,
    messages: any[],
    onData: (data: any) => void,
    options?: {
      tools?: ToolDefinition[];
      toolCallHandler?: ToolCallHandler;
      enabledSkillIds?: string[];
    }
  ) => Promise<
    | undefined
    | {
        reasoningContent?: string;
        thinkingContent?: string;
        content?: string;
        invocation?: MessageMetrics;
      }
  >;
  orchestrator: CoreOrchestratorV2;
  skillExecutor: SkillExecutor;
  connectorManager: MCPConnectorManager;
  processWithOrchestrator: (
    input: string,
    selectedSkills?: string[],
    selectedConnectors?: any[],
    selectedTemplate?: string,
    onStage?: (evt: { runId: string; stage: string; at: number; message?: string }) => void
  ) => Promise<{
    enhancedPrompt?: string;
    connectorData?: Record<string, any>;
    renderedOutput?: RenderedOutput;
    shouldUseLLM: boolean;
    tools?: ToolDefinition[];
    toolCallHandler?: ToolCallHandler;
    ragContext?: string;
    /** 检测到的技能安装请求 */
    skillInstallRequests?: SkillInstallRequest[];
  }>;
  /** 分析输入中的技能 URL */
  analyzeSkillUrls: (input: string) => Promise<SkillInstallRequest[]>;
  /** 从 URL 安装技能 */
  installSkillFromUrl: (url: string) => Promise<{ success: boolean; skill?: any; error?: string }>;
  knowledgeItems: KnowledgeItem[];
  addKnowledgeItem: (item: KnowledgeItem) => Promise<void>;
  removeKnowledgeItem: (id: string) => void;

  /** processWithOrchestrator 最近一次解析出的、实际注入 LLM 的 skillIds（Top-K 之后） */
  lastToolRoundSkillIds: string[];
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

export const useChat = () => {
  const context = useContext(ChatContext);
  if (context === undefined) throw new Error('useChat must be used within a ChatProvider');
  return context;
};

export const ChatProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentThread, setCurrentThread] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [knowledgeItems, setKnowledgeItems] = useState<KnowledgeItem[]>([]);
  const [lastToolRoundSkillIds, setLastToolRoundSkillIds] = useState<string[]>([]);

  const orchestratorRef = useRef<CoreOrchestratorV2>(getDefaultOrchestrator());

  // Initialize MCP runtime
  useEffect(() => {
    const runtime = getMCPRuntime();
    runtime.connectAll().catch(e => console.warn('MCP runtime init:', e));
  }, []);

  const addMessage = useCallback((message: Message) => {
    setMessages(prev => [...prev, message]);
  }, []);

  const clearMessages = useCallback(() => setMessages([]), []);

  /**
   * 将文本按固定大小分块，相邻块有重叠以保留上下文
   */
  const chunkText = (text: string, chunkSize = 800, overlap = 100): string[] => {
    const chunks: string[] = [];
    let start = 0;
    while (start < text.length) {
      chunks.push(text.slice(start, start + chunkSize));
      start += chunkSize - overlap;
    }
    return chunks.filter(c => c.trim().length > 20);
  };

  /**
   * 将知识库内容写入 KGM 向量索引
   * 分块后逐块调用 POST /v1/kgm/memory
   * 如果 KGM embedding 未配置，静默跳过（内容仍保留在 state 供全量注入）
   */
  const indexKnowledgeItem = useCallback(async (item: KnowledgeItem): Promise<KnowledgeItem> => {
    if (!item.content || item.content.trim().length === 0) return item;

    const chunks = chunkText(item.content);
    let successCount = 0;

    for (let i = 0; i < chunks.length; i++) {
      try {
        const result = await apiService.kgmMemoryStore(chunks[i], {
          name: item.name,
          type: item.type,
          knowledgeId: item.id,
          chunkIndex: i,
          totalChunks: chunks.length,
          source: item.type === 'url' ? item.name : undefined
        });
        if (result) successCount++;
      } catch {
        // KGM embedding 未配置，跳过
        break;
      }
    }

    return {
      ...item,
      indexed: successCount > 0,
      indexedAt: successCount > 0 ? new Date().toISOString() : undefined,
      chunkCount: successCount > 0 ? chunks.length : 0
    };
  }, []);

  const addKnowledgeItem = useCallback(async (item: KnowledgeItem) => {
    // 先加入 state（立即可用于全量注入）
    setKnowledgeItems(prev => [...prev, item]);
    // 异步写入向量索引（不阻塞 UI）
    const indexed = await indexKnowledgeItem(item);
    if (indexed.indexed) {
      setKnowledgeItems(prev =>
        prev.map(k => k.id === item.id ? indexed : k)
      );
    }
  }, [indexKnowledgeItem]);

  const removeKnowledgeItem = useCallback((id: string) => {
    setKnowledgeItems(prev => prev.filter(k => k.id !== id));
    // 注意：KGM 目前没有暴露按 metadata 删除向量的 API，
    // 删除后向量库里的旧数据会在下次检索时被过滤（通过 knowledgeId metadata 比对）
  }, []);

  const connectWebSocket = useCallback((onMessage: (data: any) => void, onError: (error: any) => void) => {
    return apiService.connectWebSocket(onMessage, onError);
  }, []);

  const disconnectWebSocket = useCallback(() => apiService.disconnectWebSocket(), []);
  const sendWebSocketMessage = useCallback((data: any) => apiService.sendWebSocketMessage(data), []);

  const loadOllamaModels = useCallback(async () => {
    return await apiService.getOllamaModels();
  }, []);

  const sendOllamaMessage = useCallback(async (
    model: string,
    message: string,
    stream: boolean = true,
    onData: (data: any) => void
  ) => {
    await apiService.sendOllamaMessage(model, message, stream, onData);
  }, []);

  const sendOllamaMessageWithMessages = useCallback(async (
    model: string,
    msgs: any[],
    onData: (data: any) => void,
    options?: {
      tools?: ToolDefinition[];
      toolCallHandler?: ToolCallHandler;
      enabledSkillIds?: string[];
    }
  ) => {
    let tools = options?.tools;
    let toolCallHandler = options?.toolCallHandler;

    let toolsetAllowlist: Set<string> | null = null;
    try {
      toolsetAllowlist = await resolveEnabledToolsetLogicalNames();
    } catch {
      toolsetAllowlist = null;
    }

    // 与 Plugin「启用」对齐：未显式传 tools 时按 resolveToolSkillIds 构建
    if (!tools) {
      const skillExecutor = orchestratorRef.current.getSkillExecutor();
      let ids = orchestratorRef.current.resolveToolSkillIds(options?.enabledSkillIds);
      if (toolsetAllowlist && toolsetAllowlist.size > 0) {
        ids = filterSkillIdsByToolsetAllowlist(ids, toolsetAllowlist, skillExecutor);
      }
      tools = skillExecutor.getAllToolDefinitions(ids) as ToolDefinition[];
      if (toolsetAllowlist && toolsetAllowlist.size > 0) {
        tools = filterToolDefinitionsByAllowlist(tools, toolsetAllowlist);
      }
    }

    if (tools && tools.length > 0 && !toolCallHandler) {
      toolCallHandler = async (toolName: string, args: Record<string, any>) => {
        return await orchestratorRef.current.getSkillExecutor().executeToolCall(toolName, args);
      };
    }

    return await apiService.sendOllamaMessageWithMessages(model, msgs, onData, {
      tools,
      toolCallHandler
    });
  }, []);

  const processWithOrchestrator = useCallback(async (
    input: string,
    selectedSkills?: string[],
    selectedConnectors?: any[],
    selectedTemplate?: string,
    onStage?: (evt: { runId: string; stage: string; at: number; message?: string }) => void
  ) => {
    try {
      const runIdRef = { current: '' };
      const stageHandler = (event: any) => {
        const data = event?.data || event;
        if (!data?.runId || !data?.stage) return;
        if (!runIdRef.current) runIdRef.current = String(data.runId);
        if (String(data.runId) !== runIdRef.current) return;
        onStage?.({
          runId: runIdRef.current,
          stage: String(data.stage),
          at: Number(data.at) || Date.now(),
          message: typeof data.message === 'string' ? data.message : undefined
        });
      };

      const unsubscribe = orchestratorRef.current.onOrchestratorStage(stageHandler as any);

      let baseResult: any;
      try {
        baseResult = await orchestratorRef.current.processMessage(input, messages, selectedSkills, selectedConnectors, selectedTemplate);
      } finally {
        unsubscribe();
      }

      const skillExecutor = orchestratorRef.current.getSkillExecutor();
      let toolSkillIdsRaw = orchestratorRef.current.resolveToolSkillIds(selectedSkills);

      let toolsetAllowlist: Set<string> | null = null;
      try {
        toolsetAllowlist = await resolveEnabledToolsetLogicalNames();
      } catch {
        toolsetAllowlist = null;
      }
      if (toolsetAllowlist && toolsetAllowlist.size > 0) {
        toolSkillIdsRaw = filterSkillIdsByToolsetAllowlist(toolSkillIdsRaw, toolsetAllowlist, skillExecutor);
      }

      const topK =
        typeof window !== 'undefined' && window.localStorage
          ? Number(window.localStorage.getItem('yueli_tool_topk_skills') || 8) || 8
          : 8;
      let embeddingScores: Record<string, number> | undefined;
      try {
        embeddingScores = await recallSkillRoutingScoresFromMemory(input, toolSkillIdsRaw, apiService);
      } catch {
        embeddingScores = undefined;
      }

      const toolSkillIds = selectSkillIdsForTools(input, toolSkillIdsRaw, {
        maxSkills: topK,
        recentSkillIds: readRecentSkillIds(50),
        embeddingScores
      });
      setLastToolRoundSkillIds(toolSkillIds);
      let tools = skillExecutor.getAllToolDefinitions(toolSkillIds) as ToolDefinition[];
      if (toolsetAllowlist && toolsetAllowlist.size > 0) {
        tools = filterToolDefinitionsByAllowlist(tools, toolsetAllowlist);
      }

      const toolCallHandler: ToolCallHandler = async (toolName, args) => {
        return await skillExecutor.executeToolCall(toolName, args);
      };

      // RAG：仅在「知识库注入策略 = 向量」时请求 KGM，避免全量/关闭模式下多余检索
      let ragContext: string | undefined;
      const kbScope = readKnowledgeScopeMode();
      if (knowledgeItems.length > 0 && kbScope === 'vector') {
        try {
          const activeIds = new Set(knowledgeItems.map(k => k.id));
          const searchResult = await apiService.kgmMemorySearch(input, undefined, 8);
          if (searchResult?.results?.length > 0) {
            // 过滤掉已删除知识库的旧向量块
            const validResults = searchResult.results.filter(
              (r: any) => !r.metadata?.knowledgeId || activeIds.has(r.metadata.knowledgeId)
            );
            if (validResults.length > 0) {
              ragContext = validResults
                .map((r: any) => `[${r.metadata?.name || '知识片段'}]\n${r.content || r.text}`)
                .join('\n\n');
            }
          }
        } catch {
          // KGM 向量检索不可用，回退到全量注入（由 buildMessages 处理）
        }
      }

      // 检测技能 URL
      let skillInstallRequests: SkillInstallRequest[] | undefined;
      try {
        skillInstallRequests = await orchestratorRef.current.analyzeSkillUrls(input);
        if (skillInstallRequests.length > 0) {
          console.log('[ChatContext] 检测到技能 URL:', skillInstallRequests.map(r => r.url));
        }
      } catch (error) {
        console.warn('Failed to analyze skill URLs:', error);
      }

      return {
        ...baseResult,
        tools: tools.length > 0 ? tools : undefined,
        toolCallHandler: tools.length > 0 ? toolCallHandler : undefined,
        ragContext,
        skillInstallRequests
      };
    } catch (error) {
      console.error('processWithOrchestrator failed:', error);
      throw error;
    }
  // P1-1: 使用 useRef 追踪 orchestrator 版本，避免闭包问题
  // orchestratorRef.current 始终指向最新实例，闭包会捕获最新的引用
  }, [messages, knowledgeItems]);

  /** 分析输入中的技能 URL */
  const analyzeSkillUrls = useCallback(async (input: string): Promise<SkillInstallRequest[]> => {
    try {
      return await orchestratorRef.current.analyzeSkillUrls(input);
    } catch (error) {
      console.error('Failed to analyze skill URLs:', error);
      return [];
    }
  }, []);

  /** 从 URL 安装技能 */
  const installSkillFromUrl = useCallback(async (url: string): Promise<{ success: boolean; skill?: any; error?: string }> => {
    try {
      return await orchestratorRef.current.installSkillFromUrl(url);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '安装失败'
      };
    }
  }, []);

  // Initialize orchestrator
  useEffect(() => {
    const initOrchestrator = async () => {
      await orchestratorRef.current.initialize();
    };
    initOrchestrator();
  }, []);

  useEffect(() => {
    return () => disconnectWebSocket();
  }, [disconnectWebSocket]);

  return (
    <ChatContext.Provider value={{
      currentThread,
      setCurrentThread,
      messages,
      addMessage,
      clearMessages,
      connectWebSocket,
      disconnectWebSocket,
      sendWebSocketMessage,
      loadOllamaModels,
      sendOllamaMessage,
      sendOllamaMessageWithMessages,
      orchestrator: orchestratorRef.current,
      skillExecutor: orchestratorRef.current.getSkillExecutor(),
      connectorManager: orchestratorRef.current.getConnectorManager(),
      processWithOrchestrator,
      analyzeSkillUrls,
      installSkillFromUrl,
      knowledgeItems,
      addKnowledgeItem,
      removeKnowledgeItem,
      lastToolRoundSkillIds
    }}>
      {children}
    </ChatContext.Provider>
  );
};
