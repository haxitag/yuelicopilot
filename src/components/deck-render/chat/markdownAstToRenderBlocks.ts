import type { Code, Html, Root } from 'mdast';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { RenderContent } from '../render/RenderOutput';
import { parseLaTeXContent } from '../render/latex';
import { MERMAID_LANGUAGE_KEYS, syntaxHighlighterLanguageFromFenceInfo } from './fenceLanguageUtils';
import { proseMarkdownRenderTier } from './markdownRenderTier';

const markdownParser = unified().use(remarkParse).use(remarkGfm);

function safeOffsets(root: Root): boolean {
  for (const node of root.children) {
    const p = node.position;
    const o = p?.start?.offset;
    const oe = p?.end?.offset;
    if (o === undefined || oe === undefined) return false;
  }
  return true;
}

/** 是否为 mdast 块状 html（GFM/HTML 注入段落） */
function isHtmlLikeBlock(n: { type: string }): n is Html {
  return n.type === 'html';
}

/** LLM / 编辑器误写：围栏 info 为非 ASCII（如中文说明），正文仅为空或零碎反引号；按代码块导出会误判，改回 Markdown 整块由 react-markdown 再解析 */
function codeNodeShouldPassThroughAsMarkdown(langRaw: string | null | undefined, value: string): boolean {
  const info = (langRaw ?? '').trim();
  if (!info || !/[^\u0000-\u007f]/.test(info)) return false;
  const v = value.trim();
  if (!v) return true;
  return /^[`\s]+$/.test(v);
}

function rawSliceMaybe(node: Code, source: string): string | undefined {
  const s = node.position?.start.offset;
  const e = node.position?.end.offset;
  if (s === undefined || e === undefined) return undefined;
  return source.slice(s, e);
}

function codeNodeToRenderBlock(
  langRaw: string | null | undefined,
  value: string,
  source: string,
  node: Code,
): RenderContent | null {
  const slice = rawSliceMaybe(node, source);

  const infoRaw = (langRaw ?? '').trim();
  const languageKey = infoRaw.toLowerCase();
  const codeTrimmed = value.trimEnd();
  const vTrim = codeTrimmed.trim();

  /** 纯反引号/空白占位：常为 LLM 错写或未闭合残骸，整块回交 Markdown（不走高亮代码块出口） */
  if (vTrim && /^[`\s]+$/.test(vTrim) && slice !== undefined && /```/.test(slice)) {
    return { type: 'markdown', value: slice, markdownTier: 'heavy' };
  }

  if (codeNodeShouldPassThroughAsMarkdown(langRaw, value)) {
    if (slice !== undefined && slice.trim()) {
      return { type: 'markdown', value: slice, markdownTier: 'heavy' };
    }
  }

  if (!codeTrimmed.trim()) {
    const fenceLang = langRaw ?? '';
    return { type: 'markdown', value: `\`\`\`${fenceLang}\n\`\`\``, markdownTier: 'heavy' as const };
  }

  const isMermaidByLanguage = MERMAID_LANGUAGE_KEYS.includes(languageKey as (typeof MERMAID_LANGUAGE_KEYS)[number]);

  const isMermaidByContent =
    !infoRaw &&
    (codeTrimmed.includes('graph ') ||
      codeTrimmed.includes('flowchart ') ||
      codeTrimmed.includes('sequenceDiagram') ||
      codeTrimmed.includes('classDiagram') ||
      codeTrimmed.includes('stateDiagram') ||
      codeTrimmed.includes('erDiagram') ||
      codeTrimmed.includes('gantt') ||
      codeTrimmed.includes('pie') ||
      codeTrimmed.includes('journey') ||
      codeTrimmed.includes('gitGraph') ||
      codeTrimmed.includes('mindmap') ||
      codeTrimmed.includes('quadrantChart') ||
      codeTrimmed.includes('timeline') ||
      codeTrimmed.includes('xychart-beta') ||
      codeTrimmed.includes('heatmap') ||
      codeTrimmed.includes('zenuml') ||
      codeTrimmed.includes('sankey'));

  if (isMermaidByLanguage || isMermaidByContent) {
    if (codeTrimmed.length > 0) {
      return { type: 'mermaid', value: codeTrimmed };
    }
    return { type: 'code', value: codeTrimmed, language: 'text' };
  }

  if (languageKey === 'json') {
    try {
      return { type: 'json', value: JSON.parse(codeTrimmed) };
    } catch {
      return { type: 'code', value: codeTrimmed, language: 'text' };
    }
  }
  if (languageKey === 'html') {
    return { type: 'html', value: codeTrimmed };
  }
  if (languageKey === 'svg') {
    return { type: 'svg', value: codeTrimmed };
  }
  if (languageKey === 'csv') {
    return { type: 'csv', value: codeTrimmed };
  }
  if (languageKey === 'markdown') {
    return {
      type: 'markdown',
      value: codeTrimmed,
      markdownTier: proseMarkdownRenderTier(codeTrimmed),
    };
  }

  const hl = syntaxHighlighterLanguageFromFenceInfo(infoRaw);
  return { type: 'code', value: codeTrimmed, language: hl };
}

function flushProseSlice(source: string, start: number | null, end: number | null, blocks: RenderContent[]) {
  if (start === null || end === null || end <= start) return;
  const slice = source.slice(start, end);
  if (!slice.trim()) return;
  const latexBlocks = parseLaTeXContent(slice.trim());
  for (const b of latexBlocks) {
    if (b.type === 'markdown' && typeof b.value === 'string') {
      blocks.push({
        ...b,
        markdownTier: proseMarkdownRenderTier(b.value),
      });
    } else {
      blocks.push(b as RenderContent);
    }
  }
}

/**
 * 将「稳定区」Markdown 源码解析为分块：`code`/`html` 由 mdast；其余按 position 拼接为 prose 再走 LaTeX 管道。
 */
export function stableMarkdownAstToBlocks(source: string): RenderContent[] | null {
  if (!source) return [];

  let tree: Root;
  try {
    tree = markdownParser.parse(source) as Root;
  } catch {
    return null;
  }

  if (!tree.children.length) {
    return source.trim()
      ? [{ type: 'markdown', value: source.trim(), markdownTier: proseMarkdownRenderTier(source) }]
      : [];
  }

  if (!safeOffsets(tree)) {
    return null;
  }

  const blocks: RenderContent[] = [];
  let proseStart: number | null = null;
  let proseEnd: number | null = null;

  const bumpProse = (node: { position?: { start: { offset?: number }; end: { offset?: number } } }) => {
    const s = node.position?.start.offset;
    const e = node.position?.end.offset;
    if (s === undefined || e === undefined) return;
    if (proseStart === null) proseStart = s;
    proseEnd = e;
  };

  for (const child of tree.children) {
    if (child.type === 'code') {
      flushProseSlice(source, proseStart, proseEnd, blocks);
      proseStart = null;
      proseEnd = null;
      const b = codeNodeToRenderBlock(child.lang, child.value ?? '', source, child);
      if (b) blocks.push(b);
      continue;
    }

    if (isHtmlLikeBlock(child)) {
      flushProseSlice(source, proseStart, proseEnd, blocks);
      proseStart = null;
      proseEnd = null;
      blocks.push({ type: 'html', value: child.value ?? '', markdownTier: 'heavy' });
      continue;
    }

    bumpProse(child);
  }

  flushProseSlice(source, proseStart, proseEnd, blocks);
  return blocks;
}
