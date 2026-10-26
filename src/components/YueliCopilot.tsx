import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import styled from 'styled-components';
import { useNavigate } from 'react-router-dom';
import { useChat } from '../contexts/ChatContext';
import { useSystemState } from '../contexts/SystemStateContext';
import { toast } from 'react-hot-toast';
import { devLog, devWarn, devDebug, devError } from '../utils/devConsole';
import {
  SettingOutlined,
  DatabaseOutlined,
  StopOutlined,
  AppstoreOutlined,
  SearchOutlined,
  BugOutlined
} from '@ant-design/icons';
import ChatMessageRenderer from './ChatMessageRenderer';
import TypewriterRenderer from './TypewriterRenderer';
import ApiConfigModal from './ApiConfigModal';
import KnowledgeSelectionModal from './KnowledgeSelectionModal';
import ChatDocumentsModal from './ChatDocumentsModal';
import { appendSessionMemoryTurn } from '../services/documents/documentServerStore';
import { Popover, Badge } from 'antd';
import ToolsMenu from './chat/ToolsMenu';
import { ChatVoiceMicButton } from './chat/ChatVoiceMicButton';
import { loadChatCloudConfigFromLocalStorage, resolveModelOptionsFromCloudConfig, type ChatProvider } from '../services/chat/ModelOptions';
import {
  buildTieredModelOptions,
  type TieredModelOption
} from '../services/chat/inferenceModelTiers';
import { buildRouteTrace } from '../services/chat/InferenceRouter';
import type { InferenceRoutePlan } from '../services/chat/InferenceRouter';
import { buildChatMessages } from '../services/chat/ContextAssembler';
import { useChatRoutePlan } from '../hooks/useChatRoutePlan';
import SkillRoundPlanPanel from './chat/SkillRoundPlanPanel';
import ContextBudgetPanel from './chat/ContextBudgetPanel';
import { isSkillEvolutionEnabled } from '../services/chat/skillEvolutionPrefs';
import {
  fetchKgmModelCatalog,
  pickAttachmentChatModel,
  type KgmCatalogEntry
} from '../services/chat/kgmModelCatalog';
import {
  composeAdminManagementAssistantText,
  parseAdminManagementInput
} from '../services/chat/adminManagementGate';
import { createInitialStreamReducerState, normalizeRawStreamEvent, reduceStreamEvent } from '../services/chat/StreamEventReducer';
import {
  finalizeKgmAssistantMarkdownIfNeeded,
  normalizeBotMessagesForDisplay,
  pickAssistantVisibleRawText
} from '../services/chat/kgmAssistantContent';
import {
  migrateSessionMessagesInLocalStorage,
  persistNormalizedSessionMessages
} from '../services/chat/sessionMessagesMigration';
import { appendMarkdownOutputRules } from '../services/chat/markdownOutputRules';
import { resolveSkillExecutorBaseUrl } from '../utils/skillExecutorUrl';
import { pickChatFilesViaDesktop } from '../utils/desktopFilePicker';
import {
  extractTextFromChatFiles,
  userInputHasAttachmentPayload,
  formatUserMessageWithAttachments
} from '../utils/chatFilePromptText';
import PermissionRequestModal, { type PermissionDecision } from './chat/PermissionRequestModal';
import SkillScriptConsentModal from './chat/SkillScriptConsentModal';
import {
  parseSkillToolName,
  hasScriptConsent,
  applyScriptConsent,
  type ScriptConsentDecision
} from '../services/chat/skillScriptConsent';

import {
  Message,
  ChatFile,
  RenderedOutput,
  MessageMetrics,
  SkillPermission,
  PermissionAuditEntry
} from '../types';
import apiService from '../api/services/apiService';
import { ingestPdfAttachmentsForChat } from '../services/documents/pdfIngestPipeline';
import { orchestratorPdfSkillResultsToRoleOutputs } from '../services/documents/pdfOrchestratorIntegration';
import { runPdfOrchestratorRoleStage } from '../services/documents/pdfOrchestratorRoles';
import {
  readPdfAttachmentChatMode,
  readPdfPipelineMode,
  buildAttachmentChatPromptForLlm
} from '../services/documents/pdfPipelineConfig';
import {
  buildDocumentFollowUpPrompt,
  collectSessionDocumentIds
} from '../services/documents/pdfFollowUp';
import { readOpenAiStreamIncludeUsagePreference } from '../api/services/streamRequestOptions';
import {
  readKnowledgeScopeMode,
  KNOWLEDGE_SCOPE_LS_KEY,
  DEFAULT_KNOWLEDGE_SCOPE_MODE,
  type KnowledgeScopeMode
} from '../services/chat/KnowledgeScope';
import { getDefaultOrchestrator } from '../services/core';
import { personalitySystem } from '../services/core/PersonalitySystem';
import PromptRegistry from '../services/PromptRegistry';
import { sessionStorageService } from '../services/SessionStorage';
import { syncToolRoutingIndexForSkills } from '../services/chat/ToolRoutingSync';
import { vectorRecallService } from '../services/VectorRecall';
import {
  topicFilesStore,
  stripFileContent,
  persistTopicsToStorage as persistTopicsToStorageImpl
} from '../services/TopicFilesStore';
import { buildDesktopFusionContext } from '../services/desktopKnowledge/desktopFusionPrompt';
import {
  resolveTopicFromList,
  clearLegacyWorkspaceLocalStorage
} from '../services/desktopKnowledge/topicWorkspace';

/**
 * 持久化 topics：先把每个 topic 的文件内容写入 IndexedDB，
 * 再把不含 content 的轻量副本写入 localStorage，避免 QuotaExceededError。
 */
async function fetchTopicFusionContext(
  selectedTopic: any,
  topics: any[],
  query: string,
  sessionId: string,
  recentMessages: Message[],
  activeSkillIds?: string[]
): Promise<{ freshTopic: any; topicFusionContext?: string }> {
  const freshTopic = resolveTopicFromList(selectedTopic, topics) ?? selectedTopic;
  if (!freshTopic?.workspaceLastScanAt) {
    return { freshTopic };
  }
  const ctx = await buildDesktopFusionContext({
    query,
    sessionId,
    documentIds: collectSessionDocumentIds(recentMessages),
    topic: freshTopic,
    includeWeb: activeSkillIds?.includes('desktop-knowledge-agent')
  });
  return { freshTopic, topicFusionContext: ctx ?? undefined };
}

async function persistTopicsToStorage(updated: any[]): Promise<void> {
  return persistTopicsToStorageImpl(updated, (err: any) => {
    if (err?.name === 'QuotaExceededError' || /quota/i.test(String(err?.message || ''))) {
      toast.error('保存项目主题失败：浏览器存储已满。文件内容已落到本地数据库，请删除无用主题后重试');
    } else {
      devError('persistTopicsToStorage failed:', err);
    }
  });
}

function extractInvocationMetrics(
  res:
    | undefined
    | {
        invocation?: MessageMetrics;
        transportMeta?: { fallback?: string };
        generationInfo?: {
          usage?: {
            prompt_tokens?: number;
            completion_tokens?: number;
            total_tokens?: number;
          };
        };
      },
  routePlan?: InferenceRoutePlan
): MessageMetrics | undefined {
  if (!res || typeof res !== 'object') return undefined;
  const inv = (res as { invocation?: MessageMetrics }).invocation;
  const gi = (res as { generationInfo?: { usage?: Record<string, unknown> } }).generationInfo?.usage;

  const metrics: MessageMetrics = {};
  if (typeof inv?.providerHttpRounds === 'number') metrics.providerHttpRounds = inv.providerHttpRounds;
  if (typeof inv?.totalLatencyMs === 'number') metrics.totalLatencyMs = inv.totalLatencyMs;

  const pt =
    typeof inv?.promptTokens === 'number'
      ? inv.promptTokens
      : typeof gi?.prompt_tokens === 'number'
        ? (gi.prompt_tokens as number)
        : undefined;
  const ct =
    typeof inv?.completionTokens === 'number'
      ? inv.completionTokens
      : typeof gi?.completion_tokens === 'number'
        ? (gi.completion_tokens as number)
        : undefined;
  const tt =
    typeof inv?.totalTokens === 'number'
      ? inv.totalTokens
      : typeof gi?.total_tokens === 'number'
        ? (gi.total_tokens as number)
        : undefined;

  if (typeof pt === 'number' && Number.isFinite(pt)) metrics.promptTokens = pt;
  if (typeof ct === 'number' && Number.isFinite(ct)) metrics.completionTokens = ct;
  if (typeof tt === 'number' && Number.isFinite(tt)) metrics.totalTokens = tt;

  if (routePlan) {
    const fallback =
      typeof (res as { transportMeta?: { fallback?: string } })?.transportMeta?.fallback === 'string'
        ? (res as { transportMeta?: { fallback?: string } }).transportMeta!.fallback
        : undefined;
    metrics.routeTrace = buildRouteTrace(routePlan, fallback ? { transportFallback: fallback } : undefined);
  }

  return Object.keys(metrics).length > 0 ? metrics : undefined;
}

/** 新建会话占位名（handleNewSession）；首条用户消息成功后若仍为此类名则调用 AI 生成标题 */
const SESSION_TITLE_PLACEHOLDERS = new Set(['新对话', 'New Chat', '新会话', 'Untitled']);

const sessionNameNeedsAiTitle = (name: string | undefined | null): boolean => {
  const t = (name || '').trim();
  return !t || SESSION_TITLE_PLACEHOLDERS.has(t);
};

/**
 * 规则生成标题函数
 * 基于用户输入提炼生成一个7-12个字的标题
 * @param content 用户输入内容
 * @returns 7-12个字的标题
 */
const generateRuleBasedTitle = (content: string): string => {
  if (!content || content.trim() === '') {
    return '新对话';
  }
  
  let title = content.trim();
  
  // 移除首尾的标点符号和空格
  title = title.replace(/^[\s\u3000，,。.、/\\]+|[\s\u3000，,。.、/\\]+$/g, '');
  
  // 如果已经在7-12字范围内，直接返回
  if (title.length >= 7 && title.length <= 12) {
    return title;
  }
  
  // 如果超过12字，需要截取
  if (title.length > 12) {
    // 尝试在句子边界处截断（从后往前找）
    const maxLength = 12;
    let splitIndex = maxLength;
    
    // 从最大长度位置开始向前找边界
    for (let i = maxLength; i >= Math.max(7, maxLength - 5); i--) {
      const char = title.charAt(i);
      if (char === '。' || char === '？' || char === '！' || char === '，' || char === ',' || char === '.' || char === ' ' || char === '\n') {
        splitIndex = i + 1;
        break;
      }
    }
    
    title = title.substring(0, splitIndex);
    return title;
  }
  
  // 如果少于7字，尝试补充
  if (title.length < 7) {
    // 如果以动词开头，可以添加适当的宾语
    const verbMap: Record<string, string> = {
      '介绍': '介绍产品',
      '分析': '分析问题',
      '解释': '解释概念',
      '说明': '说明方法',
      '设计': '设计方案',
      '开发': '开发功能',
      '优化': '优化流程',
      '编写': '编写文档',
      '创建': '创建项目',
      '实现': '实现功能',
      '解决': '解决问题',
      '讨论': '讨论方案',
      '比较': '比较方案',
      '评估': '评估方案',
      '推荐': '推荐方案'
    };
    
    for (const [verb, suggestion] of Object.entries(verbMap)) {
      if (title.startsWith(verb)) {
        return suggestion;
      }
    }
    
    // 如果标题仍然太短，尝试从内容中提取更多信息
    const fullContent = content.trim();
    if (fullContent.length > title.length) {
      const remaining = fullContent.substring(title.length).trim();
      if (remaining.length > 0) {
        // 取剩余内容的前几个字
        const needed = 7 - title.length;
        const extra = remaining.substring(0, Math.min(needed, remaining.length));
        title += extra;
      }
    }
    
    // 如果还是太短，添加"相关"等词
    if (title.length < 7) {
      title = title.padEnd(7, '相关');
    }
  }
  
  return title.trim();
};

// 主题定义
const lightTheme = {
  primary: '#1890ff',
  background: '#f5f5f5',
  surface: '#ffffff',
  border: '#e8e8e8',
  text: '#333333',
  textSecondary: '#666666',
  accent: '#1a73e8',
  success: '#52c41a',
  error: '#ff4d4f',
  warning: '#faad14'
};

const buildMessages = buildChatMessages;

// 样式组件
const Container = styled.div`
  display: flex;
  height: 100vh;
  overflow: hidden;
  background-color: #f5f5f5;
`;

const Sidebar = styled.div`
  flex-shrink: 0;
  width: 300px;
  background-color: #ffffff;
  border-right: 1px solid #e8e8e8;
  padding: 20px;
  overflow-y: auto;
`;

const MainContent = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
`;

const ChatHeader = styled.div`
  padding: 16px 24px;
  background-color: #ffffff;
  border-bottom: 1px solid #e8e8e8;
  display: flex;
  justify-content: space-between;
  align-items: center;
`;

const ChatActions = styled.div`
  display: flex;
  gap: 12px;
`;

const ActionButton = styled.button`
  background: none;
  border: 1px solid #d9d9d9;
  border-radius: 4px;
  padding: 6px 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  color: #666666;
  transition: all 0.3s;

  &:hover {
    border-color: #1890ff;
    color: #1890ff;
  }
`;

const MessagesContainer = styled.div`
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  position: relative;
  z-index: 0;
`;

const InputContainer = styled.div`
  padding: 16px 24px;
  background-color: #ffffff;
  border-top: 1px solid #e8e8e8;
  position: relative;
  z-index: 100;
  min-width: 0;
  overflow-x: hidden;
  overflow-y: visible;
`;

const StatusIndicator = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #666666;

  &.loading {
    color: #1890ff;
  }

  &.error {
    color: #ff4d4f;
  }
`;

interface YueliCopilotProps {
  debugModeEnabled?: boolean;
  onToggleDebugPanel?: () => void;
}

