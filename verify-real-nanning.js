/*
 * 真实票据回归测试：「2026-9 南宁」目录下的 10 份 PDF
 * ------------------------------------------------------------------
 * 数据来源：2026-9 南宁/*.pdf（8 张发票 + 2 份行程单）
 *   3 张 携程代订住宿费（项目名「*生产生活服务*经纪代理服务*代订住宿费」）
 *   2 张 汽车站客运票（75 元 萧山机场→德清、100 元 融水→桂林）
 *   2 张 网约车发票（高德 11.70、哈啰 24.48）+ 2 份对应行程单
 *   1 张 铁路电子客票（德清→杭州东 12.00）
 * 识别结果由 static/js/custom/expense-report-core.js 在浏览器里读真实
 * PDF 文本层产出，已按真实输出固化为下方 REAL 常量，便于离线复跑。
 *
 * ⚠️ 覆盖边界：本脚本【不解析 PDF】，只回归报销单表格逻辑。
 *    PDF 文本提取链路请用真实票据在浏览器里人工验证；另有 verify-pdf-assets.js
 *    零依赖校验 PDF 文件结构 / 页尺寸 / 文本流存在性。
 * ⚠️ 隐私：真实文件名（含公司名、发票号、出差人）不进源码，fixture 用匿名标签；
 *    目录体积指纹只比对文件大小，不落明文名称。
 *
 * 用法：node verify-real-nanning.js
 * 产出：.workbuddy/preview/real-nanning-report.html
 */
'use strict';

const fs = require('fs');
const path = require('path');
const T = require('./static/js/custom/expense-report-table.js');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  ' + extra : '')); }
}
function d(y, m, day) { return new Date(y, m - 1, day); }

// 真实识别结果（金额单位：元）。
// date / issueDate 都取 core 的归行日：住宿票=入住日，旅客运输票=出行日，其余=开票日。
// docKind 是 core 在识别阶段给出的票据类型硬结论（lodging / bus）。
const REAL = [
  // 携程代订住宿费：12 元（入住 6-02）、18 元（入住 6-04）、18 元（入住 6-07）
  { fileName: 'A0001.pdf', amount: 12.00, issueDate: d(2026, 6, 2), date: d(2026, 6, 2),
    itemName: '代订住宿费 柏曼酒店', isTrip: false, docKind: 'lodging', dateSource: 'stay',
    trip: { primaryDate: '', dates: [], preferredDates: [], amount: null } },
  { fileName: 'A0002.pdf', amount: 18.00, issueDate: d(2026, 6, 4), date: d(2026, 6, 4),
    itemName: '代订住宿费 柏曼酒店', isTrip: false, docKind: 'lodging', dateSource: 'stay',
    trip: { primaryDate: '', dates: [], preferredDates: [], amount: null } },
  { fileName: 'A0003.pdf', amount: 18.00, issueDate: d(2026, 6, 7), date: d(2026, 6, 7),
    itemName: '代订住宿费 柏曼酒店', isTrip: false, docKind: 'lodging', dateSource: 'stay',
    trip: { primaryDate: '', dates: [], preferredDates: [], amount: null } },
  // 汽车站客运票：项目名与网约车同为「客运服务费」，靠 公共交通/汽车总站 区分
  { fileName: '长途汽车票_萧山机场.pdf', amount: 75.00, issueDate: d(2026, 6, 10), date: d(2026, 6, 10),
    itemName: '长途汽车票 交通运输服务客运费', isTrip: false, docKind: 'bus', dateSource: 'travel',
    trip: { primaryDate: '2026-06-10', dates: ['2026-06-10', '2026-06-11'], preferredDates: [], amount: 75.00 } },
  { fileName: '长途汽车票_融水桂林.pdf', amount: 100.00, issueDate: d(2026, 6, 10), date: d(2026, 6, 10),
    itemName: '长途汽车票 交通运输服务客运服务费', isTrip: false, docKind: 'bus', dateSource: 'travel',
    trip: { primaryDate: '2026-06-10', dates: ['2026-06-10', '2026-06-11'], preferredDates: [], amount: 100.00 } },
  { fileName: '网约车1_打车电子发票.pdf', amount: 11.70, issueDate: d(2026, 6, 11), date: d(2026, 6, 11),
    itemName: '交通运输服务客运服务', isTrip: false, dateSource: 'billing',
    trip: { primaryDate: '2026-06-11', dates: ['2026-06-11'], preferredDates: [], amount: 11.70 } },
  { fileName: '网约车1_打车电子行程单.pdf', amount: 11.70, issueDate: d(2026, 6, 11), date: d(2026, 6, 11),
    itemName: '鞍马出行', isTrip: true,
    trip: { primaryDate: '2026-06-02', dates: ['2026-06-02', '2026-06-11'], preferredDates: ['2026-06-02'], amount: 11.70 } },
  { fileName: '网约车2_哈啰电子发票.pdf', amount: 24.48, issueDate: d(2026, 6, 11), date: d(2026, 6, 11),
    itemName: '交通运输服务客运服务', isTrip: false, dateSource: 'billing',
    trip: { primaryDate: '2026-06-11', dates: ['2026-06-11'], preferredDates: [], amount: 24.48 } },
  { fileName: '网约车2_哈啰行程报销单.pdf', amount: 24.48, issueDate: d(2026, 6, 11), date: d(2026, 6, 11),
    itemName: '第三方网约车服务公司', isTrip: true,
    trip: { primaryDate: '2026-06-03', dates: ['2026-06-03', '2026-06-08', '2026-06-11'], preferredDates: ['2026-06-03'], amount: 24.48 } },
  // 铁路电子客票：乘车 6-02、开票 6-04，归行取乘车日
  { fileName: '火车票_德清-杭州东.pdf', amount: 12.00, issueDate: d(2026, 6, 2), date: d(2026, 6, 2),
    itemName: '火车票 德清-杭州东', isTrip: false, docKind: '', dateSource: 'travel',
    trip: { primaryDate: '2026-06-02', dates: ['2026-06-02', '2026-06-04'], preferredDates: [], amount: 12.00 } },
];

