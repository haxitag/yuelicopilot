import { resolveCloudProviderChatUrl } from './inferenceChatEndpoint';
import type { CloudProviderRow } from './defaultCloudProviders';

/**
 * 开发/桌面经 gateway 同源代理，避免浏览器 CORS；打包后同源 /yueliai 亦由 gateway 转发。
 */
export function resolveYueliaiChatUrlForApp(row: Pick<CloudProviderRow, 'apiUrl' | 'presetId'>): string {
  const direct = resolveCloudProviderChatUrl(row);
  if (!direct) return '';
  try {
    const u = new URL(direct);
    if (u.hostname === 'yueli.com' || u.hostname.endsWith('.yueli.com')) {
      return `/yueliai${u.pathname}${u.search}`;
    }
  } catch {
    /* ignore */
  }
  return direct;
}
