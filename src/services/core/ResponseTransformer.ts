import { ApiProvider } from '../../api/services/apiService';
import { debugManager } from '../DebugManager';

export type ResponseProvider = ApiProvider | 'internal' | 'unknown';

/**
 * 标准化的响应结果
 */
export interface NormalizedResponse {
  type: 'content' | 'tool_call' | 'thinking' | 'error';
  content?: string;
  toolCalls?: Array<{
    id: string;
    name: string;
    arguments: Record<string, any>;
    skillId?: string;
  }>;
  thinking?: string;
  reasoning?: string;
  sources?: Array<{ name: string; type: string; url?: string }>;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  metadata?: {
    provider: ResponseProvider;
    model?: string;
    timestamp: number;
    finishReason?: string;
  };
}

/**
 * 响应转换规则
 */
export interface TransformRule {
  name: string;
  condition: (rawData: any) => boolean;
  transform: (rawData: any, context?: TransformContext) => Partial<NormalizedResponse>;
}

export interface TransformContext {
  provider: ApiProvider;
  model?: string;
  sessionId?: string;
}

/**
 * 响应转换器 - 实现LLM响应的规则化转换和包装
 */
export class ResponseTransformer {
  private rules: TransformRule[] = [];

  constructor() {
    this.initializeDefaultRules();
  }

  /**
   * 初始化默认转换规则
   */
  private initializeDefaultRules(): void {
    // 1. KGM OpenAI格式响应
    this.addRule({
      name: 'kgm-openai-format',
      condition: (data) => data.choices && data.choices[0],
      transform: (data, context) => {
        const choice = data.choices[0];
        const delta = choice.delta || choice.message || {};
        const result: Partial<NormalizedResponse> = {
          type: 'content',
          metadata: {
            provider: context?.provider || 'kgm',
            model: context?.model,
            timestamp: Date.now(),
            finishReason: choice.finish_reason
          }
        };

        if (delta.content) {
          result.content = delta.content;
        }

        if (delta.thinking || data.thinking) {
          result.thinking = delta.thinking || data.thinking;
        }

        if (delta.reasoning_content || data.reasoning_content) {
          result.reasoning = delta.reasoning_content || data.reasoning_content;
        }

        // 处理工具调用
        if (delta.tool_calls && delta.tool_calls.length > 0) {
          result.type = 'tool_call';
          result.toolCalls = delta.tool_calls.map((tc: any, idx: number) => ({
            id: tc.id || `call_${idx}_${Date.now()}`,
            name: tc.function?.name || '',
            // P0-5: 使用安全解析防止无效 JSON 导致崩溃
            arguments: typeof tc.function?.arguments === 'string'
              ? this.safeParseJSON(tc.function.arguments, {})
              : tc.function?.arguments || {}
          }));
        }

        // 收集引用来源
        if (data.sources && Array.isArray(data.sources)) {
          result.sources = data.sources.map((s: any) => ({
            name: s.name || s.title || 'Unknown',
            type: s.type || 'reference',
            url: s.url
          }));
        } else if (data.kgm?.sources && Array.isArray(data.kgm.sources)) {
          result.sources = data.kgm.sources.map((s: any) => ({
            name: s.name || s.title || 'Unknown',
            type: s.type || 'reference',
            url: s.url
          }));
        }

        return result;
      }
    });

    // 2. KGM 扩展意图格式
    this.addRule({
      name: 'kgm-intent-format',
      condition: (data) => data.kgm?.tool_trace || data.kgm?.intent,
      transform: (data, context) => {
        const kgmTrace = data.kgm?.tool_trace || data.kgm?.intent;
        if (!Array.isArray(kgmTrace)) return {};

        const toolCalls = kgmTrace
          .filter((intent: any) => intent.type === 'call' || intent.type === 'invoke_skill')
          .map((intent: any, idx: number) => ({
            id: intent.id || `kgm_call_${idx}_${Date.now()}`,
            name: intent.name || intent.skill || '',
            // P0-5: 使用安全解析防止无效 JSON 导致崩溃
            arguments: typeof intent.arguments === 'string'
              ? this.safeParseJSON(intent.arguments, {})
              : intent.arguments || intent.params || {},
            skillId: intent.skill
          }));

        if (toolCalls.length === 0) return {};

        return {
          type: 'tool_call',
          toolCalls,
          metadata: {
            provider: context?.provider || 'kgm',
            model: context?.model,
            timestamp: Date.now()
          }
        };
      }
    });

    // 3. Ollama 格式响应
    this.addRule({
      name: 'ollama-format',
      condition: (data) => data.message && !data.choices,
      transform: (data, context) => {
        const msg = data.message;
        const result: Partial<NormalizedResponse> = {
          type: 'content',
          metadata: {
            provider: context?.provider || 'ollama',
            model: context?.model,
            timestamp: Date.now()
          }
        };

        if (msg.content) {
          result.content = msg.content;
        }

        if (msg.thinking) {
          result.thinking = msg.thinking;
        }

        if (msg.reasoning_content) {
          result.reasoning = msg.reasoning_content;
        }

        // 处理 Ollama 工具调用
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          result.type = 'tool_call';
          result.toolCalls = msg.tool_calls.map((tc: any, idx: number) => ({
            id: tc.id || `call_${idx}_${Date.now()}`,
            name: tc.function?.name || tc.name || '',
            // P0-5: 使用安全解析防止无效 JSON 导致崩溃
            arguments: typeof tc.function?.arguments === 'string'
              ? this.safeParseJSON(tc.function.arguments, {})
              : tc.function?.arguments || tc.arguments || {}
          }));
        }

        return result;
      }
    });

