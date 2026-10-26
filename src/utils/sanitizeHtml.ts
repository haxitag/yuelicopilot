/**
 * HTML 消毒工具：对用户/外部内容使用 DOMPurify 后再插入 dangerouslySetInnerHTML，防止 XSS
 */
import DOMPurify from 'dompurify';

const defaultConfig = {
  ALLOWED_TAGS: [
    'p', 'br', 'strong', 'em', 'u', 's', 'a', 'ul', 'ol', 'li',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'code', 'pre',
    'table', 'thead', 'tbody', 'tr', 'th', 'td', 'span', 'div',
    'img', 'svg', 'path', 'g', 'use', 'defs', 'clipPath', 'rect', 'circle', 'line', 'text', 'tspan',
  ],
  ALLOWED_ATTR: [
    'href', 'target', 'rel', 'class', 'id', 'style',
    'src', 'alt', 'width', 'height',
    'd', 'viewBox', 'fill', 'stroke', 'transform', 'x', 'y', 'xlink:href',
  ],
  ADD_ATTR: ['target'],
};

/**
 * 消毒 HTML 字符串（用于协议、富文本等）
 */
export function sanitizeHtml(html: string, config?: Record<string, unknown>): string {
  if (typeof html !== 'string') return '';
  return String(DOMPurify.sanitize(html, { ...defaultConfig, ...config }));
}

/**
 * 消毒 SVG/图表 HTML（允许更多 SVG 相关标签）
 */
export function sanitizeSvgHtml(svg: string): string {
  if (typeof svg !== 'string') return '';
  return String(
    DOMPurify.sanitize(svg, {
      USE_PROFILES: { svg: true },
      ADD_TAGS: ['use', 'defs', 'clipPath', 'path', 'g', 'rect', 'circle', 'line', 'text', 'tspan'],
      ADD_ATTR: ['xlink:href', 'viewBox', 'xmlns'],
    }),
  );
}
