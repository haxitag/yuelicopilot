import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEFAULT_PORTS = { kgm: 3080, executor: 3010, gateway: 3020 };

/**
 * @param {unknown} value
 * @param {number} fallback
 */
export function normalizeListenPort(value, fallback) {
  const n = typeof value === 'number' ? value : parseInt(String(value ?? ''), 10);
  if (Number.isFinite(n) && n > 0 && n < 65536) return n;
  return fallback;
}

export function resolveDataHomeForGateway() {
  if (process.env.YUELI_DATA_HOME?.trim()) {
    return path.resolve(process.env.YUELI_DATA_HOME.trim());
  }
  const profile = (process.env.YUELI_DEPLOY_PROFILE || '').trim().toLowerCase();
  if (profile === 'desktop') {
    return path.join(process.env.HOME || os.homedir(), 'Library', 'Application Support', 'Yueli Copilot');
  }
  return path.join(os.tmpdir(), 'yueli-kgm-data');
}

/** @returns {{ kgmPort?: number; executorPort?: number; frontendPort?: number } | null} */
export function readPortsFromRuntimeState() {
  try {
    const statePath = path.join(resolveDataHomeForGateway(), 'runtime', 'state.json');
    if (!fs.existsSync(statePath)) return null;
    const data = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const p = data?.ports;
    if (!p || typeof p !== 'object') return null;
    return {
      kgmPort: p.kgmPort,
      executorPort: p.executorPort,
      frontendPort: p.frontendPort,
    };
  } catch {
    return null;
  }
}

/**
 * Gateway / Vite 代理上游端口：环境变量优先，桌面端可回退 runtime/state.json。
 * @param {NodeJS.ProcessEnv} [env]
 */
export function resolveGatewayUpstreamPorts(env = process.env) {
  const state = readPortsFromRuntimeState();
  return {
    kgmPort: normalizeListenPort(env.KGM_PORT ?? state?.kgmPort, DEFAULT_PORTS.kgm),
    executorPort: normalizeListenPort(
      env.SKILL_EXECUTOR_PORT ?? state?.executorPort,
      DEFAULT_PORTS.executor
    ),
    gatewayPort: normalizeListenPort(
      env.YUELI_GATEWAY_PORT ?? env.FRONTEND_PORT ?? state?.frontendPort,
      DEFAULT_PORTS.gateway
    ),
  };
}