console.log('\n=== A. 真实文件清单核对（体积指纹，不含文件名明文） ===');
const dir = path.join(__dirname, '2026-9 南宁');
if (!fs.existsSync(dir)) {
  // 该目录被 .gitignore 排除；fresh clone 不应让 npm test 直接失败。
  console.log('  SKIP  真实票据目录不存在，跳过磁盘指纹核对；下方基于 fixture 的业务断言仍全部执行');
} else {
  const onDisk = fs.readdirSync(dir).filter(f => /\.pdf$/i.test(f)).sort();
  const sizeFingerprint = onDisk.map(f => fs.statSync(path.join(dir, f)).size).sort((a, b) => a - b);
  const EXPECTED_SIZES = [34861, 40054, 59537, 62789, 65419, 65438, 153923, 163096, 193948, 475399];
  check('真实 PDF 目录存在且共 10 份', onDisk.length === 10, '实际 ' + onDisk.length + ' 份');
  check('磁盘票据与 fixture 对应（按文件体积指纹）',
    JSON.stringify(sizeFingerprint) === JSON.stringify(EXPECTED_SIZES),
    onDisk.length ? sizeFingerprint.join(',') : '目录不存在');
}

console.log('\n=== B. 出差范围 2026-06-02 ~ 06-10（融水，补贴 50/天）===');
const TRAVELER = '测试出差人';
const FORM_NO = 'FORM-NO-PLACEHOLDER';
const CFG = { startDate: '2026-06-02', endDate: '2026-06-10', location: '融水', reason: '试验',
  traveler: TRAVELER, formNo: FORM_NO, dailyAllowance: 50 };
const m = T.buildTripModel(REAL, CFG);
const s = m.stats;
console.log('  统计:', JSON.stringify({ invoices: s.invoiceCount, trips: s.tripDocCount,
  matched: s.matchedInvoices, unmatchedTrips: s.unmatchedTrips, mismatch: s.mismatch,
  outOfRange: s.outOfRangeCount }));
console.log('  合计(分):', JSON.stringify(m.totals), '总计', m.grandTotal / 100, '元');

check('识别为 8 张发票 + 2 份行程单', s.invoiceCount === 8 && s.tripDocCount === 2);
check('2 张网约车发票与行程单金额核对一致', s.matchedInvoices === 2, String(s.matchedInvoices));
check('没有行程单被漏配', s.unmatchedTrips === 0, String(s.unmatchedTrips));
check('无行程单的汽车票不被误报为金额不符', s.mismatch === 0, String(s.mismatch));
check('生成 9 个日期行', m.dayRows.length === 9, String(m.dayRows.length));
check('票据合计 271.18 元（行程单不重复计入）',
  m.totals.ticket + m.totals.taxi + m.totals.transportOther + m.totals.lodging + m.totals.refund === 27118,
  String((m.totals.ticket + m.totals.taxi + m.totals.transportOther + m.totals.lodging + m.totals.refund) / 100));

