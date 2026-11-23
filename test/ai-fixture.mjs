import { sectionIds } from '../web/ai-contract.mjs';
export function sampleReport() {
  return {
    businessName: '手机摄影小班课', summary: '已有试课，继续核实交付和成本。', status: 'needs_info',
    questions: [{ id: 'city', question: '在哪个城市上课？', why: '影响可触达的人群和同行比较。', placeholder: '例如：杭州，线下小班。' }],
    decisions: Object.fromEntries(['feasibility', 'acquisition', 'competition'].map(id => [id, { verdict: '先小范围验证', reason: '有付款记录，仍缺稳定获客证据。' }])),
    sections: Object.fromEntries(sectionIds.map(id => [id, { answer: `本项 ${id} 的分析`, type: '分析推断', basis: '用户提供的试课情况。', missing: '核对真实记录。' }])),
    judgment: { status: '待验证', observation: '客户问能否学会。', interpretation: '可能影响信任。', basis: '用户提供的咨询。', test: '补充学员过程，再记录反馈。' },
    competitors: [], actions: [{ title: '记录顾虑', what: '保留咨询原话。', watch: '是否付款及具体原因。', when: '一轮购买决策后。' }], sources: []
  };
}
