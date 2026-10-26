import React, { useEffect, useRef, useState } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

import { splitProseByRemarkMathMdast } from '../chat/markdownMathProseSplit';
import { applyLatexProseHygiene } from './latexProseHygiene';
import { parseLaTeXContentLegacy } from './latexContentLegacy';
import type { RenderContent } from './RenderOutput';
import { devLog, devError } from '../../../utils/devConsole';

const latexParseDevLog = (...args: unknown[]) => devLog('[parseLaTeXContent]', ...args);

/** `\(` `\[`**：走历史行解析；其余走 remark-math mdast 拆块 */
export function parseLaTeXContent(content: string): RenderContent[] {
  const trimmed = content.trim();
  if (!trimmed) return [];

  const hygiened = applyLatexProseHygiene(trimmed);
  latexParseDevLog('清洗后预览:', hygiened.substring(0, 220));

  const needsLegacyDelimiters = /\\\(|\\\[/u.test(hygiened);
  let blocks: RenderContent[];

  if (needsLegacyDelimiters) {
    latexParseDevLog('路由：legacy \\( \\[');
    blocks = parseLaTeXContentLegacy(hygiened);
  } else {
    const byMath = splitProseByRemarkMathMdast(hygiened);
    if (byMath !== null) {
      latexParseDevLog('路由：remark-math，块数', byMath.length);
      blocks = byMath;
    } else {
      latexParseDevLog('路由：remark-math 失败，降级 legacy');
      blocks = parseLaTeXContentLegacy(hygiened);
    }
  }

  latexParseDevLog(
    '完成，块:',
    blocks.length,
    blocks.map((b) => b.type),
  );

  return blocks;
}

interface LaTeXRendererProps {
  content: string;
  displayMode?: boolean;
  className?: string;
}

const LaTeXRenderer: React.FC<LaTeXRendererProps> = ({ 
  content, 
  displayMode = false, 
  className = '' 
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  useEffect(() => {
    if (!containerRef.current || !content) return;

    let cleanContent = content.trim().replace(/\s+/g, ' ');
    try {
      // 清理内容中的多余空格和换行符
      cleanContent = content.trim().replace(/\s+/g, ' ');
      
      // 确保KaTeX配置支持中文
      if ((window as any).katex) {
        (window as any).katex.defaults = {
          ...(window as any).katex.defaults,
          strict: false,
          trust: true
        };
      }
      
      // 使用KaTeX渲染LaTeX
      katex.render(cleanContent, containerRef.current, {
        displayMode,
        throwOnError: false,
        errorColor: '#cc0000',
        strict: false,
        trust: true,
        macros: {
          "\\text": "\\text{#1}",
          "\\frac": "\\frac{#1}{#2}",
          "\\sum": "\\sum",
          "\\times": "\\times"
        }
      });
      
      // 检查是否溢出（借鉴beautiful-mermaid的响应式处理思路）
      if (containerRef.current) {
        const renderedElement = containerRef.current.querySelector('.katex-display, .katex');
        if (renderedElement) {
          const containerWidth = containerRef.current.parentElement?.clientWidth || window.innerWidth;
          const renderedWidth = renderedElement.getBoundingClientRect().width;
          setIsOverflowing(renderedWidth > containerWidth - 40); // 留出padding
        }
      }
      
      setError(null);
    } catch (err) {
      devError('[LaTeXRenderer]', err);
      setError(err instanceof Error ? err.message : 'LaTeX渲染失败');
      
      // 错误恢复机制：尝试分段渲染
      if (containerRef.current && err instanceof Error) {
        try {
          // 尝试移除可能导致错误的特殊字符
          const sanitizedContent = cleanContent.replace(/[^\x20-\x7E\u00A0-\uFFFF]/g, '');
          if (sanitizedContent !== cleanContent) {
            katex.render(sanitizedContent, containerRef.current, {
              displayMode,
              throwOnError: false,
              errorColor: '#cc0000',
              strict: false,
              trust: true
            });
            setError(null);
            return;
          }
        } catch (retryErr) {
          // 如果重试也失败，显示原始内容
          if (containerRef.current) {
            containerRef.current.textContent = content;
          }
        }
      }
    }
  }, [content, displayMode]);

  if (error) {
    return (
      <div className={`latex-error ${className}`} style={{
        color: '#cc0000',
        fontSize: '14px',
        padding: '8px',
        border: '1px solid #ffcccc',
        borderRadius: '4px',
        backgroundColor: '#fff5f5'
      }}>
        <div>LaTeX渲染错误: {error}</div>
        <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>
          原始内容: {content}
        </div>
      </div>
    );
  }

  return (
    <div 
      ref={containerRef} 
      className={`latex-renderer ${className}`}
      style={{
        display: displayMode ? 'block' : 'inline',
        textAlign: displayMode ? 'center' : 'inherit',
        margin: displayMode ? '16px 0' : '0',
        padding: displayMode ? '8px' : '0',
        // 响应式处理：如果溢出则允许横向滚动
        overflowX: isOverflowing ? 'auto' : 'visible',
        overflowY: 'visible',
        maxWidth: '100%',
        // 长公式支持缩放（借鉴beautiful-mermaid的适配思路）
        transform: isOverflowing && displayMode ? 'scale(0.9)' : 'none',
        transformOrigin: 'center center',
        transition: 'transform 0.2s ease'
      }}
    />
  );
};

export default LaTeXRenderer;
