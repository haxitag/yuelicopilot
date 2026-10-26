/**
 * LLM 常见误写：收口行形如「``` ``」（三段围栏后紧跟额外反引号），
 * CommonMark 不认作合法围栏结束，正文会被吃入 code fence。
 * 归为「收尾修补」——仅正则折行，不做全文结构解析。
 */
export function repairFenceClosingLineTrailingTicks(md: string): string {
  return md.replace(/^(\t*)(`{3})\s*((?:`)+)\s*$/gm, (full, ws: string, _base: string, extraTicks: string) => {
    if (!extraTicks) return full;
    const body = full.replace(/^[\t ]+/u, '').replace(/\s+$/u, '');
    // 只允许整行全是反引号与空白（含 info 的行不误拆）
    if (/[^`\s]/u.test(body)) return full;
    return `${ws}\`\`\`\n${ws}${extraTicks}`;
  });
}
