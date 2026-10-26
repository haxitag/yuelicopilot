/**
 * 聊天 Markdown 展示预处理：deck 轻量 prepare + 可选 gfm-normalize 工具。
 */
export {
  prepareChatMessageContent,
  splitThinkingMarkdownSegments,
  looksLikeBareMermaidDiagram,
  normalizeJammedMarkdownBlockBreaks,
  normalizeGluedAtxHeadersWithoutSpace,
  normalizeInlineGfmTableJams,
  normalizeDoublePipeTableRows,
  normalizeAggressiveKgmBlockBreaks,
  normalizeInlineHyphenListMarkers,
  normalizeEditorStyleMarkdown,
  ensureBlankLineBeforeAtxHeaders,
  ensureBlankLineBeforeMarkdownLists,
  type ThinkingMarkdownSegment,
} from '../../components/deck-render/chat/messageContentPipeline';

export { coerceAssistantContentToString } from '@haxitag/markdown-gfm-normalize';