    // 3b. Ollama /api/generate 流式 NDJSON（逐 token 在 `response` 字段，而非 /api/chat 的 `message`）
    // ApiService 在 provider=ollama 时使用 /api/generate；缺少本规则会落入默认分支把整段 JSON 当正文。
    this.addRule({
      name: 'ollama-generate-stream',
      condition: (data) => typeof data?.response === 'string' && !data?.choices,
      transform: (data, context) => ({
        type: 'content' as const,
        content: data.response,
        metadata: {
          provider: context?.provider || 'ollama',
          model: data.model || context?.model,
          timestamp: Date.now(),
          finishReason: data.done === true ? 'stop' : undefined
        }
      })
    });

    // 3c. Ollama /api/generate 结束帧：常见为 {"model":"...","done":true} 不含 response，避免走默认 JSON.stringify
    this.addRule({
      name: 'ollama-generate-done',
      condition: (data) =>
        data?.done === true &&
        !data?.choices &&
        !data?.message &&
        typeof data?.model === 'string' &&
        typeof data?.response !== 'string',
      transform: (data, context) => ({
        type: 'content' as const,
        metadata: {
          provider: context?.provider || 'ollama',
          model: data.model || context?.model,
          timestamp: Date.now(),
          finishReason: 'stop'
        }
      })
    });

    // 4. 工具执行状态通知
    this.addRule({
      name: 'tool-executing',
      condition: (data) => data.tool_call_executing,
      transform: (data) => ({
        type: 'tool_call',
        toolCalls: [{
          id: data.tool_call_executing.id || `exec_${Date.now()}`,
          name: data.tool_call_executing.name,
          arguments: data.tool_call_executing.args || {}
        }],
        metadata: {
          provider: 'internal',
          timestamp: Date.now()
        }
      })
    });

    // 5. 工具执行结果
    this.addRule({
      name: 'tool-result',
      condition: (data) => data.tool_call_result,
      transform: (data) => ({
        type: 'content',
        content: `\n\n✅ **工具结果** (\`${data.tool_call_result.name}\`):\n\`\`\`\n${data.tool_call_result.result}\n\`\`\`\n`,
        metadata: {
          provider: 'internal',
          timestamp: Date.now()
        }
      })
    });

