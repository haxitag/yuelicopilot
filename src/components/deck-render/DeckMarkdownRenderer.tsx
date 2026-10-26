import React from 'react';
import MarkdownRendererAdapter from './markdown/MarkdownRendererAdapter';

export interface DeckMarkdownRendererProps {
  content: string;
  isLive?: boolean;
  className?: string;
  /** theme 保留 API 兼容；deck 链当前为 light 样式 */
  theme?: 'light' | 'dark';
}

/**
 * Copilot 聊天正文渲染：yueli-deck prepareChatMessageContent + 分块 RenderOutput。
 */
const DeckMarkdownRenderer: React.FC<DeckMarkdownRendererProps> = ({
  content,
  isLive = false,
  className,
}) => (
  <MarkdownRendererAdapter content={content} isLive={isLive} className={className} />
);

export default DeckMarkdownRenderer;
