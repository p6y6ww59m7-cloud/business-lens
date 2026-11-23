import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../server/local-server.mjs';
import { sampleReport } from './ai-fixture.mjs';

async function setup(t, analyze) {
  const { server, url } = await startServer({ port: 0, analyze, status: async () => ({ available: true, loggedIn: true, message: 'test' }) });
  t.after(() => { server.closeAllConnections(); server.close(); });
  const html = await (await fetch(url)).text();
  const token = html.match(/<meta name="business-session" content="([^"]+)">/)?.[1];
  assert.ok(token); assert.equal(server.address().address, '127.0.0.1');
  const headers = { Origin: url.slice(0, -1), 'Content-Type': 'application/json', 'X-Business-Session': token };
  return { server, url, token, headers };
}
test('only the local authenticated page can invoke the model', async t => {
  let calls = 0;
  const { url, token, headers } = await setup(t, async () => { calls++; return sampleReport(); });
  for (const h of [{ ...headers, Origin: 'https://example.com' }, { ...headers, 'X-Business-Session': '' }, { ...headers, 'X-Business-Session': 'é'.repeat(token.length) }]) {
    assert.equal((await fetch(url + 'api/analyze', { method: 'POST', headers: h, body: '{"brief":"摄影课"}' })).status, 403);
  }
  assert.equal(calls, 0);
  const response = await fetch(url + 'api/analyze', { method: 'POST', headers, body: '{"brief":"摄影课"}' });
  assert.equal(response.status, 200); assert.equal(calls, 1);
  assert.equal(Object.keys((await response.json()).report.sections).length, 9);
});
test('malformed requests never start a model run; status remains usable', async t => {
  let calls = 0;
  const { url, headers } = await setup(t, async () => { calls++; return sampleReport(); });
  assert.equal((await fetch(url + 'api/analyze', { method: 'POST', headers, body: 'broken' })).status, 400);
  assert.equal((await fetch(url + 'api/analyze', { method: 'POST', headers, body: '{}' })).status, 400);
  const status = await fetch(url + 'api/status', { method: 'POST', headers, body: '{}' });
  assert.equal((await status.json()).loggedIn, true); assert.equal(calls, 0);
  assert.equal((await fetch(url + '../anything')).status, 404);
});
test('authorization popup only serves the approved website and never grants access on page load', async t => {
  let calls=0;const {url}=await setup(t,async()=>{calls++;return sampleReport();});
  const channel='12345678-1234-1234-1234-123456789abc';
  const valid=new URL('connect',url);valid.searchParams.set('origin','https://p6y6ww59m7-cloud.github.io');valid.searchParams.set('channel',channel);
  const response=await fetch(valid);assert.equal(response.status,200);
  assert.equal(response.headers.get('access-control-allow-origin'),null);
  assert.equal(response.headers.get('x-frame-options'),'DENY');
  const page=await response.text();assert.match(page,/允许连接此电脑的 Codex/);assert.match(page,/if\(!approved\|\|event.source/);
  valid.searchParams.set('origin','https://untrusted.example');assert.equal((await fetch(valid)).status,403);
  assert.equal(calls,0);
});
test('one active analysis prevents duplicate quota-consuming submissions', async t => {
  let release, started;
  const entered = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const { url, headers } = await setup(t, async () => { started(); await gate; return sampleReport(); });
  const first = fetch(url + 'api/analyze', { method: 'POST', headers, body: '{"brief":"摄影课"}' });
  await entered;
  const second = await fetch(url + 'api/analyze', { method: 'POST', headers, body: '{"brief":"摄影课"}' });
  assert.equal(second.status, 409); release(); assert.equal((await first).status, 200);
});
test('cancelled browser request aborts the underlying analysis', async t => {
  let started, aborted;
  const entered = new Promise(resolve => { started = resolve; });
  const stopped = new Promise(resolve => { aborted = resolve; });
  const { url, headers } = await setup(t, async (_, { signal }) => { started(); await new Promise((_, reject) => signal.addEventListener('abort', () => { aborted(); reject(new Error('cancelled')); }, { once: true })); });
  const controller = new AbortController();
  const request = fetch(url + 'api/analyze', { method: 'POST', headers, body: '{"brief":"摄影课"}', signal: controller.signal });
  await entered; controller.abort(); await assert.rejects(request); await stopped;
});
