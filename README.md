# 文架 · MarkdownShelf

独立于 CodeTrail 的本地 Markdown 文档书架与写作器，基于 Marky 修改。

打开多个项目，集中看最近更新的 Markdown。左侧只有文档列表，右侧阅读正文或编辑；不移动原文件，不需要账号、模型或云服务。

当前版本 **0.2.0 · Mac 本地预览**。这里提供源码和开发步骤，尚未发布可直接下载的安装包。

## 项目必读

自动收集的文档仍全部保留；“最近修改”只表示磁盘更新时间，不等于内容当前有效。

1. 打开文档阅读，在正文上方点击 **设为项目必读**。每个项目可指定多篇。
2. 左侧切换 **全部 / 项目必读**，继续使用项目筛选和文件名/路径搜索。
3. 必读文档内容变化后标记为 **待复核**。重新阅读当前版本，再点 **确认更新**；打开文档或保存自己的编辑不会自动确认。
4. **移出必读**只移除标记，不删除、不移动、不改写 Markdown 文件。

标记以项目路径、文档路径和人工确认时的 SHA-256 保存在本机应用数据目录 `markdown-shelf/required-reading.json`，与原文、草稿和排序分开。按内容摘要比较，不凭修改时间认定有效。重启保留标记；移除项目后保留记录，重新添加相同路径可恢复；项目或文档改名不自动迁移。文件丢失或无法读取时不自动清除历史标记。此清单是你的阅读选择，不是软件认证的正确版本，也不会上传到 GitHub。

## 使用

- 点击左上角“添加项目”，选择项目文件夹。重启后保留这些项目。
- 默认按磁盘最后修改时间排列，支持项目筛选和文件名/路径搜索。“最近修改”不代表文档内容一定有效或已被采纳。
- 点击文档阅读；点击“编辑”进入 Markdown 源文编辑，点“保存”或按 ⌘S 写回原文件。
- 点击“新建”（⌘N），选择项目并填写文件名，缺省补 `.md`。第一版新文档保存在项目根目录，不覆盖同名文件。
- 未保存内容留在本机草稿中，切换文档或重启后可以恢复。返回阅读并放弃草稿时会询问。
- Agent 修改文件时，阅读模式刷新正文；有未保存编辑时保留草稿并提示冲突，不提供静默强制覆盖。可先复制草稿，再重新读取原文件。
- 从书架移除项目不会删除原文件或草稿。

## 范围

递归收集 `.md`、`.markdown`、`.mdx`，尊重项目 `.gitignore`；跳过 `.git`、依赖和常见构建/缓存目录。包含未被忽略的 `.claude` 等隐藏文档目录。MDX 作为 Markdown 阅读，不执行其组件代码。正文搜索、AI 总结、云同步和知识图谱不在第一版范围内。

普通文档读取和编辑限制 5 MB，要求 UTF-8。项目路径变动后需重新添加。写回使用版本摘要检查与同目录临时文件替换，可检测通常的并发修改，但不承诺与所有外部编辑器组成跨进程事务。仅验证本机 Apple Silicon Mac，其他平台未验收。

## 开发

需要 Node.js、pnpm、Rust stable 和 Mac Command Line Tools。

```sh
pnpm install
pnpm test
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml --locked
pnpm test:ui
pnpm tauri dev
pnpm tauri build --bundles app
```

本机开发端口 1430，与 CodeTrail 分开。项目设置保存在系统应用数据目录 `markdown-shelf/settings.json`，草稿保存在该应用的本机 WebView 存储。原文件仍在各项目内。

## 原项目与许可

保留原 [Apache-2.0 LICENSE](LICENSE)。来源、固定版本及修改说明见 [NOTICE](NOTICE)。原项目说明保留在 [docs/UPSTREAM_README.md](docs/UPSTREAM_README.md)。未复制 mdviewer 源码；第三方依赖继续遵守各自许可。源码仓库：[guyucode/MarkdownShelf](https://github.com/guyucode/MarkdownShelf)。保留上游历史与许可；用户项目、必读标记和草稿不提交仓库。上游自动发布脚本归档在 `docs/upstream/marky-release.yml`，未启用它向 Marky 或 Homebrew 发布。

本机测试及原生验收范围见 [docs/VALIDATION.md](docs/VALIDATION.md)。
