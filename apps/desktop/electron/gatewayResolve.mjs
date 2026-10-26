import fs from 'node:fs';
import path from 'node:path';
import { getRuntimeStatePath } from './appPaths.mjs';

/** 最近一次 spawn yueli-up 的时间戳，用于忽略旧的 state.json */
let lastBackendSpawnAt = 0;

/**
 * @param {string} appRoot
 */
export function loadDesktopProjectEnv(appRoot) {
  for (const name of ['.env', '.env.local']) {
    const p = path.join(appRoot, name);
    if (!fs.existsSync(p)) continue;
    const text = fs.readFileSync(p, 'utf8');
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (key) process.env[key] = value;
    }
  }
}

/**
 * @param {string} appRoot
 */
export function resolveExpectedGatewayPort(appRoot) {
  loadDesktopProjectEnv(appRoot);
  const raw = process.env.YUELI_GATEWAY_PORT || process.env.FRONTEND_PORT || '3020';
  const n = parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 && n < 65536 ? n : 3020;
}

export function markBackendSpawned() {
  lastBackendSpawnAt = Date.now();
}

/** @returns {Record<string, unknown> | null} */
function readRuntimeState() {
  try {
    const statePath = getRuntimeStatePath();
    if (!fs.existsSync(statePath)) return null;
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch {
    return null;
  }
}

function isStateFresh(state) {
  if (!state?.updatedAt || !lastBackendSpawnAt) return true;
  const ts = new Date(String(state.updatedAt)).getTime();
  return Number.isFinite(ts) && ts >= lastBackendSpawnAt - 3000;
}

/**
 * @param {number} port
 */
export async function isGatewayHealthyOnPort(port) {
  if (!Number.isFinite(port) || port <= 0 || port >= 65536) return false;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return false;
    const body = await res.json();
    return body?.service === 'yueli-gateway';
  } catch {
    return false;
  }
}

/**
 * @param {string} gatewayUrl
 */
function portFromGatewayUrl(gatewayUrl) {
  try {
    const u = new URL(gatewayUrl);
    const p = parseInt(u.port || '80', 10);
    return Number.isFinite(p) && p > 0 ? p : null;
  } catch {
    return null;
  }
}

/**
 * 按优先级收集候选 Gateway 端口（去重）
 * @param {string} appRoot
 */
export function collectGatewayPortCandidates(appRoot) {
  const expected = resolveExpectedGatewayPort(appRoot);
  const ports = [expected];
  const state = readRuntimeState();
  if (state && isStateFresh(state)) {
    const gw = typeof state.urls?.gateway === 'string' ? state.urls.gateway : '';
    const fromUrl = gw ? portFromGatewayUrl(gw) : null;
    if (fromUrl) ports.push(fromUrl);
    const fp = state.ports?.frontendPort;
    if (typeof fp === 'number') ports.push(fp);
  }
  return [...new Set(ports.filter((p) => Number.isFinite(p) && p > 0))];
}

/**
 * 等待 yueli-gateway 就绪；优先使用本次启动期望端口，避免连到已退出的旧 3002 实例。
 * @param {string} appRoot
 * @param {number} [timeoutMs]
 */
export async function waitForHealthyGateway(appRoot, timeoutMs = 120000) {
  const expected = resolveExpectedGatewayPort(appRoot);
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    if (await isGatewayHealthyOnPort(expected)) {
      return `http://127.0.0.1:${expected}`;
    }

    const state = readRuntimeState();
    if (state && isStateFresh(state)) {
      const gw =
        typeof state.urls?.gateway === 'string' ? state.urls.gateway.replace(/\/$/, '') : '';
      if (gw) {
        const p = portFromGatewayUrl(gw);
        if (p && (await isGatewayHealthyOnPort(p))) return gw;
      }
      const fp = state.ports?.frontendPort;
      if (typeof fp === 'number' && fp !== expected && (await isGatewayHealthyOnPort(fp))) {
        return `http://127.0.0.1:${fp}`;
      }
    }

    await new Promise((r) => setTimeout(r, 800));
  }

  const tried = collectGatewayPortCandidates(appRoot).join(', ');
  throw new Error(
    `Gateway 在 ${timeoutMs}ms 内未就绪（已尝试端口: ${tried}）。请执行 npm run start:desktop 查看日志，或检查 ~/Library/Application Support/Yueli Copilot/runtime/gateway.log`
  );
}

/**
 * 看门狗探活用：返回当前健康的 gateway 端口，否则为期望端口。
 * @param {string} appRoot
 */
export async function resolveLiveGatewayPort(appRoot) {
  for (const port of collectGatewayPortCandidates(appRoot)) {
    if (await isGatewayHealthyOnPort(port)) return port;
  }
  return resolveExpectedGatewayPort(appRoot);
}
