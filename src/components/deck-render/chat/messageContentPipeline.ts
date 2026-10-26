/**
 * 统一聊天/分析 Markdown 正文的预处理（群聊、Copilot、智能检索等共用），
 * 再交给 ContentRenderer → ChatMessageRenderer 做分块与 Mermaid/LaTeX 渲染。
 */
import { devLog } from '../../../utils/devConsole';
import { isLikelyFenceOpenerAfterBackticks } from './fenceLanguageUtils';

export type ThinkingMarkdownSegment =
  | { type: 'thinking'; text: string }
  | { type: 'body'; text: string };

/**
 * 将 `<thinking>` / `<think>`（含历史误写 `</think>` 闭合）拆成「正文 / 推理」段，供 ContentRenderer 用 `<details>` 折叠展示。
 */
export function splitThinkingMarkdownSegments(raw: string): ThinkingMarkdownSegment[] {
  const re =
    /<(?:redacted_thinking|thinking)>([\s\S]*?)<\/(?:redacted_thinking|thinking)>|<think>([\s\S]*?)<\/think>/gi;
  const out: ThinkingMarkdownSegment[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    if (m.index > last) {
      out.push({ type: 'body', text: raw.slice(last, m.index) });
    }
    const inner = String(m[1] ?? m[2] ?? '').trim();
    if (inner.length > 0) {
      out.push({ type: 'thinking', text: inner });
    }
    last = re.lastIndex;
  }
  if (last < raw.length) {
    out.push({ type: 'body', text: raw.slice(last) });
  }
  return out.length > 0 ? out : [{ type: 'body', text: raw }];
}

/**
 * LLM 常把「句号 + 分隔线 + ATX 标题」挤在同一行（如 `。---### 标题`），CommonMark 要求块级标记独占行首，否则无法识别为 hr/标题。
 */
