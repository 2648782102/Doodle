# Doodle 绘图评测台设计（草案 v0.1）

> 状态：设计稿，未实现。目标读者是接下来要动手的人。
> 本文不改变任何产品契约；它描述一个**离线**评测环境。

## 1. 要回答的问题

现有测试都是「给定输入，断言输出」的契约测试：`first-try.test.mjs` 验证拒绝可修复，
`ai-experience.test.mjs` 验证 digest/diagnose 的形状，`sync-loop.test.mjs` 验证并发写入。
它们全部**不碰真实模型**，因此无法回答下面这类问题：

1. 让一个真模型画「订单履约的五个阶段」，它第一次就把图画对吗？
2. 模型画的图，人一眼看得懂吗？还是标签叠在一起、箭头穿过卡片？
3. 一次会话花多少时间、多少 token？换 `diagram` 与手填坐标，差多少？
4. 人改了 AI 的图之后，AI 下一次读回来能理解改了什么并接着画吗？
5. 换模型 / 换提示词 / 改工具描述，这些数字是变好还是变坏？

第 5 个问题是关键：**没有它，一切"感觉变好了"都是不可验证的。**

## 2. 为什么不能只比截图

图生图的像素对比（SSIM/CLIP）在这里会误导：同一张流程图，卡片挪了 20px、
换个色板，语义完全相同，但像素差异巨大。反过来，卡片全部重叠在一起时，
像素可能"很像"模板，却完全不可读。

业界做法（DiagramEval, ACL Findings 2025）是把图当**有向图**评分，而不是当图片：
节点、边、层级、拓扑顺序分别打分。这对 Doodle 特别合适，因为 Board v1 本来就存着
精确的 `x/y/w/h`、`startItemId/endItemId`、`role`、`emphasis`——**图的真值结构是现成的**。

所以评分分三层，从硬到软：

```
Layer A 结构（机器可判，无歧义）  ← 90% 的权重
Layer B 几何与可读性（启发式）    ← 用 Board 自己的 diagnose + 新写的判据
Layer C 语义（模型判分 + 人审）   ← 抽样，不做主判据
```

像素图只作为**报告附件**，给人看，不参与打分。

## 3. 工作流设计思路

借用 DAG 工作流的分层：**任务 → 执行 → 观测 → 判分 → 汇总**，每层可独立替换。

```
 ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
 │ 1 任务集 │ → │ 2 执行器 │ → │ 3 观测   │ → │ 4 判分   │ → │ 5 报告   │
 │  cases   │   │ driver   │   │ trace    │   │ graders  │   │ report   │
 └──────────┘   └──────────┘   └──────────┘   └──────────┘   └──────────┘
       ↑                                                  │
       └──────────── 6 人机回环（human-in-loop）───────────┘
```

### 为什么是"工作流"而不是"一个大脚本"

- 每个 case 相互独立，可以并行、可以单独重跑、可以只跑失败的。
- 执行器可替换：今天用真实 MCP 客户端，明天可以换成"离线模型回放"。
- 判分器可替换：结构判分是纯函数，语义判分才需要模型。
- trace 是唯一事实来源：报告、回归对比、人工复核都从它重算，不重复跑模型。

## 4. 五层具体设计

### 4.1 任务集（cases）

一个 case 是一份**声明式**的期望，不是一个脚本：

```jsonc
{
  "id": "flow/order-fulfilment",
  "prompt": "把订单履约流程画出来：下单 → 校验 → 拣货 → 发货 → 签收",
  "expect": {
    "kind": "sequence",              // sequence | tree | comparison | freeform
    "nodes": ["下单", "校验", "拣货", "发货", "签收"],
    "edges": [["下单","校验"], ["校验","拣货"], ["拣货","发货"], ["发货","签收"]],
    "ordered": true,                 // 顺序有意义，允许列优先/行优先两种排布
    "max_crossings": 0,
    "forbidden": ["重叠", "孤立"]    // 见 4.4
  },
  "budget": { "max_tool_calls": 3, "max_seconds": 60, "max_bytes": 80_000 }
}
```

任务集分四类，从易到难：

| 类别 | 例子 | 判分重点 |
|---|---|---|
| `sequence` | 五步流程、时间线 | 节点集合 + 边是否连通成链 |
| `tree` | 组织架构、目录树 | 父子关系正确，层级不交叉 |
| `comparison` | 方案 A/B 对比 | 列分组正确，不对齐也算错 |
| `freeform` | 「解释这段代码的结构」 | 只判可读性下限 + 人审 |

**关键要求**：`nodes` 用**归一化后的标签**匹配（去空白、去标点、允许同义前缀），
否则模型写"校验订单"会被判成缺失"校验"。

### 4.2 执行器（driver）

执行器只做一件事：把 case 变成一次真实的 MCP 会话，并记录 trace。

