import { KGMAdapter } from './KGMAdapter';
import { OllamaAdapter } from './OllamaAdapter';
import { AnthropicAdapter } from './AnthropicAdapter';
import { YueliAiAdapter } from './YueliAiAdapter';
import type { LLMAdapter, LLMProviderId } from './types';

export function createLLMAdapter(provider: LLMProviderId): LLMAdapter {
  switch (provider) {
    case 'kgm':
      return new KGMAdapter();
    case 'ollama':
      return new OllamaAdapter();
    case 'anthropic':
      return new AnthropicAdapter();
    case 'openai':
      return new KGMAdapter();
    case 'yueliai':
      return new YueliAiAdapter();
    default: {
      const _exhaustive: never = provider;
      return _exhaustive;
    }
  }
}
