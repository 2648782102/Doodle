# Doodle

> 一张本地优先的双向画板：人和 AI 都能在上面画图表达意思，并读取对方留下的视觉上下文。

## 产品定义

Doodle 只有一个内核：**人和 AI 共用的无限画板**。AI 通过 MCP 工具在 Agent 内画，人直接在画布上画；任何一方都能接着改，画板本身就是沟通媒介。对话仍留在宿主聊天里，Doodle 不创建第二套会话。

对外只有两个入口：

- **Codex 插件**：推荐安装方式，一条命令完成安装。
- **直接 MCP / `npx`**：任意 MCP 宿主都可使用，无需 clone 仓库。

宿主能力分三层：四工具始终可用；支持 MCP Apps 时把同一张画布显示在对话旁；支持 `updateModelContext` / `sendMessage` 时增加自动同步和短通知。宿主不渲染画布时，`get_board` 返回的 `PANEL_URL` 是本地兜底页面。项目结构只是可选素材，不是产品主体。

`PANEL_URL` 属于当前 MCP server 进程：会话或宿主退出后它会失效，这是正常生命周期。需要脱离会话、手动开关的本地预览时，运行 `npm run preview:board`；它只启动画板 HTTP 服务，不注册 MCP stdio 工具，也不会安装后台服务。用 `Ctrl+C` 停止。

双向主流程：

```text
AI 用 draw_board 画 → 人看后直接画 / 改 → 最终状态进入当前会话上下文 / 人点通知
→ AI 用 get_board 或上下文读取 → AI 继续画 / 改 → 人再看……可无限往返
```

产品定义见 [docs/PRODUCT_DIRECTION.md](docs/PRODUCT_DIRECTION.md)，plugin 目标见 [docs/GOAL_PLUGIN.md](docs/GOAL_PLUGIN.md)，架构见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)，AI 操作手册见 [AGENTS.md](AGENTS.md)。

## 30 秒上手

选一个入口：

**Codex 桌面插件**：在 Doodle 仓库里运行一条命令：

```bash
npm run setup:codex
```

它会自动安装依赖、构建自包含插件、注册本仓库的本地 marketplace、安装 `doodle@doodle`，并打印首句提示。**开启一个新的 Codex 会话**，然后说：

```text
打开 Doodle 画板，我们先用画板交流。
```

兼容 MCP Apps 的宿主会直接显示画布；AI 会先读画板，再放一个起步对象。你可以选工具点按 / 拖拽直接画，双击或选中后按 `Enter` / 点「编辑」改字；`?` 可随时查看提示。人画完后，宿主会自动同步最终状态（若支持），也可点「通知 Agent」发一句短提醒；AI 会看画、用文字或继续画图回应。若宿主不显示画布，就问 AI 要 `PANEL_URL`，打开本地地址，并在聊天里让 AI 重读。

完整链路：`npm run setup:codex → 新会话 → 首句提示 → AI 和人双向画 / 改 → 最终状态同步 / 通知 Agent → AI 再看 / 再画`。

**任意 MCP 宿主**：把 [examples/mcp-config/](examples/mcp-config/) 的 `npx -y doodle-mcp` 片段加入宿主配置，重启 MCP 会话后使用同一句提示；画布仍通过 `show_board` / `draw_board` 自动呈现，宿主不渲染时询问 `PANEL_URL`。这条路径不需要 clone 仓库，也不等于公共插件目录发布。

## 四个 MCP 工具

| 工具 | 用途 |
|---|---|
| `get_board` | 读取共享画布；空画板给 `FIRST_USE` / `NEXT_STEPS` 和画图规范，有内容后切到简短 `NEXT`，始终保留 revision、对象 ID、坐标、作者与 `BOARD_JSON`；默认第一步，只读 |
| `show_board` | 在 Agent 对话旁打开可交互的共享画布；用户要求查看或编辑画布时使用 |
| `draw_board` | 批量新增 / 更新 / 删除便签、文字、矩形、椭圆和有方向箭头；写入会串行应用到最新状态 |
| `scan_project` | 可选只读扫描当前项目结构，返回有界相对路径和 `file:line` 证据文本；不写文件、不自动画图 |

