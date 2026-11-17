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

// 回归：行程单上常印「发票号码 / 开票日期 / 电子发票」用于关联发票，
// 旧逻辑用这些词一票否决 isTrip，导致行程单被当成发票与其对应发票重复计费。
const tripWithInvoiceWords = tripText + ' 关联发票号码 12345678 开票日期：2026年11月2日 电子发票';
const tiw = tripInfo(tripWithInvoiceWords, tripWithInvoiceWords.replace(/\s+/g, ''), '滴滴出行行程单.pdf');
check('行程单含发票号码/开票日期字样仍判为行程单（防重复计费回归）', tiw.isTrip === true);

// 回归：真实票据存在「…行程报销单.pdf」命名，严格文件名正则需覆盖。
const tripReportText = tripText + ' 发票号码 开票日期';
const trp = tripInfo(tripReportText, tripReportText.replace(/\s+/g, ''), '第三方网约车服务公司_滴滴出行行程报销单.pdf');
check('「行程报销单」文件名识别为行程单', trp.isTrip === true);

// 回归：文本无行程特征、仅平台名命中 + 发票专属字段，必须仍判发票（防误伤）。
const platformInv = '滴滴出行 客运服务费 电子发票 价税合计 ¥15.00 发票号码 87654321';
const pinv = tripInfo(platformInv, platformInv.replace(/\s+/g, ''), '滴滴出行.pdf');
check('仅平台名命中的电子发票不算行程单（防误伤）', pinv.isTrip === false);

// 审查回归①（防漏算）：真发票文件名含"行程单"字样（如"行程单对应的发票"），
// 文本有发票铁证（带金额的价税合计/纳税人识别号）→ 必须判发票，否则金额漏算。
const invNamedLikeTrip = invText + ' 增值税专用发票';
const int = tripInfo(invNamedLikeTrip, invNamedLikeTrip.replace(/\s+/g, ''), '滴滴行程单对应的电子发票.pdf');
check('发票文件名含行程单字样仍判为发票（防漏算回归）', int.isTrip === false);

// 审查回归②（防重复计费）：行程单文本含"增值税/价税合计说明"票面说明字样（无金额），
// 不构成发票铁证 → 行程特征兜底 → 必须判行程单。
const tripWithTaxWords = tripText + ' 本行程可开具增值税电子普通发票 价税合计说明';
const twt = tripInfo(tripWithTaxWords, tripWithTaxWords.replace(/\s+/g, ''), '享道出行.pdf');
check('行程单文本含增值税/价税合计字样仍判为行程单（防重复计费回归）', twt.isTrip === true);

// 审查回归③（防重复计费）：行程单文件名含"电子发票"票种词（如"电子发票行程单.pdf"）。
// 票种词不再一票否决，文本有行程明细即判行程单，否则会与其对应发票重复计费。
const tripNamedWithInvoiceWord = tripText + ' 关联发票号码 12345678';
const tni = tripInfo(tripNamedWithInvoiceWord, tripNamedWithInvoiceWord.replace(/\s+/g, ''), '高德打车电子发票行程单.pdf');
check('行程单文件名含电子发票票种词仍判为行程单（防重复计费回归）', tni.isTrip === true);

/* ---------- 1b. 发票统计口径：当前文件 vs 历史缓存 ---------- */
console.log('\n=== A2. 发票统计卡片口径 ===');
const selectStats = global.__expenseReportCore.selectInvoiceStatsItems;
const fileKey = (f) => [f && f.name || '', f && f.size || 0, f && f.lastModified || 0].join('::');
const currentFiles = [
  { name: '发票A.pdf', size: 100, lastModified: 1 },
  { name: '行程单A.pdf', size: 200, lastModified: 2 },
  { name: '发票B.pdf', size: 300, lastModified: 3 }
];
const statsCache = {
  '旧发票::50::0': { fileName: '旧发票.pdf', amount: 99, isTrip: false },
  [fileKey(currentFiles[0])]: { fileName: '发票A.pdf', amount: 11.7, isTrip: false },
  '发票A.pdf': { fileName: '发票A.pdf', amount: 11.7, isTrip: false },
  [fileKey(currentFiles[1])]: { fileName: '行程单A.pdf', amount: 15, isTrip: true },
  [fileKey(currentFiles[2])]: { fileName: '发票B.pdf', amount: 18, isTrip: false },
  '000_报销单.pdf': { fileName: '000_报销单.pdf', amount: 1000, isTrip: false }
};
const picked = selectStats(currentFiles, statsCache, fileKey);
check('统计数量等于当前上传文件数', picked.known === true && picked.items.length === 3,
  'items=' + picked.items.length);
