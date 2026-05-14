import React, { useState } from 'react';
import styled from 'styled-components';
import { Message, InferenceResult, ToolCallRecord, ThinkingRecord } from '../types';
import InferenceResultRenderer from './InferenceResultRenderer';
import MarkdownRenderer from './MarkdownRenderer';
import { HtmlRenderer, JsonRenderer } from './TemplateOutputRenderer';
import { CopyOutlined, CheckOutlined, EditOutlined, SendOutlined, CloseOutlined } from '@ant-design/icons';
import ExecutionTimelineView from './chat/ExecutionTimeline';

interface ChatMessageRendererProps {
  message: Message;
  onEdit?: (messageId: string, newContent: string) => void;
  theme?: 'light' | 'dark';
  topicInfo?: {
    id: string;
    name: string;
    fileCount: number;
    files: Array<{name: string; contentLength: number}>;
  } | null;
}

const MessageContainer = styled.div<{ $isBot: boolean }>`
  display: flex;
  flex-direction: ${props => props.$isBot ? 'flex-start' : 'flex-end'};
  margin-bottom: 5px;
`;

const MessageWrapper = styled.div<{ $isBot: boolean }>`
  max-width: ${props => props.$isBot ? '90%' : '75%'};
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const MessageHeader = styled.div<{ $isBot: boolean }>`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1px;
`;

const MessageSender = styled.div<{ $isBot: boolean }>`
  font-size: 12px;
  font-weight: 600;
  color: ${props => props.$isBot ? '#1890ff' : '#666666'};
`;

const MessageActions = styled.div<{ $isBot: boolean }>`
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.2s;
  
  ${MessageContainer}:hover & {
    opacity: 1;
  }
`;

const ActionButton = styled.button<{ $isBot?: boolean }>`
  padding: 4px 8px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #666;
  cursor: pointer;
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 4px;
  transition: all 0.2s;
  
  &:hover {
    background: ${props => props.$isBot ? '#e6f7ff' : '#f0f0f0'};
    color: #1890ff;
  }
`;

const MessageContent = styled.div<{ $isBot: boolean, $isThinking: boolean }>`
  padding: 5px 8px;
  border-radius: 4px;
  background-color: ${props => props.$isBot ? '#f5f5f5' : '#e6f7ff'};
  color: ${props => props.$isBot ? '#333333' : '#333333'};
  font-size: 13px;
  line-height: 1.4;
  white-space: pre-wrap;
  word-break: break-word;
  position: relative;
  max-height: ${props => props.$isThinking ? '40px' : 'none'};
  overflow: ${props => props.$isThinking ? 'hidden' : 'visible'};
  ${props => props.$isThinking && `
    font-style: italic;
    color: #666666;
  `}
`;

const EditContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

const EditTextArea = styled.textarea`
  width: 100%;
  min-height: 80px;
  padding: 12px;
  border: 1px solid #d9d9d9;
  border-radius: 8px;
  font-size: 14px;
  line-height: 1.5;
  resize: vertical;
  font-family: inherit;
  
  &:focus {
    outline: none;
    border-color: #1890ff;
    box-shadow: 0 0 0 2px rgba(24, 144, 255, 0.1);
  }
`;

const EditActions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
`;

const InferenceResultsContainer = styled.div`
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const MessageTime = styled.div<{ $isBot: boolean }>`
  font-size: 11px;
  color: #999;
  text-align: ${props => props.$isBot ? 'left' : 'right'};
  margin-top: 2px;
`;

const SourcesContainer = styled.div<{ $isBot: boolean }>`
  margin-top: 8px;
  padding: 8px 12px;
  background-color: ${props => props.$isBot ? '#f8f9fa' : '#fff3e6'};
  border-radius: 6px;
  border-left: 3px solid #1890ff;
`;

const SourcesLabel = styled.span`
  font-size: 12px;
  font-weight: 600;
  color: #666;
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
`;

const SourceItem = styled.a<{ $type?: string }>`
  display: inline-flex;
  align-items: center;
  font-size: 12px;
  color: ${props => props.$type === 'url' ? '#1890ff' : '#555'};
  background-color: #fff;
  padding: 4px 8px;
  border-radius: 4px;
  margin-right: 8px;
  margin-bottom: 6px;
  border: 1px solid #e0e0e0;
  text-decoration: none;
  transition: all 0.2s;
  cursor: ${props => props.$type === 'url' ? 'pointer' : 'default'};
  
  &:hover {
    border-color: #1890ff;
    background-color: #f0f7ff;
    color: #1890ff;
  }
`;

const SourceIcon = styled.span`
  margin-right: 6px;
  font-size: 11px;
