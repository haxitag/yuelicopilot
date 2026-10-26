import React from 'react';
import ParsedChatBodyRenderer from '../chat/ParsedChatBodyRenderer';
import { prepareChatMessageContent } from '../chat/messageContentPipeline';

export interface MarkdownRendererProps {
  content: string;
  isLive?: boolean;
  className?: string;
  onMermaidRendered?: (svg: string) => void;
}

/**
 * MarkdownRenderer 兼容适配器：统一走 prepareChatMessageContent + ChatMessageRenderer。
 */
const MarkdownRendererAdapter: React.FC<MarkdownRendererProps> = ({
  content,
  isLive = false,
  className,
}) => {
  return (
    <ParsedChatBodyRenderer
      content={prepareChatMessageContent(content)}
      isStreaming={isLive}
      className={className}
    />
  );
};

export default MarkdownRendererAdapter;
