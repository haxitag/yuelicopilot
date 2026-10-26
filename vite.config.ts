import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { buildViteProxyConfig } from './packages/gateway/src/proxyRoutes.mjs'
import { normalizeListenPort } from './packages/gateway/src/upstreamPorts.mjs'

const FRONTEND_PORT = normalizeListenPort(process.env.FRONTEND_PORT, 3002);
const SKILL_EXECUTOR_PORT = normalizeListenPort(process.env.SKILL_EXECUTOR_PORT, 3010);
const KGM_PORT = normalizeListenPort(process.env.KGM_PORT, 3080);

function healthCheckPlugin() {
  return {
    name: 'health-check',
    configureServer(server) {
      server.middlewares.use('/health', (_req, res) => {
        const health = {
          status: 'ok',
          service: 'yueli-frontend-dev',
          version: '1.0.0',
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
          checks: {
            frontend: true,
            node: true
          }
        };
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(health));
      });
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const isDesktopMode = mode === 'desktop' || env.VITE_DEPLOY_PROFILE === 'desktop';

  return {
    plugins: [react(), healthCheckPlugin()],
    optimizeDeps: {
      include: ['@haxitag/markdown-gfm-normalize', 'pdfjs-dist']
    },
    define: isDesktopMode
      ? {
          'import.meta.env.VITE_DEPLOY_PROFILE': JSON.stringify('desktop'),
        }
      : undefined,
    server: {
      port: FRONTEND_PORT,
      proxy: buildViteProxyConfig({ kgmPort: KGM_PORT, executorPort: SKILL_EXECUTOR_PORT }),
    },
  };
});
