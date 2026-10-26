import React, { useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import { 
  sanitizeChineseCharacters, 
  simplifyMermaidCode, 
  convertToAsciiMermaid,
  fixMermaidSyntax,
  validateMermaidSyntax,
  isMermaidErrorSVG
} from '../markdown/mermaidUtils';
import { sanitizeHtml, sanitizeSvgHtml } from '../../../utils/sanitizeHtml';
import CopyableCodeBlock from "./CopyableCodeBlock";
import { OptimizedMermaidRenderer } from '../markdown/OptimizedMermaidRenderer';
import LaTeXRenderer from "./latex";
import type { MarkdownRenderTier } from '../chat/markdownRenderTier';
import { devLog, devWarn, devError } from '../../../utils/devConsole';

export type { MarkdownRenderTier } from '../chat/markdownRenderTier';

export type RenderContent = {
  type: string;
  value: any;
  language?: string;
  /** prose Markdown：轻量跳过 rehype-raw（流式尾、纯 GFM）；重路径保留 HTML/Mermaid/LaTeX */
  markdownTier?: MarkdownRenderTier;
  streamingPartialFence?: boolean;
  [key: string]: any;
};

export interface RenderOutputProps {
  content: RenderContent[];
  className?: string;
}

const safeString = (v: unknown): string => (typeof v === 'string' ? v : '');

export const RenderOutput: React.FC<RenderOutputProps> = ({ content, className }) => {
  return (
    <div className={className || ''} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      {content.map((block, idx) => {
        switch (block.type) {
          case "markdown":
            return (
              <BasicMarkdownRenderer
                key={idx}
                content={safeString(block.value)}
                markdownTier={(block.markdownTier ?? 'heavy') as MarkdownRenderTier}
              />
            );
          case "text":
            return <TextRenderer key={idx} content={safeString(block.value)} />;
          case "html":
            return <HTMLRenderer key={idx} content={safeString(block.value)} />;
          case "code":
            return <CodeRenderer key={idx} content={safeString(block.value)} language={block.language} />;
          case "json":
            return <JSONRenderer key={idx} content={block.value} />;
          case "image":
            return <ImageRenderer key={idx} src={block.value} alt={block.alt} />;
          case "svg":
            return <SVGRenderer key={idx} content={safeString(block.value)} />;
          case "mermaid": {
            const mermaidStr = safeString(block.value);
            devLog('[RenderOutput] 处理Mermaid块，原始值:', mermaidStr.substring(0, 100));
            const validation = validateMermaidSyntax(mermaidStr);
            if (!validation.isValid) {
              return (
                <div key={idx} style={{ margin: '8px 0' }}>
                  <div style={{ fontSize: 12, color: '#b45309', marginBottom: 6 }}>
                    Mermaid语法不完整，已降级为代码块展示
                  </div>
                  <CopyableCodeBlock code={mermaidStr} language="mermaid" />
                </div>
              );
            }
            return (
              <OptimizedMermaidRenderer
                key={idx}
                code={mermaidStr}
                onRendered={(result) => {
                  if (result.success) {
                    devLog('[RenderOutput] Mermaid渲染成功');
                  } else {
                    devError('[RenderOutput] Mermaid渲染失败:', result.error);
                  }
                }}
                onError={(error) => {
                  devWarn('[RenderOutput] Mermaid渲染错误(已降级):', error);
                }}
              />
            );
          }
          case "latex": {
            const latexStr = safeString(block.value);
            devLog('[RenderOutput] 处理LaTeX块，原始值:', latexStr.substring(0, 100), 'displayMode:', block.displayMode);
            return (
              <LaTeXRenderer
                key={idx}
                content={latexStr}
                displayMode={block.displayMode || false}
              />
            );
          }
          case "iframe":
            return <IFrameRenderer key={idx} src={block.value} />;
          case "csv":
            return <CSVRenderer key={idx} data={safeString(block.value)} />;
          default:
            return <UnsupportedRenderer key={idx} type={block.type} content={block.value} />;
        }
      })}
    </div>
  );
};

const chatMarkdownSanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'u'],
};