check('历史缓存文件不再计入统计', !picked.items.some((i) => i.fileName === '旧发票.pdf'));
check('同一文件的重复缓存键只计一次',
  picked.items.filter((i) => i.fileName === '发票A.pdf').length === 1);
check('行程单分类与金额保留',
  picked.items.some((i) => i.fileName === '行程单A.pdf' && i.isTrip === true && i.amount === 15));
check('生成的报销单不计入统计', !picked.items.some((i) => i.fileName === '000_报销单.pdf'));
const clearedStats = selectStats([], statsCache, fileKey);
check('清空后统计归零', clearedStats.known === true && clearedStats.items.length === 0);

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

// 端到端回归：一张发票 + 它对应的行程单（行程单文本含发票关键词）。
// 若行程单被误判成发票，打的费会变成 36.80×2。修复后应仍是 36.80。
const e2eTripRaw = '滴滴出行行程单 用车时间：2026-10-20 里程 12.5 实付金额 ¥36.80 乘客 张先生 ' +
  '关联发票号码 12345678 开票日期：2026年11月2日 电子发票';
const e2eTrip = tripInfo(e2eTripRaw, e2eTripRaw.replace(/\s+/g, ''), '滴滴出行电子行程单.pdf');
const mE2E = T.buildTripModel([
  { fileName: '滴滴电子发票.pdf', amount: 36.8, issueDate: d(2026, 11, 2), projectName: '客运服务费', isTrip: false },
  { fileName: '滴滴出行电子行程单.pdf', amount: e2eTrip.amount, issueDate: d(2026, 11, 2),
    projectName: '出行', isTrip: e2eTrip.isTrip,
    trip: { isTrip: e2eTrip.isTrip, primaryDate: e2eTrip.primaryDate,
      dates: e2eTrip.dates, amount: e2eTrip.amount } }
], CFG);
check('端到端：含发票字样的行程单不被重复计费', mE2E.totals.taxi === 3680,
  '打的费=' + (mE2E.totals.taxi / 100) + ' 元，发票数=' + mE2E.stats.invoiceCount);

// 场景 3：没有行程单，开票日期超范围 -> 单列为超范围票据
const mC = T.buildTripModel([
  { fileName: '酒店发票.pdf', amount: 468, issueDate: d(2026, 11, 1), projectName: '住宿费' }
], CFG);
check('超范围票据被单列', mC.outRow !== null && mC.stats.outOfRangeCount === 1);
check('住宿费归到住宿费列', mC.totals.lodging === 46800);
check('超范围票据不计补贴', mC.outRow.cells.allowance === 0);
check('金额仍计入合计', mC.grandTotal === 71800, String(mC.grandTotal / 100));

// 场景 4（新口径）：一张行程单作容器，金额【严格相等】的一组发票（1~N 张）归到同组。
// 金额一律取发票、整笔填入；行程单金额只用于分组，不参与计算与填入。
const mD = T.buildTripModel([
  { fileName: '行程单.pdf', amount: 60, isTrip: true,
    trip: { isTrip: true, primaryDate: '2026-10-19', dates: ['2026-10-19'], amount: 60 } },
  { fileName: '网约车发票1.pdf', amount: 20, issueDate: d(2026, 11, 3), projectName: '客运服务费' },
  { fileName: '网约车发票2.pdf', amount: 40, issueDate: d(2026, 11, 3), projectName: '客运服务费' }
], CFG);
check('一张行程单认领两张严格等额发票（发票数=2）', mD.stats.matchedInvoices === 2);
check('两张发票整笔填入行程单日期 10/19，合计 60',
  mD.dayRows.find(r => r.key === '2026-10-19').cells.taxi === 6000,
  String(mD.dayRows.find(r => r.key === '2026-10-19').cells.taxi / 100));
check('归组后无超范围票据', mD.stats.outOfRangeCount === 0);
check('卡片以行程单为容器含两张发票、金额取发票之和',
  (() => {
    const g = (mD.groups || []).find(x => x.invoiceIndices.length === 2);
    return !!g && g.tripIndices.length === 1 && g.amountCents === 6000 &&
      g.trips[0].amountCents === 6000 && g.tripIndices[0] === 0;
  })(), JSON.stringify((mD.groups || []).map(g => ({ key: g.key, inv: g.invoiceIndices, trips: g.tripIndices, amt: g.amountCents }))));
check('合计 = 补贴250 + 发票60（行程单60不重复计费）', mD.grandTotal === 31000, String(mD.grandTotal / 100));

