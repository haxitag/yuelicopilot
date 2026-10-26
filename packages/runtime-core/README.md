# @yuelicopilot/runtime-core

Yueli Copilot 共享进程编排层，供 **server**（`./start.sh`）与后续 **desktop**（Mac App）共用。

## 入口

```bash
# 与 ./start.sh 等价
YUELI_DEPLOY_PROFILE=server node packages/runtime-core/bin/yueli-up.mjs

# 或
npm start
```

## 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `YUELI_DEPLOY_PROFILE` | `server` | `server` \| `desktop` |
| `YUELI_APP_ROOT` | 仓库根目录 | 应用根路径 |
| `YUELI_DATA_HOME` | server: `/tmp/yueli-kgm-data` | 数据与状态目录 |
| `YUELI_FRONTEND_MODE` | server→`dev`，desktop→`gateway` | `dev` \| `gateway` \| `skip` |
| `YUELI_E2E_TEST` | `0` | `1` 时跑 health + chat 自检 |

## desktop

```bash
npm run build:desktop
./start-desktop.sh   # 或 npm run start:desktop
```

Gateway 监听 `FRONTEND_PORT`（默认 3020），浏览器只访问一个 origin；KGM/Executor 经 `/kgm`、`/api` 转发。

## 模块

- `paths.mjs` — 路径与 profile
- `ports.mjs` — 端口占用检测与释放
- `inferenceDiscovery.mjs` — 本地推理引擎扫描
- `kgmConfig.mjs` — 本地化 `kgm.config.json`
- `spawn.mjs` — 启动 KGM / Executor / Vite
- `supervisor.mjs` — 信号与进程清理

## 测试

```bash
npm run start:runtime-test
```

规划全文：[docs/Mac-App与服务器双模式部署规划.md](../../docs/Mac-App与服务器双模式部署规划.md)
