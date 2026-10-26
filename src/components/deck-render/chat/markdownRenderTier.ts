export type MarkdownRenderTier = 'light' | 'heavy';

/** 决定是否启用 rehype-raw/Mermaid/LaTeX 等重物路径前的粗粒度检测 */
export function proseMarkdownRenderTier(markdownSlice: string, opts?: { streamingTail?: boolean }): MarkdownRenderTier {
  const md = markdownSlice ?? '';
  if (!md.trim()) return 'light';

  if (opts?.streamingTail) return 'light';

  if (/```/.test(md)) return 'heavy';
  if (/<[A-Za-z!?/]/.test(md)) return 'heavy';
  if (/\\[\[(]/.test(md)) return 'heavy';

  return 'light';
}
