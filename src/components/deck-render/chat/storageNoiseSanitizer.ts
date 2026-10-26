/**
 * 仓储/链路噪音清洗：仅修正「已知脏数据」（+ 行、局部 HTML 碎片），
 * 不做围栏/块级结构的语义理解（结构交给 remark mdast）。
 */
export function applyStorageNoiseSanitization(content: string): string {
  return (
    content
      .replace(/\s*\+\s*$/gm, '')
      .replace(/^\s*\+\s*/gm, '')
      .replace(/\s*\+\s*/g, ' ')
      .replace(/\s*\+\s*```/g, '\n```')
      .replace(/```\s*\+\s*/g, '```\n')
      .replace(/\n\s*\+\s*\n/g, '\n')
      .replace(/\+\s*\n\s*\+/g, '\n')
      .replace(/\n\s*\+\s*([^+\n])/g, '\n$1')
      .replace(/([^+\n])\s*\+\s*\n/g, '$1\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/<li>([^<]*)<strong>([^<]*)<\/strong>([^<]*)<\/li>/g, '<li>$1</li>\n<strong>$2</strong>$3')
      .replace(/<li>([^<]*)<\/li>\s*<strong>([^<]*)<\/strong>/g, '</li>\n<strong>$2</strong>')
      .trim()
  );
}
