import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { schema, buildPrompt, validateReport } from '../web/ai-contract.mjs';

export function findCodex() {
  const discovered = spawnSync(process.platform === 'win32' ? 'where.exe' : '/usr/bin/which', ['codex'], { encoding: 'utf8' }).stdout?.trim().split(/\r?\n/)[0];
  const choices = [process.env.BUSINESS_CODEX, discovered, '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex', '/Applications/Codex.app/Contents/Resources/codex'];
  const selected = choices.find(value => value && path.isAbsolute(value) && existsSync(value));
  if (selected && /\.(cmd|bat)$/i.test(selected)) {
    const entry = path.join(path.dirname(selected), 'node_modules/@openai/codex/bin/codex.js');
    return existsSync(entry) ? entry : null;
  }
  return selected || null;
}
function command(binary, args) { return /\.m?js$/i.test(binary) ? { file: process.execPath, args: [binary, ...args] } : { file: binary, args }; }
function environment() {
  const env = {};
  for (const key of ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'SystemRoot', 'COMSPEC', 'PATHEXT', 'CODEX_HOME', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy']) if (process.env[key]) env[key] = process.env[key];
  return env;
}
export function authStatus(binary = findCodex()) {
  if (!binary) return Promise.resolve({ available: false, loggedIn: false, message: '未找到本机 Codex。请先打开 Codex 并登录。' });
  return new Promise(resolve => {
    const cmd = command(binary, ['login', 'status']);
    const child = spawn(cmd.file, cmd.args, { env: environment(), stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', value => { output += value.toString().slice(0, 3000); });
    child.stderr.on('data', value => { output += value.toString().slice(0, 3000); });
    child.on('error', () => resolve({ available: false, loggedIn: false, message: '本机 Codex 暂时无法启动。' }));
    child.on('close', code => {
      const loggedIn = code === 0 && /logged in/i.test(output);
      resolve({ available: true, loggedIn, message: loggedIn ? '已连接本机 Codex 登录' : '请先在 Codex 里完成登录，再回到这里重试。' });
    });
    const timer = setTimeout(() => child.kill('SIGTERM'), 10000);
    child.on('close', () => clearTimeout(timer));
  });
}
export async function runCodex(input, { signal, binary = findCodex(), timeout = 360000 } = {}) {
  if (!binary) throw new Error('未找到本机 Codex，请先安装并登录。');
  if (signal?.aborted) throw new Error('已取消分析。');
  const prompt = buildPrompt(input);
  const work = await mkdtemp(path.join(os.tmpdir(), 'business-lens-analysis-'));
  try {
    const schemaFile = path.join(work, 'schema.json'), outputFile = path.join(work, 'report.json');
    await writeFile(schemaFile, JSON.stringify(schema), { mode: 0o600 });
    const args = ['--no-daemon', '--search', '--ask-for-approval', 'never', 'exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only', '--color', 'never', '--json', '-c', 'project_doc_max_bytes=0', '-c', 'features.skip_host_skill_discovery=true'];
    for (const feature of ['shell_tool', 'apps', 'browser_use', 'computer_use', 'plugins', 'memories', 'multi_agent', 'multi_agent_v2', 'hooks', 'image_generation', 'view_image', 'goals']) args.push('--disable', feature);
    args.push('--output-schema', schemaFile, '--output-last-message', outputFile, '-');
    await new Promise((resolve, reject) => {
      const cmd = command(binary, args);
      const child = spawn(cmd.file, cmd.args, { cwd: work, env: environment(), stdio: ['pipe', 'pipe', 'pipe'] });
      let timedOut = false, errorText = '', outSize = 0;
      const stop = () => child.kill('SIGTERM');
      signal?.addEventListener('abort', stop, { once: true });
      if (signal?.aborted) stop();
      const timer = setTimeout(() => { timedOut = true; stop(); }, timeout);
      child.stdout.on('data', data => { outSize += data.length; if (outSize > 12_000_000) stop(); });
      child.stderr.on('data', data => { errorText = (errorText + data).slice(-8000); });
      child.stdin.on('error', () => {});
      child.on('error', () => reject(new Error('Codex 未能启动，请检查本机安装。')));
      child.on('close', code => {
        clearTimeout(timer); signal?.removeEventListener('abort', stop);
        if (signal?.aborted) return reject(new Error('已取消分析。'));
        if (timedOut) return reject(new Error('这次分析等待较久，已停止。可以精简资料后重试。'));
        if (code !== 0) {
          const message = /unauthorized|login|sign.in|authentication|401/i.test(errorText) ? 'Codex 登录可能已失效，请打开 Codex 重新登录。' : /usage.limit|rate.limit|quota|429/i.test(errorText) ? 'Codex 当前使用额度或请求频率受限，请稍后再试。' : 'Codex 没有完成分析，请检查网络和登录状态后重试。';
          return reject(new Error(message));
        }
        resolve();
      });
      child.stdin.end(prompt);
    });
    const data = await readFile(outputFile, 'utf8');
    if (data.length > 3_000_000) throw new Error('报告过长，请精简业务资料后重试。');
    let value;
    try { value = JSON.parse(data); validateReport(value); }
    catch { throw new Error('AI 这次没有返回完整的九项报告，请重试。'); }
    return { ...value, mode: 'ai', reportVersion: 3, generatedAt: new Date().toISOString() };
  } finally { await rm(work, { recursive: true, force: true }); }
}