// 基础渲染器组件（成本分级：light 省去 rehype-raw）
const BasicMarkdownRenderer: React.FC<{
  content: string;
  markdownTier?: MarkdownRenderTier;
}> = ({ content, markdownTier = 'heavy' }) => {
  const safeContent = content ?? '';
  const isHeavyTier = markdownTier === 'heavy';

  // 检查是否包含Mermaid代码块
  const hasMermaidCode = useMemo(() => {
    return isHeavyTier && /```mermaid[\s\S]*?```/gi.test(safeContent);
  }, [safeContent, isHeavyTier]);

  // 使用useMemo缓存components配置，避免每次渲染时重新创建
  const components = useMemo(() => {
    // 表格样式对象
    const tableStyles = {
      table: {
        width: '100% !important' as any,
        borderCollapse: 'collapse' as const,
        margin: '4px 0',
        fontSize: '14px',
        tableLayout: 'auto' as const,
        display: 'table' as const,
        minWidth: '100%' as const
      },
      th: {
        border: '1px solid #d1d5db !important' as any,
        padding: '10px 12px !important' as any,
        textAlign: 'left' as const,
        verticalAlign: 'top' as const,
        backgroundColor: '#f6f6f6 !important' as any,
        fontWeight: '600 !important' as any,
        color: '#374151 !important' as any,
        position: 'sticky' as const,
        top: 0,
        zIndex: 10,
        display: 'table-cell' as const,
        whiteSpace: 'normal' as const,
        wordWrap: 'break-word' as const,
        maxWidth: '200px' as const
      },
      td: {
        border: '1px solid #d1d5db !important' as any,
        padding: '10px 12px !important' as any,
        textAlign: 'left' as const,
        verticalAlign: 'top' as const,
        color: '#1f2937 !important' as any,
        lineHeight: '1.4',
        display: 'table-cell' as const,
        wordWrap: 'break-word' as const,
        whiteSpace: 'normal' as const,
        maxWidth: '300px' as const
      }
    };

    // 自定义组件 - 完整的Markdown元素支持
    const componentsConfig: any = {
      // 标题
      h1: ({ children }: any) => <h1 style={{ fontSize: '1.5em', fontWeight: 600, margin: '16px 0 8px 0', color: '#111827' }}>{children}</h1>,
      h2: ({ children }: any) => <h2 style={{ fontSize: '1.3em', fontWeight: 600, margin: '14px 0 6px 0', color: '#1f2937' }}>{children}</h2>,
      h3: ({ children }: any) => <h3 style={{ fontSize: '1.1em', fontWeight: 600, margin: '12px 0 4px 0', color: '#374151' }}>{children}</h3>,
      
      // 段落
      p: ({ children }: any) => <p style={{ margin: '9.6px 0', lineHeight: '1.92', color: '#1f2937' }}>{children}</p>,
      
      // 列表
      ul: ({ children, className }: any) => <ul className={className}>{children}</ul>,
      ol: ({ children }: any) => <ol style={{ margin: '9.6px 0', paddingLeft: '20px', color: '#1f2937' }}>{children}</ol>,
      li: ({ children, className }: any) => <li className={className}>{children}</li>,
      
      // 强调
      strong: ({ children }: any) => <strong style={{ fontWeight: 600, color: '#374151' }}>{children}</strong>,
      em: ({ children }: any) => <em style={{ fontStyle: 'italic', color: '#1f2937' }}>{children}</em>,
      u: ({ children }: any) => <u>{children}</u>,

      img: ({ src, alt, title }: any) => (
        <img src={src} alt={alt ?? ''} title={title} loading="lazy" />
      ),

      // 引用
      blockquote: ({ children }: any) => (
        <blockquote style={{
          borderLeft: '4px solid #3b82f6',
          paddingLeft: '12px',
          margin: '8px 0',
          padding: '8px 12px',
          background: '#f8fafc',
          borderColor: '#e2e8f0',
          color: '#475569'
        }}>
          {children}
        </blockquote>
      ),
      
      // 分隔线
      hr: () => <hr style={{ border: 'none', borderTop: '1px solid #e5e7eb', margin: '16px 0' }} />,
      
      // 表格
      table: ({ children }: any) => (
        <div className="table-scroll-wrap">
          <table style={tableStyles.table}>{children}</table>
        </div>
      ),
      th: ({ children }: any) => (
        <th style={tableStyles.th}>
          {children}
        </th>
      ),
      td: ({ children }: any) => (
        <td style={tableStyles.td}>
          {children}
        </td>
      ),
      // 链接
      a: ({ href, children, ...props }: any) => (
        <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb', textDecoration: 'underline' }} {...props}>
          {children}
        </a>
      ),
      
      // 表格组件
      thead: ({ children }: any) => <thead style={{ backgroundColor: '#f6f6f6' }}>{children}</thead>,
      tbody: ({ children }: any) => (
        <tbody>
          {React.Children.map(children, (child, index) => {
            if (React.isValidElement(child) && child.type === 'tr') {
              return React.cloneElement(child as any, {
                style: {
                  backgroundColor: index % 2 === 1 ? '#f6f6f6' : 'transparent',
                  transition: 'background-color 0.15s ease'
                },
                onMouseEnter: (e: any) => {
                  e.currentTarget.style.backgroundColor = '#f3f4f6';
                },
                onMouseLeave: (e: any) => {
                  e.currentTarget.style.backgroundColor = index % 2 === 1 ? '#f6f6f6' : 'transparent';
                }
              });
            }
            return child;
          })}
        </tbody>
      ),
      tr: ({ children }: any) => <tr>{children}</tr>,
      code: ({ node, inline, className, children, ...props }: any) => {
        const match = /language-([\w-]+)/.exec(className || '');
        const language = match ? match[1] : '';
        const codeString = String(children).replace(/\n$/, '');
        
        // 如果是Mermaid代码块，使用Mermaid渲染器
        if (language === 'mermaid') {
          return (
            <OptimizedMermaidRenderer
              code={codeString}
              onRendered={(result) => {
                if (result.success) {
                  devLog('[BasicMarkdownRenderer] Mermaid渲染成功');
                } else {
                  devError('[BasicMarkdownRenderer] Mermaid渲染失败:', result.error);
                }
              }}
              onError={(error) => {
                devError('[BasicMarkdownRenderer] Mermaid渲染错误:', error);
              }}
            />
          );
        }
        
        // 其他代码块使用语法高亮
        if (!inline && language) {
          return (
            <SyntaxHighlighter 
              language={language} 
              style={oneLight}
              customStyle={{
                margin: 0,
                padding: '1rem',
                fontSize: '0.875rem',
                lineHeight: '1.5'
              }}
            >
              {codeString}
            </SyntaxHighlighter>
          );
        }
        
        // 内联代码
        return (
          <code className={className} {...props}>
            {children}
          </code>
        );
      }
    };

    return componentsConfig;
  }, [safeContent, isHeavyTier]); // content / tier 变更时刷新（Mermaid code 仅在 heavy 启用）

  const rehypePlugins = useMemo(
    (): any[] =>
      isHeavyTier
        ? [rehypeRaw, [rehypeSanitize, chatMarkdownSanitizeSchema]]
        : [[rehypeSanitize, chatMarkdownSanitizeSchema]],
    [isHeavyTier],
  );

  return (
    <div 
      className="wmde-markdown" 
      style={{ 
        maxWidth: '100%', 
        fontSize: '14px', 
        lineHeight: '1.92',
        overflowX: 'auto',
        margin: '0',
        padding: '0',
        border: 'none',
        background: 'transparent'
      }}
    >
      <style dangerouslySetInnerHTML={{
        __html: `
          .wmde-markdown table,
          .wmde-markdown table * {
            box-sizing: border-box !important;
          }
          .wmde-markdown table {
            border-spacing: 0 !important;
            border-collapse: collapse !important;
            width: 100% !important;
            display: table !important;
            table-layout: auto !important;
            min-width: 600px !important;
            margin: 4px 0 !important;
          }
          .wmde-markdown table th,
          .wmde-markdown table td {
            display: table-cell !important;
            padding: 10px 12px !important;
            border: 1px solid #d1d5db !important;
            text-align: left !important;
            vertical-align: top !important;
            white-space: normal !important;
            word-wrap: break-word !important;
            overflow-wrap: break-word !important;
            line-height: 1.68 !important;
          }
          .wmde-markdown table th {
            background-color: #f6f6f6 !important;
            font-weight: 400 !important;
            color: inherit !important;
            max-width: 200px !important;
          }
          .wmde-markdown table td {
            color: inherit !important;
            max-width: 300px !important;
          }
        `
      }} />
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={rehypePlugins} components={components}>
        {safeContent}
      </ReactMarkdown>
    </div>
  );
};

