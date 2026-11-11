# Doodle

> 一张本地优先的共享无限画布：人和 AI 在同一个地方画便签、形状和箭头。

Doodle 不是项目工作台、静态图生成器、聊天产品或批准系统。它提供一张共享画布，AI 通过 MCP stdio 在 Agent 内自然地读写；Codex 用户可以从本仓库的 plugin marketplace 安装桌面插件。支持 MCP Apps 的宿主可把同一张画布作为可选增强显示在对话旁；日常对话仍留在 Agent 自己的聊天里。项目结构可以画，但不是产品主体。

用户要求看画布时，`show_board` 会在支持 MCP Apps 的宿主对话旁呈现可交互画布；AI 成功调用 `draw_board` 后，兼容宿主也会从结果自动呈现或刷新画布，让用户直接看到刚画的内容。宿主不渲染 App 时，`get_board` 返回的 `PANEL_URL` 指向本地画布；普通 MCP 工具不会主动打开系统浏览器。选工具后点按快速放置或拖拽定尺寸，Space / 中键拖动画布，滚轮平移、Ctrl/⌘+滚轮缩放，双击改字。AI 用 `get_board` 读取画布、用 `draw_board` 画便签 / 形状 / 有方向箭头；回复和讨论留在 Agent 对话。MCP Apps UI 通过 Agent 宿主调用同一组工具，不依赖独立聊天服务。

产品定义见 [docs/PRODUCT_DIRECTION.md](docs/PRODUCT_DIRECTION.md)，plugin 目标见 [docs/GOAL_PLUGIN.md](docs/GOAL_PLUGIN.md)，架构见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)，AI 操作手册见 [AGENTS.md](AGENTS.md)。

## 四个 MCP 工具

| 工具 | 用途 |
|---|---|
| `get_board` | 读取共享画布：revision、对象 ID、坐标、作者、`BOARD_JSON` 与画图规范；默认第一步，只读 |
| `show_board` | 在 Agent 对话旁打开可交互的共享画布；用户要求查看或编辑画布时使用 |
| `draw_board` | 批量新增 / 更新 / 删除便签、文字、矩形、椭圆和有方向箭头；写入会串行应用到最新状态 |
| `scan_project` | 可选只读扫描当前项目结构，返回有界相对路径和 `file:line` 证据文本；不写文件、不自动画图 |

默认闭环：

```text
Agent 对话 ↔ 共享画布：get_board → draw_board → 人继续画 → AI 再读
```

`show_board` 只是在兼容宿主里显示这张画布的可选工具；`scan_project` 只是「项目结构」这个主题的能力之一。AI 决定是否需要它们，并用 `draw_board` 把结果画到同一张画布；它们不创建图库、不改会话、不授权代码变更。

## 快速开始

```bash
npm install
npm run build
npm run check
npm run doctor
```

### Codex plugin（推荐）

```bash
npm install
npm run build
codex plugin marketplace add . --json
codex plugin list --marketplace doodle --available --json
codex plugin add doodle@doodle --json
```

插件包由 `scripts/build-plugin.mjs` 生成到忽略的 `.doodle-plugin/doodle/`。它使用同一个自包含 stdio MCP server，不依赖仓库里的 `dist/` 或绝对路径。`npm run build:submission` 会生成忽略的 `doodle-plugin-submission/doodle-0.6.2.zip` 供提交审核；本仓库提供本地 / repo marketplace 安装路径，公共插件目录发布仍需要 OpenAI 侧资格、身份验证和审核。材料清单见 [docs/SUBMISSION.md](docs/SUBMISSION.md)。

### 直接 MCP stdio

在 MCP 宿主里加入 stdio server，配置示例见 [examples/mcp-config/](examples/mcp-config/)。常用环境变量：

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PREVIEW_PORT` | 空闲端口 | 固定本地画板 HTTP 端口；未设置时自动选择 |
| `PREVIEW_HOST` | `127.0.0.1` | 本地监听地址 |
| `OUTPUT_DIR` | plugin data / `.doodle-data` / `./output` | 画板状态目录 |
| `DOODLE_WORKSPACE_ROOT` | 包根目录 | `scan_project` 的目标工作区 |
| `LOG_LEVEL` | `info` | stderr 日志级别 |

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

## 开发

```bash
npm run lint
npm run build
npm test
npm run repo:check
npm run doctor
```

完整验收用 `npm run check`，其中包含 plugin 构建与 `npm run repo:plugin-check`。新增或移除 MCP 工具、协议字段、plugin 打包或安全边界时，必须同步 `AGENTS.md`、架构、决策、plugin 目标文档、测试、示例、CI 和两个离线守卫。

四个工具均带显式 MCP annotations：`get_board` / `show_board` / `scan_project` 为只读、非破坏性、封闭本地；`draw_board` 是可删除或覆盖对象的破坏性写入。任何工具 schema 或行为变化都必须同步这些标注和回归测试。

## 文档

| 文档 | 内容 |
|---|---|
| [English quickstart](README.en.md) | 英文安装和产品概览 |
| [AGENTS.md](AGENTS.md) | 给 AI coding agent 的短操作手册 |
| [产品方向](docs/PRODUCT_DIRECTION.md) | 定义、边界与验收 |
| [Plugin 目标](docs/GOAL_PLUGIN.md) | Codex plugin 的目标、范围与验收 |
| [架构](docs/ARCHITECTURE.md) | 源码结构、协议、HTTP 与安全模型 |
| [当前决策](docs/DECISIONS.md) | 0.6.2 收束决策与历史 ADR 状态 |
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
