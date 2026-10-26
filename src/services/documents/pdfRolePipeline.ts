import type { PdfPipelineRoleMeta, PdfPipelineRoleOutput } from './types';
import type { ChatDocumentRecord } from './types';
import { recallChatDocumentChunks } from './documentVectorIndex';
import type defaultApiService from '../../api/services/apiService';

type DocumentMemoryClient = Pick<
  typeof defaultApiService,
  'kgmMemoryStore' | 'kgmMemorySearch'
>;

export const PDF_PROCESSING_ROLES: PdfPipelineRoleMeta[] = [
  {
    id: 'indexer',
    displayName: '索引员',
    perspective: '分块、入库、建立文档对象与向量索引，供后续各阶段 RAG 召回'
  },
  {
    id: 'structural_analyst',
    displayName: '结构分析员',
    perspective: '识别章节、标题层级、列表与文档骨架'
  },
  {
    id: 'summarizer',
    displayName: '摘要员',
    perspective: '提炼全文要点与结论，控制篇幅'
  },
  {
    id: 'paraphraser',
    displayName: '转述员',
    perspective: '用中立、可读的表述重述核心论述（非逐句翻译）'
  },
  {
    id: 'data_extractor',
    displayName: '数据抽取员',
    perspective: '提取数字、指标、日期、实体与可表格化信息'
  },
  {
    id: 'rag_curator',
    displayName: 'RAG 策展员',
    perspective: '按用户问题从向量库召回最相关片段并编排引用'
  }
];

function extractHeadings(text: string, max = 24): string[] {
  const lines = text.split('\n');
  const out: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.length > 200) continue;
    if (/^#{1,6}\s/.test(t)) {
      out.push(t.replace(/^#+\s*/, ''));
    } else if (/^第[一二三四五六七八九十0-9]+[章节部分篇]/.test(t)) {
      out.push(t);
    } else if (/^\d+(\.\d+)*\s+[\u4e00-\u9fffA-Za-z]/.test(t) && t.length < 120) {
      out.push(t);
    }
    if (out.length >= max) break;
  }
  return out;
}

function extractiveSummary(text: string, maxChars = 2200): string {
  const paras = text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 40);
  const parts: string[] = [];
  let len = 0;
  for (const p of paras) {
    if (len + p.length > maxChars) break;
    parts.push(p);
    len += p.length;
  }
  if (parts.length === 0) return text.slice(0, maxChars);
  return parts.join('\n\n');
}

function paraphraseCore(text: string, maxChars = 1600): string {
  const summary = extractiveSummary(text, maxChars);
  return summary
    .replace(/\s{2,}/g, ' ')
    .replace(/([。！？])\s*/g, '$1\n')
    .trim();
}

function extractDataPoints(text: string, max = 30): string[] {
  const points: string[] = [];
  const patterns = [
    /\b20\d{2}[-/年]\d{1,2}[-/月]\d{1,2}日?\b/g,
    /\b\d+(?:\.\d+)?%/g,
    /\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/g,
    /(?:高达|约|超过|不少于|至少)\s*[\d,.]+[%万亿千百]?/g
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) points.push(...m.slice(0, 12));
  }
  const lines = text.split('\n').filter((l) => /\|.*\|/.test(l) || /[:：]\s*\S/.test(l));
  for (const line of lines.slice(0, 8)) {
    const t = line.trim();
    if (t.length > 10 && t.length < 160) points.push(t);
  }
  return [...new Set(points)].slice(0, max);
}

export function runIndexerRoleOutput(
  docs: ChatDocumentRecord[],
  indexedChunkCount: number
): PdfPipelineRoleOutput {
  const lines = docs.map((d) => {
    const status =
      d.indexingStatus === 'queued' || d.indexingStatus === 'running' || d.indexingStatus === 'paused'
        ? `后台索引${d.indexingStatus === 'paused' ? '已暂停' : '进行中'}（${d.indexedChunkCount ?? 0}/${d.chunkCount}）`
        : d.indexingStatus === 'failed'
          ? `索引失败（${d.indexError || '请检查 embedding 配置'}）`
          : d.indexed
            ? '已写入'
            : '未写入（请检查 embedding 配置）';
    return `- **${d.fileName}**（documentId=\`${d.id}\`）：${d.charCount} 字，${d.chunkCount} 块，向量索引${status}`;
  });
  return {
    roleId: 'indexer',
    displayName: '索引员',
    content: [
      indexedChunkCount > 0
        ? `已注册 ${docs.length} 个文档对象；累计 ${indexedChunkCount} 块写入向量库 collection \`yueli_chat_documents\`。`
        : `已注册 ${docs.length} 个文档对象；向量索引已进入后台队列，当前问答会先使用文档摘录 / Executor RAG 兜底。`,
      '',
      ...lines
    ].join('\n')
  };
}

