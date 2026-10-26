import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

/**
 * @param {string} appRoot
 * @param {string} distDir
 */
export function ensureDesktopDist(appRoot, distDir) {
  const indexHtml = path.join(distDir, 'index.html');
  if (fs.existsSync(indexHtml)) return false;

  console.log('   📦 未找到 dist/，正在执行 npm run build:desktop ...');
  execFileSync('npm', ['run', 'build:desktop'], {
    cwd: appRoot,
    stdio: 'inherit',
    env: { ...process.env, YUELI_DEPLOY_PROFILE: 'desktop' },
  });

  if (!fs.existsSync(indexHtml)) {
    throw new Error('build:desktop 完成但缺少 dist/index.html');
  }
  return true;
}
