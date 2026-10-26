import {
  resolveSkillExecutorAuthHeaders,
  resolveSkillExecutorBaseUrl
} from '../../utils/skillExecutorUrl';
import { devLog, devWarn } from '../../utils/devConsole';

const MIN_CLIENT_CHARS = 80;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? '');
      const comma = dataUrl.indexOf(',');
      resolve(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
    };
    reader.onerror = () => reject(reader.error ?? new Error('读取 PDF 失败'));
    reader.readAsDataURL(file);
  });
}

export type ServerPdfExtractResult = {
  text: string;
  method: string;
  needsOcr: boolean;
};

/** 浏览器 pdf.js 提取不足时，走 Executor 服务端提取链 */
export async function extractPdfViaServer(file: File): Promise<ServerPdfExtractResult> {
  const base = resolveSkillExecutorBaseUrl();
  const base64 = await fileToBase64(file);
  const resp = await fetch(`${base}/v1/documents/extract-pdf`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...resolveSkillExecutorAuthHeaders()
    },
    body: JSON.stringify({ base64, fileName: file.name })
  });
  if (!resp.ok) {
    if (resp.status === 413) {
      devWarn(
        '[documentPdfExtract] HTTP 413：PDF 过大或未重启 Executor（需 SKILL_EXECUTOR_JSON_LIMIT≥20mb）。将仅用浏览器提取+本地修复。'
      );
    } else {
      devWarn('[documentPdfExtract] HTTP', resp.status);
    }
    return { text: '', method: resp.status === 413 ? 'payload_too_large' : 'error', needsOcr: true };
  }
  const json = await resp.json();
  devLog('[documentPdfExtract]', file.name, json.method, (json.text || '').length);
  return {
    text: String(json.text || ''),
    method: String(json.method || 'unknown'),
    needsOcr: Boolean(json.needsOcr)
  };
}

export function shouldTryServerPdfExtract(clientTextLength: number): boolean {
  return clientTextLength < MIN_CLIENT_CHARS;
}
