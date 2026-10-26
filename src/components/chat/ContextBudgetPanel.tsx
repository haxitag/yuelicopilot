import React, { useMemo } from 'react';
import { Progress, Typography } from 'antd';
import { estimateContextBudget } from '../../services/chat/contextBudget';
import type { Message } from '../../types';

export interface ContextBudgetPanelProps {
  recentMessages: Message[];
  compact?: boolean;
}

const ContextBudgetPanel: React.FC<ContextBudgetPanelProps> = ({
  recentMessages,
  compact = true
}) => {
  const snap = useMemo(() => estimateContextBudget(recentMessages), [recentMessages]);
  if (compact) {
    return (
      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
        上下文约 {snap.estimatedTokens} tokens（{snap.utilizationPct}% / 历史{' '}
        {snap.historyMessageCount} 条 · 知识库 {snap.knowledgeScope}）
      </Typography.Text>
    );
  }
  return (
    <div style={{ padding: '8px 0' }}>
      <Typography.Text style={{ fontSize: 12 }}>上下文预算</Typography.Text>
      <Progress percent={snap.utilizationPct} size="small" status={snap.utilizationPct > 90 ? 'exception' : 'normal'} />
      <Typography.Text type="secondary" style={{ fontSize: 11 }}>
        {snap.estimatedTokens} tokens · 历史 {snap.historyMessageCount}/{snap.maxHistoryMessages}
      </Typography.Text>
    </div>
  );
};

export default ContextBudgetPanel;