```
for each case (可并行, 默认并发 2):
  temp OUTPUT_DIR              # 每个 case 一张干净的板，互不污染
  spawn `node dist/index.js`   # 真实 stdio server
  connect MCP client
  t0 = now
  call model with: system(doodle 的 MCP instructions) + prompt + tools
  loop:
    模型选择工具 → 调用 → 记录 (tool, args, result, 耗时, 字节数)
    直到模型说完成 / 超预算
  t1 = now
  board = get_board(view:"full")
  png   = 可选的 canvas 截图（供人看，不入分）
  write trace.json
```

三条硬要求：

1. **必须用真实 server + 真实 MCP 客户端**，不能直接调内部函数。
   工具描述、schema 校验、`ERROR_JSON` 的可修复性都是被评对象。
2. **每次从空板开始**，`OUTPUT_DIR` 用临时目录，跑完保留以支持复现。
3. **记录重试**。模型第一次画错、看到 `ERROR_JSON` 后修好，这是**正面信号**，
   要和"一次就对"分开统计——否则修复能力会被算成失败。

### 4.3 观测（trace）

trace 是整个系统的地基。建议结构：

```jsonc
{
  "case": "flow/order-fulfilment",
  "model": "…", "prompt_hash": "…", "tool_desc_hash": "…",
  "started_at": "…", "duration_ms": 12345,
  "turns": [
    { "tool": "get_board", "args": {...}, "ok": true, "ms": 12, "bytes": 4800 },
    { "tool": "draw_board", "args": {...}, "ok": false,
      "error": { "code": "SIZE_OUT_OF_RANGE", "path": "items[2].w" } },
    { "tool": "draw_board", "args": {...}, "ok": true, "ms": 31, "bytes": 6400 }
  ],
  "usage": { "input_tokens": 0, "output_tokens": 0 },
  "final_board": { /* Board v1 */ },
  "budget_exceeded": false
}
```

`prompt_hash` 和 `tool_desc_hash` 很重要：**改了工具描述就是改了实验条件**，
没有它，两次跑的差异无法归因。

### 4.4 判分（graders）

每个判分器是纯函数 `(trace, expect) → {score, checks[]}`，可单独测试。

**结构判分（Layer A，权重最高）**

| 指标 | 定义 | 来源 |
|---|---|---|
| `node_recall` | 期望节点中被画出的比例 | 归一化标签匹配 |
| `node_precision` | 画出的节点里属于期望的比例（惩罚乱加） | 同上 |
| `edge_f1` | 期望边集合 vs 实际边集合的 F1 | `startItemId/endItemId` |
| `sequence_ok` | 有序任务里，边的方向是否构成单链（无环、无分叉） | 拓扑检查 |
| `level_ok` | 树任务里，父子深度是否与期望一致 | 从边推导 BFS 深度 |

这一层**完全不需要模型**，也不会漂移，适合进 CI 做阈值门禁。

**几何与可读性（Layer B，启发式）**

复用现有 `diagnoseBoard()`，再补几个它没有的：

| 指标 | 定义 | 现状 |
|---|---|---|
| `no_overlap` | 节点两两不重叠 | ✅ `diagnose.overlapping` |
| `no_isolated` | 无孤立节点 | ✅ `diagnose.isolated` |
| `no_dangling` | 无悬空连接 | ✅ `diagnose.unresolved` |
| `edge_crossings` | 连线交叉次数 | ❌ 需新写（线段求交） |
| `edge_through_node` | 连线穿过无关卡片 | ❌ 需新写（线段-矩形相交） |
| `label_fit` | 文本是否超出卡片 | ❌ 需新写（估算文本宽度） |
| `density` | 画布面积利用率（太挤/太散都扣分） | ⚠️ 有 `bounds`，需补阈值 |
| `aspect_ratio` | 整体宽高比是否适合屏幕 | ⚠️ 可由 bounds 推导 |

`edge_crossings` 和 `edge_through_node` 是最能反映"图看着乱"的两项，
也正是现在完全没有测的。这两项应当优先实现。

**语义（Layer C，抽样）**

不做主判据。用两个廉价信号：

1. **模型判分**：让另一个模型看「期望 labels + 实际 digest」给 1–5 分，
   只用于发现"结构对但语义错"的 case（例如把"拒绝"画成了"通过"）。
2. **人审**：每个 case 留一张 PNG，抽样 10% 人工过一遍。

语义分**不进 CI 门禁**——它会漂移，且成本高。

### 4.5 报告（report）

输出一份 Markdown + 一份 JSON：

