# 文档目录

先读 [`../README.md`](../README.md) 了解安装与产品概览；AI coding agent 请先读 [`../AGENTS.md`](../AGENTS.md)。

下表按"你要解决什么问题"分组，不按文件名排序。

## 入门

| 文档 | 用途 |
|---|---|
| [`../README.md`](../README.md) | 产品概览、30 秒上手、三个绘图工具、安装与配置 |
| [`../README.en.md`](../README.en.md) | 英文快速上手 |
| [`FAQ.md`](FAQ.md) | 插件目录、隐私、本地状态、支持渠道 |
| [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md) | 首次自检与常见故障 |
| [`../examples/README.md`](../examples/README.md) | MCP 配置片段与最小客户端 |
| [`../examples/architecture-discussion.md`](../examples/architecture-discussion.md) | 由宿主 coding agent 提供项目理解，在 Doodle 上共同绘制和修正架构图的中英文示例 |

## 产品与设计

| 文档 | 用途 |
|---|---|
| [`PRODUCT_DIRECTION.md`](PRODUCT_DIRECTION.md) | 产品定义、边界与体验原则 |
| [`GOALS.md`](GOALS.md) | 每个已交付目标的目标、验收标准与实测结果 |
| [`DECISIONS.md`](DECISIONS.md) | 当前生效的技术决策与历史 ADR 状态 |
| [`EXPERIENCE_AUDIT.md`](EXPERIENCE_AUDIT.md) | 双身份实测的摩擦清单、优先级与闭环状态 |
| [`EXCALIDRAW_COMPARISON.md`](EXCALIDRAW_COMPARISON.md) | DOM 画布与 Excalidraw 的 token 成本与视觉对比 |
| [`../ROADMAP.md`](../ROADMAP.md) | 已交付基线、近期工作与明确不做的事 |

## 工程

| 文档 | 用途 |
|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | 源码结构、Board v1 状态、MCP 工具面、HTTP API 与安全模型 |
| [`DIAGRAM_GUIDE.md`](DIAGRAM_GUIDE.md) | `diagram` 的字段、`replace` 语义、布局上限与已知坑 |
| [`DEPENDENCY_MAINTENANCE.md`](DEPENDENCY_MAINTENANCE.md) | 依赖策略与验证顺序 |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | 本地搭建、测试与 PR 规范 |
| [`../AGENTS.md`](../AGENTS.md) | 给 AI coding agent 的短操作手册 |

## 对外材料

| 文档 | 用途 |
|---|---|
| [`SUBMISSION.md`](SUBMISSION.md) | 公共提交已备材料与 OpenAI 侧资格门槛 |
| [`LAUNCH_KIT.md`](LAUNCH_KIT.md) | GitHub 描述与发布文案 |
| [`GOVERNANCE.md`](GOVERNANCE.md) | 开源维护清单与公共元数据 |
| [`COMPETITIVE_RESEARCH.md`](COMPETITIVE_RESEARCH.md) | 白板、MCP 工具与视觉 agent 面的产品经验 |
| [`../SECURITY.md`](../SECURITY.md) | 威胁模型与漏洞报告流程 |
| [`../PRIVACY.md`](../PRIVACY.md) | 本地数据类别、用途、接收方、保存期限与用户控制 |
| [`../SUPPORT.md`](../SUPPORT.md) | 问题与安全报告渠道 |
| [`../TERMS.md`](../TERMS.md) | 开源许可与公开项目表面条款 |
| [`../CHANGELOG.md`](../CHANGELOG.md) | 版本记录 |

## 历史归档（只读，不代表当前行为）

| 文档 | 用途 |
|---|---|
| [`archive/adr-legacy/`](archive/adr-legacy/README.md) | 已移除的项目工作台时期 ADR |

## 语言约定

中英混排本身也是"乱"的来源，所以约定成规则：

- **中文**：入口与产品类文档——根 `README.md`、本索引、`PRODUCT_DIRECTION.md`、`GOALS.md`。这几份是第一次进来会读的东西。
- **英文**：工程记录与对外材料——`ARCHITECTURE.md`、`DECISIONS.md`、`EXPERIENCE_AUDIT.md`、`DIAGRAM_GUIDE.md`、`AGENTS.md`、`CHANGELOG.md`，以及 `SECURITY.md` / `PRIVACY.md` / `SUPPORT.md` / `TERMS.md`。前几份被 `repo-check.mjs` 按英文原句断言，后几份直接面向 GitHub 与 OpenAI 的审核方。
- `README.en.md` 与 `README.md` 保持结构对应，只做语言差异。

新增文档请先归入某一类，再决定语言；不要出现两份讲同一件事、语言还不同的文档。

---

发布前跑 `npm run check`。文档与源码同版本：改动 MCP 工具面、画板协议、插件打包、宿主上下文桥或安全边界时，必须同时更新架构、agent 手册、目标记录、测试、CI 与两个离线守卫。
