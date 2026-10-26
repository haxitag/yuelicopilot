import type { ChatFile } from '../types';

type PickedFilePayload = {
  name: string;
  type: string;
  size: number;
  base64: string;
};

type YueliDesktopBridge = {
  platform?: string;
  pickFiles?: () => Promise<PickedFilePayload[]>;
};

function base64ToFile(payload: PickedFilePayload): File {
  const binary = atob(payload.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: payload.type || 'application/octet-stream' });
  return new File([blob], payload.name, { type: payload.type || 'application/octet-stream' });
}

function toChatFiles(files: File[]): ChatFile[] {
  return files.map((file) => ({
    id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    name: file.name,
    type: file.type,
    size: file.size,
    file,
  }));
}

/** Electron 系统文件对话框：`null` 非桌面；`[]` 用户取消；否则为已选文件 */
export async function pickChatFilesViaDesktop(): Promise<ChatFile[] | null> {
  const bridge = (window as Window & { yueliDesktop?: YueliDesktopBridge }).yueliDesktop;
  if (!bridge?.pickFiles) return null;
  const picked = await bridge.pickFiles();
  if (!picked.length) return [];
  return toChatFiles(picked.map(base64ToFile));
}
