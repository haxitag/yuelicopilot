import type { TopicLike } from '../TopicFilesStore';
import { scanWorkspace } from './desktopKnowledgeApi';
import { persistTopicsToStorage } from '../TopicFilesStore';

export function topicHasWorkspace(topic: TopicLike | null | undefined): boolean {
  return Boolean(topic?.workspaceRoot?.trim());
}

/** workspace_id 固定为 topic.id，不再使用独立 localStorage */
export function getTopicWorkspaceId(topic: TopicLike): string {
  return String(topic.id).trim();
}

export function clearLegacyWorkspaceLocalStorage(): void {
  try {
    localStorage.removeItem('yueli_workspace_id');
    localStorage.removeItem('yueli_workspace_root');
  } catch {
    /* ignore */
  }
}

export async function scanTopicWorkspaceDirectory(
  topic: TopicLike,
  opts?: { maxFiles?: number }
): Promise<{
  success: boolean;
  indexedCount?: number;
  error?: string;
  topic: TopicLike;
}> {
  const root = topic.workspaceRoot?.trim();
  if (!root) {
    return { success: false, error: '未配置本机工作区目录', topic };
  }

  const result = (await scanWorkspace({
    workspaceId: getTopicWorkspaceId(topic),
    rootPath: root,
    maxFiles: opts?.maxFiles ?? 80
  })) as {
    success?: boolean;
    indexedCount?: number;
    error?: string;
  };

  if (!result?.success) {
    return {
      success: false,
      error: result?.error || '扫描失败',
      topic
    };
  }

  const patched: TopicLike = {
    ...topic,
    workspaceLastScanAt: Date.now(),
    workspaceIndexedCount: result.indexedCount ?? 0
  };

  return {
    success: true,
    indexedCount: patched.workspaceIndexedCount,
    topic: patched
  };
}

/** 扫描后写回 yueli_topics，并返回更新后的主题列表 */
export async function scanAndPersistTopicWorkspace(
  topics: TopicLike[],
  topicId: string,
  opts?: { maxFiles?: number }
): Promise<{ topics: TopicLike[]; scan: Awaited<ReturnType<typeof scanTopicWorkspaceDirectory>> }> {
  const topic = topics.find((t) => t.id === topicId);
  if (!topic) {
    return {
      topics,
      scan: { success: false, error: '主题不存在', topic: { id: topicId } }
    };
  }
  const scan = await scanTopicWorkspaceDirectory(topic, opts);
  if (!scan.success) {
    return { topics, scan };
  }
  const updated = topics.map((t) => (t.id === topicId ? scan.topic : t));
  await persistTopicsToStorage(updated);
  clearLegacyWorkspaceLocalStorage();
  return { topics: updated, scan };
}

export function resolveTopicFromList(
  selected: TopicLike | null | undefined,
  topics: TopicLike[]
): TopicLike | null {
  if (!selected?.id) return selected ?? null;
  return topics.find((t) => t.id === selected.id) ?? selected;
}
