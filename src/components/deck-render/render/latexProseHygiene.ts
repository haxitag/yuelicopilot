/**
 * Prose 片段进入 LaTeX 解析前的轻量修补（对齐历史 parseLaTeXContent）。
 * 与全量 prepare 分离，仅限数学/行间噪音；非结构语义。
 */
export function applyLatexProseHygiene(s: string): string {
  return s
    .replace(/^\s*\+\s*/gm, '')
    .replace(/\s*\+\s*$/gm, '')
    .replace(/(?<!\\[\[\(])\s*\n\s*(?!\\[\]\)])/g, '\n')
    .replace(/\s*\+\s*\\[\[\(]/g, '\n\\[')
    .replace(/\\[\]\)]\s*\+\s*/g, '\\]\n')
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .split('\n')
    .filter((line) => !/^\s*\|\s*\+/.test(line))
    .join('\n')
    .replace(/\s*\+\s*\n/g, '\n')
    .replace(/\s*\+\s*\\\[/g, '\n\\[')
    .replace(/\\\]\s*\+\s*/g, '\\]\n')
    .replace(/\s*\+\s*\\\[/g, '\n\\[')
    .replace(/\\\]\s*\+\s*/g, '\\]\n')
    .replace(/\\\[(.*?)\\\]/g, (_, inner: string) => {
      const cleaned = inner
        .replace(/\s*\+\s*/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return `\\[${cleaned}\\]`;
    })
    .trim();
}
