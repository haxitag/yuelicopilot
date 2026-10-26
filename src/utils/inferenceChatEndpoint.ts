/**
 * 云端 LLM 对话地址规范化与内置预设。
 * 各服务商 `chatEndpoint` / `docsUrl` 已与官方开发文档对齐（持续以文档为准）：
 * - DeepSeek：https://api-docs.deepseek.com/zh-cn/（POST …/chat/completions）
 * - OpenAI：https://platform.openai.com/docs/api-reference/chat/create
 * - Groq：https://console.groq.com/docs/overview（base `https://api.groq.com/openai/v1`）
 * - Together：https://docs.together.ai/docs/openai-api-compatibility（base `https://api.together.ai/v1`）
 * - Moonshot 国内：https://platform.moonshot.cn/docs/api/chat（base `https://api.moonshot.cn/v1`）
 * - Moonshot 国际：https://platform.kimi.ai/docs/api/chat（base `https://api.moonshot.ai/v1`）
 * - 智谱：https://docs.bigmodel.cn/cn/api/introduction（…/api/paas/v4/chat/completions）
 * - SiliconFlow：https://docs.siliconflow.cn/cn/api-reference/chat-completions/chat-completions（…/v1）
 * - Mistral：https://docs.mistral.ai/api/endpoint/chat
 * - xAI：https://docs.x.ai/docs/introduction（OpenAI 兼容 base `https://api.x.ai/v1`）
 * - MiniMax：https://platform.minimax.io/docs/api-reference/text-openai-api
 * - 阿里云百炼：https://help.aliyun.com/zh/model-studio/developer-reference/compatibility-of-openai-with-dashscope
 * - 魔搭 ModelScope：https://www.modelscope.cn/docs（OpenAI 兼容推理 `api-inference.modelscope.cn/v1`）
 * - 百度千帆：https://cloud.baidu.com/doc/qianfan/s/Hmh4suq26
 * - 火山方舟：https://www.volcengine.com/docs/82379/1330626
 * - Google AI Studio / Gemini OpenAI 兼容：https://ai.google.dev/gemini-api/docs/openai
 * - Anthropic（OpenAI SDK 兼容层）：https://docs.anthropic.com/en/api/openai-sdk
 * - 腾讯混元：https://cloud.tencent.com/document/product/1729/111007
 * - 华为云 MaaS：https://support.huaweicloud.com/intl/zh-cn/model-call-maas/model-call-021.html
 * - Fireworks：https://docs.fireworks.ai/tools-sdks/openai-compatibility
 * - Baseten：https://docs.baseten.co/reference/inference-api/chat-completions
 * - SambaNova：https://docs.sambanova.ai/docs/en/features/openai-compatibility
 * - Cerebras：https://inference-docs.cerebras.ai/resources/openai
 * - OpenRouter：https://openrouter.ai/docs/quickstart
 * - Perplexity Sonar（pplx-api）：https://docs.perplexity.ai/docs/sonar/openai-compatibility
 * - Yueli AI（freemodel）：https://yueli.com/api/yueliai/v1/completions（OpenAI 兼容 messages，路径为 /completions）
 */

export type CloudLlmPresetId =
  | 'yueliai'
  | 'deepseek'
  | 'openai'
  | 'groq'
  | 'together'
  | 'moonshot'
  | 'moonshot_ai'
  | 'zhipu'
  | 'siliconflow'
  | 'mistral'
  | 'xai'
  | 'minimax'
  | 'aliyun_dashscope_cn'
  | 'aliyun_dashscope_intl'
  | 'modelscope'
  | 'qianfan'
  | 'volcengine_ark'
  | 'google_gemini'
  | 'anthropic'
  | 'tencent_hunyuan'
  | 'huawei_maas_cn'
  | 'huawei_maas_hk'
  | 'fireworks'
  | 'baseten'
  | 'sambanova'
  | 'cerebras'
  | 'openrouter'
  | 'perplexity'
  | 'custom';

