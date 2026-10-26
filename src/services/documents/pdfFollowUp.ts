import type { Message } from '../../types';
import type defaultApiService from '../../api/services/apiService';
import { hybridDocumentRetrieve, formatRagHitsForPrompt } from './documentRag';
import { buildDesktopFusionContext } from '../desktopKnowledge/desktopFusionPrompt';
import type { TopicLike } from '../TopicFilesStore';
import { formatRoleOutputsAsPrompt } from './pdfRolePipeline';
import type { PdfPipelineRoleOutput } from './types';
import { listDocumentsBySession } from './documentRegistry';

import type { DocumentMemorySearchClient } from './documentVectorIndex';

export function collectSessionDocumentIds(recentMessages: Message[]): string[] {
  const ids = new Set<string>();
  for (const msg of recentMessages) {
    const meta = msg.metadata as { document_ids?: string[] } | undefined;
    if (Array.isArray(meta?.document_ids)) {
      for (const id of meta.document_ids) {
        if (id) ids.add(id);
      }
    }
  }
  return [...ids];
}

export async function buildDocumentFollowUpPrompt(params: {
  sessionId: string;
  documentIds: string[];
  userNote: string;
  apiService: DocumentMemorySearchClient;
  userId?: string;
  topicId?: string;
  topic?: TopicLike | null;
  includeWebFusion?: boolean;
}): Promise<{ prompt: string; roleOutputs: PdfPipelineRoleOutput[] }> {
  const docs = listDocumentsBySession(params.sessionId).filter((d) =>
    params.documentIds.includes(d.id)
  );
  const fileList =
    docs.length > 0
      ? docs.map((d) => `- ${d.fileName} (\`${d.id}\`)`).join('\n')
      : params.documentIds.map((id) => `- \`${id}\``).join('\n');

  let ragBody: string;
  const fusionCtx = await buildDesktopFusionContext({
    query: params.userNote,
    sessionId: params.sessionId,
    documentIds: params.documentIds,
    topic: params.topic,
    topicId: params.topicId,
    userId: params.userId,
    includeWeb: params.includeWebFusion
  });

  const useFusion =
    fusionCtx &&
    (Boolean(params.topic?.workspaceLastScanAt) || Boolean(params.topicId));
  if (useFusion) {
    ragBody = fusionCtx;
  } else {
    const { hits, rewrite } = await hybridDocumentRetrieve({
      documentIds: params.documentIds,
      query: params.userNote,
      sessionId: params.sessionId,
      userId: params.userId,
      apiService: params.apiService,
      topK: 6
    });
    ragBody = formatRagHitsForPrompt(hits, params.userNote);
    if (rewrite?.rewritten && rewrite.rewritten !== params.userNote) {
      ragBody += `\n\n> 查询已结合会话上下文重写。`;
    }
  }

  const roleOutputs: PdfPipelineRoleOutput[] = [
    {
      roleId: 'indexer',
      displayName: '索引员',
      content: `本会话已索引文档（follow-up 模式，未重跑委员会）：\n${fileList}`
    },
    {
      roleId: 'rag_curator',
      displayName: 'RAG 策展员',
      content: `针对追问「${params.userNote}」召回片段：\n\n${ragBody}`
    }
  ];

  const prompt = [
    '【PDF 追问模式 — RRF 混合检索（向量+BM25）+ 查询重写 + 用户问题】',
    '请直接用中文回答用户问题，只输出正文结论；不要输出英文、不要复述指令、不要写「我应该」等自我叙述。',
    '',
    formatRoleOutputsAsPrompt(roleOutputs, params.userNote)
  ].join('\n');

  return { prompt, roleOutputs };
}
