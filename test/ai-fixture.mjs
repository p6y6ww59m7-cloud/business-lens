import { sectionIds } from '../web/ai-contract.mjs';
export function sampleReport() {
  const directions = { products: '手机摄影小班课', need: '旅行前人像实操', reason: '现场实操纠错', monetization: '线索获客', forms: '知识付费', path: '内容→咨询→报名', account: '学习提升投入', journey: '信任建立阶段', scene: '上班族出游准备' };
  return {
    businessName: '手机摄影小班课', summary: '已有试课，继续核实交付和成本。', status: 'needs_info',
    questions: [{ id: 'city', question: '在哪个城市上课？', why: '影响可触达的人群和同行比较。', placeholder: '例如：杭州，线下小班。' }],
    decisions: Object.fromEntries(['feasibility', 'acquisition', 'competition'].map(id => [id, { verdict: '先小范围验证', reason: '有付款记录，仍缺稳定获客证据。' }])),
    sections: Object.fromEntries(sectionIds.map(id => [id, { direction: directions[id], answer: `根据该业务的具体资料判定为${directions[id]}。`, type: '分析推断', basis: '用户提供的试课情况。', missing: '核对真实记录。' }])),
    topics: [{ title: '零基础怎么开始拍人像', outline: '演示新手的第一个手机人像练习，记录老师如何指导。不要把演示说成已有学员成绩。', goal: '减少学不会的顾虑' }, { title: '旅行前先练好哪张照片', outline: '从一个旅行拍照场景入手，说明这堂课能帮助练习什么。', goal: '吸引有出游需求的人' }, { title: '399元的课具体做什么', outline: '按实际上课过程介绍实操和点评，让客户知道付钱后得到什么。', goal: '讲清购买价值' }],
    judgment: { status: '待验证', observation: '客户问能否学会。', interpretation: '可能影响信任。', basis: '用户提供的咨询。', test: '补充学员过程，再记录反馈。' },
    competitors: [], actions: [{ title: '记录顾虑', what: '保留咨询原话。', watch: '是否付款及具体原因。', when: '一轮购买决策后。' }], sources: []
  };
}