// —— 本次修复的核心：住宿发票必须进「住宿费」，不能掉进车船费 ——
check('三张携程代订住宿票 48 元全部归入「住宿费」', m.totals.lodging === 4800, String(m.totals.lodging / 100));
check('住宿票没有污染「车船费-其他」', m.totals.transportOther === 17500, String(m.totals.transportOther / 100));
check('两张汽车站客运票 175 元归入「车船费-其他」（不是打的费）',
  m.totals.transportOther === 17500 && m.totals.taxi === 3618,
  'other=' + (m.totals.transportOther / 100) + ' taxi=' + (m.totals.taxi / 100));
check('两张网约车 36.18 元归入「打的费」', m.totals.taxi === 3618, String(m.totals.taxi / 100));
check('火车票 12 元归入「普票费」', m.totals.ticket === 1200, String(m.totals.ticket / 100));
check('补贴 9 天 × 50 = 450 元', m.totals.allowance === 45000, String(m.totals.allowance / 100));
check('总计 721.18 元', m.grandTotal === 72118, String(m.grandTotal / 100));
check('没有超范围票据', m.outRow === null && s.outOfRangeCount === 0);

const byDay = {};
m.dayRows.forEach(r => { byDay[T.utils.dayKey(r.date)] = r.cells; });
check('06-02 住宿 12 元按入住日归行', byDay['2026-06-02'].lodging === 1200, String(byDay['2026-06-02'].lodging / 100));
check('06-04 住宿 18 元按入住日归行', byDay['2026-06-04'].lodging === 1800, String(byDay['2026-06-04'].lodging / 100));
check('06-07 住宿 18 元按入住日归行', byDay['2026-06-07'].lodging === 1800, String(byDay['2026-06-07'].lodging / 100));
check('06-02 火车票 12 元按乘车日归行（不是开票日 06-04）',
  byDay['2026-06-02'].ticket === 1200 && byDay['2026-06-04'].ticket === 0, String(byDay['2026-06-02'].ticket / 100));
check('06-02 高德 11.70 元按行程单日期归行', byDay['2026-06-02'].taxi === 1170, String(byDay['2026-06-02'].taxi / 100));
check('06-03 哈啰 24.48 元按行程单日期归行', byDay['2026-06-03'].taxi === 2448, String(byDay['2026-06-03'].taxi / 100));
check('06-10 两张汽车票合计 175 元归入车船费-其他', byDay['2026-06-10'].transportOther === 17500,
  String(byDay['2026-06-10'].transportOther / 100));
check('无票日期 06-05 / 06-06 仍有补贴、费用为 0',
  byDay['2026-06-05'].allowance === 5000 && byDay['2026-06-05'].lodging === 0 &&
  byDay['2026-06-06'].allowance === 5000 && byDay['2026-06-06'].taxi === 0);

console.log('\n=== C. 出差范围收窄到 06-03 ~ 06-04：超范围票据 ===');
const m2 = T.buildTripModel(REAL, Object.assign({}, CFG, { startDate: '2026-06-03', endDate: '2026-06-04' }));
console.log('  统计:', JSON.stringify({ outOfRange: m2.stats.outOfRangeCount,
  allowance: m2.totals.allowance / 100, grandTotal: m2.grandTotal / 100,
  outRowSubtotal: m2.outRow ? m2.outRow.subtotal / 100 : null }));
check('2 天日期行', m2.dayRows.length === 2);
check('6 笔票据日期超范围（06-02 三笔 + 06-07 住宿 + 06-10 两张汽车票）',
  m2.stats.outOfRangeCount === 6, String(m2.stats.outOfRangeCount));
check('超范围票据单列且不计补贴', !!m2.outRow && m2.totals.allowance === 10000);
check('超范围金额 228.70 元不丢', !!m2.outRow && m2.outRow.subtotal === 22870,
  m2.outRow ? String(m2.outRow.subtotal / 100) : 'no row');
check('票据金额不丢，总计 = 271.18 票据 + 100 补贴 = 371.18 元',
  m2.grandTotal === 37118, String(m2.grandTotal / 100));

console.log('\n=== D. 生成 HTML 预览 ===');
const html = T.generateExpenseReportHTML(REAL, undefined, CFG, {
  numberToChinese: n => String(n)
});
check('HTML 含 10 列表头', html.includes('车船费') && html.includes('普票费') && html.includes('打的费') && html.includes('退票费'));
check('HTML 含出差地点融水', html.includes('融水'));
check('HTML 合计行金额 721.18', /721\.18/.test(html));
check('版式：A4 纵向整页 + 黑体标题 + 编号 + 出差人',
  html.includes('width:794px;height:1123px') && html.includes('出差记录及费用报销清单') &&
  html.includes('编号：' + FORM_NO) && html.includes('出差人：' + TRAVELER));
