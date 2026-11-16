# 目标：让画板成为 AI 更好用的视觉工具

## Objective

在不增加 MCP 工具数量、不触碰 UI 层的前提下，让 AI 只通过 `get_board` / `draw_board` 的返回与输入就能：看懂画板、表达意图、纠正错误、解释自己的改动。

## Scope

1. `get_board` 提供确定性的视觉诊断。
2. 工具错误结构化、可自修复。
3. `diagram` 支持高层 recipe，AI 不必手算几十个坐标。
4. `draw_board` 返回可读、可机读的变更说明。
5. 建立 prompt contract 测试，模拟 AI 只看工具输出完成任务。
6. 明确 AI 视觉语义协议：`role` / `emphasis` 的固定含义。
7. `get_board` 支持分级读取：`summary` / `structure` / `detail` / `full`。

## Acceptance

- 四个 MCP 工具名称和总数不变；不新增会话、消息或代码写入能力。
- 每次写入后，AI 能从 `draw_board` 返回中回答“改了什么”。
- 输入被拒绝时，AI 能从 `ERROR_JSON` 得到 `code`、`path`、`expected`、`fix`。
- `get_board` 的默认返回仍完整可用；显式 `view` 只减少 token，不改变权威状态。
- 视觉诊断中的重叠、孤立节点、焦点、可放置空间全部确定性、有界、无副作用。
- 新增行为由测试与仓库守卫锁定；`npm run check` 与端到端 MCP 会话通过后才推送。

## Red lines

- 不把画板变成对话工具或第二会话。
- 不让画板获得项目写入权限。
- 不为了“更智能”增加隐藏副作用：不自动打开浏览器、不写项目文件、不替 AI 做决定。
- 不修改 UI 层文件；另一个会话负责 UI。

## Status

Completed 2026-11-17. All seven priorities shipped behind the same four MCP tools: visual diagnosis, repairable errors, high-level recipes, change reports, prompt-contract tests, visual semantics in capabilities, and graded reads. Verified with `npm run check` (171 tests) and a six-check end-to-end MCP session; no UI files were modified.
