import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from 'electron';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** 仓库根目录（开发）或 .app/Contents/Resources/app（打包） */
export function getBundledAppRoot() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'app');
  }
  return path.resolve(__dirname, '../../..');
}

export function getYueliUpEntry(appRoot) {
  return path.join(appRoot, 'packages/runtime-core/bin/yueli-up.mjs');
}

export function getDefaultGatewayPort() {
  const raw = process.env.YUELI_GATEWAY_PORT || process.env.FRONTEND_PORT || '3020';
  const n = parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 && n < 65536 ? n : 3020;
}

export function getApplicationSupportDir() {
  return path.join(app.getPath('userData'));
}

export function getRuntimeStatePath() {
  return path.join(getApplicationSupportDir(), 'runtime', 'state.json');
}
