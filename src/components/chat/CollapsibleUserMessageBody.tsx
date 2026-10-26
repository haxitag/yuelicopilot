import React, { useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { DownOutlined, UpOutlined } from '@ant-design/icons';

import { prepareChatMessageContent } from '../deck-render/chat/messageContentPipeline';
import { parseChatContent } from '../deck-render/chat/parseChatContent';
import { RenderOutput } from '../deck-render/render/RenderOutput';

export const USER_MESSAGE_COLLAPSE_LINE_LIMIT = 10;

/** 按换行计行；无换行的超长粘贴按约 72 字估算一行，避免单行巨墙无法折叠 */
export function countUserMessageDisplayLines(text: string): number {
  if (!text) return 0;
  const parts = text.split(/\r?\n/);
  let lines = 0;
  for (const part of parts) {
    const len = part.length;
    lines += Math.max(1, Math.ceil(len / 72));
  }
  return lines;
}

export function shouldCollapseUserMessage(
  text: string,
  limit = USER_MESSAGE_COLLAPSE_LINE_LIMIT
): boolean {
  return countUserMessageDisplayLines(text) > limit;
}

const UserMessageShell = styled.div<{ $isThinking: boolean }>`
  padding: 5px 8px;
  border-radius: 4px;
  background-color: #e6f7ff;
  color: #333;
  font-size: 13px;
  line-height: 1.68;
  word-break: break-word;
  overflow-wrap: anywhere;
  min-width: 0;
  max-width: 100%;
  position: relative;
  ${(p) =>
    p.$isThinking &&
    `
    font-style: italic;
    color: #666;
    max-height: 40px;
    overflow: hidden;
  `}
`;

const CollapsibleBody = styled.div<{ $collapsed: boolean; $lineLimit: number }>`
  position: relative;
  white-space: normal;
  word-break: break-word;
  overflow-wrap: anywhere;
  overflow: hidden;
  max-height: ${(p) => (p.$collapsed ? `calc(1.4em * ${p.$lineLimit})` : 'none')};
`;

/** 与 Deck / 助手同源：Markdown 排版由 RenderOutput/ReactMarkdown 接管，外层不再 pre-wrap */
const UserMessageMarkdownDeck = styled.div`
  white-space: normal;
  word-break: break-word;
  overflow-wrap: anywhere;
  min-width: 0;
`;

const CollapseFade = styled.div`
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 2.2em;
  pointer-events: none;
  background: linear-gradient(to bottom, rgba(230, 247, 255, 0), #e6f7ff 85%);
`;

const ToggleRow = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 6px;
  padding: 0;
  border: none;
  background: transparent;
  color: #1890ff;
  font-size: 12px;
  cursor: pointer;
  line-height: 1.68;

  &:hover {
    color: #40a9ff;
    text-decoration: underline;
  }
`;

interface CollapsibleUserMessageBodyProps {
  content: string;
  isThinking?: boolean;
  lineLimit?: number;
}

const CollapsibleUserMessageBody: React.FC<CollapsibleUserMessageBodyProps> = ({
  content,
  isThinking = false,
  lineLimit = USER_MESSAGE_COLLAPSE_LINE_LIMIT
}) => {
  const preparedDisplay = useMemo(() => prepareChatMessageContent(content), [content]);
  const renderBlocks = useMemo(() => parseChatContent(preparedDisplay), [preparedDisplay]);
  const lineCount = useMemo(() => countUserMessageDisplayLines(preparedDisplay), [preparedDisplay]);
  const collapsible = useMemo(
    () => !isThinking && shouldCollapseUserMessage(preparedDisplay, lineLimit),
    [preparedDisplay, isThinking, lineLimit]
  );
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    setExpanded(false);
  }, [content]);

  const markdownBody = (
    <UserMessageMarkdownDeck>
      <RenderOutput content={renderBlocks} />
    </UserMessageMarkdownDeck>
  );

  if (!collapsible) {
    return (
      <UserMessageShell $isThinking={isThinking}>
        {markdownBody}
      </UserMessageShell>
    );
  }

  const collapsed = !expanded;

  return (
    <UserMessageShell $isThinking={isThinking}>
      <CollapsibleBody $collapsed={collapsed} $lineLimit={lineLimit} aria-expanded={!collapsed}>
        {markdownBody}
        {collapsed ? <CollapseFade aria-hidden /> : null}
      </CollapsibleBody>
      <ToggleRow type="button" onClick={() => setExpanded((v) => !v)}>
        {expanded ? (
          <>
            <UpOutlined style={{ fontSize: 11 }} />
            收起
          </>
        ) : (
          <>
            <DownOutlined style={{ fontSize: 11 }} />
            展开全文（共 {lineCount} 行）
          </>
        )}
      </ToggleRow>
    </UserMessageShell>
  );
};

export default CollapsibleUserMessageBody;