export interface CloudLlmPreset {
  id: CloudLlmPresetId;
  label: string;
  /** 官方文档中的 OpenAI 兼容「对话」完整 URL */
  chatEndpoint: string;
  defaultModel?: string;
  docsUrl?: string;
}

export const CLOUD_LLM_PRESETS: CloudLlmPreset[] = [
  {
    id: 'yueliai',
    label: 'Yueli AI（freemodel）',
    chatEndpoint: 'https://yueli.com/api/yueliai/v1/completions',
    defaultModel: 'freemodel',
    docsUrl: 'https://yueli.com'
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    chatEndpoint: 'https://api.deepseek.com/chat/completions',
    defaultModel: 'deepseek-v4-flash',
    docsUrl: 'https://api-docs.deepseek.com/zh-cn/'
  },
  {
    id: 'openai',
    label: 'OpenAI',
    chatEndpoint: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-5.5',
    docsUrl: 'https://platform.openai.com/docs/api-reference/chat/create'
  },
  {
    id: 'groq',
    label: 'Groq',
    chatEndpoint: 'https://api.groq.com/openai/v1/chat/completions',
    defaultModel: 'openai/gpt-oss-120b',
    docsUrl: 'https://console.groq.com/docs/overview'
  },
  {
    id: 'together',
    label: 'Together AI',
    chatEndpoint: 'https://api.together.ai/v1/chat/completions',
    defaultModel: 'meta-llama/Llama-4-Maverick-17B-128E-Instruct-Turbo',
    docsUrl: 'https://docs.together.ai/docs/openai-api-compatibility'
  },
  {
    id: 'moonshot',
    label: 'Moonshot / Kimi（国内 api.moonshot.cn）',
    chatEndpoint: 'https://api.moonshot.cn/v1/chat/completions',
    defaultModel: 'kimi-k2.6',
    docsUrl: 'https://platform.moonshot.cn/docs/api/chat'
  },
  {
    id: 'moonshot_ai',
    label: 'Moonshot / Kimi（国际 api.moonshot.ai）',
    chatEndpoint: 'https://api.moonshot.ai/v1/chat/completions',
    defaultModel: 'kimi-k2.6',
    docsUrl: 'https://platform.kimi.ai/docs/api/chat'
  },
  {
    id: 'zhipu',
    label: '智谱 GLM（OpenAI 兼容）',
    chatEndpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    defaultModel: 'glm-5.1',
    docsUrl: 'https://docs.bigmodel.cn/cn/api/introduction'
  },
  {
    id: 'siliconflow',
    label: 'SiliconFlow',
    chatEndpoint: 'https://api.siliconflow.cn/v1/chat/completions',
    defaultModel: 'deepseek-ai/DeepSeek-V4-Flash',
    docsUrl: 'https://docs.siliconflow.cn/cn/api-reference/chat-completions/chat-completions'
  },
  {
    id: 'mistral',
    label: 'Mistral AI',
    chatEndpoint: 'https://api.mistral.ai/v1/chat/completions',
    defaultModel: 'mistral-large-latest',
    docsUrl: 'https://docs.mistral.ai/api/endpoint/chat'
  },
  {
    id: 'xai',
    label: 'xAI（Grok）',
    chatEndpoint: 'https://api.x.ai/v1/chat/completions',
    defaultModel: 'grok-4.3',
    docsUrl: 'https://docs.x.ai/docs/introduction'
  },
  {
    id: 'minimax',
    label: 'MiniMax（OpenAI 兼容）',
    chatEndpoint: 'https://api.minimax.io/v1/chat/completions',
    defaultModel: 'MiniMax-M2.7',
    docsUrl: 'https://platform.minimax.io/docs/api-reference/text-openai-api'
  },
  {
    id: 'aliyun_dashscope_cn',
    label: '阿里云百炼（北京 compatible-mode）',
    chatEndpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    defaultModel: 'qwen3.7-max-2026-05-20',
    docsUrl: 'https://help.aliyun.com/zh/model-studio/developer-reference/compatibility-of-openai-with-dashscope'
  },
  {
    id: 'aliyun_dashscope_intl',
    label: '阿里云百炼（新加坡 compatible-mode）',
    chatEndpoint: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
    defaultModel: 'qwen3.7-max-2026-05-20',
    docsUrl: 'https://www.alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope'
  },
  {
    id: 'modelscope',
    label: '魔搭 ModelScope（OpenAI 兼容，常误写 mindscope）',
    chatEndpoint: 'https://api-inference.modelscope.cn/v1/chat/completions',
    defaultModel: 'deepseek-ai/DeepSeek-V3.2',
    docsUrl: 'https://www.modelscope.cn/docs'
  },
  {
    id: 'qianfan',
    label: '百度千帆（OpenAI 兼容 v2）',
    chatEndpoint: 'https://qianfan.baidubce.com/v2/chat/completions',
    defaultModel: 'ernie-5.1',
    docsUrl: 'https://cloud.baidu.com/doc/qianfan/s/Hmh4suq26'
  },
  {
    id: 'volcengine_ark',
    label: '火山方舟 Ark（北京 OpenAI 兼容）',
    chatEndpoint: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
    defaultModel: 'doubao-seed-2-0-pro-260215',
    docsUrl: 'https://www.volcengine.com/docs/82379/1330626'
  },
  {
    id: 'google_gemini',
    label: 'Google AI Studio / Gemini（OpenAI 兼容）',
    chatEndpoint: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    defaultModel: 'gemini-3.1-pro-preview',
    docsUrl: 'https://ai.google.dev/gemini-api/docs/openai'
  },
  {
    id: 'anthropic',
    label: 'Anthropic Claude（OpenAI SDK 兼容层）',
    chatEndpoint: 'https://api.anthropic.com/v1/chat/completions',
    defaultModel: 'claude-sonnet-4-6',
    docsUrl: 'https://docs.anthropic.com/en/api/openai-sdk'
  },
  {
    id: 'tencent_hunyuan',
    label: '腾讯混元（OpenAI 兼容）',
    chatEndpoint: 'https://api.hunyuan.cloud.tencent.com/v1/chat/completions',
    defaultModel: 'hunyuan-turbos-latest',
    docsUrl: 'https://cloud.tencent.com/document/product/1729/111007'
  },
  {
    id: 'huawei_maas_cn',
    label: '华为云 MaaS（中国站 · 贵阳 v1）',
    chatEndpoint: 'https://api.modelarts-maas.com/v1/chat/completions',
    defaultModel: 'deepseek-v3',
    docsUrl: 'https://support.huaweicloud.com/usermanual-maas/usermanual_maas_0024.html'
  },
  {
    id: 'huawei_maas_hk',
    label: '华为云 MaaS（国际站 · 香港 OpenAI 兼容）',
    chatEndpoint: 'https://api-ap-southeast-1.modelarts-maas.com/openai/v1/chat/completions',
    defaultModel: 'deepseek-v3',
    docsUrl: 'https://support.huaweicloud.com/intl/zh-cn/model-call-maas/model-call-021.html'
  },
  {
    id: 'fireworks',
    label: 'Fireworks AI（OpenAI 兼容）',
    chatEndpoint: 'https://api.fireworks.ai/inference/v1/chat/completions',
    defaultModel: 'accounts/fireworks/models/deepseek-v3',
    docsUrl: 'https://docs.fireworks.ai/tools-sdks/openai-compatibility'
  },
  {
    id: 'baseten',
    label: 'Baseten（OpenAI 兼容）',
    chatEndpoint: 'https://inference.baseten.co/v1/chat/completions',
    defaultModel: 'deepseek-ai/DeepSeek-V3.2',
    docsUrl: 'https://docs.baseten.co/reference/inference-api/chat-completions'
  },
  {
    id: 'sambanova',
    label: 'SambaNova Cloud（OpenAI 兼容）',
    chatEndpoint: 'https://api.sambanova.ai/v1/chat/completions',
    defaultModel: 'Meta-Llama-3.3-70B-Instruct',
    docsUrl: 'https://docs.sambanova.ai/docs/en/features/openai-compatibility'
  },
  {
    id: 'cerebras',
    label: 'Cerebras Inference（OpenAI 兼容）',
    chatEndpoint: 'https://api.cerebras.ai/v1/chat/completions',
    defaultModel: 'llama-3.3-70b',
    docsUrl: 'https://inference-docs.cerebras.ai/resources/openai'
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    chatEndpoint: 'https://openrouter.ai/api/v1/chat/completions',
    defaultModel: 'openai/gpt-5.5',
    docsUrl: 'https://openrouter.ai/docs/quickstart'
  },
  {
    id: 'perplexity',
    label: 'Perplexity Sonar（pplx-api / OpenAI 兼容）',
    chatEndpoint: 'https://api.perplexity.ai/chat/completions',
    defaultModel: 'sonar-pro',
    docsUrl: 'https://docs.perplexity.ai/docs/sonar/openai-compatibility'
  },
  { id: 'custom', label: '自定义（自行填写 API 地址）', chatEndpoint: '', defaultModel: '', docsUrl: '' }
];

