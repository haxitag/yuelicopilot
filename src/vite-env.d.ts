/// <reference types="vite/client" />

interface ImportMetaEnv {
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
  readonly VITE_ANTHROPIC_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
