import apiService from '../api/services/apiService';
import { KGM_CANARY_CACHE_KEY } from '../api/services/apiService';
import {
  ensureDefaultCloudProvidersInLocalStorage,
  ensureDefaultKgmChatDefaultsInLocalStorage,
  readCloudProvidersFromLocalStorage
} from '../utils/defaultCloudProviders';
import { migrateMisconfiguredLocalServiceUrls } from '../utils/kgmBrowserBaseUrl';
import { syncCloudProvidersToKgm } from '../utils/kgmProviderSync';
import { resolveSkillExecutorAuthHeaders, resolveSkillExecutorBaseUrl } from '../utils/skillExecutorUrl';

export type StartupCheckStatus = 'ok' | 'warn' | 'error';

export interface StartupCheckItem {
  id: 'kgm' | 'executor' | 'ollama' | 'cloud' | 'config';
  label: string;
  status: StartupCheckStatus;
  detail: string;
  fix?: string;
  latencyMs?: number;
}

export interface StartupSelfCheckResult {
  ok: boolean;
  checkedAt: number;
  items: StartupCheckItem[];
}

async function probeJson(url: string, opts?: { headers?: Record<string, string>; timeoutMs?: number }) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts?.timeoutMs ?? 3500);
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: opts?.headers,
      signal: controller.signal
    });
    const text = await response.text().catch(() => '');
    return {
      ok: response.ok,
      status: response.status,
      text,
      latencyMs: Date.now() - startedAt
    };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      text: e instanceof Error ? e.message : String(e),
      latencyMs: Date.now() - startedAt
    };
  } finally {
    clearTimeout(timer);
  }
}

function compact(text: string, max = 180): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}...` : oneLine;
}

/** 等待同源 /kgm 路由可用（Gateway 已起但 KGM 仍在拉起时常见 502） */
export async function waitForKgmRouteReady(opts?: {
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<{ ok: boolean; status: number; latencyMs: number }> {
  const timeoutMs = opts?.timeoutMs ?? 45_000;
  const intervalMs = opts?.intervalMs ?? 1200;
  const startedAt = Date.now();
  let last = { ok: false, status: 0, latencyMs: 0 };

  while (Date.now() - startedAt < timeoutMs) {
    last = await probeJson('/kgm/v1/models', { timeoutMs: 5000 });
    if (last.ok) return last;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return last;
}

export async function runStartupSelfCheck(): Promise<StartupSelfCheckResult> {
  const items: StartupCheckItem[] = [];

  const configIssues: string[] = [];
  const kgmBase = localStorage.getItem('kgmBaseUrl') || '/kgm';
  const executorBase = resolveSkillExecutorBaseUrl();
  const selectedProvider = localStorage.getItem('selectedProvider') || 'kgm';
  if (selectedProvider !== 'kgm') {
    configIssues.push('默认对话 provider 不是 KGM 动态路由');
  }
  if (kgmBase !== '/kgm' && kgmBase.startsWith('http')) {
    configIssues.push('桌面/dev 环境建议 KGM 走同源 /kgm，避免 CORS 和端口漂移');
  }
  if (executorBase !== '/api' && typeof window !== 'undefined' && window.yueliDesktop) {
    configIssues.push('桌面端建议 Skill Executor 走同源 /api');
  }
  items.push({
    id: 'config',
    label: '本地配置',
    status: configIssues.length ? 'warn' : 'ok',
    detail: configIssues.length ? configIssues.join('；') : '桌面默认配置',
    fix: configIssues.length ? '恢复默认路径并清理缓存' : undefined
  });

  const kgm = await probeJson('/kgm/v1/models', { timeoutMs: 4000 });
  items.push({
    id: 'kgm',
    label: 'KGM 路由',
    status: kgm.ok ? 'ok' : 'error',
    detail: kgm.ok ? 'KGM 可用' : `KGM 异常：${kgm.status || kgm.text}`,
    fix: kgm.ok ? undefined : '重启后台或检查 KGM_PORT',
    latencyMs: kgm.latencyMs
  });

  const executor = await probeJson(`${executorBase}/health`, {
    headers: resolveSkillExecutorAuthHeaders(),
    timeoutMs: 3500
  });
  items.push({
    id: 'executor',
    label: 'Skill Executor',
    status: executor.ok ? 'ok' : 'warn',
    detail: executor.ok ? 'Executor 可用' : `Executor 未就绪：${executor.status || executor.text}`,
    fix: executor.ok ? undefined : '重启后台',
    latencyMs: executor.latencyMs
  });

  const ollama = await probeJson('/kgm/api/tags', { timeoutMs: 2500 });
  items.push({
    id: 'ollama',
    label: '本地 Ollama',
    status: 'ok',
    detail: ollama.ok ? 'Ollama 可用' : '未检测到本机 Ollama',
    latencyMs: ollama.latencyMs
  });

  const enabledCloud = readCloudProvidersFromLocalStorage().filter((p) => p.enabled);
  const cloudWithKey = enabledCloud.filter((p) => p.apiKey?.trim());
  items.push({
    id: 'cloud',
    label: '云端模型 Key',
    status: enabledCloud.length === 0 || cloudWithKey.length > 0 ? 'ok' : 'warn',
    detail:
      enabledCloud.length === 0
        ? '未启用云端 provider'
        : cloudWithKey.length > 0
          ? `已启用 ${cloudWithKey.length}/${enabledCloud.length} 个带 key 的云端 provider`
          : '已启用云端 provider，但没有可用 apiKey',
    fix: enabledCloud.length > 0 && cloudWithKey.length === 0 ? '填写 apiKey 或关闭 provider' : undefined
  });

  const chatPreflight = await apiService.runChatPreflight('auto').catch(() => null);
  if (chatPreflight && !chatPreflight.ok) {
    const first = chatPreflight.issues.find((i) => i.severity === 'error') ?? chatPreflight.issues[0];
    items.push({
      id: 'kgm',
      label: 'KGM Chat Canary',
      status: first?.severity === 'error' ? 'error' : 'warn',
      detail: compact(first?.message || 'KGM chat 预检未通过'),
      fix: '恢复默认配置后重试；Debug 模式可查看 KGM trace'
    });
  }

  return {
    ok: !items.some((i) => i.status === 'error'),
    checkedAt: Date.now(),
    items
  };
}

export async function repairStartupDefaults(): Promise<StartupSelfCheckResult> {
  migrateMisconfiguredLocalServiceUrls();
  ensureDefaultKgmChatDefaultsInLocalStorage();
  ensureDefaultCloudProvidersInLocalStorage();
  localStorage.setItem('selectedProvider', 'kgm');
  localStorage.setItem('kgmScheduleStrategy', 'kgm-dynamic');
  localStorage.setItem('kgmBaseUrl', '/kgm');
  localStorage.setItem('skillExecutorUrl', '/api');
  try {
    sessionStorage.removeItem(KGM_CANARY_CACHE_KEY);
  } catch {
    /* ignore */
  }

  if (typeof window !== 'undefined' && window.yueliDesktop?.restartBackend) {
    await window.yueliDesktop.restartBackend().catch(() => false);
  }

  const kgmWait = await waitForKgmRouteReady({
    timeoutMs: typeof window !== 'undefined' && window.yueliDesktop ? 60_000 : 20_000
  });
  if (kgmWait.ok) {
    await syncCloudProvidersToKgm().catch(() => undefined);
  }

  return runStartupSelfCheck();
}
