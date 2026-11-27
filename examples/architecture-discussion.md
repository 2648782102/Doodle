# 用 Doodle 讨论仓库架构

适用于已连接 Doodle MCP 或安装 Codex 插件的仓库。先在宿主对话里发送这句话：

> 帮我看一下这个仓库的架构，先画出主要模块和有依据的调用关系，我们一起在图上修正。

English:

> Help me understand this repository's architecture. Draw the main modules and only the relationships supported by evidence; then let's correct the map together on the board.

## 讨论流程

`get_board` → `scan_project` → `draw_board.diagram` → 人在图上修正 → `HANDOFF` → AI 精确续画。

1. AI 先用 `get_board` 读取现有画板，再用 `scan_project` 查看有界的工作区目录、相对路径和 `file:line` 证据。扫描只读，不会修改仓库。
2. AI 根据职责挑选少量主要模块，用 `draw_board.diagram` 画出初稿。每条关系都要按证据实际支持的含义标注：import 证据只确认 import 关系，除非还有调用点证据，否则不要称为运行时调用。目录相邻、名称相似或猜测出来的关系应作为问题标在图上，不能画成已确认的依赖。
3. AI 在有人想一起查看时调用 `show_board`，并让画布保持可见。你可以直接改节点名称或位置、删除不准确的节点/连线，或者新增便签说明缺失的模块和约束。
4. 初稿画完后，AI 保留 `draw_board` 返回的 revision 作为基线。AI 读取你的最终修改并在聊天里回应，然后用精确更新或新增对象继续修改图。支持画布上下文同步的宿主会提供最新终态；纯文本宿主或独立 `PANEL_URL` 页面则请 AI 用你正在修正的那版画板的 revision（通常是上次 `draw_board` 返回的 revision）调用 `get_board.since_revision`。

## 你可以这样继续

- “把这个模块名改得准确一点，并保留我移动后的位置。”
- “这条依赖不对，我已经删掉了；先不要画回来。”
- “补上缓存模块，但它和数据层的关系还没确认，请标成问题。”
- “结合图里的证据解释请求从入口到存储的路径。”

## 边界

扫描证据有界；仓库太大或结果被截断时，让 AI 说明缺失范围，再决定是否调整扫描范围。画板只是可讨论的上下文，不代表项目变更授权，也不会写入或修改项目文件。The board is context only; it never writes or changes project files. 若需要改代码，请在宿主聊天里单独提出具体代码任务。
