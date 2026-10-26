import { spawn } from 'node:child_process';
import { getYueliUpEntry } from './appPaths.mjs';
import {
  markBackendSpawned,
  resolveExpectedGatewayPort,
  waitForHealthyGateway,
  loadDesktopProjectEnv,
} from './gatewayResolve.mjs';
import fs from 'node:fs';

/** @type {import('node:child_process').ChildProcess | null} */
let backendProcess = null;

/**
 * @param {{ useElectronNode: boolean; appRoot: string }} opts
 */
export function startBackend(opts) {
  const appRoot = opts.appRoot;
  const yueliUp = getYueliUpEntry(appRoot);
  if (!fs.existsSync(yueliUp)) {
    throw new Error(`未找到 runtime 入口: ${yueliUp}`);
  }

  loadDesktopProjectEnv(appRoot);
  const gatewayPort = resolveExpectedGatewayPort(appRoot);
  markBackendSpawned();

  const exec = opts.useElectronNode ? process.execPath : process.env.YUELI_NODE_PATH || 'node';
  const env = {
    ...process.env,
    YUELI_APP_ROOT: appRoot,
    YUELI_DEPLOY_PROFILE: 'desktop',
    YUELI_FRONTEND_MODE: 'gateway',
    FRONTEND_PORT: String(gatewayPort),
    YUELI_GATEWAY_PORT: String(gatewayPort),
  };

  if (opts.useElectronNode) {
    env.ELECTRON_RUN_AS_NODE = '1';
    env.YUELI_USE_ELECTRON_NODE = '1';
  }

  const detached = process.platform !== 'win32';

  backendProcess = spawn(exec, [yueliUp], {
    cwd: appRoot,
    env,
    detached,
    stdio: 'ignore',
  });

  if (detached) {
    backendProcess.unref();
  }

  backendProcess.on('error', (err) => {
    console.error('backend spawn error', err);
  });

  return backendProcess;
}

export function stopBackend() {
  if (!backendProcess?.pid) return;

  const pid = backendProcess.pid;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore' });
    } else {
      process.kill(-pid, 'SIGTERM');
    }
  } catch {
    try {
      backendProcess.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
  backendProcess = null;
}

/**
 * @param {string} appRoot
 */
export async function resolveGatewayBaseUrl(appRoot) {
  loadDesktopProjectEnv(appRoot);
  return waitForHealthyGateway(appRoot);
}