`;

const SourceType = styled.span`
  font-size: 10px;
  padding: 2px 4px;
  border-radius: 2px;
  margin-left: 6px;
  background-color: #f0f0f0;
  color: #666;
`;

const StatusBadge = styled.span<{ $status: string }>`
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 4px;
  margin-left: 8px;
  
  ${props => {
    switch (props.$status) {
      case 'sending':
        return 'background: #e6f7ff; color: #1890ff;';
      case 'sent':
        return 'background: #f6ffed; color: #52c41a;';
      case 'failed':
        return 'background: #fff2f0; color: #ff4d4f;';
      default:
        return 'background: #f5f5f5; color: #999;';
    }
  }}
`;

// 技能执行日志样式
const ExecutionLogContainer = styled.div<{ $isBot: boolean }>`
  padding: 8px 12px;
  background-color: ${props => props.$isBot ? '#f8f9fa' : '#fff3e6'};
  border-radius: 6px;
  border-left: 3px solid #1890ff;
  margin-bottom: 8px;
  font-size: 13px;
  line-height: 1.5;
`;

const ExecutionLogItem = styled.div`
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid #e9ecef;
  
  &:last-child {
    border-bottom: none;
  }
`;

const LogIcon = styled.span`
  font-size: 16px;
  flex-shrink: 0;
`;

const LogContent = styled.div`
  flex: 1;
`;

const LogTitle = styled.div`
  font-weight: 500;
  color: #333;
  margin-bottom: 2px;
`;

const LogDetails = styled.div`
  font-size: 12px;
  color: #666;
  font-family: monospace;
`;

const LogResult = styled.div`
  font-size: 12px;
  color: #52c41a;
  margin-top: 4px;
`;

const LogError = styled.div`
  font-size: 12px;
  color: #ff4d4f;
  margin-top: 4px;
`;

const FinalStatus = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background-color: #f6ffed;
  color: #52c41a;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
  margin-top: 8px;
`;

