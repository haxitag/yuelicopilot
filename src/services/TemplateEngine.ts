import {
  OutputTemplate,
  TemplateVariable,
  TemplateRenderContext,
  RenderedOutput,
} from '../types';

export class TemplateEngine {
  private templates: Map<string, OutputTemplate> = new Map();

  constructor() {
    this.initializeDefaultTemplates();
  }

  private initializeDefaultTemplates() {
    // 默认Markdown模板
    const defaultMarkdownTemplate: OutputTemplate = {
      id: 'default-markdown',
      name: '默认Markdown模板',
      type: 'markdown',
      format: `# {{title}}

{{content}}

---
*生成时间: {{timestamp}}*`,
      variables: [
        {
          name: 'title',
          type: 'string',
          required: true,
          description: '标题',
        },
        {
          name: 'content',
          type: 'string',
          required: true,
          description: '内容',
        },
        {
          name: 'timestamp',
          type: 'string',
          required: false,
          description: '时间戳',
          defaultValue: new Date().toLocaleString(),
        },
      ],
      description: '标准的Markdown输出模板',
    };
    
    this.templates.set('default-markdown', defaultMarkdownTemplate);

    // 报告HTML模板
    const reportHtmlTemplate: OutputTemplate = {
      id: 'report-html',
      name: '报告HTML模板',
      type: 'html',
      format: `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>{{title}}</title>
  <style>
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      max-width: 800px;
      margin: 0 auto;
      padding: 40px 20px;
      line-height: 1.6;
      color: #333;
    }
    .header {
      text-align: center;
      margin-bottom: 40px;
      padding-bottom: 20px;
      border-bottom: 2px solid #4A90E2;
    }
    .title {
      font-size: 2.5em;
      color: #2C3E50;
      margin-bottom: 10px;
    }
    .subtitle {
      color: #7F8C8D;
      font-size: 1.1em;
    }
    .content {
      margin: 30px 0;
    }
    .section {
      margin: 25px 0;
    }
    .section-title {
      color: #4A90E2;
      font-size: 1.5em;
      margin-bottom: 15px;
      padding-bottom: 8px;
      border-bottom: 1px solid #E0E0E0;
    }
    .footer {
      margin-top: 40px;
      padding-top: 20px;
      border-top: 1px solid #E0E0E0;
      text-align: center;
      color: #7F8C8D;
      font-size: 0.9em;
    }
    .data-table {
      width: 100%;
      border-collapse: collapse;
      margin: 15px 0;
    }
    .data-table th, .data-table td {
      border: 1px solid #E0E0E0;
      padding: 12px;
      text-align: left;
    }
    .data-table th {
      background-color: #F5F7FA;
      font-weight: 600;
    }
    .data-table tr:nth-child(even) {
      background-color: #FAFBFC;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1 class="title">{{title}}</h1>
    {{#if subtitle}}
    <p class="subtitle">{{subtitle}}</p>
    {{/if}}
  </div>
  
  <div class="content">
    {{content}}
    
    {{#if sections}}
      {{#each sections}}
      <div class="section">
        <h2 class="section-title">{{title}}</h2>
        {{content}}
      </div>
      {{/each}}
    {{/if}}
    
    {{#if table}}
    <table class="data-table">
      <thead>
        <tr>
          {{#each table.headers}}
          <th>{{this}}</th>
          {{/each}}
        </tr>
      </thead>
      <tbody>
        {{#each table.rows}}
        <tr>
          {{#each this}}
          <td>{{this}}</td>
          {{/each}}
        </tr>
        {{/each}}
      </tbody>
    </table>
    {{/if}}
  </div>
  
  <div class="footer">
    <p>生成时间: {{timestamp}}</p>
    {{#if author}}
    <p>作者: {{author}}</p>
    {{/if}}
  </div>
</body>
</html>`,
      variables: [
        {
          name: 'title',
          type: 'string',
          required: true,
          description: '报告标题',
        },
        {
          name: 'subtitle',
          type: 'string',
          required: false,
          description: '副标题',
        },
        {
          name: 'content',
          type: 'string',
          required: true,
          description: '主要内容',
        },
        {
          name: 'sections',
          type: 'array',
          required: false,
          description: '章节列表',
        },
        {
          name: 'table',
          type: 'object',
          required: false,
          description: '数据表',
        },
        {
          name: 'timestamp',
          type: 'string',
          required: false,
          description: '时间戳',
          defaultValue: new Date().toLocaleString(),
        },
        {
          name: 'author',
          type: 'string',
          required: false,
          description: '作者',
        },
      ],
      description: '专业的报告HTML模板，支持标题、章节、表格等',
    };
    
    this.templates.set('report-html', reportHtmlTemplate);

    // PPT内容JSON模板
    const pptJsonTemplate: OutputTemplate = {
      id: 'ppt-json',
      name: 'PPT内容JSON模板',
      type: 'json',
      format: JSON.stringify({
        title: '{{title}}',
        slides: [
          {
            type: 'title',
            title: '{{title}}',
            subtitle: '{{subtitle}}',
          },
          {
            type: 'toc',
            title: '目录',
            items: '{{tocItems}}',
          },
          {
            type: 'content',
            title: '{{sectionTitle}}',
            content: '{{sectionContent}}',
          },
        ],
        metadata: {
          author: '{{author}}',
          createdAt: '{{timestamp}}',
          version: '1.0',
        },
      }, null, 2),
      variables: [
        {
          name: 'title',
          type: 'string',
          required: true,
          description: 'PPT标题',
        },
        {
          name: 'subtitle',
          type: 'string',
          required: false,
          description: '副标题',
        },
        {
          name: 'tocItems',
          type: 'array',
          required: false,
          description: '目录项',
        },
        {
          name: 'sectionTitle',
          type: 'string',
          required: false,
          description: '章节标题',
        },
        {
          name: 'sectionContent',
          type: 'string',
          required: false,
          description: '章节内容',
        },
        {
          name: 'author',
          type: 'string',
          required: false,
          description: '作者',
        },
        {
          name: 'timestamp',
          type: 'string',
          required: false,
          description: '时间戳',
          defaultValue: new Date().toISOString(),
        },
      ],
      description: 'PPT内容JSON模板，用于生成PPTX文件',
    };
    
    this.templates.set('ppt-json', pptJsonTemplate);

    // 简单文本模板
    const simpleTextTemplate: OutputTemplate = {
      id: 'simple-text',
      name: '简单文本模板',
      type: 'text',
      format: '{{content}}',
      variables: [
        {
          name: 'content',
          type: 'string',
          required: true,
          description: '内容',
        },
      ],
      description: '简单的纯文本模板',
    };
    
    this.templates.set('simple-text', simpleTextTemplate);

    // 天气报告HTML模板
    const weatherHtmlTemplate: OutputTemplate = {
      id: 'weather-html',
      name: '天气报告HTML模板',
      type: 'html',
      format: `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>天气报告 - {{city}}</title>
  <style>
    body {
      font-family: 'Arial', sans-serif;
      max-width: 600px;
      margin: 50px auto;
      padding: 30px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }
    .weather-card {
      background: rgba(255, 255, 255, 0.1);
      backdrop-filter: blur(10px);
      border-radius: 20px;
      padding: 30px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
    }
    .city-name {
      font-size: 2em;
      margin-bottom: 10px;
      text-align: center;
    }
    .temperature {
      font-size: 4em;
      text-align: center;
      margin: 20px 0;
      font-weight: bold;
    }
    .description {
      font-size: 1.3em;
      text-align: center;
      margin-bottom: 30px;
      opacity: 0.9;
    }
    .details {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 20px;
    }
    .detail-item {
      background: rgba(255, 255, 255, 0.1);
      padding: 15px;
      border-radius: 10px;
      text-align: center;
    }
    .detail-label {
      font-size: 0.9em;
      opacity: 0.8;
      margin-bottom: 5px;
    }
    .detail-value {
      font-size: 1.2em;
      font-weight: bold;
    }
    .footer {
      margin-top: 30px;
      text-align: center;
      opacity: 0.7;
      font-size: 0.9em;
    }
  </style>
</head>
<body>
  <div class="weather-card">
    <h1 class="city-name">{{city}}</h1>
    <div class="temperature">{{temperature}}°C</div>
    <div class="description">{{description}}</div>
    
    <div class="details">
      <div class="detail-item">
        <div class="detail-label">湿度</div>
        <div class="detail-value">{{humidity}}%</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">风速</div>
        <div class="detail-value">{{windSpeed}} m/s</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">气压</div>
        <div class="detail-value">{{pressure}} hPa</div>
      </div>
      <div class="detail-item">
        <div class="detail-label">能见度</div>
        <div class="detail-value">{{visibility}} km</div>
      </div>
    </div>
    
    <div class="footer">
      更新时间: {{timestamp}}
    </div>
  </div>
</body>
</html>`,
      variables: [
        {
          name: 'city',
          type: 'string',
          required: true,
          description: '城市名称',
        },
        {
          name: 'temperature',
          type: 'number',
          required: true,
          description: '温度(°C)',
        },
        {
          name: 'description',
          type: 'string',
          required: true,
          description: '天气描述',
        },
        {
          name: 'humidity',
          type: 'number',
          required: false,
          description: '湿度(%)',
        },
        {
          name: 'windSpeed',
          type: 'number',
          required: false,
          description: '风速(m/s)',
        },
        {
          name: 'pressure',
          type: 'number',
          required: false,
          description: '气压(hPa)',
        },
        {
          name: 'visibility',
          type: 'number',
          required: false,
          description: '能见度(km)',
        },
        {
          name: 'timestamp',
          type: 'string',
          required: false,
          description: '更新时间',
          defaultValue: new Date().toLocaleString(),
        },
      ],
      description: '美观的天气报告HTML模板',
    };
    
    this.templates.set('weather-html', weatherHtmlTemplate);
  }

