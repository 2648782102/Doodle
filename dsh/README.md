# DSH plugin bundle

This directory is the DeepSeek Harness plugin bundle for Doodle. Harness reads
`dsh/index.json` as a plugin-market index, and `dsh/` itself is an installable
bundle because `dsh/package.json` declares `dsh.bundle.patch`.

Add the index in Harness: **插件 → 发现 → 管理索引源 → 添加索引源**, then paste
the raw `index.json` URL for your branch or release. Install the Doodle entry,
then open a new session and ask the agent to open the board.

The bundle launches the published `doodle-mcp` CLI over stdio, so the server is
not vendored here and the launch does not depend on a checkout.

```text
package.json       bundle manifest with dsh.bundle.patch
cordis.patch.yml   one dsh-mcp-client entry for the doodle server
index.json         plugin-market index format 1
locale/            zh/en titles and descriptions
docs/DETAIL.md     long description shown on the entry page
icon.svg           entry artwork
```
