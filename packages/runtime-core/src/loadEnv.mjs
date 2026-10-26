import fs from 'node:fs';
import path from 'node:path';

/**
 * Load KEY=VALUE lines from .env into process.env (no shell expansion).
 * @param {string} envFilePath
 */
export function loadEnvFile(envFilePath) {
  if (!fs.existsSync(envFilePath)) return false;
  const text = fs.readFileSync(envFilePath, 'utf8');
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key) process.env[key] = value;
  }
  return true;
}

/**
 * @param {string} appRoot
 */
export function loadProjectEnv(appRoot) {
  const envPath = path.join(appRoot, '.env');
  const envLocalPath = path.join(appRoot, '.env.local');
  let loaded = false;
  if (loadEnvFile(envPath)) {
    console.log('📄 加载 .env 端口配置...');
    loaded = true;
  }
  if (loadEnvFile(envLocalPath)) {
    console.log('📄 加载 .env.local 端口配置（覆盖 .env）...');
    loaded = true;
  }
  if (!loaded) {
    console.log('   ℹ️  未找到 .env / .env.local，使用环境变量或内置默认端口');
  }
}
