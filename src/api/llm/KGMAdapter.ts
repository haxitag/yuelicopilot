import { readOpenAiStreamIncludeUsagePreference } from '../services/streamRequestOptions';
import type { LLMAdapter, UnifiedChatParams } from './types';

export class KGMAdapter implements LLMAdapter {
  readonly providerId = 'kgm' as const;

  buildRequestBody(params: UnifiedChatParams & { toolCallHandler?: unknown }): Record<string, unknown> {
    const requestBody: Record<string, unknown> = {
      model: params.model,
      messages: params.messages,
      stream: params.stream !== false,
      kgm: {
        capabilities: {
          executeToolCalls: false
        }
      }
    };

    if (readOpenAiStreamIncludeUsagePreference()) {
      requestBody.stream_options = { include_usage: true };
    }

    // tools 由 apiService.prepareKgmOutboundPayload 决定：有定义则首轮下发 schema 以启动 FC
    if (params.tools && params.tools.length > 0 && params.toolCallHandler) {
      requestBody.tools = params.tools;
      requestBody.tool_choice = 'auto';
    }

    if (params.structured_output?.schema) {
      requestBody.response_format = {
        type: 'json_schema',
        json_schema: {
          name: params.structured_output.name,
          schema: params.structured_output.schema,
          strict: true
        }
      };
    }

    if (params.provider_hints?.claude?.thinking) {
      requestBody.thinking = params.provider_hints.claude.thinking;
    }
    if (params.provider_hints?.openai?.response_format) {
      requestBody.response_format = params.provider_hints.openai.response_format;
    }

    // KGM 聊天一律关闭 Ollama thinking：部分模型正文只在 thinking 通道，会导致 completion_tokens=0
    requestBody.think = false;
    const kgm = (requestBody.kgm as Record<string, unknown>) || {};
    const ollama =
      kgm.ollama && typeof kgm.ollama === 'object' ? (kgm.ollama as Record<string, unknown>) : {};
    requestBody.kgm = {
      ...kgm,
      ollama: { ...ollama, think: false }
    };

    if (requestBody.max_tokens == null) {
      let maxTokens = 2048;
      try {
        if (typeof localStorage !== 'undefined') {
          const raw = localStorage.getItem('kgmMaxTokens');
          if (raw) {
            const n = parseInt(raw, 10);
            if (Number.isFinite(n) && n > 0) maxTokens = Math.min(n, 32_768);
          }
        }
      } catch {
        /* ignore */
      }
      requestBody.max_tokens = maxTokens;
    }

    return requestBody;
  }

  resolveApiUrl(baseUrl: string, _isCloudProvider: boolean): string {
    return `${baseUrl.replace(/\/$/, '')}/v1/chat/completions`;
  }
}