export function runStructuralAnalystRole(text: string, fileName: string): PdfPipelineRoleOutput {
  const headings = extractHeadings(text);
  const lines = [
    `文档：${fileName}`,
    `规模：约 ${text.length} 字符`,
    headings.length
      ? `识别到 ${headings.length} 个结构节点：\n${headings.map((h) => `- ${h}`).join('\n')}`
      : '未识别明显标题层级（可能为连续叙述体）。'
  ];
  return {
    roleId: 'structural_analyst',
    displayName: '结构分析员',
    content: lines.join('\n')
  };
}

export function runSummarizerRole(text: string, fileName: string): PdfPipelineRoleOutput {
  return {
    roleId: 'summarizer',
    displayName: '摘要员',
    content: `### ${fileName} 摘要\n\n${extractiveSummary(text)}`
  };
}

export function runParaphraserRole(text: string, fileName: string): PdfPipelineRoleOutput {
  return {
    roleId: 'paraphraser',
    displayName: '转述员',
    content: `### ${fileName} 核心转述\n\n${paraphraseCore(text)}`
  };
}

export function runDataExtractorRole(text: string, fileName: string): PdfPipelineRoleOutput {
  const points = extractDataPoints(text);
  return {
    roleId: 'data_extractor',
    displayName: '数据抽取员',
    content:
      points.length > 0
        ? `### ${fileName}\n${points.map((p) => `- ${p}`).join('\n')}`
        : `### ${fileName}\n（未检测到明显数值/表格行；请以摘要与 RAG 片段为准。）`
  };
}

export async function runRagCuratorRole(params: {
  apiService: DocumentMemoryClient;
  userQuery: string;
  documentIds: string[];
  fallbackExcerpt: string;
}): Promise<PdfPipelineRoleOutput> {
  const recalled = await recallChatDocumentChunks({
    apiService: params.apiService,
    query: params.userQuery || '文档要点 总结',
    documentIds: params.documentIds,
    topK: 8
  });

  let body: string;
  if (recalled.length > 0) {
    body = recalled
      .map((r, i) => {
        const meta = r.metadata as { fileName?: string; chunkIndex?: number } | undefined;
        const label = meta?.fileName
          ? `${meta.fileName}#${meta.chunkIndex ?? i}`
          : `片段${i + 1}`;
        return `#### [${label}]\n${r.content.trim()}`;
      })
      .join('\n\n');
  } else {
    body = `（向量召回无结果，回退摘录前 3500 字）\n\n${params.fallbackExcerpt.slice(0, 3500)}`;
  }

  return {
    roleId: 'rag_curator',
    displayName: 'RAG 策展员',
    content: `针对用户问题「${params.userQuery || '（未提供）'}」的相关片段：\n\n${body}`
  };
}

export function formatRoleOutputsAsPrompt(
  roleOutputs: PdfPipelineRoleOutput[],
  userNote: string
): string {
  const sections = roleOutputs.map(
    (r) => `## 【${r.displayName}】${r.displayName === '索引员' ? '' : `（${r.roleId}）`}\n\n${r.content}`
  );

  return [
    '【PDF 多角色处理委员会产出 — 已解析、分角色建模并写入向量库；请基于以下内容回答，不得声称无法读取附件。】',
    '',
    ...sections,
    '',
    '---',
    '',
    '## 用户任务',
    userNote.trim() || '（请根据上文处理结果完成分析/总结/抽取。）',
    '',
    '> 完整正文已分块索引；若需细节可结合 RAG 策展员片段与 documentId 二次召回。'
  ].join('\n');
}
