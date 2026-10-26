/**
 * 聊天上下文组装：知识库、主题文件、技能 system、历史与当前用户输入。
 */
import { devWarn } from '../../utils/devConsole';
import { appendMarkdownOutputRules } from './markdownOutputRules';
import {
  readKnowledgeScopeMode,
  DEFAULT_KNOWLEDGE_SCOPE_MODE,
  type KnowledgeScopeMode
} from './KnowledgeScope';
import { userInputHasAttachmentPayload } from '../../utils/chatFilePromptText';
import PromptRegistry from '../PromptRegistry';
import { vectorRecallService } from '../VectorRecall';
import type { Message } from '../../types';

const SYSTEM_CORE_FALLBACK =
  '你是 Yueli Copilot 助手。若看到本段说明 PromptRegistry 未正确加载 system-core。请到「管理中心 → Prompt 管理」检查「核心系统配置」；事实性、模型身份与 Skills/Hub 等说明以该处配置及仓库根目录《工作台使用与配置指南》为准，勿臆造厂商或未文档化步骤。';

function getSystemPrompt(): string {
  try {
    const promptRegistry = PromptRegistry.getInstance();
    const systemCorePrompt = promptRegistry.getPrompt('system-core');
    const text = systemCorePrompt?.systemPrompt?.trim();
    if (text) return text;
    return SYSTEM_CORE_FALLBACK;
  } catch (e) {
    devWarn('[ContextAssembler] 获取系统prompt失败，使用兜底文案', e);
    return SYSTEM_CORE_FALLBACK;
  }
}

/**
 * 构建完整的 API messages 数组
 */
