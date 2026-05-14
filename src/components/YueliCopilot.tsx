import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import styled from 'styled-components';
import { useNavigate } from 'react-router-dom';
import { useChat } from '../contexts/ChatContext';
import { useSystemState } from '../contexts/SystemStateContext';
import { toast } from 'react-hot-toast';
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
import { Popover, Badge } from 'antd';
import ToolsMenu from './chat/ToolsMenu';
import { resolveModelOptionsFromCloudConfig, safeParseCloudConfig, type ChatProvider } from '../services/chat/ModelOptions';
import { createInitialStreamReducerState, normalizeRawStreamEvent, reduceStreamEvent } from '../services/chat/StreamEventReducer';
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
import { readOpenAiStreamIncludeUsagePreference } from '../api/services/streamRequestOptions';
import { readKnowledgeScopeMode, KNOWLEDGE_SCOPE_LS_KEY, type KnowledgeScopeMode } from '../services/chat/KnowledgeScope';
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

/**
 * 持久化 topics：先把每个 topic 的文件内容写入 IndexedDB，
 * 再把不含 content 的轻量副本写入 localStorage，避免 QuotaExceededError。
 */
async function persistTopicsToStorage(updated: any[]): Promise<void> {
  return persistTopicsToStorageImpl(updated, (err: any) => {
    if (err?.name === 'QuotaExceededError' || /quota/i.test(String(err?.message || ''))) {
      toast.error('保存项目主题失败：浏览器存储已满。文件内容已落到本地数据库，请删除无用主题后重试');
    } else {
      console.error('persistTopicsToStorage failed:', err);
    }
  });
}

