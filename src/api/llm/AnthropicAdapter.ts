import type { LLMAdapter, UnifiedChatParams, UnifiedChatMessage } from './types';
import { openAiToolsToAnthropic, openAiLikeMessagesToAnthropic } from './anthropicBridge';

function flattenSystemContent(content: UnifiedChatMessage['content']): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  return content
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p) => p.text)
    .join('\n');
}

function splitSystem(messages: UnifiedChatMessage[]): {
  system?: string;
  rest: UnifiedChatMessage[];
} {
  const sysChunks: string[] = [];
  const rest: UnifiedChatMessage[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      const t = flattenSystemContent(m.content);
      if (t) sysChunks.push(t);
    } else {
      rest.push(m);
    }
  }
  return {
    system: sysChunks.length ? sysChunks.join('\n\n') : undefined,
    rest
  };
}

/**
 * Anthropic Messages API（v1）：OpenAI 风格 messages（含 assistant.tool_calls / tool）→ Claude messages；
 * tools → Claude tools（input_schema）。
 */
export class AnthropicAdapter implements LLMAdapter {
  readonly providerId = 'anthropic' as const;

  resolveApiUrl(baseUrl: string, _isCloud?: boolean): string {
    return `${baseUrl.replace(/\/$/, '')}/v1/messages`;
  }

  buildRequestBody(params: UnifiedChatParams & { toolCallHandler?: unknown }): Record<string, unknown> {
    const { system, rest } = splitSystem(params.messages);

    const messages = openAiLikeMessagesToAnthropic(
      rest as Parameters<typeof openAiLikeMessagesToAnthropic>[0]
    );

    const tools = params.tools;
    const max_tokens = tools && tools.length > 0 ? 8192 : 4096;

    const body: Record<string, unknown> = {
      model: params.model,
      max_tokens,
      stream: params.stream !== false,
      messages
    };

    if (system) body.system = system;

    if (tools && tools.length > 0) {
      body.tools = openAiToolsToAnthropic(tools);
      body.tool_choice = { type: 'auto' };
    }

    const thinking = params.provider_hints?.claude?.thinking;
    if (thinking) {
      body.thinking = thinking;
    }

    return body;
  }
}