  registerTemplate(template: OutputTemplate) {
    this.templates.set(template.id, template);
  }

  getTemplate(templateId: string): OutputTemplate | undefined {
    return this.templates.get(templateId);
  }

  getAllTemplates(): OutputTemplate[] {
    return Array.from(this.templates.values());
  }

  render(context: TemplateRenderContext): RenderedOutput {
    const { template, data, options = {} } = context;
    const { escapeHtml = true, minify = false } = options;

    try {
      // 验证必需的变量
      this.validateVariables(template, data);

      // 合并默认值
      const mergedData = this.mergeWithDefaults(template, data);

      // 渲染模板
      let content = this.renderTemplate(template.format, mergedData, escapeHtml);

      // 可选的压缩
      if (minify) {
        content = this.minify(content, template.type);
      }

      return {
        type: template.type,
        content,
        metadata: {
          templateId: template.id,
          renderedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      throw new Error(`模板渲染失败: ${error instanceof Error ? error.message : '未知错误'}`);
    }
  }

  private validateVariables(template: OutputTemplate, data: Record<string, any>): void {
    for (const variable of template.variables) {
      if (variable.required && !(variable.name in data)) {
        throw new Error(`缺少必需的变量: ${variable.name}`);
      }

      if (variable.name in data) {
        const value = data[variable.name];
        const actualType = Array.isArray(value) ? 'array' : typeof value;
        
        if (variable.type !== 'object' && actualType !== variable.type) {
          throw new Error(`变量 ${variable.name} 类型不匹配: 期望 ${variable.type}, 实际 ${actualType}`);
        }
        if (variable.type === 'object' && actualType !== 'object' && actualType !== 'array') {
          throw new Error(`变量 ${variable.name} 类型不匹配: 期望 ${variable.type}, 实际 ${actualType}`);
        }
      }
    }
  }

  private mergeWithDefaults(
    template: OutputTemplate,
    data: Record<string, any>
  ): Record<string, any> {
    const merged = { ...data };

    for (const variable of template.variables) {
      if (!(variable.name in merged) && variable.defaultValue !== undefined) {
        merged[variable.name] = variable.defaultValue;
      }
    }

    return merged;
  }

  private renderTemplate(
    template: string,
    data: Record<string, any>,
    escapeHtml: boolean
  ): string {
    let result = template;

    // 简单的变量替换 {{variable}}
    result = result.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      if (key in data) {
        const value = data[key];
        const stringValue = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
        return escapeHtml ? this.escapeHtml(stringValue) : stringValue;
      }
      return match;
    });

    // 简单的条件渲染 {{#if condition}}...{{/if}}
    result = result.replace(/\{\{#if (\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (match, condition, content) => {
      if (data[condition]) {
        return content;
      }
      return '';
    });

    // 简单的循环 {{#each array}}...{{/each}}
    result = result.replace(/\{\{#each (\w+)\}\}([\s\S]*?)\{\{\/each\}\}/g, (match, arrayKey, content) => {
      const array = data[arrayKey];
      if (Array.isArray(array)) {
        return array
          .map((item, index) => {
            let itemContent = content;
            if (typeof item === 'object') {
              Object.entries(item).forEach(([key, value]) => {
                itemContent = itemContent.replace(
                  new RegExp(`\\{\\{${key}\\}\\}`, 'g'),
                  escapeHtml ? this.escapeHtml(String(value)) : String(value)
                );
              });
            } else {
              itemContent = itemContent.replace(/\{\{this\}\}/g, escapeHtml ? this.escapeHtml(String(item)) : String(item));
            }
            itemContent = itemContent.replace(/\{\{@index\}\}/g, String(index));
            return itemContent;
          })
          .join('');
      }
      return '';
    });

    return result;
  }

  private escapeHtml(str: string): string {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  private minify(content: string, type: string): string {
    switch (type) {
      case 'html':
        return content
          .replace(/\s+/g, ' ')
          .replace(/>\s+</g, '><')
          .replace(/<!--[\s\S]*?-->/g, '')
          .trim();
      case 'json':
        try {
          return JSON.stringify(JSON.parse(content));
        } catch {
          return content;
        }
      default:
        return content.replace(/\s+/g, ' ').trim();
    }
  }

  extractTemplateFromInput(input: string): string | null {
    const patterns = [
      /使用模板[：:]\s*(\S+)/,
      /\[template:(\w+)\]/,
      /模板[：:]\s*(\S+)/,
    ];

    for (const pattern of patterns) {
      const match = input.match(pattern);
      if (match && match[1]) {
        const templateId = match[1];
        if (this.templates.has(templateId)) {
          return templateId;
        }
        for (const [id, template] of this.templates) {
          if (template.name.includes(templateId) || id.includes(templateId)) {
            return id;
          }
        }
      }
    }

    if (input.includes('报告') || input.includes('Report')) {
      return 'report-html';
    }
    if (input.includes('天气')) {
      return 'weather-html';
    }
    if (input.includes('PPT') || input.includes('幻灯片')) {
      return 'ppt-json';
    }

    return null;
  }
}