const TextRenderer: React.FC<{ content: string }> = ({ content }) => {
  return (
    <pre className="whitespace-pre-wrap bg-gray-50 p-4 rounded-lg text-sm font-mono">
      {content}
    </pre>
  );
};

const HTMLRenderer: React.FC<{ content: string }> = ({ content }) => {
  return (
    <div 
      className="html-content"
      dangerouslySetInnerHTML={{ __html: sanitizeHtml(content) }} 
    />
  );
};

const CodeRenderer: React.FC<{ content: string; language?: string }> = ({ content, language = "text" }) => {
  return (
    <div className="code-block rounded-lg overflow-hidden">
      <SyntaxHighlighter 
        language={language} 
        style={oneLight}
        customStyle={{
          margin: 0,
          padding: '1rem',
          fontSize: '0.875rem',
          lineHeight: '1.5'
        }}
      >
        {content}
      </SyntaxHighlighter>
    </div>
  );
};

const JSONRenderer: React.FC<{ content: any }> = ({ content }) => {
  const [collapsed, setCollapsed] = React.useState(false);
  
  const jsonString = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  
  // 如果是对象，尝试以更友好的方式显示
  if (typeof content === 'object' && content !== null) {
    return (
      <div className="json-viewer border rounded-lg">
        <div className="flex items-center justify-between bg-gray-100 px-4 py-2 border-b">
          <span className="text-sm font-medium text-gray-700">分析结果</span>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="text-sm text-blue-600 hover:text-blue-800"
          >
            {collapsed ? '显示JSON' : '隐藏JSON'}
          </button>
        </div>
        <div className="p-4">
          {/* 友好的显示格式 */}
          <div className="mb-4">
            {content.标题 && (
              <div className="mb-2">
                <strong>标题：</strong>{content.标题}
              </div>
            )}
            {content.标签 && Array.isArray(content.标签) && (
              <div className="mb-2">
                <strong>标签：</strong>
                <span className="inline-flex flex-wrap gap-1">
                  {content.标签.map((tag: string, index: number) => (
                    <span key={index} className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded">
                      {tag}
                    </span>
                  ))}
                </span>
              </div>
            )}
            {content.简介 && (
              <div className="mb-2">
                <strong>简介：</strong>{content.简介}
              </div>
            )}
            {content.开源项目评价 && (
              <div className="mb-2">
                <strong>开源项目评价：</strong>{content.开源项目评价}
              </div>
            )}
          </div>
          
          {/* JSON格式（可折叠） */}
          {!collapsed && (
            <details className="mt-4">
              <summary className="text-sm text-gray-600 cursor-pointer">查看JSON格式</summary>
              <pre className="text-sm overflow-auto max-h-96 mt-2 p-2 bg-gray-50 rounded">
                <code>{jsonString}</code>
              </pre>
            </details>
          )}
        </div>
      </div>
    );
  }
  
  // 如果是字符串或其他格式，保持原有行为
  return (
    <div className="json-viewer border rounded-lg">
      <div className="flex items-center justify-between bg-gray-100 px-4 py-2 border-b">
        <span className="text-sm font-medium text-gray-700">JSON</span>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="text-sm text-blue-600 hover:text-blue-800"
        >
          {collapsed ? 'Expand' : 'Collapse'}
        </button>
      </div>
      <div className="p-4">
        {collapsed ? (
          <div className="text-gray-500 text-sm">
            {typeof content === 'object' ? `{${Object.keys(content).length} properties}` : 'JSON content'}
          </div>
        ) : (
          <pre className="text-sm overflow-auto max-h-96">
            <code>{jsonString}</code>
          </pre>
        )}
      </div>
    </div>
  );
};

