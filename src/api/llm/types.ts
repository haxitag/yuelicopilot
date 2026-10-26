export type LLMProviderId = 'kgm' | 'ollama' | 'anthropic' | 'openai' | 'yueliai';

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: unknown;
  };
}

export type MultimodalContentPart =
  | { type: 'text'; text: string }
  | {
      type: 'image_url';
      image_url: { url: string; detail?: 'auto' | 'low' | 'high' };
    };

export interface UnifiedChatMessage {
  role: string;
  /** 纯文本或与 OpenAI Chat Completions 对齐的多模态块（经由 Adapter 转为各厂商格式） */
  content?: string | null | MultimodalContentPart[];
  tool_calls?: unknown[];
  tool_call_id?: string;
  reasoning_content?: string;
}

export interface UnifiedChatParams {
  model: string;
  messages: UnifiedChatMessage[];
  system?: string;
  tools?: ToolDefinition[];
  stream?: boolean;
  structured_output?: { name: string; schema: Record<string, unknown> };
  provider_hints?: {
    claude?: {
      thinking?: { type: 'enabled'; budget_tokens: number };
      prefill?: string;
    };
    openai?: {
      response_format?: { type: 'json_schema'; json_schema: Record<string, unknown> };
    };
  };
}

export interface LLMAdapter {
  readonly providerId: LLMProviderId;
  buildRequestBody(params: UnifiedChatParams & { toolCallHandler?: unknown }): Record<string, unknown>;
  resolveApiUrl(baseUrl: string, isCloudProvider: boolean): string;
}
