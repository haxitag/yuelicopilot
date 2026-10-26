import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';
import type { Root } from 'mdast';
import type { RenderContent } from '../render/RenderOutput';
import { proseMarkdownRenderTier } from './markdownRenderTier';

const proseMathParser = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath, {
    /** 避免金额等单 `$` 被误收成行内公式 */
    singleDollarTextMath: false,
  });

function positionOffsets(pos?: { start: { offset?: number }; end: { offset?: number } } | null): {
  start: number;
  end: number;
} | null {
  const s = pos?.start.offset;
  const e = pos?.end.offset;
  if (s === undefined || e === undefined) return null;
  return { start: s, end: e };
}

/**
 * Dollar / `$$` 类数学：remark-math 解析 prose，按区间切出 `latex` 与 `markdown`。
 * **不含 `\(` `\[`**：此类仍由 `latexContentLegacy` 处理。
 */
export function splitProseByRemarkMathMdast(source: string): RenderContent[] | null {
  if (!source.trim()) return [];

  let tree: Root;
  try {
    tree = proseMathParser.parse(source) as Root;
  } catch {
    return null;
  }

  const intervals: { start: number; end: number; displayMode: boolean; value: string }[] = [];
  let broken = false;

  visit(tree, ['math', 'inlineMath'], (node) => {
    const mathNode = node as { type: string; value?: string; position?: { start: { offset?: number }; end: { offset?: number } } };
    const off = positionOffsets(mathNode.position);
    if (!off) {
      broken = true;
      return;
    }
    intervals.push({
      start: off.start,
      end: off.end,
      displayMode: mathNode.type === 'math',
      value: typeof mathNode.value === 'string' ? mathNode.value : '',
    });
  });

  if (broken) return null;

  if (intervals.length === 0) {
    return [{ type: 'markdown', value: source, markdownTier: proseMarkdownRenderTier(source) }];
  }

  intervals.sort((a, b) => a.start - b.start || a.end - b.end);

  for (let i = 1; i < intervals.length; i++) {
    if (intervals[i].start < intervals[i - 1].end) return null;
  }

  const blocks: RenderContent[] = [];
  let cursor = 0;

  for (const m of intervals) {
    if (m.start < cursor) return null;
    if (m.start > cursor) {
      const slice = source.slice(cursor, m.start);
      if (slice.trim()) {
        blocks.push({
          type: 'markdown',
          value: slice,
          markdownTier: proseMarkdownRenderTier(slice),
        });
      }
    }
    blocks.push({
      type: 'latex',
      value: (m.value ?? '').trim(),
      displayMode: m.displayMode,
    });
    cursor = m.end;
  }

  if (cursor < source.length) {
    const slice = source.slice(cursor);
    if (slice.trim()) {
      blocks.push({
        type: 'markdown',
        value: slice,
        markdownTier: proseMarkdownRenderTier(slice),
      });
    }
  }

  return blocks;
}