check('版式：两行表头（车船费跨三列 + 普票费/打的费/其他子列）+ 数据行小计留空',
  /colspan="3"/.test(html) && html.includes('普票费') && html.includes('打的费') &&
  html.includes('（退票费）') && /<td [^>]*><\/td><\/tr>/.test(html));
check('版式：每个日期行都填出差地点与原因',
  (html.match(/>融水</g) || []).length >= 9 && (html.match(/>试验</g) || []).length >= 9);
check('版式：已移除记账凭证附件 / 中文大写 / 签章栏',
  !html.includes('记账凭证附件') && !html.includes('合计金额（大写）') && !html.includes('报销人签章'));
const outDir = path.join(__dirname, '.workbuddy', 'preview');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'real-nanning-report.html');
fs.writeFileSync(outFile, '<!doctype html><meta charset="utf-8"><title>2026-9 南宁 差旅费报销单</title>' +
  '<style>body{background:#f3f4f6;margin:0;padding:24px;font-family:"Microsoft YaHei",sans-serif}</style>' + html);
console.log('  → ' + outFile);

console.log('\n=== E. 区间留空（靠推断）：开票日不得撑大出差区间 ===');
// 行程单真实出差日只有 06-02 / 06-03 → 区间 2 天；
// 若把「发票开票日」纳入推断，区间会被撑到 06-11（9 天），补贴多算 350 元。
const INFER_CFG = { location: '融水', reason: '试验', traveler: TRAVELER, formNo: FORM_NO, dailyAllowance: 50 };
const m3 = T.buildTripModel(REAL, INFER_CFG);
const a3 = T.analyzeExpenseReport(REAL, INFER_CFG);
console.log('  统计:', JSON.stringify({ days: m3.dayRows.length, outOfRange: m3.stats.outOfRangeCount,
  allowance: m3.totals.allowance / 100, grandTotal: m3.grandTotal / 100 }));
check('推断区间 = 2 天（来自行程单 06-02/06-03，不含开票日 06-11）',
  m3.dayRows.length === 2, String(m3.dayRows.length));
check('补贴 = 2 天 × 50 = 100 元（未被开票日撑大）', m3.totals.allowance === 10000, String(m3.totals.allowance / 100));
check('区间外 4 笔票据被列为 issue（06-04/06-07 住宿 + 06-10 两张汽车票）',
  a3.issues.length === 4, 'issues=' + a3.issues.length);
check('超范围金额 211 元单列、金额不丢', !!m3.outRow && m3.outRow.subtotal === 21100,
  m3.outRow ? String(m3.outRow.subtotal / 100) : 'no row');
check('总计 = 60.18 区间内票据 + 100 补贴 + 211 超范围 = 371.18 元',
  m3.grandTotal === 37118, String(m3.grandTotal / 100));

// ------------------------------------------------------------------
// F. 费用列手动覆盖（确认弹窗「填入位置」下拉）：人工选了费用列后，
//    覆盖关键词自动归类，且 categoryManual 标记为 true、金额计入所选列。
// ------------------------------------------------------------------
console.log('\n=== F. 费用列手动覆盖（确认弹窗「填入位置」下拉）===');
const ovData = REAL.map(r => Object.assign({}, r, { trip: r.trip ? Object.assign({}, r.trip) : null }));
const hotel = ovData[0];
const autoCat = T.utils.categorize(hotel, CFG);
hotel.__reportCategory = 'ticket';
const mF = T.buildTripModel(ovData, CFG);
const dF = mF.stats.details.find(x => x.index === 0);
check('住宿票自动归类 = 住宿费', autoCat === 'lodging', autoCat);
check('手动指定「普票费」后归类变为 ticket', dF.category === 'ticket', dF.category);
check('categoryManual 标记为 true', dF.categoryManual === true);
check('12 元从「住宿费」移至「普票费」', mF.totals.ticket === 2400 && mF.totals.lodging === 3600,
  'ticket=' + (mF.totals.ticket / 100) + ' lodging=' + (mF.totals.lodging / 100));
check('总计不受影响（金额不丢、仍 721.18）', mF.grandTotal === 72118, String(mF.grandTotal / 100));
const aF = T.analyzeExpenseReport(ovData, CFG);
const aFhotel = (aF.model.stats.details || []).find(x => x.index === 0);
check('analyzeExpenseReport 反映手动列 category=ticket', aFhotel && aFhotel.category === 'ticket', aFhotel && aFhotel.category);
delete hotel.__reportCategory;
const mF2 = T.buildTripModel(ovData, CFG);
const mF2hotel = (mF2.stats.details || []).find(x => x.index === 0);
check('删除手动覆盖后回到自动归类（住宿费）', mF2hotel && mF2hotel.category === 'lodging', mF2hotel && mF2hotel.category);

