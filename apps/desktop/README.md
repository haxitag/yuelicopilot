# Yueli Copilot — macOS Desktop (Electron)

Electron 壳 + Gateway；后端由 `packages/runtime-core`（desktop profile）拉起。

## 快速命令

| 命令 | 说明 |
|------|------|
| `npm run electron:dev`（仓库根） | 开发窗口 |
| `npm run electron:dist` | 打 DMG |
| `./scripts/release-build.sh` | 测试 + staging + 签名/公证 DMG |

## 公证凭据（deck 同款）

```bash
cp .notarize.env.example .notarize.env
```

构建配置：`electron-builder.yml`（`afterSign: scripts/notarize.cjs`）。

## CI Secrets

见 [docs/RELEASE-CHECKLIST.md](../../docs/RELEASE-CHECKLIST.md)。
