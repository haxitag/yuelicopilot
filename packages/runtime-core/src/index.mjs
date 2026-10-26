export { resolveAppRoot, resolveDeployProfile, resolveDataHome, resolveRuntimePaths, ensureDataDirs, LEGACY_LOG_PATHS } from './paths.mjs';
export { loadEnvFile, loadProjectEnv } from './loadEnv.mjs';
export {
  resolvePorts,
  ensurePortAvailable,
  portListenPids,
  isPortFree,
  pickAlternatePortFromOccupied,
  isLikelyYueliProcess,
  loadKnownYueliPidsFromState,
} from './ports.mjs';
export { runInferenceDiscovery, pickLlmAndEmbedding, resolveKgmUpstreamEnv } from './inferenceDiscovery.mjs';
export { writeKgmConfigIfLlmPresent, logUpstreamSummary } from './kgmConfig.mjs';
export { writeEnvLocal } from './envLocal.mjs';
export { writeRuntimeState } from './state.mjs';
export { spawnKgm, spawnExecutor, spawnViteDev, spawnGatewayProcess, isProcessAlive, curlOk } from './spawn.mjs';
export { ensureDesktopDist } from './buildDesktop.mjs';
export { runE2eSelfTest } from './e2e.mjs';
export { registerChild, shutdownAll, installSignalHandlers } from './supervisor.mjs';
export {
  runDesktopDataMigration,
  planDesktopDataMigration,
  migrationMarkerPath,
} from './dataMigration.mjs';
export { ChildRestartWatch } from './childWatch.mjs';
