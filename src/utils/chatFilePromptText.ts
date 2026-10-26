import type { ChatFile } from '../types';
import { extractPdfViaServer, shouldTryServerPdfExtract } from '../services/documents/documentPdfExtract';
import {
  isSpacedLetterPdfArtifact,
  normalizePdfExtractedText
} from './pdfSpacedTextNormalize';
import {
  resolveSkillExecutorAuthHeaders,
  resolveSkillExecutorBaseUrl
} from './skillExecutorUrl';
import { ocrChatImageFile } from '../services/desktopKnowledge/imageOcrClient';

export type AttachmentTextBlock = {
  name: string;
  text: string;
  error?: string;
};

const OFFICE_EXTENSIONS = new Set(['.docx', '.doc']);

const TEXT_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.markdown',
  '.csv',
  '.json',
  '.xml',
  '.html',
  '.htm',
  '.yaml',
  '.yml',
  '.js',
  '.ts',
  '.tsx',
  '.jsx',
  '.py',
  '.java',
  '.go',
  '.rs',
  '.sql',
  '.sh',
  '.css',
  '.log'
]);

const MAX_FILE_BYTES = 20 * 1024 * 1024;
/** 单附件提取上限：过大时本地 Ollama 常超过 5 分钟仍无响应 */
const MAX_EXTRACTED_CHARS = 24_000;
const MAX_PDF_PAGES = 50;

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'));
    reader.readAsText(file, 'UTF-8');
  });
}

async function loadPdfJs() {
  const pdfjs = await import('pdfjs-dist');
  const workerMod = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  const workerSrc =
    typeof workerMod.default === 'string' ? workerMod.default : String(workerMod.default ?? '');
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
  return pdfjs;
}

async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await loadPdfJs();

  const data = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data }).promise;
  const parts: string[] = [];
  const pageCount = Math.min(doc.numPages, MAX_PDF_PAGES);

  for (let pageNum = 1; pageNum <= pageCount; pageNum += 1) {
    const page = await doc.getPage(pageNum);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .map((item) => {
        if (!('str' in item) || typeof item.str !== 'string') return '';
        const tail = (item as { hasEOL?: boolean }).hasEOL ? '\n' : ' ';
        return item.str + tail;
      })
      .join('')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (pageText) parts.push(pageText);
  }

  if (doc.numPages > MAX_PDF_PAGES) {
    parts.push(`[PDF 仅提取前 ${MAX_PDF_PAGES} 页，共 ${doc.numPages} 页]`);
  }

  return parts.join('\n\n');
}

function truncateExtracted(text: string): string {
  if (text.length <= MAX_EXTRACTED_CHARS) return text;
  return `${text.slice(0, MAX_EXTRACTED_CHARS)}\n\n[附件正文已截断，原长约 ${text.length} 字符]`;
}

