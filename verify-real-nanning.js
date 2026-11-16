/*
 * 真实票据回归测试：「2026-9 南宁」目录下的 7 份 PDF
 * ------------------------------------------------------------------
 * 数据来源：2026-9 南宁/*.pdf（4 张发票 + 3 份行程单）
 * 识别结果由 static/js/custom/expense-report-core.js 在浏览器里读真实
 * PDF 文本层产出，已固化为下方 REAL 常量，便于离线复跑。
 *
 * ⚠️ 覆盖边界：本脚本【不解析 PDF】，只回归报销单表格逻辑。
 *    PDF 文本提取链路请用真实票据在浏览器里人工验证；另有 verify-pdf-assets.js
 *    零依赖校验 PDF 文件结构 / 页尺寸 / 文本流存在性。
 * ⚠️ 隐私：REAL 里的文件名对应 2026-9 南宁/ 下的真实票据（含公司名、金额），
 *    该目录已由 .gitignore 排除，分享源码前请勿附带。出差人 / 表单编号已占位化。
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
const issue = d(2026, 9, 11); // 四张发票的开票日期都是 2026-09-11

// 真实 PDF 识别结果（金额单位：元）
// fileName 用匿名标签：保留「汽车票 / 打车 / 行程单」等分类关键词，
// 去掉真实公司名、平台名与发票号；与磁盘文件的对应改由下面的体积指纹核对。
const REAL = [
  { fileName: '长途汽车票_电子发票.pdf',
    amount: 75.00, issueDate: issue, itemName: '长途汽车票 交通运输服务客运费', isTrip: false,
    trip: { primaryDate: '2026-09-06', dates: ['2026-09-06', '2026-09-11'], preferredDates: [], amount: 75.00 } },
  { fileName: '网约车1_打车电子发票.pdf',
    amount: 15.41, issueDate: issue, itemName: '交通运输服务客运服务费', isTrip: false,
    trip: { primaryDate: '2026-09-11', dates: ['2026-09-11'], preferredDates: [], amount: 15.41 } },
  { fileName: '网约车1_打车电子行程单.pdf',
    amount: 15.41, issueDate: issue, itemName: '出行', isTrip: true,
    trip: { primaryDate: '2026-09-09', dates: ['2026-09-09', '2026-09-11'], preferredDates: ['2026-09-09'], amount: 15.41 } },
  { fileName: '网约车2_打车电子发票.pdf',
    amount: 10.24, issueDate: issue, itemName: '交通运输服务客运服务费', isTrip: false,
    trip: { primaryDate: '', dates: [], preferredDates: [], amount: null } },
  { fileName: '网约车2_打车电子行程单.pdf',
    amount: 10.24, issueDate: issue, itemName: '享道出行', isTrip: true,
    trip: { primaryDate: '2026-09-10', dates: ['2026-09-10', '2026-09-11'], preferredDates: ['2026-09-10'], amount: 10.24 } },
  { fileName: '网约车3_打车电子发票.pdf',
    amount: 9.90, issueDate: issue, itemName: '交通运输服务客运服', isTrip: false,
    trip: { primaryDate: '2026-09-11', dates: ['2026-09-11'], preferredDates: [], amount: 9.90 } },
  { fileName: '网约车3_打车行程报销单.pdf',
    amount: 9.90, issueDate: issue, itemName: '第三方网约车服务公司', isTrip: true,
    trip: { primaryDate: '2026-09-06', dates: ['2026-09-06', '2026-09-11'], preferredDates: ['2026-09-06'], amount: 9.90 } },
];

console.log('\n=== A. 真实文件清单核对（匿名指纹，不含文件名明文） ===');
const dir = path.join(__dirname, '2026-9 南宁');
if (!fs.existsSync(dir)) {
  // 该目录被 .gitignore 排除；fresh clone 不应让 npm test 直接失败。
  console.log('  SKIP  真实票据目录不存在，跳过磁盘指纹核对；下方基于 fixture 的业务断言仍全部执行');
} else {
  const onDisk = fs.readdirSync(dir).filter(f => /\.pdf$/i.test(f)).sort();
  const sizeFingerprint = onDisk.map(f => fs.statSync(path.join(dir, f)).size).sort((a, b) => a - b);
  const EXPECTED_SIZES = [38219, 60297, 72694, 74357, 175092, 475007, 476119];
  check('真实 PDF 目录存在且共 7 份', onDisk.length === 7, '实际 ' + onDisk.length + ' 份');
  check('磁盘票据与 fixture 对应（按文件体积指纹）',
    JSON.stringify(sizeFingerprint) === JSON.stringify(EXPECTED_SIZES),
    onDisk.length ? sizeFingerprint.join(',') : '目录不存在');
}

console.log('\n=== B. 出差范围 2026-09-06 ~ 09-11（南宁，补贴 50/天）===');
// 出差人 / 表单编号使用占位值，不把真实个人信息固化进测试脚本
const TRAVELER = '测试出差人';
const FORM_NO = 'FORM-NO-PLACEHOLDER';
const CFG = { startDate: '2026-09-06', endDate: '2026-09-11', location: '南宁', reason: '客户拜访',
  traveler: TRAVELER, formNo: FORM_NO, dailyAllowance: 50 };
const m = T.buildTripModel(REAL, CFG);
const s = m.stats;
console.log('  统计:', JSON.stringify({ invoices: s.invoiceCount, trips: s.tripDocCount,
  matched: s.matchedInvoices, unmatchedTrips: s.unmatchedTrips, mismatch: s.mismatch,
  outOfRange: s.outOfRangeCount }));
console.log('  合计(分):', JSON.stringify(m.totals), '总计', m.grandTotal / 100, '元');

check('识别为 4 张发票 + 3 份行程单', s.invoiceCount === 4 && s.tripDocCount === 3);
check('3 张网约车发票与行程单金额核对一致', s.matchedInvoices === 3, String(s.matchedInvoices));
check('没有行程单被漏配', s.unmatchedTrips === 0, String(s.unmatchedTrips));
check('无行程单的汽车票不被误报为金额不符', s.mismatch === 0, String(s.mismatch));
check('生成 6 个日期行', m.dayRows.length === 6, String(m.dayRows.length));
check('行程单不重复计入金额（票据合计 110.55 元）',
  m.totals.ticket + m.totals.taxi + m.totals.transportOther + m.totals.lodging + m.totals.refund === 11055,
  String((m.totals.ticket + m.totals.taxi + m.totals.transportOther + m.totals.lodging + m.totals.refund) / 100));
check('长途汽车票 75 元归入「车船费-其他」', m.totals.transportOther === 7500 && m.totals.ticket === 0, String(m.totals.transportOther / 100));
check('三笔网约车 35.55 元归入打的费', m.totals.taxi === 3555, String(m.totals.taxi / 100));
check('补贴 6 天 × 50 = 300 元', m.totals.allowance === 30000, String(m.totals.allowance / 100));
check('总计 410.55 元', m.grandTotal === 41055, String(m.grandTotal / 100));
check('没有超范围票据', m.outRow === null && s.outOfRangeCount === 0);

const byDay = {};
m.dayRows.forEach(r => { byDay[T.utils.dayKey(r.date)] = r.cells; });
check('09-06 滴滴 9.90 元按行程单日期归行', byDay['2026-09-06'].taxi === 990, String(byDay['2026-09-06'].taxi / 100));
check('09-09 T3 打车 15.41 元按行程单日期归行', byDay['2026-09-09'].taxi === 1541, String(byDay['2026-09-09'].taxi / 100));
check('09-10 享道 10.24 元按行程单日期归行', byDay['2026-09-10'].taxi === 1024, String(byDay['2026-09-10'].taxi / 100));
check('09-11 汽车票 75 元无行程单，按开票日期归行', byDay['2026-09-11'].transportOther === 7500, String(byDay['2026-09-11'].transportOther / 100));
check('无票日期 09-07 / 09-08 仍有补贴、费用为 0',
  byDay['2026-09-07'].allowance === 5000 && byDay['2026-09-07'].taxi === 0 &&
  byDay['2026-09-08'].allowance === 5000 && byDay['2026-09-08'].ticket === 0);

console.log('\n=== C. 出差范围收窄到 09-09 ~ 09-10：超范围票据 ===');
const m2 = T.buildTripModel(REAL, Object.assign({}, CFG, { startDate: '2026-09-09', endDate: '2026-09-10' }));
console.log('  统计:', JSON.stringify({ outOfRange: m2.stats.outOfRangeCount,
  allowance: m2.totals.allowance / 100, grandTotal: m2.grandTotal / 100,
  outRowSubtotal: m2.outRow ? m2.outRow.subtotal / 100 : null }));
check('2 天日期行', m2.dayRows.length === 2);
check('2 笔票据日期超范围（09-06 滴滴、09-11 汽车票）', m2.stats.outOfRangeCount === 2, String(m2.stats.outOfRangeCount));
check('超范围票据单列且不计补贴', !!m2.outRow && m2.totals.allowance === 10000);
check('超范围金额 84.90 元不丢', !!m2.outRow && m2.outRow.subtotal === 8490, m2.outRow ? String(m2.outRow.subtotal / 100) : 'no row');
check('票据金额不丢，总计 = 110.55 票据 + 100 补贴 = 210.55 元',
  m2.grandTotal === 21055, String(m2.grandTotal / 100));

console.log('\n=== E. 区间留空（靠推断）：待定发票的开票日不得撑大出差区间 ===');
// 复现 bug：汽车票无行程单、开票日 9-11。旧逻辑把「所有发票开票日」纳入区间推断，
// 区间被撑成 9-06~9-11（6 天 / 300 补贴），且 75 元落入区间内永不报超范围，
// 补贴就这样算到了开票日上。
// 修复后：区间仅按行程单真实出差日推断 → 9-06~9-10（5 天 / 250 补贴），
// 汽车票 75 元被识别为超范围，确认弹窗会强制用户手选正确日期。
const INFER_CFG = { location: '南宁', reason: '客户拜访', traveler: TRAVELER, formNo: FORM_NO, dailyAllowance: 50 };
const m3 = T.buildTripModel(REAL, INFER_CFG);
const a3 = T.analyzeExpenseReport(REAL, INFER_CFG);
console.log('  统计:', JSON.stringify({ days: m3.dayRows.length, outOfRange: m3.stats.outOfRangeCount,
  allowance: m3.totals.allowance / 100, grandTotal: m3.grandTotal / 100 }));
check('推断区间 = 5 天（来自行程单 9-06/09/10，不含待定发票开票日 9-11）',
  m3.dayRows.length === 5, String(m3.dayRows.length));
check('补贴 = 5 天 × 50 = 250 元（未被开票日撑大）', m3.totals.allowance === 25000, String(m3.totals.allowance / 100));
check('汽车票 75 元无行程单 → 被识别为超范围（旧逻辑会落在区间内不报警）',
  m3.stats.outOfRangeCount === 1 && !!m3.outRow, 'out=' + m3.stats.outOfRangeCount);
check('analyzeExpenseReport 把该发票列为 1 笔 issue（触发确认弹窗拦截）',
  a3.issues.length === 1 && a3.issues[0].amount === 75, 'issues=' + a3.issues.length);
check('超范围 75 元单列、金额不丢', !!m3.outRow && m3.outRow.subtotal === 7500, m3.outRow ? String(m3.outRow.subtotal / 100) : 'no row');
check('总计 = 35.55 票据 + 250 补贴 + 75 超范围 = 360.55 元', m3.grandTotal === 36055, String(m3.grandTotal / 100));

console.log('\n=== D. 生成 HTML 预览 ===');
const html = T.generateExpenseReportHTML(REAL, undefined, CFG, {
  numberToChinese: n => String(n)
});
check('HTML 含 10 列表头', html.includes('车船费') && html.includes('普票费') && html.includes('打的费') && html.includes('退票费'));
check('HTML 含出差地点南宁', html.includes('南宁'));
check('HTML 合计行金额 410.55', /410\.55/.test(html));
check('版式：A4 纵向整页 + 黑体标题 + 编号 + 出差人',
  html.includes('width:794px;height:1123px') && html.includes('出差记录及费用报销清单') &&
  html.includes('编号：' + FORM_NO) && html.includes('出差人：' + TRAVELER));
check('版式：两行表头（车船费跨三列 + 普票费/打的费/其他子列）+ 数据行小计留空',
  /colspan="3"/.test(html) && html.includes('普票费') && html.includes('打的费') &&
  html.includes('（退票费）') && /<td [^>]*><\/td><\/tr>/.test(html));
check('版式：每个日期行都填出差地点与原因',
  (html.match(/>南宁</g) || []).length >= 6 && (html.match(/>客户拜访</g) || []).length >= 6);
check('版式：已移除记账凭证附件 / 中文大写 / 签章栏',
  !html.includes('记账凭证附件') && !html.includes('合计金额（大写）') && !html.includes('报销人签章'));
const outDir = path.join(__dirname, '.workbuddy', 'preview');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'real-nanning-report.html');
fs.writeFileSync(outFile, '<!doctype html><meta charset="utf-8"><title>2026-9 南宁 差旅费报销单</title>' +
  '<style>body{background:#f3f4f6;margin:0;padding:24px;font-family:"Microsoft YaHei",sans-serif}</style>' + html);
console.log('  → ' + outFile);

// ------------------------------------------------------------------
// F. 费用列手动覆盖（确认弹窗「填入位置」下拉）：人工选了费用列后，
//    覆盖关键词自动归类，且 categoryManual 标记为 true、金额计入所选列。
//    这是修复「发票被错误归类到某费用列」的防线。
// ------------------------------------------------------------------
console.log('\n=== F. 费用列手动覆盖（确认弹窗「填入位置」下拉）===');
const ovData = REAL.map(r => Object.assign({}, r, { trip: r.trip ? Object.assign({}, r.trip) : null }));
// 把「长途汽车票 75 元」从自动的「车船费-其他」改手动指定为「普票费」
const bus = ovData[0];
const autoCat = T.utils.categorize(bus, CFG);
bus.__reportCategory = 'ticket';
const mF = T.buildTripModel(ovData, CFG);
const dF = mF.stats.details.find(x => x.index === 0);
check('长途汽车票自动归类 = 车船费-其他', autoCat === 'transportOther', autoCat);
check('手动指定「普票费」后归类变为 ticket', dF.category === 'ticket', dF.category);
check('categoryManual 标记为 true', dF.categoryManual === true);
check('75 元从「车船费-其他」移至「普票费」', mF.totals.ticket === 7500 && mF.totals.transportOther === 0,
  'ticket=' + (mF.totals.ticket / 100) + ' other=' + (mF.totals.transportOther / 100));
check('总计不受影响（金额不丢、仍 410.55）', mF.grandTotal === 41055, String(mF.grandTotal / 100));
// analyzeExpenseReport 也应反映手动列（category 来自 model.stats.details，与 buildTripModel 一致）
const aF = T.analyzeExpenseReport(ovData, CFG);
check('analyzeExpenseReport 反映手动列 category=ticket', aF.model.stats.details[0].category === 'ticket', aF.model.stats.details[0].category);
// 删除手动覆盖后回到自动归类
delete bus.__reportCategory;
const mF2 = T.buildTripModel(ovData, CFG);
check('删除手动覆盖后回到自动归类（车船费-其他）', mF2.stats.details[0].category === 'transportOther', mF2.stats.details[0].category);

console.log('\n=== 结果：' + pass + ' 通过 / ' + fail + ' 失败 ===');
process.exit(fail ? 1 : 0);