/**
 * 配置面板「其它 MaaS」下拉用的预设（不含 Yueli AI：第3层在独立区块配置）。
 * 完整预设表见 {@link CLOUD_LLM_PRESETS}（含 yueliai，可作 L3 聚合参考）。
 */
export const CLOUD_MAAS_PRESETS = CLOUD_LLM_PRESETS.filter((p) => p.id !== 'yueliai');

export function getCloudLlmPreset(presetId: string | undefined): CloudLlmPreset | undefined {
  if (!presetId) return undefined;
  return CLOUD_LLM_PRESETS.find((p) => p.id === presetId);
}

/** 选择预设后写入 cloudProviders 行的字段 */
export function applyCloudLlmPresetToRow(presetId: string): {
  presetId: string;
  apiUrl: string;
  model: string;
} {
  const pr = getCloudLlmPreset(presetId);
  if (!pr || presetId === 'custom') {
    return { presetId: 'custom', apiUrl: '', model: '' };
  }
  return {
    presetId: pr.id,
    apiUrl: pr.chatEndpoint,
    model: pr.defaultModel || ''
  };
}

function isDeepseekHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === 'api.deepseek.com' || h.endsWith('.deepseek.com');
}

function isYueliaiHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === 'yueli.com' || h.endsWith('.yueli.com');
}

