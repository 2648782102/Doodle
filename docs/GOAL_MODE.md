# Goal Mode

This document explains how to give a coding agent a long-running maintenance objective for this repository. It is documentation, not an active instruction.

## Required fields

| Field | Meaning |
|---|---|
| Repository | Absolute or workspace-relative checkout path |
| Objective | One concrete product or maintenance outcome |
| Time boundary | Start/end time with timezone, or an explicit stopping condition |
| Authority | Allowed commits, pushes, docs, dependencies, and validation commands |
| Red lines | Operations the agent must never perform |
| Evidence | Tests, builds, screenshots, CI checks, and final audit artifacts |

## Default red lines

- No force push, history rewrite, tag movement, or deletion of user data.
- No committed secrets, `.env` files, generated `dist/`, or private `output/` state.
- No npm publish, external mass messaging, or repository metadata change without explicit authority.
- No project-file write triggered by a board drawing, note, or scan.
- No tool that opens a browser or IDE as a side effect.
- stdout stays clean for MCP JSON-RPC; logs stay on stderr.

## Good objective template

```text
在 <start> 到 <end>（<timezone>）之间维护 <repository>：围绕「<one measurable outcome>」持续迭代。
允许正常提交并推送到 <branch>，更新版本化文档、测试、CI 与离线守卫；每次增量运行 npm run check。
禁止 force push、改写历史、移动 tag、提交凭据或 output/dist、自动发布、绕过人工审阅的项目写入。
结束时列出提交、验证证据、已知限制与下一步。
```

## Final audit

Before declaring completion, check `git status`, recent commits, the exact diff, test output, package dry-run, local MCP tool list, and that no forbidden artifact is tracked. Prefer small, coherent commits over one opaque cleanup.

Historical `0.3.x` goal-mode runs and workbench-era evidence belong to the archived records, not current product behavior.
