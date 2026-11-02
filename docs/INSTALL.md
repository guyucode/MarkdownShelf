# 安装文架 0.2.0 Preview

从 [GitHub 发行页](https://github.com/guyucode/MarkdownShelf/releases/tag/v0.2.0-preview.1) 下载与你的机型相符的安装包；源码 ZIP 不是安装程序。

- Apple Silicon Mac（M 系列）：打开 MarkdownShelf_0.2.0_aarch64.dmg，将 MarkdownShelf 拖到“应用程序”。暂不提供 Intel Mac 包。只有本地临时签名，无 Apple Developer ID 或公证；核对来源及 SHA-256，按系统正常提示处理，不关闭系统安全保护。
- Windows x64（Intel / AMD 64 位）：运行 MarkdownShelf_0.2.0_windows_x64_setup.exe，为当前用户安装。缺少 WebView2 时安装器需联网下载微软运行时。没有代码签名证书；核对来源与 SHA-256，不关闭安全保护。暂不提供 ARM 或32位包。

普通使用无需 Node.js、pnpm、Rust、模型或账号。首次打开点击“添加项目”，选择项目文件夹；左侧集中列出 Markdown，右侧阅读、编辑和新建。阅读后点击“设为项目必读”，切到“项目必读”看确认过的阅读清单。内容变动后仍保留身份并提示待复核，需重新阅读后手动确认。

更新前退出旧版，再替换应用或运行安装器。不要删除项目或应用数据；建议备份原项目、本机草稿与必读清单。文档始终保存在原位置；标记与设置在系统应用数据目录 markdown-shelf，草稿在本机 WebView 存储。

Mac 在 Apple Silicon / macOS 27 本机验证；Windows 在 Windows Server 2022 x64 云构建机进行测试、静默安装和原生启动验证，只有对应成功工作流才构成通过。Windows 10/11 物理设备、Intel Mac、其他系统版本未逐一验收。实际测试记录与限制见发行说明和附件。

自有修改继续使用 Apache-2.0，原作者及修改说明见 NOTICE；安装包 legal/dependencies 中包含目标平台的第三方声明、原始许可文本及适用的 MPL 源码。
