/*
 * 二次开发验证脚本：差旅费报销单表格
 * ------------------------------------------------------------------
 * 用法：node verify-expense-report.js
 * 作用：
 *   1) 单测 PDF 行程单识别（文本 -> 日期/金额/是否行程单）；
 *   2) 单测报销单数据模型（日期范围、补贴、费用归类、行程单金额核对、
 *      超范围票据、分页）；
 *   3) 生成 .workbuddy/preview/expense-report-preview.html 静态预览。
 * 不修改项目任何业务文件，仅写预览文件。
 */
'use strict';

const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  ' + extra : '')); }
}
function d(y, m, day) { return new Date(y, m - 1, day); }

/* ---------- 1. 行程单文本识别 ---------- */
console.log('\n=== A. 行程单 PDF 文本识别 ===');
global.window = global;
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
require('./static/js/custom/expense-report-core.js');
const tripInfo = global.__expenseReportCore.extractTripInfo;
const tripText = '滴滴出行行程单  用车时间：2026-10-20 09:20  上车 人民广场  下车 张江  ' +
  '里程 12.5 公里  实付金额 ¥36.80  乘客 张先生';
const tInfo = tripInfo(tripText, tripText.replace(/\s+/g, ''), '滴滴出行行程单.pdf');
check('行程单文本识别为行程单', tInfo.isTrip === true);
check('提取用车日期 2026-10-20', tInfo.primaryDate === '2026-10-20', tInfo.primaryDate);
check('提取实付金额 36.80', tInfo.amount === 36.8, String(tInfo.amount));

const invText = '电子发票（普通发票） 开票日期：2026年11月2日 价税合计（小写）¥36.80 发票号码 12345678 纳税人识别号 91310000';
const iInfo = tripInfo(invText, invText.replace(/\s+/g, ''), '滴滴电子发票.pdf');
check('发票不会被误判为行程单', iInfo.isTrip === false);

/* ---------- 2. 报销单数据模型 ---------- */
console.log('\n=== B. 差旅报销单数据模型 ===');
const T = require('./static/js/custom/expense-report-table.js');
const CFG = { startDate: '2026-10-19', endDate: '2026-10-23', dailyAllowance: 50, location: '', reason: '' };

// 场景 1：完全复刻用户示例（无票据，只有 5 天补贴）
const mA = T.buildTripModel([], CFG);
check('示例：生成 5 个日期行', mA.dayRows.length === 5, 'days=' + mA.dayRows.length);
check('示例：补贴合计 250 元', mA.totals.allowance === 25000, String(mA.totals.allowance / 100));
check('示例：其它费用列均为 0', T.COLS.filter(k => k !== 'allowance').every(k => mA.totals[k] === 0));
check('示例：小计 250 元', mA.grandTotal === 25000, String(mA.grandTotal / 100));
check('示例：无超范围票据', mA.outRow === null);

// 场景 2：行程单金额与发票核对成功 -> 按行程单日期归行（开票日期在范围外也不算超范围）
const mB = T.buildTripModel([
  { fileName: '滴滴电子发票.pdf', amount: 36.8, issueDate: d(2026, 11, 2), projectName: '*运输服务*客运服务费' },
  { fileName: '滴滴出行行程单.pdf', amount: 36.8, issueDate: d(2026, 11, 2), projectName: '行程单', isTrip: true,
    trip: { isTrip: true, primaryDate: '2026-10-20', dates: ['2026-10-20'], amount: 36.8 } }
], CFG);
check('行程单不计入发票金额', mB.stats.invoiceCount === 1, 'invoices=' + mB.stats.invoiceCount);
check('行程单金额核对成功', mB.stats.matchedInvoices === 1);
check('按行程单日期 10/20 归入打的费', mB.dayRows.find(r => r.key === '2026-10-20').cells.taxi === 3680);
check('开票日期超范围但已配对，不算超范围', mB.stats.outOfRangeCount === 0);
check('合计 = 补贴 250 + 打车 36.8', mB.grandTotal === 28680, String(mB.grandTotal / 100));

// 场景 3：没有行程单，开票日期超范围 -> 单列为超范围票据
const mC = T.buildTripModel([
  { fileName: '酒店发票.pdf', amount: 468, issueDate: d(2026, 11, 1), projectName: '住宿费' }
], CFG);
check('超范围票据被单列', mC.outRow !== null && mC.stats.outOfRangeCount === 1);
check('住宿费归到住宿费列', mC.totals.lodging === 46800);
check('超范围票据不计补贴', mC.outRow.cells.allowance === 0);
check('金额仍计入合计', mC.grandTotal === 71800, String(mC.grandTotal / 100));

