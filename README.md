## 如何启动运行

1. **Node.js 20+**，在本目录执行：`npm install`
2. **另开终端启动 KGM**（本仓库已依赖 npm 包，可直接用包内入口，端口示例 `3080`）：
   ```bash
   mkdir -p /tmp/yueli-kgm-data/models/store
   export PORT=3080
   node ./node_modules/@haxitag/yueli-kgm-computing/dist/server/enhancedStart.js
   ```
   上游 LLM / 嵌入等环境变量见 [KGM npm 说明](https://www.npmjs.com/package/@haxitag/yueli-kgm-computing)。
3. **再开终端启动前端**（端口需与 KGM 不同，示例 `3020`）：
   ```bash
   export FRONTEND_PORT=3020
   export VITE_KGM_BASE_URL=http://127.0.0.1:3080
   npm run dev
   ```
4. 浏览器打开终端里 Vite 提示的本地地址；若界面里 KGM 地址与 `VITE_KGM_BASE_URL` 不一致，在设置中改为 `http://127.0.0.1:3080`（或你的 KGM 实际地址）。

**说明**：对外快照不含 Skill Executor；若需执行器能力请使用主仓 `zhyr/yuelicopilot` 的 `start.sh` + `server/`。

# Yueli Copilot

## 项目简介

Yueli Copilot 是围绕 **Yueli-KGM-Computing（KGM：Knowledge Generation Modeling，知识生成建模）** 构建的 **本地 AI 工作台**：在统一界面中完成 **KGM 推理路由**、**技能 / MCP** 与 **输出模板**，面向需要 **可复现的端到端范式** 的开发者与小团队——尤其是做 **Agent 编排**、**桌面级工作台**、以及在意 **推理与执行之间安全边界** 的场景。

它不仅是「多模型 + 插件」的聊天壳，而是一套 **可审计、可部署** 的组合：把 **编排层 / 推理层 / 执行层** 写进架构，并落到具体模块（如 `CoreOrchestrator`、`ApiService`、`SkillExecutor`、`ResourceScheduler`、`SkillLifecycleStateManager`、`ErrorHandler` 等），便于对照实现与二次集成。

推理层 **KGM 已以 npm 包对外发布**：[`@haxitag/yueli-kgm-computing`](https://www.npmjs.com/package/@haxitag/yueli-kgm-computing)（MIT）。许多团队希望接入 KGM，但缺少一套 **可运行的应用侧参考**；本仓库即以 **Yueli Copilot 工作台** 的形式，作为 **KGM 的推荐集成用例 / 最佳实践样例**——从依赖声明、`start.sh` 拉起进程，到 UI 里配置 KGM 基址，完整展示 **多模型路由、技能 / MCP、与执行器分工** 下的真实体验。

### 定位与设计要点

| 维度 | 说明 |
|------|------|
| **工作台叙事** | 以 KGM 为中枢做多引擎路由，叠加技能生态、MCP 连接器与 Markdown/HTML 模板，支撑结构化主题与长会话，偏 **工程化工作台** 而非纯对话框。 |
| **分层信任边界** | **推理在 KGM**（意图、工具调用规划、RAG 等），**真实执行在独立 Skill Executor**（代码、文件、DB、MCP 代理等），强调 **不在推理进程内越权执行**；沙箱与宿主机能力由执行侧承接，边界可描述、可审计。 |
| **平台化能力** | **技能生命周期**（发现→安装→启用→执行→禁用/卸载）、**资源调度**（优先级、公平、资源感知、负载均衡、亲和性）、**熔断 / 降级与重试** 等模块齐备，便于私有化与容量规划。 |
| **开源价值** | 提供从 `start.sh` 到 E2E 的 **可复现链路**，适合要跑 **本地 / 私有化 Agent**、同时要求 **执行隔离** 的团队拿来做基线或 fork；亦可单独阅读本仓库学习如何把 **npm 上的 KGM** 嵌进自有产品。 |

### 重点内容

- **智能推理服务**：以 KGM 为主要推理与路由引擎，支持多后端（含 Ollama 等经 KGM 统一接入）
- **编排与执行分离**：`CoreOrchestrator` 整合技能、MCP 与模板；`SkillExecutor` 独立进程承载沙箱化执行
- **智能端口管理**：自动检测并选择可用端口，降低本地多服务联调成本
- **核心模块**：ApiService、SkillExecutor、MCPConnectorManager、TemplateEngine、CoreOrchestrator、SkillLifecycleStateManager、ResourceScheduler、ErrorHandler

## 项目特性

以下能力共同支撑「**KGM 路由 + 技能 / MCP + 模板**」工作台，并与上文的 **分层信任边界**、**平台化模块** 一一对应。

### 核心功能
- **多模型支持**：集成 Yueli-KGM-Computing 原生推理、VMLX、Ollama（通过KGM路由）等模型
- **智能路由**：KGM 自动识别并路由到最优推理引擎，包括 Ollama
- **技能执行引擎**：支持加载和执行各种AI技能
- **MCP连接器**：管理外部数据获取和API调用
- **输出模板系统**：支持Markdown和HTML模板渲染
- **项目主题管理**：支持创建和管理项目主题，实现结构化对话
- **历史会话管理**：保存和加载历史对话记录
- **技能生命周期管理**：统一管理技能的安装、启用、执行、禁用和卸载状态
- **资源调度系统**：支持多种调度策略（优先级、公平、资源感知、负载均衡、亲和性）
- **错误处理机制**：实现重试、熔断器和降级处理

### 界面预览

以下为工作台主要界面的截图（多图）。

#### 工作台与 API 配置（KGM / Ollama、技能侧栏）

![工作台与 API 配置](https://raw.githubusercontent.com/haxitag/yuelicopilot/main/workbench-api.png)

#### 项目主题与知识文件（新建主题、上传文档）

![项目主题与知识文件](https://raw.githubusercontent.com/haxitag/yuelicopilot/main/project-topic-km.png)

#### 主题会话与项目文件列表

![主题会话与文件](https://raw.githubusercontent.com/haxitag/yuelicopilot/main/topic-chat.png)

#### 会话进行中（技能协同、执行计划与上下文）

![会话进行中：KGM 模型、技能调用与主题上下文](https://raw.githubusercontent.com/haxitag/yuelicopilot/main/chating.png)

#### 技能与任务管理中心

![技能与任务管理中心](https://raw.githubusercontent.com/haxitag/yuelicopilot/main/admin.png)

#### 插件、向量路由与创作相关面板

![插件与向量路由等](https://raw.githubusercontent.com/haxitag/yuelicopilot/main/plugin.png)

**说明**：主仓 README 中上图使用相对路径 `./xxx.png`，在 GitHub 浏览本仓库时可直接渲染。同步到 [`haxitag/yuelicopilot`](https://github.com/haxitag/yuelicopilot) 时，`scripts/oss-export.sh` 会把上述链接改写为 `https://raw.githubusercontent.com/haxitag/yuelicopilot/main/…`，避免在部分页面下相对路径或 blob 链裂图。首图文件名为 **`workbench-api.png`**（原 `ui.png` 在 GitHub README 代理下曾出现仅该资源不显示，故改名）。

## 五分钟上手

默认 **无需再克隆 KGM 源码仓库**：`npm install` 会安装 [`@haxitag/yueli-kgm-computing`](https://www.npmjs.com/package/@haxitag/yueli-kgm-computing)，`start.sh` 从本仓库的 `node_modules` 启动 KGM（含 Playground）。

```bash
git clone https://github.com/zhyr/yuelicopilot.git
cd yuelicopilot
cp .env.example .env   # 可选：自定义端口等
npm install
chmod +x start.sh
./start.sh
```

终端会打印 **前端 / Skill Executor / KGM** 三个地址；浏览器打开 **前端 URL**（默认多为 `http://localhost:3020`）。设置里 KGM 基址应与 `.env.local` 中的 `VITE_KGM_BASE_URL` 一致，脚本已自动生成时 **一般不必手改**。

### 与 KGM 的版本对应

| 本仓库依赖（`package.json`） | 说明 |
|------------------------------|------|
| `@haxitag/yueli-kgm-computing@0.2.6` | 与当前 npm 发布线对齐；升级时请同步跑通 `./start.sh` 与测试，并更新此表。 |

KGM 的环境变量、OpenAPI、`/v1/runtime/*` 预检等能力说明以 **npm 包页面与包内 README** 为准；本仓库专注 **Copilot 侧如何连本地 KGM、如何组织技能与执行器**。

### 若你克隆的是 haxitag 组织对外过滤仓库

[`haxitag/yuelicopilot`](https://github.com/haxitag/yuelicopilot) 的 `main` 为 **过滤导出快照**，**不含** `start.sh` 与 `server/`。请打开该仓库 **README 顶部「如何启动运行」**，或参阅主仓文档 [开源仓库同步策略](docs/开源仓库同步策略.md) 中的 **「克隆 haxitag 对外仓后如何运行」**（`npm install` → 单独启动 KGM → `npm run dev`）。

### 前置要求

- **Node.js**：v20.x 或更高（与 KGM 包要求一致）
- **npm**：v8.x 或更高
- **Git**：克隆本仓库
- **macOS / Linux**：当前以 macOS / Linux 为主（Windows 建议 WSL2）

## 从零启动（详解）

与「五分钟上手」相同流程，仅补充说明项。

1. **克隆**本仓库（仅 yuelicopilot 即可）。
2. **`npm install`**：拉取 Copilot 与 `@haxitag/yueli-kgm-computing`；若缺失 KGM 包，`start.sh` 也会尝试补装。
3. **`.env`**：复制 `.env.example` 为 `.env` 后可改端口等（可选）。
4. **`./start.sh`**：按默认或 `.env` 中的端口启动 KGM + Playground、Skill Executor、Vite；并写入 `.env.local` 供前端读取。
5. **验证**：终端无报错；可访问 KGM 的 Playground（与 KGM 同端口）做独立体检。

**`start.sh` 概要**：校验默认端口（可通过 `.env` 覆盖）→ 启动 **KGM**（`node_modules/@haxitag/yueli-kgm-computing/dist/server/enhancedStart.js`）→ **Skill Executor** → **Vite 前端**，并生成 `.env.local` 与前端代理一致。

### 可选：克隆 KGM 源码做二次开发

若你要 **改 KGM 本身** 而非仅用 npm 版本，可再克隆 [Yueli-KGM-Computing](https://github.com/zhyr/Yueli-KGM-Computing) 与本地 `npm link` 或工作区编排联调；日常体验 **Yueli Copilot 不依赖** 该步骤。

## 手动启动（非必需）

如果您需要单独启动各个服务，可以按以下顺序手动启动：

### 启动 KGM Computing（与 `start.sh` 等价的最小方式）

在 **yuelicopilot** 根目录已执行 `npm install` 的前提下：

```bash
cd yuelicopilot
mkdir -p /tmp/yueli-kgm-data/models/store
PORT=3080 \
  KGM_MOCK_MODE=1 \
  node ./node_modules/@haxitag/yueli-kgm-computing/dist/server/enhancedStart.js
```

具体环境变量以 [KGM npm 文档](https://www.npmjs.com/package/@haxitag/yueli-kgm-computing) 为准。

### 启动 Skill Executor

```bash
cd yuelicopilot/server
SKILL_EXECUTOR_PORT=3010 node index.js
```

### 启动前端

```bash
cd yuelicopilot
FRONTEND_PORT=3020 npm run dev
```

## 技术架构

### 分层架构（编排 / 推理 / 执行）

端到端闭环可概括为：**前端拼装上下文并调度 → KGM 推理与决策（不在进程内直接执行危险操作）→ Skill Executor 在隔离环境执行 → 结果回注前端与 KGM 总结**。该划分对 Agent、本地工作台与安全评审更友好：职责写在模块名与目录里，便于部署拓扑拆分与权限最小化。

```text
┌─────────────────────────────────────────────────────────┐
│  编排层（本仓库前端 + CoreOrchestrator 等）              │
│  上下文、主题、技能/MCP/模板调度、UI 与策略入口           │
└──────────────────────────┬──────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│  推理层（KGM：`@haxitag/yueli-kgm-computing`）              │
│  多模型路由、意图与 tool 规划、RAG 等；执行权外置         │
└──────────────────────────┬──────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│  执行层（Skill Executor / server）                       │
│  代码与系统能力、MCP 代理、沙箱侧真实 I/O                 │
└─────────────────────────────────────────────────────────┘
```

### 前端技术栈
- React 18
- TypeScript
- Styled Components
- Vite
- Vitest (测试框架)

### 核心模块（与分层对应）

1. **ApiService**：对上对接 UI 与编排流程，对下统一 KGM 等后端请求与智能路由
2. **CoreOrchestrator**：编排层枢纽，串联技能、MCP 与模板，与事件/审计等协作
3. **SkillExecutor**（含 `server/`）：执行层客户端与本地执行服务协作，承载实际技能运行与沙箱侧能力
4. **MCPConnectorManager**：MCP 连接器注册、健康与调用策略
5. **TemplateEngine**：对话与工具输出的 Markdown/HTML 模板渲染
6. **SkillLifecycleStateManager**：技能全生命周期状态机（安装、启用、执行、回收）
7. **ResourceScheduler**：多策略资源调度，服务并发与公平性
8. **ErrorHandler**：重试、熔断、降级与超时，提升私有化部署下的韧性

## API配置

### 默认配置
- **KGM服务**：`http://127.0.0.1:3080`（启动后自动分配）
- **Ollama服务**：通过 KGM 内部集成（可选配置）

### 配置方式
1. 点击界面右上角的设置图标
2. 在 "Yueli-KGM-Computing" 标签页中配置
3. 填写相关配置参数（通常使用默认即可）
4. 点击保存按钮

## 项目结构

```
yuelicopilot/
├── src/
│   ├── api/              # API服务
│   ├── components/       # React组件
│   ├── contexts/         # 上下文管理
│   ├── services/         # 核心服务
│   │   ├── core/         # 核心服务模块
│   │   │   ├── __tests__/    # 测试文件
│   │   │   ├── SkillLifecycleStateManager.ts  # 技能生命周期管理
│   │   │   ├── ResourceScheduler.ts           # 资源调度系统
│   │   │   ├── ErrorHandler.ts                # 错误处理机制
│   │   │   └── EventManager.ts               # 事件管理系统
│   │   ├── __tests__/     # 集成测试
│   │   │   └── integration.test.ts             # 集成测试
│   │   ├── MCPConnectorManager.ts             # MCP连接器管理
│   │   └── SkillExecutor.ts                   # 技能执行器
│   ├── styles/           # 样式文件
│   ├── types/            # TypeScript类型定义
│   ├── test/             # 测试配置
│   ├── App.tsx           # 应用入口
│   └── main.tsx          # 主文件
├── e2e/                  # E2E测试
│   └── yueli-e2e.test.mjs  # 端到端测试
├── server/               # Skill Executor 后端服务
├── public/               # 静态资源
├── .github/
│   └── workflows/        # GitHub Actions CI/CD
│       └── ci-cd.yml     # CI/CD 配置文件
├── start.sh              # 一键启动脚本
├── package.json          # 项目配置
├── tsconfig.json         # TypeScript配置
├── vitest.config.ts      # Vitest配置
├── vite.config.ts        # Vite配置
└── .env                  # 环境变量配置
```

## 使用指南

### 创建新对话
1. 点击左侧"创新问答会话"按钮
2. 在输入框中输入问题
3. 选择合适的模型和Provider
4. 点击发送按钮

### 管理项目主题
1. 点击左侧"+创建新项目主题"按钮
2. 填写项目名称和描述
3. 添加相关文件和指令
4. 保存项目主题

### 使用技能
1. 在输入框中输入技能名称
2. 系统会自动识别并执行相应技能
3. 查看技能执行结果

### 技能生命周期管理
Yueli Copilot实现了完整的技能生命周期管理：

| 状态 | 描述 | 可转换状态 |
|------|------|-----------|
| DISCOVERED | 发现但未安装 | INSTALLING, INSTALLED |
| INSTALLING | 安装中 | INSTALLED, ERROR, FAILED |
| INSTALLED | 已安装但未启用 | ENABLING, UNINSTALLING, DISABLED |
| ENABLING | 启用中 | ENABLED, ERROR, FAILED |
| ENABLED | 已启用 | ACTIVE, DISABLING, EXECUTING |
| ACTIVE | 活跃状态 | ENABLED, EXECUTING, FAILED, ERROR |
| EXECUTING | 执行中 | COMPLETED, FAILED, ERROR, ACTIVE |
| COMPLETED | 执行完成 | ACTIVE, DISABLING, ENABLED |
| FAILED | 执行失败 | EXECUTING, DISABLING, ENABLED |
| DISABLED | 已禁用 | ENABLING, UNINSTALLING, INSTALLED |
| UNINSTALLING | 卸载中 | UNINSTALLED, ERROR |
| UNINSTALLED | 已卸载 | 终止状态 |
| ERROR | 错误状态 | DISABLING, ENABLING, EXECUTING |

### 资源调度策略
支持以下五种调度策略：

1. **优先级调度 (PRIORITY)**：根据优先级分配资源
2. **公平调度 (FAIR)**：按权重公平分配资源
3. **资源感知调度 (RESOURCE_AWARE)**：根据资源使用情况动态分配
4. **负载均衡调度 (LOAD_BALANCED)**：将负载均匀分布到资源
5. **亲和性调度 (AFFINITY)**：根据偏好分配资源

### 错误处理机制
- **重试机制**：支持指数退避重试策略
- **熔断器模式**：防止系统过载，自动熔断和恢复
- **降级处理**：主服务失败时自动切换到备用方案
- **超时控制**：支持操作超时设置

## 测试覆盖

### 单元测试
- **SkillLifecycleStateManager.test.ts**：技能生命周期状态管理测试（17个测试）
- **ResourceScheduler.test.ts**：资源调度系统测试（9个测试）
- **ErrorHandler.test.ts**：错误处理机制测试（21个测试）

### 集成测试
- **integration.test.ts**：EventManager、AuditSystem、ResourceManager集成测试（12个测试）
  - EventManager 事件发布/订阅、错误处理
  - AuditSystem 审计记录查询和过滤
  - ResourceManager 资源管理

### E2E 测试
- **yueli-e2e.test.mjs**：完整端到端测试套件（健康检查、导航、管理页、Executor API、**LLM API 契约**含 `/v1/models`、非流式与流式 SSE 首包等）；需先 `./start.sh` 启动全栈。
- **环境变量**：若默认 `model: auto` 在你的环境不可用，可设 **`E2E_CHAT_MODEL`**（如 `qwen3.5:latest`）再运行 `npm run test:e2e`。
- **用户旅程与风险说明**：[docs/E2E用户旅程与生产级风险审查.md](docs/E2E用户旅程与生产级风险审查.md)（用例矩阵、数据链路、生产级风险与缓解）。
- **若报 `Could not find Chrome`**：E2E 默认优先用本机 **Google Chrome**（`channel: 'chrome'`）。请安装 Chrome，或执行 `npx puppeteer browsers install chrome`，或设置 **`PUPPETEER_EXECUTABLE_PATH`** 指向 Chromium/Chrome 可执行文件。
  - 服务健康检查（前端、KGM、Skill Executor）
  - 前端页面加载和渲染
  - 导航功能测试
  - 聊天功能测试（使用 `data-testid="chat-input"` 选择器）
  - 技能管理器测试
  - API功能测试
  - 数据管理功能测试
  - 用户体验测试

### 前端健康检查端点
Vite 开发服务器提供 `/health` 端点，返回服务健康状态：
```json
{
  "status": "ok",
  "service": "yueli-frontend",
  "version": "1.0.0",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "uptime": 12345.67,
  "checks": {
    "frontend": true,
    "node": true
  }
}
```

### CI/CD 集成
项目配置了完整的 GitHub Actions CI/CD 工作流（`.github/workflows/ci-cd.yml`）：

| Job | 描述 | 触发条件 |
|-----|------|---------|
| lint | ESLint 代码检查 | push/PR |
| typecheck | TypeScript 类型检查 | push/PR |
| unit-test | 单元测试 | lint/typecheck 通过后 |
| integration-test | 集成测试 | lint/typecheck 通过后 |
| e2e-test | 端到端测试 | push/PR |
| build | 生产构建 | main 分支 push |
| coverage | 覆盖率报告 | 单元测试后 |
| deploy | 生产部署 | main 分支 push |

### 测试命令
```bash
# 运行所有测试（单元测试 + 集成测试）
npm test

# 运行单元测试（排除 E2E 测试）
npm run test:unit

# 运行集成测试
npm run test:integration

# 运行 E2E 测试（需要服务运行）
npm run test:e2e

# 监听模式（开发时使用）
npm run test:watch

# 打开测试 UI 界面
npm run test:ui

# 生成覆盖率报告
npm run test:coverage
```

## 常见问题

### 端口冲突

默认端口为 **KGM 3080**、**Skill Executor 3010**、**前端 3020**（可通过 `.env` / 环境变量覆盖）。`start.sh` 在启动前会检测占用并在可能时 **终止占用这些端口的旧进程** 后重启；若你希望自行处理：

```bash
lsof -i :3080
lsof -i :3010
lsof -i :3020
# 确认进程后结束占用，再执行 ./start.sh
```

### KGM 服务启动失败

1. Node.js 是否为 **v20.x**
2. 是否已在本仓库根目录执行 **`npm install`**（存在 `node_modules/@haxitag/yueli-kgm-computing`）
3. 查看日志：`cat /tmp/yueli-kgm.log`

### API连接失败
1. 检查 API 地址是否正确（查看 `.env.local` 中的实际端口）
2. 确认 KGM 服务是否正常运行
3. 检查网络连接

### 技能安装失败
1. 检查技能 URL 是否正确
2. 确认网络连接正常
3. 检查技能 metadata 格式是否正确

## 贡献

欢迎提交 Issue 与 Pull Request。

## 许可证

MIT License — 见仓库根目录 [`LICENSE`](LICENSE)。