import fs from 'node:fs';

/**
 * @param {string} envLocalPath
 * @param {{ frontendPort: number; kgmPort: number; executorPort: number; profile?: string }} ports
 */
export function writeEnvLocal(envLocalPath, ports) {
  const { frontendPort, kgmPort, executorPort, profile = 'server' } = ports;
  const isDesktop = profile === 'desktop';

  const viteBlock = isDesktop
    ? `VITE_DEPLOY_PROFILE=desktop
VITE_FRONTEND_PORT=${frontendPort}
VITE_KGM_BASE_URL=/kgm
VITE_SKILL_EXECUTOR_URL=/api
VITE_PLAYGROUND_URL=/kgm
YUELI_GATEWAY_PORT=${frontendPort}
`
    : `VITE_FRONTEND_PORT=${frontendPort}
VITE_KGM_PORT=${kgmPort}
VITE_KGM_BASE_URL=http://127.0.0.1:${kgmPort}
VITE_SKILL_EXECUTOR_URL=http://127.0.0.1:${executorPort}
VITE_PLAYGROUND_URL=http://127.0.0.1:${kgmPort}
`;

  const content = `# YueliCopilot 运行时端口配置（由 runtime-core 自动生成；也可手工维护）
YUELI_DEPLOY_PROFILE=${profile}
FRONTEND_PORT=${frontendPort}
SKILL_EXECUTOR_PORT=${executorPort}
KGM_PORT=${kgmPort}

${viteBlock}`;
  fs.writeFileSync(envLocalPath, content);
  const hint = isDesktop
    ? `gateway :${frontendPort}（/kgm /api 同源）`
    : `KGM_PORT=${kgmPort} → Vite 代理与 VITE_* 一致`;
  console.log(`   ✅ 已保存 .env.local（${hint}）`);
}
