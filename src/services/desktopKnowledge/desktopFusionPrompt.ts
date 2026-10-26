import { readFusionPolicy } from '../chat/KnowledgeScope';
import type { TopicLike } from '../TopicFilesStore';
import { callFusionRecall } from './desktopKnowledgeApi';
import { getTopicWorkspaceId, topicHasWorkspace } from './topicWorkspace';
import { devWarn } from '../../utils/devConsole';

/**
 * 桌面多源融合上下文（P0）：主题本机目录 > 会话附件 > 主题记忆 > 可选联网
 * 后端失败时返回 null 且不抛错，避免拖垮发送；与「无命中」同样为空，但会打 degraded 日志。
 */
export async function buildDesktopFusionContext(params: {
  query: string;
  sessionId: string;
  documentIds?: string[];
  topic?: TopicLike | null;
  topicId?: string;
  userId?: string;
  includeWeb?: boolean;
}): Promise<string | null> {
  const topic = params.topic;
  const topicId = params.topicId ?? topic?.id;
  const policy = readFusionPolicy();
  const hasWorkspace = topicHasWorkspace(topic) && Boolean(topic?.workspaceLastScanAt);
  const hasDocs = (params.documentIds?.length ?? 0) > 0;
  const hasTopicMem = Boolean(topicId);

  if (!hasWorkspace && !hasDocs && !hasTopicMem && !params.includeWeb) {
    return null;
  }

  let out: Awaited<ReturnType<typeof callFusionRecall>>;
  try {
    out = await callFusionRecall({
      query: params.query,
      policy,
      sessionId: params.sessionId,
      documentIds: params.documentIds,
      topicId,
      workspaceId: hasWorkspace && topic ? getTopicWorkspaceId(topic) : undefined,
      userId: params.userId,
      includeWeb: params.includeWeb && policy !== 'local_only',
      topK: 8
    });
  } catch (e) {
    devWarn('[buildDesktopFusionContext] fusion_recall failed:', e instanceof Error ? e.message : e);
    return null;
  }

  if (!out.success) {
    devWarn('[buildDesktopFusionContext] fusion_recall returned success=false');
    return null;
  }
  const parts = [out.llmContext, out.webContext].filter(Boolean);
  return parts.length ? parts.join('\n\n') : null;
}
