#!/bin/zsh
set -e
cd -- "${0:A:h}"
app_path="$PWD/src-tauri/target/release/bundle/macos/MarkdownShelf.app"
if [[ ! -d "$app_path" ]]; then
  print '尚未构建文架。请先在项目目录运行：pnpm tauri build --bundles app'
  read -r '?按回车退出。'
  exit 1
fi
/usr/bin/open "$app_path"