// 场景 4：一张汇总发票对应多张行程单（金额之和核对）
const mD = T.buildTripModel([
  { fileName: '网约车汇总发票.pdf', amount: 60, issueDate: d(2026, 11, 3), projectName: '客运服务费' },
  { fileName: '行程单1.pdf', amount: 20, isTrip: true, trip: { isTrip: true, primaryDate: '2026-10-19', dates: ['2026-10-19'], amount: 20 } },
  { fileName: '行程单2.pdf', amount: 40, isTrip: true, trip: { isTrip: true, primaryDate: '2026-10-21', dates: ['2026-10-21'], amount: 40 } }
], CFG);
check('多张行程单合计核对成功', mD.stats.matchedInvoices === 1);
check('金额按行程单日期分摊 10/19=20、10/21=40',
  mD.dayRows.find(r => r.key === '2026-10-19').cells.taxi === 2000 &&
  mD.dayRows.find(r => r.key === '2026-10-21').cells.taxi === 4000);
check('分摊后无超范围票据', mD.stats.outOfRangeCount === 0);

// 场景 5：费用归类
const mE = T.buildTripModel([
  { fileName: '火车票.pdf', amount: 100, issueDate: d(2026, 10, 19), projectName: '火车票 北京南-上海虹桥' },
  { fileName: '通行费.pdf', amount: 30, issueDate: d(2026, 10, 20), projectName: '通行费' },
  { fileName: '退票费.pdf', amount: 20, issueDate: d(2026, 10, 21), projectName: '退票费' },
  { fileName: '未知项目.pdf', amount: 12.5, issueDate: d(2026, 10, 22), projectName: '某某服务费' }
], CFG);
check('火车票/通行费 -> 普票费', mE.totals.ticket === 13000, String(mE.totals.ticket / 100));
check('退票费 -> 其他(退票费)', mE.totals.refund === 2000);
check('未识别项目 -> 车船费-其他（不丢钱）', mE.totals.transportOther === 1250);
check('合计 = 250 + 162.5', mE.grandTotal === 41250, String(mE.grandTotal / 100));

/* ---------- 3. HTML 结构 ---------- */
console.log('\n=== C. 表格 HTML 结构 ===');
function toChinese(n) {
  const nums = '零壹贰叁肆伍陆柒捌玖'.split('');
  const int = Math.floor(n), dec = Math.round((n - int) * 100);
  let s = '';
  if (int === 0) s = '零';
  else if (int < 10) s = nums[int];
  else if (int < 100) s = nums[Math.floor(int / 10)] + '拾' + (int % 10 ? nums[int % 10] : '');
  else if (int < 1000) s = nums[Math.floor(int / 100)] + '佰' +
    (int % 100 >= 10 ? nums[Math.floor(int % 100 / 10)] + '拾' : (int % 100 ? '零' : '')) +
    (int % 10 ? nums[int % 10] : '');
  else s = String(int);
  return s + '元' + (dec ? (nums[Math.floor(dec / 10)] + '角' + (dec % 10 ? nums[dec % 10] + '分' : '')) : '整');
}

const htmlA = T.generateExpenseReportHTML([], null, CFG, { numberToChinese: toChinese });
check('表头「车船费」跨 3 列', /colspan="3"[^>]*>车船费</.test(htmlA));
check('表头 7 个跨 2 行单元格', (htmlA.match(/rowspan="2"/g) || []).length === 7);
check('表头含「其他（退票费）」', htmlA.includes('（退票费）'));
check('日期格式 2026/10/19', htmlA.includes('2026/10/19') && htmlA.includes('2026/10/23'));
check('合计行含 0 与 250', /合计<\/td>/.test(htmlA) && htmlA.includes('>250<'));
check('版式对齐参考清单：标题 / 编号 / 出差人 / 两行表头',
  htmlA.includes('出差记录及费用报销清单') && htmlA.includes('编号：YF-FBCW10-2022') &&
  htmlA.includes('出差人：') && htmlA.includes('（退票费）') &&
  (htmlA.match(/<thead>/g) || []).length === 1);
check('A4 纵向整页，且无记账凭证附件 / 中文大写 / 签章栏',
  htmlA.includes('width:794px;height:1123px') &&
  !htmlA.includes('记账凭证附件') && !htmlA.includes('报销人签章') && !htmlA.includes('合计金额（大写）'));
const firstDataRow = (htmlA.match(/<tr style="height:26px;">[\s\S]*?<\/tr>/) || [''])[0];
check('数据行 10 个单元格', (firstDataRow.match(/<td /g) || []).length === 10,
  'count=' + (firstDataRow.match(/<td /g) || []).length);
check('数据行小计单元格留空（参考清单口径）', /<td [^>]*><\/td><\/tr>$/.test(firstDataRow.trim()),
  firstDataRow.slice(-90));