// 场景 4b（审查回归①）：金额严格以发票为准。行程单金额识别有 1 分误差时，
// 旧逻辑会把发票 60 填成 60.01；新逻辑下行程单金额只用于严格分组，
// 绝不进入格子/合计，合计必须等于发票金额。
const mD2 = T.buildTripModel([
  { fileName: '网约车发票.pdf', amount: 60, issueDate: d(2026, 10, 19), projectName: '客运服务费' },
  { fileName: '行程单1.pdf', amount: 20, isTrip: true, trip: { isTrip: true, primaryDate: '2026-10-19', dates: ['2026-10-19'], amount: 20 } },
  { fileName: '行程单2.pdf', amount: 40.01, isTrip: true, trip: { isTrip: true, primaryDate: '2026-10-21', dates: ['2026-10-21'], amount: 40.01 } }
], CFG);
check('行程单有 1 分误差也不污染合计（严格=发票60+补贴250）', mD2.grandTotal === 31000, String(mD2.grandTotal / 100));
check('行程单有误差时发票金额仍整笔=60、不拆不放大',
  mD2.stats.details.filter(x => !x.isTrip).every(x => x.cents === 6000 && x.pieces.length === 1));
check('严格口径下误差行程单不误认领发票', mD2.stats.matchedInvoices === 0 && mD2.stats.unmatchedTrips === 2);

// 场景 4c（审查回归②）：一张行程单对多张发票时，行程单金额只是分组依据。
// 故意把行程单金额写错（40），但两张发票 20+40=60 仍应各自整笔填入、合计=60，
// 证明填入金额与分组用的行程单金额彻底解耦。
const mD3 = T.buildTripModel([
  { fileName: '行程单.pdf', amount: 40, isTrip: true,
    trip: { isTrip: true, primaryDate: '2026-10-20', dates: ['2026-10-20'], amount: 40 } },
  { fileName: '发票1.pdf', amount: 20, issueDate: d(2026, 10, 20), projectName: '客运服务费' },
  { fileName: '发票2.pdf', amount: 40, issueDate: d(2026, 10, 20), projectName: '客运服务费' }
], CFG);
check('分组用行程单金额=40时只认领等额发票，合计仍=全部发票+补贴',
  mD3.grandTotal === 31000 && mD3.stats.invoiceCount === 2, String(mD3.grandTotal / 100));

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

/* ---------- 2b. 混合票（住宿+交通同一张发票）拆行 ---------- */
console.log('\n=== B2. 混合票按明细行拆到两列 ===');
const MIXSPLIT = [{ kind: 'lodging', amount: 200 }, { kind: 'transportOther', amount: 50 }];
const mMix = T.buildTripModel([
  { fileName: '携程商旅发票.pdf', amount: 250, issueDate: d(2026, 10, 20), projectName: '混合票据',
    docKind: 'mixed', splits: MIXSPLIT }
], CFG);
check('住宿 200 进住宿费列', mMix.totals.lodging === 20000, String(mMix.totals.lodging / 100));
check('交通 50 进车船费-其他', mMix.totals.transportOther === 5000, String(mMix.totals.transportOther / 100));
check('拆行合计不变（250）', mMix.totals.lodging + mMix.totals.transportOther === 25000,
  String((mMix.totals.lodging + mMix.totals.transportOther) / 100));
check('明细标为 mixed', mMix.stats.details[0].category === 'mixed', mMix.stats.details[0].category);
check('明细里两笔分摊金额可追溯',
  mMix.stats.details[0].pieces.length === 2 &&
  mMix.stats.details[0].pieces.reduce((s, p) => s + p.cents, 0) === 25000);
check('一张混合票只算一张（count=1）',
  mMix.dayRows.find(r => r.key === '2026-10-20').cells.count === 1);

// 人工指定费用列 = 明确结论，压过拆行
const mMixManual = T.buildTripModel([
  { fileName: '携程商旅发票.pdf', amount: 250, issueDate: d(2026, 10, 20), projectName: '混合票据',
    docKind: 'mixed', splits: MIXSPLIT, __reportCategory: 'lodging' }
], CFG);
check('人工指定「住宿费」后不再拆行', mMixManual.totals.lodging === 25000 &&
  mMixManual.totals.transportOther === 0,
  '住宿=' + (mMixManual.totals.lodging / 100) + ' 其他=' + (mMixManual.totals.transportOther / 100));

// 用户改过金额：按原比例归一，合计恒等于改后的金额（不出现少一分/多一分）
const mMixEdited = T.buildTripModel([
  { fileName: '携程商旅发票.pdf', amount: 300, issueDate: d(2026, 10, 20), projectName: '混合票据',
    docKind: 'mixed', splits: MIXSPLIT }
], CFG);
check('改金额后按比例重新拆分且合计一分不差',
  mMixEdited.totals.lodging === 24000 && mMixEdited.totals.transportOther === 6000,
  '住宿=' + (mMixEdited.totals.lodging / 100) + ' 其他=' + (mMixEdited.totals.transportOther / 100));

