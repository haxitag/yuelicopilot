#!/usr/bin/env node
/**
 * Yueli Copilot 共享启动器（server / desktop profile）
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveRuntimePaths,
  ensureDataDirs,
  LEGACY_LOG_PATHS,
  loadProjectEnv,
  resolvePorts,
  runInferenceDiscovery,
  pickLlmAndEmbedding,
  resolveKgmUpstreamEnv,
  writeKgmConfigIfLlmPresent,
  logUpstreamSummary,
  writeEnvLocal,
  writeRuntimeState,
  spawnKgm,
  spawnExecutor,
  spawnViteDev,
  spawnGatewayProcess,
  ensureDesktopDist,
  isProcessAlive,
  curlOk,
  registerChild,
  installSignalHandlers,
  runE2eSelfTest,
  runDesktopDataMigration,
} from '../src/index.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultAppRoot = path.resolve(__dirname, '../../..');

if (!process.env.YUELI_APP_ROOT) {
  process.env.YUELI_APP_ROOT = defaultAppRoot;
}
if (!process.env.YUELI_DEPLOY_PROFILE) {
  process.env.YUELI_DEPLOY_PROFILE = 'server';
}

const paths = resolveRuntimePaths();
const profile = paths.profile;

/** @type {'dev' | 'gateway' | 'static' | 'skip'} */
let frontendMode = (process.env.YUELI_FRONTEND_MODE || '').trim().toLowerCase();
if (!frontendMode) {
  frontendMode = profile === 'desktop' ? 'gateway' : 'dev';
}
if (frontendMode === 'static') {
  frontendMode = 'gateway';
}

console.log('======================================');
console.log('🚀 Yueli Copilot - 完整服务启动');
console.log(`   profile: ${profile}`);
console.log(`   frontend: ${frontendMode}`);
console.log('======================================');

loadProjectEnv(paths.appRoot);
ensureDataDirs(paths);

if (profile === 'desktop' && process.env.YUELI_AUTO_MIGRATE !== '0') {
  const mig = runDesktopDataMigration({ dataHome: paths.dataHome });
  if (mig.status === 'completed') {
    console.log('📦 已迁移遗留数据到 Application Support:', JSON.stringify(mig.stats));
  } else if (mig.status === 'dry_run') {
    /* noop */
  } else if (mig.status === 'noop') {
    console.log('   ℹ️  无遗留数据需迁移');
  }
}

const logs =
  profile === 'server'
    ? {
        kgm: LEGACY_LOG_PATHS.kgm,
        executor: LEGACY_LOG_PATHS.executor,
        frontend: LEGACY_LOG_PATHS.frontend,
        gateway: LEGACY_LOG_PATHS.frontend,
      }
    : {
        kgm: paths.kgmLog,
        executor: paths.executorLog,
        frontend: paths.frontendLog,
        gateway: path.join(paths.runtimeDir, 'gateway.log'),
      };

const ports = await resolvePorts({}, {
  profile: paths.profile,
  stateFile: paths.stateFile,
  appRoot: paths.appRoot,
});
const distDir = path.join(paths.appRoot, 'dist');

// ── KGM ───────────────────────────────────
console.log('======================================');
console.log(`🧠 启动 KGM Computing + Playground (:${ports.kgmPort})...`);
console.log('======================================');

const discoveryPorts = process.env.INFERENCE_DISCOVERY_PORTS;
const probeDir = path.dirname(paths.discoveryResult);
const discovery = await runInferenceDiscovery(
  discoveryPorts,
  probeDir,
  paths.discoveryResult
);
const auto = pickLlmAndEmbedding(discovery);
const upstream = resolveKgmUpstreamEnv(process.env, auto);

for (const [k, v] of Object.entries(upstream)) {
  if (v) process.env[k] = v;
}
process.env.YUELI_INFERENCE_DISCOVERY = paths.discoveryResult;

logUpstreamSummary(upstream);
writeKgmConfigIfLlmPresent(upstream, paths.kgmConfigPath, paths.kgmDbPath);

const kgmChild = spawnKgm({
  appRoot: paths.appRoot,
  kgmEntry: paths.kgmEntry,
  kgmPort: ports.kgmPort,
  paths,
  upstream,
  discoveryPath: paths.discoveryResult,
  logPath: logs.kgm,
});
registerChild(kgmChild);

