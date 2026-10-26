import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/** Electron 打包时用嵌入式 Node（ELECTRON_RUN_AS_NODE）跑 KGM / Executor / Gateway */
export function usesElectronNodeRuntime() {
  return (
    process.env.YUELI_USE_ELECTRON_NODE === '1' ||
    process.env.ELECTRON_RUN_AS_NODE === '1' ||
    Boolean(process.versions?.electron)
  );
}

export function runtimeNodeBinary() {
  return process.execPath;
}

/** @param {NodeJS.ProcessEnv} [extra] */
export function runtimeNodeEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  if (usesElectronNodeRuntime()) {
    env.ELECTRON_RUN_AS_NODE = '1';
    env.YUELI_USE_ELECTRON_NODE = '1';
  }
  return env;
}

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {{ cwd?: string; env?: NodeJS.ProcessEnv; logPath?: string }} opts
 */
export function spawnDetached(cmd, args, opts = {}) {
  const logFd = opts.logPath
    ? fs.openSync(opts.logPath, 'a')
    : 'ignore';

  const child = spawn(cmd, args, {
    cwd: opts.cwd,
    env: runtimeNodeEnv(opts.env),
    detached: false,
    stdio: logFd === 'ignore' ? 'ignore' : ['ignore', logFd, logFd],
  });

  return child;
}

/**
 * @param {number} pid
 */
export function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} url
 * @param {number} timeoutMs
 */
export async function curlOk(url, timeoutMs = 5000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

/**
 * @param {string} appRoot
 */
export function ensureKgmPackage(appRoot) {
  const pkgDir = path.join(appRoot, 'node_modules/@haxitag/yueli-kgm-computing');
  if (fs.existsSync(pkgDir)) return;
  console.log('   安装 @haxitag/yueli-kgm-computing...');
  execFileSync('npm', ['install', '@haxitag/yueli-kgm-computing', '--silent'], {
    cwd: appRoot,
    stdio: 'inherit',
  });
}

/**
 * @param {string} serverDir
 */
export function ensureExecutorDeps(serverDir) {
  if (fs.existsSync(path.join(serverDir, 'node_modules'))) return;
  console.log('   安装依赖 (express, cors)...');
  execFileSync('npm', ['install', '--silent'], { cwd: serverDir, stdio: 'inherit' });
}

/**
 * @param {object} params
 */
export function spawnKgm(params) {
  const {
    appRoot,
    kgmEntry,
    kgmPort,
    paths,
    upstream,
    discoveryPath,
    logPath,
  } = params;

  ensureKgmPackage(appRoot);

  const env = {
    PORT: String(kgmPort),
    KGM_CONFIG_PATH: paths.kgmConfigPath,
    KGM_MODEL_STATE_PATH: paths.kgmModelsStore,
    KGM_DB_PATH: paths.kgmDbPath,
    KGM_ROUTING_HISTORY_PATH: paths.routingHistory,
    KGM_AUTO_ROUTING_AUDIT_PATH: paths.autoRoutingAudit,
    YUELI_INFERENCE_DISCOVERY: discoveryPath,
    ...upstream,
  };

  const child = spawnDetached(runtimeNodeBinary(), [kgmEntry], {
    cwd: appRoot,
    env,
    logPath: logPath || paths.kgmLog,
  });

  return child;
}

/**
 * @param {object} params
 */
export function spawnExecutor(params) {
  const { serverDir, executorEntry, executorPort, logPath, paths } = params;
  ensureExecutorDeps(serverDir);

  /** @type {Record<string, string>} */
  const env = { SKILL_EXECUTOR_PORT: String(executorPort) };
  if (paths?.dataHome) {
    env.YUELI_DATA_HOME = paths.dataHome;
    env.YUELI_DESKTOP_SKILLS_ROOT = path.join(paths.dataHome, 'skills');
  }

  const child = spawnDetached(runtimeNodeBinary(), [executorEntry], {
    cwd: serverDir,
    env,
    logPath: logPath || undefined,
  });

  return child;
}

/**
 * @param {object} params
 */
export function spawnViteDev(params) {
  const { appRoot, frontendPort, logPath } = params;

  const child = spawnDetached(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['run', 'dev', '--', '--port', String(frontendPort)],
    { cwd: appRoot, logPath }
  );

  return child;
}

/**
 * @param {object} params
 */
export function spawnGatewayProcess(params) {
  const { appRoot, gatewayPort, kgmPort, executorPort, distDir, logPath } = params;
  const entry = path.join(appRoot, 'packages/gateway/bin/serve.mjs');

  return spawnDetached(runtimeNodeBinary(), [entry], {
    cwd: appRoot,
    env: {
      YUELI_APP_ROOT: appRoot,
      YUELI_GATEWAY_PORT: String(gatewayPort),
      FRONTEND_PORT: String(gatewayPort),
      KGM_PORT: String(kgmPort),
      SKILL_EXECUTOR_PORT: String(executorPort),
      YUELI_DIST_DIR: distDir,
      YUELI_DEPLOY_PROFILE: process.env.YUELI_DEPLOY_PROFILE || 'desktop',
    },
    logPath,
  });
}
