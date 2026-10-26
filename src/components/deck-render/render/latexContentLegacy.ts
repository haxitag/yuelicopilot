import type { RenderContent } from './RenderOutput';
import { devLog } from '../../../utils/devConsole';

/**
 * 历史行级正则：支持 `\[...\]` `\(...\)`
 * （入参须经 {@link ./latexProseHygiene.ts `applyLatexProseHygiene`}）。
 */
export function parseLaTeXContentLegacy(cleanedContent: string): RenderContent[] {
  const blocks: RenderContent[] = [];
  const lines = cleanedContent.split('\n');
  let currentBlock = '';
  let inLaTeXBlock = false;
  let laTeXType = ''; // 'inline' | 'block'

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.includes('\\[') && line.includes('\\]')) {
      const match = line.match(/\\\[(.*?)\\\]/);
      if (match) {
        const latexContent = match[1].trim();
        devLog('[parseLaTeXContent/legacy] 单行块级 LaTeX:', latexContent.substring(0, 120));

        const beforeLaTeX = line.substring(0, line.indexOf('\\[')).trim();
        if (currentBlock.trim() || beforeLaTeX) {
          const fullText = (currentBlock.trim() + '\n' + beforeLaTeX).trim();
          if (fullText) {
            blocks.push({ type: 'markdown', value: fullText });
          }
        }

        blocks.push({ type: 'latex', value: latexContent, displayMode: true });

        const afterLaTeX = line.substring(line.indexOf('\\]') + 2).trim();
        currentBlock = afterLaTeX ? `${afterLaTeX}\n` : '';
        continue;
      }
    }

    if (line.includes('\\[') && !line.includes('\\]')) {
      devLog('[parseLaTeXContent/legacy] 多行块级 LaTeX 开始');
      if (currentBlock.trim()) {
        blocks.push({ type: 'markdown', value: currentBlock.trim() });
      }
      currentBlock = `${line}\n`;
      inLaTeXBlock = true;
      laTeXType = 'block';
      continue;
    }

    if (line.includes('\\]') && inLaTeXBlock && laTeXType === 'block') {
      currentBlock += `${line}\n`;
      const latexContent = currentBlock.replace(/\\\[(.*?)\\\]/s, '$1').trim();
      devLog('[parseLaTeXContent/legacy] 多行块级 LaTeX 结束，长度:', latexContent.length);
      blocks.push({ type: 'latex', value: latexContent, displayMode: true });
      currentBlock = '';
      inLaTeXBlock = false;
      laTeXType = '';
      continue;
    }

    if (line.includes('\\(') && line.includes('\\)')) {
      const parts = line.split(/(\\\(.*?\\\))/);
      let processedLine = '';

      for (const part of parts) {
        if (part.startsWith('\\(') && part.endsWith('\\)')) {
          if (processedLine.trim()) {
            if (currentBlock.trim()) {
              blocks.push({ type: 'markdown', value: `${currentBlock}${processedLine}`.trim() });
            } else {
              blocks.push({ type: 'markdown', value: processedLine.trim() });
            }
            currentBlock = '';
          }
          const latexContent = part.slice(2, -2).trim();
          blocks.push({ type: 'latex', value: latexContent, displayMode: false });
          processedLine = '';
        } else if (part.trim()) {
          processedLine += part;
        }
      }

      if (processedLine.trim()) {
        currentBlock += `${processedLine}\n`;
      }
      continue;
    }

    currentBlock += `${line}\n`;
  }

  if (currentBlock.trim()) {
    blocks.push({ type: 'markdown', value: currentBlock.trim() });
  }

  devLog('[parseLaTeXContent/legacy] 块数', blocks.length, blocks.map((b) => b.type));

  return blocks;
}