const YUELIAI_CHAT_COMPLETIONS = 'https://yueli.com/api/yueliai/v1/completions';

/**
 * 将用户输入的 base / 半路径 / 全路径 规范为「可直接 POST 的 chat completions URL」。
 * - 已含 `/chat/completions` 或 `/v1/chat/completions` 则只做裁剪与纠偏
 * - DeepSeek 官方路径为 `/chat/completions`（非 /v1）
 * - 其它主机默认补 `/v1/chat/completions`
 */
export function resolveChatCompletionsEndpoint(
  raw: string,
  opts?: { preset?: string }
): string {
  const preset = (opts?.preset || '').toLowerCase();
  let s = (raw || '').trim();
  // Together 官方 OpenAI 兼容层已统一为 api.together.ai（见 docs.together.ai）；旧保存的 xyz 域名仍解析到同一路径
  s = s.replace(/^https?:\/\/api\.together\.xyz/i, 'https://api.together.ai');
  if (!s) {
    const pr = getCloudLlmPreset(preset);
    return pr?.chatEndpoint && preset !== 'custom' ? pr.chatEndpoint : '';
  }

  s = s.replace(/\/v1\/chat\/completions\/v1\/chat\/completions/gi, '/v1/chat/completions');
  s = s.replace(/\/chat\/completions\/chat\/completions/gi, '/chat/completions');

  try {
    if (!/^https?:\/\//i.test(s)) {
      s = `https://${s}`;
    }
    const u = new URL(s);
    const origin = u.origin;
    const host = u.hostname;
    let path = u.pathname.replace(/\/+$/, '') || '';
    const hostLower = host.toLowerCase();

    // 仅填写根域名 / 控制台 base 时，按各云厂商官方 OpenAI 兼容路径补全
    if (hostLower === 'dashscope.aliyuncs.com') {
      if (!path || path === '/' || /^\/v1$/i.test(path) || /^\/compatible-mode\/v1$/i.test(path)) {
        return 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
      }
    }
    if (hostLower === 'dashscope-intl.aliyuncs.com' || hostLower === 'dashscope-us.aliyuncs.com') {
      if (!path || path === '/' || /^\/v1$/i.test(path) || /^\/compatible-mode\/v1$/i.test(path)) {
        return `${origin}/compatible-mode/v1/chat/completions`;
      }
    }
    if (hostLower === 'generativelanguage.googleapis.com') {
      if (!path || path === '/' || /^\/v1beta\/openai$/i.test(path)) {
        return 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
      }
    }
    if (hostLower === 'qianfan.baidubce.com') {
      if (!path || path === '/' || path === '/v2') {
        return 'https://qianfan.baidubce.com/v2/chat/completions';
      }
    }
    if (hostLower === 'api.minimax.io') {
      if (!path || path === '/' || path === '/v1') {
        return 'https://api.minimax.io/v1/chat/completions';
      }
    }
    if (hostLower === 'api-inference.modelscope.cn') {
      if (!path || path === '/' || path === '/v1') {
        return 'https://api-inference.modelscope.cn/v1/chat/completions';
      }
    }
    if (/^ark\./i.test(hostLower) && hostLower.endsWith('.volces.com')) {
      if (!path || path === '/' || path === '/api' || path === '/api/v3') {
        return `${origin}/api/v3/chat/completions`;
      }
    }
    if (hostLower === 'api.hunyuan.cloud.tencent.com') {
      if (!path || path === '/' || path === '/v1') {
        return 'https://api.hunyuan.cloud.tencent.com/v1/chat/completions';
      }
    }
    if (hostLower === 'api.modelarts-maas.com') {
      if (!path || path === '/' || path === '/v1') {
        return 'https://api.modelarts-maas.com/v1/chat/completions';
      }
    }
    if (hostLower === 'api-ap-southeast-1.modelarts-maas.com') {
      if (!path || path === '/' || /^\/openai\/v1$/i.test(path)) {
        return 'https://api-ap-southeast-1.modelarts-maas.com/openai/v1/chat/completions';
      }
    }
    if (hostLower === 'api.fireworks.ai') {
      if (!path || path === '/' || path === '/inference' || path === '/inference/v1') {
        return 'https://api.fireworks.ai/inference/v1/chat/completions';
      }
    }
    if (hostLower === 'inference.baseten.co') {
      if (!path || path === '/' || path === '/v1') {
        return 'https://inference.baseten.co/v1/chat/completions';
      }
    }
    if (hostLower === 'api.sambanova.ai') {
      if (!path || path === '/' || path === '/v1') {
        return 'https://api.sambanova.ai/v1/chat/completions';
      }
    }
    if (hostLower === 'api.cerebras.ai') {
      if (!path || path === '/' || path === '/v1') {
        return 'https://api.cerebras.ai/v1/chat/completions';
      }
    }
    if (hostLower === 'openrouter.ai') {
      if (!path || path === '/' || path === '/api' || path === '/api/v1') {
        return 'https://openrouter.ai/api/v1/chat/completions';
      }
    }
    if (hostLower === 'api.perplexity.ai') {
      if (!path || path === '/') {
        return 'https://api.perplexity.ai/chat/completions';
      }
      if (path === '/v1') {
        return 'https://api.perplexity.ai/v1/chat/completions';
      }
    }

    if (isYueliaiHost(host) || preset === 'yueliai') {
      if (!path || path === '/') {
        return YUELIAI_CHAT_COMPLETIONS;
      }
      if (path === '/api' || path === '/api/yueliai') {
        return YUELIAI_CHAT_COMPLETIONS;
      }
      if (/\/api\/yueliai\/v1$/i.test(path)) {
        return `${origin}/api/yueliai/v1/completions`;
      }
      if (/\/api\/yueliai\/v1\/completions$/i.test(path)) {
        return `${origin}${path}`;
      }
      if (/\/completions$/i.test(path) && /yueliai/i.test(path)) {
        return `${origin}${path}`;
      }
    }

    if (path.toLowerCase() === '/v1/chat/completions') {
      if (isDeepseekHost(host) || preset === 'deepseek') {
        return `${origin}/chat/completions`;
      }
      return `${origin}/v1/chat/completions`;
    }
    if (/\/chat\/completions$/i.test(path)) {
      if (isDeepseekHost(host) || preset === 'deepseek') {
        return `${origin}/chat/completions`;
      }
      if (path !== '/chat/completions') {
        return `${origin}${path}`;
      }
      return `${origin}/v1/chat/completions`;
    }

    const treatAsDeepseek = preset === 'deepseek' || isDeepseekHost(host);
    if (treatAsDeepseek) {
      return `${origin}/chat/completions`;
    }

    if (/\/v1$/i.test(path)) {
      return `${origin}/v1/chat/completions`;
    }

    return `${origin}/v1/chat/completions`;
  } catch {
    if (/\/v1\/chat\/completions/i.test(s)) {
      return s.split('?')[0].replace(/([^/])\/+$/, '$1');
    }
    if (/\/chat\/completions/i.test(s)) {
      return s.split('?')[0].replace(/([^/])\/+$/, '$1');
    }
    const base = s.replace(/\/+$/, '').split('?')[0];
    if (preset === 'deepseek' || base.includes('deepseek.com')) {
      const originPart = base.replace(/\/v1.*$/i, '').replace(/\/chat-completions.*$/i, '');
      return `${originPart}/chat/completions`.replace(/([^:])\/\//g, '$1/');
    }
    return `${base}/v1/chat/completions`;
  }
}

/** 从已保存的 cloudProvider 行得到最终 chat URL（兼容仅有 presetId 的旧数据） */
export function resolveCloudProviderChatUrl(row: {
  apiUrl?: string;
  presetId?: string;
}): string {
  const preset = (row.presetId || '').toLowerCase();
  const raw = (row.apiUrl || '').trim();
  const fallback = getCloudLlmPreset(preset)?.chatEndpoint || '';
  return resolveChatCompletionsEndpoint(raw || fallback, { preset: preset || undefined });
}

/**
 * 从 chat completions 地址推导常见 OpenAI 兼容「模型列表」GET URL（用于拉取 /v1/models 类列表）。
 * 智谱等为 `…/v4/chat/completions` → `…/v4/models`；DeepSeek 根路径对话为 `…/chat/completions` → `…/v1/models`。
 */
export function resolveOpenAiCompatibleModelsListUrl(row: {
  apiUrl?: string;
  presetId?: string;
}): string {
  const chatUrl = resolveCloudProviderChatUrl(row);
  if (!chatUrl) return '';
  try {
    const u = new URL(chatUrl);
    const host = u.hostname.toLowerCase();
    const p = u.pathname.replace(/\/+$/, '') || '';

    if (host === 'api.perplexity.ai' && p.toLowerCase() === '/chat/completions') {
      return 'https://api.perplexity.ai/v1/models';
    }

    if (/\/chat\/completions$/i.test(p)) {
      const isDeepseekRoot =
        (host === 'api.deepseek.com' || host.endsWith('.deepseek.com')) &&
        p.toLowerCase() === '/chat/completions';
      if (isDeepseekRoot) {
        return `${u.origin}/v1/models`;
      }
      return `${u.origin}${p.replace(/\/chat\/completions$/i, '/models')}`;
    }
    return `${u.origin}/v1/models`;
  } catch {
    return '';
  }
}
