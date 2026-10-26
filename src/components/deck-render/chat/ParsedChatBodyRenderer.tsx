import React from 'react';
import { RenderOutput } from '../render/RenderOutput';
import { parseChatContent } from './parseChatContent';

export interface ParsedChatBodyRendererProps {
  content: string;
  isStreaming?: boolean;
  className?: string;
}

/** 聊天正文分块渲染（yueli-deck 同源，不含 URL 卡片） */
const ParsedChatBodyRenderer: React.FC<ParsedChatBodyRendererProps> = ({
  content,
  isStreaming = false,
  className,
}) => {
  const contentBlocks = React.useMemo(
    () => parseChatContent(content, { isStreaming }),
    [content, isStreaming],
  );

  if (!contentBlocks.length) {
    return null;
  }

  return (
    <div className={`chat-message-content ${className || ''}`} style={{ maxWidth: '100%', wordWrap: 'break-word' }}>
      <RenderOutput content={contentBlocks} />
      {isStreaming && (
        <div style={{ display: 'inline-block', marginLeft: '4px' }}>
          <div
            style={{
              display: 'inline-block',
              animation: 'blink 1s infinite',
              fontWeight: 'bold',
              color: '#007bff',
            }}
          >
            |
          </div>
        </div>
      )}
    </div>
  );
};

export default ParsedChatBodyRenderer;
