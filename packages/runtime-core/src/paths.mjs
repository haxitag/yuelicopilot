import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @typedef {'server' | 'desktop'} DeployProfile */

/**
 * @param {string} [appRoot]
 * @returns {string}
 */
export function resolveAppRoot(appRoot) {
  if (appRoot?.trim()) return path.resolve(appRoot);
  if (process.env.YUELI_APP_ROOT?.trim()) return path.resolve(process.env.YUELI_APP_ROOT);
  // packages/runtime-core/src → repo root
  return path.resolve(__dirname, '../../..');
}

/**
 * @returns {DeployProfile}
 */
export function resolveDeployProfile() {
  const raw = (process.env.YUELI_DEPLOY_PROFILE || 'server').trim().toLowerCase();
  return raw === 'desktop' ? 'desktop' : 'server';
}

/**
 * @param {{ appRoot?: string; profile?: DeployProfile }} [opts]
 */
export function resolveDataHome(opts = {}) {
  if (process.env.YUELI_DATA_HOME?.trim()) {
    return path.resolve(process.env.YUELI_DATA_HOME);
  }
  const profile = opts.profile ?? resolveDeployProfile();
  if (profile === 'desktop') {
    const home = process.env.HOME || os.homedir();
    return path.join(home, 'Library', 'Application Support', 'Yueli Copilot');
  }
  return '/tmp/yueli-kgm-data';
}

/**
 * @param {{ appRoot?: string; dataHome?: string; profile?: DeployProfile }} [opts]
 */
export function resolveRuntimePaths(opts = {}) {
  const appRoot = resolveAppRoot(opts.appRoot);
  const profile = opts.profile ?? resolveDeployProfile();
  const dataHome = opts.dataHome ?? resolveDataHome({ profile });
  const runtimeDir = path.join(dataHome, 'runtime');

  return {
    appRoot,
    profile,
    dataHome,
    runtimeDir,
    stateFile: path.join(runtimeDir, 'state.json'),
    kgmDir: path.join(dataHome, 'kgm'),
    kgmDbPath: path.join(dataHome, 'kgm.db'),
    kgmModelsStore: path.join(dataHome, 'models', 'store'),
    kgmConfigPath:
      process.env.KGM_CONFIG_PATH?.trim() || path.join(dataHome, 'kgm.config.json'),
    kgmLog: path.join(runtimeDir, 'kgm.log'),
    executorLog: path.join(runtimeDir, 'executor.log'),
    frontendLog: path.join(runtimeDir, 'frontend.log'),
    discoveryResult:
      process.env.YUELI_INFERENCE_DISCOVERY?.trim() ||
      path.join(dataHome, 'yueli-inference-discovery.json'),
    probeGlobPrefix: path.join(dataHome, 'yueli-probe-'),
    envLocalPath: path.join(appRoot, '.env.local'),
    serverDir: path.join(appRoot, 'server'),
    kgmEntry: path.join(
      appRoot,
      'node_modules/@haxitag/yueli-kgm-computing/dist/server/enhancedStart.js'
    ),
    executorEntry: path.join(appRoot, 'server', 'index.js'),
    routingHistory: path.join(dataHome, 'routing.history.json'),
    autoRoutingAudit: path.join(dataHome, 'auto-routing-audit.json'),
  };
}

/**
 * @param {ReturnType<typeof resolveRuntimePaths>} paths
 */
export function ensureDataDirs(paths) {
  fs.mkdirSync(paths.kgmModelsStore, { recursive: true });
  fs.mkdirSync(paths.runtimeDir, { recursive: true });
  fs.mkdirSync(path.dirname(paths.kgmConfigPath), { recursive: true });
}

/**
 * Legacy /tmp paths used by start.sh before YUELI_DATA_HOME — kept for server default logs
 * when runtime dir is under /tmp/yueli-kgm-data.
 */
export const LEGACY_LOG_PATHS = {
  kgm: '/tmp/yueli-kgm.log',
  executor: '/tmp/yueli-executor.log',
  frontend: '/tmp/yueli-frontend.log',
};