// 拆不干净（如 100 一分为三）也要保证尾差落到最大的一笔，合计恒等
const mMixOdd = T.buildTripModel([
  { fileName: 'x.pdf', amount: 100, issueDate: d(2026, 10, 20), projectName: '混合票据',
    docKind: 'mixed', splits: [{ kind: 'lodging', amount: 33.33 }, { kind: 'transportOther', amount: 66.67 }] }
], CFG);
check('拆分金额与票面不一致时归一（合计=100）',
  mMixOdd.totals.lodging + mMixOdd.totals.transportOther === 10000,
  String((mMixOdd.totals.lodging + mMixOdd.totals.transportOther) / 100));

// 卡片提示与表格必须用同一套归一口径：否则用户把 250 改成 275 后，
// 提示还写着「住宿费 200 + 车船 50」，而表里写的是 220/55 —— 提示反成误导。
const norm275 = T.utils.normalizeSplits(MIXSPLIT, 27500);
check('归一函数：改金额后按原比例给出两笔（220 / 55）',
  norm275 && norm275[0].cat === 'lodging' && norm275[0].cents === 22000 &&
  norm275[1].cat === 'transportOther' && norm275[1].cents === 5500,
  norm275 ? norm275.map(p => p.cat + ':' + p.cents).join(' ') : 'null');
check('归一函数：拆到不足一分的那笔剔除，退回单列',
  T.utils.normalizeSplits(MIXSPLIT, 1) === null,
  String(T.utils.normalizeSplits(MIXSPLIT, 1)));
check('归一函数：非数组/单笔输入安全返回 null',
  T.utils.normalizeSplits(null, 100) === null && T.utils.normalizeSplits([{ kind: 'lodging', amount: 5 }], 500) === null);

/* ---------- 2c. 同额多票：行程单配组不依赖遍历顺序 ---------- */
console.log('\n=== B3. 同额多票配组确定性 ===');
const CFG6 = { startDate: '2026-06-02', endDate: '2026-06-10', dailyAllowance: 50 };
const taxiLate = { fileName: 'taxi-A.pdf', amount: 12, issueDate: d(2026, 6, 9), projectName: '客运服务费' };
const taxiEarly = { fileName: 'taxi-B.pdf', amount: 12, issueDate: d(2026, 6, 3), projectName: '客运服务费' };
const tripFirst = { fileName: 'trip-1.pdf', amount: 12, isTrip: true,
  trip: { isTrip: true, primaryDate: '2026-06-02', dates: ['2026-06-02'], amount: 12 } };
const tripLast = { fileName: 'trip-2.pdf', amount: 12, isTrip: true,
  trip: { isTrip: true, primaryDate: '2026-06-10', dates: ['2026-06-10'], amount: 12 } };
function assignMap(model) {
  const out = {};
  (model.stats.details || []).forEach(d => { out[d.fileName] = (d.dates || [])[0] || ''; });
  return out;
}
const orderA = T.buildTripModel([taxiLate, taxiEarly, tripFirst, tripLast], CFG6);
const orderB = T.buildTripModel([tripLast, tripFirst, taxiEarly, taxiLate], CFG6);
const mapA = assignMap(orderA);
const mapB = assignMap(orderB);
check('同额两票：开票早的那张配 6-02 的行程', mapA['taxi-B.pdf'] === '2026-06-02', mapA['taxi-B.pdf']);
check('同额两票：开票晚的那张配 6-10 的行程', mapA['taxi-A.pdf'] === '2026-06-10', mapA['taxi-A.pdf']);
check('打乱输入顺序后配组结果完全一致',
  JSON.stringify(mapA) === JSON.stringify(mapB),
  JSON.stringify(mapB));
check('每天各 12 元、两天合计 24 元 + 补贴 450',
  orderA.dayRows.find(r => r.key === '2026-06-02').cells.taxi === 1200 &&
  orderA.dayRows.find(r => r.key === '2026-06-10').cells.taxi === 1200 &&
  orderA.grandTotal === 47400, String(orderA.grandTotal / 100));

/* ---------- 2d. 人工修正记录的寻址：按文件指纹，不按序号 ---------- */
console.log('\n=== B4. 人工修正不会因重传顺序变化而错位 ===');
const OV = T.utils.resolveOverride;
const OK = T.utils.overrideKey;
const fpA = '发票A.pdf::1000::1700000000000';
const fxA = '发票A.pdf::1000::1700000000001';

const ov1 = {};
ov1[OK('发票A.pdf', fpA, 0)] = { reportDate: '2026-10-20', category: 'lodging' };
check('键用文件指纹，与序号无关', OK('发票A.pdf', fpA, 0) === fpA && OK('发票A.pdf', fpA, 7) === fpA,
  OK('发票A.pdf', fpA, 7));