const htmlB = T.generateExpenseReportHTML([
  { fileName: '滴滴电子发票.pdf', amount: 36.8, issueDate: d(2026, 11, 2), projectName: '客运服务费' },
  { fileName: '滴滴出行行程单.pdf', amount: 36.8, isTrip: true,
    trip: { isTrip: true, primaryDate: '2026-10-20', dates: ['2026-10-20'], amount: 36.8 } },
  { fileName: '酒店发票.pdf', amount: 468, issueDate: d(2026, 10, 22), projectName: '住宿费' },
  { fileName: '火车票.pdf', amount: 263, issueDate: d(2026, 10, 19), projectName: '火车票 北京南-上海虹桥' },
  { fileName: '退票费发票.pdf', amount: 20, issueDate: d(2026, 11, 5), projectName: '退票费' }
], null, Object.assign({}, CFG, { location: '上海', reason: '客户拜访' }), { numberToChinese: toChinese });
check('含票据场景：小计合计 250+36.8+468+263+20', htmlB.includes('>1037.80<'), '');
check('含票据场景：超范围提示存在', htmlB.includes('超范围票据'));
check('含票据场景：出差地点/原因已填入', htmlB.includes('上海') && htmlB.includes('客户拜访'));

const longCfg = { startDate: '2026-10-01', endDate: '2026-10-20', dailyAllowance: 50, rowsPerPage: 8 };
const htmlLong = T.generateExpenseReportHTML([], null, longCfg, { numberToChinese: toChinese });
check('20 天自动分 3 页', (htmlLong.match(/class="expenseReportPage"/g) || []).length === 3);

/* ---------- 4. 生成前确认：人工归行日期 / 超范围诊断 ---------- */
console.log('\n=== D. 生成前强制确认逻辑 ===');
const CFG2 = { startDate: '2026-10-19', endDate: '2026-10-23', dailyAllowance: 50, location: '南宁', reason: '做实验' };
const outInvoices = [
  { fileName: '网约车发票.pdf', amount: 30.25, issueDate: d(2026, 10, 25), projectName: '客运服务费' },
  { fileName: '行程单.pdf', amount: 30.25, isTrip: true,
    trip: { isTrip: true, primaryDate: '2026-10-25', dates: ['2026-10-25'], amount: 30.25 } },
  { fileName: '火车票.pdf', amount: 100, issueDate: d(2026, 10, 20), projectName: '火车票 南宁东-广州南' }
];
const previewHelpers = { numberToChinese: toChinese, preview: true };
const a1 = T.analyzeExpenseReport(outInvoices, CFG2);
check('诊断出 1 笔超范围票据', a1.issues.length === 1, 'issues=' + a1.issues.length);
check('问题票据定位到原始索引 0', a1.issues[0].index === 0);
check('问题票据日期 2026-10-25', a1.issues[0].dates[0] === '2026-10-25');
check('问题票据金额 30.25', a1.issues[0].amount === 30.25);
check('预览 HTML 含超范围提示行（对应确认窗口截图）',
  T.generateExpenseReportHTML(outInvoices, null, CFG2, previewHelpers).includes('超范围票据'));
check('预览为紧凑版式，正式版式仍是 A4 整页',
  !T.generateExpenseReportHTML(outInvoices, null, CFG2, previewHelpers).includes('height:1123px') &&
  T.generateExpenseReportHTML(outInvoices, null, CFG2, { numberToChinese: toChinese }).includes('width:794px;height:1123px'));

// 用户在确认窗口把归行日期改到出差范围内
const fixed = outInvoices.map(inv => Object.assign({}, inv));
fixed[0].__reportDate = '2026-10-21';
const a2 = T.analyzeExpenseReport(fixed, CFG2);
check('人工指定归行日期后超范围清零', a2.issues.length === 0 && a2.model.outRow === null);
check('金额按人工日期归入 10/21 打的费', a2.model.dayRows.find(r => r.key === '2026-10-21').cells.taxi === 3025);
check('人工日期优先于行程单配对，但金额核对仍成立', a2.model.stats.matchedInvoices === 1);
check('修正前后合计金额不变（不丢钱）', a1.model.grandTotal === a2.model.grandTotal);
check('明细标记人工确认来源', a2.model.stats.details[0].manual === true && a2.model.stats.details[0].by === '人工确认日期');
check('修正后预览不再出现超范围提示',
  !T.generateExpenseReportHTML(fixed, null, CFG2, previewHelpers).includes('超范围票据'));

const bad = outInvoices.map(inv => Object.assign({}, inv));
bad[0].__reportDate = '不是日期';
const a3 = T.analyzeExpenseReport(bad, CFG2);
check('非法人工日期不会覆盖原口径', a3.issues.length === 1 && a3.model.stats.details[0].manual === false);

const a4 = T.analyzeExpenseReport(outInvoices, Object.assign({}, CFG2, { endDate: '2026-10-25' }));
check('调整出差范围也能消除超范围', a4.issues.length === 0);

