import React, { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import styled from 'styled-components';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import Mermaid from 'mermaid';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus, vs } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { CopyOutlined, CheckOutlined } from '@ant-design/icons';

// 初始化Mermaid
Mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'loose',
  theme: 'default'
});

export interface MarkdownRendererProps {
  content: string;
  isLive?: boolean;
  className?: string;
  theme?: 'light' | 'dark';
}

/**
 * 清理特殊标签（如think标签）和多余空行
 */
function cleanEmptyLines(md: string): string {
  let cleaned = md
    // 移除所有think标签及其内容
    .replace(/<think>[\s\S]*?<\/think>/g, '')
    // 移除所有planning标签及其内容
    .replace(/<\/?planning[^>]*>[\s\S]*?<\/planning>/g, '')
    // 移除所有response_content标签及其内容
    .replace(/<\/?response_content[^>]*>[\s\S]*?<\/response_content>/g, '')
    // 移除其他可能的未闭合标签
    .replace(/<([a-zA-Z0-9]+)[^>]*>(?!.*<\/\1>)/g, '')
    // 清理多余的空行
    .replace(/\n\s*\n\s*\n/g, '\n\n')
    .trim();
  
  // 统一所有换行符为 \n
  cleaned = cleaned.replace(/\r\n?/g, '\n');
  // 连续2行及以上的"空行或只含空白字符的行"合并为1行
  cleaned = cleaned.replace(/(\n[\s\u3000]*){2,}/g, '\n\n');
  // 去除开头和结尾所有空行
  cleaned = cleaned.replace(/^\s*\n+/, '').replace(/\n+\s*$/, '');

  return cleaned;
}

const CopyButton: React.FC<{ code: string }> = ({ code }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('复制失败:', err);
    }
  };

  return (
    <CopyButtonContainer onClick={handleCopy}>
      {copied ? <CheckOutlined /> : <CopyOutlined />}
      <span>{copied ? '已复制' : '复制'}</span>
    </CopyButtonContainer>
  );
};