/** 从单个聊天附件提取可供 LLM 使用的纯文本 */
export async function extractTextFromChatFile(
  file: ChatFile,
  opts?: { sessionId?: string; topicId?: string }
): Promise<AttachmentTextBlock> {
  const name = file.name || '未命名文件';
  try {
    if (file.size > MAX_FILE_BYTES) {
      return { name, text: '', error: `文件超过 ${MAX_FILE_BYTES / 1024 / 1024}MB 上限` };
    }

    const ext = extOf(name);
    const mime = (file.type || '').toLowerCase();

    if (mime.startsWith('text/') || TEXT_EXTENSIONS.has(ext)) {
      const text = truncateExtracted(await readFileAsText(file.file));
      return { name, text };
    }

    if (
      mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      OFFICE_EXTENSIONS.has(ext)
    ) {
      try {
        const base = resolveSkillExecutorBaseUrl();
        const buf = await file.file.arrayBuffer();
        const base64 = btoa(
          new Uint8Array(buf).reduce((s, b) => s + String.fromCharCode(b), '')
        );
        const resp = await fetch(`${base}/v1/documents/extract`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...resolveSkillExecutorAuthHeaders()
          },
          body: JSON.stringify({ base64, fileName: name })
        });
        if (resp.ok) {
          const json = await resp.json();
          const text = truncateExtracted(String(json.text || ''));
          if (text.length >= 40) return { name, text };
          if (json.error) return { name, text: '', error: json.error };
        }
      } catch {
        /* fall through */
      }
      return {
        name,
        text: '',
        error: 'Word 解析需 Skill Executor 在线；请另存 PDF/TXT 或粘贴正文'
      };
    }

    if (mime === 'application/pdf' || ext === '.pdf') {
      let text = truncateExtracted(await extractPdfText(file.file));
      const clientNorm = normalizePdfExtractedText(text);
      if (clientNorm.normalized) {
        text = truncateExtracted(clientNorm.text);
      }

      const tryServer =
        (shouldTryServerPdfExtract(text.length) || isSpacedLetterPdfArtifact(text)) &&
        file.file.size <= 18 * 1024 * 1024;

      if (tryServer) {
        try {
          const server = await extractPdfViaServer(file.file);
          const serverNorm = normalizePdfExtractedText(server.text);
          const serverText = truncateExtracted(serverNorm.text);
          const clientText = text;
          const serverScore =
            serverText.length *
            (serverNorm.normalized || !isSpacedLetterPdfArtifact(serverText) ? 2 : 1);
          const clientScore =
            clientText.length *
            (clientNorm.normalized || !isSpacedLetterPdfArtifact(clientText) ? 2 : 1);
          if (serverScore > clientScore) {
            text = serverText;
          }
          if (server.needsOcr && text.length < 80) {
            return {
              name,
              text: '',
              error: `扫描版或图片 PDF（服务端 ${server.method} 仍不足 ${text.length} 字）。请安装 poppler/tesseract 或粘贴文本。`
            };
          }
        } catch {
          /* 413 等：已做客户端逐字空格修复时可直接继续入库 */
        }
      }
      return { name, text };
    }

    if (mime.startsWith('image/')) {
      if (opts?.sessionId && file.file.size <= MAX_FILE_BYTES) {
        try {
          const ocr = await ocrChatImageFile(file.file, opts.sessionId, opts.topicId);
          if (ocr.success && ocr.text?.trim()) {
            return {
              name,
              text: truncateExtracted(ocr.text)
            };
          }
          if (ocr.error?.includes('PADDLE_OCR_TOKEN') || ocr.error?.includes('未配置')) {
            return {
              name,
              text: '',
              error: '图片 OCR 未配置：请在 Executor 环境变量设置 PADDLE_OCR_TOKEN'
            };
          }
          if (ocr.error?.includes('LOCAL_ONLY') || ocr.error?.includes('已禁用')) {
            return {
              name,
              text: '',
              error: '图片 OCR 已禁用（本地-only 模式）'
            };
          }
          return {
            name,
            text: '',
            error: ocr.error || 'PaddleOCR 未识别到文字'
          };
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return { name, text: '', error: `图片 OCR 失败: ${msg}` };
        }
      }
      return {
        name,
        text: '',
        error:
          '图片附件需 PaddleOCR：请配置 PADDLE_OCR_TOKEN，并在有 sessionId 时自动识别入库'
      };
    }

    return { name, text: '', error: `暂不支持解析此格式（${ext || mime || '未知'}）` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { name, text: '', error: msg };
  }
}

export async function extractTextFromChatFiles(
  files: ChatFile[],
  opts?: { sessionId?: string; topicId?: string }
): Promise<AttachmentTextBlock[]> {
  const blocks: AttachmentTextBlock[] = [];
  for (const f of files) {
    blocks.push(await extractTextFromChatFile(f, opts));
  }
  return blocks;
}

/** 将附件正文与用户补充说明拼成发给模型的 user 消息 */
/** 当前 user 消息是否已注入附件正文（用于 KGM 省略历史、避免重复 user） */
export function userInputHasAttachmentPayload(userInput: string): boolean {
  return (
    userInput.includes('【PDF 追问模式') ||
    userInput.includes('【PDF 多角色处理委员会产出') ||
    userInput.includes('【附件正文') ||
    userInput.includes('### 附件：') ||
    userInput.includes('以下为用户上传的附件')
  );
}

export function formatAttachmentsForUserPrompt(
  blocks: AttachmentTextBlock[],
  userNote: string
): string {
  const sections = blocks.map((b) => {
    if (b.error) {
      return `### 附件：${b.name}\n（解析失败：${b.error}）`;
    }
    if (!b.text.trim()) {
      return `### 附件：${b.name}\n（未能提取到文本，可能为扫描版 PDF 或空文件）`;
    }
    return `### 附件：${b.name}\n\n${b.text}`;
  });

  const header =
    '【附件正文已解析并写入本消息，你必须仅依据以下内容作答，不得声称「无法读取附件」或「系统限制无法访问 PDF」。】\n\n';
  const body = sections.join('\n\n---\n\n');
  const note = userNote.trim() ? `\n\n---\n\n用户补充说明：\n${userNote.trim()}` : '';
  return header + body + note;
}

/** 用户气泡展示的附件摘要行 */
export function formatUserMessageWithAttachments(userNote: string, fileNames: string[]): string {
  const note = userNote.trim();
  if (!fileNames.length) return note;
  const attachLine = `📎 附件：${fileNames.join(' · ')}`;
  return note ? `${note}\n\n${attachLine}` : attachLine;
}
