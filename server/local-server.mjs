import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runCodex, authStatus } from './codex-runner.mjs';
import { validateInput } from '../web/ai-contract.mjs';

export const application = 'business-lens-local-ai';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function createLocalServer({ analyze = runCodex, status = authStatus, htmlFile = path.join(root, 'index.html'), allowedOrigins = ['https://p6y6ww59m7-cloud.github.io'], onStop } = {}) {
  const token = randomBytes(32).toString('base64url');
  let active = null;
  const server = http.createServer(async (req, res) => {
    const address = server.address();
    const origin = `http://127.0.0.1:${address.port}`;
    for (const [key, value] of Object.entries({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer', 'Cross-Origin-Resource-Policy': 'same-origin' })) res.setHeader(key, value);
    const send = (code, value) => { if (!res.destroyed) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); } };
    if (req.headers.host !== `127.0.0.1:${address.port}`) return send(403, { error: '仅允许本机页面访问。' });
    const url = new URL(req.url, origin);
    if (req.method === 'GET' && url.pathname === '/health') return send(200, { application, version: 2 });
    if (req.method === 'GET' && url.pathname === '/connect') {
      const requestOrigin = url.searchParams.get('origin'), channel = url.searchParams.get('channel');
      if (!allowedOrigins.includes(requestOrigin) || !/^[a-zA-Z0-9_-]{20,120}$/.test(channel || '')) return send(403, { error: '只允许指定的生意透镜网页申请连接。' });
      try {
        const page = await readFile(path.join(root, 'server/consent-page.html'), 'utf8');
        const config = JSON.stringify({ requestOrigin, channel, token }).replaceAll('<', '\\u003c');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(page.replace('/*__CONNECTION_CONFIG__*/', () => config));
      } catch { send(503, { error: '本机确认页面无法读取，请重新下载连接程序。' }); }
      return;
    }
    if (req.method === 'GET' && url.pathname === '/') {
      try {
        const html = (await readFile(htmlFile, 'utf8')).replace('<meta name="business-session" content="">', `<meta name="business-session" content="${token}">`);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html);
      } catch { send(503, { error: 'HTML 文件还没生成，请先构建本地页面。' }); }
      return;
    }
    if (req.method === 'GET' && url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    if (!url.pathname.startsWith('/api/')) return send(404, { error: '页面不存在。' });
    const provided = req.headers['x-business-session'];
    const validToken = typeof provided === 'string' && Buffer.byteLength(provided) === Buffer.byteLength(token) && timingSafeEqual(Buffer.from(provided), Buffer.from(token));
    if (!validToken || req.headers.origin !== origin) return send(403, { error: '本机连接已变化，请刷新这个页面后重试。' });
    if (['GET', 'POST'].includes(req.method) && url.pathname === '/api/status') {
      try { send(200, { ...(await status()), busy: !!active }); } catch { send(200, { available: false, loggedIn: false, message: '连接检查失败，请稍后重试。' }); }
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/shutdown') {
      active?.abort(); send(200, { stopped: true });
      server.close(() => onStop?.()); return;
    }
    if (req.method !== 'POST' || url.pathname !== '/api/analyze') return send(404, { error: '操作不存在。' });
    if (!req.headers['content-type']?.startsWith('application/json')) return send(415, { error: '请选择有效的业务资料。' });
    if (active) return send(409, { error: '已有一份分析正在进行，请等待完成或取消。' });
    let input;
    try {
      let size = 0; const buffers = [];
      for await (const data of req) { size += data.length; if (size > 1_200_000) { send(413, { error: '资料太多，请精简后再试。' }); return; } buffers.push(data); }
      input = validateInput(JSON.parse(Buffer.concat(buffers).toString('utf8')));
    } catch (error) { return send(400, { error: error instanceof SyntaxError ? '资料格式不正确。' : error.message }); }
    // Parsing is asynchronous: recheck so two simultaneous requests cannot both launch.
    if (active) return send(409, { error: '已有一份分析正在进行，请等待完成或取消。' });
    const controller = new AbortController(); active = controller;
    const disconnected = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', disconnected);
    try {
      const report = await analyze(input, { signal: controller.signal });
      send(200, { report });
    } catch (error) { send(502, { error: error.message || '分析未完成，请重试。' }); }
    finally { res.removeListener('close', disconnected); if (active === controller) active = null; }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  server.on('close', () => active?.abort());
  return server;
}
export async function startServer({ port = 49321, ...options } = {}) {
  const server = createLocalServer(options);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return { server, url: `http://127.0.0.1:${server.address().port}/` };
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    let running;
    try { running = await startServer({ port: Number(process.env.BUSINESS_PORT || 49321), onStop: () => process.exit(0) }); }
    catch (error) { if (error.code !== 'EADDRINUSE') throw error; running = await startServer({ port: 0, onStop: () => process.exit(0) }); }
    const { server, url } = running;
    console.log(JSON.stringify({ application, url, pid: process.pid }));
    for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { server.closeAllConnections(); server.close(() => process.exit(0)); });
  } catch (error) { console.error(error.code === 'EADDRINUSE' ? '本机连接已在运行，或端口被其他程序占用。' : error.message); process.exitCode = 1; }
}
