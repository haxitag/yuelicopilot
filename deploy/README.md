# Server 生产部署示例（Phase 3）

与 desktop 的 Electron Gateway 不同，**server 模式**可用 Nginx 托管 `dist/` 并反代 KGM / Skill Executor，对用户仍是一个入口（默认 `:3020`）。

## 方式 A：本机 Nginx

1. 构建前端（server 构建，非 desktop 模式）：

```bash
npm run build
```

2. 启动后端（不启 Vite）：

```bash
YUELI_DEPLOY_PROFILE=server YUELI_FRONTEND_MODE=skip ./start.sh
```

3. 安装配置：

```bash
sudo cp deploy/nginx/yuelicopilot-server.conf /etc/nginx/sites-available/yuelicopilot
# 编辑 root 指向本仓库 dist 绝对路径
sudo ln -sf /etc/nginx/sites-available/yuelicopilot /etc/nginx/sites-enabled/
sudo nginx -t && sudo nginx -s reload
```

4. 浏览器访问 `http://<host>:3020`。

前端需使用相对路径代理时，可设置环境变量后构建：

```bash
VITE_KGM_BASE_URL=/kgm VITE_SKILL_EXECUTOR_URL=/api npm run build
```

（与 desktop 相同路径前缀，便于 Nginx 统一反代。）

## 方式 B：Docker 仅 Nginx

```bash
npm run build
docker compose -f deploy/docker-compose.server.yml up -d
```

KGM / Executor 需在宿主机 `127.0.0.1:3080` / `:3010` 可访问；若端口不同，请改 `deploy/nginx/yuelicopilot-server.conf` 中 `upstream`。

## 与 desktop 对比

| 模式 | 入口 | 静态资源 |
|------|------|----------|
| desktop | Electron / Gateway | `dist/` + `/kgm` `/api` |
| server + nginx | Nginx :3020 | `dist/` + `/kgm` `/api` |
| server 开发 | `./start.sh` | Vite dev 代理 |

共用 `packages/runtime-core` 与 `packages/gateway/src/proxyRoutes.mjs` 路由约定。
