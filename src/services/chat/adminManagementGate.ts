import apiService from '../../api/services/apiService';
import type { ChatProvider } from './ModelOptions';

export type AdminManagementParseResult = { kind: 'none' } | { kind: 'ok'; question: string };

/**
 * 严格 CLI 式管理门控：整行 `asda` + `:`/`：` + 管理口令 + `#` + 正文。
 * 口令集合与匹配规则由本模块实现；**勿在公开文档中抄写示例口令**。
 * 仅当整行匹配时走本地管理回复，否则按普通对话走 LLM。
 */
const STRICT_ASDA_ADMIN = /^asda[:：](haxitag|yueli)#([\s\S]*)$/i;

export function parseAdminManagementInput(raw: string): AdminManagementParseResult {
  const t = raw.trim();
  if (!t) return { kind: 'none' };

  const m = STRICT_ASDA_ADMIN.exec(t);
  if (!m) return { kind: 'none' };

  return { kind: 'ok', question: (m[2] ?? '').trim() };
}

function classifyAdminQuestion(question: string): 'model' | 'manage' | 'both' {
  const q = question.trim();
  if (!q) return 'both';

  const modelRe =
    /模型|model|接口|api|endpoint|url|地址|推理|provider|调用.*哪|哪个服务|哪家的|基地址|请求.*url|chat\s*completions/i;
  const manageRe =
    /管理|知识集|知识库|配置|技能|激活|manager|skill|playground|云端推理|路由|sdk|kgm\s*sdk/i;

  const isModel = modelRe.test(q);
  const isManage = manageRe.test(q);
  if (isModel && isManage) return 'both';
  if (isModel) return 'model';
  if (isManage) return 'manage';
  return 'both';
}

function escapeMdCell(s: string): string {
  return s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export function composeAdminManagementAssistantText(
  parse: AdminManagementParseResult,
  uiSelectedModel: string,
  /** 与界面 Provider 下拉一致；避免渲染帧内 apiService 尚未同步 provider */
  uiSelectedProvider?: ChatProvider
): string | null {
  if (parse.kind !== 'ok') return null;

  const rt = apiService.resolveChatRuntimeSnapshot(uiSelectedModel, uiSelectedProvider);
  const origin = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '';
  const managerHref = origin ? `${origin}/manager` : '/manager';
  const topic = classifyAdminQuestion(parse.question);

  const providerLine =
    rt.provider === 'kgm'
      ? 'KGM 中间层（同源 `/kgm`，上游由 KGM 路由：freemodel/Ollama/DeepSeek 等）'
      : 'Ollama';

  /** 使用列表而非 GFM 表格：表格单元格内的反引号易被解析成块级 code，触发整块高亮与「TEXT (1 行)」头，占用过高 */
  const modelSection =
    `### 模型与接口（当前前端解析结果）\n\n` +
    `- **Provider**：\`${escapeMdCell(rt.provider)}\`\n` +
    `- **展示用 provider**：${escapeMdCell(providerLine)}\n` +
    `- **请求体 model（解析后）**：\`${escapeMdCell(rt.model)}\`\n` +
    `- **Tool 下拉 model 段**：\`${escapeMdCell(uiSelectedModel)}\`\n` +
    `- **输入区角标（解析后）**：\`${escapeMdCell(`${rt.provider}:${rt.model}`)}\`\n` +
    `- **Chat / Generate URL**：<${escapeMdCell(rt.apiUrl)}>\n` +
    (rt.provider === 'kgm'
      ? `- **KGM HTTP 根（展示）**：<${escapeMdCell(rt.kgmHttpRootDisplay)}>\n`
      : '') +
    `\n> 若使用 KGM 动态路由，真实上游模型以 KGM 服务端为准；此处为 Copilot 实际发出的 HTTP 目标与 model 字段。\n`;

  const manageSection =
    `### 管理入口\n\n` +
    `- [在新窗口打开管理后台](${managerHref})\n` +
    `- 同路径 SPA：\`/manager\`（知识库、云端推理、技能与 KGM SDK 等配置）\n`;

  if (topic === 'model') return modelSection;
  if (topic === 'manage') return manageSection;
  return modelSection + '\n' + manageSection;
}