const a5 = T.analyzeExpenseReport([
  { fileName: 'a.pdf', amount: 10, issueDate: d(2026, 11, 1), projectName: '住宿费' },
  { fileName: 'b.pdf', amount: 20, issueDate: d(2026, 11, 2), projectName: '住宿费' }
], CFG2);
check('多笔超范围分别定位到索引 0 / 1',
  a5.issues.length === 2 && a5.issues[0].index === 0 && a5.issues[1].index === 1);

const tripFixed = outInvoices.map(inv => Object.assign({}, inv, {
  trip: inv.trip ? Object.assign({}, inv.trip) : null
}));
tripFixed[1].trip.primaryDate = '2026-10-22';
const a6 = T.analyzeExpenseReport(tripFixed, CFG2);
check('改行程单日期也能让配对发票回到范围内',
  a6.issues.length === 0 && a6.model.dayRows.find(r => r.key === '2026-10-22').cells.taxi === 3025);

/* ---------- 5. 页面生成链路静态约束 ---------- */
console.log('\n=== E. main.html 生成链路 ===');
const mainHtml = fs.readFileSync(path.join(__dirname, 'main.html'), 'utf8');
check('两条入口统一走同一个确认窗口',
  mainHtml.includes('window.generateExpenseReportManual = generateExpenseReport;') &&
  !mainHtml.includes('async function generateExpenseReportManual()'));
check('生成前强制调用确认窗口', /const confirmedData = await showExpenseReportConfirmDialog/.test(mainHtml));
check('未修正超范围时确认按钮被禁用', mainHtml.includes('confirmBtn.disabled = blocked'));
check('确认窗口含实时预览与问题定位', mainHtml.includes('{ preview: true }') && mainHtml.includes('定位第 1 笔'));
check('人工修正持久化到下次生成',
  mainHtml.includes('saveExpenseReportOverrides') && mainHtml.includes('applyExpenseReportOverrides'));
check('日期格式化改用本地年月日（修复少一天）', mainHtml.includes("getMonth() + 1).padStart(2, '0')"));
check('报销单卡片观察器与新统计卡片兼容（认「发票统计」标题，不被误删）',
  mainHtml.includes("发票统计') || t.includes('发票数量')"));
check('报销单渲染降采样至 scale:2（避免点击生成卡顿 3-4s）',
  mainHtml.includes('scale: 2, useCORS'));
check('重识别改为增量（跳过已识别 PDF，避免反复生成全量重解析）',
  mainHtml.includes('!cache[name])') && mainHtml.includes('refreshInvoiceRecognition'));

/* ---------- 6. 输出静态预览 ---------- */
const previewDir = path.join(__dirname, '.workbuddy', 'preview');
fs.mkdirSync(previewDir, { recursive: true });
const preview = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>差旅费报销单 · 效果预览</title>
<style>
  body{margin:0;background:#eef1f6;font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:#1f2937;}
  header{padding:22px 28px 6px;} h2{margin:0 0 4px;font-size:18px;}
  header p{margin:0;font-size:13px;color:#6b7280;line-height:1.6;}
  .case{margin:22px auto 34px;max-width:840px;}
  .case h3{font-size:14px;margin:0 0 10px;padding-left:10px;border-left:3px solid #4338ca;}
  .page-wrap{background:#fff;box-shadow:0 6px 22px rgba(15,23,42,.12);border-radius:4px;overflow:auto;}
  .tag{display:inline-block;margin-left:8px;padding:2px 8px;border-radius:10px;background:#eef2ff;color:#4338ca;font-size:11px;vertical-align:middle;}
</style></head><body>
<header><h2>差旅费报销单 · 表格效果预览</h2>
<p>表头两行：日期 / 出差地点 / 出差原因 / 车船费(普票费·打的费·其他) / 住宿费 / 补贴 / 其他(退票费) / 小计。<br>
补贴默认 50 元/天；有行程单按行程单日期（金额与发票核对），无行程单按开票日期；超范围票据单列且不计补贴。</p></header>
<div class="case"><h3>示例一：5 天出差，仅补贴（复刻需求截图）<span class="tag">合计 250</span></h3>
<div class="page-wrap">${htmlA}</div></div>
<div class="case"><h3>示例二：含火车票 / 打车 / 住宿 / 退票费 + 1 张超范围票据<span class="tag">合计 1037.80</span></h3>
<div class="page-wrap">${htmlB}</div></div>
</body></html>`;
const previewPath = path.join(previewDir, 'expense-report-preview.html');
fs.writeFileSync(previewPath, preview, 'utf8');
console.log('\n=== F. 预览文件 ===');
console.log('  ' + previewPath);

console.log('\n=== 结果 ===');
console.log('  ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
