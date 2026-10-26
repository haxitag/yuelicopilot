import { normalizeListenPort } from './upstreamPorts.mjs';

/**
 * 与 vite.config.ts dev proxy、desktop gateway 共用的路由表。
 * @param {{ kgmPort: number; executorPort: number; kgmHost?: string; executorHost?: string }} opts
 */
export function resolveUpstreamTargets(opts) {
  const kgmHost = opts.kgmHost ?? '127.0.0.1';
  const executorHost = opts.executorHost ?? '127.0.0.1';
  const kgmPort = normalizeListenPort(opts.kgmPort, 3080);
  const executorPort = normalizeListenPort(opts.executorPort, 3010);
  return {
    kgm: `http://${kgmHost}:${kgmPort}`,
    executor: `http://${executorHost}:${executorPort}`,
  };
}

/**
 * Vite `server.proxy` 配置
 * @param {{ kgmPort: number; executorPort: number }} opts
 */
export function buildViteProxyConfig(opts) {
  const { kgm, executor } = resolveUpstreamTargets(opts);
  return {
    '/api': {
      target: executor,
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/api/, ''),
    },
    '/proxy': {
      target: executor,
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/proxy/, ''),
      configure: (proxy) => {
        proxy.on('proxyReq', (proxyReq, req) => {
          const url = req.url?.substring(7);
          if (url) proxyReq.setHeader('X-Proxy-Target', url);
        });
      },
    },
    '/kgm': {
      target: kgm,
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/kgm/, ''),
    },
    '/yueliai': {
      target: 'https://yueli.com',
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/yueliai/, ''),
    },
  };
}

/**
 * Gateway 挂载的前缀 → 上游 origin + 路径改写
 * @param {{ kgmPort: number; executorPort: number }} opts
 */
export function buildGatewayRouteTable(opts) {
  const targets = resolveUpstreamTargets(opts);
  return [
    {
      mount: '/api',
      targetOrigin: targets.executor,
      stripPrefix: '/api',
      setProxyTargetHeader: false,
    },
    {
      mount: '/proxy',
      targetOrigin: targets.executor,
      stripPrefix: '/proxy',
      setProxyTargetHeader: true,
    },
    {
      mount: '/kgm',
      targetOrigin: targets.kgm,
      stripPrefix: '/kgm',
      setProxyTargetHeader: false,
    },
    {
      mount: '/yueliai',
      targetOrigin: 'https://yueli.com',
      stripPrefix: '/yueliai',
      setProxyTargetHeader: false,
    },
  ];
}