await new Promise((r) => setTimeout(r, 4000));
let kgmReady = false;
if (isProcessAlive(kgmChild.pid)) {
  for (let i = 0; i < 40; i += 1) {
    if (await curlOk(`http://127.0.0.1:${ports.kgmPort}/v1/models`, 4000)) {
      kgmReady = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
if (kgmReady) {
  console.log(`   ✅ KGM Computing + Playground 已启动 (PID ${kgmChild.pid})`);
} else if (isProcessAlive(kgmChild.pid)) {
  console.log(
    `   ⚠️  KGM 进程在运行但 /v1/models 未就绪 (PID ${kgmChild.pid})，查看日志: ${logs.kgm}`
  );
} else {
  console.log(`   ❌ KGM Computing 启动失败，查看日志: ${logs.kgm}`);
}

// ── Skill Executor ────────────────────────
console.log('======================================');
console.log(`⚙️  启动 Skill Executor (:${ports.executorPort})...`);
console.log('======================================');

const executorChild = spawnExecutor({
  serverDir: paths.serverDir,
  executorEntry: paths.executorEntry,
  executorPort: ports.executorPort,
  logPath: logs.executor,
  paths,
});
registerChild(executorChild);

await new Promise((r) => setTimeout(r, 2000));
if (isProcessAlive(executorChild.pid)) {
  const health = await curlOk(`http://127.0.0.1:${ports.executorPort}/health`);
  console.log(
    health
      ? `   ✅ Skill Executor 已启动 (PID ${executorChild.pid})`
      : `   ✅ Skill Executor 进程运行中 (PID ${executorChild.pid})`
  );
} else {
  console.log(`   ❌ Skill Executor 启动失败，查看日志: ${logs.executor}`);
}

console.log('📝 写入端口配置到 .env.local...');
writeEnvLocal(paths.envLocalPath, {
  frontendPort: ports.frontendPort,
  kgmPort: ports.kgmPort,
  executorPort: ports.executorPort,
  profile,
});

writeRuntimeState(paths.stateFile, {
  profile,
  frontendMode,
  ports,
  pids: {
    kgm: kgmChild.pid,
    executor: executorChild.pid,
  },
  urls:
    profile === 'desktop'
      ? {
          gateway: `http://127.0.0.1:${ports.frontendPort}`,
          kgmInternal: `http://127.0.0.1:${ports.kgmPort}`,
          executorInternal: `http://127.0.0.1:${ports.executorPort}`,
        }
      : {
          frontend: `http://localhost:${ports.frontendPort}`,
          kgm: `http://localhost:${ports.kgmPort}`,
          executor: `http://localhost:${ports.executorPort}`,
        },
  logs,
});

// ── Frontend / Gateway ────────────────────
/** @type {import('node:child_process').ChildProcess | null} */
let frontendChild = null;

if (frontendMode === 'skip') {
  console.log('   ℹ️  YUELI_FRONTEND_MODE=skip，跳过前端启动');
} else if (frontendMode === 'gateway') {
  console.log('======================================');
  console.log(`🌐 启动 Gateway + 静态前端 (:${ports.frontendPort})...`);
  console.log('======================================');

  ensureDesktopDist(paths.appRoot, distDir);

  frontendChild = spawnGatewayProcess({
    appRoot: paths.appRoot,
    gatewayPort: ports.frontendPort,
    kgmPort: ports.kgmPort,
    executorPort: ports.executorPort,
    distDir,
    logPath: logs.gateway,
  });
  registerChild(frontendChild);

  await new Promise((r) => setTimeout(r, 2000));

  if (!isProcessAlive(frontendChild.pid)) {
    console.log(`   ❌ Gateway 启动失败，查看日志: ${logs.gateway}`);
    process.exit(1);
  }

  const gwHealth = await curlOk(`http://127.0.0.1:${ports.frontendPort}/health`);
  console.log(
    gwHealth
      ? `   ✅ Gateway 已启动 (PID ${frontendChild.pid})`
      : `   ⚠️  Gateway 进程在运行但 /health 未就绪 (PID ${frontendChild.pid})`
  );
} else {
  console.log('======================================');
  console.log(`🎨 启动前端 Vite dev (:${ports.frontendPort})...`);
  console.log('======================================');

  frontendChild = spawnViteDev({
    appRoot: paths.appRoot,
    frontendPort: ports.frontendPort,
    logPath: logs.frontend,
  });
  registerChild(frontendChild);

  await new Promise((r) => setTimeout(r, 3000));

  if (!isProcessAlive(frontendChild.pid)) {
    console.log(`   ❌ 前端启动失败，查看日志: ${logs.frontend}`);
    process.exit(1);
  }
  console.log(`   ✅ 前端已启动 (PID ${frontendChild.pid})`);
}

installSignalHandlers();

console.log('');
console.log('======================================');
console.log('✅ 端到端系统集成启动完成');
console.log('======================================');
console.log('');

if (profile === 'desktop' && frontendMode === 'gateway') {
  console.log(`  工作台（Gateway）  →  http://127.0.0.1:${ports.frontendPort}`);
  console.log(`  （内部 KGM :${ports.kgmPort} / Executor :${ports.executorPort}，经 /kgm /api 转发）`);
} else {
  console.log(`  前端界面       →  http://localhost:${ports.frontendPort}`);
  console.log(`  KGM + Playground →  http://localhost:${ports.kgmPort}`);
  console.log(`  Skill Executor →  http://localhost:${ports.executorPort}`);
}

console.log('');
console.log('  日志文件:');
if (frontendMode === 'gateway') {
  console.log(`    Gateway:  ${logs.gateway}`);
} else if (frontendMode === 'dev') {
  console.log(`    前端:     ${logs.frontend}`);
}
console.log(`    执行器:   ${logs.executor}`);
console.log(`    KGM:      ${logs.kgm}`);
console.log('');
console.log('  按 Ctrl+C 停止所有服务');
console.log('======================================');

if (process.env.YUELI_E2E_TEST === '1') {
  await runE2eSelfTest(ports);
}

if (frontendChild?.pid) {
  await new Promise((resolve) => {
    frontendChild.on('exit', resolve);
  });
} else {
  await new Promise(() => {});
}
