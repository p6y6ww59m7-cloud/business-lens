import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, open } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const support = path.join(os.homedir(), 'Library/Application Support/生意透镜HTML');
await mkdir(support, { recursive: true, mode: 0o700 });
const infoFile = path.join(support, 'connection.json');
async function healthy(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== '127.0.0.1' || parsed.protocol !== 'http:') return false;
    const response = await fetch(new URL('/health', parsed), { signal: AbortSignal.timeout(1500) });
    const info = await response.json();
    return info.application === 'business-lens-local-ai' && info.version >= 3;
  } catch { return false; }
}
let url;
try { const info = JSON.parse(await readFile(infoFile, 'utf8')); if (await healthy(info.url)) url = info.url; } catch {}
if (!url) {
  const log = await open(path.join(support, 'connection.log'), 'a', 0o600);
  const child = spawn(process.execPath, [fileURLToPath(new URL('./local-server.mjs', import.meta.url))], { detached: true, stdio: ['ignore', 'pipe', log.fd], env: { ...process.env, BUSINESS_PORT: '49321' } });
  let buffer = '';
  url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('本机连接启动超时。')); }, 10000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', code => { clearTimeout(timer); if (!url) reject(new Error(`本机连接未能启动（${code}）。`)); });
    child.stdout.on('data', data => {
      buffer += data;
      const line = buffer.split('\n')[0];
      try { const info = JSON.parse(line); if (info.application && info.url) { clearTimeout(timer); resolve(info.url); } } catch {}
    });
  });
  child.stdout.destroy(); child.unref(); await log.close();
  await writeFile(infoFile, JSON.stringify({ url }), { mode: 0o600 });
}
console.log('生意透镜已启动。页面会使用本机已登录的 Codex 完成分析。');
console.log(url);
if (!process.argv.includes('--no-open')) {
  const command = process.platform === 'darwin' ? '/usr/bin/open' : process.platform === 'win32' ? 'rundll32.exe' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', url] : [url];
  const browser = spawn(command, args, { detached: true, stdio: 'ignore' });
  browser.on('error', () => console.log('请在浏览器打开上面的本机地址。')); browser.unref();
}
