import type { ToolDefinition } from './types';

/** Anthropic Messages API — tools 定义（OpenAI tools → Claude） */
export function openAiToolsToAnthropic(tools: ToolDefinition[]): Record<string, unknown>[] {
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description || '',
    input_schema:
      t.function.parameters && typeof t.function.parameters === 'object'
        ? t.function.parameters
        : { type: 'object', properties: {} }
  }));
}

function userContentBlocksFromUnknown(content: unknown): unknown[] {
  if (content == null) return [{ type: 'text', text: '' }];
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  if (!Array.isArray(content)) return [{ type: 'text', text: String(content) }];
  return content.map((part: any) => {
    if (part?.type === 'text') return { type: 'text', text: String(part.text ?? '') };
    if (part?.type === 'image_url' && part.image_url?.url) {
      return { type: 'image', source: { type: 'url', url: part.image_url.url } };
    }
    return { type: 'text', text: '' };
  });
}

/**
 * 将应用内 OpenAI 风格对话（含 assistant.tool_calls / tool）转为 Anthropic messages 数组。
 * system 由调用方单独传入，不在此列表中。
 */
export function openAiLikeMessagesToAnthropic(
  messages: Array<{
    role: string;
    content?: unknown;
    tool_calls?: Array<{
      id: string;
      type?: string;
      function: { name: string; arguments?: string };
    }>;
    tool_call_id?: string;
  }>
): Array<{ role: 'user' | 'assistant'; content: unknown }> {
  const out: Array<{ role: 'user' | 'assistant'; content: unknown }> = [];
  let i = 0;

  while (i < messages.length) {
    const m = messages[i];
    if (m.role === 'user') {
      out.push({ role: 'user', content: userContentBlocksFromUnknown(m.content) });
      i++;
      continue;
    }

    if (m.role === 'assistant') {
      const toolCalls = m.tool_calls;
      if (Array.isArray(toolCalls) && toolCalls.length > 0) {
        const parts: unknown[] = [];
        if (m.content != null && m.content !== '') {
          const s = typeof m.content === 'string' ? m.content : '';
          if (s) parts.push({ type: 'text', text: s });
        }
        for (const tc of toolCalls) {
          let input: Record<string, unknown> = {};
          try {
            input =
              typeof tc.function?.arguments === 'string'
                ? (JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>)
                : {};
          } catch {
            input = {};
          }
          parts.push({
            type: 'tool_use',
            id: tc.id,
            name: tc.function.name,
            input
          });
        }
        out.push({ role: 'assistant', content: parts });
        i++;

        const toolResults: unknown[] = [];
        while (i < messages.length && messages[i].role === 'tool') {
          const tm = messages[i];
          toolResults.push({
            type: 'tool_result',
            tool_use_id: tm.tool_call_id,
            content: typeof tm.content === 'string' ? tm.content : JSON.stringify(tm.content ?? '')
          });
          i++;
        }
        if (toolResults.length > 0) {
          out.push({ role: 'user', content: toolResults });
        }
      } else {
        const c = m.content;
        if (typeof c === 'string') {
          out.push({ role: 'assistant', content: [{ type: 'text', text: c }] });
        } else if (Array.isArray(c)) {
          out.push({ role: 'assistant', content: userContentBlocksFromUnknown(c) });
        } else {
          out.push({ role: 'assistant', content: [{ type: 'text', text: '' }] });
        }
        i++;
      }
      continue;
    }

    if (m.role === 'tool') {
      out.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: m.tool_call_id,
            content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '')
          }
        ]
      });
      i++;
      continue;
    }

    i++;
  }

  return out;
}

export interface ParsedAnthropicToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}