```
按 case 类别汇总：
  sequence    n=12  node_recall 0.94  edge_f1 0.88  一次通过率 58%
  tree        n=6   level_ok 0.75    crossings 1.2/case

失败聚类（最有用的部分）：
  - 5/12 的 sequence case 出现了 edge_through_node
  - 3/6 的 tree case 层级深度错了一级
  - 2 个 case 首次调用被 SIZE_OUT_OF_RANGE 拒绝，重试后成功

与基线对比（同一份 cases，diff 上一版）：
  edge_f1       0.88  (↑0.06)
  crossings     1.2   (↓0.8)
  一次通过率    58%   (↑11pp)
```

**"失败聚类"比总分更有价值**——它直接告诉你下一步该改什么。

### 4.6 人机回环（第 6 层，也是你说的重点）

这是 Doodle 独有、也是最难自动化的部分。建议拆成**三步递进**，不要一次做完：

**第一步：脚本化的人（可自动）**

用代码扮演"人"：在 AI 画完后，对板执行固定的修改——
移动一个卡片、改一个标签、删一条边——然后让 AI `get_board(since_revision)`。
判定：AI 的 `HANDOFF` 是否**正确识别了这次修改**（改的是哪个、改成了什么）。

这可以完全自动化，且是真正的双向性测试，现有测试里没有。

```jsonc
"human_action": { "type": "move", "label": "拣货", "dx": 200 },
"expect_ai": { "detects": ["拣货"], "continues": true }
```

**第二步：真实浏览器的人（半自动）**

用已有的浏览器自动化（`browser-contract.test.mjs` 已经会驱动画布）
执行真实的拖拽和编辑，截图，然后同样判定 AI 的读回。
好处是走真实 `POST /batch` 路径，能抓到画布投影层的 bug。

**第三步：真人（不可自动）**

一个最小的"人机接力"脚本：跑一个 case，打开画布给人看，
人改完按回车，脚本继续让 AI 读回。产出一份主观评分表
（可读性 1–5、AI 是否理解我的修改 是/否）。
**这一步只做季度抽检，不进 CI。**

## 5. 与现有测试的关系

| 现有 | 新评测 |
|---|---|
| 纯函数、无网络、毫秒级 | 真实模型、真实 MCP、分钟级 |
| 进 CI，每次提交必跑 | **不进默认 CI**，按需/夜间跑 |
| 断言精确输出 | 输出分布性指标 |
| 防回归 | 找方向 |

明确边界：**benchmark 不替代契约测试**。契约测试防"改坏"，
benchmark 答"哪种改法更好"。两者目标不同，不要混进同一个 suite。

## 6. 实施顺序（建议）

按"先能判分，再能跑模型"的顺序——判分器是纯的，可以先写、先测、先稳定。

1. **判分器 + 快照回放**（无模型，1–2 天）
   写 `node-structure` / `edge-f1` / `crossings` 几个纯函数，
   用手写的 board 快照做输入，完全可单元测试。**这一步不需要任何 API key。**
2. **trace 格式 + 回放器**
   定义 trace schema，写一个"从 trace 重算报告"的命令。
3. **执行器接入一个模型**
   先跑 3–5 个 case，确认能跑通，再看数字有没有意义。
4. **扩充 cases 到 30 个左右**，分四类。
5. **人机回环第一步**（脚本化的人）。
6. 视情况做 4.4 的 Layer C 和 4.6 第三步。

## 7. 几个容易踩的坑

- **别用像素比图**。理由见第 2 节。
- **别让语义判分进 CI**。它会漂移，而且"看起来对"不等于"结构对"。
- **别把重试算成失败**。模型看错误信息修好，正是 Doodle 设计目标的体现。
- **工具描述变了要重跑基线**。`tool_desc_hash` 变了，历史数字就不可比了。
- **每个 case 用独立 OUTPUT_DIR**。否则 `library` 的种子板会串味。
- **固定随机性**。模型 temperature、并发顺序、超时都要记进 trace。
- **成本要记账**。一次 30 case × 3 模型的跑批可能几十美元，报告里要有估算。

## 8. 未决问题

- 判分阈值定多少才算"通过"？建议先跑 20 次基线，取 P50 作为初始门禁。
- 语义判分用哪个模型？用被测模型判自己会偏向自己。
- `freeform` 类怎么判？暂时只判可读性下限，不判"内容对"。
- 是否需要保存 PNG？存储成本低、便于人审，建议保留但**不入分**。

## 9. 第一步已落地：判分器（`bench/graders/`）

设计里最容易空转的是"判分到底靠不靠谱"。所以先把**不需要 API key** 的那层做出来了，
它现在就是可用、可测的代码：

```
bench/graders/normalize.mjs   标签归一化与匹配
bench/graders/structure.mjs   节点 / 边 / 序列 / 树
bench/graders/geometry.mjs    交叉、穿卡片、密度、悬空连接
bench/graders/index.mjs       汇总成 score + checks + pass
bench/graders/graders.test.mjs 17 条测试
```

### 它已经能区分好坏

用真实 `draw_board.diagram` 生成的板做对照（`test` 里也有同样的断言）：

