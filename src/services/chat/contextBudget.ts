import { readKnowledgeScopeMode } from './KnowledgeScope';
import type { Message } from '../../types';

export interface ContextBudgetSnapshot {
  estimatedChars: number;
  estimatedTokens: number;
  historyMessageCount: number;
  knowledgeScope: string;
  maxTotalChars: number;
  maxHistoryMessages: number;
  utilizationPct: number;
}

const MAX_TOTAL_CHARS = 30_000;
const MAX_HISTORY_MESSAGES = 10;

export function estimateContextBudget(
  recentMessages: Message[],
  systemChars = 0
): ContextBudgetSnapshot {
  const knowledgeScope = readKnowledgeScopeMode();
  const history = recentMessages
    .filter((m) => m.content && !m.isThinking)
    .slice(-MAX_HISTORY_MESSAGES);
  const historyChars = history.reduce((n, m) => n + String(m.content).length, 0);
  const estimatedChars = systemChars + historyChars;
  return {
    estimatedChars,
    estimatedTokens: Math.ceil(estimatedChars / 4),
    historyMessageCount: history.length,
    knowledgeScope,
    maxTotalChars: MAX_TOTAL_CHARS,
    maxHistoryMessages: MAX_HISTORY_MESSAGES,
    utilizationPct: Math.min(100, Math.round((estimatedChars / MAX_TOTAL_CHARS) * 100))
  };
}