check('重传后序号平移仍命中同一条修正',
  OV(ov1, '发票A.pdf', fpA, 9) === ov1[fpA]);
check('文件另存后指纹变了，同名单条仍认（不让重下发票清空人工确认）',
  OV(ov1, '发票A.pdf', fxA, 0) === ov1[fpA]);

const ov2 = {};
ov2[fpA] = { reportDate: '2026-10-20' };
ov2[fxA] = { reportDate: '2026-10-21' };
check('同名两张票：指纹命中各自的一条', OV(ov2, '发票A.pdf', fxA, 0) === ov2[fxA]);
check('同名两张票且指纹未知：放弃匹配，绝不张冠李戴',
  OV(ov2, '发票A.pdf', '发票A.pdf::9999::1', 0) === null);
check('没有任何修正记录时返回 null', OV({}, '发票A.pdf', fpA, 0) === null);
check('只有一条兜底键（无指纹）时按文件名认', (function () {
  const ov3 = {}; ov3[OK('发票C.pdf', '', 2)] = { category: 'ticket' };
  return OV(ov3, '发票C.pdf', '', 5) === ov3['发票C.pdf::#2'];
})());

/* ---------- 2e. 负数金额 ---------- */
console.log('');
console.log('=== B5. 金额不允许负数 ===');
const mNeg = T.buildTripModel([
  { fileName: '负数票.pdf', amount: -100, issueDate: d(2026, 10, 20), projectName: '住宿费' }
], CFG);
check('负数金额不会把合计算成负数', mNeg.grandTotal === 25000, String(mNeg.grandTotal / 100));
check('负数金额不写入费用列', mNeg.totals.lodging === 0, String(mNeg.totals.lodging / 100));

/* ---------- 2f. 「待处理」口径 ---------- */
console.log('\n=== B6. 待处理 = 超范围 / 金额待核 / 拆分待确认 ===');
const pk = T.utils.pendingKinds;
check('正常的票不算待处理', pk({ amount: 100, amountSource: 'total' }, false).length === 0);
check('超范围算待处理', pk({ amount: 100, amountSource: 'total' }, true).join(',') === 'out');
check('票面没印价税合计（猜的）算待处理', pk({ amount: 100, amountSource: 'guess' }, false).join(',') === 'amount');
check('多金额取最大（yen）算待处理', pk({ amount: 100, amountSource: 'yen' }, false).join(',') === 'amount');
check('两个来源对不上算待处理', pk({ amount: 100, amountAlt: 99, amountSource: 'sole' }, false).join(',') === 'amount');
check('人工改过金额后不再待处理', pk({ amount: 100, amountSource: 'manual' }, false).length === 0);
const sp = [{ kind: 'lodging', amount: 200 }, { kind: 'transportOther', amount: 50 }];
check('混合票拆分待确认', pk({ amount: 250, amountSource: 'total', splits: sp }, false).join(',') === 'split');
check('人工指定费用列后不再问拆分', pk({ amount: 250, amountSource: 'total', splits: sp, __reportCategory: 'lodging' }, false).length === 0);
check('已移出的票不占待处理', pk({ amount: 100, amountSource: 'guess', __reportExcluded: true }, true).length === 0);
check('行程单不占待处理', pk({ isTrip: true, amount: 100 }, true).length === 0);
check('三类同时成立时按「超范围、金额、拆分」排序',
  pk({ amount: 250, amountSource: 'guess', splits: sp }, true).join(',') === 'out,amount,split');

/* ---------- 2g. 手动补录 ---------- */
console.log('\n=== B7. 手动补录（实体票不传文件） ===');
const mr = T.utils.manualReceipt;
const mInv = mr({ id: 'm1', amount: '88.50', category: 'lodging', date: '2026-06-05', name: '南宁柏曼酒店（纸质）' }, '2026-06-02');
check('金额字符串也认，按分取整', mInv.amount === 88.5 && Math.round(mInv.amount * 100) === 8850);
check('费用列原样保留', mInv.__reportCategory === 'lodging');
check('归行日期就是指定日期，来源标记为 manual',
  mInv.__reportDate === '2026-06-05' && mInv.dateSource === 'manual');
check('标记为手动、非行程单', mInv.__manual === true && mInv.isManual === true && mInv.isTrip === false);
check('金额来源 manual，不会进「金额待核」',
  mInv.amountSource === 'manual' && T.utils.pendingKinds(mInv, false).length === 0);
check('说明留空时给默认名', mr({ amount: 1, category: 'taxi', date: '2026-06-03' }).projectName === '纸质发票（手动录入）');
check('金额非法或负数一律归 0',
  mr({ amount: -5 }).amount === 0 && mr({ amount: 'abc' }).amount === 0 && mr({}).amount === 0);
