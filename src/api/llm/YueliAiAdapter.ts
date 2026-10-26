import { readOpenAiStreamIncludeUsagePreference } from '../services/streamRequestOptions';
import type { LLMAdapter, UnifiedChatParams } from './types';

/** Yueli AI 云端 OpenAI 兼容 /completions（无 KGM 扩展字段） */
export class YueliAiAdapter implements LLMAdapter {
  readonly providerId = 'yueliai' as const;

  buildRequestBody(params: UnifiedChatParams & { toolCallHandler?: unknown }): Record<string, unknown> {
    const requestBody: Record<string, unknown> = {
      model: params.model,
      messages: params.messages,
      stream: params.stream !== false
    };

    if (readOpenAiStreamIncludeUsagePreference()) {
      requestBody.stream_options = { include_usage: true };
    }

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

    if (requestBody.max_tokens == null) {
      requestBody.max_tokens = 2048;
    }

    return requestBody;
  }

  resolveApiUrl(chatCompletionsUrl: string, _isCloudProvider: boolean): string {
    return chatCompletionsUrl.replace(/\/+$/, '');
  }
}