export function buildChatMessages(
  userInput: string,
  selectedTopic: any,
  recentMessages: Message[],
  instructions: any[],
  knowledgeItems?: Array<{ id: string; name: string; content: string; type: string }>,
  selectedSkillIds?: string[],
  skillConfigs?: Map<string, any>,
  selectedPrompts?: any[],
  personalityPrompt?: string,
  userQuery?: string,
  knowledgeRagContext?: string,
  buildOpts?: { excludeMessageIds?: string[]; topicFusionContext?: string }
): any[] {
  const skipHistoryForAttachment = userInputHasAttachmentPayload(userInput);
  const MAX_TOTAL_CHARS = 30000;
  const MAX_HISTORY_MESSAGES = 10;

  const estimateTokens = (text: string): number => Math.ceil((text || '').length / 4);

  const truncateText = (text: string, maxChars: number, prefix: string = ''): string => {
    if (!text || text.length <= maxChars) return text;
    const truncated = text.substring(0, maxChars);
    return `${prefix}${truncated}\n\n[内容已被截断，原长度约 ${estimateTokens(text)} tokens]`;
  };

  const messages: any[] = [];
  let totalChars = 0;

  let systemContent = appendMarkdownOutputRules(getSystemPrompt());

  if (selectedTopic) {
    systemContent += `\n\n## 当前项目主题\n`;
    systemContent += `名称: ${selectedTopic.name}\n`;
    if (selectedTopic.description) systemContent += `描述: ${selectedTopic.description}\n`;
    if (selectedTopic.workspaceRoot) {
      systemContent += `本机工作区: ${selectedTopic.workspaceRoot}\n`;
      if (selectedTopic.workspaceLastScanAt) {
        systemContent += `工作区已索引文件数: ${selectedTopic.workspaceIndexedCount ?? 0}\n`;
      } else {
        systemContent += `（本机目录尚未执行「索引本机目录」，请在项目主题中扫描）\n`;
      }
    }

    const topicFusionContext = buildOpts?.topicFusionContext?.trim();
    const useWorkspaceFusion = Boolean(selectedTopic.workspaceLastScanAt && topicFusionContext);

    if (useWorkspaceFusion && topicFusionContext) {
      systemContent += `\n### 本机工作区召回（服务端 RAG + 脚注）\n`;
      systemContent += `${topicFusionContext}\n`;
      systemContent += `\n> 回答请引用 [L#]/[D#]/[M#] 脚注；本机目录内容优先于联网来源。\n`;
    }

    const hasFilesWithContent = selectedTopic.files?.some(
      (f: any) => f.content && f.content.trim().length > 0
    );

    if (!useWorkspaceFusion && hasFilesWithContent && userQuery) {
      const filesForRecall = selectedTopic.files
        .filter((f: any) => f.content && f.content.trim().length > 0)
        .map((f: any) => ({
          name: f.name,
          content: f.content
        }));

      vectorRecallService.indexSegments(filesForRecall, selectedTopic?.id);
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
    } else if (!useWorkspaceFusion && selectedTopic.files && selectedTopic.files.length > 0) {
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

    systemContent += `\n\n## 重要指示\n`;
    systemContent += `1. 你的所有回答必须严格基于上面提供的项目主题上下文（含本机工作区召回与手动附加文件）\n`;
    systemContent += `2. 如果项目文件中有定义或说明，请优先使用项目文件中的内容\n`;
    systemContent += `3. 当用户询问产品定义、产品信息时，直接使用项目文件中的内容\n`;
    systemContent += `4. 不要编造或使用与项目文件内容不符的信息\n`;
    systemContent += `5. 如果项目文件中有事实信息，请始终遵循这些事实\n`;
  }

  let knowledgeScope: KnowledgeScopeMode = DEFAULT_KNOWLEDGE_SCOPE_MODE;
  try {
    knowledgeScope = readKnowledgeScopeMode();
  } catch {
    knowledgeScope = DEFAULT_KNOWLEDGE_SCOPE_MODE;
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
      knowledgeItems.forEach((item) => {
        systemContent += `\n### ${item.name} (${item.type})\n${item.content}\n`;
      });
      systemContent += rules;
    }
  }

  messages.push({ role: 'system', content: systemContent });

  if (personalityPrompt) {
    messages.push({
      role: 'system',
      content: `## 角色定义\n\n${personalityPrompt}`
    });
  }

  if (selectedPrompts && selectedPrompts.length > 0) {
    const strategyPrompts = selectedPrompts.filter((p) => p.layer === 'L3');
    if (strategyPrompts.length > 0) {
      const strategyContent = strategyPrompts
        .filter((p) => p.systemPrompt)
        .map((p) => `### ${p.name}\n${p.systemPrompt}`)
        .join('\n\n');
      if (strategyContent) {
        messages.push({
          role: 'system',
          content: `## 分析策略\n\n${strategyContent}`
        });
      }
    }
  }

  if (selectedSkillIds && selectedSkillIds.length > 0 && skillConfigs) {
    for (const skillId of selectedSkillIds) {
      const skillConfig = skillConfigs.get(skillId);
      if (skillConfig) {
        let skillContent = `## 技能: ${skillConfig.name || skillId}\n\n${skillConfig.systemPrompt || ''}`;

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

  if (selectedPrompts && selectedPrompts.length > 0) {
    const contextPrompts = selectedPrompts.filter((p) => p.layer === 'L5');
    if (contextPrompts.length > 0) {
      const contextContent = contextPrompts
        .filter((p) => p.systemPrompt)
        .map((p) => `### ${p.name}\n${p.systemPrompt}`)
        .join('\n\n');
      if (contextContent) {
        messages.push({
          role: 'system',
          content: `## 上下文约束\n\n${contextContent}`
        });
      }
    }
  }

  if (selectedPrompts && selectedPrompts.length > 0) {
    const customPrompts = selectedPrompts.filter((p) => p.layer !== 'L3' && p.layer !== 'L5');
    if (customPrompts.length > 0) {
      const customContent = customPrompts
        .filter((p) => p.systemPrompt)
        .map((p) => `### ${p.name}\n${p.systemPrompt}`)
        .join('\n\n');
      if (customContent) {
        messages.push({
          role: 'system',
          content: `## 自定义提示\n\n${customContent}`
        });
      }
    }
  }

  if (instructions.length > 0) {
    const MAX_INSTRUCTIONS_CHARS = 3000;
    let instructionsContent = instructions.map((i) => `### ${i.name}\n${i.content}`).join('\n\n');

    if (instructionsContent.length > MAX_INSTRUCTIONS_CHARS) {
      instructionsContent = truncateText(
        instructionsContent,
        MAX_INSTRUCTIONS_CHARS,
        '## 项目特定指令（部分）\n\n'
      );
    }

    messages.push({
      role: 'system',
      content: `## 项目特定指令\n\n${instructionsContent}`
    });
    totalChars += instructionsContent.length;
  }

  if (!skipHistoryForAttachment && recentMessages.length > 0) {
    const excludeIds = new Set(buildOpts?.excludeMessageIds ?? []);
    const validHistory = recentMessages
      .filter((msg) => !excludeIds.has(msg.id))
      .filter((msg) => !msg.isThinking && msg.content && msg.content !== 'Yueli AI思考中...')
      .slice(-MAX_HISTORY_MESSAGES);

    const MAX_HISTORY_MSG_CHARS = 1500;

    validHistory.forEach((msg) => {
      let content = msg.content
        .replace(/\[工具调用\].*?\n/g, '')
        .replace(/\[工具结果\].*?\n/g, '')
        .trim();

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

  messages.push({ role: 'user', content: userInput });

  void totalChars;
  return messages;
}
