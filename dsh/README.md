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

## Install

1. In Harness open **插件 → 发现**, choose **管理索引源… → 添加索引源**, and paste:

   ```
   https://raw.githubusercontent.com/2648782102/Doodle/master/dsh/index.json
   ```

2. Install the **Doodle 双向画板** entry. The index points at a pinned commit of
   this repository, so Harness fetches `dsh/` from Git instead of npm.
3. Open a new session and ask: 「用 mcp__doodle__get_board 读一次画板」.

## Publishing notes

- `dsh/index.json` is format 1 and was validated with the Harness
  `@deepseek-ai/dsh-plugin-market-index` parser.
- The npm package name `dsh-doodle` was already taken on the public registry, so
  this bundle installs from Git. Bump `version` here and in `dsh/package.json`,
  commit, then update `versions[0].source.commit` in `dsh/index.json`.
- `doodle-mcp` itself is published on npm; the bundle launches
  `doodle-mcp@0.8.0` through `npx` so the server is not vendored twice.
