#!/bin/zsh
set -e
BUSINESS_TOOL_DIR="${0:A:h}"
BUSINESS_NODE=$(command -v node || true)
if [[ -z "$BUSINESS_NODE" ]]; then
  for BUSINESS_CANDIDATE in /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
    if [[ -x "$BUSINESS_CANDIDATE" ]]; then BUSINESS_NODE="$BUSINESS_CANDIDATE"; break; fi
  done
fi
if [[ -z "$BUSINESS_NODE" ]]; then
  print '未找到 Node.js，请先安装或联系我处理。'
  read -k 1 '?按任意键关闭。'
  exit 1
fi
exec "$BUSINESS_NODE" "$BUSINESS_TOOL_DIR/server/launch.mjs"
