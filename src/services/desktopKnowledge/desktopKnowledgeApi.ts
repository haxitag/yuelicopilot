import {
  resolveSkillExecutorAuthHeaders,
  resolveSkillExecutorBaseUrl
} from '../../utils/skillExecutorUrl';

export type FusionPolicy =
  | 'local_first'
  | 'session_first'
  | 'memory_first'
  | 'web_supplement'
  | 'local_only';

export type FusionRecallParams = {
  query: string;
  policy?: FusionPolicy;
  userId?: string;
  topicId?: string;
  sessionId?: string;
  documentIds?: string[];
  workspaceId?: string;
  topK?: number;
  includeWeb?: boolean;
  webTopUrls?: number;
};

export type FusionRecallResult = {
  success: boolean;
  llmContext?: string;
  webContext?: string;
  hits?: Array<{ content?: string; channel?: string }>;
  buckets?: Record<string, number>;
  error?: string;
};

function headers(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...resolveSkillExecutorAuthHeaders()
  };
}

async function postTool<T>(toolName: string, body: Record<string, unknown>): Promise<T> {
  const base = resolveSkillExecutorBaseUrl();
  const res = await fetch(`${base}/v1/tools/${toolName}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body)
  });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(json?.error || `${toolName} HTTP ${res.status}`);
  }
  return json as T;
}

export async function callFusionRecall(params: FusionRecallParams): Promise<FusionRecallResult> {
  return postTool('fusion_recall', {
    query: params.query,
    policy: params.policy ?? 'local_first',
    userId: params.userId,
    topicId: params.topicId,
    sessionId: params.sessionId,
    documentIds: params.documentIds,
    workspaceId: params.workspaceId,
    topK: params.topK ?? 8,
    includeWeb: params.includeWeb ?? false,
    webTopUrls: params.webTopUrls ?? 2
  });
}

export async function scanWorkspace(params: {
  workspaceId: string;
  rootPath: string;
  maxFiles?: number;
}) {
  return postTool('workspace_scan', {
    workspace_id: params.workspaceId,
    root_path: params.rootPath,
    max_files: params.maxFiles
  });
}

export async function ingestClipboard(params: {
  sessionId: string;
  text: string;
  title?: string;
}) {
  return postTool('desktop_clipboard_ingest', params);
}

export async function fetchDesktopPrivacy() {
  return postTool<{ localOnly: boolean; blockWeb: boolean; blockJina: boolean }>(
    'desktop_privacy',
    {}
  );
}

export async function buildResearchPlan(query: string) {
  return postTool<{ plan: { topic: string; subQuestions: Array<{ id: string; text: string }> } }>(
    'desktop_research_plan',
    { query }
  );
}

export type ImageOcrIngestParams = {
  sessionId: string;
  image_base64?: string;
  file_path?: string;
  file_url?: string;
  file_name?: string;
  title?: string;
  topicId?: string;
  ingest?: boolean;
};

export type ImageOcrIngestResult = {
  success: boolean;
  text?: string;
  documentId?: string;
  chunkCount?: number;
  charCount?: number;
  ingested?: boolean;
  error?: string;
  ocr?: { jobId?: string; pageCount?: number; model?: string };
};

export async function ocrImageIngest(params: ImageOcrIngestParams): Promise<ImageOcrIngestResult> {
  try {
    return await postTool('desktop_image_ocr_ingest', {
      sessionId: params.sessionId,
      image_base64: params.image_base64,
      file_path: params.file_path,
      file_url: params.file_url,
      file_name: params.file_name,
      title: params.title,
      topicId: params.topicId,
      ingest: params.ingest !== false
    });
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** 聊天图片附件：PaddleOCR 识别并入库 */
export async function ocrChatImageFile(
  file: File,
  sessionId: string,
  topicId?: string
): Promise<ImageOcrIngestResult> {
  if (file.size > 20 * 1024 * 1024) {
    return { success: false, error: 'Image too large (max 20MB)' };
  }
  const image_base64 = await fileToBase64(file);
  return ocrImageIngest({
    sessionId,
    image_base64,
    file_name: file.name,
    title: `截图: ${file.name}`,
    topicId,
    ingest: true
  });
}
