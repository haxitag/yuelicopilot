/**
 * 是否在 OpenAI 兼容流式请求体中附加 `stream_options: { include_usage: true }`。
 * - 默认开启（便于气泡展示 token usage）
 * - `localStorage.setItem('yueli_stream_include_usage','0')` 关闭；`'1'` 强制开启（可压过构建时 `VITE_STREAM_INCLUDE_USAGE=false`）
 * - 构建时 `VITE_STREAM_INCLUDE_USAGE=false`：默认关闭（未设 localStorage 时）
 */
export function readOpenAiStreamIncludeUsagePreference(): boolean {
  try {
    if (typeof localStorage !== 'undefined') {
      const ls = localStorage.getItem('yueli_stream_include_usage');
      if (ls === '0') return false;
      if (ls === '1') return true;
    }
  } catch {
    /* ignore */
  }
  try {
    const env = (import.meta as { env?: Record<string, string> }).env?.VITE_STREAM_INCLUDE_USAGE;
    if (typeof env === 'string' && env.trim().toLowerCase() === 'false') {
      return false;
    }
  } catch {
    /* ignore */
  }
  return true;
}