check('费用列非法（如 allowance）退回普票费',
  mr({ amount: 1, category: 'allowance' }).__reportCategory === 'ticket');
check('日期非法退回出差开始日（不会落到今天/超范围）',
  mr({ amount: 1, date: '不是日期' }, '2026-06-02').__reportDate === '2026-06-02');

const mModel = T.buildTripModel([mInv], CFG6);
check('手动票按指定日期落进指定列',
  mModel.dayRows.find(r => r.key === '2026-06-05').cells.lodging === 8850);
check('手动票计入合计（金额 + 补贴）', mModel.grandTotal === 8850 + 450 * 100, String(mModel.grandTotal / 100));
check('归行依据写「人工确认日期」', (mModel.stats.details[0] || {}).by === '人工确认日期');

// 金额恰好等于某张行程单时，手动票也不该被认领走（否则用户指定的日期会被改）
const mPair = T.buildTripModel([
  { fileName: '行程单.pdf', amount: 88.5, isTrip: true,
    trip: { isTrip: true, primaryDate: '2026-06-03', dates: ['2026-06-03'], amount: 88.5 } },
  mInv
], CFG6);
check('手动票不被行程单认领，日期不被改走',
  mPair.dayRows.find(r => r.key === '2026-06-05').cells.lodging === 8850 &&
  mPair.dayRows.find(r => r.key === '2026-06-03').cells.lodging === 0);

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
check('表头日期格式 2026年10月19日- 10月23日',
  htmlA.includes('2026年10月19日- 10月23日') &&
  !htmlA.includes(' ~ ') && !htmlA.includes(' 年 '),
  (htmlA.match(/2026年[^<]*/) || [''])[0]);
const crossYearHtml = T.generateExpenseReportHTML([], null,
  { startDate: '2026-12-30', endDate: '2027-01-02', dailyAllowance: 50 },
  { numberToChinese: toChinese });
check('跨年日期格式 2026年12月30日- 2027年1月2日',
  crossYearHtml.includes('2026年12月30日- 2027年1月2日'));
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
const previewWithMeta = T.generateExpenseReportHTML(outInvoices, null, CFG2, previewHelpers);
check('预览格带日期/费用列/票据数定位属性',
  previewWithMeta.includes('data-row-key="2026-10-20"') &&
  previewWithMeta.includes('data-cat="ticket"') &&
  previewWithMeta.includes('data-source-count="1"'));
check('正式 PDF 输出不混入编辑定位属性', !htmlA.includes('data-row-key=') && !htmlA.includes('data-cat='));
check('模型暴露「单元格 -> 票据」映射',
  (a1.model.cellSources['2026-10-20|ticket'] || []).some(s => s.index === 2 && s.cents === 10000),
  JSON.stringify(a1.model.cellSources['2026-10-20|ticket'] || []));
check('超范围行也暴露票据映射',
  (a1.model.cellSources['__out__|taxi'] || []).some(s => s.index === 0 && s.cents === 3025));

// 行程卡片配组 + 预览 chip（预览编辑视图，不参与金额口径）
check('模型派生行程卡片配组：发票带同额行程单',
  (a1.model.groups || []).some(g => g.key === 'inv-0' && g.invoiceIndices[0] === 0 && g.tripIndices.indexOf(1) !== -1),
  JSON.stringify((a1.model.groups || []).map(g => ({ key: g.key, trips: g.tripIndices }))));
check('配组金额取发票、不重复计行程单',
  (a1.model.groups || []).filter(g => g.key === 'inv-0').every(g => g.amountCents === 3025 && g.trips[0].amountCents === 3025));
check('无行程单的发票单独成组',
  (a1.model.groups || []).some(g => g.key === 'inv-2' && g.tripIndices.length === 0 && g.amountCents === 10000));
check('预览金额格含发票图标 chip',
  previewWithMeta.includes('class="erc-chip"') && previewWithMeta.includes('data-chip-idx="0"') &&
  previewWithMeta.includes('🎫'));
check('正式 PDF 输出不含 chip 与类别样式',
  !htmlA.includes('erc-chip') && !htmlA.includes('data-chip-idx') && !htmlA.includes('CAT_STYLE'));
check('预览 chip 可拖拽（draggable）', previewWithMeta.includes('draggable="true"') && previewWithMeta.includes('data-chip-idx="0"'));

// 移出表格：__reportExcluded 的发票不计入格子/合计/问题，但仍保留卡片可拖回
const excludedData = outInvoices.map(inv => Object.assign({}, inv));
excludedData[0].__reportExcluded = true; // 30.25 超范围那张移出
const ax = T.analyzeExpenseReport(excludedData, CFG2);
check('移出票据不进入问题列表', ax.issues.length === 0, 'issues=' + ax.issues.length);
check('移出票据不计入合计（原合计 - 该票 30.25 元）',
  ax.model.grandTotal === a1.model.grandTotal - 3025,
  `total=${ax.model.grandTotal} before=${a1.model.grandTotal}`);
