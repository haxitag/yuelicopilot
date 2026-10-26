/**
 * 上游 Prompt 约束：要求模型输出可解析的 GFM Markdown。
 * 展示/落盘仍须走 prepareChatMessageContent 兜底（模型不保证 100% 合规）。
 */
export const MARKDOWN_GFM_OUTPUT_RULES = `## Markdown 输出格式（必须遵守）

面向用户的正文须为 **GitHub Flavored Markdown**，且满足：

1. **标题**：使用 \`##\` / \`###\` 时，\`#\` 后必须有空格（正确：\`## 一、标题\`；错误：\`##一\`、\`--##一\`）。
2. **独占行**：每个标题、分隔线 \`---\`、表格、列表项必须独占一行；禁止把 \`---\`、\`##\`、\`|\` 表格与段落粘在同一行。
3. **表格**：表头、分隔行 \`| --- |\`、数据行各占一行；禁止 \`|列1|列2|内容...\` 单行墙。
4. **列表**：\`- \` 或 \`1. \` 须在行首（行前空一行与段落分隔）。
5. **禁止伪格式**：不要输出 \`###结论>\`、行内长串 \`----------\` 代替分隔线。

若需总结多段技能输出，用空行与二级标题分段，不要压缩成一段无换行长文。`;

/** 若 system prompt 尚未包含 Markdown 规则段，则追加 */
export function appendMarkdownOutputRules(systemContent: string): string {
  const t = (systemContent || '').trim();
  if (!t) return MARKDOWN_GFM_OUTPUT_RULES;
  if (t.includes('Markdown 输出格式') || t.includes('GFM Markdown')) return t;
  return `${t}\n\n${MARKDOWN_GFM_OUTPUT_RULES}`;
}
