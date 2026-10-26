/**
 * 流式围栏状态机：按行识别 ``` 启闭（CommonMark 风格行首围栏），
 * 在「未闭合围栏」时把从围栏起始行起的后缀划为 volatile，其余为 stable。
 * 不做正文结构解析，仅凭围栏平衡划分 AST 解析边界。
 */

export type StreamingFencePartition = {
  stable: string;
  volatileTail: string;
  /** EOS 仍处于未闭合围栏内 */
  inIncompleteFence: boolean;
};

/** 极小流式修补：连续换行压实（可选，保持与 prepare 的视觉一致） */
export function applyStreamingTailRepairs(tail: string): string {
  if (!tail) return tail;
  return tail.replace(/\n{4,}/g, '\n\n');
}

/** 是否为「行首 fenced code opener」：` ```lang` … */
function matchFenceOpener(line: string): null | { tickLen: number } {
  const m = /^[\t ]*(`{3,})([^`]*)$/u.exec(line);
  if (!m) return null;
  return { tickLen: m[1].length };
}

/** closing fence：` ``` ` 独占一行，刻度长度 ≥ opener */
function matchFenceCloser(line: string, minTicks: number): boolean {
  const m = /^[\t ]*(`{3,})\s*$/u.exec(line);
  if (!m) return false;
  return m[1].length >= minTicks;
}

export function partitionAtUnclosedFence(source: string): StreamingFencePartition {
  if (!source) {
    return { stable: '', volatileTail: '', inIncompleteFence: false };
  }

  let mode: 'normal' | 'fence' = 'normal';
  let openerTickLen = 0;
  let volatileStart = source.length;
  let i = 0;

  while (i < source.length) {
    const lineStart = i;
    const nl = source.indexOf('\n', i);
    const lineEnd = nl === -1 ? source.length : nl;
    let line = source.slice(lineStart, lineEnd);
    if (line.endsWith('\r')) {
      line = line.slice(0, -1);
    }

    if (mode === 'normal') {
      const op = matchFenceOpener(line);
      if (op) {
        mode = 'fence';
        openerTickLen = op.tickLen;
        volatileStart = lineStart;
      }
    } else {
      if (matchFenceCloser(line, openerTickLen)) {
        mode = 'normal';
        openerTickLen = 0;
        volatileStart = source.length;
      }
    }

    if (nl === -1) break;
    i = nl + 1;
  }

  if (mode === 'fence') {
    return {
      stable: source.slice(0, volatileStart),
      volatileTail: source.slice(volatileStart),
      inIncompleteFence: true,
    };
  }

  return { stable: source, volatileTail: '', inIncompleteFence: false };
}