默认双向闭环：

```text
AI: get_board → draw_board → 看人怎么改
人: 看画 → 直接画 / 改 → 自动同步或通知 Agent
然后重复；对话始终留在宿主聊天里
```

`show_board` 只是在兼容宿主里显示这张画布的可选工具；`scan_project` 只是「项目结构」这个主题的能力之一。AI 决定是否需要，并用 `draw_board` 把结果画到同一张画布；它们不创建图库、不改会话、不授权代码变更。

## 安装

### Codex plugin（推荐）

一条命令即可完成安装，详见上方「30 秒上手」：

```bash
npm run setup:codex
```

`scripts/setup-codex.mjs` 只会在你主动运行时调用 Codex CLI：`npm install`（首次）、`npm run build`、`codex plugin marketplace add . --json`、`codex plugin add doodle@doodle --json`。重复运行是安全的；可用 `npm run setup:codex -- --dry-run` 预览命令。官方 OpenAI 文档说明本地 marketplace 与[公共插件目录](https://developers.openai.com/plugins/build/plugins)是不同路径，安装后应[开启新会话](https://learn.chatgpt.com/docs/plugins)再使用插件的 MCP 工具和 skill。插件包由 `scripts/build-plugin.mjs` 生成到忽略的 `.doodle-plugin/doodle/`，使用同一个自包含 stdio MCP server，不依赖仓库里的 `dist/` 或绝对路径。`npm run build:submission` 会生成忽略的 `doodle-plugin-submission/doodle-0.7.0.zip` 供提交审核；本仓库提供本地 / repo marketplace 安装路径，公共插件目录发布仍需要 OpenAI 侧资格、身份验证和审核。材料清单见 [docs/SUBMISSION.md](docs/SUBMISSION.md)。

### 直接 MCP stdio

把 [examples/mcp-config/](examples/mcp-config/) 的零配置片段加入 MCP 宿主即可；发布版使用 `npx -y doodle-mcp`，无需绝对路径。本地 checkout 也可使用 `node dist/index.js`（先运行 `npm run build`）。默认自动选择空闲本地端口、隔离画板状态目录，并通过启动环境推断工作区；只有宿主在项目外启动 MCP 时才需要设置 `DOODLE_WORKSPACE_ROOT`。可选环境变量：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PREVIEW_PORT` | 空闲端口 | 固定本地画板 HTTP 端口；未设置或设为 `0` 时自动选择 |
| `PREVIEW_HOST` | `127.0.0.1` | 本地监听地址 |
| `OUTPUT_DIR` | plugin data / `.doodle-data` / `./output` | 画板状态目录 |
| `DOODLE_WORKSPACE_ROOT` | 包根目录 | `scan_project` 的目标工作区 |
| `LOG_LEVEL` | `info` | stderr 日志级别 |

### 开发者自检

```bash
npm install
npm run check
npm run doctor
npm run preview:board
```

状态文件位于所选目录下的 `.doodle/board.json`，是独立 version 1 状态，应加入忽略，不提交到仓库。既有 version 1 留言字段为兼容旧状态而保留；新画布和 Agent 工具不再显示或写入留言流。

`AI_DRAW_WORKSPACE_ROOT` 和旧的 `output/.ai-draw/board.json` 仍作为只读兼容入口保留；新配置请使用 `DOODLE_WORKSPACE_ROOT`。

## 画图规范

- 先调用 `get_board` 读取现有对象 ID 和坐标。
- 重画整张图时先用 `draw_board.remove_ids` 清理旧对象，再批量新增。
- `author` 放在 `draw_board` 顶层参数，不放进 item。
- 结构化图用严格网格、短标签、一致尺寸。
- `line` 是箭头：`(x,y)` 为起点，`(x+w,y+h)` 为终点；`w` / `h` 可为负数。
- 箭头端点贴着源对象和目标对象的外缘，标签保持短。
- 工具调用不主动打开浏览器，画布对象不构成项目写入授权。

## 安全边界

- stdout 只用于 MCP JSON-RPC；所有日志写 stderr。
- 本地 HTTP 默认只监听 `127.0.0.1`。
- 非 GET `/api/board/*` 需要页面随机 `X-AI-Draw-Token`、`confirmedBy: "human"` 和匹配的画板 revision。
- `scan_project` 跳过常见生成目录、dot-private 文件、`.env`-like 文件和大文件，过滤常见凭据行，证据总数最多 40 条；只返回工作区相对路径与短证据。
- 画布对象只是视觉上下文，不签发凭据，不写项目文件。嵌入 UI 通过 MCP Apps 宿主桥调用正常画布工具。
- 支持上下文能力的嵌入 UI 还会把当前画板最终状态挂到宿主当前会话的模型上下文；这只是本地视觉上下文，不是操作日志、聊天记录或项目写入授权。独立 `PANEL_URL` 页面没有宿主会话桥，也不会伪装成已同步。

## 开发

```bash
npm run lint
npm run build
npm test
npm run repo:check
npm run doctor
```

完整验收用 `npm run check`，其中包含 plugin 构建、`npm run repo:plugin-check` 与 `setup:codex --dry-run`；校验不会修改本机 Codex 配置。新增或移除 MCP 工具、协议字段、plugin 打包或安全边界时，必须同步 `AGENTS.md`、架构、决策、plugin 目标文档、测试、示例、CI 和两个离线守卫。

四个工具均带显式 MCP annotations：`get_board` / `show_board` / `scan_project` 为只读、非破坏性、封闭本地；`draw_board` 是可删除或覆盖对象的破坏性写入。任何工具 schema 或行为变化都必须同步这些标注和回归测试。

## 文档

| 文档 | 内容 |
|---|---|
| [English quickstart](README.en.md) | 英文安装和产品概览 |
| [AGENTS.md](AGENTS.md) | 给 AI coding agent 的短操作手册 |
| [产品方向](docs/PRODUCT_DIRECTION.md) | 定义、边界与验收 |
| [体验审计](docs/EXPERIENCE_AUDIT.md) | 双身份实测、问题优先级与闭环状态 |
| [Plugin 目标](docs/GOAL_PLUGIN.md) | Codex plugin 的目标、范围与验收 |
| [架构](docs/ARCHITECTURE.md) | 源码结构、协议、HTTP 与安全模型 |
| [当前决策](docs/DECISIONS.md) | 0.7.0 会话上下文同步与历史 ADR 状态 |
| [文档地图](docs/README.md) | 全部文档入口 |
| [故障排查](docs/TROUBLESHOOTING.md) | 首用自检与常见问题 |
| [贡献指南](CONTRIBUTING.md) | 本地验证与 PR 规范 |
| [安全政策](SECURITY.md) | 威胁模型与漏洞报告 |
| [隐私政策](PRIVACY.md) | 本地数据、用途、接收方、保存期限与用户控制 |
| [支持](SUPPORT.md) | 问题反馈、支持渠道与安全报告入口 |
| [使用条款](TERMS.md) | 开源许可、项目表面和分发说明 |
| [FAQ](docs/FAQ.md) | 插件目录、隐私、本地状态与帮助入口 |
| [公开提交](docs/SUBMISSION.md) | 仓库已备材料与 OpenAI 侧资格事项 |
| [行为准则](CODE_OF_CONDUCT.md) | 社区参与规则 |
| [路线图](ROADMAP.md) | 当前基线与非目标 |
| [更新日志](CHANGELOG.md) | 版本记录 |

## License

MIT. See [LICENSE](LICENSE).
