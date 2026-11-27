# 用 Doodle 讨论仓库架构

适用于已连接 Doodle MCP 或安装 Codex 插件的仓库。先在宿主对话里发送这句话：

> 请把对话中已经讨论的架构画到 Doodle 上，我们一起修正。

English:

> Draw the architecture we have discussed on Doodle so we can correct the map together.

## 职责边界

Doodle **只负责共同绘画**：读取、展示和修改共享画布。它不扫描仓库、不读取源文件；请基于对话中已有的信息绘图。

## 讨论流程

讨论中的架构信息 → `get_board` → `draw_board.diagram` → `show_board` → 人在图上修正 → `HANDOFF` → AI 精确续画。

1. 从当前对话中整理少量主要模块、关系，以及仍不确定的问题。只画已经提供的信息；不要声称 Doodle 验证过仓库内容。
2. AI 用 `get_board` 读取现有画布，再用 `draw_board.diagram` 将讨论过的架构信息画成初稿。把已确认事实与推测区分开；不确定的关系画成问题，不要冒充确定结论。
3. AI 在有人想一起查看时调用 `show_board`，并让画布保持可见。你可以直接改节点名称或位置、删除不准确的节点/连线，或者新增便签说明缺失的模块和约束。
4. 初稿画完后，AI 保留 `draw_board` 返回的 revision 作为基线。AI 读取你的最终修改并在聊天里回应，然后用精确更新或新增对象继续修改图。支持画布上下文同步的宿主会提供最新终态；纯文本宿主或独立 `PANEL_URL` 页面则请 AI 用你正在修正的那版画板的 revision（通常是上次 `draw_board` 返回的 revision）调用 `get_board.since_revision`。

## 你可以这样继续

- “把这个模块名改得准确一点，并保留我移动后的位置。”
- “这条关系不对，我已经删掉了；先不要画回来。”
- “补上缓存模块，但它和数据层的关系还没确认，请标成问题。”
- “结合图里的内容解释请求从入口到存储的路径。”

## 边界

Doodle 只处理共享画布，不读取或修改仓库文件，也不授予代码变更权限。