| 情形 | score | pass | 指出的问题 |
|---|---|---|---|
| 五步完整流程 | 1.00 | ✅ | — |
| 少画一步 | 0.89 | ❌ | `node_recall`, `edge_f1` |
| 中间两步顺序颠倒 | 0.66 | ❌ | `edge_f1` |
| 多画无关节点 | 0.98 | ❌ | `node_precision` |
| 链条断开 | 0.74 | ❌ | `edge_f1`, `sequence` |
| 箭头绑到不存在的对象 | 0.74 | ❌ | `dangling` |
| 空板 | 0.00 | ❌ | 全部 |

注意"顺序颠倒"拿到 0.66 而不是 0：节点都在、边也画了，只是有一对方向相反。
这正是想要的行为——**分数反映错误的严重程度，而不只是二元的对错**，
报告才能告诉你"差在哪"。

### 一个有意的设计取舍

`pass` 要求结构完全正确，但 **`crossings` / `density` 默认不导致失败**，
只有 case 显式写了 `expect.forbid` 才生效。理由：一张完全正确的流程图，
偶尔有一条线交叉，不应该被判定为"AI 画错了"——那是排版噪声，不是语义错误。
几何分数照常记录，供人看趋势，但不制造假阳性。

### 下一步

剩下的是 `4.2` 执行器和 `4.3` trace。执行器需要 API key 和成本预算，
建议先用手工 trace 回放验证报告链路，再接真实模型。

## 10. 第二、三步已落地：trace、报告、执行器

### trace 与报告（无成本，可重复）

```
bench/trace.mjs         trace 形状 + 校验 + 稳定的短哈希
bench/report.mjs        判分汇总、失败聚类、两次运行对比
bench/run-report.mjs    CLI：trace 目录 → Markdown / JSON 报告
bench/cases/core.json   3 个真实 case
bench/fixtures/         3 份示例 trace（由真实生成器造板，不调用模型）
```

报告的样子（对着 fixture 跑出来的真实输出）：

```
Cases: 3 · pass 33% · mean score 0.83

## Failure clusters
- edge_f1 — 2/3 cases (sequence 2)
- node_recall — 1/3 cases (sequence 1)
- sequence — 1/3 cases (sequence 1)

## Repair behaviour
1/3 cases saw at least one rejected call and continued.
These are repair successes, not failures.
```

「2/3 卡在 edge_f1」直接指向连接线生成，比「平均 0.83」有用得多。

两个刻意的保护：

- **trace 缺 `final_board` 直接报错**，不判成空板。"模型没画"和"记录器丢了板"
  是两种完全不同的结论，混在一起会污染均值。
- **prompt 或工具描述变了就拒绝给 delta**，并说明"这应当视为新基线"。
  否则会打印一个看着很确定、实际不可比的数字。

`1/3 需要重试` 被单独统计为**修复成功率**，不计入失败——模型看到 `ERROR_JSON`
改对，正是 Doodle 设计目标在起作用。

### 执行器（需要真实模型）

```
bench/executor.mjs      spawn `codex exec`、解析 JSONL 事件、写 trace
bench/run-cases.mjs     CLI：跑 case → traces/
```

执行器本身很薄，但做了三处隔离，每一处都是实测踩出来的：

1. **用临时空目录当工作区**。仓库自己的 `AGENTS.md` 有 48 KB，超过 Codex 的
   32 KB 项目指令预算，模型会收到截断版并花一个回合去注意这件事——那测的是
   仓库，不是绘图。
2. **`--ignore-user-config`**。本机装了一个无关的 doodle 插件，模型会先去读它的
   skill 文件再调工具。基准必须只看到被测的那个 server。
3. **每个 case 独立 `OUTPUT_DIR`**，否则 library 的种子板会串味。

### 一个值得记下来的坑

第一次跑批，trace 里 0 次工具调用、0 token，耗时 126 秒。看起来像"模型拒绝作画"。

实际原因是 `codex exec` 会等 stdin EOF 才发 prompt，而 `spawn` 用了
`stdio: "ignore"`，描述符永远不到 EOF，于是挂到超时。

修法是把 stdin 改成 `pipe` 然后立即 `end()`。同时加了一条守卫：
**没有工具调用且没有 usage 的 session 一律判为失败并说明原因**，
因为它只可能意味着请求没到达模型（网络/鉴权），而不是模型什么都没画。
这条守卫让"环境坏了"和"模型不行"在报告里永远不会混为一谈。

### 当前状态

`bench/graders` 17 条 + `bench/report` 15 条 + `bench/executor` 7 条测试，
共 39 条，全部不需要模型。真实跑批需要能访问模型的网络环境：

```
node bench/run-cases.mjs                 # 跑全部 case
node bench/run-report.mjs bench/runs/<时间戳>
```
