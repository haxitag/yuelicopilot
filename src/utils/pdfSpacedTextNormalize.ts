/**
 * pdf.js 对部分 AWS/博客类 PDF 会产出「逐字空格」正文（A m a z o n），
 * 导致分块/向量召回看似成功、实则无法阅读，并拖垮本地 Ollama。
 */

export function isSpacedLetterPdfArtifact(text: string): boolean {
  const probe = text.slice(0, 6000);
  const tokens = probe.split(/\s+/).filter(Boolean);
  if (tokens.length < 8) return false;
  const singleChar = tokens.filter((t) => t.length === 1).length;
  const ratio = singleChar / tokens.length;
  return tokens.length < 40 ? ratio >= 0.65 : ratio >= 0.5;
}

/** 将逐字空格 PDF 正文折叠为可读连续文本 */
export function collapseSpacedLetterPdfText(text: string): string {
  if (!isSpacedLetterPdfArtifact(text)) return text;

  let out = text;
  const punct = String.raw`A-Za-z0-9\u2019\u2018\u201c\u201d.,;:!?%-`;
  const re = new RegExp(`([${punct}]) (?=[${punct}])`, 'g');
  for (let i = 0; i < 8; i += 1) {
    out = out.replace(re, '$1');
  }
  out = out.replace(/\s+-\s+/g, '-');
  return out
    .replace(/\s{2,}/g, ' ')
    .replace(/ +\n/g, '\n')
    .replace(/\n +/g, '\n')
    .trim();
}

export function normalizePdfExtractedText(text: string): {
  text: string;
  normalized: boolean;
} {
  if (!text?.trim()) return { text: text || '', normalized: false };
  if (!isSpacedLetterPdfArtifact(text)) return { text, normalized: false };
  return { text: collapseSpacedLetterPdfText(text), normalized: true };
}
