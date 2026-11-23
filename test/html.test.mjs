import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM, VirtualConsole } from 'jsdom';
import { sampleReport } from './ai-fixture.mjs';

const html = await readFile(new URL('../build/生意透镜.html', import.meta.url), 'utf8');
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
function setup(t, { file = false, replies = [], autoGrant = !file } = {}) {
  const requests = [], downloads = [], errors = [];
  const console = new VirtualConsole(); console.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM(file ? html : html.replace('<meta name="business-session" content="">', '<meta name="business-session" content="test-session">'), {
    url: file ? 'file:///tmp/生意透镜.html' : 'http://127.0.0.1:49321/', runScripts: 'dangerously', virtualConsole: console,
    beforeParse(window) {
      window.scrollTo = () => {}; window.confirm = () => true; window.Blob = Blob;
      window.URL.createObjectURL = blob => { downloads.push({ blob }); return 'blob:test'; };
      window.URL.revokeObjectURL = () => {};
      window.HTMLAnchorElement.prototype.click = function () { downloads.at(-1).filename = this.download; };
      window.fetch = async (url, options) => {
        if (url.endsWith('/status')) return Response.json({ loggedIn: true, message: '已连接本机 Codex' });
        if (url.endsWith('/analyze')) {
          requests.push(JSON.parse(options.body));
          const next = replies.shift();
          if (next instanceof Error) throw next;
          const report = { ...structuredClone(next || sampleReport()), mode: 'ai', generatedAt: new Date().toISOString() };
          return Response.json({ report });
        }
        throw new Error('Unexpected request ' + url);
      };
    }
  });
  t.after(() => dom.window.close());
  if (autoGrant) dom.window.document.querySelector('[data-action="allow-connect"]').click();
  return { window: dom.window, document: dom.window.document, requests, downloads, errors };
}
function input(ui, selector, text) {
  const field = ui.document.querySelector(selector); field.value = text;
  field.dispatchEvent(new ui.window.Event('input', { bubbles: true }));
}
function click(ui, action) { ui.document.querySelector(`[data-action="${action}"]`).click(); }
test('file is standalone and honestly explains how to connect AI', async t => {
  const ui = setup(t, { file: true }); await settle();
  assert.equal(ui.document.querySelectorAll('#frameworkPreview [data-module]').length, 9);
  assert.equal(ui.document.querySelectorAll('script[src],link[rel="stylesheet"]').length, 0);
  assert.equal(ui.document.querySelector('#fileInstructions').hidden, false);
  assert.match(ui.document.body.textContent, /启动生意透镜.command/);
  assert.equal(ui.requests.length, 0); assert.equal(ui.errors.length, 0);
});
test('every new page asks permission before reading local login or invoking AI', async t => {
  for (let i=0;i<2;i++) {
    const ui=setup(t,{autoGrant:false});await settle();
    assert.equal(ui.document.querySelector('#consentDialog').open,true);
    assert.equal(ui.requests.length,0);
    input(ui,'#businessIntro','摄影课');click(ui,'analyze');await settle();
    assert.equal(ui.requests.length,0);
    click(ui,'allow-connect');await settle();click(ui,'analyze');await settle();await settle();
    assert.equal(ui.requests.length,1);
  }
});
test('standalone file can show the complete real-AI demo without calling a model', async t => {
  const ui = setup(t, { file: true }); await settle(); click(ui, 'demo'); await settle();
  assert.equal(ui.document.querySelectorAll('#reportContent [data-module]').length, 9);
  assert.equal(ui.document.querySelector('#demoNotice').hidden, false);
  assert.match(ui.document.querySelector('#reportContent').textContent, /832/);
  assert.equal(ui.requests.length, 0); assert.equal(ui.errors.length, 0);
});
test('one introduction produces nine modules; answering a follow-up updates the AI report', async t => {
  const first = sampleReport(), final = sampleReport(); final.status = 'ready'; final.questions = []; final.summary = '根据补充的杭州线下情况更新。';
  const ui = setup(t, { replies: [first, final] }); await settle();
  input(ui, '#businessIntro', '给上班族做手机摄影课，每次399元。'); click(ui, 'analyze'); await settle(); await settle();
  assert.equal(ui.requests.length, 1);
  assert.equal(ui.document.querySelectorAll('#reportContent [data-module]').length, 9);
  assert.equal(ui.document.querySelector('#questionsPanel').hidden, false);
  assert.match(ui.document.querySelector('#reportContent').textContent, /消费心理账户/);
  input(ui, '[data-answer="city"]', '在杭州做线下小班。'); click(ui, 'continue-ai'); await settle(); await settle();
  assert.deepEqual(ui.requests[1].answers, [{ question: '在哪个城市上课？', answer: '在杭州做线下小班。' }]);
  assert.equal(ui.document.querySelector('#questionsPanel').hidden, true);
  assert.match(ui.document.querySelector('#reportContent').textContent, /根据补充的杭州/);
  assert.equal(ui.errors.length, 0);
});
test('untrusted report text is inert, and downloaded HTML contains all nine modules without scripts', async t => {
  const report = sampleReport(); report.status = 'ready'; report.questions = [];
  report.sections.account.answer = '<img src=x onerror="window.wasInjected=1">客户原话';
  const ui = setup(t, { replies: [report] }); await settle();
  input(ui, '#businessIntro', '手机摄影课'); click(ui, 'analyze'); await settle(); await settle();
  assert.equal(ui.window.wasInjected, undefined);
  assert.equal(ui.document.querySelector('#reportContent img'), null);
  click(ui, 'save-report'); await settle();
  assert.equal(ui.downloads.length, 1); assert.match(ui.downloads[0].filename, /\.html$/);
  const saved = new JSDOM(await ui.downloads[0].blob.text());
  assert.equal(saved.window.document.querySelectorAll('[data-module]').length, 9);
  assert.equal(saved.window.document.querySelectorAll('script,button,link[rel="stylesheet"]').length, 0);
  for (const label of ['广告商单', '线上成交', '线索获客', '自媒体', '本地生活', '电商', '知识付费', '解决方案']) assert.ok(saved.window.document.body.textContent.includes(label));
  assert.match(saved.window.document.body.textContent, /<img src=x/);
  saved.window.close();
});
test('editing the brief invalidates export, and a failed retry retains the previous report', async t => {
  const ui = setup(t, { replies: [sampleReport(), new Error('网络断开')] }); await settle();
  input(ui, '#businessIntro', '手机摄影课'); click(ui, 'analyze'); await settle(); await settle();
  input(ui, '#businessIntro', '修改后的摄影课');
  click(ui, 'save-report'); await settle(); assert.equal(ui.downloads.length, 0);
  click(ui, 'analyze'); await settle(); await settle();
  assert.match(ui.document.querySelector('#warning').textContent, /网络断开/);
  assert.equal(ui.document.querySelectorAll('#reportContent [data-module]').length, 9);
  assert.match(ui.document.querySelector('#reportContent').textContent, /资料有变化|业务资料有变化/);
});
