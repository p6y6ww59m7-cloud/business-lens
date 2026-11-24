import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let html = await readFile(path.join(root, 'web/template.html'), 'utf8');
for (const [token, file] of [['STYLE', 'web/style.css'], ['ENGINE', 'public/engine.js'], ['LOGIC', 'web/logic.js'], ['DEMO', 'web/example-report.json'], ['CONNECTION', 'web/connection.js'], ['APP', 'web/app.js']]) {
  let source = await readFile(path.join(root, file), 'utf8');
  if (token === 'STYLE') source += '\n' + await readFile(path.join(root, 'web/ai-style.css'), 'utf8');
  if (token === 'STYLE') source += '\n' + await readFile(path.join(root, 'web/clean-style.css'), 'utf8');
  if (token === 'DEMO') source = 'globalThis.BusinessDemo = ' + JSON.stringify(JSON.parse(source)).replaceAll('<', '\\u003c') + ';';
  source = source.replace(/<\/script/gi, '<\\/script');
  html = html.replace(`/*__${token}__*/`, () => source);
}
if (/\/\*__[A-Z]+__\*\//.test(html)) throw new Error('构建仍有未替换内容。');
await mkdir(path.join(root, 'build'), { recursive: true });
await writeFile(path.join(root, 'build/生意透镜.html'), html);
const standalone = path.join(root, 'index.html');
await writeFile(standalone, html);
await mkdir(path.join(root, 'docs'), { recursive: true });
await writeFile(path.join(root, 'docs/index.html'), html);
await writeFile(path.join(root, 'docs/.nojekyll'), '');
const launcher = path.join(root, '启动生意透镜.command');
function launchScript(relativePath) { return `#!/bin/zsh
set -e
BUSINESS_TOOL_DIR="\${0:A:h}"
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
exec "$BUSINESS_NODE" "$BUSINESS_TOOL_DIR/${relativePath}"
`; }
await writeFile(launcher, launchScript('server/launch.mjs'));
await chmod(launcher, 0o755);
await writeFile(path.join(root, '启动生意透镜.cmd'), '@echo off\r\nchcp 65001 >nul\r\nwhere node >nul 2>&1\r\nif errorlevel 1 (\r\n  echo 请先安装 Node.js，然后重新打开本文件。\r\n  pause\r\n  exit /b 1\r\n)\r\nnode "%~dp0server\\launch.mjs"\r\n');
if (process.argv.includes('--desktop-copies')) {
  await writeFile(path.resolve(root, '../生意透镜.html'), html);
  const desktopLauncher = path.resolve(root, '../启动生意透镜.command');
  await writeFile(desktopLauncher, launchScript('business-lens/server/launch.mjs'));
  await chmod(desktopLauncher, 0o755);
}
console.log(JSON.stringify({ html: standalone, launcher, bytes: Buffer.byteLength(html) }));
