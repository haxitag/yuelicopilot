/**
 * gfm-normalize 包 re-export（单测 / 工具用）。聊天展示与落盘已改 deck prepare，勿再用于 UI。
 */
export {
  coerceAssistantContentToString,
  normalizeGfmLite as normalizeAssistantMarkdownForRender,
  normalizeGfmLite,
  normalizeGfmLiteFromRaw,
  fixAtxHeadingSpacing,
  normalizeJammedMarkdownBlockBreaks,
  normalizeMarkdownListsAndPseudoBullets,
  splitPackedEmojiDashListLines,
  splitStuckOpeningFenceFirstLine,
  unwrapOuterMarkdownWrapperFence,
  closeOrphanOpeningFenceBeforeAtxHeading,
  prepareChatMessageForDisplay,
} from '@haxitag/markdown-gfm-normalize';