check('移出票据不占超范围行', ax.model.outRow === null && ax.model.stats.outOfRangeCount === 0);
check('移出计数与明细标记', ax.model.stats.excludedCount === 1 &&
  ax.model.stats.details.some(d => d.index === 0 && d.excluded === true));
check('移出票据仍保留卡片供拖回',
  (ax.model.groups || []).some(g => g.key === 'inv-0' && g.excluded === true &&
    g.invoiceIndices.indexOf(0) !== -1));
check('移出后预览不再含该票 chip', (() => {
  const h = T.generateExpenseReportHTML(excludedData, null, CFG2, previewHelpers);
  return !h.includes('data-chip-idx="0"') && h.includes('data-chip-idx="2"');
})());
check('正式 PDF 移出后合计不含该票且不混入 excluded 字段', (() => {
  const h = T.generateExpenseReportHTML(excludedData, null, CFG2, { numberToChinese: toChinese });
  return h.includes('width:794px;height:1123px') && !h.includes('__reportExcluded');
})());
// 重新拖回（清除 __reportExcluded）后完全恢复
const restored = excludedData.map(inv => Object.assign({}, inv));
delete restored[0].__reportExcluded;
const ar = T.analyzeExpenseReport(restored, CFG2);
check('移出后再拖回，金额与问题全部恢复',
  ar.model.grandTotal === a1.model.grandTotal && ar.issues.length === a1.issues.length);

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
console.log('\n=== E. 生成链路（main.html + main-bootstrap.js） ===');
// 报销单生成链路已从 main.html 拆到 static/js/custom/main-bootstrap.js，
// 两处拼起来才是完整源码，只读 main.html 会全部误报 FAIL。
const mainHtml = fs.readFileSync(path.join(__dirname, 'main.html'), 'utf8') + '\n' +
  fs.readFileSync(path.join(__dirname, 'static/js/custom/main-bootstrap.js'), 'utf8');
check('两条入口统一走同一个确认窗口',
  mainHtml.includes('window.generateExpenseReportManual = generateExpenseReport;') &&
  !mainHtml.includes('async function generateExpenseReportManual()'));
check('生成前强制调用确认窗口', /const confirmedData = await showExpenseReportConfirmDialog/.test(mainHtml));
check('未修正超范围时确认按钮被禁用', mainHtml.includes('confirmBtn.disabled = blocked'));
check('确认窗口含实时预览与问题定位', mainHtml.includes('{ preview: true }') && mainHtml.includes('定位第 1 笔'));
check('确认窗口改为「预览即画布」', mainHtml.includes('点击日期行或金额格直接修改对应票据') &&
  mainHtml.includes('data-pop-open-list'));
check('右侧抽屉保留待处理与全部票据两种视图',
  mainHtml.includes('data-tab="issues"') && mainHtml.includes('data-tab="all"'));
check('右侧默认停在「待处理」，待处理清零后自动回「全部票据」',
  mainHtml.includes('else if (!sideTabPinned) sideTab = \'issues\'') &&
  mainHtml.includes('if (!summary.length) sideTab = \'all\''));
check('用户手动切过标签后不再被自动切走', mainHtml.includes('sideTabPinned = true'));
check('「待处理」排在「全部票据」前面（默认视图不该是第二个标签）',
  mainHtml.indexOf('data-tab="issues"') < mainHtml.indexOf('data-tab="all"'));
check('待处理列表顶部给出分类小结与「改好会自动移出」提示',
  mainHtml.includes('erc-pend-strip') && mainHtml.includes('改好会自动移出这里'));
check('金额待核的票在卡片上有可读标签（不只是金额框里的「!」）',
  mainHtml.includes('erc-pend-amount') && mainHtml.includes('金额待核'));
check('右侧有「手动补录」入口（实体票没上传时的兜底）',
  mainHtml.includes('id="erc_manual_new"') && mainHtml.includes('＋ 手动补录'));
check('补录表单只要金额 + 费用列 + 日期（说明可选）',
  mainHtml.includes('data-manual-field="amount"') && mainHtml.includes('data-manual-field="cat"') &&
  mainHtml.includes('data-manual-field="date"') && mainHtml.includes('data-manual-field="name"'));
check('手动票在卡片上标「手动」且能彻底删除（与「移出」区分）',
  mainHtml.includes('erc-manual-tag') && mainHtml.includes('data-manual-del'));
