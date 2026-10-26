#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startGatewayServer } from '../src/server.mjs';
import { resolveGatewayUpstreamPorts } from '../src/upstreamPorts.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = process.env.YUELI_APP_ROOT || path.resolve(__dirname, '../../..');

const { kgmPort, executorPort, gatewayPort } = resolveGatewayUpstreamPorts();
const port = gatewayPort;
const distDir = process.env.YUELI_DIST_DIR || path.join(appRoot, 'dist');
const host = process.env.YUELI_GATEWAY_HOST || '127.0.0.1';

const server = await startGatewayServer({ port, host, kgmPort, executorPort, distDir });
console.log(`yueli-gateway listening on http://${host}:${port}`);

const shutdown = () => {
  server.close(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
