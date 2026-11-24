(function () {
  'use strict';
  const S = globalThis.SimpleBusiness;
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const state = { project: { brief: '', goal: '', evidence: '', answers: [], demo: false }, report: null, pendingAnswers: {}, view: 'form', connected: false, busy: false, controller: null, storageOK: true };
  const storageKey = 'business-lens-ai-html-v1';
  const session = document.querySelector('meta[name="business-session"]')?.content || '';
  const fileMode = location.protocol === 'file:';
  const connection = globalThis.BusinessConnection.create({ token: session, onChange: info => {
    state.connected = info.connected;
    const label = $('#connectionStatus'); label.textContent = info.message; label.className = 'connection ' + (info.connected ? 'online' : 'offline');
    if (info.waiting) $('#fileInstructions').hidden = false;
  } });
  let saveTimer, toastTimer;
  const fingerprint = project => JSON.stringify(project);
  const safeURL = value => {
    try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; }
  };
  function toast(message) { const node = $('#toast'); node.textContent = message; node.classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => node.classList.remove('visible'), 5000); }
  function warning(message) { $('#warning').textContent = message; $('#warning').hidden = !message; }
  function saveLocal() {
    clearTimeout(saveTimer);
    try {
      localStorage.setItem(storageKey, JSON.stringify({ format: storageKey, project: state.project, report: state.report, pendingAnswers: state.pendingAnswers }));
      $('#saveStatus').textContent = '已暂存到当前浏览器，建议保存资料备份。'; state.storageOK = true;
    } catch { $('#saveStatus').textContent = '浏览器未能暂存，请点击“保存资料”备份。'; state.storageOK = false; }
  }
  function saveSoon() { clearTimeout(saveTimer); $('#saveStatus').textContent = '正在暂存…'; saveTimer = setTimeout(saveLocal, 250); }
  function readProject(raw) {
    if (raw?.format === storageKey) raw = raw.project;
    if (raw && typeof raw === 'object' && Array.isArray(raw.products)) {
      const old = S.normalize(raw);
      return { brief: [old.name, old.summary, old.web.mainNeed, old.people.user && '使用者：' + old.people.user, old.people.payer && '付款者：' + old.people.payer].filter(Boolean).join('\n'), goal: old.goal, evidence: '从原本地项目导入：\n' + JSON.stringify(old, null, 2), answers: [], demo: old.demo };
    }
    if (!raw || typeof raw !== 'object' || typeof raw.brief !== 'string' || raw.brief.length > 100000 || typeof raw.goal !== 'string' || raw.goal.length > 5000 || typeof raw.evidence !== 'string' || raw.evidence.length > 150000 || !Array.isArray(raw.answers) || raw.answers.length > 30) throw new Error('请选择本工具保存的项目 JSON 文件。');
    const answers = raw.answers.map(value => {
      if (!value || typeof value.question !== 'string' || typeof value.answer !== 'string' || value.question.length > 5000 || value.answer.length > 20000) throw new Error('项目中的回答格式不正确。');
      return { question: value.question, answer: value.answer };
    });
    return { brief: raw.brief, goal: raw.goal, evidence: raw.evidence, answers, demo: raw.demo === true };
  }
  function validReport(raw) {
    const ids = S.definition.flatMap(g => g.items.map(i => i.id));
    if (!raw || raw.mode !== 'ai' || !['needs_info', 'ready'].includes(raw.status) || typeof raw.businessName !== 'string' || typeof raw.summary !== 'string' || !raw.sections || !raw.decisions || !Array.isArray(raw.questions) || raw.questions.length > 3 || !Array.isArray(raw.actions) || !raw.actions.length || raw.actions.length > 3 || !Array.isArray(raw.sources) || !Array.isArray(raw.competitors) || !raw.judgment) return false;
    if (!ids.every(id => raw.sections[id] && ['answer', 'type', 'basis', 'missing'].every(k => typeof raw.sections[id][k] === 'string') && (raw.sections[id].direction === undefined || typeof raw.sections[id].direction === 'string') && ['已提供信息', '分析推断', '待验证'].includes(raw.sections[id].type))) return false;
    if (raw.topics !== undefined && (!Array.isArray(raw.topics) || raw.topics.length < 3 || raw.topics.length > 5 || !raw.topics.every(t => t && ['title', 'outline', 'goal'].every(k => typeof t[k] === 'string')))) return false;
    if (!['feasibility', 'acquisition', 'competition'].every(id => raw.decisions[id] && ['verdict', 'reason'].every(k => typeof raw.decisions[id][k] === 'string'))) return false;
    if (!raw.questions.every(q => q && typeof q.id === 'string' && /^[a-zA-Z0-9_-]{1,50}$/.test(q.id) && ['question', 'why', 'placeholder'].every(k => typeof q[k] === 'string'))) return false;
    if (!raw.actions.every(a => ['title', 'what', 'watch', 'when'].every(k => typeof a[k] === 'string'))) return false;
    if (!raw.sources.every(v => v && ['title', 'url', 'usedFor'].every(k => typeof v[k] === 'string'))) return false;
    if (!raw.competitors.every(v => v && ['name', 'product', 'price', 'customers', 'channel', 'path', 'learn', 'basis', 'url'].every(k => typeof v[k] === 'string'))) return false;
    if (raw.status === 'needs_info' && !raw.questions.length || !Number.isFinite(Date.parse(raw.generatedAt))) return false;
    if (!['status', 'observation', 'interpretation', 'basis', 'test'].every(k => typeof raw.judgment[k] === 'string')) return false;
    return true;
  }
  async function api(route, body = {}, signal) {
    return connection.request(route, body, signal);
  }
  function askConnect() {
    if (state.busy) return toast('请先完成或取消正在进行的分析。');
    const dialog = $('#consentDialog');
    if (!dialog.open) { if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', ''); }
  }
  function closeConsent() { const dialog = $('#consentDialog'); if (typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open'); }
  async function checkConnection() {
    const label = $('#connectionStatus');
    if (!connection.permitted) { askConnect(); return; }
    label.textContent = '正在检查本机连接…';
    try {
      const result = await api('status', {}, AbortSignal.timeout(15000));
      state.connected = !!result.loggedIn;
      label.textContent = result.message || (state.connected ? '已连接本机 Codex' : '请先登录 Codex');
      label.className = 'connection ' + (state.connected ? 'online' : 'offline');
    } catch { state.connected = false; label.textContent = '连接已断开，请重新启动本机连接'; label.className = 'connection offline'; }
  }
  function frameworkBoard(report) {
    const names = { products: '产品与利润来源', need: '主要需求', reason: '独特成交理由', monetization: '变现形式', forms: 'IP 业务形态', path: '成交链路', account: '消费心理账户', journey: '消费心理旅程', scene: '人群需求场景' };
    return S.definition.map(group => `<section class="column ${group.id === 'product' ? 'product' : group.id}"><header class="column-head"><h2>${group.title}</h2><p>${group.subtitle}</p></header>${group.items.map(item => {
      const result = report?.sections[item.id], direction = result?.direction?.trim();
      return `<article class="module direction-module" data-module="${item.id}"><h3>${names[item.id]}</h3>${result ? `<strong class="direction-value ${direction ? '' : 'direction-unknown'}">${esc(direction || '待重新分析')}</strong><p class="direction-explanation">${esc(result.answer)}</p>${result.basis || result.missing ? `<details class="item-evidence"><summary>查看依据${result.type === '待验证' ? ' · 待验证' : ''}</summary><div><span class="evidence-kind">${esc(result.type)}</span>${result.basis ? `<p>${esc(result.basis)}</p>` : ''}${result.missing ? `<p class="evidence-gap">待确认：${esc(result.missing)}</p>` : ''}</div></details>` : ''}` : '<span class="empty-direction" aria-label="分析后显示方向">—</span>'}</article>`;
    }).join('')}</section>`).join('');
  }
  function renderQuestions() {
    const panel = $('#questionsPanel');
    const report = state.report;
    if (!report || report.status !== 'needs_info' || !report.questions.length || state.view === 'method') { panel.hidden = true; return; }
    panel.hidden = false;
    panel.innerHTML = `<section class="question-card"><div class="entry-heading"><div><h2>再补充这几句，判断会更具体</h2><p>下方已经有初步报告。你可以先看，再回答最影响结论的问题。</p></div><span class="question-count">${report.questions.length} 个问题</span></div><div class="question-fields">${report.questions.map(q => `<div class="field"><label for="answer-${esc(q.id)}">${esc(q.question)}</label><p class="question-why">${esc(q.why)}</p><textarea id="answer-${esc(q.id)}" data-answer="${esc(q.id)}" rows="2" maxlength="20000" placeholder="${esc(q.placeholder)}" ${state.busy ? 'disabled' : ''}>${esc(state.pendingAnswers[q.id] || '')}</textarea></div>`).join('')}</div><div class="question-actions"><button class="text-button" data-action="skip-ai" ${state.busy ? 'disabled' : ''}>暂时不知道，先给初步报告</button><button class="button primary" data-action="continue-ai" ${state.busy ? 'disabled' : ''}>补充回答，继续分析</button></div></section>`;
  }
  function reportMarkup(report) {
    const decisionTitles = { feasibility: '值不值得做', acquisition: '获客成交怎么改', competition: '同行有哪些值得学' };
    const j = report.judgment;
    const current = Object.values(report.sections).every(item => typeof item.direction === 'string' && item.direction.trim()) && Array.isArray(report.topics);
    const topicCards = Array.isArray(report.topics) && report.topics.length ? `<div class="topics-grid">${report.topics.map(topic => `<article class="topic-card" data-topic><span class="topic-goal">${esc(topic.goal)}</span><h4>${esc(topic.title)}</h4><p>${esc(topic.outline)}</p></article>`).join('')}</div>` : '<p class="muted">这份旧版报告还没有推荐选题。更新本机连接程序后重新分析，即可补充。</p>';
    return `${current ? '' : '<div class="notice neutral">这是旧版报告。原内容已保留；更新本机连接程序并重新分析后，会显示每项归属方向及推荐选题。</div>'}
      <div class="report-head"><div><p class="eyebrow">生意方向与内容选题</p><h2>${esc(report.businessName || '这门生意')}</h2><p>${esc(report.summary)}</p><p class="report-time">${esc(new Date(report.generatedAt).toLocaleString('zh-CN', { hour12: false }))}</p></div><div class="report-buttons"><button class="button" data-action="view" data-view="form">补充介绍</button><button class="button primary" data-action="save-report">保存报告</button></div></div>
      <div class="framework-board report-board">${frameworkBoard(report)}</div>
      <section class="topics-section"><header><h3>接下来，推荐做这些选题</h3><p>每个选题讲什么，以及它要解决的问题。</p></header>${topicCards}</section>
      <details class="report-extra"><summary>更多经营建议与判断依据</summary><div class="extra-body">
        <div class="decision-grid">${Object.entries(decisionTitles).map(([id, title]) => `<article class="decision"><h3>${title}</h3><strong>${esc(report.decisions[id].verdict)}</strong><p>${esc(report.decisions[id].reason)}</p></article>`).join('')}</div>
        <section class="plain-card"><h3>成交或流失判断 <span class="small-tag">${esc(j.status)}</span></h3><div class="fact-grid"><div><h4>观察到什么</h4><p>${esc(j.observation)}</p></div><div><h4>可能说明什么</h4><p>${esc(j.interpretation)}</p></div><div><h4>判断依据</h4><p>${esc(j.basis)}</p></div><div><h4>怎样验证</h4><p>${esc(j.test)}</p></div></div></section>
        ${report.competitors.length ? `<section class="plain-card"><h3>同行或替代方案对照</h3>${report.competitors.map(c => `<article class="peer-result"><h4>${esc(c.name)}</h4><p><strong>产品与价格：</strong>${esc(c.product)}；${esc(c.price)}</p><p><strong>客户与渠道：</strong>${esc(c.customers)}；${esc(c.channel)}</p><p><strong>成交方式：</strong>${esc(c.path)}</p><p><strong>借鉴点：</strong>${esc(c.learn)}</p><p class="hint">依据：${esc(c.basis)}</p>${safeURL(c.url) ? `<a href="${esc(safeURL(c.url))}" target="_blank" rel="noopener noreferrer">查看来源</a>` : ''}</article>`).join('')}</section>` : ''}
        <section class="plain-card"><h3>优先行动</h3><div class="actions-grid">${report.actions.map(a => `<article class="next-action"><h4>${esc(a.title)}</h4><p>${esc(a.what)}</p><p><strong>观察：</strong>${esc(a.watch)}</p><small>${esc(a.when)}</small></article>`).join('')}</div></section>
        ${report.sources.length ? `<section class="plain-card"><h3>公开资料来源</h3>${report.sources.map(source => `<div class="source-item">${safeURL(source.url) ? `<a href="${esc(safeURL(source.url))}" target="_blank" rel="noopener noreferrer">${esc(source.title)}</a>` : `<strong>${esc(source.title)}</strong>`}<p>${esc(source.usedFor)}</p></div>`).join('')}</section>` : '<p class="report-source-note">本次没有列出已核实的公开来源，请按各项依据和待确认信息理解。</p>'}
      </div></details>
      <div class="report-bottom"><p>换一门生意，也可以按同样方式分析。</p><button class="button" data-action="reset">分析另一门生意</button></div>`;
  }
  function renderReport() {
    const target = $('#reportContent');
    if (!state.report) { target.innerHTML = `<section class="empty-report"><h2>介绍生意，查看九项方向和推荐选题</h2><p>不需要自己填写整套表格。只要提供已知情况，缺的信息会再问你。</p><button class="button primary" data-action="view" data-view="form">去介绍业务</button></section><div class="framework-board preview-board">${frameworkBoard()}</div>`; return; }
    const stale = state.report.inputFingerprint !== fingerprint(state.project);
    target.innerHTML = (stale ? '<div class="notice warning">业务资料有变化。下方仍是上一次的报告，请重新分析后再使用或导出。</div>' : '') + reportMarkup(state.report);
  }
  function setView(view, scroll = true) {
    state.view = view;
    document.body.classList.toggle('showing-report', view === 'report');
    for (const value of ['form', 'report', 'method']) $(`#${value}View`).hidden = value !== view;
    document.querySelectorAll('.views [data-view]').forEach(button => { button.classList.toggle('active', button.dataset.view === view); if (button.dataset.view === view) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
    renderQuestions();
    if (view === 'report') renderReport();
    if (scroll) window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function fillProject() {
    document.querySelectorAll('[data-field]').forEach(field => { field.value = state.project[field.dataset.field] || ''; });
    $('#demoNotice').hidden = !state.project.demo;
    renderQuestions(); renderReport();
  }
  function setBusy(value) {
    state.busy = value; $('#busyPanel').hidden = !value;
    document.querySelectorAll('[data-field], [data-answer]').forEach(field => { field.disabled = value; });
    $('#analyzeButton').disabled = value;
    $('#analyzeButton').textContent = value ? 'AI 正在分析…' : state.report ? '按当前资料重新分析' : '开始 AI 分析';
    renderQuestions();
  }
  async function analyze({ continueAnswers = false, allowUnknown = false } = {}) {
    if (state.busy) return;
    if (!state.project.brief.trim()) { setView('form'); $('#businessIntro').focus(); return toast('先简单介绍一下你做什么生意。'); }
    if (!state.connected) { await checkConnection(); if (!state.connected) return toast('请先允许连接这台电脑的 Codex，并在本机确认页完成确认。'); }
    let added = [];
    if (continueAnswers && state.report?.questions.length) {
      added = state.report.questions.map(q => ({ question: q.question, answer: String(state.pendingAnswers[q.id] || '').trim() })).filter(v => v.answer);
      if (!added.length && !allowUnknown) return toast('先回答至少一个问题；暂时不清楚也可以直接说。');
    }
    const snapshot = JSON.parse(JSON.stringify(state.project)); snapshot.answers.push(...added);
    if (allowUnknown) snapshot.answers.push({ question: '当前仍缺少的信息如何处理？', answer: '我暂时不清楚，请先给初步报告，明确假设和验证办法。' });
    if (snapshot.answers.length > 30) return toast('补充内容较多，请先把已有情况整理进业务介绍。');
    const controller = new AbortController(); state.controller = controller; setBusy(true); warning('');
    try {
      const result = await api('analyze', { ...snapshot, allowUnknown }, controller.signal);
      if (!validReport(result.report)) throw new Error('AI 返回的报告缺少必要内容，请重试。');
      state.project = snapshot;
      state.report = { ...result.report, inputFingerprint: fingerprint(snapshot), demo: snapshot.demo };
      state.pendingAnswers = {}; saveLocal(); fillProject(); setView('report');
      toast(state.report.status === 'needs_info' ? '已整理初步方向和选题，可以再补充关键信息。' : '已整理九项归属方向和推荐选题。');
    } catch (error) {
      const message = controller.signal.aborted ? '已取消本次分析，已有资料和报告仍保留。' : error.message;
      warning(message); toast(message);
    } finally { state.controller = null; setBusy(false); renderReport(); }
  }
  function download(content, name, type) {
    const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob), anchor = document.createElement('a');
    anchor.href = url; anchor.download = name.replace(/[\\/:*?"<>|]/g, '-').slice(0, 160); document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  function saveProject() {
    const title = state.report?.businessName || '生意资料';
    download(JSON.stringify({ format: storageKey, project: state.project, report: state.report }, null, 2), title + '_资料.json', 'application/json');
    toast('已下载项目资料，可用“打开资料”恢复。');
  }
  function saveReport() {
    if (!state.report) return toast('请先完成一次分析。');
    if (state.report.inputFingerprint !== fingerprint(state.project)) return toast('资料有变化，请重新分析后再导出报告。');
    const container = document.createElement('div'); container.innerHTML = reportMarkup(state.report);
    container.querySelectorAll('button,.report-bottom').forEach(node => node.remove());
    const css = document.querySelector('style').textContent;
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${esc(state.report.businessName)} · 商业分析</title><style>${css}</style></head><body><main class="wrap">${state.project.demo ? '<div class="notice demo">演示业务：所有输入数字、客户记录和同行为假设。</div>' : ''}${container.innerHTML}<p class="page-footer">由生意透镜使用本机 Codex 登录生成。请按依据和证据限制理解报告。</p></main></body></html>`;
    download(html, (state.report.businessName || '商业分析') + '_分析报告.html', 'text/html;charset=utf-8'); toast('已下载可独立打开的 HTML 报告。');
  }
  function mayReplace() { return !state.project.brief.trim() || confirm('这会替换当前页面的业务资料。需要保留的话，请先点“保存资料”备份。是否继续？'); }
  const demoBrief = '这是虚构示例：我想在杭州做周末手机摄影课，主要教希望拍好旅行照片的上班族。一班8人，每次3小时，收费399元，单个学员的变动交付成本估计120元。小红书内容和朋友转介绍是计划的客户来源。假设试课月有30人有效咨询、8人付款，每人买一单，获客支出600元。有人问零基础能不能跟上，现在只有老师作品，缺少学员作品。想判断是否值得继续做、怎么提升成交，并了解同需求的替代方案。所有信息仅供演示，不是真实经营记录。';
  const actions = {
    'ask-connect': askConnect,
    'allow-connect': () => { const result = connection.connect($('#localAddress').value); closeConsent(); return result; },
    'decline-connect': () => { closeConsent(); if (!state.project.brief.trim()) actions.demo(); else toast('本次没有连接 Codex，可以继续查看框架和已有报告。'); },
    view: button => setView(button.dataset.view), analyze: () => analyze(), 'continue-ai': () => analyze({ continueAnswers: true }), 'skip-ai': () => analyze({ continueAnswers: true, allowUnknown: true }),
    cancel: () => state.controller?.abort(),
    demo: () => {
      if (state.busy) return toast('请先取消或等待本次分析完成。');
      if (!mayReplace()) return;
      const example = globalThis.BusinessDemo;
      state.project = example ? readProject(example.input) : { brief: demoBrief, goal: '', evidence: '', answers: [], demo: true };
      state.project.demo = true;
      state.report = validReport(example?.report) ? { ...JSON.parse(JSON.stringify(example.report)), inputFingerprint: fingerprint(state.project), demo: true } : null;
      state.pendingAnswers = {}; warning(''); fillProject(); setView(state.report ? 'report' : 'form'); saveLocal();
      toast(state.report ? '已打开虚构业务的完整 AI 示例报告；没有发起新的模型调用。' : '已填入虚构示例，可以开始分析。');
    },
    reset: () => { if (state.busy) return toast('请先取消或等待本次分析完成。'); if (!mayReplace()) return; state.project = { brief: '', goal: '', evidence: '', answers: [], demo: false }; state.report = null; state.pendingAnswers = {}; fillProject(); setView('form'); saveLocal(); $('#businessIntro').focus(); },
    save: saveProject, 'save-report': saveReport,
    import: () => { if (state.busy) return toast('请等待或取消本次分析。'); $('#projectFile').click(); },
    'import-text': () => { if (state.busy) return; $('#textFile').click(); },
    'save-method': () => download(S.method.replace(/本HTML的边界[\s\S]*/, '本HTML的使用方式\n输入一段业务介绍，通过本机已登录的Codex分析；缺少信息时在页面追问。页面不读取聊天窗口的上下文，仅使用当前业务资料。模型需要联网；来源与证据限制在报告中说明。'), '基础商业分析方法.txt', 'text/plain;charset=utf-8'),
    'check-connection': checkConnection,
    'stop-connection': () => { if (state.busy) return toast('请先取消或等待分析完成。'); connection.disconnect(); toast('已断开本页连接，下次使用时需要重新允许。'); },
    'close-dialog': () => $('#copyDialog').close()
  };
  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-action]'); if (!button || button.disabled) return;
    try { await actions[button.dataset.action]?.(button); } catch (error) { toast(error.message); }
  });
  document.addEventListener('input', event => {
    if (event.target.dataset.field) state.project[event.target.dataset.field] = event.target.value;
    else if (event.target.dataset.answer) state.pendingAnswers[event.target.dataset.answer] = event.target.value;
    else return;
    saveSoon();
  });
  $('#projectFile').addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    try {
      if (file.size > 5_000_000) throw new Error('项目文件不能超过 5 MB。');
      const raw = JSON.parse(await file.text()), project = readProject(raw);
      if (!mayReplace()) return;
      state.project = project; state.report = validReport(raw.report) ? raw.report : null; state.pendingAnswers = {};
      fillProject(); setView(state.report ? 'report' : 'form'); saveLocal(); toast('资料已打开。');
    } catch (error) { toast(error instanceof SyntaxError ? '文件不是有效的 JSON 资料。' : error.message); }
    finally { event.target.value = ''; }
  });
  $('#textFile').addEventListener('change', async event => {
    const file = event.target.files[0]; if (!file) return;
    try {
      if (file.size > 2_000_000) throw new Error('文字文件不能超过 2 MB，请只保留相关内容。');
      const text = await file.text(), combined = [state.project.evidence, `【来源文件：${file.name}】\n${text}`].filter(Boolean).join('\n\n');
      if (combined.length > 150000) throw new Error('补充材料太多，请精简到 15 万字以内。');
      state.project.evidence = combined; fillProject(); saveLocal(); toast('文字已加入补充材料。');
    } catch (error) { toast(error.message); } finally { event.target.value = ''; }
  });
  window.addEventListener('beforeunload', () => { saveLocal(); connection.dispose(); });
  window.addEventListener('pageshow', event => { if (event.persisted) { connection.disconnect(); askConnect(); } });
  function init() {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const value = JSON.parse(saved); state.project = readProject(value);
        state.report = validReport(value.report) ? value.report : null;
        if (value.pendingAnswers && typeof value.pendingAnswers === 'object') for (const [key, text] of Object.entries(value.pendingAnswers)) if (/^[a-zA-Z0-9_-]{1,50}$/.test(key) && typeof text === 'string') state.pendingAnswers[key] = text.slice(0, 20000);
        $('#saveStatus').textContent = '已恢复当前浏览器暂存的资料。';
      }
    } catch { warning('浏览器暂存的资料未能读取。可以用“打开资料”导入已保存的 JSON 备份。'); }
    $('#frameworkPreview').innerHTML = frameworkBoard();
    const questions = $('#questionsPanel'); $('#formView').before($('#busyPanel')); $('#formView').before(questions);
    fillProject(); setView('form', false); $('#fileInstructions').hidden = !!session;
    if (connection.local) $('[data-action="allow-connect"]').textContent = '允许连接本机 Codex';
    askConnect();
    window.businessLensReady = true;
  }
  init();
})();
