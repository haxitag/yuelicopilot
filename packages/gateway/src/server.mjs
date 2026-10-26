import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { buildGatewayRouteTable } from './proxyRoutes.mjs';
import { proxyHttpRequest } from './httpProxy.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * @param {{
 *   port: number;
 *   host?: string;
 *   kgmPort: number;
 *   executorPort: number;
 *   distDir: string;
 * }} opts
 */
export function createGatewayApp(opts) {
  const host = opts.host ?? '127.0.0.1';
  const app = express();
  const routes = buildGatewayRouteTable({
    kgmPort: opts.kgmPort,
    executorPort: opts.executorPort,
    kgmHost: host,
    executorHost: host,
  });

  app.disable('x-powered-by');

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'yueli-gateway',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      profile: process.env.YUELI_DEPLOY_PROFILE || 'desktop',
      upstream: {
        kgm: `http://${host}:${opts.kgmPort}`,
        executor: `http://${host}:${opts.executorPort}`,
      },
    });
  });

  for (const route of routes) {
    app.use(route.mount, (req, res) => proxyHttpRequest(req, res, route));
  }

  const distDir = path.resolve(opts.distDir);
  const indexHtml = path.join(distDir, 'index.html');

  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir, { index: false, fallthrough: true }));

    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      const p = req.path || '/';
      if (
        p.startsWith('/api') ||
        p.startsWith('/kgm') ||
        p.startsWith('/proxy') ||
        p === '/health'
      ) {
        return next();
      }
      if (!fs.existsSync(indexHtml)) {
        res.status(404).send('dist/index.html missing — run npm run build:desktop');
        return;
      }
      res.sendFile(indexHtml);
    });
  } else {
    app.use((req, res, next) => {
      if (req.method === 'GET' && req.path === '/') {
        res
          .status(503)
          .send('Frontend dist not built. Run: npm run build:desktop');
        return;
      }
      next();
    });
  }

  return app;
}

/**
 * @param {Parameters<typeof createGatewayApp>[0]} opts
 * @returns {Promise<import('http').Server>}
 */
export function startGatewayServer(opts) {
  const host = opts.host ?? '127.0.0.1';
  const app = createGatewayApp(opts);
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(opts.port, host, () => resolve(server));
    server.on('error', reject);
  });
}
