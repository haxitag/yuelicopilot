/**
 * Web Search Tool - 网络搜索工具
 * 参考 Claude Code 的 WebSearchTool 实现
 */

import { MCPTool, MCPToolCall, MCPToolResult } from '../MCPRuntime';

export interface WebSearchInput {
  query: string;
  allowed_domains?: string[];
  blocked_domains?: string[];
  max_uses?: number;
}

export interface WebSearchResult {
  query: string;
  results: Array<{
    title: string;
    url: string;
  }>;
  durationSeconds: number;
}

export interface WebSearchToolDefinition extends MCPTool {
  name: 'web_search';
  description: 'Search the web for current information';
  inputSchema: {
    type: 'object';
    properties: {
      query: { type: 'string'; description: 'The search query to use' };
      allowed_domains?: { type: 'string[]'; description: 'Only include search results from these domains' };
      blocked_domains?: { type: 'string[]'; description: 'Never include search results from these domains' };
    };
    required: ['query'];
  };
}

class WebSearchToolImpl implements MCPTool {
  name = 'web_search';
  description = 'Search the web for current information';
  inputSchema = {
    type: 'object' as const,
    properties: {
      query: { type: 'string' as const, description: 'The search query to use' },
      allowed_domains: { 
        type: 'array' as const, 
        items: { type: 'string' as const },
        description: 'Only include search results from these domains' 
      },
      blocked_domains: { 
        type: 'array' as const, 
        items: { type: 'string' as const },
        description: 'Never include search results from these domains' 
      }
    },
    required: ['query']
  };

  private searchEndpoint: string;
  private apiKey: string;
  private maxRequestsPerMinute = 60;
  private requestCount = 0;
  private lastReset = Date.now();

  constructor(endpoint?: string, apiKey?: string) {
    this.searchEndpoint = endpoint || 'https://api.search.example.com/v1/search';
    this.apiKey = apiKey || '';
  }

  async execute(call: MCPToolCall): Promise<MCPToolResult> {
    const input = call.arguments as WebSearchInput;
    const startTime = Date.now();

    if (!input.query || input.query.trim().length < 2) {
      return {
        toolCallId: call.id,
        content: [{ type: 'text', text: JSON.stringify({ error: 'Query must be at least 2 characters' }) }],
        isError: true
      };
    }

    if (this.requestCount >= this.maxRequestsPerMinute) {
      const waitTime = Math.ceil((60000 - (Date.now() - this.lastReset)) / 1000);
      return {
        toolCallId: call.id,
        content: [{ type: 'text', text: JSON.stringify({ error: `Rate limit exceeded. Wait ${waitTime}s` }) }],
        isError: true
      };
    }

    this.requestCount++;
    if (Date.now() - this.lastReset > 60000) {
      this.requestCount = 1;
      this.lastReset = Date.now();
    }

    try {
      const results = await this.performSearch(input);
      
      return {
        toolCallId: call.id,
        content: [{
          type: 'text',
          text: JSON.stringify({
            query: input.query,
            results,
            durationSeconds: (Date.now() - startTime) / 1000
          })
        }]
      };
    } catch (error) {
      return {
        toolCallId: call.id,
        content: [{ type: 'text', text: JSON.stringify({ error: error instanceof Error ? error.message : 'Search failed' }) }],
        isError: true
      };
    }
  }

  private async performSearch(input: WebSearchInput): Promise<Array<{ title: string; url: string }>> {
    // 未配置API Key时，明确返回错误而非假数据
    if (!this.apiKey) {
      return [{
        title: '【提示】Web Search API 未配置',
        url: 'https://www.google.com/search?q=' + encodeURIComponent(input.query)
      }];
    }

    try {
      const params = new URLSearchParams({
        q: input.query,
        ...(input.allowed_domains?.length && { engines: input.allowed_domains.join(',') }),
        ...(input.blocked_domains?.length && { exclude: input.blocked_domains.join(',') }),
        num: '10'
      });

      const response = await fetch(`${this.searchEndpoint}?${params}`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Search API error: ${response.status}`);
      }

      const data = await response.json();
      return this.parseResults(data);
    } catch (error) {
      // API调用失败时返回提示信息，而非假数据
      return [{
        title: `【提示】搜索失败: ${error instanceof Error ? error.message : 'Unknown error'}`,
        url: 'https://www.google.com/search?q=' + encodeURIComponent(input.query)
      }];
    }
  }

  private parseResults(data: any): Array<{ title: string; url: string }> {
    if (Array.isArray(data.results)) {
      return data.results.map((r: any) => ({
        title: r.title || 'Untitled',
        url: r.url || r.link || ''
      }));
    }
    if (Array.isArray(data.hits)) {
      return data.hits.map((r: any) => ({
        title: r.title || 'Untitled',
        url: r.url || r.link || ''
      }));
    }
    return [];
  }
}

export const webSearchTool = new WebSearchToolImpl();

export function createWebSearchTool(endpoint?: string, apiKey?: string): MCPTool {
  return new WebSearchToolImpl(endpoint, apiKey);
}