// ------------------------------------------------------------------
// G. 归类回归：酒店票 / 班车票 / 网约车票三者的边界
// ------------------------------------------------------------------
console.log('\n=== G. 归类回归：酒店 / 班车 / 网约车 ===');
const cat = (inv) => T.utils.categorize(inv, CFG);
check('「代订住宿费 柏曼酒店」→ 住宿费',
  cat({ fileName: 'A0001.pdf', projectName: '代订住宿费 柏曼酒店' }) === 'lodging');
check('「*住宿服务*住宿费」（直营酒店票）→ 住宿费',
  cat({ fileName: 'B.pdf', projectName: '住宿服务住宿费' }) === 'lodging');
check('备注写「入住/退房」但项目名无住宿字样 → 住宿费',
  cat({ fileName: 'C.pdf', projectName: '经纪代理服务 入住2026年06月02日 退房06月04日' }) === 'lodging');
check('docKind=lodging 时即使项目名被识别坏也进住宿费（旧 bug 的真凶）',
  cat({ fileName: 'C.pdf', projectName: '生产生活服务经纪代理', docKind: 'lodging' }) === 'lodging');
check('未修复前的坏项目名（无 docKind）仍会落车船费-其他，作为反例记录',
  cat({ fileName: 'C.pdf', projectName: '生产生活服务经纪代理' }) === 'transportOther');
check('「长途汽车票 交通运输服务客运服务费」→ 车船费-其他',
  cat({ fileName: 'D.pdf', projectName: '长途汽车票 交通运输服务客运服务费' }) === 'transportOther');
check('「公共交通/汽车总站」客运票 → 车船费-其他（不是打的费）',
  cat({ fileName: 'E.pdf', projectName: '交通运输服务客运服务费 融水县 桂林市 公共交通' }) === 'transportOther');
check('网约车「客运服务费」仍归打的费（不被班车规则误伤）',
  cat({ fileName: '网约车1_打车电子发票.pdf', projectName: '交通运输服务客运服务' }) === 'taxi');
check('docKind=bus 覆盖「客运服务」关键词 → 车船费-其他',
  cat({ fileName: 'F.pdf', projectName: '交通运输服务客运服务', docKind: 'bus' }) === 'transportOther');

console.log('\n=== H. 无行程单时的区间推断：先信「入住/出行日」，最后才用开票日 ===');
// 一张行程单都没有的极端情况：8 张发票里 3 张住宿（入住 06-02/04/07）、
// 2 张汽车票（出行 06-10）、火车票（出行 06-02）、2 张网约车（只有开票日 06-11）。
// 期望区间 06-02 ~ 06-10：开票日 06-11 不得参与，否则补贴多算一天。
const noTrip = REAL.filter(r => !r.isTrip);
const mH = T.buildTripModel(noTrip, { location: '融水', reason: '试验', traveler: TRAVELER, formNo: FORM_NO, dailyAllowance: 50 });
console.log('  推断区间:', T.utils.dayKey(mH.start), '~', T.utils.dayKey(mH.end), '共', mH.dayRows.length, '天');
check('无行程单时区间 = 06-02 ~ 06-10（取入住日/出行日，不含开票日 06-11）',
  T.utils.dayKey(mH.start) === '2026-06-02' && T.utils.dayKey(mH.end) === '2026-06-10',
  T.utils.dayKey(mH.start) + '~' + T.utils.dayKey(mH.end));
check('补贴 9 天 × 50 = 450 元', mH.totals.allowance === 45000, String(mH.totals.allowance / 100));
check('住宿 48 元仍全部在住宿费列', mH.totals.lodging === 4800, String(mH.totals.lodging / 100));
// 连出行日都没有（只剩开票日）时，才退回开票日推断——这是显式的最后兜底
const billingOnly = noTrip.map(r => Object.assign({}, r, { dateSource: 'billing' }));
const mH2 = T.buildTripModel(billingOnly, { location: '融水', reason: '试验', traveler: TRAVELER, formNo: FORM_NO, dailyAllowance: 50 });
check('全部退化为开票日时区间回到 06-02 ~ 06-11（兜底路径仍可用）',
  T.utils.dayKey(mH2.start) === '2026-06-02' && T.utils.dayKey(mH2.end) === '2026-06-11',
  T.utils.dayKey(mH2.start) + '~' + T.utils.dayKey(mH2.end));

console.log('\n=== 结果：' + pass + ' 通过 / ' + fail + ' 失败 ===');
process.exit(fail ? 1 : 0);