function extractInvocationMetrics(
  res:
    | undefined
    | {
        invocation?: MessageMetrics;
        generationInfo?: {
          usage?: {
            prompt_tokens?: number;
            completion_tokens?: number;
            total_tokens?: number;
          };
        };
      }
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

// 从PromptRegistry获取核心系统prompt
const getSystemPrompt = (): string => {
  try {
    const promptRegistry = PromptRegistry.getInstance();
    const systemCorePrompt = promptRegistry.getPrompt('system-core');
    return systemCorePrompt?.systemPrompt || DEFAULT_SYSTEM_PROMPT;
  } catch (e) {
    console.warn('[YueliCopilot] 获取系统prompt失败，使用默认值');
    return DEFAULT_SYSTEM_PROMPT;
  }
};

// 默认系统prompt（备用）
const DEFAULT_SYSTEM_PROMPT = `你是一个专业的AI助手，名为Yueli Copilot。你的职责是：
1. 准确理解用户的问题和需求
2. 提供清晰、有条理的回答
3. 在适当时候使用代码块、列表等格式化输出
4. 保持友好、专业的态度
5. 如果不确定答案，请诚实告知用户
6. 当有工具可用时，主动调用工具来完成任务

## 内容引用规则
1. 当你收到项目文件或知识库内容时，必须将内容直接整合到回答中
2. 不要在回答中输出文件引用标记（如 [文件名]、TEXT、文件列表等）
3. 不要在文章正文中显示文件引用卡片或标记
4. 所有引用的信息应自然融入文章内容，确保文字连贯、可读、无歧义
5. 如果需要标注来源，可以在文末以附录或引用列表形式补充`;

/**
 * 构建完整的 API messages 数组
 * 修复：正确注入知识库、项目主题文件内容、指令全文、完整历史、技能systemPrompt
 * P1-3: 添加系统提示长度限制，防止超出 LLM 上下文限制
 */
const buildMessages = (
  userInput: string,
  selectedTopic: any,
  recentMessages: Message[],
  instructions: any[],
  knowledgeItems?: Array<{ id: string; name: string; content: string; type: string }>,
  selectedSkillIds?: string[],
  skillConfigs?: Map<string, any>,
  selectedPrompts?: any[],
  personalityPrompt?: string,  // 新增：人格层systemPrompt
  userQuery?: string,  // 新增：用户输入，用于向量召回
  /** 来自 ChatContext.processWithOrchestrator 的 KGM 知识库向量片段（与 knowledgeItems 全量注入二选一由策略决定） */
  knowledgeRagContext?: string
): any[] => {
  // P1-3: 配置参数
  const MAX_TOTAL_CHARS = 30000;  // 总字符限制（约 7500 tokens）
  const MAX_HISTORY_MESSAGES = 10;  // 最大历史消息数
  
  // P1-3: 计算预估 token 数（简单估算：1 token ≈ 4 字符）
  const estimateTokens = (text: string): number => Math.ceil((text || '').length / 4);
  
  // P1-3: 截断文本并添加标记
  const truncateText = (text: string, maxChars: number, prefix: string = ''): string => {
    if (!text || text.length <= maxChars) return text;
    const truncated = text.substring(0, maxChars);
    return `${prefix}${truncated}\n\n[内容已被截断，原长度约 ${estimateTokens(text)} tokens]`;
  };
  
  const messages: any[] = [];
  let totalChars = 0;

  // ── 1. System Prompt（含项目主题完整信息）──
  // 从PromptRegistry动态获取系统prompt，支持管理界面配置
  let systemContent = getSystemPrompt();

  if (selectedTopic) {
    systemContent += `\n\n## 当前项目主题\n`;
    systemContent += `名称: ${selectedTopic.name}\n`;
    if (selectedTopic.description) systemContent += `描述: ${selectedTopic.description}\n`;

    // 使用向量召回检索相关文件内容（只召回最相关的5个segments）
    const hasFilesWithContent = selectedTopic.files?.some((f: any) => f.content && f.content.trim().length > 0);
    
    if (hasFilesWithContent && userQuery) {
      if (import.meta.env.DEV) {
        console.log('🔍 开始向量召回...');
      }
      
      // 准备文件数据
      const filesForRecall = selectedTopic.files
        .filter((f: any) => f.content && f.content.trim().length > 0)
        .map((f: any) => ({
          name: f.name,
          content: f.content
        }));

      // 索引文件并检索
      vectorRecallService.indexSegments(filesForRecall);
      const relevantFiles = vectorRecallService.recallMergedContent(userInput, 5, 0.5);
      
      if (relevantFiles.length > 0) {
        systemContent += `\n### 相关文档内容（向量召回）\n`;
        systemContent += `根据您的查询，以下是最相关的文档内容：\n\n`;
        
        relevantFiles.forEach((file: any, index: number) => {
          systemContent += `---\n`;
          systemContent += `**${index + 1}. ${file.name}**\n`;
          systemContent += `\`\`\`\n${file.content}\n\`\`\`\n`;
        });
        
        systemContent += `\n> 注：以上内容基于语义相似度从 ${selectedTopic.files.length} 个文件中检索得出\n`;
      } else {
        systemContent += `\n### 项目文件内容\n`;
        selectedTopic.files.forEach((f: any) => {
          systemContent += `\n**${f.name}**\n`;
          if (f.content) {
            systemContent += `\`\`\`\n${f.content}\n\`\`\`\n`;
          } else {
            systemContent += `(文件内容未加载)\n`;
          }
        });
      }
    } else if (selectedTopic.files && selectedTopic.files.length > 0) {
      // 没有用户输入或没有文件内容，直接注入全部文件
      systemContent += `\n### 项目文件内容\n`;
      selectedTopic.files.forEach((f: any) => {
        systemContent += `\n**${f.name}**\n`;
        if (f.content) {
          systemContent += `\`\`\`\n${f.content}\n\`\`\`\n`;
        } else {
          systemContent += `(文件内容未加载)\n`;
        }
      });
    }
    
    // 添加强调：必须严格基于项目上下文回答
    systemContent += `\n\n## 重要指示\n`;
    systemContent += `1. 你的所有回答必须严格基于上面提供的项目文件内容\n`;
    systemContent += `2. 如果项目文件中有定义或说明，请优先使用项目文件中的内容\n`;
    systemContent += `3. 当用户询问产品定义、产品信息时，直接使用项目文件中的内容\n`;
    systemContent += `4. 不要编造或使用与项目文件内容不符的信息\n`;
    systemContent += `5. 如果项目文件中有事实信息，请始终遵循这些事实\n`;
  }

  // ── 2. 知识库注入（策略：全量 / 仅向量片段 / 关闭）──
  let knowledgeScope: KnowledgeScopeMode = 'full';
  try {
    knowledgeScope = readKnowledgeScopeMode();
  } catch {
    knowledgeScope = 'full';
  }

  if (knowledgeScope !== 'off' && knowledgeItems && knowledgeItems.length > 0) {
    const rules =
      `\n## 知识库使用规则\n` +
      `1. 知识库中的内容是权威的事实信息\n` +
      `2. 当回答涉及知识库内容时，必须严格遵循知识库中的信息\n` +
      `3. 不要编造或改变知识库中的事实\n` +
      `4. 如果用户询问的内容在知识库中有，请直接引用\n`;

    if (knowledgeScope === 'vector' && knowledgeRagContext && knowledgeRagContext.trim().length > 0) {
      systemContent += `\n\n## 知识库上下文（向量召回）\n${knowledgeRagContext.trim()}${rules}`;
    } else {
      if (knowledgeScope === 'vector' && (!knowledgeRagContext || !knowledgeRagContext.trim())) {
        systemContent += `\n\n## 知识库上下文\n`;
        systemContent += `（已选择「仅向量召回」，但本次召回无结果或 KGM 检索不可用，已回退为全量条目注入。）\n`;
      } else {
        systemContent += `\n\n## 知识库上下文\n`;
      }
      knowledgeItems.forEach(item => {
        systemContent += `\n### ${item.name} (${item.type})\n${item.content}\n`;
      });
      systemContent += rules;
    }
  }

  messages.push({ role: 'system', content: systemContent });

  // ── 2. L2 人格层 - 角色定义 ──
  if (personalityPrompt) {
    messages.push({
      role: 'system',
      content: `## 角色定义\n\n${personalityPrompt}`
    });
  }

  // ── 3. L3 策略层 - 思考框架、分析方法 ──
  if (selectedPrompts && selectedPrompts.length > 0) {
    const strategyPrompts = selectedPrompts.filter(p => p.layer === 'L3');
    if (strategyPrompts.length > 0) {
      const strategyContent = strategyPrompts
        .filter(p => p.systemPrompt)
        .map(p => `### ${p.name}\n${p.systemPrompt}`)
        .join('\n\n');
      if (strategyContent) {
        messages.push({
          role: 'system',
          content: `## 分析策略\n\n${strategyContent}`
        });
      }
    }
  }

  // ── 4. L4 执行层 - 具体技能操作 ──
  if (selectedSkillIds && selectedSkillIds.length > 0 && skillConfigs) {
    for (const skillId of selectedSkillIds) {
      const skillConfig = skillConfigs.get(skillId);
      if (skillConfig) {
        let skillContent = `## 技能: ${skillConfig.name || skillId}\n\n${skillConfig.systemPrompt || ''}`;
        
        // 注入技能的工具元数据
        if (skillConfig.tools && skillConfig.tools.length > 0) {
          skillContent += `\n\n### 可用工具\n`;
          skillContent += `该技能提供以下工具供您调用：\n\n`;
          
          skillConfig.tools.forEach((tool: any) => {
            skillContent += `#### ${tool.name}\n`;
            skillContent += `**描述**: ${tool.description || '无描述'}\n`;
            skillContent += `**参数**: \n`;
            
            if (tool.parameters && tool.parameters.properties) {
              Object.entries(tool.parameters.properties).forEach(([paramName, paramDef]: [string, any]) => {
                skillContent += `  - ${paramName}: ${paramDef.description || paramDef.type || '未定义'}`;
                if (tool.parameters.required?.includes(paramName)) {
                  skillContent += ' (必填)';
                }
                skillContent += `\n`;
              });
            } else {
              skillContent += `  - 无参数\n`;
            }
            skillContent += `\n`;
          });
        }
        
        messages.push({
          role: 'system',
          content: skillContent
        });
      }
    }
  }

  // ── 5. L5 上下文层 - 信息召回与整合 ──
  if (selectedPrompts && selectedPrompts.length > 0) {
    const contextPrompts = selectedPrompts.filter(p => p.layer === 'L5');
    if (contextPrompts.length > 0) {
      const contextContent = contextPrompts
        .filter(p => p.systemPrompt)
        .map(p => `### ${p.name}\n${p.systemPrompt}`)
        .join('\n\n');
      if (contextContent) {
        messages.push({
          role: 'system',
          content: `## 上下文约束\n\n${contextContent}`
        });
      }
    }
  }

  // ── 6. 快捷提示（非层级化的自定义提示）──
  if (selectedPrompts && selectedPrompts.length > 0) {
    const customPrompts = selectedPrompts.filter(p => p.layer !== 'L3' && p.layer !== 'L5');
    if (customPrompts.length > 0) {
      const customContent = customPrompts
        .filter(p => p.systemPrompt)
        .map(p => `### ${p.name}\n${p.systemPrompt}`)
        .join('\n\n');
      if (customContent) {
        messages.push({
          role: 'system',
          content: `## 自定义提示\n\n${customContent}`
        });
      }
    }
  }

  // ── 4. 注入项目指令（完整内容，但添加长度限制）──
  if (instructions.length > 0) {
    // P1-3: 截断过长的指令内容
    const MAX_INSTRUCTIONS_CHARS = 3000;
    let instructionsContent = instructions
      .map(i => `### ${i.name}\n${i.content}`)
      .join('\n\n');
    
    if (instructionsContent.length > MAX_INSTRUCTIONS_CHARS) {
      instructionsContent = truncateText(instructionsContent, MAX_INSTRUCTIONS_CHARS, '## 项目特定指令（部分）\n\n');
    }
    
    messages.push({
      role: 'system',
      content: `## 项目特定指令\n\n${instructionsContent}`
    });
    totalChars += instructionsContent.length;
  }

  // ── 5. 注入历史消息（最近10条，过滤掉 thinking 状态消息，添加长度限制）──
  if (recentMessages.length > 0) {
    // P1-3: 限制历史消息数量和单条消息长度
    const validHistory = recentMessages
      .filter(msg => !msg.isThinking && msg.content && msg.content !== 'Yueli AI思考中...')
      .slice(-MAX_HISTORY_MESSAGES);
    
    // P1-3: 限制单条历史消息长度
    const MAX_HISTORY_MSG_CHARS = 1500;

    validHistory.forEach(msg => {
      // P1-3: 过滤掉 tool call 执行状态消息（仅保留文本内容）
      let content = msg.content
        .replace(/\[工具调用\].*?\n/g, '')
        .replace(/\[工具结果\].*?\n/g, '')
        .trim();

      // P1-3: 截断过长的历史消息
      if (content && content.length > MAX_HISTORY_MSG_CHARS) {
        content = truncateText(content, MAX_HISTORY_MSG_CHARS);
      }

      if (!content && !msg.toolCalls && !msg.toolCallId) {
        return;
      }

      if (msg.role === 'user') {
        messages.push({ role: 'user', content });
      } else if (msg.role === 'assistant') {
        const assistantMsg: any = { role: 'assistant' };
        if (content) assistantMsg.content = content;
        if (msg.toolCalls && msg.toolCalls.length > 0) {
          assistantMsg.tool_calls = msg.toolCalls;
        }
        if (msg.reasoningContent) {
          assistantMsg.reasoning_content = msg.reasoningContent;
        }
        messages.push(assistantMsg);
      } else if (msg.role === 'tool' && msg.toolCallId) {
        messages.push({
          role: 'tool',
          tool_call_id: msg.toolCallId,
          content: content || ''
        });
      }
    });
  }

  // ── 6. 当前用户输入 ──
  messages.push({ role: 'user', content: userInput });

  return messages;
};

// 样式组件
const Container = styled.div`
  display: flex;
  height: 100vh;
  overflow: hidden;
  background-color: #f5f5f5;
`;

const Sidebar = styled.div`
  width: 240px;
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
  overflow-y: auto;
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
  overflow: visible;
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

  // P2-5: 调试：打印 localStorage 中的所有数据（仅开发环境）
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    
    console.log('🔍 调试：localStorage 中的主题数据');
    const savedTopics = localStorage.getItem('yueli_topics');
    if (savedTopics) {
      const parsedTopics = JSON.parse(savedTopics);
      console.log('📚 所有主题:', parsedTopics);
      parsedTopics.forEach((topic: any, index: number) => {
        console.log(`📑 主题 ${index + 1}:`, {
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
        console.log('⏳ 等待数据加载完成...');
      }
      return;
    }
    
    const params = new URLSearchParams(window.location.search);
    const sessionParam = params.get('session');
    
    if (sessionParam) {
      const sessionsSnap = sessionsRef.current;
      const topicsSnap = topicsRef.current;

      if (import.meta.env.DEV) {
        console.log('🔍 处理URL参数 session:', sessionParam);
        console.log('📊 当前数据:', { sessionsCount: sessionsSnap.length, topicsCount: topicsSnap.length });
      }
      
      // 首先尝试将其作为会话ID加载
      const session = sessionsSnap.find(s => s.id === sessionParam);
      if (session) {
        if (import.meta.env.DEV) {
          console.log('✅ 找到会话，自动加载:', session);
        }
        // 直接从 localStorage 读取 sessionMessages，避免引用未定义的 state
        const savedSessionMessages = localStorage.getItem('yueli_session_messages');
        const allSessionMessages = savedSessionMessages ? JSON.parse(savedSessionMessages) : {};
        const sessionData = allSessionMessages[session.id] || [];
        if (import.meta.env.DEV) {
          console.log('📥 URL 加载会话消息:', {
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
          setSessionMessages(prev => ({ ...prev, [session.id]: sessionData }));
          setMessages(sessionData);
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
          console.log('✅ 找到主题，自动加载:', topic);
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
      console.warn('内存中未找到对应的会话或主题，尝试从 localStorage 重新加载');
      const savedSessions = localStorage.getItem('yueli_sessions');
      if (savedSessions) {
        const allSessions = JSON.parse(savedSessions);
        const savedSession = allSessions.find((s: any) => s.id === sessionParam);
        if (savedSession) {
          console.log('✅ 从 localStorage 找到会话:', savedSession);
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
            setSessionMessages(prev => ({ ...prev, [savedSession.id]: sessionData }));
            setMessages(sessionData);
            setInput('');
            setFiles([]);
            setError(null);
          }, 0);
          return;
        }
      }
      
      console.warn('未找到对应的会话或主题');
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
  const [isSkillsExpanded, setIsSkillsExpanded] = useState(true);

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
  const [selectedKnowledge, setSelectedKnowledge] = useState<string[]>([]);
  const [isThinking, setIsThinking] = useState<boolean>(false);
  const [selectedModel, setSelectedModel] = useState<string>('qwen3.5:latest');
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
        console.log('元数据:', session);
        console.log('消息数量:', msgs.length);
        msgs.forEach((m, i) => {
          const errInfo = m.error
            ? `${m.error.code || ''} ${m.error.message || ''}`.trim()
            : '';
          console.log(
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
        console.log(`已删除 session ${sessionId}，请刷新页面`);
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
      }
    };
    if (import.meta.env.DEV) {
      console.log('🛠 debugYueli ready - 可用方法: sessions() / session(id) / storage() / deleteSession(id)');
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
          console.error('Failed to persist session messages:', e);
        }
        return next;
      });
    },
    []
  );
  const [selectedProvider, setSelectedProvider] = useState<'kgm' | 'ollama'>(() => {
    const saved = localStorage.getItem('selectedProvider');
    return (saved as 'kgm' | 'ollama') || 'kgm';
  });

  const modelOptions = useMemo(() => {
    const cloudConfig = safeParseCloudConfig(localStorage.getItem('cloudProviders'));
    return resolveModelOptionsFromCloudConfig(cloudConfig).options;
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

  // 主题相关状态
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('theme');
    return (saved as 'light' | 'dark') || 'light';
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const accumulatedContentRef = useRef<string>('');
  const lastIncrementalSaveAtRef = useRef<number>(0);

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
          displayContent = renderedOutput.content;
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
          model: selectedModel,
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
                model: selectedModel,
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
      console.warn('编排器处理失败，继续使用原始输入');
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
      console.warn('获取工具定义失败');
    }
    
    // 构建完整的 messages 并走 LLM；与发送消息一致写入 localStorage（yueli_session_messages）
    try {
      const selectedPromptObjects = prompts.filter(p => selectedPrompts.includes(p.id));
      const apiMessages = buildMessages(
        processedContent,
        selectedTopic,
        newMessages,
        topicInstructions,
        knowledgeItems,
        activeSkillIds,
        skillConfigs,
        selectedPromptObjects,
        personalityPrompt,
        processedContent,
        knowledgeRagContext
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
        console.debug('🚀 当前激活的技能:', currentActiveSkills);
      }

      const editSendRes = await sendOllamaMessageWithMessages(
        selectedModel,
        apiMessages,
        (data) => {
          if (debugStream) {
            console.debug('📡 收到消息回调数据:', {
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
      const editInvocationMetrics = extractInvocationMetrics(editSendRes);

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
              content: streamStateRef.current.accumulatedContent || '',
              isThinking: false,
              reasoningContent: streamStateRef.current.reasoningContent || undefined,
              toolCallRecords: streamStateRef.current.toolCallRecords,
              thinkingRecords: streamStateRef.current.thinkingRecords,
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
          content: streamStateRef.current.accumulatedContent || '',
          sender: 'Yueli Copilot',
          time: new Date().toLocaleTimeString(),
          isThinking: false,
          provider: selectedProvider,
          model: selectedModel,
          reasoningContent: streamStateRef.current.reasoningContent || undefined,
          toolCallRecords: streamStateRef.current.toolCallRecords,
          thinkingRecords: streamStateRef.current.thinkingRecords,
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
          model: selectedModel,
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

    const userMessage: Message = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      role: 'user',
      content: content.trim(),
      sender: 'User',
      time: new Date().toLocaleTimeString(),
      isThinking: false,
      status: 'sending'
    };

    // 确保有会话ID
    const sessionId = currentSessionId || `session-${Date.now()}`;
    setCurrentSessionId(sessionId);

    // 更新当前会话的消息
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setFiles([]);
    setIsLoading(true);
    setError(null);

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
        model: selectedModel,
        skillsUsed: currentActiveSkills,
        finalStatus: 'in_progress' as const,
        executionTimeline: []
      };
      setMessages(prev => [...prev, botMessage]);

      // 用于防抖的定时器
      let updateTimer: ReturnType<typeof setTimeout> | null = null;
      // thinkingContentRef / reasoningContentRef / sourcesRef 已在 try 外声明，便于 catch 复用
      
      // 首先使用编排器处理输入
      let processedContent = content;
      let hasRenderedOutput = false;
      let renderedOutput: RenderedOutput | undefined;

      try {
        const stageTimes = new Map<string, number>();
        const orchestratorResult = await processWithOrchestrator(content, undefined, undefined, undefined, (evt) => {
          const raw = evt.stage || '';
          const [stageRaw, phaseRaw] = raw.split(':');
          const stage = (stageRaw || raw) as any;
          const phase = phaseRaw || '';
          const at = typeof evt.at === 'number' ? evt.at : Date.now();
          const key = `${evt.runId}:${stage}`;

          let durationMs: number | undefined;
          if (phase === 'start') {
            stageTimes.set(key, at);
          } else if (phase === 'end') {
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
            displayContent = renderedOutput.content;
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
      } catch (orchestratorError) {
        console.warn('编排器处理失败，继续使用原始输入');
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
        console.warn('获取工具定义失败');
      }

      // 构建完整的messages数组（修复：注入知识库、完整指令、完整历史、快捷提示systemPrompt）
      const selectedPromptObjects = prompts.filter(p => selectedPrompts.includes(p.id));
      const apiMessages = buildMessages(
        processedContent,
        selectedTopic,
        messages,
        topicInstructions,
        knowledgeItems,
        activeSkillIds,
        skillConfigs,
        selectedPromptObjects,
        personalityPrompt,
        processedContent, // 传递用户输入用于向量召回
        knowledgeRagContext
      );

      userRowForPersistence = {
        ...userMessage,
        metadata: {
          ...(userMessage.metadata || {}),
          user_visible_input: content.trim(),
          llm_expanded_char_count: processedContent.length
        }
      };
      setMessages((prev) =>
        prev.map((m) => (m.id === userMessage.id ? { ...m, metadata: userRowForPersistence.metadata } : m))
      );

      // 预检：缺 apiKey / 推理服务不可达 / KGM 三种路径都没工作 等问题直接告知用户。
      // 注意：前端不替 KGM 决策路由；KGM 的"推理引擎路由 / 模型路由 / 原生推理"由 KGM 自己选。
      try {
        const preflight = await apiService.runChatPreflight(selectedModel);
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
            model: selectedModel,
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
          console.log('✅ 聊天预检通过', preflight.resolved);
        }
      } catch (preflightError) {
        console.warn('聊天预检异常（不阻断主流程）:', preflightError);
      }

      const streamStateRef = { current: createInitialStreamReducerState() };

      const wrappedToolCallHandler = makePermissionAwareToolCallHandler(toolCallHandler);

      // 使用新的API调用方式发送消息（支持 function calling）
      const mainSendRes = await sendOllamaMessageWithMessages(
        selectedModel,
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
              model: selectedModel,
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
        { tools, toolCallHandler: wrappedToolCallHandler, enabledSkillIds: activeSkillIds }
      );
      const mainInvocationMetrics = extractInvocationMetrics(mainSendRes);

      // 确保最终内容被更新
      setMessages(prev => prev.map(msg =>
        msg.id === botMessageIdRef.current ? {
          ...msg,
          content: streamStateRef.current.accumulatedContent,
          isThinking: false,
          reasoningContent: streamStateRef.current.reasoningContent || undefined,
          toolCallRecords: streamStateRef.current.toolCallRecords,
          thinkingRecords: streamStateRef.current.thinkingRecords,
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
        content: streamStateRef.current.accumulatedContent,
        sender: 'Yueli Copilot',
        time: new Date().toLocaleTimeString(),
        isThinking: false,
        provider: selectedProvider,
        model: selectedModel,
        reasoningContent: streamStateRef.current.reasoningContent || undefined,
        toolCallRecords: streamStateRef.current.toolCallRecords,
        thinkingRecords: streamStateRef.current.thinkingRecords,
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

      // 将对话添加到历史会话：占位名「新对话」须在首条消息成功后替换为 AI 标题
      const existingSession = sessions.find(s => s.id === sessionId);
      let sessionName: string;
      let sessionTopicId: string | null = null;
      if (existingSession && !sessionNameNeedsAiTitle(existingSession.name)) {
        sessionName = existingSession.name;
        sessionTopicId = existingSession.topicId || null;
      } else {
        try {
          sessionName = (await apiService.generateTitle(content, selectedModel)).trim();
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
        console.log('💾 会话更新成功:', {
          sessionId,
          sessionName,
          sessionTopicId,
          selectedTopicId: selectedTopic?.id,
          status: sessionStorageService.status
        });
      } else {
        console.error('❌ 会话更新失败');
      }

      // 更新用户消息状态为已发送
      setMessages(prev => prev.map(msg => 
        msg.id === userMessage.id ? { ...msg, status: 'sent' } : msg
      ));

      setIsThinking(false);
  } catch (err: any) {
    const errorText = err?.message || String(err) || '未知错误';
    const errorCode = err?.code || err?.name || '';
    console.error('[handleSendMessage] LLM 调用失败:', { sessionId, errorCode, errorText, err });
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
      `\n\n> 该消息没有完整返回，您可以重新发送，或在浏览器控制台运行 \`debugYueli.session('${sessionId}')\` 查看明细。`;
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
      model: selectedModel,
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
    setIsSearchModalOpen(true);
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
    if (uploadedFiles) {
      const newFiles: ChatFile[] = Array.from(uploadedFiles).map(file => ({
        id: `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: file.name,
        type: file.type,
        size: file.size,
        file
      }));
      setFiles(prev => [...prev, ...newFiles]);
    }
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
    const sessionData = sessionMessages[session.id] || [];
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
    
    console.log('🆕 创建新会话:', {
      sessionId,
      selectedTopicId: selectedTopic?.id,
      topicId: newSession.topicId,
      timestamp: newSession.lastActive,
      date: new Date(newSession.lastActive).toLocaleString()
    });
    
    // 使用 SessionStorageService 保存新会话（带验证和缓存机制）
    const success = sessionStorageService.add(newSession);
    
    if (success) {
      console.log('✅ 会话创建成功:', {
        sessionId,
        status: sessionStorageService.status
      });
      // 更新 React 状态
      setSessions(sessionStorageService.getAll());
    } else {
      console.error('❌ 会话创建失败，请检查存储');
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
    console.log('📍 点击历史会话:', {
      session,
      selectedTopic: selectedTopic,
      currentSessionId
    });
    setSelectedTopic(null);
    setCurrentSessionId(session.id);
    setViewMode('chat');
    // 确保从sessionMessages中加载消息
    const sessionData = sessionMessages[session.id] || [];
    console.log('📥 从 sessionMessages 加载消息:', {
      sessionId: session.id,
      sessionDataLength: sessionData.length
    });
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
      setIsInstructionModalOpen(true);
    }
  };

  const handleAddInstruction = () => {
    setIsAddInstructionModalOpen(true);
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
            width: '40px',
            height: '40px',
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
        width: isSidebarExpanded ? '240px' : '0', 
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
                  onClick={() => setIsHistorySearchModalOpen(true)}
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
                  onClick={() => setIsCreateTopicModalOpen(true)}
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
                  onClick={() => setIsCreateTopicModalOpen(true)}
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
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
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
                  <ActionButton onClick={() => setIsApiConfigModalOpen(true)} style={{ borderRadius: '8px' }}>
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
                    onClick={() => setIsPromptConfigModalOpen(true)}
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
              
              {/* 输入区域 - 参考openwebui设计 */}
              <div style={{
                display: 'flex',
                alignItems: 'flex-end',
                gap: '0px',
                marginBottom: '8px',
                borderRadius: '8px',
                backgroundColor: '#ffffff',
                boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
                minHeight: '60px'
              }}>
                {/* 左侧 Tools 菜单（替代固定底部下拉） */}
                <div style={{ position: 'relative', zIndex: 9999 }}>
                  <Popover
                    open={isAddMenuOpen}
                    onOpenChange={setIsAddMenuOpen}
                    placement="topLeft"
                    trigger="click"
                    content={
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
                        }}
                        onUploadFiles={() => {
                          fileInputRef.current?.click();
                          setIsAddMenuOpen(false);
                        }}
                        knowledgeItemCount={knowledgeItems.length}
                        selectedPromptsCount={selectedPrompts.length}
                        lastToolRoundSkillIds={lastToolRoundSkillIds}
                        onOpenKnowledgeSelection={() => {
                          setIsKnowledgeModalOpen(true);
                          setIsAddMenuOpen(false);
                        }}
                        onOpenPromptTemplates={() => {
                          setIsPromptConfigModalOpen(true);
                          setIsAddMenuOpen(false);
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
                    }
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setToolsMenuDefaultTab('attachments');
                        setIsAddMenuOpen(!isAddMenuOpen);
                      }}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#666',
                        padding: '12px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'flex-end',
                        justifyContent: 'center',
                        fontSize: '16px',
                        borderRadius: '8px 0 0 8px',
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
                
                {/* 文本输入框 */}
                <div style={{ flex: 1, minHeight: '100px' }}>
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
                    placeholder="输入消息... (支持粘贴图片)"
                    disabled={isLoading}
                    rows={5}
                    style={{
                      width: '100%',
                      padding: '8px 12px',
                      border: 'none',
                      resize: 'none',
                      minHeight: '100px',
                      fontSize: '14px',
                      outline: 'none',
                      fontFamily: 'inherit',
                      lineHeight: '1.6',
                      backgroundColor: 'transparent',
                      color: '#333'
                    }}
                  />
                </div>
                
                {/* 右侧模型按钮与发送按钮 */}
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', padding: '0 12px 0 0' }}>
                  <button
                    type="button"
                    onClick={() => {
                      setToolsMenuDefaultTab('skills');
                      setIsAddMenuOpen(true);
                    }}
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
                    onClick={() => {
                      setToolsMenuDefaultTab('model');
                      setIsAddMenuOpen(true);
                    }}
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
                    title="切换模型/Provider"
                  >
                    {selectedProvider}:{selectedModel}
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
            width: '40px',
            height: '40px',
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
        width: isSkillsExpanded ? '240px' : '0', 
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
                  onClick={() => setIsSearchModalOpen(true)}
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
                    console.log('📁 文件读取完成:', filesWithContent.map(f => ({
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
                  
                  console.log('📦 准备保存新主题:', {
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
                      console.log('🗑️ 会话删除成功:', menuItem.id);
                    } else {
                      console.error('❌ 会话删除失败');
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
                      console.error('删除会话消息失败:', error);
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
                  setIsRenameModalOpen(true);
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
                    console.error('导出JSON失败:', error);
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
                    console.error('导出Markdown失败:', error);
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
                onClick={() => {
                  // 分享功能 - 生成会话URL
                  try {
                    // 构建当前页面URL并添加会话ID参数
                    const url = new URL(window.location.href);
                    url.searchParams.set('session', menuItem.id);
                    const shareUrl = url.toString();
                    
                    navigator.clipboard.writeText(shareUrl);
                    alert('会话链接已复制到剪贴板！');
                  } catch (error) {
                    console.error('分享失败:', error);
                    alert('复制链接失败，请手动复制。');
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
                  setIsDeleteConfirmOpen(true);
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
                        console.error('安装技能失败:', error);
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
                      console.log('正在发现技能...');
                      const discoveredSkills = await skillInstaller.discoverSkillsFromUrl(skillUrl);
                      
                      if (discoveredSkills.length === 0) {
                        alert('未发现可安装的技能');
                        return;
                      }
                      
                      console.log(`发现 ${discoveredSkills.length} 个技能`);
                      
                      // 步骤 2: 安装并测试每个发现的技能（这里简单取第一个）
                      const skillToInstall = discoveredSkills[0];
                      console.log('正在安装技能:', skillToInstall.name);
                      
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
                      console.error('安装技能失败:', error);
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
