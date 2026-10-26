import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { resolveDeployProfile } from './paths.mjs';

/** 桌面端：首选端口被「非 Yueli」占用时，向上扫描的跨度 */
const DESKTOP_PORT_SCAN_SPAN = 48;

/** 桌面端：高位回退起点（仍在本机 loopback，降低与常见 dev 端口撞车概率） */
const DESKTOP_FALLBACK_PORTS = {
  KGM: 41080,
  'Skill Executor': 41010,
  Frontend: 41020,
};

const YUELI_PROCESS_MARKERS = [
  'yueli-up',
  'yueli-kgm-computing',
  'enhancedstart.js',
  'packages/gateway',
  'packages/runtime-core',
  'yueli-copilot',
  'skill-executor',
  'server/index.js',
];

/**
 * @param {number} port
 * @returns {number[]}
 */
export function portListenPids(port) {
  try {
    const out = execFileSync('lsof', ['-nP', `-ti`, `tcp:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const pids = out
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((p) => parseInt(p, 10))
      .filter((n) => Number.isFinite(n));
    return [...new Set(pids)];
  } catch {
    return [];
  }
}

/**
 * @param {number} port
 */
export function isPortFree(port) {
  return portListenPids(port).length === 0;
}

/**
 * 纯逻辑：在已知占用集合上选下一个可用端口（便于单测）
 * @param {{ preferred: number; occupied: Set<number> | number[]; fallbackBase?: number; scanSpan?: number }}
 * @returns {{ port: number; shifted: boolean; reason?: 'preferred' | 'scan' | 'fallback' } | null}
 */
export function pickAlternatePortFromOccupied({
  preferred,
  occupied,
  fallbackBase,
  scanSpan = DESKTOP_PORT_SCAN_SPAN,
}) {
  const busy = occupied instanceof Set ? occupied : new Set(occupied);
  if (!busy.has(preferred)) {
    return { port: preferred, shifted: false, reason: 'preferred' };
  }
  for (let p = preferred + 1; p <= preferred + scanSpan; p++) {
    if (!busy.has(p)) {
      return { port: p, shifted: true, reason: 'scan' };
    }
  }
  if (typeof fallbackBase === 'number') {
    for (let p = fallbackBase; p <= fallbackBase + scanSpan; p++) {
      if (!busy.has(p)) {
        return { port: p, shifted: true, reason: 'fallback' };
      }
    }
  }
  return null;
}

/**
 * @param {number} pid
 */
function getProcessCommand(pid) {
  try {
    return execFileSync('ps', ['-p', String(pid), '-o', 'command='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

/**
 * @param {number} pid
 * @param {string} [appRoot]
 * @param {Set<number>} [knownPids]
 */
export function isLikelyYueliProcess(pid, appRoot, knownPids) {
  if (knownPids?.has(pid)) return true;
  const cmd = getProcessCommand(pid);
  if (!cmd) return false;
  const lower = cmd.toLowerCase();
  for (const marker of YUELI_PROCESS_MARKERS) {
    if (lower.includes(marker)) return true;
  }
  if (appRoot && cmd.includes(appRoot)) return true;
  return false;
}

/**
 * @param {string} [stateFile]
 * @returns {Set<number>}
 */
export function loadKnownYueliPidsFromState(stateFile) {
  const set = new Set();
  if (!stateFile || !fs.existsSync(stateFile)) return set;
  try {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    for (const pid of Object.values(state.pids || {})) {
      if (typeof pid === 'number' && pid > 0) set.add(pid);
    }
  } catch {
    /* ignore */
  }
  return set;
}

/**
 * @param {number} pid
 * @param {number} maxMs
 */
export async function waitForExit(pid, maxMs) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

/**
 * @param {number[]} pids
 * @param {string} why
 */
export async function killPids(pids, why) {
  for (const pid of pids) {
    try {
      process.kill(pid, 0);
    } catch {
      continue;
    }
    console.error(`   🛑 停止 PID ${pid} (${why}) ...`);
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* ignore */
    }
    if (!(await waitForExit(pid, 4000))) {
      console.error(`   ⚠️  PID ${pid} 未退出，强制结束...`);
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* ignore */
      }
      await waitForExit(pid, 2000);
    }
    console.error(`   ✅ 已释放 PID ${pid}`);
  }
}

/**
 * 服务器模式：占用则尝试结束监听进程（与历史 start.sh 行为一致）
 * @param {string} portName
 * @param {number} port
 * @returns {Promise<number>}
 */
export async function ensurePortAvailable(portName, port) {
  let pids = portListenPids(port);
  if (pids.length > 0) {
    console.error(`   ⚠️  端口 :${port} (${portName}) 被占用，将自动重启并释放端口`);
    await killPids(pids, `port=${portName}:${port}`);
    pids = portListenPids(port);
    if (pids.length > 0) {
      console.error(`   ❌ 端口 :${port} (${portName}) 仍被占用，无法启动新进程`);
      console.error(`   → 仍在监听的 PID: ${pids.join(' ')}`);
      console.error('   → 请手动确认该进程是否为旧的 yueli 进程并结束后重试');
      process.exit(1);
    }
  }
  return port;
}

/**
 * 收集一段范围内的已占用端口（用于桌面端避让扫描）
 * @param {number} from
 * @param {number} to
 */
function collectOccupiedPortsInRange(from, to) {
  const busy = new Set();
  for (let p = from; p <= to; p++) {
    if (!isPortFree(p)) busy.add(p);
  }
  return busy;
}

/**
 * 桌面模式：不结束「非 Yueli」进程；优先复用首选端口（仅清理本应用旧进程），否则自动换端口
 * @param {string} portName
 * @param {number} preferred
 * @param {{ stateFile?: string; appRoot?: string }} ctx
 */
async function resolveDesktopPort(portName, preferred, ctx = {}) {
  const knownPids = loadKnownYueliPidsFromState(ctx.stateFile);
  const fallbackBase = DESKTOP_FALLBACK_PORTS[portName];

  const occupants = portListenPids(preferred);
  if (occupants.length === 0) {
    return preferred;
  }

  const foreign = occupants.filter(
    (pid) => !isLikelyYueliProcess(pid, ctx.appRoot, knownPids)
  );
  const ours = occupants.filter((pid) => !foreign.includes(pid));

  if (foreign.length > 0) {
    console.error(
      `   ⚠️  桌面端: :${preferred} (${portName}) 被其他应用占用 (PID ${foreign.join(', ')})，将自动改用空闲端口（不结束外来进程）`
    );
  } else if (ours.length > 0) {
    console.error(
      `   ℹ️  桌面端: :${preferred} (${portName}) 由本应用旧进程占用，正在释放…`
    );
    await killPids(ours, `desktop-reclaim-${portName}:${preferred}`);
    if (isPortFree(preferred)) {
      return preferred;
    }
  }

  const scanHigh = Math.max(
    preferred + DESKTOP_PORT_SCAN_SPAN,
    (fallbackBase ?? preferred) + DESKTOP_PORT_SCAN_SPAN
  );
  const busy = collectOccupiedPortsInRange(preferred, scanHigh);
  const picked = pickAlternatePortFromOccupied({
    preferred,
    occupied: busy,
    fallbackBase,
    scanSpan: DESKTOP_PORT_SCAN_SPAN,
  });

  if (!picked) {
    console.error(`   ❌ 桌面端: 无法为 ${portName} 找到可用端口（已扫描 :${preferred}–:${scanHigh}）`);
    console.error('   → 可设置环境变量 KGM_PORT / FRONTEND_PORT / SKILL_EXECUTOR_PORT 指定一组空闲端口');
    process.exit(1);
  }

  if (picked.shifted) {
    const via =
      picked.reason === 'fallback'
        ? `高位回退 :${picked.port}`
        : `邻近扫描 :${picked.port}`;
    console.error(`   ✅ 桌面端 ${portName} 使用 ${via}（首选 :${preferred} 不可用）`);
  }
  return picked.port;
}

/**
 * @param {{ kgm?: number; executor?: number; frontend?: number }} defaults
 * @param {{ profile?: 'server' | 'desktop'; stateFile?: string; appRoot?: string }} [opts]
 */
export async function resolvePorts(defaults = {}, opts = {}) {
  const profile = opts.profile ?? resolveDeployProfile();
  const kgm = parseInt(process.env.KGM_PORT || String(defaults.kgm ?? 3080), 10);
  const executor = parseInt(
    process.env.SKILL_EXECUTOR_PORT || String(defaults.executor ?? 3010),
    10
  );
  const frontend = parseInt(
    process.env.FRONTEND_PORT || process.env.YUELI_GATEWAY_PORT || String(defaults.frontend ?? 3020),
    10
  );

  console.log('🔍 检查端口状态...');
  const isDesktop = profile === 'desktop';
  if (isDesktop) {
    console.log('   📦 桌面 profile：外来进程占用时将自动换端口，不强制结束非 Yueli 进程');
  }

  const ctx = { stateFile: opts.stateFile, appRoot: opts.appRoot };
  const kgmPort = isDesktop
    ? await resolveDesktopPort('KGM', kgm, ctx)
    : await ensurePortAvailable('KGM', kgm);
  const executorPort = isDesktop
    ? await resolveDesktopPort('Skill Executor', executor, ctx)
    : await ensurePortAvailable('Skill Executor', executor);
  const frontendPort = isDesktop
    ? await resolveDesktopPort('Frontend', frontend, ctx)
    : await ensurePortAvailable('Frontend', frontend);

  console.log('');
  console.log('📍 端口分配:');
  console.log(`   KGM + Playground: → :${kgmPort}`);
  console.log(`   Skill Executor:   → :${executorPort}`);
  console.log(`   Frontend/Gateway: → :${frontendPort}`);
  console.log('');

  return { kgmPort, executorPort, frontendPort };
}
