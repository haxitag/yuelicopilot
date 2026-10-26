import type { RenderContent } from '../render/RenderOutput';
import { parseLaTeXContent } from '../render/latex';
import {
  MERMAID_LANGUAGE_KEYS,
  syntaxHighlighterLanguageFromFenceInfo,
} from './fenceLanguageUtils';
import { devLog } from '../../../utils/devConsole';

/** 兜底路径：结构与历史 parseChatContent 一致（正则围栏拆分） */
export const LEGACY_FENCED_CODE_BLOCK_RE = /```([^\n]*)\r?\n([\s\S]*?)```/g;

/** @deprecated 仅作 AST 解析失败兜底；正则理解围栏边界，避免主路径依赖 */
export function legacyCleanContentForFences(content: string): string {
  return (
    content
      .replace(/\s*\+\s*$/gm, '')
      .replace(/^\s*\+\s*/gm, '')
      .replace(/\s*\+\s*/g, ' ')
      .replace(/\s*\+\s*```/g, '\n```')
      .replace(/```\s*\+\s*/g, '```\n')
      .replace(LEGACY_FENCED_CODE_BLOCK_RE, (match, info: string, code: string) => {
        const cleanedCode = code
          .replace(/^\s*\+\s*/gm, '')
          .replace(/\s*\+\s*$/gm, '')
          .replace(/\s*\+\s*/g, ' ')
          .replace(/\n\s*\n/g, '\n')
          .trim();
        return `\`\`\`${info}\n${cleanedCode}\n\`\`\``;
      })
      .replace(/\n\s*\+\s*\n/g, '\n')
      .replace(/\+\s*\n\s*\+/g, '\n')
      .replace(/\n\s*\+\s*([^+\n])/g, '\n$1')
      .replace(/([^+\n])\s*\+\s*\n/g, '$1\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/<li>([^<]*)<strong>([^<]*)<\/strong>([^<]*)<\/li>/g, '<li>$1</li>\n<strong>$2</strong>$3')
      .replace(/<li>([^<]*)<\/li>\s*<strong>([^<]*)<\/strong>/g, '</li>\n<strong>$2</strong>')
      .replace(/```([^\n]*)\s*\n\s*```/g, '```$1\n```')
      .replace(LEGACY_FENCED_CODE_BLOCK_RE, (match, info: string, code: string) => {
        if (code.trim()) {
          return `\`\`\`${info}\n${code.trim()}\n\`\`\``;
        }
        return match;
      })
      .trim()
  );
}

export function parseChatContentLegacyRegex(content: string): RenderContent[] {
  if (!content?.trim()) return [];

  let cleanedContent = legacyCleanContentForFences(content);
  const codeBlockRegex = new RegExp(LEGACY_FENCED_CODE_BLOCK_RE.source, 'g');
  const blocks: RenderContent[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  devLog('[parseChatContent/legacy] 清理后的内容前200字符:', cleanedContent.substring(0, 200));

  if (cleanedContent.includes('markdown') && cleanedContent.includes('```')) {
    cleanedContent = cleanedContent
      .replace(/```\s*markdown\s*\+?\s*\n?/g, '```markdown\n')
      .replace(/```\s*\+?\s*\n?/g, '```\n')
      .replace(/\n\s*```\s*\+?\s*$/g, '\n```');

    devLog('[parseChatContent/legacy] 修复markdown代码块后的内容前200字符:', cleanedContent.substring(0, 200));
  }

  while ((match = codeBlockRegex.exec(cleanedContent)) !== null) {
    if (match.index > lastIndex) {
      const beforeText = cleanedContent.slice(lastIndex, match.index).trim();
      if (beforeText) {
        blocks.push({ type: 'markdown', value: beforeText });
      }
    }

    const infoRaw = (match[1] ?? '').trim();
    const languageKey = infoRaw.toLowerCase();
    const codeInner = match[2] ?? '';
    const codeTrimmed = codeInner.trim();

    devLog('[parseChatContent/legacy] 解析代码块，语言:', languageKey, '代码前50字符:', codeTrimmed.substring(0, 50));

    if (!codeTrimmed) {
      blocks.push({ type: 'markdown', value: match[0] });
      lastIndex = codeBlockRegex.lastIndex;
      continue;
    }

    const isMermaidByLanguage = MERMAID_LANGUAGE_KEYS.includes(
      languageKey as (typeof MERMAID_LANGUAGE_KEYS)[number],
    );

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
      const cleanedCode = codeTrimmed;

      devLog(
        '[parseChatContent/legacy] 发现Mermaid代码块，类型:',
        languageKey || 'content-detected',
        '清理后代码:',
        cleanedCode.substring(0, 100),
      );

      if (cleanedCode.length > 0) {
        devLog('[parseChatContent/legacy] 添加Mermaid块到渲染列表');
        blocks.push({ type: 'mermaid', value: cleanedCode });
      } else {
        devLog('[parseChatContent/legacy] Mermaid代码为空，降级为普通代码块');
        blocks.push({ type: 'code', value: codeTrimmed, language: 'text' });
      }
    } else if (languageKey === 'json') {
      try {
        const jsonValue = JSON.parse(codeTrimmed);
        blocks.push({ type: 'json', value: jsonValue });
      } catch {
        blocks.push({ type: 'code', value: codeTrimmed, language: 'text' });
      }
    } else if (languageKey === 'html') {
      blocks.push({ type: 'html', value: codeTrimmed });
    } else if (languageKey === 'svg') {
      blocks.push({ type: 'svg', value: codeTrimmed });
    } else if (languageKey === 'csv') {
      blocks.push({ type: 'csv', value: codeTrimmed });
    } else if (languageKey === 'markdown') {
      blocks.push({ type: 'markdown', value: codeTrimmed });
    } else {
      const hl = syntaxHighlighterLanguageFromFenceInfo(infoRaw);
      blocks.push({ type: 'code', value: codeTrimmed, language: hl });
    }

    lastIndex = codeBlockRegex.lastIndex;
  }

  if (lastIndex < cleanedContent.length) {
    const remainingText = cleanedContent.slice(lastIndex).trim();
    if (remainingText) {
      const latexBlocks = parseLaTeXContent(remainingText);
      blocks.push(...latexBlocks);
    }
  }

  if (blocks.length === 0 && cleanedContent.trim()) {
    const allBlocks = parseLaTeXContent(cleanedContent.trim());
    if (allBlocks.length > 0) {
      blocks.push(...allBlocks);
    } else {
      blocks.push({ type: 'markdown', value: cleanedContent.trim() });
    }
  }

  return blocks;
}
