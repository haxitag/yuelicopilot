import { readOllamaThinkModePreference } from '../services/ollamaThinkOptions';
import type { LLMAdapter, UnifiedChatParams } from './types';

export class OllamaAdapter implements LLMAdapter {
  readonly providerId = 'ollama' as const;

  buildRequestBody(params: UnifiedChatParams): Record<string, unknown> {
    const prompt = params.messages
      .map((m) => {
        const role =
          m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Assistant' : m.role;
        return `[${role}] ${m.content || ''}`;
      })
      .join('\n');

    return {
      model: params.model,
      prompt,
      stream: params.stream !== false,
      think: readOllamaThinkModePreference(),
      options: {
        temperature: 0.7,
        num_predict: 2048
      }
    };
  }

  resolveApiUrl(baseUrl: string): string {
    return `${baseUrl.replace(/\/$/, '')}/api/generate`;
  }
}
