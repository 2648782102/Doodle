# Doodle

> 一张本地优先的双向画板：人和 AI 都能在上面画图表达意思，并读取对方留下的视觉上下文。

Doodle 只有一个内核：**人和 AI 共用的无限画板**。AI 通过 MCP 工具在 Agent 里画，人直接在画布上画；任何一方都能接着改，画板本身就是沟通媒介。对话仍留在宿主聊天里——Doodle 不创建第二套会话。

```text
AI 用 draw_board 画 → 人看后直接画 / 改 → 终态进入当前会话上下文 / 人点通知
→ AI 用 get_board 或上下文读取 → AI 继续画 / 改 → 人再看……可无限往返
```

对外只有两个入口：**Codex 插件**（推荐，一条命令）和**直接 MCP / `npx`**（任意宿主，不必 clone）。宿主能力分三层：四个工具始终可用；支持 MCP Apps 时把同一张画布显示在对话旁；支持 `updateModelContext` / `sendMessage` 时增加自动同步和短提醒。宿主不渲染画布时，`get_board` 返回的 `PANEL_URL` 是本地兜底页。

自 `0.8.0` 起自研 DOM 画布已移除，**Excalidraw 是唯一的编辑/渲染画布**。Board v1 仍是唯一持久状态和 AI 权威入口，Excalidraw 元素只由它派生，不存在第二份画布状态。

## 30 秒上手

**只想画两笔（不需要 AI）**

```bash
npm run doodle
```

启动本地画板并打开浏览器，终端里印出地址和几个基本手势；关掉终端就停止。空画板首次打开有可关闭的引导卡。

**想和 AI 共用同一张画板**

```bash
npm run setup:codex
```

一条命令装好依赖、构建自包含插件、注册本地 marketplace、安装 `doodle@doodle`，并打印首句提示。**开启一个新的 Codex 会话**，然后说：

```text
打开 Doodle 画板，我们先用画板交流。
```

兼容 MCP Apps 的宿主会直接显示画布，AI 先读画板再放一个起步对象。你选工具点按或拖拽即可画；双击对象改字、双击空白新建便签；空白处拖拽框选后可批量移动 / 删除 / 成组 / 整理；`Ctrl/⌘+Z` 撤销、方向键微调、`Ctrl/⌘+V` 粘贴图片。左上角「图库」是覆盖式抽屉，不挤压 Excalidraw 工具栏。人画完后宿主会同步终态，也可点「通知 Agent」发一句短提醒。宿主不显示画布时，向 AI 要 `PANEL_URL`。

**任意 MCP 宿主**

把 [examples/mcp-config/](examples/mcp-config/) 里的 `npx -y doodle-mcp` 片段加进宿主配置，重启 MCP 会话即可，无需 clone 仓库。这条路径不等于公共插件目录发布。

## 四个 MCP 工具

| 工具 | 用途 |
|---|---|
| `get_board` | 读取共享画布。首次返回完整画图规范，之后自动精简；传 `since_revision` 只返回变化对象并附 `HANDOFF`（人改了什么，不含 AI 自己的改动）。只读，默认第一步 |
| `show_board` | 在对话旁打开可交互画布。用户要看或要改时使用 |
| `draw_board` | 写入面：新增、精确更新、删除、确定性布局、连接线、变体/角色/样式/层级，以及 `library` 图库操作。`diagram` 用语义节点/边追加一张图，`replace: true` 才整张重画 |
| `scan_project` | 可选只读扫描项目结构，返回有界相对路径与 `file:line` 证据。不写文件、不自动画图 |

`show_board` 与 `scan_project` 都不创建图库、不改会话、不授权代码变更。

## 安装与配置

**Codex 插件**：`npm run setup:codex` 只在你主动运行时调用 Codex CLI（`npm install` → `npm run build` → `codex plugin marketplace add` → `codex plugin add doodle@doodle`）。重复运行安全，`--dry-run` 只预览命令。插件包装的是同一个自包含 stdio MCP 服务，不依赖仓库里的 `dist/` 或绝对路径。`npm run build:submission` 生成提交审核用的 ZIP；公共插件目录发布还需 OpenAI 侧资格与审核，材料见 [docs/SUBMISSION.md](docs/SUBMISSION.md)。

**直接 MCP stdio**：发布版用 `npx -y doodle-mcp`，本地检出可用 `node dist/index.js`（先 `npm run build`）。默认自动选空闲端口、隔离状态目录，并从启动环境推断工作区；只有宿主在项目外启动时才需要 `DOODLE_WORKSPACE_ROOT`。

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PREVIEW_PORT` | 空闲端口 | 固定本地画板 HTTP 端口；未设置或为 `0` 时自动选择 |
| `PREVIEW_HOST` | `127.0.0.1` | 本地监听地址 |
| `OUTPUT_DIR` | plugin data / `.doodle-data` / `./output` | 画板状态目录 |
| `DOODLE_WORKSPACE_ROOT` | 包根目录 | `scan_project` 的目标工作区 |
| `LOG_LEVEL` | `info` | stderr 日志级别 |

状态文件是所选目录下的 `.doodle/board.json`（version 1，独立状态，应忽略，勿提交）。`AI_DRAW_WORKSPACE_ROOT` 与旧的 `output/.ai-draw/board.json` 仅作只读兼容保留。

`PANEL_URL` 属于当前 MCP server 进程，宿主退出即失效——这是正常生命周期。需要脱离会话的预览就运行 `npm run preview:board`（只起画板 HTTP 服务，不注册工具、不装后台服务，`Ctrl+C` 停止）。

## 开发

```bash
npm install
npm run check     # 完整验收：lint / build / test / 仓库守卫 / 插件守卫 / doctor / 打包
npm run doctor
npm run preview:board
```

新增或移除 MCP 工具、协议字段、插件打包或安全边界时，必须同步 `AGENTS.md`、架构、决策、测试、示例、CI 与两个离线守卫。四个工具都带显式 MCP annotations：`get_board` / `show_board` / `scan_project` 只读、非破坏、封闭本地，`draw_board` 是可删除或覆盖对象的破坏性写入。

## 文档

完整索引在 [docs/README.md](docs/README.md)。常看的几个：

| 想了解 | 看这里 |
|---|---|
| 产品定义与边界 | [docs/PRODUCT_DIRECTION.md](docs/PRODUCT_DIRECTION.md) |
| 怎么让 AI 画好图 | [docs/DIAGRAM_GUIDE.md](docs/DIAGRAM_GUIDE.md) |
| 源码结构、HTTP 与安全模型 | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| 目标、验收与实测结果 | [docs/GOALS.md](docs/GOALS.md) |
| 当前有效的技术决策 | [docs/DECISIONS.md](docs/DECISIONS.md) |
| 出问题先看这里 | [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) |
| 安全 / 隐私 / 条款 | [SECURITY.md](SECURITY.md) · [PRIVACY.md](PRIVACY.md) · [TERMS.md](TERMS.md) |
| 给 AI coding agent 的操作手册 | [AGENTS.md](AGENTS.md) |

英文版快速上手见 [README.en.md](README.en.md)。版本记录见 [CHANGELOG.md](CHANGELOG.md)，路线图见 [ROADMAP.md](ROADMAP.md)。

## License

MIT. See [LICENSE](LICENSE).
