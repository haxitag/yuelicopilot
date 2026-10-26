/**
 * 与 server/lib/smartChunk.mjs 对齐的智能分块（结构 / 段落 / 固定窗口）
 */

function normalize(text: string): string {
  return String(text || '').replace(/\r\n/g, '\n').trim();
}

function analyzeStructure(text: string) {
  const lines = text.split('\n');
  let headings = 0;
  let blanks = 0;
  let longLines = 0;
  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      blanks += 1;
      continue;
    }
    if (/^#{1,6}\s/.test(t) || /^第[一二三四五六七八九十\d]+[章节部分]/.test(t)) headings += 1;
    if (t.length > 120) longLines += 1;
  }
  const lineCount = Math.max(lines.length, 1);
  return {
    headingDensity: headings / lineCount,
    blankRatio: blanks / lineCount,
    longLineRatio: longLines / lineCount
  };
}

function fixedWindowChunk(text: string, chunkSize: number, overlap: number): string[] {
  const normalized = normalize(text);
  if (!normalized) return [];
  if (normalized.length <= chunkSize) return [normalized];
  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    const end = Math.min(start + chunkSize, normalized.length);
    chunks.push(normalized.slice(start, end));
    if (end >= normalized.length) break;
    start = Math.max(0, end - overlap);
  }
  return chunks;
}

function structureAwareChunk(text: string, targetSize: number, overlap: number): string[] {
  const normalized = normalize(text);
  const sections = normalized.split(/\n(?=#{1,3}\s|第[一二三四五六七八九十\d]+[章节])/);
  const chunks: string[] = [];
  let buf = '';
  for (const sec of sections) {
    if ((buf + sec).length <= targetSize) {
      buf = buf ? `${buf}\n${sec}` : sec;
      continue;
    }
    if (buf) chunks.push(buf.trim());
    if (sec.length <= targetSize) buf = sec;
    else {
      chunks.push(...fixedWindowChunk(sec, targetSize, overlap));
      buf = '';
    }
  }
  if (buf.trim()) chunks.push(buf.trim());
  return chunks.filter(Boolean);
}

function paragraphChunk(text: string, targetSize: number, overlap: number): string[] {
  const paras = normalize(text).split(/\n{2,}/);
  const chunks: string[] = [];
  let buf = '';
  for (const p of paras) {
    if ((buf + '\n\n' + p).length <= targetSize) {
      buf = buf ? `${buf}\n\n${p}` : p;
    } else {
      if (buf) chunks.push(buf);
      if (p.length <= targetSize) buf = p;
      else {
        chunks.push(...fixedWindowChunk(p, targetSize, overlap));
        buf = '';
      }
    }
  }
  if (buf) chunks.push(buf);
  return chunks.filter(Boolean);
}

export type SmartChunkStrategy = 'empty' | 'single' | 'structure' | 'paragraph' | 'fixed';

export function routeAndChunkText(
  text: string,
  options?: { chunkSize?: number; overlap?: number }
): { strategy: SmartChunkStrategy; chunks: string[] } {
  const targetSize = options?.chunkSize ?? 900;
  const overlap = options?.overlap ?? 120;
  const normalized = normalize(text);
  if (!normalized) return { strategy: 'empty', chunks: [] };
  if (normalized.length <= targetSize) return { strategy: 'single', chunks: [normalized] };

  const feat = analyzeStructure(normalized);
  if (feat.headingDensity >= 0.04 || feat.blankRatio >= 0.12) {
    return { strategy: 'structure', chunks: structureAwareChunk(normalized, targetSize, overlap) };
  }
  if (feat.longLineRatio >= 0.35) {
    return { strategy: 'paragraph', chunks: paragraphChunk(normalized, targetSize, overlap) };
  }
  return { strategy: 'fixed', chunks: fixedWindowChunk(normalized, targetSize, overlap) };
}
