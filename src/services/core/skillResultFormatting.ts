/**
 * 管道预注入 / enhancedUserPrompt：将技能执行结果格式化为带换行的 Markdown，避免 JSON 墙喂给下一轮模型。
 */

function tryParseJsonString(s: string): unknown | null {
  const t = s.trim();
  if (!t.startsWith('{') && !t.startsWith('[')) return null;
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}

function escapeTableCell(v: string): string {
  return String(v || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function formatWebSearchLikeResults(rows: unknown[]): string {
  const lines = ['| 标题 | 摘要/链接 |', '| --- | --- |'];
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const row = r as { title?: string; url?: string; snippet?: string };
    const title = escapeTableCell(row.title || '');
    const rest = escapeTableCell(row.snippet || row.url || '');
    if (title || rest) lines.push(`| ${title} | ${rest} |`);
  }
  return lines.length > 2 ? lines.join('\n') : '';
}

function formatStructuredPayload(skillId: string, data: unknown, depth = 0): string {
  if (data == null) return '';
  if (typeof data === 'string') {
    const parsed = tryParseJsonString(data);
    if (parsed != null) return formatStructuredPayload(skillId, parsed, depth);
    return data.trim();
  }
  if (Array.isArray(data)) {
    if (data.length > 0 && data.every((x) => x && typeof x === 'object' && ('title' in x || 'url' in x))) {
      const table = formatWebSearchLikeResults(data);
      if (table) return table;
    }
    return '```json\n' + JSON.stringify(data, null, 2) + '\n```';
  }
  if (typeof data !== 'object') return String(data);

  const o = data as Record<string, unknown>;
  const parts: string[] = [];

  if (typeof o.result === 'string' && o.result.trim()) {
    parts.push(o.result.trim());
  }
  if (typeof o.content === 'string' && o.content.trim()) {
    parts.push(o.content.trim());
  }
  if (Array.isArray(o.results)) {
    const table = formatWebSearchLikeResults(o.results);
    if (table) parts.push(table);
  }
  if (typeof o.llmContext === 'string' && o.llmContext.trim()) {
    parts.push(o.llmContext.trim());
  }
  if (Array.isArray(o.pages) && o.pages.length > 0) {
    const pageLines: string[] = ['### 深读页面', ''];
    for (const p of o.pages) {
      const row = p as { title?: string; url?: string; read?: { content?: string; error?: string } };
      pageLines.push(`#### ${row.title || row.url || 'page'}`, `来源: ${row.url || ''}`, '');
      if (row.read?.content) pageLines.push(row.read.content);
      else if (row.read?.error) pageLines.push(`> 读取失败: ${row.read.error}`);
      pageLines.push('');
    }
    parts.push(pageLines.join('\n'));
  }
  if (o.success === false && o.error) {
    parts.push(`> 执行失败：${escapeTableCell(String(o.error))}`);
  }

  if (parts.length > 0) return parts.join('\n\n');

  if (depth < 2) {
    const normalized = o.normalized as Record<string, unknown> | undefined;
    const nested = o.data ?? normalized?.data ?? o.normalized ?? null;
    if (nested != null && nested !== data) {
      const inner = formatStructuredPayload(skillId, nested, depth + 1);
      if (inner.trim()) return inner;
    }
  }

  return '```json\n' + JSON.stringify(data, null, 2) + '\n```';
}

/**
 * 供 CoreOrchestrator 拼进 enhancedUserPrompt / 管道上下文。
 */
export function formatSkillResultForInjection(skillId: string, skillResult: unknown): string {
  if (skillResult == null) return '';
  if (typeof skillResult === 'string') {
    const parsed = tryParseJsonString(skillResult);
    if (parsed != null) return formatStructuredPayload(skillId, parsed);
    return skillResult.trim();
  }
  return formatStructuredPayload(skillId, skillResult);
}
