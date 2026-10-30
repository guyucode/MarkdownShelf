# 文架 · MarkdownShelf

独立于 CodeTrail 的本地 Markdown 文档书架与写作器，基于 Marky 修改。

打开多个项目，集中看最近更新的 Markdown。左侧只有文档列表，右侧阅读正文或编辑；不移动原文件，不需要账号、模型或云服务。

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

保留原 [Apache-2.0 LICENSE](LICENSE)。来源、固定版本及修改说明见 [NOTICE](NOTICE)。原项目说明保留在 [docs/UPSTREAM_README.md](docs/UPSTREAM_README.md)。未复制 mdviewer 源码；第三方依赖继续遵守各自许可。此版本仅用于本机验证，没有发布或配置 GitHub 远程仓库。

本机测试及原生验收范围见 [docs/VALIDATION.md](docs/VALIDATION.md)。