export function normalizeJammedMarkdownBlockBreaks(s: string): string {
  let t = s;
  t = t.replace(/([。！？；」』\.\)\]]])\s*(-{3,})\s*(#{1,6}\s)/g, '$1\n\n$2\n\n$3');
  t = t.replace(/([。！？；」』\.\)\]]])\s*(#{1,6}\s)/g, '$1\n\n$2');
  t = t.replace(/([^\s\n#])(-{3,})(#{1,6}\s)/g, '$1\n\n$2\n\n$3');
  // `---##` / `---###` 有空格
  t = t.replace(/(-{3,})(#{1,6}\s)/g, '$1\n\n$2');
  return t;
}

/**
 * `--##一` / `###结论>`：ATX 后无空格，或标题与 `>` 粘连（截图会话典型坏样本）。
 */
export function normalizeGluedAtxHeadersWithoutSpace(s: string): string {
  let t = s;
  t = t.replace(/([^\n])(-{2,})(#{1,6})(?=[^\s#\n|])/g, '$1\n\n$2\n\n$3 ');
  t = t.replace(/([。！？；.!?」』\)\]]])(#{1,6})(?=[^\s#\n|])/g, '$1\n\n$2 ');
  t = t.replace(/([^\n#\s])(#{1,6})(?=[\u4e00-\u9fffA-Za-z（【])/g, '$1\n\n$2 ');
  t = t.replace(/(#{1,6})\s*([^\s#\n|]+)>/g, '$1 $2\n\n');
  return t;
}

/** `|| 列1 | 列2 ||` 等 KGM 常见伪表格 → 标准 GFM 行 */
export function normalizeDoublePipeTableRows(md: string): string {
  let t = md;
  t = t.replace(/^\s*\|\|(.+?)\|\|\s*$/gm, (_m, inner: string) => {
    const cells = inner.split('|').map((c) => c.trim()).filter(Boolean);
    if (cells.length < 2) return _m;
    return `| ${cells.join(' | ')} |`;
  });
  t = t.replace(/(\|[\s\-:|]+\|)\s*\|\|/g, '$1\n|');
  t = t.replace(/([^\n|])\s*\|\|([^|\n]+\|[^|\n]+)\|\|/g, '$1\n| $2 |\n');
  return t;
}

/** 行内伪表格分隔 `| ---- |`、多列 `|A|B|内容` 拆成多行 */
export function normalizeInlineGfmTableJams(line: string): string {
  let l = line;
  l = l.replace(/\|\|/g, '|');
  l = l.replace(/\s+(\|[-:\s|]{3,}\|)\s*/g, '\n$1\n');
  l = l.replace(/\s+(-{4,}\s*-+)\s*\|/g, '\n|$1|\n');
  if ((l.match(/\|/g) ?? []).length >= 3 && l.length > 40) {
    l = l.replace(/\|(?=[A-Za-z\u4e00-\u9fff])/g, '\n|');
    l = l.replace(/\|\s*\|/g, '|\n|');
  }
  return l;
}

/** 行内是否像 GFM 表格行 */
function isGfmTableLine(line: string): boolean {
  const t = line.trim();
  if (!t.includes('|')) return false;
  if (/^\|?[\s\-:|]+\|?$/.test(t)) return true;
  return (t.match(/\|/g) ?? []).length >= 2;
}

/** 超长单行 / KGM 粘连：在行内拆开 ATX 标题、表格行、有序列表、围栏等 */
export function normalizeAggressiveKgmBlockBreaks(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let inFence = false;

  const needsAggressiveSplit = (line: string): boolean => {
    if (line.length >= 80) return true;
    if (/(-{2,})(#{1,6})/.test(line)) return true;
    if (/[^\n#]#{1,6}\s/.test(line)) return true;
    if ((line.match(/\|/g) ?? []).length >= 3) return true;
    if (/\d+\.\s+\S/.test(line) && !/^\s*\d+\.\s/.test(line)) return true;
    return false;
  };

  const splitJammedLine = (line: string): string[] => {
    let l = line;
    l = l.replace(/(-{2,})(#{1,6})(?=[^\s#\n])/g, '$1\n\n$2 ');
    l = l.replace(/(-{3,})(#{1,6}\s)/g, '$1\n\n$2');
    l = normalizeInlineGfmTableJams(l);
    // `### 1. 标题` 作为整体断行，勿在 `###` 与 `1.` 之间拆开
    l = l.replace(/([。！？；.!?」』\)\]])(#{1,6}\s+\d+\.\s+)/g, '$1\n\n$2');
    l = l.replace(/\s+(#{1,6}\s+\d+\.\s+)/g, '\n\n$1');
    l = l.replace(
      /([^\n#\d])(#{1,6}\s+(?=[A-Za-z\u4e00-\u9fff*（【]))/g,
      '$1\n\n$2',
    );
    // 纯有序列表（非 `### 1.` 标题）：标点后或段末粘连 `…内容 1. 下一步`
    l = l.replace(/([。！？；.!?])\s+(\d+\.\s+(?=\S))/g, '$1\n\n$2');
    l = l.replace(/([：:）\]\u4e00-\u9fff])(\s*)(\d+\.\s+(?=\S))/g, '$1\n\n$3');
    l = l.replace(/([^\n`])\s*(```[\w-]*)/g, '$1\n\n$2');
    // 勿把 ```python / ```ts 等开箱语言行拆成 ``` + 空行 + python，否则 mdast 不认围栏
    l = l.replace(/(```)(\s*)([^\n`])/g, (match, ticks, gaps, next, offset, str) => {
      if (ticks !== '```') return match;
      const afterTicks = str.slice(offset + 3);
      if (isLikelyFenceOpenerAfterBackticks(afterTicks)) return match;
      return `${ticks}\n\n${gaps}${next}`;
    });
    if ((l.match(/\|/g) ?? []).length >= 3) {
      l = normalizeInlineGfmTableJams(l);
    }
    return l.split('\n');
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }

    if (needsAggressiveSplit(line)) {
      out.push(...splitJammedLine(line));
    } else {
      out.push(line);
    }
  }

  return out.join('\n');
}

/** ATX 标题前补空行，便于 remark 识别块级标题 */
export function ensureBlankLineBeforeAtxHeaders(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let inFence = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }

    if (/^#{1,6}\s/.test(trimmed) && out.length > 0) {
      const prev = out[out.length - 1] ?? '';
      const prevTrim = prev.trim();
      if (
        prevTrim !== '' &&
        !/^#{1,6}\s/.test(prevTrim) &&
        prevTrim !== '---' &&
        !isGfmTableLine(prev)
      ) {
        out.push('');
      }
    }
    out.push(line);
  }

  return out.join('\n');
}

const BARE_MERMAID_FIRST_LINE =
  /^\s*(?:graph|flowchart|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|gantt|pie|journey|gitGraph|mindmap|xychart-beta|heatmap|timeline|quadrantChart)\b/i;

/**
 * 模型常把 GFM 列表写成行内 `……。 - **项**` 或 `能力 - **联网**`，CommonMark 要求 `- ` 独占行首。
 * 仅处理「空格 + 单连字符 + 空格」形式，避免误伤 `---` 分隔线、`3-5`、代码中的减号。
 */
export function normalizeInlineHyphenListMarkers(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let inFence = false;

  const listAfterHyphen = '(?=(?:\\*\\*|[\\u4e00-\\u9fffA-Za-z\\u2022\\u25cf（「【]))';

  for (let line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line)) {
      out.push(line);
      continue;
    }

    line = line.replace(
      new RegExp(`([。！？；.!?】」\\)])\\s*-\\s+${listAfterHyphen}`, 'g'),
      '$1\n\n- ',
    );
    line = line.replace(
      new RegExp(`([^\\n\\-])\\s+-\\s+(?!\\s*-)${listAfterHyphen}`, 'g'),
      '$1\n\n- ',
    );

    out.push(line);
  }

  return out.join('\n');
}

/** 段落与列表之间补空行，否则 remark-gfm 可能把列表吃进段落 */
export function ensureBlankLineBeforeMarkdownLists(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let inFence = false;

  const isListLine = (l: string) =>
    /^\s*[-*+]\s+(?:\[[\sxX]\]\s+)?\S/.test(l) || /^\s*\d+\.\s+\S/.test(l);

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }

    if (isListLine(line) && out.length > 0) {
      const prev = out[out.length - 1] ?? '';
      const prevTrim = prev.trim();
      if (prevTrim !== '' && !isListLine(prev) && !/^#{1,6}\s/.test(prevTrim) && prevTrim !== '```') {
        out.push('');
      }
    }
    out.push(line);
  }

  return out.join('\n');
}

/**
 * 编辑器写法兼容：`•` 列表、`--` 二级列表、粘连的任务项、纯 `-------` 分隔线。
 */
export function normalizeEditorStyleMarkdown(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let inFence = false;

  for (let line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('```')) {
      inFence = !inFence;
      out.push(line);
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }

    if (/^•\s+/.test(trimmed)) {
      line = line.replace(/^(\s*)•\s+/, '$1- ');
    }

    if (/^--(?!-)/.test(trimmed)) {
      const body = trimmed.replace(/^--+/, '').trim();
      line = body ? `  - ${body}` : '  -';
    }

    if (/^[-*+]\s*$/.test(trimmed) && trimmed === '*') {
      line = '-';
    }

    if (/^[-]{5,}\s*$/.test(trimmed) && !/^[-]{3}\s*$/.test(trimmed)) {
      line = '---';
    }

    out.push(line);
  }

  let s = out.join('\n');
  s = s.replace(/(\]\s*)(-\s*\[[\sxX]\]\s+)/g, '$1\n$2');
  return s;
}

/** 首条非空行看起来像裸 Mermaid 图定义（且全文未出现围栏），才自动包 ```mermaid；避免误匹配 paragraph 等子串 graph。 */
export function looksLikeBareMermaidDiagram(text: string): boolean {
  if (!text || /```/.test(text)) return false;
  for (const line of text.split(/\r?\n/)) {
    const x = line.trim();
    if (!x) continue;
    return BARE_MERMAID_FIRST_LINE.test(x);
  }
  return false;
}

/**
 * 正文预处理：不再内联展开 `<thinking>` / `<think>`，交由 `splitThinkingMarkdownSegments` + UI 折叠展示。
 */
export function prepareChatMessageContent(raw: string): string {
  if (!raw) return '';

  const result = raw
    .replace(/<\/?planning[^>]*>[\s\S]*?<\/planning>/g, '')
    .replace(/<\/?response_content[^>]*>[\s\S]*?<\/response_content>/g, '')
    .replace(/<message[^>]*>([\s\S]*?)<\/message>/gi, '$1')
    .replace(/<response[^>]*>([\s\S]*?)<\/response>/gi, '$1')
    .replace(/<\/?message[^>]*>/gi, '')
    .replace(/<\/?response[^>]*>/gi, '')
    /* 勿对成对出现的思维标签做「孤儿」剥离；其余标签名允许下划线 */
    .replace(/<(?!(?:redacted_thinking|thinking)\b)([a-zA-Z0-9_-]+)[^>]*>(?!.*<\/\1>)/g, '')
    .replace(/\s*\+\s*$/gm, '')
    .replace(/^\s*\+\s*/gm, '')
    .replace(/\s*\+\s*/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\s+|\s+$/gm, '')
    .trim();

  let normalized = normalizeJammedMarkdownBlockBreaks(result);
  normalized = normalizeDoublePipeTableRows(normalized);
  normalized = normalizeGluedAtxHeadersWithoutSpace(normalized);
  normalized = normalizeAggressiveKgmBlockBreaks(normalized);
  normalized = normalizeEditorStyleMarkdown(normalized);
  normalized = normalizeInlineHyphenListMarkers(normalized);
  normalized = ensureBlankLineBeforeAtxHeaders(normalized);
  normalized = ensureBlankLineBeforeMarkdownLists(normalized);

  devLog(
    '[prepareChatMessageContent] 预览:',
    normalized.substring(0, Math.min(200, normalized.length))
  );
  return normalized;
}