check('手动条目单独存 __manualReceipts，不混进识别缓存与 overrides',
  mainHtml.includes('window.__manualReceipts') && mainHtml.includes('if (inv && inv.__manual) return;'));
check('空白格也能直接补录（日期与费用列已带好）',
  mainHtml.includes('data-manual-here') && mainHtml.includes('补录一张纸质票到这一格'));
check('手动票的类别下拉没有「自动识别」档（无票面可认）',
  mainHtml.includes('选择这条手动记录填入的费用列'));
check('一张票都没上传时，有手动补录也能出单（不被「请先上传发票」挡住）',
  mainHtml.includes('或点「＋ 手动补录」添加一张纸质票') && mainHtml.includes('if (!loadManualReceipts().length)'));
check('窄屏可在预览/票据视图间切换',
  mainHtml.includes('data-view="preview"') && mainHtml.includes('data-view="tickets"'));
check('原尺寸预览仍走无编辑属性的正式 HTML',
  mainHtml.includes('generateExpenseReportHTML(draft, null, cfg) +'));
check('人工修正持久化到下次生成',
  mainHtml.includes('saveExpenseReportOverrides') && mainHtml.includes('applyExpenseReportOverrides'));
check('日期格式化改用本地年月日（修复少一天）', mainHtml.includes("getMonth() + 1).padStart(2, '0')"));
check('报销单卡片观察器与新统计卡片兼容（认「发票统计」标题，不被误删）',
  mainHtml.includes("发票统计') || t.includes('发票数量')"));
check('报销单在离屏沙箱里栅格化（主文档 980 条全局 CSS 会让 html2canvas 慢 5 倍）',
  mainHtml.includes('createReportSandbox') && mainHtml.includes('scale: rasterScale'));
check('报销单图片走 JPEG 直传（跳过多 MB 的 base64 与二次 deflate）',
  mainHtml.includes("toBlob(res, 'image/jpeg'") && mainHtml.includes("'JPEG'"));
check('金额输入框带 min="0"（键盘与上下箭头都填不进负数）',
  (mainHtml.match(/class="erc-input erc-amount"[^>]*min="0"/g) || []).length >= 2);
check('负数金额在写入草稿前被夹到 0',
  mainHtml.includes('Math.max(0, v)') && mainHtml.includes('金额不能为负'));
check('混合票在卡片上写明拆分到哪两列',
  mainHtml.includes('混合票已按票面明细拆分'));
check('拖拽只改归行日、不擅自合并混合票的拆分',
  mainHtml.includes('function applyCategory(idx, cat)') &&
  mainHtml.includes('if (Array.isArray(inv.splits) && inv.splits.length > 1) return;'));
check('人工修正记录按文件指纹寻址（重传顺序变化不再错位）',
  mainHtml.includes('findFileKeyByName') && mainHtml.includes('resolveOverride'));
check('混合票卡片提示用归一后的金额（改金额后提示不会与表内数打架）',
  /normalizeSplits\(inv\.splits/.test(mainHtml));
check('「填入位置」保留「自动识别」档（混合票的人工指定可撤销、拆分能恢复）',
  mainHtml.includes('自动识别（') && mainHtml.includes('恢复按票据内容判断'));
// app 用 Radix 弹窗时会把 body 锁成 pointer-events:none，浮层挂在 body 下会继承它，
// 表现为「弹窗画得好好的，鼠标点哪都没反应」。浮层必须显式声明 auto。
check('确认弹窗显式 pointer-events:auto（不被 app 的 body 锁带着一起失效）',
  /overlay\.style\.cssText = '[^']*pointer-events:auto/.test(mainHtml));
const tripRangeSrc = fs.readFileSync(path.join(__dirname, 'static/js/custom/trip-date-range.js'), 'utf8');
check('区间控件选完开始日就进入「等待结束日」（否则结束日永远改不了）',
  /start = k;[\s\S]{0,320}?picking = 'end';/.test(tripRangeSrc) &&
  !/picking = end \? 'start' : 'end';/.test(tripRangeSrc));

// 打包清单：真票诊断页会打印票面关键词与金额，只用于开发，不能随发行版分发
const buildExeSrc = fs.readFileSync(path.join(__dirname, 'build-exe.js'), 'utf8');
check('真票诊断页不打进 exe', !/const TOP = \[[^\]]*verify-trip-detection/.test(buildExeSrc));
check('exe 仍嵌入主页面与静态资源',
  /const TOP = \[[^\]]*'main\.html'/.test(buildExeSrc) && buildExeSrc.includes("walk('static')"));
check('重识别改为增量（跳过已识别 PDF，避免反复生成全量重解析）',
  /!cache\[(?:name|key)\]\)/.test(mainHtml) && mainHtml.includes('refreshInvoiceRecognition'));

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