const YueliCopilot: React.FC<YueliCopilotProps> = ({ debugModeEnabled, onToggleDebugPanel }) => {
  const navigate = useNavigate();
  const { 
    sendOllamaMessage, 
    sendOllamaMessageWithMessages,
    processWithOrchestrator,
    knowledgeItems,
    lastToolRoundSkillIds,
    installSkillFromUrl
  } = useChat();

  const [activeSkillIds, setActiveSkillIds] = useState<string[]>([]);

  // 视图模式：'topics' | 'topic-sessions' | 'chat'
  // 'topics' - 项目主题列表视图（默认）
  // 'topic-sessions' - 主题下的会话列表视图
  // 'chat' - 对话详情视图
  const [viewMode, setViewMode] = useState<'topics' | 'topic-sessions' | 'chat'>('topics');



  // 主题和会话相关状态
  const [topics, setTopics] = useState<any[]>(() => {
    let saved = localStorage.getItem('yueli_topics');
    
    // 如果新格式为空但旧格式存在，执行迁移
    if ((!saved || saved === '[]') && localStorage.getItem('yueli-topics')) {
      const oldData = localStorage.getItem('yueli-topics');
      if (oldData && oldData !== '[]') {
        localStorage.setItem('yueli_topics', oldData);
        saved = oldData;
      }
    }
    
    return saved ? JSON.parse(saved) : [];
  });
  // 使用 sessionStorageService 初始化会话状态
  const [sessions, setSessions] = useState<any[]>(() => {
    return sessionStorageService.getAll();
  });

  /** URL 解析只在 dataLoaded 后跑一次快照；勿依赖 [sessions,topics]，否则 ?session=<topicId> 会在新建会话后因 sessions 更新反复进入「主题会话列表」分支并清空聊天视图 */
  const sessionsRef = useRef(sessions);
  const topicsRef = useRef(topics);
  useEffect(() => {
    sessionsRef.current = sessions;
    topicsRef.current = topics;
  }, [sessions, topics]);

  // 同步会话状态到服务
  useEffect(() => {
    if (sessions.length > 0) {
      // 确保服务和状态同步
      sessions.forEach(session => {
        const existing = sessionStorageService.getById(session.id);
        if (!existing) {
          sessionStorageService.add(session);
        }
      });
    }
  }, []);
  const [searchQuery, setSearchQuery] = useState('');
  const [isCreateTopicModalOpen, setIsCreateTopicModalOpen] = useState(false);
  const [newTopicName, setNewTopicName] = useState('');
  const [newTopicContent, setNewTopicContent] = useState('');
  const [newTopicFiles, setNewTopicFiles] = useState<Array<{file: File, addedAt: number}>>([]);
  const [isTopicsExpanded, setIsTopicsExpanded] = useState(false);
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [menuTarget, setMenuTarget] = useState<'topic' | 'session' | null>(null);
  const [menuItem, setMenuItem] = useState<any>(null);
  const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
  const [renameNewName, setRenameNewName] = useState('');
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [selectedTopic, setSelectedTopic] = useState<any>(null);

  // 计算属性：当前主题下的会话列表（按最后活跃时间倒序）
  const topicSessions = selectedTopic 
    ? sessions
        .filter(s => s.topicId === selectedTopic.id)
        .sort((a, b) => b.lastActive - a.lastActive)
    : [];

  // 计算属性：不属于任何主题的会话列表（按最后活跃时间倒序）
  const noTopicSessions = sessions
    .filter(s => !s.topicId)
    .sort((a, b) => b.lastActive - a.lastActive);

  // 计算属性：所有会话按最后活跃时间倒序
  const allSessionsSorted = [...sessions].sort((a, b) => b.lastActive - a.lastActive);

  // 指令相关状态
  const [instructions, setInstructions] = useState([
    { id: '1', name: '代码优化', content: '请优化以下代码，使其更加高效和可维护。' },
    { id: '2', name: '安全检查', content: '请检查以下代码是否存在安全漏洞。' },
    { id: '3', name: '文档生成', content: '请为以下代码生成详细的文档。' }
  ]);
  const [isInstructionModalOpen, setIsInstructionModalOpen] = useState(false);
  const [isAddInstructionModalOpen, setIsAddInstructionModalOpen] = useState(false);
  const [newInstructionName, setNewInstructionName] = useState('');
  const [newInstructionContent, setNewInstructionContent] = useState('');
  const [selectedInstructions, setSelectedInstructions] = useState<string[]>([]);
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [toolsMenuDefaultTab, setToolsMenuDefaultTab] = useState<
    'attachments' | 'skills' | 'model' | 'hub' | 'toolsets' | 'routing'
  >('attachments');
  const { markReloadRequired } = useSystemState();
  const [allowSkillEntry, setAllowSkillEntry] = useState(
    () => typeof window !== 'undefined' && window.localStorage?.getItem('yueli_allow_skill_entry') === '1'
  );
  const [allowSkillRuntime, setAllowSkillRuntime] = useState(
    () => typeof window !== 'undefined' && window.localStorage?.getItem('yueli_allow_skill_runtime') === '1'
  );

  const handleAllowSkillEntryChange = useCallback(
    (enabled: boolean) => {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem('yueli_allow_skill_entry', enabled ? '1' : '0');
      }
      setAllowSkillEntry(enabled);
      markReloadRequired(
        'toolset_changed',
        enabled ? '已开启 manifest.entry 脚本工具，请重载页面后生效' : '已关闭 manifest.entry 脚本工具，请重载页面后生效'
      );
    },
    [markReloadRequired]
  );

  const handleAllowSkillRuntimeChange = useCallback(
    (enabled: boolean) => {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem('yueli_allow_skill_runtime', enabled ? '1' : '0');
      }
      setAllowSkillRuntime(enabled);
      markReloadRequired(
        'toolset_changed',
        enabled ? '已开启 runtime.entrypoint 工具，请重载页面后生效' : '已关闭 runtime.entrypoint 工具，请重载页面后生效'
      );
    },
    [markReloadRequired]
  );

  const [streamIncludeUsageUi, setStreamIncludeUsageUi] = useState(() =>
    readOpenAiStreamIncludeUsagePreference()
  );
  const [streamUsageOverridePresent, setStreamUsageOverridePresent] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      const v = window.localStorage.getItem('yueli_stream_include_usage');
      return v === '0' || v === '1';
    } catch {
      return false;
    }
  });

  const syncStreamIncludeUsageFromStorage = useCallback(() => {
    try {
      const v = typeof window !== 'undefined' ? window.localStorage?.getItem('yueli_stream_include_usage') : null;
      setStreamUsageOverridePresent(v === '0' || v === '1');
    } catch {
      setStreamUsageOverridePresent(false);
    }
    setStreamIncludeUsageUi(readOpenAiStreamIncludeUsagePreference());
  }, []);

  useEffect(() => {
    syncStreamIncludeUsageFromStorage();
  }, [syncStreamIncludeUsageFromStorage]);

  useEffect(() => {
    if (isAddMenuOpen) {
      syncStreamIncludeUsageFromStorage();
    }
  }, [isAddMenuOpen, syncStreamIncludeUsageFromStorage]);

  const handleStreamIncludeUsageChange = useCallback(
    (enabled: boolean) => {
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem('yueli_stream_include_usage', enabled ? '1' : '0');
        }
      } catch {
        /* ignore */
      }
      syncStreamIncludeUsageFromStorage();
    },
    [syncStreamIncludeUsageFromStorage]
  );

  const handleResetStreamIncludeUsageDefault = useCallback(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem('yueli_stream_include_usage');
      }
    } catch {
      /* ignore */
    }
    syncStreamIncludeUsageFromStorage();
  }, [syncStreamIncludeUsageFromStorage]);

  const [knowledgeScopeUi, setKnowledgeScopeUi] = useState<KnowledgeScopeMode>(() => readKnowledgeScopeMode());
  const syncKnowledgeScopeFromStorage = useCallback(() => {
    setKnowledgeScopeUi(readKnowledgeScopeMode());
  }, []);

  useEffect(() => {
    syncKnowledgeScopeFromStorage();
  }, [syncKnowledgeScopeFromStorage]);

  useEffect(() => {
    if (isAddMenuOpen) {
      syncKnowledgeScopeFromStorage();
    }
  }, [isAddMenuOpen, syncKnowledgeScopeFromStorage]);

  const handleKnowledgeScopeChange = useCallback((mode: KnowledgeScopeMode) => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(KNOWLEDGE_SCOPE_LS_KEY, mode);
      }
    } catch {
      /* ignore */
    }
    setKnowledgeScopeUi(mode);
  }, []);

  // Skills相关状态
  const [skills, setSkills] = useState<any[]>([]);
  const [orchestrator, setOrchestrator] = useState<any>(null);
  const [isSkillInstallModalOpen, setIsSkillInstallModalOpen] = useState(false);
  const [newSkillId, setNewSkillId] = useState('');
  const [newSkillName, setNewSkillName] = useState('');
  const [newSkillDescription, setNewSkillDescription] = useState('');
  const [newSkillVersion, setNewSkillVersion] = useState('1.0.0');
  const [newSkillAuthor, setNewSkillAuthor] = useState('');
  const [skillInstallMode, setSkillInstallMode] = useState<'manual' | 'url'>('manual');
  const [skillUrl, setSkillUrl] = useState('');
  const [isInstallingFromUrl, setIsInstallingFromUrl] = useState(false);

  // 初始化 orchestrator 并加载技能
  useEffect(() => {
    const init = async () => {
      const orch = getDefaultOrchestrator();
      await orch.initialize();
      setOrchestrator(orch);
      refreshSkills(orch);
    };
    init();
  }, []);

  useEffect(() => {
    clearLegacyWorkspaceLocalStorage();
  }, []);

  useEffect(() => {
    if (!selectedTopic?.id || !Array.isArray(topics)) return;
    const fresh = topics.find((t: any) => t.id === selectedTopic.id);
    if (
      fresh &&
      (fresh.workspaceLastScanAt !== selectedTopic.workspaceLastScanAt ||
        fresh.workspaceIndexedCount !== selectedTopic.workspaceIndexedCount ||
        fresh.workspaceRoot !== selectedTopic.workspaceRoot)
    ) {
      setSelectedTopic(fresh);
    }
  }, [topics, selectedTopic?.id]);

  // P2-5: 调试：打印 localStorage 中的所有数据（仅开发环境）
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    
    devLog('🔍 调试：localStorage 中的主题数据');
    const savedTopics = localStorage.getItem('yueli_topics');
    if (savedTopics) {
      const parsedTopics = JSON.parse(savedTopics);
      devLog('📚 所有主题:', parsedTopics);
      parsedTopics.forEach((topic: any, index: number) => {
        devLog(`📑 主题 ${index + 1}:`, {
          id: topic.id,
          name: topic.name,
          hasFiles: topic.files?.length > 0,
          files: topic.files?.map((f: any) => ({
            name: f.name,
            hasContent: !!f.content,
            contentLength: f.content?.length || 0,
            contentPreview: f.content?.substring(0, 300) || '(no content)'
          }))
        });
      });
    }
  }, []);

  // 一次性迁移：把 localStorage 中内联的文件内容写入 IDB，再剥离 content 写回 localStorage
  useEffect(() => {
    if (!Array.isArray(topics) || topics.length === 0) return;
    const hasInlineContent = topics.some((t: any) =>
      Array.isArray(t?.files) && t.files.some((f: any) => typeof f?.content === 'string' && f.content.length > 0)
    );
    if (!hasInlineContent) return;
    persistTopicsToStorage(topics).catch(() => {});
    // 迁移完成后让 topics state 也只保留元数据，防止内存重复占用
    const stripped = stripFileContent(topics);
    setTopics(stripped);
  }, []);

  // 当选中某个项目主题时，从 IDB 水合其文件内容（如果尚未水合），
  // 这样后续 buildMessages 才能拿到 content
  useEffect(() => {
    if (!selectedTopic?.id) return;
    const filesArr = Array.isArray(selectedTopic.files) ? selectedTopic.files : [];
    if (filesArr.length === 0) return;
    const allHydrated = filesArr.every((f: any) => typeof f?.content === 'string' && f.content.length > 0);
    if (allHydrated) return;
    let cancelled = false;
    (async () => {
      try {
        const hydrated = await topicFilesStore.hydrateTopicFiles(selectedTopic);
        if (cancelled) return;
        setSelectedTopic(hydrated);
        setTopics(prev => prev.map((t: any) => (t.id === hydrated.id ? { ...t, files: hydrated.files } : t)));
      } catch {
        /* 水合失败不阻断 UI，文件内容会显示"(文件内容未加载)" */
      }
    })();
    return () => { cancelled = true; };
  }, [selectedTopic?.id]);

  // 标记数据是否已加载完成
  const [dataLoaded, setDataLoaded] = useState(false);

  // 确保 localStorage 数据加载完成
  useEffect(() => {
    const checkDataLoaded = () => {
      const savedSessions = localStorage.getItem('yueli_sessions');
      const savedTopics = localStorage.getItem('yueli_topics');
      
      // 如果有保存的数据，等待组件初始化
      if ((savedSessions && JSON.parse(savedSessions).length > 0) || 
          (savedTopics && JSON.parse(savedTopics).length > 0)) {
        // 等待状态初始化完成
        setTimeout(() => {
          setDataLoaded(true);
        }, 100);
      } else {
        // 没有保存的数据，立即标记完成
        setDataLoaded(true);
      }
    };
    
    checkDataLoaded();
  }, []);

  // 处理URL参数，自动加载指定的会话或主题
  useEffect(() => {
    // 只在数据加载完成后才处理
    if (!dataLoaded) {
      if (import.meta.env.DEV) {
        devLog('⏳ 等待数据加载完成...');
      }
      return;
    }
    
    const params = new URLSearchParams(window.location.search);
    const sessionParam = params.get('session');
    
    if (sessionParam) {
      const sessionsSnap = sessionsRef.current;
      const topicsSnap = topicsRef.current;

      if (import.meta.env.DEV) {
        devLog('🔍 处理URL参数 session:', sessionParam);
        devLog('📊 当前数据:', { sessionsCount: sessionsSnap.length, topicsCount: topicsSnap.length });
      }
      
      // 首先尝试将其作为会话ID加载
      const session = sessionsSnap.find(s => s.id === sessionParam);
      if (session) {
        if (import.meta.env.DEV) {
          devLog('✅ 找到会话，自动加载:', session);
        }
        // 直接从 localStorage 读取 sessionMessages，避免引用未定义的 state
        const savedSessionMessages = localStorage.getItem('yueli_session_messages');
        const allSessionMessages = savedSessionMessages ? JSON.parse(savedSessionMessages) : {};
        const sessionData = allSessionMessages[session.id] || [];
        if (import.meta.env.DEV) {
          devLog('📥 URL 加载会话消息:', {
            sessionId: session.id,
            messagesCount: sessionData.length,
            preview: sessionData.slice(0, 3).map((m: any) => ({
              role: m.role, status: m.status, contentLen: (m.content || '').length, error: m.error
            }))
          });
        }
        
        // 使用 setTimeout 确保组件已完全加载
        setTimeout(() => {
          setCurrentSessionId(session.id);
          setViewMode('chat');
          if (session.topicId) {
            const topic = topicsSnap.find(t => t.id === session.topicId);
            if (topic) {
              setSelectedTopic(topic);
            }
          }
          // 同步内存中的 sessionMessages，使其与 localStorage 中实际数据一致，
          // 避免后续 handleSendMessage 写入时基于过期数据覆盖。
          const normalizedSessionData = persistNormalizedSessionMessages(
            session.id,
            sessionData as Message[]
          );
          setSessionMessages(prev => ({ ...prev, [session.id]: normalizedSessionData }));
          setMessages(normalizedSessionData);
          setInput('');
          setFiles([]);
          setError(null);
        }, 0);
        return;
      }
      
      // 如果不是会话ID，尝试作为主题ID加载
      const topic = topicsSnap.find(t => t.id === sessionParam);
      if (topic) {
        if (import.meta.env.DEV) {
          devLog('✅ 找到主题，自动加载:', topic);
        }
        setTimeout(() => {
          setSelectedTopic(topic);
          setViewMode('topic-sessions');
          setCurrentSessionId(null);
          setMessages([]);
          setInput('');
          setFiles([]);
          setError(null);
        }, 0);
        return;
      }
      
      // 如果都没找到，尝试从 localStorage 重新加载
      devWarn('内存中未找到对应的会话或主题，尝试从 localStorage 重新加载');
      const savedSessions = localStorage.getItem('yueli_sessions');
      if (savedSessions) {
        const allSessions = JSON.parse(savedSessions);
        const savedSession = allSessions.find((s: any) => s.id === sessionParam);
        if (savedSession) {
          devLog('✅ 从 localStorage 找到会话:', savedSession);
          // 更新 sessions 状态
          setSessions(allSessions);
          
          const savedSessionMessages = localStorage.getItem('yueli_session_messages');
          const allSessionMessages = savedSessionMessages ? JSON.parse(savedSessionMessages) : {};
          const sessionData = allSessionMessages[savedSession.id] || [];
          
          setTimeout(() => {
            setCurrentSessionId(savedSession.id);
            setViewMode('chat');
            if (savedSession.topicId) {
              const savedTopics = localStorage.getItem('yueli_topics');
              if (savedTopics) {
                const allTopics = JSON.parse(savedTopics);
                const topic = allTopics.find((t: any) => t.id === savedSession.topicId);
                if (topic) {
                  setSelectedTopic(topic);
                  setTopics(allTopics);
                }
              }
            }
            const normalizedSessionData = persistNormalizedSessionMessages(
              savedSession.id,
              sessionData as Message[]
            );
            setSessionMessages(prev => ({ ...prev, [savedSession.id]: normalizedSessionData }));
            setMessages(normalizedSessionData);
            setInput('');
            setFiles([]);
            setError(null);
          }, 0);
          return;
        }
      }
      
      devWarn('未找到对应的会话或主题');
      // 显示错误提示
      setTimeout(() => {
        setError(`会话 "${sessionParam}" 不存在或已被删除`);
      }, 0);
    }
  }, [dataLoaded]);

  // 刷新技能列表
  const refreshSkills = async (orch: any) => {
    // 先重新同步 SkillExecutor 的技能到 PluginManager
    await orch.resyncSkills();
    const pluginManager = orch.getPluginManager();
    const allSkills = pluginManager.getAllSkills();
    setSkills(allSkills);
  };

  const handleHubSkillInstalled = useCallback(async () => {
    if (orchestrator) await refreshSkills(orchestrator);
  }, [orchestrator]);

  const handleSyncToolRoutingIndex = useCallback(async () => {
    const skillExecutor = orchestrator?.getSkillExecutor?.();
    if (!skillExecutor) throw new Error('SkillExecutor 未就绪');
    const ids = activeSkillIds.filter(Boolean);
    if (ids.length === 0) throw new Error('请先在 Skills 页勾选至少一个技能');
    return syncToolRoutingIndexForSkills(skillExecutor, ids);
  }, [orchestrator, activeSkillIds]);
  
  // Prompt button相关状态 - 扩展支持systemPrompt和functionPrompt
  const [prompts, setPrompts] = useState<any[]>([
    { 
      id: 'creative-writing', 
      name: '创意构思', 
      content: '用于构思、创意生成、故事脚本或广告概念。',
      systemPrompt: '你是一位创意专家，擅长头脑风暴和创意构思。请提供创新、独特的想法，并详细阐述每个创意的实现路径。',
      functionPrompt: '请针对这个主题进行深入的创意构思，列出至少5个不同角度的创意方案，并详细说明每个方案的核心亮点和实施建议。'
    },
    { 
      id: 'code-generation', 
      name: '代码生成', 
      content: '根据需求生成代码，包括各种编程语言。',
      systemPrompt: '你是一位资深软件工程师，精通多种编程语言和框架。请编写高质量、可维护、符合最佳实践的代码，并添加必要的注释。',
      functionPrompt: '请根据需求生成完整可运行的代码，包括：1)核心功能实现 2)错误处理 3)关键代码注释 4)使用示例。'
    },
    { 
      id: 'data-analysis', 
      name: '数据分析', 
      content: '分析数据，生成图表和报告。',
      systemPrompt: '你是一位数据分析师，擅长从数据中提取洞察。请提供深入的数据分析，使用合适的统计方法，并以清晰的方式呈现结果。',
      functionPrompt: '请对提供的数据进行全面分析，包括：1)数据概况描述 2)关键指标计算 3)趋势和模式识别 4)可视化建议 5) actionable insights。'
    },
    { 
      id: 'translation', 
      name: '翻译', 
      content: '将文本翻译成不同语言。',
      systemPrompt: '你是一位专业翻译，精通多语言翻译。请准确传达原文意思，同时保持目标语言的流畅性和自然性，注意文化差异。',
      functionPrompt: '请将以下内容翻译成目标语言，要求：1)准确传达原意 2)语言自然流畅 3)保持原文的语气和风格。'
    },
    { 
      id: 'summarization', 
      name: '总结', 
      content: '总结长文本，提取关键信息。',
      systemPrompt: '你是一位专业的内容总结专家。请准确提取文本的核心要点，保留关键信息，去除冗余内容，以清晰的结构呈现。',
      functionPrompt: '请对以下内容进行结构化总结：1)核心观点 2)关键论据 3)重要结论 4)行动建议。保持简洁但信息完整。'
    },
    { 
      id: 'writing', 
      name: '写作', 
      content: '帮助写作各种类型的文本。',
      systemPrompt: '你是一位专业作家和编辑，擅长各类文体写作。请根据要求创作高质量内容，注意结构清晰、语言流畅、风格统一。',
      functionPrompt: '请根据主题创作完整内容，要求：1)结构完整（开头-正文-结尾）2)论点清晰 3)语言流畅 4)符合目标受众阅读习惯。'
    }
  ]);
  const [selectedPrompts, setSelectedPrompts] = useState<string[]>(['creative-writing', 'code-generation', 'data-analysis', 'translation', 'summarization', 'writing']);
  const [isPromptConfigModalOpen, setIsPromptConfigModalOpen] = useState(false);
  const [newPromptId, setNewPromptId] = useState('');
  const [newPromptName, setNewPromptName] = useState('');
  const [newPromptContent, setNewPromptContent] = useState('');
  const [newPromptSystemPrompt, setNewPromptSystemPrompt] = useState('');
  const [newPromptFunctionPrompt, setNewPromptFunctionPrompt] = useState('');
  const [editingPromptId, setEditingPromptId] = useState<string | null>(null);
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(true);
  const [isSkillsExpanded, setIsSkillsExpanded] = useState(false);

  // 过滤会话（基于已排序的会话列表）
  const filteredSessions = allSessionsSorted.filter(session => 
    session.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // 状态管理
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<ChatFile[]>([]);
  const [isApiConfigModalOpen, setIsApiConfigModalOpen] = useState<boolean>(false);
  const [isKnowledgeModalOpen, setIsKnowledgeModalOpen] = useState<boolean>(false);
  const [isChatDocumentsModalOpen, setIsChatDocumentsModalOpen] = useState(false);
  const [selectedKnowledge, setSelectedKnowledge] = useState<string[]>([]);
  const [isThinking, setIsThinking] = useState<boolean>(false);
  const [selectedModel, setSelectedModel] = useState<string>(() => {
    const saved = localStorage.getItem('selectedModel');
    return saved?.trim() || 'kgm-dynamic';
  });
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [sessionMessages, setSessionMessages] = useState<Record<string, any[]>>(() => {
    const saved = localStorage.getItem('yueli_session_messages');
    return saved ? JSON.parse(saved) : {};
  });

  // 调试入口：在 window.debugYueli 暴露常用排查能力，浏览器控制台可以直接调用
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const readJSON = (k: string) => {
      try {
        const raw = localStorage.getItem(k);
        return raw ? JSON.parse(raw) : null;
      } catch (e) {
        return { __parseError: String(e) };
      }
    };
    (window as any).debugYueli = {
      /** 列出所有会话（id + name + topicId + 最近活跃时间）和它们的消息数 */
      sessions() {
        const sessions = readJSON('yueli_sessions') || [];
        const sm = readJSON('yueli_session_messages') || {};
        const rows = sessions.map((s: any) => ({
          id: s.id,
          name: s.name,
          topicId: s.topicId || null,
          lastActive: s.lastActive ? new Date(s.lastActive).toLocaleString() : '-',
          messages: Array.isArray(sm[s.id]) ? sm[s.id].length : 0
        }));
        console.table(rows);
        return rows;
      },
      /** 查看某个 session 的全部消息（角色、状态、错误、内容长度、预览） */
      session(sessionId: string) {
        const sm = readJSON('yueli_session_messages') || {};
        const sessions = readJSON('yueli_sessions') || [];
        const session = sessions.find((s: any) => s.id === sessionId) || null;
        const msgs: any[] = Array.isArray(sm[sessionId]) ? sm[sessionId] : [];
        console.group(`%csession ${sessionId}`, 'font-weight:bold;color:#1890ff');
        devLog('元数据:', session);
        devLog('消息数量:', msgs.length);
        msgs.forEach((m, i) => {
          const errInfo = m.error
            ? `${m.error.code || ''} ${m.error.message || ''}`.trim()
            : '';
          devLog(
            `%c#${i + 1} ${m.role}${m.status ? ` [${m.status}]` : ''}${errInfo ? ` ⚠ ${errInfo}` : ''}`,
            m.status === 'failed' ? 'color:#f5222d' : 'color:#52c41a',
            { len: (m.content || '').length, preview: (m.content || '').slice(0, 200), provider: m.provider, model: m.model }
          );
        });
        console.groupEnd();
        return { session, messages: msgs };
      },
      /** 删除某个 session（同步清理 yueli_sessions / yueli_session_messages） */
      deleteSession(sessionId: string) {
        const sm = readJSON('yueli_session_messages') || {};
        const sessions = readJSON('yueli_sessions') || [];
        delete sm[sessionId];
        const remaining = sessions.filter((s: any) => s.id !== sessionId);
        localStorage.setItem('yueli_session_messages', JSON.stringify(sm));
        localStorage.setItem('yueli_sessions', JSON.stringify(remaining));
        devLog(`已删除 session ${sessionId}，请刷新页面`);
      },
      /** 整体存储用量（localStorage 各 key 的大小，便于诊断 QuotaExceededError） */
      storage() {
        const rows: Array<{ key: string; bytes: number; entries?: number }> = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i) || '';
          const v = localStorage.getItem(k) || '';
          const bytes = new Blob([v]).size;
          let entries: number | undefined;
          try {
            const parsed = JSON.parse(v);
            if (Array.isArray(parsed)) entries = parsed.length;
            else if (parsed && typeof parsed === 'object') entries = Object.keys(parsed).length;
          } catch { /* not json */ }
          rows.push({ key: k, bytes, entries });
        }
        rows.sort((a, b) => b.bytes - a.bytes);
        console.table(rows.map(r => ({ ...r, kb: (r.bytes / 1024).toFixed(2) })));
        return rows;
      },
      /** 按 KGM Markdown 规则清洗全部历史会话并写回 localStorage；force:true 忽略已迁移标记 */
      migrateSessionMessages(options?: { force?: boolean }) {
        const r = migrateSessionMessagesInLocalStorage(options);
        devLog('[debugYueli] migrateSessionMessages', r);
        return r;
      },
      /** 将指定 session 导出到 Skill Executor，供 scripts/analyze_session_dump.mjs 分析 */
      async exportSessionDump(sessionId: string) {
        const sm = readJSON('yueli_session_messages') || {};
        const msgs = sm[sessionId];
        if (!Array.isArray(msgs)) {
          devWarn('无此 session 消息:', sessionId);
          return { ok: false, error: 'session not found' };
        }
        const base = resolveSkillExecutorBaseUrl();
        if (!base) return { ok: false, error: 'Skill Executor URL 未配置' };
        const url = `${base.replace(/\/$/, '')}/v1/dev/session-dump`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, messages: msgs, exportedAt: new Date().toISOString() })
        });
        const data = await res.json().catch(() => ({}));
        devLog('[debugYueli] exportSessionDump', data);
        return data;
      },
      /** 打印某条 bot 消息原文与 prepare 后对比 */
      inspectBotMarkdown(sessionId: string, index = -1) {
        const sm = readJSON('yueli_session_messages') || {};
        const msgs: any[] = Array.isArray(sm[sessionId]) ? sm[sessionId] : [];
        const bots = msgs.filter((m) => m.role === 'bot' || m.role === 'assistant');
        const m = bots.at(index) ?? bots[bots.length - 1];
        if (!m) return { error: 'no bot message' };
        const raw = String(m.content || '');
        return {
          id: m.id,
          rawLen: raw.length,
          rawNewlines: (raw.match(/\n/g) || []).length,
          hasDoubleDashHash: /--##/.test(raw),
          preview: raw.slice(0, 600)
        };
      },
      /** 清除 KGM 金丝雀预检缓存；返回可读说明（removeItem 本身返回 undefined 是正常的） */
      clearPreflightCache() {
        const r = apiService.clearKgmCanaryCache();
        devLog('[debugYueli] clearPreflightCache', r.message);
        return r;
      },
      /** 查看/切换 PDF 附件聊天模式：compact（默认）| full_committee */
      pdfAttachmentChatMode(mode?: 'compact' | 'full_committee') {
        if (mode === 'compact' || mode === 'full_committee') {
          localStorage.setItem('yueli_pdf_attachment_chat_mode', mode);
          return { ok: true, mode, message: `已设为 ${mode}` };
        }
        const current = localStorage.getItem('yueli_pdf_attachment_chat_mode') || 'compact';
        return { current, hint: 'debugYueli.pdfAttachmentChatMode("compact") 或 ("full_committee")' };
      }
    };
    if (import.meta.env.DEV) {
      devLog(
        '🛠 debugYueli ready - sessions() / session(id) / clearPreflightCache() / pdfAttachmentChatMode()'
      );
    }
  }, []);

  /**
   * 单一持久化入口：用 functional update 避免闭包航脱，先写 React state，再写 localStorage。
   * `producer` 拿到的是该 session 当前最新的消息数组（来自 prevSessionMessages），需要返回新数组。
   */
  const persistSessionMessages = useCallback(
    (sessionId: string, producer: (prevMsgs: any[]) => any[]) => {
      setSessionMessages((prev) => {
        const prevList = Array.isArray(prev[sessionId]) ? prev[sessionId] : [];
        const nextList = producer(prevList) || prevList;
        const next = { ...prev, [sessionId]: nextList };
        try {
          localStorage.setItem('yueli_session_messages', JSON.stringify(next));
        } catch (e) {
          devError('Failed to persist session messages:', e);
        }
        return next;
      });
    },
    []
  );
  const [selectedProvider, setSelectedProvider] = useState<ChatProvider>(() => {
    const saved = localStorage.getItem('selectedProvider');
    if (saved === 'anthropic') return 'kgm';
    return (saved as ChatProvider) || 'kgm';
  });

  useEffect(() => {
    if (localStorage.getItem('selectedProvider') === 'anthropic') {
      localStorage.setItem('selectedProvider', 'kgm');
      setSelectedProvider('kgm');
    }
  }, []);

  /** 云端推理等写入 localStorage 后刷新 modelOptions；同标签页依赖配置弹窗 onClose 递增 */
  const [cloudProvidersRevision, setCloudProvidersRevision] = useState(0);
  const [kgmCatalog, setKgmCatalog] = useState<KgmCatalogEntry[]>([]);

  const modelOptions = useMemo((): TieredModelOption[] => {
    if (selectedProvider === 'kgm' || selectedProvider === 'yueliai') {
      return buildTieredModelOptions(kgmCatalog);
    }
    const cloudConfig = loadChatCloudConfigFromLocalStorage();
    return resolveModelOptionsFromCloudConfig(cloudConfig).options.map((o) => ({
      ...o,
      tier: 'L1' as const,
      group: '第1层 · KGM（Playground / auto）'
    }));
  }, [cloudProvidersRevision, kgmCatalog, selectedProvider]);

  useEffect(() => {
    if (selectedProvider !== 'kgm' && selectedProvider !== 'yueliai') return;
    const kgmRoot = apiService.resolveChatRuntimeSnapshot('kgm-dynamic', 'kgm').kgmHttpRootDisplay;
    void fetchKgmModelCatalog(kgmRoot).then((entries) => {
      setKgmCatalog(entries);
    });
  }, [selectedProvider, selectedModel, cloudProvidersRevision]);

  /** 与 send / 预检一致：KGM 下展示规范化后的 model（动态路由为 auto），真实上游由 KGM L2>L1 路由 */
  const chatRuntimeSnap = useMemo(
    () => apiService.resolveChatRuntimeSnapshot(selectedModel, selectedProvider),
    [selectedModel, selectedProvider, cloudProvidersRevision]
  );
  const routePlan = useChatRoutePlan(selectedProvider, selectedModel);
  const chatRuntimeBadge = `${routePlan.tier} · ${routePlan.vendor || routePlan.provider}:${routePlan.displayModel}`;
  const resolvedChatRequestModel = chatRuntimeSnap.model;

  const skillNamesMap = useMemo(() => {
    const m = new Map<string, string>();
    const configs = orchestrator?.getSkillExecutor?.()?.getSkillConfigs?.();
    for (const id of activeSkillIds) {
      const cfg = configs?.get(id);
      m.set(id, cfg?.name || skills.find((s) => s.id === id)?.name || id);
    }
    return m;
  }, [orchestrator, activeSkillIds, skills]);

  const composerOpenAiToolsSent = useMemo(
    () => messages.some((m) => m.role === 'tool'),
    [messages]
  );

  useEffect(() => {
    if (!modelOptions?.length) return;
    const valid = new Set(modelOptions.map((o) => o.value));
    const cur = `${selectedProvider}:${selectedModel}`;
    if (valid.has(cur)) return;
    const sameProv = modelOptions.find((o) => String(o.value).startsWith(`${selectedProvider}:`));
    const pick = sameProv ?? modelOptions[0];
    if (!pick?.value) return;
    const [p, ...rest] = String(pick.value).split(':');
    const m = rest.join(':');
    setSelectedProvider(p as ChatProvider);
    setSelectedModel(m);
    localStorage.setItem('selectedProvider', p);
    localStorage.setItem('selectedModel', m);
  }, [modelOptions, selectedProvider, selectedModel]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'cloudProviders' || e.key === 'kgmScheduleStrategy') setCloudProvidersRevision((x) => x + 1);
    };
    const onLocalCloudSave = () => setCloudProvidersRevision((x) => x + 1);
    window.addEventListener('storage', onStorage);
    window.addEventListener('yueli-cloud-providers-changed', onLocalCloudSave);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('yueli-cloud-providers-changed', onLocalCloudSave);
    };
  }, []);

  const enabledToolsCount = useMemo(() => {
    try {
      const skillExecutor = orchestrator?.getSkillExecutor?.();
      const skillConfigs = skillExecutor?.getSkillConfigs?.();
      if (!skillConfigs) return 0;
      return activeSkillIds.reduce((sum, id) => {
        const cfg = skillConfigs.get(id);
        const tools = Array.isArray(cfg?.tools) ? cfg.tools.length : 0;
        return sum + tools;
      }, 0);
    } catch {
      return 0;
    }
  }, [orchestrator, activeSkillIds]);

  const [permissionModalOpen, setPermissionModalOpen] = useState(false);
  const permissionPendingRef = useRef<{
    skillId: string;
    permissions: SkillPermission[];
    resolve: (decision: PermissionDecision) => void;
    reject: (err: Error) => void;
  } | null>(null);

  const [scriptConsentModalOpen, setScriptConsentModalOpen] = useState(false);
  const scriptConsentPendingRef = useRef<{
    skillId: string;
    kind: 'runtime' | 'entry';
    resolve: (decision: ScriptConsentDecision) => void;
    reject: (err: Error) => void;
  } | null>(null);

  /** 须在权限包装 handler 之前声明：工具权限回调会回填当前 bot 消息的审计摘要 */
  const botMessageIdRef = useRef<string>('');
  const permissionAuditForBotRef = useRef<PermissionAuditEntry[]>([]);

  const makePermissionAwareToolCallHandler = useCallback(
    (handler?: (name: string, args: any) => Promise<string>) => {
      if (!handler) return undefined;
      return (async (name: string, args: any) => {
        const parsedTool = parseSkillToolName(name);
        if (
          parsedTool &&
          (parsedTool.fn === 'skill_runtime' || parsedTool.fn === 'skill_entry')
        ) {
          const kind = parsedTool.fn === 'skill_runtime' ? 'runtime' : 'entry';
          if (!hasScriptConsent(parsedTool.skillId, kind)) {
            const decision = await new Promise<ScriptConsentDecision>((resolve, reject) => {
              scriptConsentPendingRef.current = {
                skillId: parsedTool.skillId,
                kind,
                resolve,
                reject
              };
              setScriptConsentModalOpen(true);
            });
            if (decision === 'deny') {
              return `Error: 已取消执行 ${parsedTool.fn}`;
            }
            applyScriptConsent(parsedTool.skillId, kind, decision);
          }
        }

        try {
          return await handler(name, args);
        } catch (err: any) {
          if (err?.code === 'PERMISSION_REQUIRED' && err?.skillId && Array.isArray(err?.requestedPermissions)) {
            const decision = await new Promise<PermissionDecision>((resolve, reject) => {
              permissionPendingRef.current = {
                skillId: err.skillId,
                permissions: err.requestedPermissions,
                resolve,
                reject
              };
              setPermissionModalOpen(true);
            });

            const skillExecutor = orchestrator?.getSkillExecutor?.();
            skillExecutor?.recordPermissionUiDecision(err.skillId, decision, err.requestedPermissions);

            const auditEntry: PermissionAuditEntry = {
              skillId: err.skillId,
              decision,
              permissions: err.requestedPermissions.map(String),
              at: Date.now()
            };
            permissionAuditForBotRef.current = [...permissionAuditForBotRef.current, auditEntry];

            setMessages((prev) =>
              prev.map((m) =>
                m.id !== botMessageIdRef.current
                  ? m
                  : {
                      ...m,
                      permissionAuditTrail: [...(m.permissionAuditTrail || []), auditEntry]
                    }
              )
            );

            if (decision === 'deny') {
              throw new Error(`权限被拒绝: ${err.requestedPermissions.join(', ')}`);
            }

            if (!skillExecutor) {
              throw new Error('SkillExecutor 未初始化，无法授予权限');
            }

            if (decision === 'allow_always') {
              skillExecutor.grantPermissions(err.skillId, err.requestedPermissions);
              return await handler(name, args);
            }

            const prevPolicy = skillExecutor.getPermissionPolicy(err.skillId);
            try {
              skillExecutor.grantPermissions(err.skillId, err.requestedPermissions);
              const res = await handler(name, args);
              skillExecutor.setPermissionPolicy(err.skillId, prevPolicy);
              return res;
            } catch (e) {
              skillExecutor.setPermissionPolicy(err.skillId, prevPolicy);
              throw e;
            }
          }
          throw err;
        }
      }) as any;
    },
    [orchestrator, setMessages]
  );

  // 搜索功能相关状态
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
  const [isHistorySearchModalOpen, setIsHistorySearchModalOpen] = useState(false);
  const [searchQueryGlobal, setSearchQueryGlobal] = useState('');
  const [searchResults, setSearchResults] = useState<Array<{
    type: 'skill' | 'prompt';
    id: string;
    name: string;
    description: string;
    enabled?: boolean;
  }>>([]);
  const [historySearchQuery, setHistorySearchQuery] = useState('');
  const [historySearchResults, setHistorySearchResults] = useState<Array<{
    sessionId: string;
    sessionName: string;
    messageContent: string;
    timestamp: number;
  }>>([]);

  /** 模态框 / 底栏 Popover 互斥：同时只显示一个 */
  const closeAllExclusiveOverlays = useCallback(() => {
    setIsAddMenuOpen(false);
    setIsApiConfigModalOpen(false);
    setIsKnowledgeModalOpen(false);
    setIsChatDocumentsModalOpen(false);
    setIsPromptConfigModalOpen(false);
    setIsCreateTopicModalOpen(false);
    setIsRenameModalOpen(false);
    setIsDeleteConfirmOpen(false);
    setIsInstructionModalOpen(false);
    setIsAddInstructionModalOpen(false);
    setIsSearchModalOpen(false);
    setIsHistorySearchModalOpen(false);
    setIsSkillInstallModalOpen(false);
  }, []);

  type ExclusiveOverlayKey =
    | 'addMenu'
    | 'apiConfig'
    | 'knowledge'
    | 'chatDocuments'
    | 'promptConfig'
    | 'createTopic'
    | 'rename'
    | 'deleteConfirm'
    | 'instruction'
    | 'addInstruction'
    | 'search'
    | 'historySearch'
    | 'skillInstall';

  const openExclusiveOverlay = useCallback(
    (key: ExclusiveOverlayKey) => {
      closeAllExclusiveOverlays();
      switch (key) {
        case 'addMenu':
          setIsAddMenuOpen(true);
          break;
        case 'apiConfig':
          setIsApiConfigModalOpen(true);
          break;
        case 'knowledge':
          setIsKnowledgeModalOpen(true);
          break;
        case 'chatDocuments':
          setIsChatDocumentsModalOpen(true);
          break;
        case 'promptConfig':
          setIsPromptConfigModalOpen(true);
          break;
        case 'createTopic':
          setIsCreateTopicModalOpen(true);
          break;
        case 'rename':
          setIsRenameModalOpen(true);
          break;
        case 'deleteConfirm':
          setIsDeleteConfirmOpen(true);
          break;
        case 'instruction':
          setIsInstructionModalOpen(true);
          break;
        case 'addInstruction':
          setIsAddInstructionModalOpen(true);
          break;
        case 'search':
          setIsSearchModalOpen(true);
          break;
        case 'historySearch':
          setIsHistorySearchModalOpen(true);
          break;
        case 'skillInstall':
          setIsSkillInstallModalOpen(true);
          break;
        default: {
          const _exhaustive: never = key;
          void _exhaustive;
        }
      }
    },
    [closeAllExclusiveOverlays]
  );

  const toggleExclusiveOverlay = useCallback(
    (key: ExclusiveOverlayKey, isOpen: boolean) => {
      if (isOpen) {
        closeAllExclusiveOverlays();
      } else {
        openExclusiveOverlay(key);
      }
    },
    [closeAllExclusiveOverlays, openExclusiveOverlay]
  );

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      closeAllExclusiveOverlays();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [closeAllExclusiveOverlays]);

  const openToolsMenuTab = useCallback(
    (tab: typeof toolsMenuDefaultTab) => {
      setToolsMenuDefaultTab(tab);
      openExclusiveOverlay('addMenu');
    },
    [openExclusiveOverlay]
  );

  // 主题相关状态
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('theme');
    return (saved as 'light' | 'dark') || 'light';
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  /** 系统文件框打开时忽略 Popover 的 onOpenChange(false)，避免失焦收起菜单 */
  const isPickingFilesRef = useRef(false);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const input = fileInputRef.current;
    if (!input) return;
    const onCancel = () => {
      isPickingFilesRef.current = false;
    };
    input.addEventListener('cancel', onCancel);
    return () => input.removeEventListener('cancel', onCancel);
  }, []);

  const beginFilePick = useCallback(() => {
    isPickingFilesRef.current = true;
    openExclusiveOverlay('addMenu');
  }, [openExclusiveOverlay]);

  const handleToolsMenuUploadFiles = useCallback(async () => {
    beginFilePick();
    try {
      const desktopPicked = await pickChatFilesViaDesktop();
      if (desktopPicked === null) {
        window.setTimeout(() => fileInputRef.current?.click(), 0);
        return;
      }
      if (desktopPicked.length > 0) {
        setFiles((prev) => [...prev, ...desktopPicked]);
        setIsAddMenuOpen(false);
      }
      isPickingFilesRef.current = false;
    } catch (err) {
      devError('[upload] 选择文件失败:', err);
      isPickingFilesRef.current = false;
    }
  }, [beginFilePick]);
  const [voiceInterimDisplay, setVoiceInterimDisplay] = useState('');
  const accumulatedContentRef = useRef<string>('');
  const lastIncrementalSaveAtRef = useRef<number>(0);

  const handleVoiceInterim = useCallback((s: string) => {
    setVoiceInterimDisplay(s);
  }, []);

  const appendVoiceTranscript = useCallback((segment: string) => {
    const t = segment.replace(/\s+/g, ' ').trim();
    if (!t) return;
    setInput((prev) => {
      const el = textAreaRef.current;
      if (!el) {
        if (!prev) return t;
        const join = /\s$/.test(prev) || /^[，。！？、；：,.!?]/.test(t) ? '' : ' ';
        return prev + join + t;
      }
      const start = typeof el.selectionStart === 'number' ? el.selectionStart : prev.length;
      const end = typeof el.selectionEnd === 'number' ? el.selectionEnd : prev.length;
      const prefix = prev.slice(0, start);
      const suffix = prev.slice(end);
      const needSpace = prefix.length > 0 && !/\s$/.test(prefix) && !/^[，。！？、；：,.!?]/.test(t);
      const ins = (needSpace ? ' ' : '') + t;
      const next = prefix + ins + suffix;
      requestAnimationFrame(() => {
        try {
          el.focus();
          const pos = prefix.length + ins.length;
          el.setSelectionRange(pos, pos);
        } catch {
          /* ignore */
        }
      });
      return next;
    });
  }, []);

  // 格式化最后活跃时间
  const formatLastActiveTime = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const date = new Date(timestamp);
    const currentYear = new Date().getFullYear();
    const messageYear = date.getFullYear();
    const isSameYear = currentYear === messageYear;
    
    if (!isSameYear) {
      // 跨年：显示 YYYY/MM/DD, HH
      return `${messageYear}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}, ${String(date.getHours()).padStart(2, '0')}`;
    } else if (days === 0) {
      // 不跨年且 1 天内：显示 HH:mm:ss
      return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
    } else if (days < 7) {
      // 不跨年且 >24 小时但 <7 天：显示 MM/DD, 周X HH:mm:ss
      const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
      const weekday = weekdays[date.getDay()];
      return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}, ${weekday} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
    } else if (days < 30) {
      // 不跨年且 >7 天但 <30 天：显示 MM/DD, HH:mm:ss
      return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}, ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
    } else {
      // 不跨年且 >30 天：显示 MM/DD
      return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
    }
  };

  // 历史会话搜索处理函数
  const handleHistorySearch = (query: string) => {
    setHistorySearchQuery(query);
    if (!query.trim()) {
      setHistorySearchResults([]);
      return;
    }
    
    const results: Array<{sessionId: string; sessionName: string; messageContent: string; timestamp: number}> = [];
    const lowerQuery = query.toLowerCase();
    
    Object.entries(sessionMessages).forEach(([sessionId, msgs]) => {
      const session = sessions.find(s => s.id === sessionId);
      msgs.forEach((msg: any) => {
        if (msg.content && msg.content.toLowerCase().includes(lowerQuery)) {
          results.push({
            sessionId,
            sessionName: session?.name || '未命名会话',
            messageContent: msg.content.substring(0, 100) + (msg.content.length > 100 ? '...' : ''),
            timestamp: session?.lastActive || Date.now()
          });
        }
      });
    });
    
    results.sort((a, b) => b.timestamp - a.timestamp);
    setHistorySearchResults(results.slice(0, 20));
  };

  const handleHistorySearchInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setHistorySearchQuery(query);
    handleHistorySearch(query);
  };

  const handleCloseHistorySearchModal = () => {
    setIsHistorySearchModalOpen(false);
    setHistorySearchQuery('');
    setHistorySearchResults([]);
  };

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // 同步provider到apiService
  useEffect(() => {
    apiService.setProvider(selectedProvider);
  }, [selectedProvider]);

  // 处理编辑消息
  const handleEditMessage = async (messageId: string, newContent: string) => {
    // 找到需要编辑的消息索引
    const messageIndex = messages.findIndex(msg => msg.id === messageId);
    if (messageIndex === -1) return;

    const sessionId = currentSessionId || `session-${Date.now()}`;
    if (!currentSessionId) {
      setCurrentSessionId(sessionId);
    }

    // 删除编辑消息之后的所有消息（包括机器人回复）
    const newMessages = messages.slice(0, messageIndex + 1);
    
    // 更新编辑的消息
    newMessages[messageIndex] = { 
      ...newMessages[messageIndex], 
      content: newContent, 
      status: 'sending' 
    };

    setMessages([...newMessages]);
    setIsLoading(true);
    setError(null);

    // 重置 refs
    accumulatedContentRef.current = '';
    botMessageIdRef.current = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    permissionAuditForBotRef.current = [];

    // 创建一个消息来显示思考状态和最终回复
    const botMessage: Message = {
      id: botMessageIdRef.current,
      role: 'bot',
      content: 'Yueli AI思考中...',
      sender: 'Yueli Copilot',
      time: new Date().toLocaleTimeString(),
      isThinking: true
    };
    setMessages(prev => [...prev, botMessage]);

    // 首先使用编排器处理输入
    let processedContent = newContent;
    let hasRenderedOutput = false;
    let renderedOutput: RenderedOutput | undefined;

    try {
      const orchestratorResult = await processWithOrchestrator(newContent);
      
      if (orchestratorResult.enhancedPrompt) {
        processedContent = orchestratorResult.enhancedPrompt;
      }

      // 合并快捷提示的 functionPrompt
      const selectedPromptObjects = prompts.filter(p => selectedPrompts.includes(p.id));
      const functionPrompts = selectedPromptObjects
        .filter(p => p.functionPrompt)
        .map(p => p.functionPrompt);
      if (functionPrompts.length > 0) {
        processedContent = `${functionPrompts.join('\n\n')}\n\n用户输入：${processedContent}`;
      }
      
      if (orchestratorResult.renderedOutput) {
        renderedOutput = orchestratorResult.renderedOutput;
        hasRenderedOutput = true;
      }
      
      if (!orchestratorResult.shouldUseLLM && renderedOutput) {
        let displayContent = '';
        if (renderedOutput.type === 'html') {
          displayContent = `\`\`\`html\n${renderedOutput.content}\n\`\`\``;
        } else if (renderedOutput.type === 'json') {
          displayContent = `\`\`\`json\n${renderedOutput.content}\n\`\`\``;
        } else {
          displayContent = finalizeKgmAssistantMarkdownIfNeeded(renderedOutput.content);
        }

        const editedMeta = {
          user_visible_input: newContent.trim(),
          llm_expanded_char_count: processedContent.length
        };
        const editedUserRow: Message = {
          ...newMessages[messageIndex],
          content: newContent.trim(),
          status: 'sent' as const,
          metadata: {
            ...(newMessages[messageIndex].metadata || {}),
            ...editedMeta
          }
        };
        const botRowPersist = {
          id: botMessageIdRef.current,
          role: 'bot',
          content: displayContent,
          sender: 'Yueli Copilot',
          time: new Date().toLocaleTimeString(),
          isThinking: false,
          provider: selectedProvider,
          model: resolvedChatRequestModel,
          finalStatus: 'done' as const
        };

        setMessages((prev) =>
          prev.map((msg) => {
            if (msg.id === messageId) {
              return { ...msg, ...editedUserRow };
            }
            if (msg.id === botMessageIdRef.current) {
              return {
                ...msg,
                content: displayContent,
                isThinking: false,
                provider: selectedProvider,
                model: resolvedChatRequestModel,
                finalStatus: 'done' as const
              };
            }
            return msg;
          })
        );

        persistSessionMessages(sessionId, () => {
          const prefix = newMessages.slice(0, messageIndex).map((m) => ({
            ...m,
            status: (m.status === 'sending' ? 'sent' : m.status) as Message['status']
          }));
          return [...prefix, editedUserRow, botRowPersist];
        });

        setIsLoading(false);
        setIsThinking(false);
        return;
      }
    } catch (orchestratorError) {
      devWarn('编排器处理失败，继续使用原始输入');
    }

    // 获取项目主题关联的指令
    const topicInstructionIds = selectedTopic?.instructions || [];
    const topicInstructions = instructions.filter(i => topicInstructionIds.includes(i.id));

    // 获取技能配置
    const skillExecutor = orchestrator?.getSkillExecutor();
    const skillConfigs = skillExecutor?.getSkillConfigs();

    // 获取人格层systemPrompt
    const personalityPrompt = personalitySystem.generateSystemPrompt();

    let tools: any[] | undefined;
    let toolCallHandler: ((name: string, args: any) => Promise<string>) | undefined;
    let knowledgeRagContext: string | undefined;
    try {
      const orchResult = await processWithOrchestrator(processedContent, activeSkillIds);
      knowledgeRagContext = orchResult.ragContext;
      if (orchResult.tools && orchResult.tools.length > 0) {
        tools = orchResult.tools;
        toolCallHandler = orchResult.toolCallHandler;
      }
    } catch (e) {
      devWarn('获取工具定义失败');
    }
    
    // 构建完整的 messages 并走 LLM；与发送消息一致写入 localStorage（yueli_session_messages）
    try {
      const selectedPromptObjects = prompts.filter(p => selectedPrompts.includes(p.id));
      const { freshTopic, topicFusionContext } = await fetchTopicFusionContext(
        selectedTopic,
        topics,
        processedContent,
        sessionId,
        newMessages,
        activeSkillIds
      );
      const apiMessages = buildMessages(
        processedContent,
        freshTopic,
        newMessages,
        topicInstructions,
        knowledgeItems,
        activeSkillIds,
        skillConfigs,
        selectedPromptObjects,
        personalityPrompt,
        processedContent,
        knowledgeRagContext,
        { topicFusionContext }
      );

      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId
            ? {
                ...m,
                metadata: {
                  ...(m.metadata || {}),
                  user_visible_input: newContent.trim(),
                  llm_expanded_char_count: processedContent.length
                }
              }
            : m
        )
      );

      let updateTimer: ReturnType<typeof setTimeout> | null = null;
      const streamStateRef = { current: createInitialStreamReducerState() };

      const currentActiveSkills = [...activeSkillIds];
      const debugStream =
        typeof window !== 'undefined' &&
        window.localStorage?.getItem('yueli_debug_stream') === '1';
      if (debugStream) {
        devDebug('🚀 当前激活的技能:', currentActiveSkills);
      }

      const editSendRes = await sendOllamaMessageWithMessages(
        selectedModel,
        apiMessages,
        (data) => {
          if (debugStream) {
            devDebug('📡 收到消息回调数据:', {
              hasMessage: Boolean(data?.message),
              messageKeys: data?.message ? Object.keys(data.message) : [],
              hasToolExecuting: Boolean(data?.tool_call_executing),
              hasToolResult: Boolean(data?.tool_call_result),
              hasToolError: Boolean(data?.tool_call_error),
              hasError: Boolean(data?.error),
              hasSources: Array.isArray(data?.sources) && data.sources.length > 0
            });
          }

          const evt = normalizeRawStreamEvent(data);
          if (!evt) return;
          const reduced = reduceStreamEvent(streamStateRef.current, evt);
          streamStateRef.current = reduced.state;

          const patch = reduced.patch;
          const shouldDebounceContent = Object.prototype.hasOwnProperty.call(patch, 'content');
          if (shouldDebounceContent) {
            if (updateTimer) clearTimeout(updateTimer);
            updateTimer = setTimeout(() => {
              setMessages((prev) =>
                prev.map((msg) => (msg.id === botMessageIdRef.current ? { ...msg, ...patch } : msg))
              );
            }, 80);
            return;
          }

          setMessages((prev) =>
            prev.map((msg) => (msg.id === botMessageIdRef.current ? { ...msg, ...patch } : msg))
          );
        },
        { tools, toolCallHandler: makePermissionAwareToolCallHandler(toolCallHandler), enabledSkillIds: activeSkillIds }
      );
      const editInvocationMetrics = extractInvocationMetrics(editSendRes, routePlan);

      if (updateTimer) {
        clearTimeout(updateTimer);
        updateTimer = null;
      }
      const editApi = editSendRes && typeof editSendRes === 'object' ? editSendRes : {};
      let editResolvedContent =
        streamStateRef.current.accumulatedContent ||
        (typeof editApi.content === 'string' ? editApi.content : '') ||
        '';
      const editResolvedReasoning =
        streamStateRef.current.reasoningContent ||
        (typeof editApi.reasoningContent === 'string' ? editApi.reasoningContent : '') ||
        undefined;
      const editThinkingFromApi =
        typeof editApi.thinkingContent === 'string' && editApi.thinkingContent.trim()
          ? editApi.thinkingContent
          : '';
      const editResolvedThinkingRecords =
        streamStateRef.current.thinkingRecords.length > 0
          ? streamStateRef.current.thinkingRecords
          : editThinkingFromApi
            ? [{ content: editThinkingFromApi, timestamp: Date.now() }]
            : undefined;

      editResolvedContent = pickAssistantVisibleRawText({
        accumulatedContent: editResolvedContent,
        toolCallRecords: streamStateRef.current.toolCallRecords,
        reasoningContent: editResolvedReasoning,
        thinkingContent: editThinkingFromApi,
        thinkingRecords: streamStateRef.current.thinkingRecords
      });
      editResolvedContent = finalizeKgmAssistantMarkdownIfNeeded(editResolvedContent);

      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.id === messageId) {
            return {
              ...msg,
              content: newContent.trim(),
              status: 'sent' as const,
              metadata: {
                ...(msg.metadata || {}),
                user_visible_input: newContent.trim(),
                llm_expanded_char_count: processedContent.length
              }
            };
          }
          if (msg.id === botMessageIdRef.current) {
            return {
              ...msg,
              content: editResolvedContent,
              isThinking: false,
              reasoningContent: editResolvedReasoning,
              toolCallRecords: streamStateRef.current.toolCallRecords,
              thinkingRecords: editResolvedThinkingRecords,
              sources: streamStateRef.current.sources.length ? streamStateRef.current.sources : undefined,
              skillsUsed: currentActiveSkills,
              permissionAuditTrail:
                permissionAuditForBotRef.current.length > 0
                  ? [...permissionAuditForBotRef.current]
                  : msg.permissionAuditTrail,
              metrics: editInvocationMetrics || msg.metrics,
              finalStatus: 'done' as const
            };
          }
          return msg;
        })
      );

      persistSessionMessages(sessionId, () => {
        const prefix = newMessages.slice(0, messageIndex).map((m) => ({
          ...m,
          status: (m.status === 'sending' ? 'sent' : m.status) as Message['status']
        }));
        const editedUserRow: Message = {
          ...newMessages[messageIndex],
          content: newContent.trim(),
          status: 'sent' as const,
          metadata: {
            ...(newMessages[messageIndex].metadata || {}),
            user_visible_input: newContent.trim(),
            llm_expanded_char_count: processedContent.length
          }
        };
        const botRowSerial = {
          id: botMessageIdRef.current,
          role: 'bot',
          content: editResolvedContent,
          sender: 'Yueli Copilot',
          time: new Date().toLocaleTimeString(),
          isThinking: false,
          provider: selectedProvider,
          model: resolvedChatRequestModel,
          reasoningContent: editResolvedReasoning,
          toolCallRecords: streamStateRef.current.toolCallRecords,
          thinkingRecords: editResolvedThinkingRecords,
          sources: streamStateRef.current.sources.length ? streamStateRef.current.sources : undefined,
          permissionAuditTrail:
            permissionAuditForBotRef.current.length > 0 ? [...permissionAuditForBotRef.current] : undefined,
          metrics: editInvocationMetrics,
          finalStatus: 'done' as const
        };
        return [...prefix, editedUserRow, botRowSerial];
      });
    } catch (err: unknown) {
      const errorText = err instanceof Error ? err.message : String(err || '未知错误');
      toast.error(`重新生成失败：${errorText}`);

      const errorBanner =
        `\n\n❌ **请求失败**：${errorText}\n\n> 可修改后重试或重新发送。`;

      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.id === messageId) {
            return { ...msg, status: 'failed' as const };
          }
          if (msg.id === botMessageIdRef.current) {
            return {
              ...msg,
              content: errorBanner,
              isThinking: false,
              status: 'failed' as const,
              finalStatus: 'error' as const
            };
          }
          return msg;
        })
      );

      persistSessionMessages(sessionId, () => {
        const prefix = newMessages.slice(0, messageIndex).map((m) => ({
          ...m,
          status: m.status === 'sending' ? ('sent' as const) : m.status
        }));
        const editedFailed: Message = {
          ...newMessages[messageIndex],
          content: newContent.trim(),
          status: 'failed' as const,
          metadata: {
            ...(newMessages[messageIndex].metadata || {}),
            user_visible_input: newContent.trim(),
            llm_expanded_char_count: processedContent.length
          }
        };
        const botFailed = {
          id: botMessageIdRef.current,
          role: 'bot',
          content: errorBanner,
          sender: 'Yueli Copilot',
          time: new Date().toLocaleTimeString(),
          isThinking: false,
          provider: selectedProvider,
          model: resolvedChatRequestModel,
          status: 'failed' as const,
          finalStatus: 'error' as const
        };
        return [...prefix, editedFailed, botFailed];
      });
    } finally {
      setIsLoading(false);
      setIsThinking(false);
    }
  };

  // 处理发送消息
  const handleSendMessage = async (content: string, files: ChatFile[] = []) => {
    if (!content.trim() && files.length === 0) return;

    const filesToSend = [...files];
    const userNote = content.trim();
    const attachmentNames = filesToSend.map((f) => f.name);

    const userMessage: Message = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      role: 'user',
      content: formatUserMessageWithAttachments(userNote, attachmentNames),
      sender: 'User',
      time: new Date().toLocaleTimeString(),
      isThinking: false,
      status: 'sending',
      metadata:
        attachmentNames.length > 0
          ? { attached_files: attachmentNames, user_visible_input: userNote }
          : undefined
    };

    // 确保有会话ID
    const sessionId = currentSessionId || `session-${Date.now()}`;
    setCurrentSessionId(sessionId);

    // 更新当前会话的消息
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setFiles([]);
    setError(null);

    /** 附件正文注入 LLM（此前仅 UI 展示，未进入 buildMessages） */
    let attachmentLlmPayload = '';
    if (filesToSend.length > 0) {
      try {
        const blocks = await extractTextFromChatFiles(filesToSend, {
          sessionId,
          topicId: selectedTopic?.id
        });
        const failed = blocks.filter((b) => b.error);
        const extractedChars = blocks.reduce((n, b) => n + (b.text?.length ?? 0), 0);
        if (failed.length === blocks.length) {
          toast.error(
            `附件解析失败：${failed.map((b) => `${b.name}（${b.error}）`).join('、')}`
          );
          setMessages((prev) =>
            prev.map((m) => (m.id === userMessage.id ? { ...m, status: 'failed' as const } : m))
          );
          setIsLoading(false);
          return;
        }
        if (extractedChars < 80) {
          toast.error(
            `PDF 未解析出可用正文（约 ${extractedChars} 字），可能为扫描版或 pdf.js 加载失败。请粘贴文本或换可复制文字的 PDF。`
          );
          setMessages((prev) =>
            prev.map((m) => (m.id === userMessage.id ? { ...m, status: 'failed' as const } : m))
          );
          setIsLoading(false);
          return;
        }
        if (failed.length > 0) {
          toast(`部分附件解析失败：${failed.map((b) => b.name).join('、')}`);
        }

        const validBlocks = blocks
          .filter((b) => !b.error && b.text?.trim())
          .map((b) => ({ name: b.name, text: b.text!.trim(), error: b.error }));
        const attachmentChatMode = readPdfAttachmentChatMode();
        const pipeline = await ingestPdfAttachmentsForChat({
          sessionId,
          blocks: validBlocks,
          userNote,
          apiService,
          model: resolvedChatRequestModel,
          skipRoleStage: true
        });
        const docIds = pipeline.documents.map((d) => d.id);

        if (attachmentChatMode === 'compact') {
          const built = await buildAttachmentChatPromptForLlm({
            mode: 'compact',
            sessionId,
            documentIds: docIds,
            userNote,
            apiService
          });
          attachmentLlmPayload = built.prompt;
          userMessage.metadata = {
            ...(userMessage.metadata || {}),
            attached_files: attachmentNames,
            attachment_extract_chars: extractedChars,
            document_ids: docIds,
            pdf_pipeline_indexed_chunks: pipeline.indexedChunkCount,
            pdf_chat_prompt_mode: 'compact',
            pdf_orchestrator_pre_pipeline: false
          };
          toast.success(
            `PDF 已入库（${pipeline.indexedChunkCount} 块）；紧凑模式：RRF 召回 + 非流式推理（约 10 分钟上限，请耐心等待）。`,
            { duration: 6000 }
          );
        } else {
          let orchRoles: ReturnType<typeof orchestratorPdfSkillResultsToRoleOutputs> = [];
          let usedOrchestratorPrePipeline = false;
          try {
            const orchPdf = await processWithOrchestrator(
              userNote,
              undefined,
              undefined,
              undefined,
              undefined,
              {
                pdfAttachmentContext: {
                  blocks: validBlocks,
                  userNote,
                  primaryFileName: validBlocks[0]?.name
                }
              }
            );
            orchRoles = orchestratorPdfSkillResultsToRoleOutputs(orchPdf.skillResults);
            usedOrchestratorPrePipeline = orchRoles.length > 0;
          } catch (orchPdfErr) {
            devWarn('[handleSendMessage] PDF 编排器预管道失败，回退 Executor 角色', orchPdfErr);
          }

          let committeeRoles: ReturnType<typeof orchestratorPdfSkillResultsToRoleOutputs> = [];
          if (!usedOrchestratorPrePipeline) {
            const fallbackRoles: ReturnType<typeof orchestratorPdfSkillResultsToRoleOutputs> = [];
            const pipeMode = readPdfPipelineMode();
            for (const block of validBlocks) {
              const fileRoles = await runPdfOrchestratorRoleStage({
                rawText: block.text!,
                fileName: block.name,
                userNote,
                apiService,
                model: resolvedChatRequestModel,
                pipelineMode: pipeMode
              });
              fallbackRoles.push(...fileRoles);
            }
            const ragIdxFb = pipeline.roleOutputs.findIndex((r) => r.roleId === 'rag_curator');
            const beforeRagFb =
              ragIdxFb >= 0 ? pipeline.roleOutputs.slice(0, ragIdxFb) : pipeline.roleOutputs;
            const ragPartFb = ragIdxFb >= 0 ? pipeline.roleOutputs.slice(ragIdxFb) : [];
            committeeRoles = [...beforeRagFb, ...fallbackRoles, ...ragPartFb];
            toast.success(
              `PDF 已入库（${pipeline.indexedChunkCount} 块）；完整委员会模式，编排器不可用已回退 Executor。`,
              { duration: 6000 }
            );
          } else {
            const ragIdx = pipeline.roleOutputs.findIndex((r) => r.roleId === 'rag_curator');
            const beforeRag =
              ragIdx >= 0 ? pipeline.roleOutputs.slice(0, ragIdx) : pipeline.roleOutputs;
            const ragPart = ragIdx >= 0 ? pipeline.roleOutputs.slice(ragIdx) : [];
            committeeRoles = [...beforeRag, ...orchRoles, ...ragPart];
            toast.success(
              `PDF 已入库（${pipeline.indexedChunkCount} 块）；完整委员会模式（四角色全文注入，耗时较长）。`,
              { duration: 6000 }
            );
          }

          const built = await buildAttachmentChatPromptForLlm({
            mode: 'full_committee',
            sessionId,
            documentIds: docIds,
            userNote,
            apiService,
            committeeRoleOutputs: committeeRoles
          });
          attachmentLlmPayload = built.prompt;
          userMessage.metadata = {
            ...(userMessage.metadata || {}),
            attached_files: attachmentNames,
            attachment_extract_chars: extractedChars,
            document_ids: docIds,
            pdf_pipeline_indexed_chunks: pipeline.indexedChunkCount,
            pdf_pipeline_roles: committeeRoles.map((r) => r.roleId),
            pdf_pipeline_mode: pipeline.pipelineMode,
            pdf_chat_prompt_mode: 'full_committee',
            pdf_orchestrator_pre_pipeline: usedOrchestratorPrePipeline
          };
        }
      } catch (attachErr) {
        devError('[handleSendMessage] 附件解析失败:', attachErr);
        toast.error('附件解析失败，请重试或换用 TXT/MD/PDF');
        setMessages((prev) =>
          prev.map((m) => (m.id === userMessage.id ? { ...m, status: 'failed' as const } : m))
        );
        return;
      }
    }

    /** 无新附件、会话内已有 document_ids → 追问模式（仅 RAG，不重跑委员会） */
    if (!attachmentLlmPayload && filesToSend.length === 0 && userNote) {
      const priorDocIds = collectSessionDocumentIds(messages);
      if (priorDocIds.length > 0) {
        try {
          const follow = await buildDocumentFollowUpPrompt({
            sessionId,
            documentIds: priorDocIds,
            userNote,
            apiService,
            topicId: selectedTopic?.id,
            topic: resolveTopicFromList(selectedTopic, topics),
            includeWebFusion: activeSkillIds?.includes('desktop-knowledge-agent')
          });
          attachmentLlmPayload = follow.prompt;
          userMessage.metadata = {
            ...(userMessage.metadata || {}),
            document_ids: priorDocIds,
            pdf_follow_up: true
          };
          toast.success('PDF 追问：仅向量/服务端召回，未重跑委员会。', { duration: 4000 });
        } catch (followErr) {
          devWarn('[handleSendMessage] PDF 追问构建失败', followErr);
        }
      }
    }

    /** 管理口令门控：不调用 LLM，直接在对话区输出配置/管理入口说明 */
    const adminParse =
      filesToSend.length === 0 ? parseAdminManagementInput(userNote) : ({ kind: 'none' as const });
    const adminAssistantText = composeAdminManagementAssistantText(adminParse, selectedModel, selectedProvider);
    if (adminAssistantText !== null) {
      const adminBotId = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const adminTime = new Date().toLocaleTimeString();
      const adminBotMessage: Message = {
        id: adminBotId,
        role: 'bot',
        content: adminAssistantText,
        sender: 'Yueli Copilot',
        time: adminTime,
        isThinking: false,
        provider: selectedProvider,
        model: resolvedChatRequestModel,
        finalStatus: 'done'
      };
      setMessages((prev) => [
        ...prev.map((m) => (m.id === userMessage.id ? { ...m, status: 'sent' as const } : m)),
        adminBotMessage
      ]);
      persistSessionMessages(sessionId, (prevList) => {
        const without = prevList.filter((m: any) => m?.id !== userMessage.id && m?.id !== adminBotId);
        return [
          ...without,
          { ...userMessage, status: 'sent' as const },
          {
            id: adminBotId,
            role: 'bot',
            content: adminAssistantText,
            sender: 'Yueli Copilot',
            time: adminTime,
            isThinking: false,
            provider: selectedProvider,
            model: selectedModel
          }
        ];
      });
      return;
    }

    setIsLoading(true);

    /** 与 catch/finally 共享：落盘用户行（content 始终为用户可见输入） */
    let userRowForPersistence: Message = userMessage;

    // 注意：这些 ref 必须在 try 外声明，catch 中也要读取
    const thinkingContentRef = { current: '' };
    const reasoningContentRef = { current: '' };
    const sourcesRef = { current: [] as Array<{ name: string; type: string }> };

    try {
      // 重置ref
      accumulatedContentRef.current = '';
      botMessageIdRef.current = `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      permissionAuditForBotRef.current = [];
      lastIncrementalSaveAtRef.current = 0;

      // 创建一个消息来显示思考状态和最终回复
      const currentActiveSkills = [...activeSkillIds];
      const botMessage: Message = {
        id: botMessageIdRef.current,
        role: 'bot',
        content: 'Yueli AI思考中...',
        sender: 'Yueli Copilot',
        time: new Date().toLocaleTimeString(),
        isThinking: true,
        provider: selectedProvider,
        model: resolvedChatRequestModel,
        skillsUsed: currentActiveSkills,
        finalStatus: 'in_progress' as const,
        executionTimeline: []
      };
      setMessages(prev => [...prev, botMessage]);

      // 用于防抖的定时器
      let updateTimer: ReturnType<typeof setTimeout> | null = null;
      // thinkingContentRef / reasoningContentRef / sourcesRef 已在 try 外声明，便于 catch 复用
      
      // 首先使用编排器处理输入（路由/技能用用户可见短句；附件正文在下方单独注入 LLM）
      let processedContent = userNote;
      let hasRenderedOutput = false;
      let renderedOutput: RenderedOutput | undefined;

      try {
        if (attachmentLlmPayload) {
          devLog('[YueliCopilot] 附件任务：已构建 LLM prompt，跳过首轮编排器');
        } else {
        const stageTimes = new Map<string, number>();
        const orchestratorResult = await processWithOrchestrator(userNote, undefined, undefined, undefined, (evt) => {
          const raw = evt.stage || '';
          const colonIdx = raw.indexOf(':');
          const stage = (colonIdx >= 0 ? raw.slice(0, colonIdx) : raw) as any;
          const phase = colonIdx >= 0 ? raw.slice(colonIdx + 1) : '';
          const at = typeof evt.at === 'number' ? evt.at : Date.now();
          const key = `${evt.runId}:${stage}`;

          let durationMs: number | undefined;
          if (phase === 'start') {
            stageTimes.set(key, at);
            // 不在时间线里追加「分析/准备」的 start 行，避免与 end 行重复；仅 end / 无阶段事件落一条
            return;
          }
          if (phase === 'end') {
            const startedAt = stageTimes.get(key);
            if (typeof startedAt === 'number') durationMs = at - startedAt;
          }

          setMessages((prev) =>
            prev.map((msg) => {
              if (msg.id !== botMessageIdRef.current) return msg;
              const existing = Array.isArray(msg.executionTimeline) ? msg.executionTimeline : [];
              return {
                ...msg,
                executionTimeline: [
                  ...existing,
                  {
                    runId: evt.runId,
                    stage,
                    at,
                    durationMs,
                    message: evt.message
                  }
                ]
              };
            })
          );
        });
        
        if (orchestratorResult.enhancedPrompt) {
          processedContent = orchestratorResult.enhancedPrompt;
        }

        // 合并快捷提示的 functionPrompt
        const selectedPromptObjects = prompts.filter(p => selectedPrompts.includes(p.id));
        const functionPrompts = selectedPromptObjects
          .filter(p => p.functionPrompt)
          .map(p => p.functionPrompt);
        if (functionPrompts.length > 0) {
          processedContent = `${functionPrompts.join('\n\n')}\n\n用户输入：${processedContent}`;
        }
        
        if (orchestratorResult.renderedOutput) {
          renderedOutput = orchestratorResult.renderedOutput;
          hasRenderedOutput = true;
        }
        
        if (!orchestratorResult.shouldUseLLM && renderedOutput) {
          let displayContent = '';
          if (renderedOutput.type === 'html') {
            displayContent = `\`\`\`html\n${renderedOutput.content}\n\`\`\``;
          } else if (renderedOutput.type === 'json') {
            displayContent = `\`\`\`json\n${renderedOutput.content}\n\`\`\``;
          } else {
            displayContent = finalizeKgmAssistantMarkdownIfNeeded(renderedOutput.content);
          }

          const userRowRendered: Message = {
            ...userMessage,
            metadata: {
              ...(userMessage.metadata || {}),
              user_visible_input: content.trim(),
              llm_expanded_char_count: processedContent.length
            }
          };

          setMessages(prev =>
            prev.map(msg => {
              if (msg.id === userMessage.id) {
                return { ...msg, metadata: userRowRendered.metadata };
              }
              if (msg.id === botMessageIdRef.current) {
                return {
                  ...msg,
                  content: displayContent,
                  isThinking: false
                };
              }
              return msg;
            })
          );
          
          setSessionMessages(prev => ({
            ...prev,
            [sessionId]: [...(prev[sessionId] || []), userRowRendered, {
              id: botMessageIdRef.current,
              role: 'bot',
              content: displayContent,
              sender: 'Yueli Copilot',
              time: new Date().toLocaleTimeString(),
              isThinking: false,
              provider: selectedProvider,
              model: selectedModel
            }]
          }));
          
          setIsLoading(false);
          setIsThinking(false);
          return;
        }
        }
      } catch (orchestratorError) {
        devWarn('编排器处理失败，继续使用原始输入');
      }

      // 获取项目主题关联的指令
      const topicInstructionIds = selectedTopic?.instructions || [];
      const topicInstructions = instructions.filter(i => topicInstructionIds.includes(i.id));

      // 获取技能配置
      const skillExecutor = orchestrator?.getSkillExecutor();
      const skillConfigs = skillExecutor?.getSkillConfigs();

      // 获取人格层systemPrompt
      const personalityPrompt = personalitySystem.generateSystemPrompt();
      
      let tools: any[] | undefined;
      let toolCallHandler: ((name: string, args: any) => Promise<string>) | undefined;
      let knowledgeRagContext: string | undefined;
      if (!attachmentLlmPayload) {
        try {
          const orchResult = await processWithOrchestrator(processedContent, activeSkillIds);
          knowledgeRagContext = orchResult.ragContext;
          if (orchResult.tools && orchResult.tools.length > 0) {
            tools = orchResult.tools;
            toolCallHandler = orchResult.toolCallHandler;
          }
        } catch (e) {
          devWarn('获取工具定义失败');
        }
      } else {
        // 附件首轮跳过重编排/知识库向量召回以控延迟，但仍装载 active skill tools，保证 FC 可用
        devLog('[YueliCopilot] 附件任务：跳过 processWithOrchestrator 编排召回，保留 skill tools');
        try {
          if (skillExecutor && activeSkillIds.length > 0) {
            tools = skillExecutor.getAllToolDefinitions(activeSkillIds) as any[];
            if (tools && tools.length > 0) {
              toolCallHandler = async (name: string, args: any) =>
                skillExecutor.executeToolCall(name, args);
            }
          }
        } catch (e) {
          devWarn('附件任务装载工具定义失败');
        }
      }

      // 构建完整的messages数组（修复：注入知识库、完整指令、完整历史、快捷提示systemPrompt）
      const selectedPromptObjects = prompts.filter(p => selectedPrompts.includes(p.id));
      let apiUserInput = processedContent;
      if (attachmentLlmPayload) {
        if (
          processedContent &&
          processedContent !== userNote &&
          !attachmentLlmPayload.includes(processedContent)
        ) {
          apiUserInput = `${processedContent}\n\n---\n\n${attachmentLlmPayload}`;
        } else {
          apiUserInput = attachmentLlmPayload;
        }
      }

      const { freshTopic, topicFusionContext } = await fetchTopicFusionContext(
        selectedTopic,
        topics,
        userNote || apiUserInput,
        sessionId,
        messages,
        activeSkillIds
      );

      const apiMessages = buildMessages(
        apiUserInput,
        freshTopic,
        messages,
        topicInstructions,
        knowledgeItems,
        activeSkillIds,
        skillConfigs,
        selectedPromptObjects,
        personalityPrompt,
        userNote || apiUserInput, // 向量召回用用户短句
        knowledgeRagContext,
        { excludeMessageIds: [userMessage.id], topicFusionContext }
      );

      userRowForPersistence = {
        ...userMessage,
        metadata: {
          ...(userMessage.metadata || {}),
          user_visible_input: userNote,
          llm_expanded_char_count: apiUserInput.length,
          attached_files: attachmentNames.length > 0 ? attachmentNames : undefined
        }
      };
      setMessages((prev) =>
        prev.map((m) => (m.id === userMessage.id ? { ...m, metadata: userRowForPersistence.metadata } : m))
      );

      // 预检：缺 apiKey / 推理服务不可达 / KGM 三种路径都没工作 等问题直接告知用户。
      // 注意：前端不替 KGM 决策路由；KGM 的"推理引擎路由 / 模型路由 / 原生推理"由 KGM 自己选。
      try {
        const preflight = await apiService.runChatPreflight(resolvedChatRequestModel);
        if (!preflight.ok) {
          const errorIssues = preflight.issues.filter(i => i.severity === 'error');
          const warnIssues = preflight.issues.filter(i => i.severity === 'warn');
          const lines: string[] = [
            '❌ **无法发送请求：配置存在问题，请先修复后重试。**',
            '',
            `**当前配置**：provider=\`${preflight.resolved.provider}\`，model=\`${preflight.resolved.model}\`，apiUrl=\`${preflight.resolved.apiUrl}\`${preflight.resolved.isCloudProvider ? `，云端 provider=\`${preflight.resolved.cloudProviderName || '(未命名)'}\`` : ''}`,
            ''
          ];
          if (errorIssues.length) {
            lines.push('**致命问题**：');
            errorIssues.forEach((i, idx) => {
              lines.push(`${idx + 1}. \`${i.code}\` ${i.message}`);
              if (i.hint) lines.push(`   - 💡 ${i.hint}`);
            });
          }
          if (warnIssues.length) {
            lines.push('');
            lines.push('**警告**：');
            warnIssues.forEach((i, idx) => {
              lines.push(`${idx + 1}. \`${i.code}\` ${i.message}`);
              if (i.hint) lines.push(`   - 💡 ${i.hint}`);
            });
          }
          const diagnosticMsg = lines.join('\n');

          setMessages(prev => prev.map(msg =>
            msg.id === botMessageIdRef.current ? {
              ...msg,
              content: diagnosticMsg,
              isThinking: false,
              status: 'failed' as const
            } : msg
          ));
          const diagBotMessage = {
            id: botMessageIdRef.current,
            role: 'bot',
            content: diagnosticMsg,
            sender: 'Yueli Copilot',
            time: new Date().toLocaleTimeString(),
            isThinking: false,
            provider: selectedProvider,
            model: resolvedChatRequestModel,
            status: 'failed' as const,
            error: {
              message: '聊天预检失败',
              code: 'PREFLIGHT_FAILED',
              issues: preflight.issues
            }
          };
          persistSessionMessages(sessionId, (prevList) => {
            const without = prevList.filter((m: any) => m?.id !== userMessage.id && m?.id !== botMessageIdRef.current);
            return [
              ...without,
              { ...userRowForPersistence, status: 'sent' as const },
              diagBotMessage
            ];
          });
          setMessages(prev => prev.map(msg => msg.id === userMessage.id ? { ...msg, status: 'sent' as const } : msg));
          setIsLoading(false);
          setIsThinking(false);
          return;
        }
        if (import.meta.env.DEV) {
          devLog('✅ 聊天预检通过', preflight.resolved);
        }
      } catch (preflightError) {
        devWarn('聊天预检异常（不阻断主流程）:', preflightError);
      }

      const streamStateRef = { current: createInitialStreamReducerState() };

      const wrappedToolCallHandler = makePermissionAwareToolCallHandler(toolCallHandler);

      // 使用新的API调用方式发送消息（支持 function calling）
      let outboundModel = selectedModel;
      if (attachmentLlmPayload && selectedProvider === 'kgm') {
        const catalog = await fetchKgmModelCatalog(chatRuntimeSnap.kgmHttpRootDisplay);
        const picked = await pickAttachmentChatModel(
          selectedModel,
          catalog,
          chatRuntimeSnap.kgmHttpRootDisplay
        );
        outboundModel = picked.model;
        if (picked.reason) {
          toast(picked.reason, { duration: 6000 });
        }
      }

      const mainSendRes = await sendOllamaMessageWithMessages(
        outboundModel,
        apiMessages,
        (data) => {
          const evt = normalizeRawStreamEvent(data);
          if (!evt) return;

          const reduced = reduceStreamEvent(streamStateRef.current, evt);
          streamStateRef.current = reduced.state;

          const patch = reduced.patch;
          const shouldDebounceContent = Object.prototype.hasOwnProperty.call(patch, 'content');
          if (shouldDebounceContent) {
            if (updateTimer) clearTimeout(updateTimer);
            updateTimer = setTimeout(() => {
              setMessages((prev) =>
                prev.map((msg) => (msg.id === botMessageIdRef.current ? { ...msg, ...patch } : msg))
              );
            }, 80);
          } else {
            setMessages((prev) =>
              prev.map((msg) => (msg.id === botMessageIdRef.current ? { ...msg, ...patch } : msg))
            );
          }

          // 增量落盘：每 ~2s 把当前 bot message 写入 localStorage，避免刷新丢失
          const nowMs = Date.now();
          if (!lastIncrementalSaveAtRef.current || nowMs - lastIncrementalSaveAtRef.current > 2000) {
            lastIncrementalSaveAtRef.current = nowMs;
            const inflightBot = {
              id: botMessageIdRef.current,
              role: 'bot',
              content: streamStateRef.current.accumulatedContent || '(streaming...)',
              sender: 'Yueli Copilot',
              time: new Date().toLocaleTimeString(),
              isThinking: true,
              provider: selectedProvider,
              model: resolvedChatRequestModel,
              reasoningContent: streamStateRef.current.reasoningContent || undefined,
              toolCallRecords: streamStateRef.current.toolCallRecords,
              thinkingRecords: streamStateRef.current.thinkingRecords,
              sources: streamStateRef.current.sources.length ? streamStateRef.current.sources : undefined,
              status: 'streaming' as const,
              finalStatus: 'in_progress' as const
            };
            persistSessionMessages(sessionId, (prevList) => {
              const without = prevList.filter((m: any) => m?.id !== userMessage.id && m?.id !== botMessageIdRef.current);
              return [...without, userRowForPersistence, inflightBot];
            });
          }
        },
        {
          tools,
          toolCallHandler: wrappedToolCallHandler,
          enabledSkillIds: activeSkillIds,
          kgmRequestHints: {
            compactAttachmentChat: Boolean(attachmentLlmPayload)
          }
        }
      );
      const mainInvocationMetrics = extractInvocationMetrics(mainSendRes, routePlan);

      // 取消未执行的防抖更新，避免最终态与流式 patch 竞态；并用 API 层汇总结果回填（防 SSE 去重等导致 reducer 漏字）
      if (updateTimer) {
        clearTimeout(updateTimer);
        updateTimer = null;
      }
      const apiRound = mainSendRes && typeof mainSendRes === 'object' ? mainSendRes : {};
      let resolvedContent =
        streamStateRef.current.accumulatedContent ||
        (typeof apiRound.content === 'string' ? apiRound.content : '') ||
        '';
      const resolvedReasoning =
        streamStateRef.current.reasoningContent ||
        (typeof apiRound.reasoningContent === 'string' ? apiRound.reasoningContent : '') ||
        undefined;
      const resolvedThinkingFromApi =
        typeof apiRound.thinkingContent === 'string' && apiRound.thinkingContent.trim()
          ? apiRound.thinkingContent
          : '';
      const resolvedThinkingRecords =
        streamStateRef.current.thinkingRecords.length > 0
          ? streamStateRef.current.thinkingRecords
          : resolvedThinkingFromApi
            ? [{ content: resolvedThinkingFromApi, timestamp: Date.now() }]
            : undefined;

      resolvedContent = pickAssistantVisibleRawText({
        accumulatedContent: resolvedContent,
        toolCallRecords: streamStateRef.current.toolCallRecords,
        reasoningContent: resolvedReasoning,
        thinkingContent: resolvedThinkingFromApi,
        thinkingRecords: streamStateRef.current.thinkingRecords,
        completionTokens: mainInvocationMetrics?.completionTokens,
        totalLatencyMs: mainInvocationMetrics?.totalLatencyMs
      });
      resolvedContent = finalizeKgmAssistantMarkdownIfNeeded(resolvedContent);

      // 确保最终内容被更新
      setMessages(prev => prev.map(msg =>
        msg.id === botMessageIdRef.current ? {
          ...msg,
          content: resolvedContent,
          isThinking: false,
          reasoningContent: resolvedReasoning,
          thinkingRecords: resolvedThinkingRecords,
          toolCallRecords: streamStateRef.current.toolCallRecords,
          sources: streamStateRef.current.sources.length ? streamStateRef.current.sources : undefined,
          permissionAuditTrail:
            permissionAuditForBotRef.current.length > 0
              ? [...permissionAuditForBotRef.current]
              : msg.permissionAuditTrail,
          metrics: mainInvocationMetrics || msg.metrics,
          finalStatus: 'done' as const
        } : msg
      ));

      // 更新会话消息（使用 functional update + 单一 helper，避免闭包航脱）
      const finalBotMessage = {
        id: botMessageIdRef.current,
        role: 'bot',
        content: resolvedContent,
        sender: 'Yueli Copilot',
        time: new Date().toLocaleTimeString(),
        isThinking: false,
        provider: selectedProvider,
        model: resolvedChatRequestModel,
        reasoningContent: resolvedReasoning,
        toolCallRecords: streamStateRef.current.toolCallRecords,
        thinkingRecords: resolvedThinkingRecords,
        sources: streamStateRef.current.sources.length ? streamStateRef.current.sources : undefined,
        permissionAuditTrail:
          permissionAuditForBotRef.current.length > 0 ? [...permissionAuditForBotRef.current] : undefined,
        metrics: mainInvocationMetrics,
        finalStatus: 'done' as const
      };
      persistSessionMessages(sessionId, (prevList) => {
        // 去重：如果上一轮已写入相同 botId（增量落盘的占位），替换它
        const withoutCurrentBot = prevList.filter((m: any) => m?.id !== userMessage.id && m?.id !== botMessageIdRef.current);
        return [...withoutCurrentBot, { ...userRowForPersistence, status: 'sent' as const }, finalBotMessage];
      });

      void appendSessionMemoryTurn({
        sessionId,
        userId: 'default',
        role: 'user',
        content: userNote
      });
      void appendSessionMemoryTurn({
        sessionId,
        userId: 'default',
        role: 'assistant',
        content: resolvedContent.slice(0, 8000)
      });

      // 将对话添加到历史会话：占位名「新对话」须在首条消息成功后替换为 AI 标题
      const existingSession = sessions.find(s => s.id === sessionId);
      let sessionName: string;
      let sessionTopicId: string | null = null;
      if (existingSession && !sessionNameNeedsAiTitle(existingSession.name)) {
        sessionName = existingSession.name;
        sessionTopicId = existingSession.topicId || null;
      } else {
        try {
          sessionName = (await apiService.generateTitle(content, resolvedChatRequestModel)).trim();
        } catch (error) {
          sessionName = generateRuleBasedTitle(content);
        }
        if (sessionNameNeedsAiTitle(sessionName)) {
          sessionName = generateRuleBasedTitle(content);
        }
        sessionTopicId = existingSession?.topicId ?? selectedTopic?.id ?? null;
      }
      const newSession = {
        id: sessionId,
        name: sessionName,
        lastActive: Date.now(),
        topicId: sessionTopicId
      };
      
      // 使用 SessionStorageService 更新会话（带验证和缓存机制）
      const success = sessionStorageService.update(newSession);
      
      if (success) {
        // 更新 React 状态
        setSessions(sessionStorageService.getAll());
        devLog('💾 会话更新成功:', {
          sessionId,
          sessionName,
          sessionTopicId,
          selectedTopicId: selectedTopic?.id,
          status: sessionStorageService.status
        });
      } else {
        devError('❌ 会话更新失败');
      }

      // 更新用户消息状态为已发送
      setMessages(prev => prev.map(msg => 
        msg.id === userMessage.id ? { ...msg, status: 'sent' } : msg
      ));

      setIsThinking(false);
  } catch (err: any) {
    const errorText = err?.message || String(err) || '未知错误';
    const errorCode = err?.code || err?.name || '';
    devError('[handleSendMessage] LLM 调用失败:', { sessionId, errorCode, errorText, err });
    setError(`发送消息失败：${errorText}`);
    toast.error(`发送消息失败：${errorText}`);

    setIsThinking(false);
    setIsLoading(false);

    // 把已经累积到的回复（哪怕是空字符串）和错误一并展示出来，
    // 同时把 bot 消息也写进 sessionMessages，避免重开会话只看到 "ok"
    const partialContent = accumulatedContentRef.current || '';
    const errorBanner =
      `\n\n❌ **请求失败**：${errorText}` +
      (errorCode ? ` (\`${errorCode}\`)` : '') +
      `\n\n> 该消息没有完整返回，您可以重新发送。Mac 应用：顶部**调试工具栏**→「开发者工具」，在 Console 执行 \`debugYueli.session('${sessionId}')\`（支持粘贴）。`;
    const finalContent = partialContent
      ? `${partialContent}${errorBanner}`
      : errorBanner.replace(/^\n\n/, '');

    const failedBotMessage = {
      id: botMessageIdRef.current,
      role: 'bot',
      content: finalContent,
      sender: 'Yueli Copilot',
      time: new Date().toLocaleTimeString(),
      isThinking: false,
      provider: selectedProvider,
      model: resolvedChatRequestModel,
      reasoningContent: reasoningContentRef.current || undefined,
      sources: sourcesRef.current.length > 0 ? sourcesRef.current : undefined,
      permissionAuditTrail:
        permissionAuditForBotRef.current.length > 0 ? [...permissionAuditForBotRef.current] : undefined,
      status: 'failed' as const,
      error: { message: errorText, code: errorCode || undefined }
    };

    // UI：保留并标记 bot 消息为失败，而不是简单删除
    setMessages(prev => {
      const withUserFailed = prev.map(msg =>
        msg.id === userMessage.id ? { ...msg, status: 'failed' as const } : msg
      );
      const hasBot = withUserFailed.some(m => m.id === botMessageIdRef.current);
      return hasBot
        ? withUserFailed.map(m => (m.id === botMessageIdRef.current ? { ...m, ...failedBotMessage } : m))
        : [...withUserFailed, failedBotMessage as any];
    });

    // 持久化：用户消息 + 失败的 bot 消息一起写入，重开会话时能看到错误内容
    persistSessionMessages(sessionId, (prevList) => {
      const withoutCurrent = prevList.filter((m: any) => m?.id !== userMessage.id && m?.id !== botMessageIdRef.current);
      return [
        ...withoutCurrent,
        { ...userRowForPersistence, status: 'failed' as const },
        failedBotMessage
      ];
    });
    
    // 保存会话列表 - 只有第一次对话时生成标题
    const existingSession = sessions.find(s => s.id === sessionId);
    let sessionName: string;
    if (existingSession) {
      sessionName = existingSession.name;
    } else {
      sessionName = content.trim().substring(0, 50) + (content.length > 50 ? '...' : '');
    }
    const newSession = {
      id: sessionId,
      name: sessionName,
      lastActive: Date.now(),
      topicId: selectedTopic?.id || null
    };
    const updatedSessions = sessions.filter(s => s.id !== sessionId);
    setSessions([newSession, ...updatedSessions]);
    sessionStorageService.update(newSession);
  } finally {
    setIsLoading(false);
  }
};

  // 权限弹窗渲染
  const renderPermissionModal = () => {
    const pending = permissionPendingRef.current;
    const skillExecutor = orchestrator?.getSkillExecutor?.();
    if (!pending || !skillExecutor) return null;

    return (
      <PermissionRequestModal
        open={permissionModalOpen}
        skillId={pending.skillId}
        permissions={pending.permissions}
        skillExecutor={skillExecutor}
        onCancel={() => {
          setPermissionModalOpen(false);
          pending.resolve('deny');
          permissionPendingRef.current = null;
        }}
        onDecision={(decision) => {
          setPermissionModalOpen(false);
          pending.resolve(decision);
          permissionPendingRef.current = null;
        }}
      />
    );
  };

  const renderScriptConsentModal = () => {
    const pending = scriptConsentPendingRef.current;
    if (!pending) return null;
    return (
      <SkillScriptConsentModal
        open={scriptConsentModalOpen}
        skillId={pending.skillId}
        kind={pending.kind}
        onCancel={() => {
          setScriptConsentModalOpen(false);
          pending.resolve('deny');
          scriptConsentPendingRef.current = null;
        }}
        onDecision={(decision) => {
          setScriptConsentModalOpen(false);
          pending.resolve(decision);
          scriptConsentPendingRef.current = null;
        }}
      />
    );
  };

  // 搜索功能处理函数
  const handleSearch = (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    
    const results: Array<{
      type: 'skill' | 'prompt';
      id: string;
      name: string;
      description: string;
      enabled?: boolean;
    }> = [];
    
    // 搜索技能
    skills.forEach(skill => {
      const skillName = skill.name || '';
      const skillDesc = skill.description || '';
      if (skillName.toLowerCase().includes(query.toLowerCase()) ||
          skillDesc.toLowerCase().includes(query.toLowerCase())) {
        results.push({
          type: 'skill',
          id: skill.id,
          name: skillName,
          description: skillDesc,
          enabled: activeSkillIds.includes(skill.id)
        });
      }
    });
    
    // 搜索快速提示
    prompts.forEach(prompt => {
      if (prompt.name.toLowerCase().includes(query.toLowerCase()) ||
          prompt.content.toLowerCase().includes(query.toLowerCase())) {
        results.push({
          type: 'prompt',
          id: prompt.id,
          name: prompt.name,
          description: prompt.content
        });
      }
    });
    
    setSearchResults(results);
  };

  const handleSearchInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setSearchQueryGlobal(query);
    handleSearch(query);
  };

  const handleSearchButtonClick = () => {
    openExclusiveOverlay('search');
    setSearchQueryGlobal('');
    setSearchResults([]);
  };

  const handleCloseSearchModal = () => {
    setIsSearchModalOpen(false);
    setSearchQueryGlobal('');
    setSearchResults([]);
  };

  const handleToggleSkill = (skillId: string) => {
    if (activeSkillIds.includes(skillId)) {
      setActiveSkillIds(prev => prev.filter(id => id !== skillId));
    } else {
      setActiveSkillIds(prev => [...prev, skillId]);
    }
    // 更新搜索结果中的enabled状态
    setSearchResults(prev => prev.map(result => 
      result.id === skillId ? { ...result, enabled: !result.enabled } : result
    ));
  };

  const handleInvokeSkill = (skillId: string) => {
    const skill = skills.find(s => s.id === skillId);
    if (skill) {
      setInput(`请使用 "${skill.name}" 技能帮我完成任务。`);
      if (!activeSkillIds.includes(skillId)) {
        setActiveSkillIds(prev => [...prev, skillId]);
      }
      setIsSearchModalOpen(false);
    }
  };

  const handleInsertPrompt = (promptId: string) => {
    const prompt = prompts.find(p => p.id === promptId);
    if (prompt) {
      setInput(prev => prev + prompt.content);
      setIsSearchModalOpen(false);
    }
  };

  // 处理粘贴图片
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          const chatFile: ChatFile = {
            id: String(Date.now()),
            name: file.name || `image_${Date.now()}.${file.type.split('/')[1]}`,
            type: file.type,
            size: file.size,
            file: file
          };
          setFiles(prev => [...prev, chatFile]);
        }
        break;
      }
    }
  }, []);

  // 处理文件上传
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFiles = event.target.files;
    if (uploadedFiles?.length) {
      const newFiles: ChatFile[] = Array.from(uploadedFiles).map(file => ({
        id: `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: file.name,
        type: file.type,
        size: file.size,
        file
      }));
      setFiles(prev => [...prev, ...newFiles]);
      setIsAddMenuOpen(false);
    }
    event.target.value = '';
    isPickingFilesRef.current = false;
  };

  // 处理删除文件
  const handleRemoveFile = (fileId: string) => {
    setFiles(prev => prev.filter(file => file.id !== fileId));
  };

  // 处理点击项目主题
  const handleTopicClick = (topic: any) => {
    setSelectedTopic(topic);
    setViewMode('topic-sessions');
    setCurrentSessionId(null);
    setMessages([]);
    setInput('');
    setFiles([]);
    setError(null);
    // 自动激活上下文召回约束技能
    if (!activeSkillIds.includes('context-recall-constraint')) {
      setActiveSkillIds(prev => [...prev, 'context-recall-constraint']);
    }
  };

  // 处理点击会话 - 进入对话详情视图
  const handleSessionClick = (session: any) => {
    setCurrentSessionId(session.id);
    setViewMode('chat');
    // 根据会话的topicId设置对应的主题
    if (session.topicId) {
      const topic = topics.find(t => t.id === session.topicId);
      if (topic) {
        setSelectedTopic(topic);
        // 自动激活上下文召回约束技能
        if (!activeSkillIds.includes('context-recall-constraint')) {
          setActiveSkillIds(prev => [...prev, 'context-recall-constraint']);
        }
      }
    }
    // 确保从sessionMessages中加载消息
    const sessionData = persistNormalizedSessionMessages(
      session.id,
      sessionMessages[session.id] || []
    );
    setSessionMessages((prev) => ({ ...prev, [session.id]: sessionData }));
    setMessages(sessionData);
    setInput('');
    setFiles([]);
    setError(null);
  };

  // 处理新会话创建
  const handleNewSession = () => {
    const sessionId = `session-${Date.now()}`;
    const newSession = {
      id: sessionId,
      name: '新对话',
      topicId: selectedTopic?.id || null,
      lastActive: Date.now()
    };
    
    devLog('🆕 创建新会话:', {
      sessionId,
      selectedTopicId: selectedTopic?.id,
      topicId: newSession.topicId,
      timestamp: newSession.lastActive,
      date: new Date(newSession.lastActive).toLocaleString()
    });
    
    // 使用 SessionStorageService 保存新会话（带验证和缓存机制）
    const success = sessionStorageService.add(newSession);
    
    if (success) {
      devLog('✅ 会话创建成功:', {
        sessionId,
        status: sessionStorageService.status
      });
      // 更新 React 状态
      setSessions(sessionStorageService.getAll());
    } else {
      devError('❌ 会话创建失败，请检查存储');
      setError('会话创建失败，请刷新页面重试');
      return;
    }
    
    setCurrentSessionId(sessionId);
    setViewMode('chat');
    setMessages([]);
    setInput('');
    setFiles([]);
    setError(null);
  };

  // 返回项目主题列表视图
  const handleBackToTopics = () => {
    setSelectedTopic(null);
    setViewMode('topics');
    setCurrentSessionId(null);
    setMessages([]);
    setInput('');
    setFiles([]);
    setError(null);
  };

  // 返回主题会话列表视图
  const handleBackToTopicSessions = () => {
    setViewMode('topic-sessions');
    setCurrentSessionId(null);
    setMessages([]);
    setInput('');
    setFiles([]);
    setError(null);
  };

  // 处理点击历史会话（非项目主题）
  const handleHistorySessionClick = (session: any) => {
    devLog('📍 点击历史会话:', {
      session,
      selectedTopic: selectedTopic,
      currentSessionId
    });
    setSelectedTopic(null);
    setCurrentSessionId(session.id);
    setViewMode('chat');
    // 确保从sessionMessages中加载消息
    const sessionData = persistNormalizedSessionMessages(
      session.id,
      sessionMessages[session.id] || []
    );
    devLog('📥 从 sessionMessages 加载消息:', {
      sessionId: session.id,
      sessionDataLength: sessionData.length
    });
    setSessionMessages((prev) => ({ ...prev, [session.id]: sessionData }));
    setMessages(sessionData);
    setInput('');
    setFiles([]);
    setError(null);
  };

  // 指令管理函数
  const handleOpenInstructionModal = () => {
    if (selectedTopic) {
      // 初始化已选择的指令
      const topicInstructionIds = selectedTopic.instructions || [];
      setSelectedInstructions(topicInstructionIds);
      openExclusiveOverlay('instruction');
    }
  };

  const handleAddInstruction = () => {
    openExclusiveOverlay('addInstruction');
  };

  const handleCreateInstruction = () => {
    if (newInstructionName && newInstructionContent) {
      const newInstruction = {
        id: String(Date.now()),
        name: newInstructionName,
        content: newInstructionContent
      };
      setInstructions(prev => [...prev, newInstruction]);
      setIsAddInstructionModalOpen(false);
      setNewInstructionName('');
      setNewInstructionContent('');
    }
  };

  const handleSaveInstructions = () => {
    if (selectedTopic) {
      const updatedTopic = {
        ...selectedTopic,
        instructions: selectedInstructions
      };
      setTopics(prev => {
        const updated = prev.map(topic => 
          topic.id === selectedTopic.id ? updatedTopic : topic
        );
        persistTopicsToStorage(updated);
        return updated;
      });
      setIsInstructionModalOpen(false);
    }
  };

  const handleToggleInstruction = (instructionId: string) => {
    setSelectedInstructions(prev => {
      if (prev.includes(instructionId)) {
        return prev.filter(id => id !== instructionId);
      } else {
        return [...prev, instructionId];
      }
    });
  };

  return (
    <Container style={{ display: 'flex', gap: '1px', backgroundColor: '#e8e8e8' }}>

      {/* 左侧边栏收起展开按钮 */}
      {!isSidebarExpanded && (
        <button 
          onClick={() => setIsSidebarExpanded(true)}
          style={{
            width: '60px',
            height: '60px',
            borderRadius: '0 8px 8px 0',
            backgroundColor: '#ffffff',
            border: '1px solid #e8e8e8',
            borderLeft: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'absolute',
            left: '0',
            top: '20px',
            zIndex: '100'
          }}
        >
          ▶
        </button>
      )}
      
      <Sidebar style={{ 
        width: isSidebarExpanded ? '300px' : '0', 
        backgroundColor: '#ffffff', 
        borderRight: isSidebarExpanded ? '1px solid #e8e8e8' : 'none',
        overflow: 'hidden',
        transition: 'width 0.3s ease',
        position: 'relative'
      }}>
        {isSidebarExpanded && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h3 style={{ margin: 0, fontSize: '16px' }}>Yueli Copilot</h3>
              <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                <button 
                  style={{
                    background: 'none',
                    border: 'none',
                    borderRadius: '4px',
                    padding: '6px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    color: '#666',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                  onClick={() => openExclusiveOverlay('historySearch')}
                  title="搜索历史会话"
                >
                  <SearchOutlined />
                </button>
                <button 
                  style={{
                    background: 'none',
                    border: 'none',
                    borderRadius: '4px',
                    padding: '4px 8px',
                    cursor: 'pointer',
                    fontSize: '12px',
                    color: '#1890ff'
                  }}
                  onClick={() => navigate('/manager')}
                >
                  管理
                </button>
                <button 
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '18px',
                    color: '#666'
                  }}
                  onClick={() => setIsSidebarExpanded(false)}
                >
                  ◀
                </button>
              </div>
            </div>
            
            <div style={{ marginBottom: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <h4 style={{ fontSize: '14px', fontWeight: '600', color: '#666', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>项目主题</span>
                  <button 
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: '#666',
                      fontSize: '12px'
                    }}
                    onClick={() => setIsTopicsExpanded(!isTopicsExpanded)}
                  >
                    {isTopicsExpanded ? '▼' : '▶'}
                  </button>
                </h4>
                <button 
                  style={{
                    background: '#e8e8e8',
                    color: '#1a73e8',
                    border: '1px solid #e8e8e8',
                    borderRadius: '4px',
                    padding: '4px 8px',
                    cursor: 'pointer',
                    fontSize: '12px',
                    transition: 'all 0.2s ease'
                  }}
                  onClick={() => openExclusiveOverlay('createTopic')}
                >
                  + 新主题
                </button>
              </div>
              {isTopicsExpanded && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {topics.map((topic) => (
                    <div 
                      key={topic.id}
                      style={{
                        padding: '12px 16px',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '14px',
                        transition: 'all 0.3s',
                        borderLeft: selectedTopic?.id === topic.id ? '3px solid #1890ff' : '3px solid transparent',
                        backgroundColor: selectedTopic?.id === topic.id ? '#f0f7ff' : 'transparent',
                        position: 'relative',
                        display: 'flex',
                        flexDirection: 'column',
                        marginBottom: '8px'
                      }}
                      onClick={() => handleTopicClick(topic)}
                      onMouseEnter={(e) => {
                        if (selectedTopic?.id !== topic.id) {
                          e.currentTarget.style.backgroundColor = '#f5f5f5';
                        }
                        const menuButton = e.currentTarget.querySelector('.menu-button');
                        if (menuButton) {
                          (menuButton as HTMLElement).style.display = 'flex';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (selectedTopic?.id !== topic.id) {
                          e.currentTarget.style.backgroundColor = 'transparent';
                        }
                        const menuButton = e.currentTarget.querySelector('.menu-button');
                        if (menuButton && activeMenu !== topic.id) {
                          (menuButton as HTMLElement).style.display = 'none';
                        }
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
                        <span style={{ fontWeight: '450', maxWidth: '85%', wordBreak: 'break-word' }}>{topic.name}</span>
                        <button 
                          className="menu-button"
                          style={{
                            position: 'absolute',
                            top: '12px',
                            right: '12px',
                            width: '28px',
                            height: '28px',
                            borderRadius: '50%',
                            backgroundColor: '#f1f1f1',
                            border: 'none',
                            display: activeMenu === topic.id ? 'flex' : 'none',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            color: '#555',
                            zIndex: 1
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveMenu(activeMenu === topic.id ? null : topic.id);
                            setMenuTarget('topic');
                            setMenuItem(topic);
                          }}
                        >
                          •••
                        </button>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#757575', fontSize: '12px', marginTop: '4px' }}>
                        <span>{formatLastActiveTime(topic.lastActive)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                <h4 style={{ fontSize: '14px', fontWeight: '600', color: '#666', margin: 0 }}>历史会话</h4>
                <button
                  onClick={() => {
                    setSelectedTopic(null);
                    handleNewSession();
                  }}
                  style={{
                    backgroundColor: '#1890ff',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    padding: '4px 8px',
                    cursor: 'pointer',
                    fontSize: '12px',
                    transition: 'all 0.2s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = '#40a9ff';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = '#1890ff';
                  }}
                >
                  + 新会话
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {/* P2-5: 调试代码已移除 */}
                {filteredSessions.length > 0 ? (
                  filteredSessions.map((session) => (
                    <div 
                      key={session.id}
                      style={{
                        padding: '12px 16px',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '14px',
                        transition: 'all 0.3s',
                        borderLeft: currentSessionId === session.id && !selectedTopic ? '3px solid #1890ff' : '3px solid transparent',
                        backgroundColor: currentSessionId === session.id && !selectedTopic ? '#f0f7ff' : 'transparent',
                        position: 'relative',
                        display: 'flex',
                        flexDirection: 'column',
                        marginBottom: '8px'
                      }}
                      onClick={() => handleHistorySessionClick(session)}
                      onMouseEnter={(e) => {
                        if (currentSessionId !== session.id || selectedTopic) {
                          e.currentTarget.style.backgroundColor = '#f5f5f5';
                        }
                        const menuButton = e.currentTarget.querySelector('.menu-button');
                        if (menuButton) {
                          (menuButton as HTMLElement).style.display = 'flex';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (currentSessionId !== session.id || selectedTopic) {
                          e.currentTarget.style.backgroundColor = 'transparent';
                        }
                        const menuButton = e.currentTarget.querySelector('.menu-button');
                        if (menuButton && activeMenu !== session.id) {
                          (menuButton as HTMLElement).style.display = 'none';
                        }
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px' }}>
                        <span style={{ fontWeight: '450', maxWidth: '85%', wordBreak: 'break-word' }}>{session.name}</span>
                        <button 
                          className="menu-button"
                          style={{
                            position: 'absolute',
                            top: '12px',
                            right: '12px',
                            width: '28px',
                            height: '28px',
                            borderRadius: '50%',
                            backgroundColor: '#f1f1f1',
                            border: 'none',
                            display: activeMenu === session.id ? 'flex' : 'none',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer',
                            color: '#555',
                            zIndex: 1
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveMenu(activeMenu === session.id ? null : session.id);
                            setMenuTarget('session');
                            setMenuItem(session);
                          }}
                        >
                          •••
                        </button>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#757575', fontSize: '12px', marginTop: '4px' }}>
                        {session.topicId && (
                          <span style={{ color: '#1890ff', maxWidth: '60%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {topics.find(t => t.id === session.topicId)?.name || '未知主题'}
                          </span>
                        )}
                        <span>{formatLastActiveTime(session.lastActive)}</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div style={{ padding: '16px', textAlign: 'center', color: '#999', fontSize: '14px' }}>
                    暂无历史会话
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </Sidebar>
      
      <MainContent style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, backgroundColor: '#f5f5f5' }}>
        {viewMode === 'topics' && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', backgroundColor: '#f5f5f5' }}>
            <div style={{ textAlign: 'center', maxWidth: '400px', padding: '40px' }}>
              <h2 style={{ fontSize: '24px', fontWeight: '600', color: '#333', marginBottom: '16px' }}>Yueli Copilot</h2>
              <p style={{ fontSize: '16px', color: '#666', marginBottom: '32px' }}>请从左侧选择一个项目主题开始对话</p>
              <div style={{ display: 'flex', gap: '16px', justifyContent: 'center' }}>
                <button 
                  style={{
                    background: 'white',
                    color: '#1890ff',
                    border: '1px solid #1890ff',
                    borderRadius: '8px',
                    padding: '12px 24px',
                    cursor: 'pointer',
                    fontSize: '16px',
                    fontWeight: '500'
                  }}
                  onClick={() => openExclusiveOverlay('createTopic')}
                >
                  + 创建新项目主题
                </button>
                <button 
                  style={{
                    background: '#1890ff',
                    color: 'white',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '12px 24px',
                    cursor: 'pointer',
                    fontSize: '16px',
                    fontWeight: '500'
                  }}
                  onClick={() => {
                    // 跳转到非项目主题的问答对话创建
                    setSelectedTopic(null);
                    handleNewSession();
                  }}
                >
                  创新问答会话
                </button>
              </div>
            </div>
          </div>
        )}

        {viewMode === 'topic-sessions' && selectedTopic && (
          <div style={{ flex: 1, display: 'flex', backgroundColor: '#f5f5f5' }}>
            {/* 左侧：会话列表 */}
            <div style={{ flex: 1, padding: '24px', overflowY: 'auto' }}>
              <div style={{ marginBottom: '24px' }}>
                <button 
                  onClick={handleNewSession}
                  style={{
                    width: '100%',
                    padding: '16px',
                    backgroundColor: '#ffffff',
                    border: '2px dashed #d9d9d9',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    color: '#666',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '8px',
                    transition: 'all 0.2s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = '#1890ff';
                    e.currentTarget.style.color = '#1890ff';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = '#d9d9d9';
                    e.currentTarget.style.color = '#666';
                  }}
                >
                  <span style={{ fontSize: '18px' }}>+</span> 创建新会话
                </button>
              </div>

              <div>
                <h4 style={{ fontSize: '14px', fontWeight: '600', color: '#666', marginBottom: '12px' }}>会话历史</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {/* P2-5: 调试代码已移除 */}
                  {topicSessions.length > 0 ? (
                    topicSessions.map((session) => (
                      <div 
                        key={session.id}
                        style={{
                          padding: '16px',
                          backgroundColor: '#ffffff',
                          borderRadius: '8px',
                          cursor: 'pointer',
                          border: '1px solid #e8e8e8',
                          transition: 'all 0.2s ease'
                        }}
                        onClick={() => handleSessionClick(session)}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = '#1890ff';
                          e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = '#e8e8e8';
                          e.currentTarget.style.boxShadow = 'none';
                        }}
                      >
                        <div style={{ fontWeight: '500', marginBottom: '4px', color: '#333' }}>{session.name}</div>
                        <div style={{ fontSize: '12px', color: '#999' }}>{formatLastActiveTime(session.lastActive)}</div>
                      </div>
                    ))
                  ) : (
                    <div style={{ padding: '24px', textAlign: 'center', color: '#999', backgroundColor: '#ffffff', borderRadius: '8px' }}>
                      暂无会话记录
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* 右侧：项目详情 */}
            <div style={{ width: '320px', backgroundColor: '#ffffff', borderLeft: '1px solid #e8e8e8', padding: '24px', overflowY: 'auto' }}>
              <div style={{ marginBottom: '24px' }}>
                <h4 style={{ fontSize: '14px', fontWeight: '600', color: '#666', marginBottom: '12px' }}>项目信息</h4>
                <div style={{ backgroundColor: '#f9f9f9', borderRadius: '8px', padding: '16px' }}>
                  <div style={{ fontWeight: '500', marginBottom: '8px', color: '#333' }}>{selectedTopic.name}</div>
                  {selectedTopic.description && (
                    <div style={{ fontSize: '13px', color: '#666', lineHeight: '1.4', marginBottom: '12px' }}>
                      {selectedTopic.description}
                    </div>
                  )}
                  <div style={{ fontSize: '12px', color: '#999' }}>
                    创建时间: {new Date(selectedTopic.lastActive).toLocaleString()}
                  </div>
                </div>
              </div>

              {selectedTopic.files && selectedTopic.files.length > 0 && (
                <div style={{ marginBottom: '24px' }}>
                  <h4 style={{ fontSize: '14px', fontWeight: '600', color: '#666', marginBottom: '12px' }}>文件</h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {selectedTopic.files.map((file: any, index: number) => (
                      <div key={index} style={{ 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'center',
                        padding: '10px',
                        backgroundColor: '#f9f9f9',
                        borderRadius: '6px'
                      }}>
                        <span style={{ fontSize: '13px', color: '#333', flex: 1, wordBreak: 'break-word' }}>{file.name}</span>
                        <span style={{ fontSize: '11px', color: '#999', marginLeft: '8px' }}>
                          {Math.round(file.size / 1024)} KB
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                  <h4 style={{ fontSize: '14px', fontWeight: '600', color: '#666', margin: 0 }}>指令</h4>
                  <button
                    onClick={handleOpenInstructionModal}
                    style={{
                      background: 'none',
                      border: '1px solid #1890ff',
                      color: '#1890ff',
                      borderRadius: '6px',
                      padding: '4px 10px',
                      cursor: 'pointer',
                      fontSize: '12px'
                    }}
                  >
                    管理
                  </button>
                </div>
                <div style={{ backgroundColor: '#f9f9f9', borderRadius: '8px', padding: '16px' }}>
                  {selectedTopic.instructions && selectedTopic.instructions.length > 0 ? (
                    selectedTopic.instructions.map((instructionId: string, index: number) => {
                      const instruction = instructions.find((inst: any) => inst.id === instructionId);
                      return instruction ? (
                        <div key={index} style={{ fontSize: '13px', color: '#666', lineHeight: '1.4', marginBottom: '8px' }}>
                          <div style={{ fontWeight: '500', marginBottom: '4px' }}>{instruction.name}</div>
                          <div style={{ fontSize: '12px' }}>{instruction.content}</div>
                        </div>
                      ) : null;
                    })
                  ) : (
                    <div style={{ fontSize: '13px', color: '#999', textAlign: 'center' }}>
                      暂无指令
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {viewMode === 'chat' && (
          <>
            <ChatHeader style={{ backgroundColor: '#ffffff', boxShadow: '0 1px 0 rgba(0, 0, 0, 0.05)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flex: 1, minWidth: 0 }}>
                <button 
                  onClick={selectedTopic ? handleBackToTopicSessions : handleBackToTopics}
                  style={{
                    background: 'none',
                    border: '1px solid #e0e0e0',
                    borderRadius: '8px',
                    padding: '8px 12px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    color: '#666',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  ← 返回
                </button>
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
                    {selectedTopic && (
                      <div style={{
                        fontSize: '14px',
                        color: '#666',
                        padding: '4px 8px',
                        backgroundColor: '#f0f0f0',
                        borderRadius: '4px'
                      }}>
                        {selectedTopic.name}
                      </div>
                    )}
                    {currentSessionId && (
                      <div style={{
                        fontSize: '16px',
                        fontWeight: '600',
                        color: '#333'
                      }}>
                        {sessions.find(s => s.id === currentSessionId)?.name}
                      </div>
                    )}
                  </div>
                </div>
                <ChatActions style={{ marginRight: '50px', flexShrink: 0 }}>
                  <ActionButton onClick={() => navigate('/manager')} style={{ borderRadius: '8px', borderColor: '#1890ff', color: '#1890ff' }}>
                    <AppstoreOutlined /> 管理中心
                  </ActionButton>
                  <ActionButton
                    onClick={() => toggleExclusiveOverlay('apiConfig', isApiConfigModalOpen)}
                    style={{ borderRadius: '8px' }}
                  >
                    <SettingOutlined /> 配置
                  </ActionButton>
                  <ActionButton onClick={() => navigate('/manager')} style={{ borderRadius: '8px' }}>
                    <DatabaseOutlined /> 项目主题管理
                  </ActionButton>
                  {debugModeEnabled && onToggleDebugPanel && (
                    <ActionButton 
                      onClick={onToggleDebugPanel} 
                      style={{ borderRadius: '8px', borderColor: '#52c41a', color: '#52c41a' }}
                      title="切换调试窗口"
                    >
                      <BugOutlined /> Debug
                    </ActionButton>
                  )}
                </ChatActions>
              </div>
            </ChatHeader>

            <MessagesContainer style={{ padding: '8px 12px', backgroundColor: '#fafafa' }}>
              {messages.length > 0 ? (
                messages.map(message => (
                  <ChatMessageRenderer 
                    key={message.id} 
                    message={message} 
                    onEdit={handleEditMessage}
                    topicInfo={selectedTopic ? {
                      id: selectedTopic.id,
                      name: selectedTopic.name,
                      fileCount: selectedTopic.files?.length || 0,
                      files: selectedTopic.files?.map((f: any) => ({
                        name: f.name,
                        contentLength: f.content?.length || 0
                      })) || []
                    } : null}
                  />
                ))
              ) : (
                <div style={{ textAlign: 'center', padding: '40px 0', color: '#999' }}>
                  <p style={{ fontSize: '16px', marginBottom: '8px' }}>How can I help you today?</p>
                  <p style={{ fontSize: '14px' }}>在下方输入消息开始对话</p>
                </div>
              )}
              {isThinking && (
                <TypewriterRenderer content="Yueli AI思考中..." />
              )}
              <div ref={messagesEndRef} />
            </MessagesContainer>

            <InputContainer style={{ padding: '12px 16px', backgroundColor: '#ffffff', borderTop: '1px solid #e8e8e8' }}>
              {/* 快捷指令列表 */}
              <div style={{ marginBottom: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <h4 style={{ fontSize: '12px', fontWeight: '500', color: '#666', margin: 0 }}>快速提示</h4>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', flex: 1 }}>
                    {selectedPrompts.map(promptId => {
                      const prompt = prompts.find(p => p.id === promptId);
                      return prompt ? (
                        <button
                          key={prompt.id}
                          style={{
                            background: '#f8f9fa',
                            border: '1px solid #e8e8e8',
                            borderRadius: '20px',
                            padding: '8px 16px',
                            cursor: 'pointer',
                            fontSize: '13px',
                            color: '#333',
                            transition: 'all 0.2s ease',
                            fontWeight: '450',
                            flexShrink: 0
                          }}
                          onClick={() => setInput(input + prompt.content)}
                        >
                          {prompt.name}
                        </button>
                      ) : null;
                    })}
                  </div>
                  <button 
                    style={{
                      background: 'none',
                      color: '#1a73e8',
                      border: '1px solid #1a73e8',
                      borderRadius: '8px',
                      padding: '6px 12px',
                      cursor: 'pointer',
                      fontSize: '13px',
                      transition: 'all 0.2s ease',
                      flexShrink: 0
                    }}
                    onClick={() => openExclusiveOverlay('promptConfig')}
                  >
                    配置
                  </button>
                </div>
              </div>
              
              {/* 上传的文件 */}
              {files.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
                  {files.map(file => (
                    <div key={file.id} style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '6px', 
                      padding: '8px 12px', 
                      backgroundColor: '#f5f5f5', 
                      borderRadius: '8px', 
                      fontSize: '14px',
                      color: '#333'
                    }}>
                      <span>{file.name}</span>
                      <button 
                        onClick={() => handleRemoveFile(file.id)}
                        style={{ 
                          background: 'none', 
                          border: 'none', 
                          cursor: 'pointer', 
                          color: '#8c8c8c',
                          fontSize: '16px',
                          lineHeight: '1',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: '0',
                          width: '20px',
                          height: '20px',
                          borderRadius: '50%'
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              
              {/* 输入区域：上为全宽文本区（避免 +/听写与 textarea 同列造成左侧大块留白），下为工具栏 */}
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                marginBottom: '8px',
                borderRadius: '8px',
                backgroundColor: '#ffffff',
                boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
                minWidth: 0,
                maxWidth: '100%',
                width: '100%',
                overflow: 'hidden'
              }}>
                {/* 文本区（全宽） */}
                <div style={{ flex: 1, minWidth: 0, minHeight: '100px', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ padding: '6px 10px 0' }}>
                    <SkillRoundPlanPanel
                      activeSkillIds={activeSkillIds}
                      skillNames={skillNamesMap}
                      toolsInjectedInSystem={activeSkillIds.length > 0}
                      openAiToolsSent={composerOpenAiToolsSent}
                      evolutionEnabled={isSkillEvolutionEnabled()}
                    />
                    <ContextBudgetPanel recentMessages={messages} compact />
                  </div>
                  {voiceInterimDisplay ? (
                    <div
                      style={{
                        padding: '4px 12px',
                        fontSize: '14px',
                        color: '#666',
                        fontStyle: 'italic',
                        lineHeight: 1.35,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        flexShrink: 0,
                        minWidth: 0
                      }}
                    >
                      识别中：{voiceInterimDisplay}
                    </div>
                  ) : null}
                  <textarea
                    data-testid="chat-input"
                    ref={textAreaRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onPaste={handlePaste}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey && !isLoading) {
                        e.preventDefault();
                        handleSendMessage(input, files);
                      }
                    }}
                    placeholder="输入消息…（支持粘贴图片；底部工具栏听写为浏览器语音识别）"
                    disabled={isLoading}
                    rows={5}
                    style={{
                      width: '100%',
                      maxWidth: '100%',
                      minWidth: 0,
                      boxSizing: 'border-box',
                      padding: '8px 12px',
                      border: 'none',
                      resize: 'none',
                      minHeight: '100px',
                      fontSize: '14px',
                      outline: 'none',
                      fontFamily: 'inherit',
                      lineHeight: '1.6',
                      backgroundColor: 'transparent',
                      color: '#333',
                      overflowWrap: 'break-word',
                      wordBreak: 'break-word'
                    }}
                  />
                </div>

                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  style={{ display: 'none' }}
                  onChange={handleFileUpload}
                />
                {/* 底栏：工具 + 模型/发送 */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    minWidth: 0,
                    borderTop: '1px solid #f0f0f0',
                    padding: '4px 4px 8px 4px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                    <div style={{ position: 'relative', zIndex: 1001, flexShrink: 0 }}>
                      <Popover
                        open={isAddMenuOpen}
                        onOpenChange={(open) => {
                          if (!open && isPickingFilesRef.current) return;
                          if (open) {
                            openExclusiveOverlay('addMenu');
                          } else {
                            setIsAddMenuOpen(false);
                          }
                        }}
                        placement="topLeft"
                        trigger={[]}
                        destroyOnHidden={false}
                        content={
                          <div
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => e.stopPropagation()}
                          >
                          <ToolsMenu
                            skills={skills}
                            activeSkillIds={activeSkillIds}
                            onToggleSkill={handleToggleSkill}
                            modelOptions={modelOptions}
                            selectedProvider={selectedProvider as ChatProvider}
                            selectedModel={selectedModel}
                            onChangeProviderModel={(provider, model) => {
                              setSelectedProvider(provider);
                              setSelectedModel(model);
                              localStorage.setItem('selectedProvider', provider);
                              localStorage.setItem('selectedModel', model);
                            }}
                            onPrepareFilePick={beginFilePick}
                            onUploadFiles={handleToolsMenuUploadFiles}
                            knowledgeItemCount={knowledgeItems.length}
                            selectedPromptsCount={selectedPrompts.length}
                            lastToolRoundSkillIds={lastToolRoundSkillIds}
                            onOpenKnowledgeSelection={() => {
                              openExclusiveOverlay('knowledge');
                            }}
                            onOpenChatDocuments={() => {
                              openExclusiveOverlay('chatDocuments');
                            }}
                            onOpenPromptTemplates={() => {
                              openExclusiveOverlay('promptConfig');
                            }}
                            installSkillFromUrl={installSkillFromUrl}
                            onHubSkillInstalled={handleHubSkillInstalled}
                            onSyncToolRoutingIndex={handleSyncToolRoutingIndex}
                            defaultTabKey={toolsMenuDefaultTab}
                            allowSkillEntry={allowSkillEntry}
                            onAllowSkillEntryChange={handleAllowSkillEntryChange}
                            allowSkillRuntime={allowSkillRuntime}
                            onAllowSkillRuntimeChange={handleAllowSkillRuntimeChange}
                            streamIncludeUsage={streamIncludeUsageUi}
                            onStreamIncludeUsageChange={handleStreamIncludeUsageChange}
                            streamIncludeUsageHasLocalOverride={streamUsageOverridePresent}
                            onResetStreamIncludeUsageDefault={handleResetStreamIncludeUsageDefault}
                            knowledgeScope={knowledgeScopeUi}
                            onKnowledgeScopeChange={handleKnowledgeScopeChange}
                          />
                          </div>
                        }
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setToolsMenuDefaultTab('attachments');
                            toggleExclusiveOverlay('addMenu', isAddMenuOpen);
                          }}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#666',
                            padding: '12px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '16px',
                            borderRadius: '6px',
                            transition: 'background-color 0.2s'
                          }}
                          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#f5f5f5')}
                          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                          title="工具与设置"
                        >
                          <Badge count={activeSkillIds.length} size="small" offset={[2, -2]}>
                            <span style={{ display: 'inline-block', width: 14 }}>+</span>
                          </Badge>
                        </button>
                      </Popover>
                    </div>

                    <ChatVoiceMicButton
                      appendTranscript={appendVoiceTranscript}
                      onInterimChange={handleVoiceInterim}
                      disabled={isLoading}
                    />
                  </div>

                  <div
                    style={{
                      flex: 1,
                      minWidth: 0
                    }}
                  />

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      onClick={() => openToolsMenuTab('skills')}
                      style={{
                        background: '#f5f5f5',
                        border: '1px solid #e8e8e8',
                        color: '#333',
                        padding: '6px 10px',
                        borderRadius: '6px',
                        fontSize: '12px',
                        outline: 'none',
                        cursor: 'pointer',
                        maxWidth: '220px',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}
                      title="查看/调整本轮启用的 Skills 与 Tools"
                    >
                      Skills {activeSkillIds.length} · Tools {enabledToolsCount}
                    </button>
                    <button
                      type="button"
                      onClick={() => openToolsMenuTab('model')}
                      style={{
                        background: '#f5f5f5',
                        border: '1px solid #e8e8e8',
                        color: '#333',
                        padding: '6px 10px',
                        borderRadius: '6px',
                        fontSize: '12px',
                        outline: 'none',
                        cursor: 'pointer',
                        maxWidth: '220px',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}
                      title={`切换模型/Provider（当前解析：${chatRuntimeBadge}）`}
                    >
                      {chatRuntimeBadge}
                    </button>

                    {/* 发送按钮 */}
                    <button
                      type="button"
                      onClick={() => handleSendMessage(input, files)}
                      disabled={!input.trim() || isLoading}
                      style={{
                        background: input.trim() && !isLoading ? '#1890ff' : '#d9d9d9',
                        border: 'none',
                        color: '#fff',
                        padding: '8px 16px',
                        cursor: input.trim() && !isLoading ? 'pointer' : 'not-allowed',
                        borderRadius: '4px',
                        fontSize: '14px',
                        fontWeight: 500,
                        transition: 'all 0.2s'
                      }}
                      onMouseEnter={(e) => {
                        if (input.trim() && !isLoading) {
                          e.currentTarget.style.backgroundColor = '#40a9ff';
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (input.trim() && !isLoading) {
                          e.currentTarget.style.backgroundColor = '#1890ff';
                        }
                      }}
                    >
                      {isLoading ? (
                        <span style={{ display: 'flex', alignItems: 'center' }}>
                          <span style={{ marginRight: '8px' }}>发送中...</span>
                          <span style={{
                            display: 'inline-block',
                            width: '12px',
                            height: '12px',
                            border: '2px solid #fff',
                            borderTop: '2px solid transparent',
                            borderRadius: '50%',
                            animation: 'spin 1s linear infinite'
                          }}></span>
                        </span>
                      ) : (
                        '发送'
                      )}
                    </button>
                  </div>
                </div>
              </div>
              
              {/* 错误提示 */}
              {error && (
                <StatusIndicator className="error" style={{ marginTop: '12px' }}>
                  <StopOutlined /> {error}
                </StatusIndicator>
              )}
            </InputContainer>
          </>
        )}
      </MainContent>

      {renderPermissionModal()}
      {renderScriptConsentModal()}
      
      {/* Skills列收起展开按钮 */}
      {!isSkillsExpanded && (
        <button 
          onClick={() => setIsSkillsExpanded(true)}
          style={{
            width: '60px',
            height: '60px',
            borderRadius: '8px 0 0 8px',
            backgroundColor: '#ffffff',
            border: '1px solid #e8e8e8',
            borderRight: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'absolute',
            right: '0',
            top: '20px',
            zIndex: '100'
          }}
        >
          ◀
        </button>
      )}
      
      <div style={{ 
        flexShrink: 0,
        width: isSkillsExpanded ? '280px' : '0', 
        backgroundColor: '#ffffff', 
        borderLeft: isSkillsExpanded ? '1px solid #e8e8e8' : 'none',
        padding: isSkillsExpanded ? '20px' : '0',
        overflow: 'hidden',
        transition: 'width 0.3s ease',
        position: 'relative'
      }}>
        {isSkillsExpanded && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h4 style={{ fontSize: '14px', fontWeight: '600', color: '#666', margin: 0 }}>
                Skills（<button 
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '14px',
                    color: '#1890ff',
                    padding: 0,
                    textDecoration: 'underline'
                  }}
                  onClick={() => navigate('/manager')}
                >管理</button>）
              </h4>
              <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                <span style={{ fontSize: '12px', color: '#999', marginRight: '4px' }}>搜索</span>
                <button 
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '14px',
                    color: '#666',
                    display: 'flex',
                    alignItems: 'center',
                    padding: '4px'
                  }}
                  onClick={() => openExclusiveOverlay('search')}
                  title="搜索技能和快速提示"
                >
                  <SearchOutlined />
                </button>
                <button 
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '18px',
                    color: '#666'
                  }}
                  onClick={() => setIsSkillsExpanded(false)}
                  title="折叠"
                >
                  ▶
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {skills.map((skill) => (
                <div key={skill.id} style={{
                  padding: '12px',
                  borderRadius: '4px',
                  border: '1px solid #e8e8e8',
                  backgroundColor: skill.enabled ? '#f8f9fa' : '#ffffff'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: '450', fontSize: '14px', marginBottom: '4px' }}>{skill.name}</div>
                      {skill.version && (
                        <div style={{ fontSize: '10px', color: '#999' }}>v{skill.version}</div>
                      )}
                    </div>
                    {skill.enabled ? (
                      <button 
                        style={{
                          background: '#1890ff',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          padding: '4px 8px',
                          cursor: 'pointer',
                          fontSize: '12px'
                        }}
                        onClick={() => {
                          // 实现调用skill功能
                          setInput(input + `\n\n调用技能: ${skill.name}\n描述: ${skill.description}`);
                        }}
                      >
                        调用
                      </button>
                    ) : (
                      <button 
                        style={{
                          background: 'none',
                          color: '#1a73e8',
                          border: '1px solid #1a73e8',
                          borderRadius: '4px',
                          padding: '4px 8px',
                          cursor: 'pointer',
                          fontSize: '12px'
                        }}
                        onClick={async () => {
                          // 启用技能
                          if (orchestrator) {
                            const pluginManager = orchestrator.getPluginManager();
                            await pluginManager.enableSkill(skill.id);
                            refreshSkills(orchestrator);
                          }
                        }}
                      >
                        启用
                      </button>
                    )}
                  </div>
                  <div style={{ fontSize: '12px', color: '#666', lineHeight: '1.4', marginBottom: '6px' }}>
                    {skill.description}
                  </div>
                  {skill.metadata?.author && skill.metadata.author !== 'Unknown' && (
                    <div style={{ fontSize: '10px', color: '#999', marginTop: '4px' }}>
                      作者: {skill.metadata.author}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <ApiConfigModal
        isOpen={isApiConfigModalOpen}
        onClose={() => setIsApiConfigModalOpen(false)}
      />

      <KnowledgeSelectionModal
        isOpen={isKnowledgeModalOpen}
        onClose={() => setIsKnowledgeModalOpen(false)}
        selectedKnowledge={selectedKnowledge}
        onSelectKnowledge={setSelectedKnowledge}
      />

      <ChatDocumentsModal
        isOpen={isChatDocumentsModalOpen}
        onClose={() => setIsChatDocumentsModalOpen(false)}
        sessionId={currentSessionId}
        userId="default"
      />

      {/* 创建主题模态框 */}
      {isCreateTopicModalOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000
        }}>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            padding: '32px',
            width: '600px',
            maxWidth: '90%',
            maxHeight: '80vh',
            overflowY: 'auto'
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '24px'
            }}>
              <h3 style={{ margin: 0, fontSize: '20px', fontWeight: '600', color: '#333' }}>创建项目主题</h3>
              <button 
                onClick={() => setIsCreateTopicModalOpen(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '24px',
                  color: '#999',
                  padding: '0',
                  width: '32px',
                  height: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                ×
              </button>
            </div>
            
            <div style={{ marginBottom: '24px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: '500', color: '#666' }}>
                项目主题名称
              </label>
              <input
                type="text"
                value={newTopicName}
                onChange={(e) => setNewTopicName(e.target.value)}
                placeholder="输入项目主题名称"
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  border: '1px solid #e8e8e8',
                  borderRadius: '8px',
                  fontSize: '14px',
                  outline: 'none',
                  transition: 'border-color 0.2s'
                }}
                onFocus={(e) => {
                  (e.target as HTMLInputElement).style.borderColor = '#1890ff';
                }}
                onBlur={(e) => {
                  (e.target as HTMLInputElement).style.borderColor = '#e8e8e8';
                }}
              />
            </div>
            
            <div style={{ marginBottom: '24px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: '500', color: '#666' }}>
                项目描述（可选）
              </label>
              <textarea
                value={newTopicContent}
                onChange={(e) => setNewTopicContent(e.target.value)}
                placeholder="输入项目描述"
                style={{
                  width: '100%',
                  height: '80px',
                  padding: '12px 16px',
                  border: '1px solid #e8e8e8',
                  borderRadius: '8px',
                  fontSize: '14px',
                  resize: 'vertical',
                  outline: 'none',
                  transition: 'border-color 0.2s'
                }}
                onFocus={(e) => {
                  (e.target as HTMLTextAreaElement).style.borderColor = '#1890ff';
                }}
                onBlur={(e) => {
                  (e.target as HTMLTextAreaElement).style.borderColor = '#e8e8e8';
                }}
              />
            </div>
            
            <div style={{ marginBottom: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <label style={{ fontSize: '14px', fontWeight: '500', color: '#666' }}>
                  上传文件
                </label>
                <button
                  onClick={() => {
                    const fileInput = document.createElement('input');
                    fileInput.type = 'file';
                    fileInput.multiple = true;
                    fileInput.onchange = (e) => {
                      const target = e.target as HTMLInputElement;
                      if (target.files) {
                        const filesWithTimestamp = Array.from(target.files).map(file => ({
                          file,
                          addedAt: Date.now()
                        }));
                        setNewTopicFiles(prev => [...prev, ...filesWithTimestamp]);
                      }
                    };
                    fileInput.click();
                  }}
                  style={{
                    background: 'none',
                    border: '1px solid #1890ff',
                    color: '#1890ff',
                    borderRadius: '6px',
                    padding: '6px 12px',
                    cursor: 'pointer',
                    fontSize: '13px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  + 添加文件
                </button>
              </div>
              {newTopicFiles.length > 0 && (
                <div style={{ 
                  display: 'flex', 
                  flexDirection: 'column', 
                  gap: '8px',
                  border: '1px solid #e8e8e8',
                  borderRadius: '8px',
                  padding: '16px'
                }}>
                  {[...newTopicFiles]
                    .sort((a, b) => b.addedAt - a.addedAt)
                    .map((item, index) => (
                      <div key={index} style={{ 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        alignItems: 'center',
                        padding: '10px',
                        backgroundColor: '#f9f9f9',
                        borderRadius: '6px'
                      }}>
                        <span style={{ fontSize: '14px', color: '#333', flex: 1 }}>{item.file.name}</span>
                        <span style={{ fontSize: '12px', color: '#999', marginLeft: '12px' }}>
                          {Math.round(item.file.size / 1024)} KB
                        </span>
                        <button 
                          onClick={() => setNewTopicFiles(prev => prev.filter((_, i) => i !== index))}
                          style={{ 
                            background: 'none', 
                            border: 'none', 
                            cursor: 'pointer', 
                            color: '#ff4d4f',
                            fontSize: '16px',
                            lineHeight: '1',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            padding: '0',
                            width: '20px',
                            height: '20px',
                            borderRadius: '50%',
                            marginLeft: '12px'
                          }}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                </div>
              )}
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button
                onClick={() => setIsCreateTopicModalOpen(false)}
                style={{
                  background: 'none',
                  border: '1px solid #e8e8e8',
                  borderRadius: '8px',
                  padding: '10px 20px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  color: '#666',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = '#1890ff';
                  (e.currentTarget as HTMLButtonElement).style.color = '#1890ff';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = '#e8e8e8';
                  (e.currentTarget as HTMLButtonElement).style.color = '#666';
                }}
              >
                取消
              </button>
              <button
                onClick={async () => {
                  if (newTopicFiles.length === 0) {
                    toast.error('请先添加文件');
                    return;
                  }
                  
                  const filesWithContent = await Promise.all(
                    newTopicFiles.map(async (item) => {
                      let content = '';
                      try {
                        content = await item.file.text();
                      } catch (error) {
                        content = `(无法读取二进制文件: ${item.file.type})`;
                      }
                      return {
                        name: item.file.name,
                        size: item.file.size,
                        addedAt: item.addedAt,
                        content: content
                      };
                    })
                  );
                  
                  if (import.meta.env.DEV) {
                    devLog('📁 文件读取完成:', filesWithContent.map(f => ({
                      name: f.name,
                      contentLength: f.content?.length || 0
                    })));
                  }
                  
                  const newTopic = {
                    id: `topic-${Date.now()}`,
                    name: newTopicName || '未命名主题',
                    description: newTopicContent,
                    files: filesWithContent,
                    instructions: [],
                    lastActive: Date.now()
                  };
                  
                  devLog('📦 准备保存新主题:', {
                    id: newTopic.id,
                    name: newTopic.name,
                    files: newTopic.files.map(f => ({
                      name: f.name,
                      contentLength: f.content?.length || 0
                    }))
                  });
                  
                  const updatedTopics = [newTopic, ...topics];
                  setTopics(updatedTopics);

                  // 文件内容写 IndexedDB，元数据写 localStorage，避免配额溢出
                  await persistTopicsToStorage(updatedTopics);
                  setIsCreateTopicModalOpen(false);
                  setNewTopicName('');
                  setNewTopicContent('');
                  setNewTopicFiles([]);
                }}
                style={{
                  background: '#1890ff',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '10px 20px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '500',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = '#40a9ff';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = '#1890ff';
                }}
              >
                创建项目
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* 重命名模态框 */}
      {isRenameModalOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000
        }}>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            padding: '32px',
            width: '500px',
            maxWidth: '90%'
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '24px'
            }}>
              <h3 style={{ margin: 0, fontSize: '20px', fontWeight: '600', color: '#333' }}>
                {menuTarget === 'topic' ? '重命名主题' : '重命名会话'}
              </h3>
              <button 
                onClick={() => setIsRenameModalOpen(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '24px',
                  color: '#999',
                  padding: '0',
                  width: '32px',
                  height: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                ×
              </button>
            </div>
            
            <div style={{ marginBottom: '24px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: '500', color: '#666' }}>
                新名称
              </label>
              <input
                type="text"
                value={renameNewName}
                onChange={(e) => setRenameNewName(e.target.value)}
                placeholder="输入新名称"
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  border: '1px solid #e8e8e8',
                  borderRadius: '8px',
                  fontSize: '14px',
                  outline: 'none',
                  transition: 'border-color 0.2s'
                }}
                onFocus={(e) => {
                  (e.target as HTMLInputElement).style.borderColor = '#1890ff';
                }}
                onBlur={(e) => {
                  (e.target as HTMLInputElement).style.borderColor = '#e8e8e8';
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    // 直接调用重命名逻辑
                    if (menuTarget === 'topic') {
                      const renamed = topics.map(t => 
                        t.id === menuItem.id 
                          ? { ...t, name: renameNewName || t.name } 
                          : t
                      );
                      setTopics(renamed);
                      persistTopicsToStorage(renamed);
                      // 如果重命名的是当前选中的主题，更新选中状态
                      if (selectedTopic?.id === menuItem.id) {
                        setSelectedTopic((prev: any) => prev ? { ...prev, name: renameNewName } : null);
                      }
                    } else if (menuTarget === 'session') {
                      const updatedSession = { ...sessions.find(s => s.id === menuItem.id)!, name: renameNewName || sessions.find(s => s.id === menuItem.id)!.name };
                      setSessions(prev => prev.map(s => 
                        s.id === menuItem.id 
                          ? { ...s, name: renameNewName || s.name } 
                          : s
                      ));
                      sessionStorageService.update(updatedSession);
                    }
                    setIsRenameModalOpen(false);
                  }
                }}
              />
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button
                onClick={() => setIsRenameModalOpen(false)}
                style={{
                  background: 'none',
                  border: '1px solid #e8e8e8',
                  borderRadius: '8px',
                  padding: '10px 20px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  color: '#666',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = '#1890ff';
                  (e.currentTarget as HTMLButtonElement).style.color = '#1890ff';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = '#e8e8e8';
                  (e.currentTarget as HTMLButtonElement).style.color = '#666';
                }}
              >
                取消
              </button>
              <button
                onClick={() => {
                  if (menuTarget === 'topic') {
                    const renamed = topics.map(t => 
                      t.id === menuItem.id 
                        ? { ...t, name: renameNewName || t.name } 
                        : t
                    );
                    setTopics(renamed);
                    persistTopicsToStorage(renamed);
                    // 如果重命名的是当前选中的主题，更新选中状态
                    if (selectedTopic?.id === menuItem.id) {
                      setSelectedTopic((prev: any) => prev ? { ...prev, name: renameNewName } : null);
                    }
                  } else if (menuTarget === 'session') {
                    const updatedSession = { ...sessions.find(s => s.id === menuItem.id)!, name: renameNewName || sessions.find(s => s.id === menuItem.id)!.name };
                    setSessions(prev => prev.map(s => 
                      s.id === menuItem.id 
                        ? { ...s, name: renameNewName || s.name } 
                        : s
                    ));
                    sessionStorageService.update(updatedSession);
                  }
                  setIsRenameModalOpen(false);
                }}
                style={{
                  background: '#1890ff',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '10px 20px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '500',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = '#40a9ff';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = '#1890ff';
                }}
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* 删除确认模态框 */}
      {isDeleteConfirmOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000
        }}>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            padding: '32px',
            width: '450px',
            maxWidth: '90%'
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '24px'
            }}>
              <h3 style={{ margin: 0, fontSize: '20px', fontWeight: '600', color: '#333' }}>
                {menuTarget === 'topic' ? '删除主题' : '删除会话'}
              </h3>
              <button 
                onClick={() => setIsDeleteConfirmOpen(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '24px',
                  color: '#999',
                  padding: '0',
                  width: '32px',
                  height: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                ×
              </button>
            </div>
            
            <div style={{ marginBottom: '28px' }}>
              <p style={{ 
                fontSize: '15px', 
                color: '#666', 
                margin: 0,
                lineHeight: '1.6'
              }}>
                确定要删除「<span style={{ color: '#333', fontWeight: '500' }}>{menuItem?.name}</span>」吗？
              </p>
              <p style={{ 
                fontSize: '13px', 
                color: '#999', 
                margin: '8px 0 0 0',
                lineHeight: '1.5'
              }}>
                {menuTarget === 'topic' 
                  ? '此操作不可撤销，主题内的所有会话也会受到影响。' 
                  : '此操作不可撤销，会话内的所有消息将被永久删除。'}
              </p>
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button
                onClick={() => setIsDeleteConfirmOpen(false)}
                style={{
                  background: 'none',
                  border: '1px solid #e8e8e8',
                  borderRadius: '8px',
                  padding: '10px 20px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  color: '#666',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = '#1890ff';
                  (e.currentTarget as HTMLButtonElement).style.color = '#1890ff';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = '#e8e8e8';
                  (e.currentTarget as HTMLButtonElement).style.color = '#666';
                }}
              >
                取消
              </button>
              <button
                onClick={() => {
                  // 执行删除
                  if (menuTarget === 'topic') {
                    const remaining = topics.filter(t => t.id !== menuItem.id);
                    setTopics(remaining);
                    persistTopicsToStorage(remaining);
                    // 顺便清理 IDB 里该主题的文件内容（异步、失败不阻断）
                    topicFilesStore.deleteTopic(menuItem.id).catch(() => {});
                    // 如果删除的是当前选中的主题，清除选中状态
                    if (selectedTopic?.id === menuItem.id) {
                      setSelectedTopic(null);
                      setViewMode('topics');
                    }
                  } else if (menuTarget === 'session') {
                    // 使用 SessionStorageService 删除会话（带验证和缓存机制）
                    const success = sessionStorageService.delete(menuItem.id);
                    
                    if (success) {
                      // 更新 React 状态
                      setSessions(sessionStorageService.getAll());
                      devLog('🗑️ 会话删除成功:', menuItem.id);
                    } else {
                      devError('❌ 会话删除失败');
                    }
                    
                    // 同时删除会话消息
                    try {
                      const savedMessages = localStorage.getItem('yueli_session_messages');
                      if (savedMessages) {
                        const allMessages = JSON.parse(savedMessages);
                        delete allMessages[menuItem.id];
                        localStorage.setItem('yueli_session_messages', JSON.stringify(allMessages));
                      }
                    } catch (error) {
                      devError('删除会话消息失败:', error);
                    }
                    // 如果删除的是当前会话，返回会话列表
                    if (currentSessionId === menuItem.id) {
                      setCurrentSessionId(null);
                      setViewMode('topic-sessions');
                      setMessages([]);
                    }
                  }
                  setIsDeleteConfirmOpen(false);
                }}
                style={{
                  background: '#ff4d4f',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '10px 20px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '500',
                  transition: 'all 0.2s'
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = '#ff7875';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.background = '#ff4d4f';
                }}
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* 指令管理模态框 */}
      {isInstructionModalOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000
        }}>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            padding: '32px',
            width: '500px',
            maxWidth: '90%',
            maxHeight: '80vh',
            overflowY: 'auto'
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '24px'
            }}>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '600', color: '#333' }}>管理指令</h3>
              <button 
                onClick={() => setIsInstructionModalOpen(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '24px',
                  color: '#999',
                  padding: '0',
                  width: '32px',
                  height: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                ×
              </button>
            </div>
            
            <div style={{ marginBottom: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                <h4 style={{ margin: 0, fontSize: '14px', fontWeight: '500', color: '#666' }}>选择指令</h4>
                <button
                  onClick={handleAddInstruction}
                  style={{
                    background: 'none',
                    border: '1px solid #1890ff',
                    color: '#1890ff',
                    borderRadius: '6px',
                    padding: '4px 10px',
                    cursor: 'pointer',
                    fontSize: '12px'
                  }}
                >
                  + 添加指令
                </button>
              </div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {instructions.map((instruction: any) => (
                  <div key={instruction.id} style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '12px',
                    backgroundColor: '#f9f9f9',
                    borderRadius: '8px',
                    cursor: 'pointer'
                  }}>
                    <input
                      type="checkbox"
                      checked={selectedInstructions.includes(instruction.id)}
                      onChange={() => handleToggleInstruction(instruction.id)}
                      style={{ marginRight: '12px' }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: '500', marginBottom: '4px' }}>{instruction.name}</div>
                      <div style={{ fontSize: '12px', color: '#666' }}>{instruction.content}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button
                onClick={() => setIsInstructionModalOpen(false)}
                style={{
                  background: 'none',
                  border: '1px solid #e8e8e8',
                  borderRadius: '8px',
                  padding: '10px 20px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  color: '#666'
                }}
              >
                取消
              </button>
              <button
                onClick={handleSaveInstructions}
                style={{
                  background: '#1890ff',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '10px 20px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '500'
                }}
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* 添加指令模态框 */}
      {isAddInstructionModalOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000
        }}>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            padding: '32px',
            width: '500px',
            maxWidth: '90%'
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '24px'
            }}>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '600', color: '#333' }}>添加指令</h3>
              <button 
                onClick={() => setIsAddInstructionModalOpen(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '24px',
                  color: '#999',
                  padding: '0',
                  width: '32px',
                  height: '32px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                ×
              </button>
            </div>
            
            <div style={{ marginBottom: '24px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: '500', color: '#666' }}>
                指令名称
              </label>
              <input
                type="text"
                value={newInstructionName}
                onChange={(e) => setNewInstructionName(e.target.value)}
                placeholder="输入指令名称"
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  border: '1px solid #e8e8e8',
                  borderRadius: '8px',
                  fontSize: '14px',
                  outline: 'none'
                }}
              />
            </div>
            
            <div style={{ marginBottom: '24px' }}>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: '500', color: '#666' }}>
                指令内容
              </label>
              <textarea
                value={newInstructionContent}
                onChange={(e) => setNewInstructionContent(e.target.value)}
                placeholder="输入指令内容"
                style={{
                  width: '100%',
                  height: '100px',
                  padding: '12px 16px',
                  border: '1px solid #e8e8e8',
                  borderRadius: '8px',
                  fontSize: '14px',
                  resize: 'vertical',
                  outline: 'none'
                }}
              />
            </div>
            
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button
                onClick={() => setIsAddInstructionModalOpen(false)}
                style={{
                  background: 'none',
                  border: '1px solid #e8e8e8',
                  borderRadius: '8px',
                  padding: '10px 20px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  color: '#666'
                }}
              >
                取消
              </button>
              <button
                onClick={handleCreateInstruction}
                style={{
                  background: '#1890ff',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '10px 20px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  fontWeight: '500'
                }}
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* 菜单模态框 */}
      {activeMenu && menuItem && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000
        }}>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '8px',
            padding: '24px',
            width: '400px',
            maxWidth: '90%'
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '20px'
            }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '600' }}>
                {menuTarget === 'topic' ? '主题操作' : '会话操作'}
              </h3>
              <button 
                onClick={() => setActiveMenu(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '18px',
                  color: '#999'
                }}
              >
                ×
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <button
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  width: '100%',
                  textAlign: 'left',
                  padding: '12px',
                  background: 'none',
                  border: '1px solid #e8e8e8',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  transition: 'all 0.2s ease'
                }}
                onClick={() => {
                  // 重命名功能
                  setActiveMenu(null);
                  setRenameNewName(menuItem.name);
                  openExclusiveOverlay('rename');
                }}
              >
                ✏️ 重命名
              </button>
              <button
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  width: '100%',
                  textAlign: 'left',
                  padding: '12px',
                  background: 'none',
                  border: '1px solid #e8e8e8',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  transition: 'all 0.2s ease'
                }}
                onClick={() => {
                  // 导出 JSON
                  setActiveMenu(null);
                  try {
                    const savedMessages = localStorage.getItem('yueli_session_messages');
                    let messages = [];
                    if (savedMessages) {
                      const allMessages = JSON.parse(savedMessages);
                      messages = allMessages[menuItem.id] || [];
                    }
                    let exportData = {
                      session: menuItem,
                      messages: messages
                    };
                    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${menuItem.name}.json`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                  } catch (error) {
                    devError('导出JSON失败:', error);
                  }
                }}
              >
                📤 导出 JSON
              </button>
              <button
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  width: '100%',
                  textAlign: 'left',
                  padding: '12px',
                  background: 'none',
                  border: '1px solid #e8e8e8',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  transition: 'all 0.2s ease'
                }}
                onClick={() => {
                  // 导出 Markdown
                  setActiveMenu(null);
                  try {
                    const savedMessages = localStorage.getItem('yueli_session_messages');
                    let messages = [];
                    if (savedMessages) {
                      const allMessages = JSON.parse(savedMessages);
                      messages = allMessages[menuItem.id] || [];
                    }
                    let markdown = `# ${menuItem.name}\n\n`;
                    markdown += `> 创建时间: ${new Date(menuItem.lastActive).toLocaleString()}\n\n`;
                    markdown += `---\n\n`;
                    
                    messages.forEach((msg: { isBot?: boolean; content: string; time?: string }) => {
                      const role = msg.isBot ? '助手' : '用户';
                      markdown += `## ${role}\n\n`;
                      markdown += `${msg.content}\n\n`;
                      if (msg.time) {
                        markdown += `*${msg.time}*\n\n`;
                      }
                      markdown += `---\n\n`;
                    });
                    
                    const blob = new Blob([markdown], { type: 'text/markdown' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `${menuItem.name}.md`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                  } catch (error) {
                    devError('导出Markdown失败:', error);
                  }
                }}
              >
                📝 导出 Markdown
              </button>
              <button
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  width: '100%',
                  textAlign: 'left',
                  padding: '12px',
                  background: 'none',
                  border: '1px solid #e8e8e8',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  transition: 'all 0.2s ease'
                }}
                onClick={async () => {
                  // 分享功能 - 生成会话URL
                  try {
                    // 构建当前页面URL并添加会话ID参数
                    const url = new URL(window.location.href);
                    url.searchParams.set('session', menuItem.id);
                    const shareUrl = url.toString();

                    await navigator.clipboard.writeText(shareUrl);
                    toast.success('会话链接已复制到剪贴板', {
                      position: 'bottom-center',
                      duration: 2200
                    });
                  } catch (error) {
                    devError('分享失败:', error);
                    toast.error('复制链接失败，请手动复制', {
                      position: 'bottom-center',
                      duration: 2800
                    });
                  }
                  setActiveMenu(null);
                }}
              >
                🔗 分享
              </button>
              <button
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  width: '100%',
                  textAlign: 'left',
                  padding: '12px',
                  background: 'none',
                  border: '1px solid #ff4d4f',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  color: '#ff4d4f',
                  transition: 'all 0.2s ease'
                }}
                onClick={() => {
                  // 打开删除确认模态框
                  setActiveMenu(null);
                  openExclusiveOverlay('deleteConfirm');
                }}
              >
                🗑️ 删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Prompt配置模态框 */}
      {isPromptConfigModalOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000
        }}>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '8px',
            padding: '24px',
            width: '600px',
            maxWidth: '90%',
            maxHeight: '80vh',
            overflowY: 'auto'
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '20px'
            }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '600' }}>
                {editingPromptId ? '编辑快速提示' : '配置快速提示'}
              </h3>
              <button 
                onClick={() => {
                  setIsPromptConfigModalOpen(false);
                  setEditingPromptId(null);
                  setNewPromptId('');
                  setNewPromptName('');
                  setNewPromptContent('');
                  setNewPromptSystemPrompt('');
                  setNewPromptFunctionPrompt('');
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '18px',
                  color: '#999'
                }}
              >
                ×
              </button>
            </div>
            <div style={{ marginBottom: '20px' }}>
              <h4 style={{ margin: 0, fontSize: '14px', fontWeight: '600', marginBottom: '12px' }}>
                {editingPromptId ? '编辑提示' : '添加新提示'}
              </h4>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '12px' }}>
                <div style={{ display: 'flex', gap: '12px' }}>
                  <input
                    type="text"
                    value={newPromptId}
                    onChange={(e) => setNewPromptId(e.target.value)}
                    placeholder="提示ID (小写字母、数字、连字符)"
                    disabled={!!editingPromptId}
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      border: '1px solid #e8e8e8',
                      borderRadius: '4px',
                      fontSize: '14px',
                      backgroundColor: editingPromptId ? '#f5f5f5' : 'white'
                    }}
                  />
                  <input
                    type="text"
                    value={newPromptName}
                    onChange={(e) => setNewPromptName(e.target.value)}
                    placeholder="提示名称"
                    style={{
                      flex: 2,
                      padding: '8px 12px',
                      border: '1px solid #e8e8e8',
                      borderRadius: '4px',
                      fontSize: '14px'
                    }}
                  />
                </div>
                <input
                  type="text"
                  value={newPromptContent}
                  onChange={(e) => setNewPromptContent(e.target.value)}
                  placeholder="提示内容（简短描述，显示在快捷按钮上）"
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '1px solid #e8e8e8',
                    borderRadius: '4px',
                    fontSize: '14px'
                  }}
                />
                <div style={{ marginTop: '8px' }}>
                  <label style={{ fontSize: '12px', color: '#666', fontWeight: 500 }}>System Prompt（角色定义 - 注入到系统消息中）</label>
                  <textarea
                    value={newPromptSystemPrompt}
                    onChange={(e) => setNewPromptSystemPrompt(e.target.value)}
                    placeholder="定义AI助手的角色和行为方式。例如：你是一位专业翻译，精通多语言..."
                    style={{
                      width: '100%',
                      minHeight: '80px',
                      padding: '8px 12px',
                      border: '1px solid #e8e8e8',
                      borderRadius: '4px',
                      fontSize: '13px',
                      fontFamily: 'inherit',
                      resize: 'vertical',
                      marginTop: '4px'
                    }}
                  />
                </div>
                <div style={{ marginTop: '8px' }}>
                  <label style={{ fontSize: '12px', color: '#666', fontWeight: 500 }}>Function Prompt（功能指令 - 添加到用户输入中）</label>
                  <textarea
                    value={newPromptFunctionPrompt}
                    onChange={(e) => setNewPromptFunctionPrompt(e.target.value)}
                    placeholder="定义具体的任务指令和处理流程。例如：请将以下内容翻译成目标语言，要求..."
                    style={{
                      width: '100%',
                      minHeight: '80px',
                      padding: '8px 12px',
                      border: '1px solid #e8e8e8',
                      borderRadius: '4px',
                      fontSize: '13px',
                      fontFamily: 'inherit',
                      resize: 'vertical',
                      marginTop: '4px'
                    }}
                  />
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {editingPromptId ? (
                    <>
                      <button
                        onClick={() => {
                          if (newPromptName && newPromptContent) {
                            setPrompts(prev => prev.map(p => 
                              p.id === editingPromptId 
                                ? { ...p, name: newPromptName, content: newPromptContent, systemPrompt: newPromptSystemPrompt, functionPrompt: newPromptFunctionPrompt }
                                : p
                            ));
                            setEditingPromptId(null);
                            setNewPromptId('');
                            setNewPromptName('');
                            setNewPromptContent('');
                            setNewPromptSystemPrompt('');
                            setNewPromptFunctionPrompt('');
                          }
                        }}
                        style={{
                          background: '#1890ff',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          padding: '8px 16px',
                          cursor: 'pointer',
                          fontSize: '14px'
                        }}
                      >
                        更新
                      </button>
                      <button
                        onClick={() => {
                          setEditingPromptId(null);
                          setNewPromptId('');
                          setNewPromptName('');
                          setNewPromptContent('');
                          setNewPromptSystemPrompt('');
                          setNewPromptFunctionPrompt('');
                        }}
                        style={{
                          background: 'none',
                          color: '#666',
                          border: '1px solid #e8e8e8',
                          borderRadius: '4px',
                          padding: '8px 16px',
                          cursor: 'pointer',
                          fontSize: '14px'
                        }}
                      >
                        取消
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => {
                        if (newPromptId && newPromptName && newPromptContent && prompts.length < 99) {
                          const newPrompt = {
                            id: newPromptId.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
                            name: newPromptName,
                            content: newPromptContent,
                            systemPrompt: newPromptSystemPrompt,
                            functionPrompt: newPromptFunctionPrompt
                          };
                          setPrompts(prev => [...prev, newPrompt]);
                          setNewPromptId('');
                          setNewPromptName('');
                          setNewPromptContent('');
                          setNewPromptSystemPrompt('');
                          setNewPromptFunctionPrompt('');
                        }
                      }}
                      style={{
                        background: '#1890ff',
                        color: 'white',
                        border: 'none',
                        borderRadius: '4px',
                        padding: '8px 16px',
                        cursor: 'pointer',
                        fontSize: '14px',
                        alignSelf: 'flex-start'
                      }}
                    >
                      添加
                    </button>
                  )}
                </div>
              </div>
            </div>
            <div>
              <h4 style={{ margin: 0, fontSize: '14px', fontWeight: '600', marginBottom: '12px' }}>
                选择默认提示（最多6个）- 点击可编辑
              </h4>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                {prompts.map(prompt => (
                  <div 
                    key={prompt.id} 
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '8px 12px',
                      border: '1px solid #e8e8e8',
                      borderRadius: '4px',
                      backgroundColor: selectedPrompts.includes(prompt.id) ? '#e6f7ff' : 'white',
                      cursor: 'pointer'
                    }}
                    onClick={() => {
                      if (!editingPromptId) {
                        setEditingPromptId(prompt.id);
                        setNewPromptId(prompt.id);
                        setNewPromptName(prompt.name);
                        setNewPromptContent(prompt.content);
                        setNewPromptSystemPrompt(prompt.systemPrompt || '');
                        setNewPromptFunctionPrompt(prompt.functionPrompt || '');
                      }
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedPrompts.includes(prompt.id)}
                      onChange={(e) => {
                        e.stopPropagation();
                        if (e.target.checked) {
                          if (selectedPrompts.length < 6) {
                            setSelectedPrompts(prev => [...prev, prompt.id]);
                          }
                        } else {
                          setSelectedPrompts(prev => prev.filter(id => id !== prompt.id));
                        }
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <span>{prompt.name}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setPrompts(prev => prev.filter(p => p.id !== prompt.id));
                        setSelectedPrompts(prev => prev.filter(id => id !== prompt.id));
                      }}
                      style={{
                        background: 'none',
                        border: 'none',
                        cursor: 'pointer',
                        color: '#ff4d4f',
                        fontSize: '14px'
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 技能安装模态框 */}
      {isSkillInstallModalOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000
        }}>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '8px',
            padding: '24px',
            width: '600px',
            maxWidth: '90%',
            maxHeight: '80vh',
            overflowY: 'auto'
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '20px'
            }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '600' }}>安装技能</h3>
              <button 
                onClick={() => {
                  setIsSkillInstallModalOpen(false);
                  setSkillInstallMode('manual');
                  setSkillUrl('');
                  setNewSkillId('');
                  setNewSkillName('');
                  setNewSkillDescription('');
                  setNewSkillVersion('1.0.0');
                  setNewSkillAuthor('');
                }}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '18px',
                  color: '#999'
                }}
              >
                ×
              </button>
            </div>
            
            {/* 安装模式选择 */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
              <button
                onClick={() => setSkillInstallMode('manual')}
                style={{
                  flex: 1,
                  padding: '8px 16px',
                  border: skillInstallMode === 'manual' ? '2px solid #1890ff' : '1px solid #e8e8e8',
                  borderRadius: '4px',
                  background: skillInstallMode === 'manual' ? '#e6f7ff' : 'white',
                  color: skillInstallMode === 'manual' ? '#1890ff' : '#333',
                  cursor: 'pointer',
                  fontSize: '14px'
                }}
              >
                手动添加
              </button>
              <button
                onClick={() => setSkillInstallMode('url')}
                style={{
                  flex: 1,
                  padding: '8px 16px',
                  border: skillInstallMode === 'url' ? '2px solid #1890ff' : '1px solid #e8e8e8',
                  borderRadius: '4px',
                  background: skillInstallMode === 'url' ? '#e6f7ff' : 'white',
                  color: skillInstallMode === 'url' ? '#1890ff' : '#333',
                  cursor: 'pointer',
                  fontSize: '14px'
                }}
              >
                从URL安装
              </button>
            </div>

            {skillInstallMode === 'manual' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', gap: '12px' }}>
                  <input
                    type="text"
                    value={newSkillId}
                    onChange={(e) => setNewSkillId(e.target.value)}
                    placeholder="技能ID (小写字母、数字、连字符)"
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      border: '1px solid #e8e8e8',
                      borderRadius: '4px',
                      fontSize: '14px'
                    }}
                  />
                  <input
                    type="text"
                    value={newSkillVersion}
                    onChange={(e) => setNewSkillVersion(e.target.value)}
                    placeholder="版本 (1.0.0)"
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      border: '1px solid #e8e8e8',
                      borderRadius: '4px',
                      fontSize: '14px'
                    }}
                  />
                </div>
                <input
                  type="text"
                  value={newSkillName}
                  onChange={(e) => setNewSkillName(e.target.value)}
                  placeholder="技能名称"
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '1px solid #e8e8e8',
                    borderRadius: '4px',
                    fontSize: '14px'
                  }}
                />
                <input
                  type="text"
                  value={newSkillAuthor}
                  onChange={(e) => setNewSkillAuthor(e.target.value)}
                  placeholder="作者"
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '1px solid #e8e8e8',
                    borderRadius: '4px',
                    fontSize: '14px'
                  }}
                />
                <textarea
                  value={newSkillDescription}
                  onChange={(e) => setNewSkillDescription(e.target.value)}
                  placeholder="技能描述"
                  style={{
                    width: '100%',
                    height: '100px',
                    padding: '8px 12px',
                    border: '1px solid #e8e8e8',
                    borderRadius: '4px',
                    fontSize: '14px',
                    resize: 'vertical'
                  }}
                />
                <button
                  onClick={async () => {
                    if (newSkillId && newSkillName && newSkillDescription) {
                      try {
                        const skillInstaller = orchestrator.getSkillInstaller();
                        const discoveredSkill = {
                          id: newSkillId.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
                          name: newSkillName,
                          description: newSkillDescription,
                          version: newSkillVersion || '1.0.0',
                          author: newSkillAuthor || 'Unknown'
                        };
                        
                        // 完整流程：安装 + 测试验证
                        const testResult = await skillInstaller.installAndTest(discoveredSkill);
                        
                        if (testResult.success) {
                          refreshSkills(orchestrator);
                          
                          setIsSkillInstallModalOpen(false);
                          setNewSkillId('');
                          setNewSkillName('');
                          setNewSkillDescription('');
                          setNewSkillVersion('1.0.0');
                          setNewSkillAuthor('');
                          
                          alert(`技能安装成功！\n测试结果: ${testResult.message}`);
                        } else {
                          alert(`技能安装或测试失败: ${testResult.message}`);
                        }
                      } catch (error) {
                        devError('安装技能失败:', error);
                        alert('安装技能失败，请重试');
                      }
                    }
                  }}
                  style={{
                    background: '#1890ff',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    padding: '8px 16px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    alignSelf: 'flex-start'
                  }}
                >
                  安装并测试
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <input
                  type="text"
                  value={skillUrl}
                  onChange={(e) => setSkillUrl(e.target.value)}
                  placeholder="GitHub / SkillHub.cn / skills.sh URL（例: https://skillhub.cn/skills/xxx 或 https://github.com/owner/repo）"
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    border: '1px solid #e8e8e8',
                    borderRadius: '4px',
                    fontSize: '14px'
                  }}
                />
                <div style={{ fontSize: '12px', color: '#666' }}>
                  支持的格式：
                  <ul style={{ margin: '8px 0', paddingLeft: '20px' }}>
                    <li>SkillHub.cn: https://skillhub.cn/skills/技能ID</li>
                    <li>GitHub仓库: https://github.com/owner/repo</li>
                    <li>skills.sh: skills.sh/skill-name</li>
                  </ul>
                </div>
                <button
                  onClick={async () => {
                    if (!skillUrl) return;
                    
                    setIsInstallingFromUrl(true);
                    
                    try {
                      const skillInstaller = orchestrator.getSkillInstaller();
                      
                      // 步骤 1: 从 URL 发现技能
                      devLog('正在发现技能...');
                      const discoveredSkills = await skillInstaller.discoverSkillsFromUrl(skillUrl);
                      
                      if (discoveredSkills.length === 0) {
                        alert('未发现可安装的技能');
                        return;
                      }
                      
                      devLog(`发现 ${discoveredSkills.length} 个技能`);
                      
                      // 步骤 2: 安装并测试每个发现的技能（这里简单取第一个）
                      const skillToInstall = discoveredSkills[0];
                      devLog('正在安装技能:', skillToInstall.name);
                      
                      const testResult = await skillInstaller.installAndTest(skillToInstall);
                      
                      if (testResult.success) {
                        refreshSkills(orchestrator);
                        
                        setIsSkillInstallModalOpen(false);
                        setSkillUrl('');
                        setSkillInstallMode('manual');
                        
                        alert(`技能安装成功！\n技能: ${skillToInstall.name}\n测试结果: ${testResult.message}`);
                      } else {
                        alert(`技能安装或测试失败: ${testResult.message}`);
                      }
                      
                    } catch (error) {
                      devError('安装技能失败:', error);
                      alert('安装技能失败，请检查URL是否正确');
                    } finally {
                      setIsInstallingFromUrl(false);
                    }
                  }}
                  disabled={isInstallingFromUrl || !skillUrl}
                  style={{
                    background: '#1890ff',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    padding: '8px 16px',
                    cursor: isInstallingFromUrl || !skillUrl ? 'not-allowed' : 'pointer',
                    fontSize: '14px',
                    alignSelf: 'flex-start',
                    opacity: isInstallingFromUrl || !skillUrl ? 0.6 : 1
                  }}
                >
                  {isInstallingFromUrl ? '安装中...' : '从URL安装'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      
      {/* 旧的固定底部下拉菜单已被 ToolsMenu Popover 替代 */}

      {/* 全局搜索模态框 */}
      {isSearchModalOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'flex-start',
          paddingTop: '100px',
          zIndex: 1000
        }} onClick={() => setIsSearchModalOpen(false)}>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            padding: '24px',
            width: '600px',
            maxWidth: '90%',
            maxHeight: '70vh',
            overflowY: 'auto',
            boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)'
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '16px'
            }}>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '600', color: '#333' }}>搜索技能和快速提示</h3>
              <button 
                onClick={() => setIsSearchModalOpen(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '20px',
                  cursor: 'pointer',
                  color: '#999'
                }}
              >
                ✕
              </button>
            </div>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '12px 16px',
              border: '1px solid #e8e8e8',
              borderRadius: '8px',
              backgroundColor: '#fafafa'
            }}>
              <SearchOutlined style={{ color: '#999' }} />
              <input
                type="text"
                value={searchQueryGlobal}
                onChange={handleSearchInputChange}
                placeholder="输入搜索关键词..."
                autoFocus
                style={{
                  flex: 1,
                  border: 'none',
                  fontSize: '14px',
                  outline: 'none',
                  background: 'transparent',
                  color: '#333'
                }}
              />
            </div>
            <div style={{ marginTop: '16px' }}>
              {searchResults.length === 0 && searchQueryGlobal && (
                <div style={{ textAlign: 'center', color: '#999', padding: '20px' }}>
                  未找到相关结果
                </div>
              )}
              {searchResults.length === 0 && !searchQueryGlobal && (
                <div style={{ textAlign: 'center', color: '#999', padding: '20px' }}>
                  请输入关键词搜索技能或快速提示
                </div>
              )}
              {searchResults.map((result) => (
                <div
                  key={result.id}
                  style={{
                    padding: '16px',
                    border: '1px solid #e8e8e8',
                    borderRadius: '8px',
                    marginBottom: '12px',
                    backgroundColor: '#fafafa',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    gap: '16px'
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                      <div style={{
                        padding: '6px 12px',
                        borderRadius: '4px',
                        fontSize: '12px',
                        fontWeight: '500',
                        backgroundColor: result.type === 'skill' ? '#e6f7ff' : '#f6ffed',
                        color: result.type === 'skill' ? '#1890ff' : '#52c41a'
                      }}>
                        {result.type === 'skill' ? '技能' : '快速提示'}
                      </div>
                      <span style={{ fontWeight: '600', color: '#333' }}>{result.name}</span>
                      {result.type === 'skill' && (
                        <span style={{
                          fontSize: '12px',
                          padding: '2px 8px',
                          borderRadius: '4px',
                          backgroundColor: result.enabled ? '#f6ffed' : '#fff2e8',
                          color: result.enabled ? '#52c41a' : '#fa8c16'
                        }}>
                          {result.enabled ? '已启用' : '未启用'}
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '13px', color: '#666', lineHeight: '1.4' }}>
                      {result.description}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flexShrink: 0 }}>
                    {result.type === 'skill' && (
                      <button
                        onClick={() => handleToggleSkill(result.id)}
                        style={{
                          padding: '6px 12px',
                          border: '1px solid',
                          borderRadius: '4px',
                          fontSize: '12px',
                          cursor: 'pointer',
                          backgroundColor: result.enabled ? 'white' : '#1890ff',
                          color: result.enabled ? '#1890ff' : 'white',
                          borderColor: result.enabled ? '#1890ff' : '#1890ff',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {result.enabled ? '禁用' : '启用'}
                      </button>
                    )}
                    {result.type === 'skill' && (
                      <button
                        onClick={() => handleInvokeSkill(result.id)}
                        style={{
                          padding: '6px 12px',
                          border: '1px solid #52c41a',
                          borderRadius: '4px',
                          fontSize: '12px',
                          cursor: 'pointer',
                          backgroundColor: '#f6ffed',
                          color: '#52c41a',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        调用
                      </button>
                    )}
                    <button
                      onClick={() => result.type === 'prompt' ? handleInsertPrompt(result.id) : handleInvokeSkill(result.id)}
                      style={{
                        padding: '6px 12px',
                        border: '1px solid #1a73e8',
                        borderRadius: '4px',
                        fontSize: '12px',
                        cursor: 'pointer',
                        backgroundColor: '#f0f7ff',
                        color: '#1a73e8',
                        whiteSpace: 'nowrap'
                      }}
                    >
                      插入对话
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 历史会话搜索模态框 */}
      {isHistorySearchModalOpen && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'flex-start',
          paddingTop: '100px',
          zIndex: 1000
        }} onClick={handleCloseHistorySearchModal}>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            padding: '24px',
            width: '600px',
            maxWidth: '90%',
            maxHeight: '70vh',
            overflowY: 'auto',
            boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)'
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '16px'
            }}>
              <h3 style={{ margin: 0, fontSize: '18px', fontWeight: '600', color: '#333' }}>搜索历史会话和消息</h3>
              <button 
                onClick={handleCloseHistorySearchModal}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '20px',
                  cursor: 'pointer',
                  color: '#999'
                }}
              >
                ✕
              </button>
            </div>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '12px 16px',
              border: '1px solid #e8e8e8',
              borderRadius: '8px',
              backgroundColor: '#fafafa'
            }}>
              <SearchOutlined style={{ color: '#999' }} />
              <input
                type="text"
                value={historySearchQuery}
                onChange={handleHistorySearchInputChange}
                placeholder="输入关键词搜索历史会话..."
                autoFocus
                style={{
                  flex: 1,
                  border: 'none',
                  fontSize: '14px',
                  outline: 'none',
                  background: 'transparent',
                  color: '#333'
                }}
              />
            </div>
            <div style={{ marginTop: '16px' }}>
              {historySearchResults.length === 0 && historySearchQuery && (
                <div style={{ textAlign: 'center', color: '#999', padding: '20px' }}>
                  未找到相关结果
                </div>
              )}
              {historySearchResults.length === 0 && !historySearchQuery && (
                <div style={{ textAlign: 'center', color: '#999', padding: '20px' }}>
                  请输入关键词搜索历史会话
                </div>
              )}
              {historySearchResults.map((result, index) => (
                <div
                  key={`${result.sessionId}-${index}`}
                  style={{
                    padding: '16px',
                    border: '1px solid #e8e8e8',
                    borderRadius: '8px',
                    marginBottom: '8px',
                    cursor: 'pointer',
                    background: '#f5f5f5',
                    transition: 'background 0.2s'
                  }}
                  onClick={() => {
                    handleHistorySessionClick({ id: result.sessionId, name: result.sessionName });
                    handleCloseHistorySearchModal();
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#e8e8e8';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = '#f5f5f5';
                  }}
                >
                  <div style={{ fontWeight: '500', color: '#333', marginBottom: '4px' }}>
                    {result.sessionName}
                  </div>
                  <div style={{ fontSize: '13px', color: '#666', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {result.messageContent}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

    </Container>
  );
};

export default YueliCopilot;
