/**
 * Ollama `/api/generate` 的 `think` 字段（思考链）。
 * - 未设置 localStorage 时按构建环境变量 `VITE_OLLAMA_THINK`
 * - `localStorage yueli_ollama_think`：`'1'` 开启，`'0'` 关闭（压过 env）
 */

const LS_KEY = 'yueli_ollama_think';

/** 未配置 env / 无效 env 时使用：关闭 thinking，避免部分模型正文长期为空（推理只在 thinking 通道） */
const DEFAULT_THINK = false;

function readEnvThinkDefault(): boolean {
  try {
    const env = (import.meta as { env?: Record<string, string | boolean | undefined> }).env?.VITE_OLLAMA_THINK;
    if (typeof env === 'boolean') return env;
    if (typeof env !== 'string') return DEFAULT_THINK;
    const v = env.trim().toLowerCase();
    if (v === 'false' || v === '0' || v === 'off' || v === 'no') return false;
    if (v === 'true' || v === '1' || v === 'on' || v === 'yes') return true;
  } catch {
    /* ignore */
  }
  return DEFAULT_THINK;
}

export function readOllamaThinkModePreference(): boolean {
  try {
    if (typeof localStorage !== 'undefined') {
      const ls = localStorage.getItem(LS_KEY);
      if (ls === '0') return false;
      if (ls === '1') return true;
    }
  } catch {
    /* ignore */
  }
  return readEnvThinkDefault();
}
