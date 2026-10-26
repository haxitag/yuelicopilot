import fs from 'node:fs';
import path from 'node:path';
import { startBackend, stopBackend, resolveGatewayBaseUrl } from './backendLauncher.mjs';
import { isGatewayHealthyOnPort, resolveLiveGatewayPort } from './gatewayResolve.mjs';
import { getBundledAppRoot, getApplicationSupportDir } from './appPaths.mjs';

/** @type {ReturnType<typeof setInterval> | null} */
let pollTimer = null;
let intentionalStop = false;
let restartCount = 0;
const MAX_RESTARTS = 10;
/** @type {((url: string) => void) | null} */
let onRelaunch = null;
let lastUseElectronNode = false;
let lastAppRoot = '';

function crashLogPath() {
  return path.join(getApplicationSupportDir(), 'runtime', 'crash-restart.log');
}

function appendCrashLog(line) {
  try {
    const p = crashLogPath();
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.appendFileSync(p, `${new Date().toISOString()} ${line}\n`);
  } catch {
    /* ignore */
  }
}

/**
 * @param {{ useElectronNode: boolean; onGatewayRelaunch?: (url: string) => void }} opts
 */
export async function bootBackendWithWatchdog(opts) {
  intentionalStop = false;
  onRelaunch = opts.onGatewayRelaunch ?? null;
  const appRoot = getBundledAppRoot();
  lastUseElectronNode = opts.useElectronNode;
  lastAppRoot = appRoot;
  const url = await startBackendOnce(opts.useElectronNode, appRoot);
  startGatewayPoll(opts.useElectronNode, appRoot);
  return url;
}

export async function requestBackendRestart() {
  if (!lastAppRoot) {
    lastAppRoot = getBundledAppRoot();
  }
  restartCount = 0;
  await restartBackend(lastUseElectronNode, lastAppRoot);
  return true;
}

async function startBackendOnce(useElectronNode, appRoot) {
  startBackend({ useElectronNode, appRoot });
  const url = await resolveGatewayBaseUrl(appRoot);
  appendCrashLog(`backend ready ${url}`);
  return url;
}

function startGatewayPoll(useElectronNode, appRoot) {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    if (intentionalStop) return;
    void (async () => {
      const port = await resolveLiveGatewayPort(appRoot);
      if (!(await isGatewayHealthyOnPort(port))) {
        const err = new Error(`gateway not healthy on :${port}`);
        appendCrashLog(`health fail: ${err instanceof Error ? err.message : String(err)}`);
        await restartBackend(useElectronNode, appRoot);
      }
    })();
  }, 20000);
}

async function restartBackend(useElectronNode, appRoot) {
  if (intentionalStop) return;
  if (restartCount >= MAX_RESTARTS) {
    appendCrashLog('max restarts reached');
    return;
  }
  restartCount += 1;
  appendCrashLog(`restart attempt ${restartCount}`);
  stopBackend();
  await new Promise((r) => setTimeout(r, 2000));
  try {
    const url = await startBackendOnce(useElectronNode, appRoot);
    onRelaunch?.(url);
  } catch (err) {
    appendCrashLog(`restart failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function stopBackendWatchdog() {
  intentionalStop = true;
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  stopBackend();
}
