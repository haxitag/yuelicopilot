/**
 * Web Fetch Tool - URL 内容获取工具
 * 参考 Claude Code 的 WebFetchTool 实现
 */

import { MCPTool, MCPToolCall, MCPToolResult } from '../MCPRuntime';

export interface WebFetchInput {
  url: string;
  prompt?: string;
  max_length?: number;
}

export interface WebFetchResult {
  url: string;
  content: string;
  bytes: number;
  code: number;
  codeText: string;
  durationMs: number;
}

class WebFetchToolImpl implements MCPTool {
  name = 'web_fetch';
  description = 'Fetch content from a URL and optionally process it with a prompt';
  inputSchema = {
    type: 'object' as const,
    properties: {
      url: { type: 'string' as const, description: 'The URL to fetch content from' },
      prompt: { type: 'string' as const, description: 'Optional prompt to process the content' },
      max_length: { type: 'number' as const, description: 'Maximum content length to return', default: 50000 }
    },
    required: ['url']
  };

  private preapprovedHosts = new Set([
    'wikipedia.org',
    'github.com',
    'stackoverflow.com',
    'medium.com',
    'dev.to',
    'docs.example.com',
    'api.example.com'
  ]);

  async execute(call: MCPToolCall): Promise<MCPToolResult> {
    const input = call.arguments as WebFetchInput;
    const startTime = Date.now();

    try {
      const url = new URL(input.url);
      
      if (!this.isValidProtocol(url.protocol)) {
        return this.errorResult(call.id, input.url, 400, 'Only HTTP/HTTPS protocols are supported');
      }

      if (!this.isPreapprovedHost(url.hostname) && !this.validateHost(url.hostname)) {
        return this.errorResult(call.id, input.url, 403, `Host ${url.hostname} is not preapproved for fetching`);
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);

      try {
        const response = await fetch(input.url, {
          headers: {
            'User-Agent': 'YueliCopilot/1.0',
            'Accept': 'text/html,application/xhtml+xml,text/plain,*/*'
          },
          signal: controller.signal
        });

        clearTimeout(timeout);

        if (!response.ok) {
          return this.errorResult(call.id, input.url, response.status, response.statusText);
        }

        const contentType = response.headers.get('content-type') || '';
        const isTextContent = contentType.includes('text') || 
                             contentType.includes('json') ||
                             contentType.includes('xml');

        if (!isTextContent) {
          return this.errorResult(call.id, input.url, 415, 'Unsupported media type');
        }

        let text = await response.text();
        const maxLength = input.max_length || 50000;
        if (text.length > maxLength) {
          text = text.slice(0, maxLength) + '\n...[content truncated]';
        }

        const cleaned = this.cleanHtml(text);
        let finalContent = cleaned;

        if (input.prompt) {
          finalContent = `Fetched from: ${input.url}\n\n${cleaned}\n\n---\nPrompt: ${input.prompt}\n\nProcessed content:\n`;
        }

        return {
          toolCallId: call.id,
          content: [{
            type: 'text',
            text: JSON.stringify({
              url: input.url,
              content: finalContent,
              bytes: new TextEncoder().encode(finalContent).length,
              code: response.status,
              codeText: response.statusText,
              durationMs: Date.now() - startTime
            })
          }]
        };
      } catch (error) {
        clearTimeout(timeout);
        throw error;
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        return this.errorResult(call.id, input.url, 408, 'Request timeout');
      }
      return this.errorResult(call.id, input.url, 500, error instanceof Error ? error.message : 'Fetch failed');
    }
  }

  private isValidProtocol(protocol: string): boolean {
    return protocol === 'http:' || protocol === 'https:';
  }

  private isPreapprovedHost(hostname: string): boolean {
    return this.preapprovedHosts.has(hostname);
  }

  private validateHost(_hostname: string): boolean {
    return true;
  }

  private cleanHtml(html: string): string {
    let text = html;
    
    text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    text = text.replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, '');
    text = text.replace(/<!--[\s\S]*?-->/g, '');
    
    text = text.replace(/<[^>]+>/g, ' ');
    text = text.replace(/&nbsp;/g, ' ');
    text = text.replace(/&amp;/g, '&');
    text = text.replace(/&lt;/g, '<');
    text = text.replace(/&gt;/g, '>');
    text = text.replace(/&quot;/g, '"');
    text = text.replace(/&#39;/g, "'");
    
    text = text.replace(/\s+/g, ' ').trim();
    
    return text;
  }

  private errorResult(toolCallId: string, url: string, code: number, message: string): MCPToolResult {
    return {
      toolCallId,
      content: [{
        type: 'text',
        text: JSON.stringify({
          url,
          error: message,
          code,
          codeText: message
        })
      }],
      isError: true
    };
  }
}

export const webFetchTool = new WebFetchToolImpl();

export function createWebFetchTool(): MCPTool {
  return new WebFetchToolImpl();
}