const ChatMessageRenderer: React.FC<ChatMessageRendererProps> = ({ 
  message, 
  onEdit,
  theme = 'light',
  topicInfo
}) => {
  const isBot = message.role === 'bot';
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState(message.content);
  const [filesExpanded, setFilesExpanded] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('复制失败:', err);
    }
  };

  const handleEdit = () => {
    setEditContent(message.content);
    setIsEditing(true);
  };

  const handleSaveEdit = () => {
    if (onEdit) {
      onEdit(message.id, editContent);
    }
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setEditContent(message.content);
    setIsEditing(false);
  };

  const isHtmlContent = message.content.startsWith('```html') && message.content.endsWith('```');
  const isJsonContent = message.content.startsWith('```json') && message.content.endsWith('```');

  const extractContent = (content: string, type: 'html' | 'json') => {
    const marker = `\`\`\`${type}`;
    return content
      .substring(marker.length, content.length - 3)
      .trim();
  };

  const renderContent = () => {
    if (isHtmlContent) {
      const html = extractContent(message.content, 'html');
      return (
        <div style={{ padding: '12px 0' }}>
          <HtmlRenderer html={html} />
        </div>
      );
    }

    if (isJsonContent) {
      const json = extractContent(message.content, 'json');
      return (
        <div style={{ padding: '12px 0' }}>
          <JsonRenderer json={json} />
        </div>
      );
    }

    if (message.metadata && message.metadata.inferenceResults) {
      const inferenceResults = message.metadata.inferenceResults as InferenceResult[];
      return (
        <>
          {message.content && (
            <MessageContent $isBot={isBot} $isThinking={message.isThinking}>
              <MarkdownRenderer content={message.content} theme={theme} />
            </MessageContent>
          )}
          <InferenceResultsContainer>
            {inferenceResults.map((result, index) => (
              <InferenceResultRenderer key={index} result={result} />
            ))}
          </InferenceResultsContainer>
        </>
      );
    } else {
      return (
        <MessageContent $isBot={isBot} $isThinking={message.isThinking}>
          <MarkdownRenderer content={message.content} theme={theme} />
        </MessageContent>
      );
    }
  };

  const renderStatusBadge = () => {
    if (message.status === 'sending') {
      return <StatusBadge $status="sending">发送中...</StatusBadge>;
    } else if (message.status === 'sent') {
      return <StatusBadge $status="sent">已发送</StatusBadge>;
    } else if (message.status === 'failed') {
      return <StatusBadge $status="failed">发送失败</StatusBadge>;
    }
    return null;
  };

  const renderProviderBadge = () => {
    if (isBot && message.provider && message.model) {
      const providerName = message.provider === 'kgm' ? 'KGM' : 'Ollama';
      return (
        <span style={{
          fontSize: '11px',
          backgroundColor: message.provider === 'kgm' ? '#1890ff' : '#52c41a',
          color: '#fff',
          padding: '2px 6px',
          borderRadius: '4px',
          marginLeft: '8px'
        }}>
          {providerName} - {message.model}
        </span>
      );
    }
    return null;
  };

  const renderSources = () => {
    if (isBot && message.sources && message.sources.length > 0) {
      const getIconForType = (type?: string) => {
        switch (type) {
          case 'url':
            return '🔗';
          case 'file':
            return '📄';
          case 'database':
            return '🗄️';
          case 'api':
            return '🔌';
          case 'reference':
            return '📚';
          default:
            return '📎';
        }
      };

      return (
        <SourcesContainer $isBot={isBot}>
          <SourcesLabel>
            <span>📚</span>
            <span>参考来源</span>
            <span style={{ marginLeft: 'auto', fontSize: '11px', color: '#999' }}>
              {message.sources.length} 个来源
            </span>
          </SourcesLabel>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {message.sources.map((source, index) => (
              <SourceItem 
                key={index} 
                $type={source.type}
                href={source.url}
                target={source.url ? '_blank' : undefined}
                rel={source.url ? 'noopener noreferrer' : undefined}
                onClick={(e) => {
                  if (!source.url) {
                    e.preventDefault();
                  }
                }}
              >
                <SourceIcon>{getIconForType(source.type)}</SourceIcon>
                <span>{source.name}</span>
                {source.type && <SourceType>{source.type}</SourceType>}
              </SourceItem>
            ))}
          </div>
        </SourcesContainer>
      );
    }
    return null;
  };

  const renderExecutionLog = () => {
    if (!isBot) return null;

    // 默认关闭重型调试日志，避免流式渲染时把浏览器主线程/DevTools 拖死
    const debugExecutionLog =
      typeof window !== 'undefined' &&
      window.localStorage?.getItem('yueli_debug_execution_log') === '1';
    
    const hasToolCalls = message.toolCallRecords && message.toolCallRecords.length > 0;
    const hasThinking = message.thinkingRecords && message.thinkingRecords.length > 0;
    const hasSkills = message.skillsUsed && message.skillsUsed.length > 0;
    const hasFinalStatus = message.finalStatus;
    const hasTimeline =
      Array.isArray(message.executionTimeline) && message.executionTimeline.length > 0;
    const hasMetrics = Boolean(
      message.metrics &&
        (typeof message.metrics.providerHttpRounds === 'number' ||
          typeof message.metrics.totalLatencyMs === 'number' ||
          typeof message.metrics.promptTokens === 'number' ||
          typeof message.metrics.completionTokens === 'number' ||
          typeof message.metrics.totalTokens === 'number')
    );
    const hasPermissionAudit =
      Array.isArray(message.permissionAuditTrail) && message.permissionAuditTrail.length > 0;

    if (debugExecutionLog) {
      console.debug('📋 消息执行日志数据:', {
        toolCallRecordsCount: message.toolCallRecords?.length ?? 0,
        thinkingRecordsCount: message.thinkingRecords?.length ?? 0,
        skillsUsed: message.skillsUsed,
        finalStatus: message.finalStatus,
        hasToolCalls,
        hasThinking,
        hasSkills,
        hasFinalStatus,
        hasMetrics,
        hasPermissionAudit,
        hasTimeline
      });
    }

    // 如果没有任何可显示的内容，返回null
    if (
      !hasToolCalls &&
      !hasThinking &&
      !hasSkills &&
      !hasFinalStatus &&
      !hasTimeline &&
      !hasMetrics &&
      !hasPermissionAudit
    ) {
      return null;
    }
    
    return (
      <ExecutionLogContainer $isBot={isBot}>
        {/* 技能列表 */}
        {hasSkills && (
          <ExecutionLogItem>
            <LogIcon>⚡</LogIcon>
            <LogContent>
              <LogTitle>使用技能</LogTitle>
              <LogDetails>{message.skillsUsed!.join(', ')}</LogDetails>
            </LogContent>
          </ExecutionLogItem>
        )}
        
        {/* 思考记录 */}
        {hasThinking && message.thinkingRecords!.map((record, index) => (
          <ExecutionLogItem key={`thinking-${index}`}>
            <LogIcon>💭</LogIcon>
            <LogContent>
              <LogTitle>思考过程</LogTitle>
              <LogDetails>{record.content}</LogDetails>
            </LogContent>
          </ExecutionLogItem>
        ))}
        
        {/* 工具调用记录（卡片化，支持状态/耗时/结果折叠） */}
        {hasToolCalls && message.toolCallRecords!.map((record, index) => {
          const statusText =
            record.status === 'running'
              ? '进行中'
              : record.status === 'success'
                ? '成功'
                : record.status === 'error'
                  ? '失败'
                  : record.result
                    ? '成功'
                    : record.error
                      ? '失败'
                      : '未知';
          const durationText =
            typeof record.durationMs === 'number'
              ? ` · ${Math.round(record.durationMs)}ms`
              : '';
          const hasDetail = Boolean(record.result || record.error);

          return (
            <ExecutionLogItem key={`tool-${index}`}>
              <LogIcon>🔧</LogIcon>
              <LogContent>
                <LogTitle>
                  调用工具: {record.name}
                  <span style={{ marginLeft: 8, fontSize: 12, color: record.status === 'error' ? '#f5222d' : record.status === 'success' ? '#52c41a' : '#999' }}>
                    {statusText}{durationText}
                  </span>
                </LogTitle>
                <LogDetails>参数: {JSON.stringify(record.args)}</LogDetails>
                {hasDetail && (
                  <details style={{ marginTop: 6 }}>
                    <summary style={{ cursor: 'pointer', color: '#1890ff', fontSize: 12 }}>
                      查看结果
                    </summary>
                    {record.result && <LogResult style={{ whiteSpace: 'pre-wrap' }}>{record.result}</LogResult>}
                    {record.error && <LogError style={{ whiteSpace: 'pre-wrap' }}>{record.error}</LogError>}
                  </details>
                )}
              </LogContent>
            </ExecutionLogItem>
          );
        })}

        {/* 本轮推理调用指标 */}
        {hasMetrics && (
          <ExecutionLogItem>
            <LogIcon>📊</LogIcon>
            <LogContent>
              <LogTitle>本轮指标</LogTitle>
              <LogDetails style={{ fontSize: 12 }}>
                {(() => {
                  const m = message.metrics!;
                  const parts: string[] = [];
                  if (typeof m.providerHttpRounds === 'number') {
                    parts.push(`Provider 往返 ${m.providerHttpRounds} 次`);
                  }
                  if (typeof m.totalLatencyMs === 'number') {
                    parts.push(`总耗时 ${Math.round(m.totalLatencyMs)} ms`);
                  }
                  if (
                    typeof m.promptTokens === 'number' ||
                    typeof m.completionTokens === 'number' ||
                    typeof m.totalTokens === 'number'
                  ) {
                    let tok = 'Tokens';
                    if (typeof m.promptTokens === 'number') tok += ` 提示 ${m.promptTokens}`;
                    if (typeof m.completionTokens === 'number') tok += ` 生成 ${m.completionTokens}`;
                    if (typeof m.totalTokens === 'number') tok += ` 合计 ${m.totalTokens}`;
                    tok += '（多轮工具时为各次 completion 累加）';
                    parts.push(tok);
                  }
                  return parts.join(' · ');
                })()}
              </LogDetails>
            </LogContent>
          </ExecutionLogItem>
        )}

        {/* 权限弹窗决策摘要（已写入审计） */}
        {hasPermissionAudit && (
          <ExecutionLogItem>
            <LogIcon>🔐</LogIcon>
            <LogContent>
              <LogTitle>权限决策</LogTitle>
              {message.permissionAuditTrail!.map((e, idx) => {
                const label =
                  e.decision === 'allow_once'
                    ? '允许一次'
                    : e.decision === 'allow_always'
                      ? '总是允许'
                      : '拒绝';
                return (
                  <LogDetails key={`perm-${idx}-${e.at}`} style={{ fontSize: 12, marginTop: idx ? 6 : 2 }}>
                    <div>
                      <strong>{e.skillId}</strong> · {label}
                    </div>
                    <div style={{ color: '#888', marginTop: 2 }}>{e.permissions.join(', ')}</div>
                  </LogDetails>
                );
              })}
            </LogContent>
          </ExecutionLogItem>
        )}

        {/* 最终状态 */}
        {message.finalStatus && (
          <FinalStatus>
            {message.finalStatus === 'done' ? '✓' : message.finalStatus === 'error' ? '✗' : '⏳'}
            {message.finalStatus === 'done' ? '任务完成' : message.finalStatus === 'error' ? '任务失败' : '进行中'}
          </FinalStatus>
        )}

        {/* 执行计划时间线（来自 orchestrator pipeline） */}
        {hasTimeline && <ExecutionTimelineView items={message.executionTimeline!} />}
      </ExecutionLogContainer>
    );
  };

  const renderTopicDebugInfo = () => {
    // 只在第一条用户消息且存在主题信息时显示
    if (!topicInfo || !isBot) return null;
    
    const hasUnloadedFiles = topicInfo.files.some(f => f.contentLength === 0);
    
    return (
      <ExecutionLogContainer $isBot={isBot} style={{ marginBottom: '12px' }}>
        <ExecutionLogItem>
          <LogIcon>📦</LogIcon>
          <LogContent>
            <LogTitle>当前主题上下文</LogTitle>
            <LogDetails>
              <div>ID: {topicInfo.id}</div>
              <div>名称: {topicInfo.name}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>文件数: {topicInfo.fileCount}</span>
                {hasUnloadedFiles && (
                  <span style={{ color: '#ff9800', fontSize: '12px' }}>
                    ⚠️ {topicInfo.files.filter(f => f.contentLength === 0).length} 个文件未加载
                  </span>
                )}
              </div>
              
              {/* 文件列表 - 支持折叠 */}
              {topicInfo.files.length > 0 && (
                <div style={{ marginTop: '4px' }}>
                  <button
                    onClick={() => setFilesExpanded(!filesExpanded)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#1890ff',
                      cursor: 'pointer',
                      fontSize: '12px',
                      padding: '0',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    <span>{filesExpanded ? '▼' : '▶'}</span>
                    <span>{filesExpanded ? '收起文件列表' : `展开文件列表 (${topicInfo.files.length} 个)`}</span>
                  </button>
                  
                  {filesExpanded && (
                    <div style={{ 
                      marginTop: '8px',
                      maxHeight: '200px',
                      overflowY: 'auto',
                      padding: '8px',
                      background: '#fafafa',
                      borderRadius: '4px',
                      border: '1px solid #e0e0e0'
                    }}>
                      {/* 一行显示模式 */}
                      <div style={{ 
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '6px'
                      }}>
                        {topicInfo.files.map((f, idx) => (
                          <span 
                            key={idx} 
                            style={{ 
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '2px 6px',
                              background: '#fff',
                              border: `1px solid ${f.contentLength === 0 ? '#ffccc7' : '#e0e0e0'}`,
                              borderRadius: '3px',
                              fontSize: '11px',
                              maxWidth: '200px',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap'
                            }}
                            title={`${f.name}\n${f.contentLength > 0 ? `${f.contentLength} 字符` : '内容未加载'}`}
                          >
                            {f.contentLength === 0 ? '⚠️' : '✓'}
                            {f.name}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </LogDetails>
          </LogContent>
        </ExecutionLogItem>
      </ExecutionLogContainer>
    );
  };

  return (
    <MessageContainer $isBot={isBot}>
      <MessageWrapper $isBot={isBot}>
        <MessageHeader $isBot={isBot}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <MessageSender $isBot={isBot}>
              {isBot ? message.sender : 'You'}
            </MessageSender>
            {renderStatusBadge()}
            {renderProviderBadge()}
          </div>
          {!isBot && !isEditing && (
            <MessageActions $isBot={isBot}>
              <ActionButton $isBot={isBot} onClick={handleCopy} title="复制">
                {copied ? <CheckOutlined /> : <CopyOutlined />}
              </ActionButton>
              <ActionButton $isBot={isBot} onClick={handleEdit} title="编辑">
                <EditOutlined />
              </ActionButton>
            </MessageActions>
          )}
          {isBot && (
            <MessageActions $isBot={isBot}>
              <ActionButton $isBot={isBot} onClick={handleCopy} title="复制">
                {copied ? <CheckOutlined /> : <CopyOutlined />}
              </ActionButton>
            </MessageActions>
          )}
        </MessageHeader>
        
        {/* 技能调用、工具执行、思考和状态信息 */}
      {!isEditing && renderExecutionLog()}
      
      {/* 主题调试信息 - 显示当前主题上下文 */}
      {!isEditing && renderTopicDebugInfo()}
      
      {isEditing ? (
        <EditContainer>
          <EditTextArea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            autoFocus
          />
          <EditActions>
            <ActionButton onClick={handleCancelEdit}>
              <CloseOutlined /> 取消
            </ActionButton>
            <ActionButton onClick={handleSaveEdit} style={{ background: '#1890ff', color: '#fff' }}>
              <SendOutlined /> 发送
            </ActionButton>
          </EditActions>
        </EditContainer>
      ) : (
        renderContent()
      )}
      
      {renderSources()}
        
        <MessageTime $isBot={isBot}>
          {message.time}
        </MessageTime>
      </MessageWrapper>
    </MessageContainer>
  );
};

export default ChatMessageRenderer;