const ImageRenderer: React.FC<{ src: string; alt?: string }> = ({ src, alt = "image" }) => {
  // 只允许 http(s) 或 data:image/ 协议
  const isValidImage = /^https?:\/\/|^data:image\//.test(src);
  if (!isValidImage) {
    return (
      <div className="image-container text-center text-red-500 text-xs">
        非法图片链接：<pre style={{whiteSpace:'pre-wrap'}}>{src}</pre>
      </div>
    );
  }
  return (
    <div className="image-container text-center">
      <img 
        src={src} 
        alt={alt} 
        className="max-w-full h-auto rounded-lg shadow-md mx-auto"
        loading="lazy"
      />
    </div>
  );
};

const SVGRenderer: React.FC<{ content: string }> = ({ content }) => {
  const processedContent = useMemo(() => {
    let svg = content;
    // 1. 替换SVG属性
    svg = svg.replace(/(<rect|<circle|<ellipse|<polygon|<path)([^>]*)(fill|fill-color)=\"[^\"]*\"/g, '$1$2fill=\"#fff\"');
    svg = svg.replace(/(<rect|<circle|<ellipse|<polygon|<path)([^>]*)(stroke|stroke-color)=\"[^\"]*\"/g, '$1$2stroke=\"#fafbfc\"');
    // 2. 替换style属性
    svg = svg.replace(/style=\"([^\"]*)fill:[^;]+;?/g, 'style=\"$1fill:#fff;');
    svg = svg.replace(/style=\"([^\"]*)stroke:[^;]+;?/g, 'style=\"$1stroke:#fafbfc;');
    // 3. 替换SVG内style块（CSS class）
    svg = svg.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/g, (match, start, css, end) => {
      // 只替换 .node rect/circle/ellipse/polygon/path 的 fill/stroke
      css = css.replace(/(\.node [a-z]+,?)+\{[^}]*\}/g, (rule: string) => {
        rule = rule.replace(/fill:[^;]+;?/g, 'fill:#fff;');
        rule = rule.replace(/stroke:[^;]+;?/g, 'stroke:#fafbfc;');
        return rule;
      });
      return start + css + end;
    });
    return svg;
  }, [content]);
  return (
    <div className="svg-renderer" style={{ width: '100%', overflow: 'auto' }}>
      <div dangerouslySetInnerHTML={{ __html: sanitizeSvgHtml(processedContent) }} />
    </div>
  );
};

const CopyButton: React.FC<{ code: string }> = ({ code }) => {
  const [copied, setCopied] = React.useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };
  return (
    <button
      onClick={handleCopy}
      style={{
        position: "absolute",
        right: 8,
        top: 8,
        zIndex: 2,
        fontSize: 12,
        padding: "2px 8px",
        borderRadius: 4,
        border: "1px solid #d1d5db",
        background: copied ? "#e0f7fa" : "#f6f8fa",
        color: "#007bff",
        cursor: "pointer"
      }}
      title="复制Mermaid源码"
    >
      {copied ? "已复制" : "复制"}
    </button>
  );
};

const IFrameRenderer: React.FC<{ src: string }> = ({ src }) => {
  return (
    <div className="iframe-container rounded-lg overflow-hidden border">
      <iframe
        src={src}
        width="100%"
        height="400"
        className="w-full"
        title="External Content"
        sandbox="allow-scripts allow-same-origin"
      />
    </div>
  );
};

const CSVRenderer: React.FC<{ data: string }> = ({ data }) => {
  const [rows, setRows] = React.useState<string[][]>([]);
  const [error, setError] = React.useState<string>('');

  React.useEffect(() => {
    try {
      // 简单的CSV解析
      const lines = data.trim().split('\n');
      const parsed = lines.map(line => {
        // 处理简单的CSV格式（不处理复杂的引号转义）
        return line.split(',').map(cell => cell.trim());
      });
      setRows(parsed);
      setError('');
    } catch (err) {
      setError('CSV parsing failed');
      setRows([]);
    }
  }, [data]);

  if (error) {
    return <div className="text-red-500 text-sm">Error: {error}</div>;
  }

  if (!rows.length) {
    return <div className="text-gray-500 text-sm">No data to display</div>;
  }

  return (
    <div className="csv-table overflow-x-auto">
      <table className="min-w-full border-collapse border border-gray-300 text-sm">
        <thead>
          <tr className="bg-gray-50">
            {rows[0].map((cell, idx) => (
              <th key={idx} className="border border-gray-300 px-3 py-2 text-left font-medium text-gray-700">
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(1).map((row, i) => (
            <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
              {row.map((cell, j) => (
                <td key={j} className="border border-gray-300 px-3 py-2 text-gray-900">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const UnsupportedRenderer: React.FC<{ type: string; content: any }> = ({ type, content }) => {
  return (
    <div className="unsupported-content bg-red-50 border border-red-200 rounded-lg p-4">
      <div className="text-red-600 font-medium mb-2">
        Unsupported content type: {type}
      </div>
      <pre className="text-sm text-gray-600 overflow-auto">
        {typeof content === 'string' ? content : JSON.stringify(content, null, 2)}
      </pre>
    </div>
  );
};

const SUPPORTED_MERMAID_TYPES = [
  'flowchart', 'graph', 'sequenceDiagram', 'gantt', 'pie', 'mindmap', 'journey', 'quadrantChart',
  'classDiagram', 'stateDiagram', 'erDiagram', 'gitGraph', 'timeline', 'xychart-beta', 'heatmap', 'zenuml', 'sankey'
];

const detectMermaidType = (chart: string): string => {
  const lower = chart.toLowerCase().trim();
  devLog('[detectMermaidType] 检查图表类型，代码前50字符:', lower.substring(0, 50));
  
  // 首先检查是否以支持的图表类型开头
  for (const type of SUPPORTED_MERMAID_TYPES) {
    // 检查精确匹配（如 graph TD, graph TB, graph LR 等）
    if (lower.startsWith(type.toLowerCase())) {
      devLog('[detectMermaidType] 精确匹配到类型:', type);
      return type;
    }
  }
  
  // 然后检查是否包含支持的图表类型
  for (const type of SUPPORTED_MERMAID_TYPES) {
    if (lower.includes(type.toLowerCase())) {
      devLog('[detectMermaidType] 包含匹配到类型:', type);
      return type;
    }
  }
  
  // 特殊处理：检查常见的Mermaid图表模式
  const mermaidPatterns = [
    { pattern: /^graph\s+(td|tb|lr|bt|rl)/i, type: 'graph' },
    { pattern: /^flowchart\s+(td|tb|lr|bt|rl)/i, type: 'flowchart' },
    { pattern: /^sequence\s*diagram/i, type: 'sequenceDiagram' },
    { pattern: /^participant\s+sequence\s*diagram/i, type: 'sequenceDiagram' }, // 修复错误的语法
    { pattern: /^class\s*diagram/i, type: 'classDiagram' },
    { pattern: /^state\s*diagram/i, type: 'stateDiagram' },
    { pattern: /^er\s*diagram/i, type: 'erDiagram' },
    { pattern: /^git\s*graph/i, type: 'gitGraph' },
    { pattern: /^quadrant\s*chart/i, type: 'quadrantChart' },
    { pattern: /^xy\s*chart/i, type: 'xychart-beta' }
  ];
  
  for (const { pattern, type } of mermaidPatterns) {
    if (pattern.test(lower)) {
      devLog('[detectMermaidType] 模式匹配到类型:', type);
      return type;
    }
  }
  
  devLog('[detectMermaidType] 未匹配到任何类型，返回unknown');
  return 'unknown';
};

/**
 * 尝试将不支持的Mermaid类型转换为支持的类型
 */
const convertUnsupportedType = (chart: string, originalType: string): { converted: boolean; newChart: string; newType: string } => {
  const lower = chart.toLowerCase().trim();
  
  // timeline -> gantt 转换
  if (originalType === 'timeline' && lower.startsWith('timeline')) {
    devLog('[convertUnsupportedType] 尝试将timeline转换为gantt');
    const converted = chart.replace(/^timeline/i, 'gantt');
    return { converted: true, newChart: converted, newType: 'gantt' };
  }
  
  // 其他可能的转换...
  
  return { converted: false, newChart: chart, newType: originalType };
};

const cleanupMermaidElements = () => {
  const elements = document.querySelectorAll('[id^="mermaid-"]');
  elements.forEach(el => {
    // 清理所有mermaid相关的DOM元素，包括没有后缀的
    if (el.id.includes('mermaid-')) {
      el.remove();
    }
  });
};

// 旧的MermaidRenderer组件已删除，现在使用OptimizedMermaidRenderer

export default RenderOutput; 