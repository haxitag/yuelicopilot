import { useMemo } from 'react';
import {
  resolveInferenceRoute,
  type InferenceRoutePlan
} from '../services/chat/InferenceRouter';
import type { ChatProvider } from '../services/chat/ModelOptions';

export function useChatRoutePlan(
  provider: ChatProvider | string,
  model: string
): InferenceRoutePlan {
  return useMemo(
    () => resolveInferenceRoute(provider as ChatProvider, model),
    [provider, model]
  );
}