const MermaidRenderer: React.FC<{ code: string }> = ({ code }) => {
  const [svg, setSvg] = React.useState<string>('');

  React.useEffect(() => {
    const renderMermaid = async () => {
      try {
        const result = await Mermaid.render(`mermaid-${Date.now()}`, code);
        setSvg(typeof result === 'string' ? result : (result as any).svg);
      } catch (error) {
        console.error('Mermaid渲染错误:', error);
        setSvg(`<div style="color: red;">Mermaid渲染错误: ${error instanceof Error ? error.message : '未知错误'}</div>`);
      }
    };

    renderMermaid();
  }, [code]);

  return (
    <div
      className="mermaid-block"
      style={{ margin: '16px 0', textAlign: 'center', overflowX: 'auto' }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
};

// 安全SVG渲染器 - iframe沙箱隔离
const SecureSVGRenderer: React.FC<{ svg: string }> = ({ svg }) => {
  const [height, setHeight] = React.useState(200);
  const iframeRef = React.useRef<HTMLIFrameElement>(null);

  React.useEffect(() => {
    // 从SVG解析高度
    const parser = new DOMParser();
    const doc = parser.parseFromString(svg, 'image/svg+xml');
    const svgEl = doc.querySelector('svg');
    if (svgEl) {
      const viewBox = svgEl.getAttribute('viewBox');
      const h = svgEl.getAttribute('height');
      if (h) {
        setHeight(parseInt(h, 10) || 200);
      } else if (viewBox) {
        const parts = viewBox.split(' ').map(Number);
        if (parts.length === 4) {
          const aspectRatio = parts[3] / parts[2];
          setHeight(Math.max(200, 600 * aspectRatio));
        }
      }
    }
  }, [svg]);

  const sanitizedSvg = svg
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/javascript:/gi, '');

  return (
    <div style={{ margin: '16px 0', border: '1px solid #e8e8e8', borderRadius: 6, overflow: 'hidden' }}>
      <iframe
        ref={iframeRef}
        srcDoc={`<!DOCTYPE html>
<html>
<head>
<style>
body { margin: 0; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: white; }
svg { max-width: 100%; height: auto; }
</style>
</head>
<body>${sanitizedSvg}</body>
</html>`}
        sandbox="allow-same-origin"
        style={{ width: '100%', height, border: 'none', display: 'block' }}
        loading="lazy"
        title="SVG visualization"
      />
    </div>
  );
};

// 可折叠代码块 - >30行自动折叠
const CollapsibleCodeBlock: React.FC<{ code: string; language: string; codeTheme: any }> = ({ 
  code, 
  language, 
  codeTheme 
}) => {
  const [isExpanded, setIsExpanded] = React.useState(false);
  const lines = code.split('\n');
  const shouldCollapse = lines.length > 30;
  const displayCode = shouldCollapse && !isExpanded 
    ? lines.slice(0, 25).join('\n') + '\n\n... (' + (lines.length - 25) + ' 行已折叠，点击展开)'
    : code;

  return (
    <CodeBlockWrapper>
      <CodeBlockHeader>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <LanguageLabel>{language}</LanguageLabel>
          <span style={{ fontSize: 12, color: '#999' }}>({lines.length} 行)</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {shouldCollapse && (
            <ExpandButton onClick={() => setIsExpanded(!isExpanded)}>
              {isExpanded ? '收起' : '展开'}
            </ExpandButton>
          )}
          <CopyButton code={code} />
        </div>
      </CodeBlockHeader>
      <SyntaxHighlighter
        language={language}
        style={codeTheme}
        customStyle={{
          margin: 0,
          borderRadius: '0 0 6px 6px',
          fontSize: 14,
          maxHeight: isExpanded ? '800px' : '400px',
          overflow: 'auto'
        }}
        showLineNumbers={true}
        wrapLines={true}
        lineNumberStyle={{
          minWidth: '2.5em',
          paddingRight: '1em',
          textAlign: 'right',
          userSelect: 'none',
          opacity: 0.5
        }}
      >
        {displayCode}
      </SyntaxHighlighter>
    </CodeBlockWrapper>
  );
};

// 展开/收起按钮
const ExpandButton = styled.button`
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: none;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.1);
  color: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
  
  &:hover {
    background: rgba(255, 255, 255, 0.2);
  }
`;

/**
 * Markdown渲染器组件，支持GFM扩展、LaTeX、Mermaid和SVG
 */
const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  isLive = false,
  className,
  theme = 'light'
}) => {
  // 使用useMemo优化内容处理，避免不必要的重新计算
  const renderedContent = useMemo(() => {
    const processed = (content || '').replace(/\\n/g, '\n');
    return cleanEmptyLines(processed);
  }, [content]);

  const codeTheme = theme === 'dark' ? vscDarkPlus : vs;

  if (!renderedContent) {
    return null;
  }

  return (
    <MarkdownContainer className={`wmde-markdown ${className || ''}`} $isLive={isLive} $theme={theme}>
      {isLive && (
        <LiveIndicator>
          <PulsingDot />
          正在生成...
        </LiveIndicator>
      )}
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          // 自定义各类元素的渲染方式
          code({ node, inline, className, children, ...props }: any) {
            const codeString = String(children).trim();
            const match = /language-(\w+)/.exec(className || '');
            const language = match ? match[1] : 'text';
            
            // 处理mermaid代码块
            if (!inline && className && className.includes('language-mermaid')) {
              return <MermaidRenderer code={codeString} />;
            }
            
            // 处理SVG代码块 - 安全沙箱渲染
            if (!inline && className && className.includes('language-svg')) {
              if (/^<svg[\s\S]*<\/svg>$/.test(codeString.trim())) {
                return <SecureSVGRenderer svg={codeString.trim()} />;
              }
            }
            
            // 内联代码
            if (inline) {
              return (
                <code className={className} style={{ background: theme === 'dark' ? '#2d2d2d' : '#f6f8fa', borderRadius: 3, padding: '2px 4px' }} {...props}>
                  {children}
                </code>
              );
            }
            
            // 代码块 - 支持长代码折叠
            return <CollapsibleCodeBlock code={codeString} language={language} codeTheme={codeTheme} />;
          },
          // 增强标题样式
          h1: ({ children }) => <h1 className="md-heading md-h1">{children}</h1>,
          h2: ({ children }) => <h2 className="md-heading md-h2">{children}</h2>,
          h3: ({ children }) => <h3 className="md-heading md-h3">{children}</h3>,
          h4: ({ children }) => <h4 className="md-heading md-h4">{children}</h4>,
          h5: ({ children }) => <h5 className="md-heading md-h5">{children}</h5>,
          h6: ({ children }) => <h6 className="md-heading md-h6">{children}</h6>,
          // 增强列表样式
          ul: ({ children }) => <ul className="md-list md-ul">{children}</ul>,
          ol: ({ children }) => <ol className="md-list md-ol">{children}</ol>,
          // 增强表格样式，添加容器
          table: ({ children }) => (
            <div className="table-container">
              <table>{children}</table>
            </div>
          ),
          // 自定义表格单元格渲染
          td: ({ children, ...props }) => (
            <td {...props} style={{ 
              maxWidth: '300px', 
              wordBreak: 'break-word',
              verticalAlign: 'top'
            }}>
              {children}
            </td>
          ),
          a: ({ href, children, ...props }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>
          ),
          // 自定义em组件，避免包裹块级元素
          em: ({ children }) => {
            // 递归检查是否包含块级元素
            const containsBlockElement = (node: any): boolean => {
              if (React.isValidElement(node)) {
                const type = node.type;
                if (typeof type === 'string') {
                  if (['div', 'pre', 'blockquote', 'code'].includes(type)) {
                    return true;
                  }
                }
                if (typeof type === 'function') {
                  const name = (type as any).displayName || (type as any).name;
                  if (['CodeBlockWrapper', 'MermaidRenderer', 'CollapsibleCodeBlock', 'SecureSVGRenderer', 'SyntaxHighlighter3'].includes(name)) {
                    return true;
                  }
                }
                // 递归检查子元素
                if (node.props && typeof node.props === 'object') {
                  const nodeProps = node.props as { children?: React.ReactNode };
                  if (nodeProps.children) {
                    const childNodes = React.Children.toArray(nodeProps.children);
                    return childNodes.some(containsBlockElement);
                  }
                }
              }
              return false;
            };
            
            const childArray = React.Children.toArray(children);
            const hasBlockElement = childArray.some(containsBlockElement);
            
            if (hasBlockElement) {
              return <>{children}</>;
            }
            return <em>{children}</em>;
          },
          // 自定义strong组件，避免包裹块级元素
          strong: ({ children }) => {
            // 递归检查是否包含块级元素
            const containsBlockElement = (node: any): boolean => {
              if (React.isValidElement(node)) {
                const type = node.type;
                if (typeof type === 'string') {
                  if (['div', 'pre', 'blockquote', 'code'].includes(type)) {
                    return true;
                  }
                }
                if (typeof type === 'function') {
                  const name = (type as any).displayName || (type as any).name;
                  if (['CodeBlockWrapper', 'MermaidRenderer', 'CollapsibleCodeBlock', 'SecureSVGRenderer', 'SyntaxHighlighter3'].includes(name)) {
                    return true;
                  }
                }
                // 递归检查子元素
                if (node.props && typeof node.props === 'object') {
                  const nodeProps = node.props as { children?: React.ReactNode };
                  if (nodeProps.children) {
                    const childNodes = React.Children.toArray(nodeProps.children);
                    return childNodes.some(containsBlockElement);
                  }
                }
              }
              return false;
            };
            
            const childArray = React.Children.toArray(children);
            const hasBlockElement = childArray.some(containsBlockElement);
            
            if (hasBlockElement) {
              return <>{children}</>;
            }
            return <strong>{children}</strong>;
          },
          // 自定义blockquote组件，避免内部p标签包裹块级元素
          blockquote: ({ children }) => (
            <blockquote style={{ 
              borderLeft: '4px solid #1890ff', 
              padding: '5px 5px', 
              margin: '5px 0', 
              backgroundColor: theme === 'dark' ? 'rgba(255,255,255,0.05)' : '#f8f9fa' 
            }}>
              {children}
            </blockquote>
          ),
          // 自定义p标签，避免包裹块级元素
          p: ({ children, node }) => {
            // 检查children中是否包含块级元素
            const childArray = React.Children.toArray(children);
            const hasBlockElement = childArray.some((child: any) => {
              if (React.isValidElement(child)) {
                const type = child.type;
                if (typeof type === 'string') {
                  return ['div', 'pre', 'blockquote'].includes(type);
                }
                if (typeof type === 'function') {
                  const name = (type as any).displayName || (type as any).name;
                  if (['CodeBlockWrapper', 'MermaidRenderer', 'CollapsibleCodeBlock', 'SecureSVGRenderer', 'div', 'pre', 'blockquote', 'SyntaxHighlighter3'].includes(name)) {
                    return true;
                  }
                }
                // 直接检查props中是否有block元素
                if (child.props && typeof child.props === 'object') {
                  const childProps = child.props as { children?: React.ReactNode };
                  const childChildren = React.Children.toArray(childProps.children || []);
                  return childChildren.some((grandChild: any) => {
                    if (React.isValidElement(grandChild)) {
                      const grandType = (grandChild as any).type;
                      if (typeof grandType === 'string') {
                        return ['div', 'pre'].includes(grandType);
                      }
                    }
                    return false;
                  });
                }
              }
              return false;
            });

            if (hasBlockElement) {
              return <>{children}</>;
            }

            return <p style={{ margin: '8px 0', lineHeight: '1.8' }}>{children}</p>;
          },
        }}
      >
        {renderedContent}
      </ReactMarkdown>
    </MarkdownContainer>
  );
};

