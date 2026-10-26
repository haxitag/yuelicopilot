# @yuelicopilot/gateway

desktop profile 单端口网关：`/kgm`、`/api`、`/proxy` 转发 + `dist/` 静态 SPA。

## 独立启动（需已运行 KGM / Executor）

```bash
KGM_PORT=3080 SKILL_EXECUTOR_PORT=3010 YUELI_GATEWAY_PORT=3020 npm run gateway:serve
```

## 与 Vite dev 共用路由表

`packages/gateway/src/proxyRoutes.mjs` → `buildViteProxyConfig()` 供 `vite.config.ts` 引用。

## 完整 desktop 栈

```bash
npm run build:desktop   # 首次或前端变更后
./start-desktop.sh      # 或 npm run start:desktop
```

打开 `http://127.0.0.1:3020`（端口以 `.env` / 终端输出为准）。
