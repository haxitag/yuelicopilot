import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import http from 'node:http'

const FRONTEND_PORT = parseInt(process.env.FRONTEND_PORT || '3002');
const _skillExecutorPort = parseInt(process.env.SKILL_EXECUTOR_PORT || '3010', 10);
const SKILL_EXECUTOR_PORT =
  Number.isFinite(_skillExecutorPort) && _skillExecutorPort > 0 && _skillExecutorPort < 65536
    ? _skillExecutorPort
    : 3010;
const KGM_PORT = parseInt(process.env.KGM_PORT || '3080', 10);

function healthCheckPlugin() {
  return {
    name: 'health-check',
    configureServer(server) {
      server.middlewares.use('/health', (req, res) => {
        const health = {
          status: 'ok',
          service: 'yueli-frontend',
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

export default defineConfig({
  plugins: [react(), healthCheckPlugin()],
  server: {
    port: FRONTEND_PORT,
    proxy: {
      '/api': {
        target: `http://localhost:${SKILL_EXECUTOR_PORT}`,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      },
      '/proxy': {
        target: `http://localhost:${SKILL_EXECUTOR_PORT}`,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/proxy/, ''),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req, res) => {
            const url = req.url?.substring(7);
            if (url) {
              proxyReq.setHeader('X-Proxy-Target', url);
            }
          });
        }
      },
      '/kgm': {
        target: `http://127.0.0.1:${KGM_PORT}`,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/kgm/, '')
      }
    }
  }
})