    // 6. 工具执行错误
    this.addRule({
      name: 'tool-error',
      condition: (data) => data.tool_call_error,
      transform: (data) => ({
        type: 'error',
        error: {
          code: 'TOOL_EXECUTION_ERROR',
          message: `工具执行失败: ${data.tool_call_error.error}`,
          details: {
            toolName: data.tool_call_error.name,
            toolId: data.tool_call_error.id
          }
        },
        metadata: {
          provider: 'internal',
          timestamp: Date.now()
        }
      })
    });

    // 7. 纯文本内容响应
    this.addRule({
      name: 'plain-content',
      condition: (data) => typeof data === 'string' || (data.content && !data.choices && !data.message),
      transform: (data, context) => ({
        type: 'content',
        content: typeof data === 'string' ? data : data.content,
        metadata: {
          provider: context?.provider || 'unknown',
          timestamp: Date.now()
        }
      })
    });
  }

  /**
   * 添加自定义转换规则
   */
  addRule(rule: TransformRule): void {
    this.rules.push(rule);
  }

  /**
   * 移除转换规则
   */
  removeRule(name: string): void {
    this.rules = this.rules.filter(r => r.name !== name);
  }

  /**
   * 安全地将对象转换为字符串，处理循环引用
   */
  private safeStringify(obj: any): string {
    try {
      return JSON.stringify(obj, (key, value) => {
        if (typeof value === 'bigint') {
          return value.toString();
        }
        if (value instanceof Error) {
          return {
            name: value.name,
            message: value.message,
            stack: value.stack
          };
        }
        return value;
      }, 2);
    } catch (e) {
      return String(obj);
    }
  }
  
  /**
   * P0-5: 安全解析 JSON 字符串，防止无效 JSON 导致崩溃
   */
  private safeParseJSON(str: string, fallback: any = {}): any {
    if (!str || typeof str !== 'string') {
      return fallback;
    }
    try {
      return JSON.parse(str);
    } catch (e) {
      console.warn('[ResponseTransformer] JSON parse error:', e);
      return fallback;
    }
  }

  /**
   * 应用规则转换原始响应
   */
  transform(rawData: any, context?: TransformContext): NormalizedResponse {
    // 记录原始响应数据
    debugManager.logTransform('原始响应数据', {
      provider: context?.provider,
      model: context?.model,
      rawData: this.safeStringify(rawData)
    });

    // 找到第一个匹配的规则并应用
    for (const rule of this.rules) {
      if (rule.condition(rawData)) {
        if (import.meta.env.DEV) {
          console.log(`🔄 应用转换规则: ${rule.name}`);
        }
        const partial = rule.transform(rawData, context);
        const result = this.completeResponse(partial, context);
        
        // 记录转换结果
        debugManager.logTransform('转换结果', {
          rule: rule.name,
          result: this.safeStringify(result)
        });
        
        return result;
      }
    }

    // 默认处理：返回原始数据作为内容
    if (import.meta.env.DEV) {
      console.log('🔄 使用默认转换规则');
    }
    const result = this.completeResponse({
      type: 'content',
      content: typeof rawData === 'string' ? rawData : JSON.stringify(rawData),
      metadata: {
        provider: context?.provider || 'unknown',
        timestamp: Date.now()
      }
    }, context);
    
    // 记录转换结果
    debugManager.logTransform('转换结果（默认规则）', {
      rule: 'default',
      result: this.safeStringify(result)
    });
    
    return result;
  }

  /**
   * 补全响应对象，确保所有必要字段都存在
   */
  private completeResponse(partial: Partial<NormalizedResponse>, context?: TransformContext): NormalizedResponse {
    return {
      type: partial.type || 'content',
      content: partial.content,
      toolCalls: partial.toolCalls,
      thinking: partial.thinking,
      reasoning: partial.reasoning,
      sources: partial.sources,
      error: partial.error,
      metadata: {
        provider: partial.metadata?.provider || context?.provider || 'unknown',
        model: partial.metadata?.model || context?.model,
        timestamp: partial.metadata?.timestamp || Date.now(),
        finishReason: partial.metadata?.finishReason
      }
    };
  }

  /**
   * 批量转换多个响应
   */
  transformBatch(rawDataArray: any[], context?: TransformContext): NormalizedResponse[] {
    return rawDataArray.map(data => this.transform(data, context));
  }

  /**
   * 合并多个响应为一个
   */
  mergeResponses(responses: NormalizedResponse[]): NormalizedResponse {
    const merged: NormalizedResponse = {
      type: 'content',
      metadata: {
        provider: responses[0]?.metadata?.provider || 'unknown',
        timestamp: Date.now()
      }
    };

    for (const resp of responses) {
      if (resp.content) {
        merged.content = (merged.content || '') + resp.content;
      }
      if (resp.thinking) {
        merged.thinking = (merged.thinking || '') + resp.thinking;
      }
      if (resp.reasoning) {
        merged.reasoning = (merged.reasoning || '') + resp.reasoning;
      }
      if (resp.toolCalls && resp.toolCalls.length > 0) {
        merged.type = 'tool_call';
        // P1-5: 添加去重逻辑，防止重复的 tool call ID
        const existingIds = new Set((merged.toolCalls || []).map(tc => tc.id));
        const newToolCalls = resp.toolCalls.filter(tc => !existingIds.has(tc.id));
        merged.toolCalls = [...(merged.toolCalls || []), ...newToolCalls];
      }
      if (resp.sources && resp.sources.length > 0) {
        const existing = merged.sources || [];
        const seen = new Set(existing.map((s) => `${s.type}::${s.name}::${s.url || ''}`));
        const dedupedNew = resp.sources.filter((s) => {
          const key = `${s.type}::${s.name}::${s.url || ''}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        merged.sources = [...existing, ...dedupedNew];
      }
      if (resp.error) {
        merged.type = 'error';
        merged.error = resp.error;
      }
    }

    return merged;
  }

  /**
   * 格式化响应为用户友好的输出
   */
  formatForDisplay(response: NormalizedResponse): string {
    let result = '';

    switch (response.type) {
      case 'content':
        result = response.content || '';
        if (response.thinking) {
          result = `💭 ${response.thinking}\n\n${result}`;
        }
        if (response.sources && response.sources.length > 0) {
          const sourcesList = response.sources.map(s => `- ${s.name}${s.url ? ` (${s.url})` : ''}`).join('\n');
          result += `\n\n📚 参考来源:\n${sourcesList}`;
        }
        break;

      case 'tool_call':
        if (response.toolCalls && response.toolCalls.length > 0) {
          result = response.toolCalls.map(tc => 
            `🔧 **调用工具**: \`${tc.name}\`\n\`\`\`json\n${JSON.stringify(tc.arguments, null, 2)}\n\`\`\``
          ).join('\n\n');
        }
        break;

      case 'thinking':
        result = `💭 ${response.thinking || ''}`;
        break;

      case 'error':
        result = `❌ **错误**: ${response.error?.message || '未知错误'}`;
        if (response.error?.details) {
          result += `\n\`\`\`json\n${JSON.stringify(response.error.details, null, 2)}\n\`\`\``;
        }
        break;
    }

    return result;
  }

  /**
   * 验证响应格式是否符合预期
   */
  validate(response: NormalizedResponse): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!response.type || !['content', 'tool_call', 'thinking', 'error'].includes(response.type)) {
      errors.push('Invalid response type');
    }

    if (response.type === 'tool_call' && (!response.toolCalls || response.toolCalls.length === 0)) {
      errors.push('Tool call response must have toolCalls');
    }

    if (response.toolCalls) {
      response.toolCalls.forEach((tc, idx) => {
        if (!tc.name) errors.push(`Tool call ${idx} missing name`);
        // P1-4: 加强 id 检查，确保 id 存在且非空字符串
        if (!tc.id || typeof tc.id !== 'string') {
          errors.push(`Tool call ${idx} missing id`);
        } else if (tc.id.trim() === '') {
          errors.push(`Tool call ${idx} has empty id`);
        }
      });
    }

    if (response.type === 'error' && !response.error) {
      errors.push('Error response must have error object');
    }

    return { valid: errors.length === 0, errors };
  }
}

// 创建全局单例
export const responseTransformer = new ResponseTransformer();
export default ResponseTransformer;
