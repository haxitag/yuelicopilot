import type { RenderContent } from '../render/RenderOutput';
import { proseMarkdownRenderTier } from './markdownRenderTier';
import { stableMarkdownAstToBlocks } from './markdownAstToRenderBlocks';
import { parseChatContentLegacyRegex } from './parseChatContentLegacy';
import { applyStorageNoiseSanitization } from './storageNoiseSanitizer';
import { applyStreamingTailRepairs, partitionAtUnclosedFence } from './streamingFencePartition';
import { repairFenceClosingLineTrailingTicks } from './fenceCloserRepair';

export type ParseChatContentOptions = {
  /** 流式输出：未闭合围栏后缀单独轻量渲染，稳定前缀走 mdast */
  isStreaming?: boolean;
};

export { syntaxHighlighterLanguageFromFenceInfo } from './fenceLanguageUtils';

/** @deprecated 仅测试/正则兜底迁移对照；主路径围栏边界由 mdast */
export { LEGACY_FENCED_CODE_BLOCK_RE as FENCED_CODE_BLOCK_RE } from './parseChatContentLegacy';

function normalizeMarkdownTiers(blocks: RenderContent[]): RenderContent[] {
  return blocks.map((b) => {
    if (b.type === 'markdown' && typeof b.value === 'string' && b.markdownTier === undefined) {
      return { ...b, markdownTier: proseMarkdownRenderTier(b.value) };
    }
    return b;
  });
}

/**
 * 聊天内容分块：稳定区由 remark mdast 解析（单一结构真相源）；
 * 流式时由围栏状态机切出 volatile 尾；AST 失败时回落正则兜底。
 */
export function parseChatContent(content: string, options?: ParseChatContentOptions): RenderContent[] {
  if (!content?.trim()) return [];

  const sanitized = applyStorageNoiseSanitization(content);
  const fencedRepaired = repairFenceClosingLineTrailingTicks(sanitized);
  const { stable, volatileTail, inIncompleteFence } = options?.isStreaming
    ? partitionAtUnclosedFence(fencedRepaired)
    : { stable: fencedRepaired, volatileTail: '', inIncompleteFence: false };

  const blocks: RenderContent[] = [];

  if (stable.trim()) {
    const astBlocks = stableMarkdownAstToBlocks(stable);
    if (astBlocks !== null) {
      blocks.push(...normalizeMarkdownTiers(astBlocks));
    } else {
      blocks.push(...parseChatContentLegacyRegex(stable));
    }
  }

  if (volatileTail.trim()) {
    const tail = applyStreamingTailRepairs(volatileTail);
    blocks.push({
      type: 'markdown',
      value: tail,
      markdownTier: proseMarkdownRenderTier(tail, { streamingTail: true }),
      streamingPartialFence: inIncompleteFence,
    });
  }

  if (!blocks.length && fencedRepaired.trim()) {
    const astBlocks = stableMarkdownAstToBlocks(fencedRepaired.trim());
    if (astBlocks !== null) {
      return normalizeMarkdownTiers(astBlocks);
    }
    return parseChatContentLegacyRegex(fencedRepaired.trim());
  }

  return blocks;
}
