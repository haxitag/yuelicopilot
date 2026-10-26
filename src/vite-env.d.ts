/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** server | desktop（desktop 构建默认同源 /kgm /api） */
  readonly VITE_DEPLOY_PROFILE?: string;
  readonly VITE_KGM_BASE_URL?: string;
  readonly VITE_KGM_PORT?: string;
  readonly VITE_PLAYGROUND_URL?: string;
  /** 完整 executor 根 URL；未设置时按 VITE_SKILL_EXECUTOR_PORT 或内置默认端口 */
  readonly VITE_SKILL_EXECUTOR_URL?: string;
  /** 仅端口（默认构建时常量见 DEFAULT_SKILL_EXECUTOR_PORT）；与 URL 二选一即可 */
  readonly VITE_SKILL_EXECUTOR_PORT?: string;
  /** 可选：Skill Executor API Token；生产环境配合 SKILL_EXECUTOR_API_TOKEN 使用 */
  readonly VITE_SKILL_EXECUTOR_API_TOKEN?: string;
  readonly VITE_API_URL: string;
  readonly VITE_APP_NAME: string;
  /** 可选：浏览器直连 OpenAI（多数环境会因 CORS 失败，优先使用 provider=local + KGM） */
  readonly VITE_OPENAI_API_KEY?: string;
  /** 可选：Anthropic Key */
  readonly VITE_ANTHROPIC_API_KEY?: string;
  /** 可选：Yueli AI freemodel（内置云端推理默认项，对应 yueli.com/api/yueliai/v1/completions） */
  readonly VITE_YUELIAI_API_KEY?: string;
  /** Ollama /api/generate 是否启用 thinking 链（与「YueliCopilot 设置」开关一致的环境默认） */
  readonly VITE_OLLAMA_THINK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface YueliDesktopBridge {
  platform: string;
  pickFiles?: () => Promise<
    Array<{ name: string; type: string; size: number; base64: string }>
  >;
  pickDirectory?: () => Promise<string | null>;
  openDevTools?: () => Promise<boolean>;
  restartBackend?: () => Promise<boolean>;
}

interface Window {
  yueliDesktop?: YueliDesktopBridge;
}