const CopyButtonContainer = styled.button`
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: none;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.1);
  color: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
  
  &:hover {
    background: rgba(255, 255, 255, 0.2);
  }
`;

const CodeBlockWrapper = styled.div`
  margin: 6px 0;
  border-radius: 6px;
  overflow: hidden;
`;

const CodeBlockHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #f8f8f8;
  color: #999;
`;

const LanguageLabel = styled.span`
  font-size: 12px;
  font-weight: 400;
  text-transform: uppercase;
  opacity: 0.8;
`;

const MarkdownContainer = styled.div<{ $isLive?: boolean; $theme?: 'light' | 'dark' }>`
  font-size: 14px;
  line-height: 1.2;
  color: #333;
  word-break: break-word;
  max-width: 100%;
  width: 100%;
  overflow-x: auto;
  box-sizing: border-box;
  
  /* 确保样式封装，不影响外部组件 */
  & * {
    box-sizing: border-box;
  }
  
  /* 重置可能的外部样式影响 */
  &.message-markdown {
    margin: 0;
    padding: 0;
  }
  
  .md-heading {
    margin-top: 2px;
    margin-bottom: 2px;
    font-weight: 600;
    line-height: 1.2;
  }

  h1, h2, h3, h4, h5, h6 {
    margin-top: 1px;
    margin-bottom: 2px;
    font-weight: 600;
    line-height: 1.25;
  }
  
  h1 {
    font-size: 1.3em;
    padding-bottom: 0.1em;
    border-bottom: 1px solid #eaecef;
  }

  h2 {
    font-size: 1.1em;
    padding-bottom: 0.1em;
    border-bottom: 1px solid #eaecef;
  }

  h3 {
    font-size: 1em;
  }

  h4 {
    font-size: 0.8em;
  }

  p {
    margin: 0 0 1px;
    line-height: 1.4;
  }
  
  ul, ol {
    margin: 1px 0 1px 4px;
    padding: 0;
    line-height: 1.35;
  }
  
  li {
    margin-bottom: 0;
    line-height: 1.35;
  }
  
  li > ul, li > ol {
    margin-top: 1px;
    margin-bottom: 0;
  }
  
  ul ul, ul ol, ol ul, ol ol {
    margin-bottom: 0;
    margin-top: 3px;
  }
  
  pre, table {
    margin: 10px 0;
  }
  
  blockquote {
    margin: 5px 0;
    padding: 5px 5px;
  }
  
  p:empty, li:empty, div:empty {
    display: none;
    margin: 0;
    padding: 0;
  }
  
  /* 表格容器，处理溢出 */
  .table-container {
    width: 100%;
    overflow-x: auto;
    margin: 16px 0;
    border-radius: 6px;
    border: 1px solid #e1e4e8;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  }
  
  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 14px;
    margin: 0;
    display: table;
    min-width: 100%;
    box-sizing: border-box;
    background: white;
  }
  
  table th, table td {
    border: 1px solid #d1d5db;
    padding: 12px 16px;
    text-align: left;
    vertical-align: top;
    white-space: normal;
    min-width: 80px;
    max-width: 300px;
    word-break: break-word;
    overflow-wrap: break-word;
  }
  
  table th {
    background: #f8fafc;
    font-weight: 600;
    color: #374151;
    border-bottom: 2px solid #d1d5db;
  }
  
  table tbody tr:hover {
    background: #f1f5f9;
  }
  
  table tr:nth-child(even) {
    background: #f8fafc;
  }
  
  table tr:nth-child(even):hover {
    background: #f1f5f9;
  }

  code {
    font-family: SFMono-Regular, Consolas, Liberation Mono, Menlo, monospace;
    padding: 0.2em 0.4em;
    margin: 0;
    font-size: 85%;
    background-color: rgba(27, 31, 35, 0.05);
    border-radius: 3px;
  }

  pre {
    background-color: #f6f8fa;
    border-radius: 3px;
    padding: 8px;
    overflow-x: auto;
    margin: 6px 0;
    max-width: 100%;
    width: 100%;
    box-sizing: border-box;
    display: block;
    clear: both;
  }
  
  pre code {
    background-color: transparent;
    padding: 0;
    margin: 0;
    font-size: 90%;
    white-space: pre;
    overflow-x: auto;
    line-height: 1.5;
    display: block;
    max-width: 100%;
    box-sizing: border-box;
  }

  blockquote {
    margin: 3px 0;
    padding: 3px 8px;
    color: #555;
    border-left: 3px solid #1890ff;
    background-color: #f8f9fa;
    font-size: 0.95em;
  }

  img {
    max-width: 100%;
    height: auto;
    display: block;
    margin: 12px 0;
  }

  /* Mermaid图表全局样式 - 确保响应式布局 */
  .mermaid, .mermaid svg {
    max-width: 100% !important;
    width: 100% !important;
    height: auto !important;
    display: block !important;
    margin: 0 auto !important;
    overflow: visible !important;
    box-sizing: border-box !important;
  }

  /* 特殊处理序列图的宽度问题 */
  .mermaid svg[id*="sequence"] {
    min-width: 100% !important;
  }

  /* 甘特图特殊处理 */
  .mermaid svg[id*="gantt"] {
    overflow-x: auto !important;
  }

  /* 流程图优化 */
  .mermaid svg[id*="flowchart"], .mermaid svg[id*="graph"] {
    max-height: 600px !important;
  }
  
  /* 全局布局保护 - 防止任何元素破坏页面布局 */
  & > * {
    max-width: 100% !important;
    box-sizing: border-box !important;
  }
  
  /* 防止浮动元素影响布局 */
  &::after {
    content: "";
    display: table;
    clear: both;
  }
  
  a {
    color: #0366d6;
    text-decoration: none;
  }
  
  a:hover {
    text-decoration: underline;
  }
  
  hr {
    height: 1px;
    padding: 0;
    margin: 8px 0;
    background-color: #e1e4e8;
    border: 0;
  }
  
  strong {
    font-weight: 600;
  }
  
  em {
    font-style: italic;
  }
`;

const LiveIndicator = styled.div`
  display: flex;
  align-items: center;
  font-size: 13px;
  color: #1890ff;
  margin-bottom: 8px;
  gap: 6px;
`;

const PulsingDot = styled.div`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: #1890ff;
  animation: pulse 1.5s infinite;
  
  @keyframes pulse {
    0% {
      transform: scale(0.8);
      opacity: 0.8;
    }
    50% {
      transform: scale(1.2);
      opacity: 1;
    }
    100% {
      transform: scale(0.8);
      opacity: 0.8;
    }
  }
`;

export default MarkdownRenderer;