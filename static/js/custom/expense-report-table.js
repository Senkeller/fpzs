/*
 * 差旅费报销单表格生成（二次开发）
 * ------------------------------------------------------------------
 * 表格结构（10 列）：
 *   日期 | 出差地点 | 出差原因 | 车船费(普票费 / 打的费 / 其他) | 住宿费 | 补贴 | 其他(退票费) | 小计
 *
 * 业务规则：
 *   - 用户指定出差起止日期，范围内每天一行，补贴默认 50 元/天；
 *     未指定时，区间按「行程单的真实出差日」推断（绝不用未配行程单发票的开票日期，
 *     否则会把补贴算到开票日上——这是已修复的 bug）；
 *   - 发票金额按项目名归到对应费用列（关键词可在 config.keywords 里改）；
 *   - 行程单不是发票：仅用于「金额核对 + 提供真实乘车日期」，不重复计金额；
 *     单张行程单金额 == 发票金额，或多张行程单金额之和 == 发票金额时配对成功，
 *     配对成功后按行程单日期归行；否则退回开票日期；
 *   - 没有行程单且开票日期超出出差范围的票据，单列为「超范围票据」（不计补贴）；
 *   - inv.__reportDate（生成前人工确认的归行日期）优先级最高：
 *     存在时直接按该日期归行，用于在生成前修正识别错误的票据日期；
 *   - inv.__reportCategory（生成前人工选定的「填入位置/费用列」）优先级最高：
 *     存在时覆盖关键词自动归类，用于在生成前修正识别错误/归类模糊的发票费用列。
 *
 * 浏览器：window.__expenseReportTable
 * Node：require('./expense-report-table.js')  （供验证脚本直接调用 buildTripModel）
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.__expenseReportTable = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function () {
  'use strict';

  var DEFAULT_CONFIG = {
    startDate: '',
    endDate: '',
    location: '',
    reason: '',
    traveler: '',
    formNo: 'YF-FBCW10-2022',
    dailyAllowance: 50,
    maxDays: 62,
    rowsPerPage: 20,
    showRowSubtotal: false,
    keywords: {
      // 普票费：车票/机票/通行费等票据类交通费
      ticket: ['火车', '铁路', '高铁', '动车', '车票', '机票', '航空', '航班', '船票', '长途汽车', '客运票', '通行费', '普票', '客票', '过路费'],
      // 打的费：网约车/出租车（滴滴发票项目名常为「客运服务费」）
      taxi: ['客运服务', '网约车', '打车', '出租', '滴滴', '用车', '出行', '行程单', '高德', '曹操', 'T3', 'taxi', 'ride', 'trip', 'itinerary', '约车', '快车', '专车'],
      // 车船费-其他：其余交通类
      transportOther: ['加油', '停车', '地铁', '公交', '车船', '交通', '运输服务', '客运'],
      // 住宿费
      lodging: ['住宿', '酒店', '宾馆', '客房', '民宿', '旅馆', '客栈', '房费', '间夜', '代订住宿', '入住', '退房'],
      // 其他（退票费）
      refund: ['退票', '改签', '退费', '手续费', '其他']
    }
  };

  // 数值列顺序 = 表格列顺序（不含小计）
  var COLS = ['ticket', 'taxi', 'transportOther', 'lodging', 'allowance', 'refund'];
  var COL_LABEL = {
    ticket: '普票费', taxi: '打的费', transportOther: '车船费-其他',
    lodging: '住宿费', allowance: '补贴', refund: '其他（退票费）',
    // 混合票在明细/诊断里用它标识「这张票同时落进了住宿费与车船费」
    mixed: '混合（住宿+交通）'
  };
  // 可在确认弹窗里手动指定的「发票填入费用列」（补贴由天数决定，不允许发票占位）
  var SELECTABLE_CATS = ['ticket', 'taxi', 'transportOther', 'lodging', 'refund'];
  // 预览 chip / 卡片用的类别视觉标识：小图标 + 主题色，五类费用一眼可分。
  var CAT_STYLE = {
    ticket: { icon: '🎫', color: '#1d4ed8', bg: '#eff6ff', border: '#bfdbfe' },
    taxi: { icon: '🚕', color: '#b45309', bg: '#fffbeb', border: '#fde68a' },
    transportOther: { icon: '🚌', color: '#0f766e', bg: '#f0fdfa', border: '#99f6e4' },
    lodging: { icon: '🏨', color: '#7c3aed', bg: '#faf5ff', border: '#ddd6fe' },
    refund: { icon: '↩️', color: '#be123c', bg: '#fff1f2', border: '#fecdd3' },
    allowance: { icon: '💰', color: '#15803d', bg: '#f0fdf4', border: '#bbf7d0' },
    trip: { icon: '📋', color: '#475569', bg: '#f8fafc', border: '#cbd5e1' }
  };

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }
  // 'YYYY-MM-DD' → 原件口径 'YYYY/M/D'
  function cnDayKey(k) {
    var d = parseDay(k);
    return d ? d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate() : String(k || '');
  }

  function parseDay(v) {
    if (!v) return null;
    if (v instanceof Date) {
      return isNaN(v.getTime()) ? null : new Date(v.getFullYear(), v.getMonth(), v.getDate());
    }
    if (typeof v === 'number') {
      var dn = new Date(v);
      return isNaN(dn.getTime()) ? null : new Date(dn.getFullYear(), dn.getMonth(), dn.getDate());
    }
    var m = String(v).trim().match(/(20\d{2})\s*[-/年.]\s*(\d{1,2})\s*[-/月.]\s*(\d{1,2})/);
    if (!m) return null;
    var y = parseInt(m[1], 10), mo = parseInt(m[2], 10), d = parseInt(m[3], 10);
    // 只允许月内真实天数：2 月 31 日会被 JS 静默滚到 3 月，导致报销归行日期错误。
    var maxDay = (y >= 2015 && y <= 2035 && mo >= 1 && mo <= 12) ? new Date(y, mo, 0).getDate() : 0;
    if (y < 2015 || y > 2035 || mo < 1 || mo > 12 || d < 1 || d > maxDay) return null;
    return new Date(y, mo - 1, d);
  }

  function dayKey(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function slashDate(d) { return d.getFullYear() + '/' + pad2(d.getMonth() + 1) + '/' + pad2(d.getDate()); }
  function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); }

  function mergeConfig(input) {
    var cfg = Object.assign({}, DEFAULT_CONFIG, input || {});
    cfg.keywords = Object.assign({}, DEFAULT_CONFIG.keywords, (input && input.keywords) || {});
    cfg.dailyAllowance = Math.max(0, parseFloat(cfg.dailyAllowance) || 0);
    cfg.rowsPerPage = Math.max(1, parseInt(cfg.rowsPerPage, 10) || 8);
    cfg.maxDays = Math.max(1, parseInt(cfg.maxDays, 10) || 62);
    return cfg;
  }

  function emptyCell() {
    return { ticket: 0, taxi: 0, transportOther: 0, lodging: 0, allowance: 0, refund: 0, count: 0 };
  }
  function sumCell(c) { return COLS.reduce(function (s, k) { return s + c[k]; }, 0); }

  function categorize(inv, cfg) {
    // 人工指定优先：确认弹窗里用户手动选了「填入位置（费用列）」时，
    // 直接采用，避免关键词误判。仅接受合法可选类别，防止脏数据污染模型。
    if (inv && inv.__reportCategory && SELECTABLE_CATS.indexOf(inv.__reportCategory) !== -1) {
      return inv.__reportCategory;
    }
    var text = ((inv && (inv.projectName || inv.itemName || inv.name) || '') + ' ' +
      ((inv && inv.fileName) || '')).toLowerCase();
    // 混合票（住宿与交通开在同一张发票上）：卡片按金额大的那一类着色，
    // 真正的金额拆分由 buildTripModel 里的 piecesOf 完成，这里只决定卡片颜色/标题。
    if (inv && inv.docKind === 'mixed' && Array.isArray(inv.splits) && inv.splits.length > 1) {
      var lg = null, tp = 0;
      inv.splits.forEach(function (s) {
        if (s.kind === 'lodging') lg = (lg || 0) + (parseFloat(s.amount) || 0);
        else tp += (parseFloat(s.amount) || 0);
      });
      return (lg || 0) >= tp ? 'lodging' : 'transportOther';
    }
    // 识别阶段给出的票据类型硬结论优先：住宿票绝不进交通列，班车票绝不进「打的费」。
    // 携程代订住宿票的项目名是「生产生活服务*经纪代理服务*代订住宿费」，
    // 单靠关键词会被兜底成「车船费-其他」，所以必须先用 docKind 定性。
    if (inv && inv.docKind === 'lodging') return 'lodging';
    if (inv && inv.docKind === 'bus') return 'transportOther';
    // 汽车票 / 长途汽车票 / 客运班车：归「车船费-其他」（与莫干山报销模板一致，普票费留空）
    if (/汽车票|长途汽车|汽车站|客运站|客运班车|公共交通|运输集团/.test(text) &&
        !/网约车|打车|出租|滴滴|高德|哈啰|曹操|行程单|itinerary/.test(text)) return 'transportOther';
    // 住宿：项目名/备注出现住宿类字样，先于交通关键词判定
    if (/住宿|酒店|宾馆|客房|民宿|旅馆|客栈|房费|间夜|入住|退房/.test(text)) return 'lodging';
    var kw = (cfg && cfg.keywords) ? cfg.keywords : DEFAULT_CONFIG.keywords;
    // 顺序即优先级：refund 先认（退票费常带交通票种词），ticket 必须排在 taxi 前面。
    // 原因：taxi 关键词里有「行程单」，而航空运输电子客票的法定单据就叫
    // 「航空运输电子客票行程单」，用户存成「机票行程单.pdf」时会被 taxi 抢走，
    // 880 元的机票被算进「打的费」——这是真实票上出现过的错法。
    var groups = ['refund', 'lodging', 'ticket', 'taxi', 'transportOther'];
    for (var i = 0; i < groups.length; i++) {
      var g = groups[i];
      var words = kw[g] || [];
      for (var j = 0; j < words.length; j++) {
        if (text.indexOf(String(words[j]).toLowerCase()) !== -1) return g;
      }
    }
    return 'transportOther'; // 未识别的一律进「车船费-其他」，绝不丢钱
  }

  // 金额仲裁：识别结果与 React 解析器给出的数不一致时，判断该信谁，并把另一个数一并返回。
  //   · 识别到票面「价税合计（小写）」或行程单核对金额 → 这是法定总额，识别结果拍板
  //     （React 那边是靠版面猜的，读错一位数很常见）
  //   · 只有「金额：¥88.50」这类散字段（amountSource=guess/yen）→ 是打分猜的，
  //     不能拿它顶掉别人的数，让 React 先上，猜错了还有兜底
  //   · 两者都有且对不上时，返回 amountAlt 供 UI 提示用户核对 —— 绝不静默只用一个
  // 人工修正记录（确认弹窗里改过的项目名/金额/费用列/归行日期）的寻址。
  // 键用「文件指纹」而不是「文件名 + 序号」：用户重传同一批票据、或增删其中
  // 一两张时序号会整体平移，按序号查会把上次核对的结果静默套到别的票上。
  //   · 指纹（name::size::lastModified）命中 → 就是这张票
  //   · 指纹变了（另存/重新导出）但文件名唯一命中 → 仍认，避免一次重下发票就全清空
  //   · 同名多条 → 放弃匹配，宁可让用户重新确认，也不能张冠李戴
  function overrideKey(fileName, fingerprint, idx) {
    var name = String(fileName || '');
    return fingerprint || (name + '::#' + idx);
  }

  function resolveOverride(ov, fileName, fingerprint, idx) {
    if (!ov) return null;
    if (fingerprint && ov[fingerprint]) return ov[fingerprint];
    var name = String(fileName || '');
    if (!name) return null;
    if (ov[name + '::#' + idx]) return ov[name + '::#' + idx];
    var hits = Object.keys(ov).filter(function (k) {
      return k === name || k.indexOf(name + '::') === 0;
    });
    if (hits.length === 1) return ov[hits[0]];
    // 同一张票可能同时留着兜底键与指纹键：都指向同一条记录时仍算唯一命中
    if (hits.length > 1) {
      var first = ov[hits[0]];
      if (hits.every(function (k) { return ov[k] === first; })) return first;
    }
    return null;
  }

  function pickAmount(cached, reactAmount) {
    var c = cached || {};
    var recognized = typeof c.amount === 'number' && isFinite(c.amount) ? c.amount : 0;
    var hasReact = typeof reactAmount === 'number' && isFinite(reactAmount);
    var trusted = (c.amountSource === 'total' || c.amountSource === 'sole' || c.amountSource === 'trip') && recognized > 0;
    var amount = trusted ? recognized : (hasReact ? reactAmount : recognized);
    var alt = null, altFrom = '';
    if (hasReact && recognized > 0) {
      if (amount === recognized && Math.abs(reactAmount - recognized) >= 0.01) {
        alt = reactAmount; altFrom = 'react';
      } else if (amount === reactAmount && Math.abs(recognized - reactAmount) >= 0.01) {
        alt = recognized; altFrom = 'recognition';
      }
    }
    return {
      amount: amount,
      amountAlt: alt,
      amountAltFrom: altFrom,
      amountSource: c.amountSource || ''
    };
  }

  // 在候选行程单里找金额之和等于发票金额的组合（单位：分，容差 2 分）
  function findSubset(pool, target) {
    var found = null;
    function dfs(i, sum, picked) {
      if (found) return;
      if (Math.abs(sum - target) <= 2 && picked.length > 0) { found = picked.slice(); return; }
      if (i >= pool.length || sum > target + 2) return;
      picked.push(pool[i]);
      dfs(i + 1, sum + pool[i].amount, picked);
      picked.pop();
      dfs(i + 1, sum, picked);
    }
    dfs(0, 0, []);
    return found;
  }

  // 混合票的每一笔金额归一：比例沿用票面，总额恒等于当前票面金额（用户可能改过），
  // 尾差补给最大的一笔。归一后不足一分的那笔剔除。
  // 确认弹窗的「已按票面明细拆分：…」提示也用它，保证提示里的数与表里写的一致。
  function normalizeSplits(rawSplits, totalCents) {
    if (!Array.isArray(rawSplits) || rawSplits.length < 2) return null;
    var cents = Math.max(0, Math.round(totalCents || 0));
    var raw = [];
    rawSplits.forEach(function (s) {
      var c = Math.round((parseFloat(s && s.amount) || 0) * 100);
      if (c > 0) raw.push({ cat: s.kind === 'lodging' ? 'lodging' : 'transportOther', cents: c });
    });
    if (raw.length < 2) return null;
    var sum = raw.reduce(function (a, p) { return a + p.cents; }, 0);
    if (sum !== cents && sum > 0) {
      raw.forEach(function (p) { p.cents = Math.round(cents * p.cents / sum); });
      var acc = raw.reduce(function (a, p) { return a + p.cents; }, 0);
      var diff = cents - acc;
      if (diff !== 0) {
        var big = raw.slice().sort(function (a, b) { return b.cents - a.cents; })[0];
        big.cents += diff;
      }
    }
    // 归一后掉到 0 分的那一笔等于不存在，别让它占一行明细
    var kept = raw.filter(function (p) { return p.cents > 0; });
    return kept.length > 1 ? kept : null;
  }

  function buildTripModel(invoiceData, cfgInput) {
    var cfg = mergeConfig(cfgInput);
    var all = (invoiceData || []).filter(Boolean);
    var tripDocs = all.filter(function (i) { return i.isTrip; });
    var invoices = all.filter(function (i) { return !i.isTrip; });

    var stats = {
      invoiceCount: invoices.length,
      tripDocCount: tripDocs.length,
      matchedInvoices: 0,
      unmatchedTrips: 0,
      mismatch: 0,
      outOfRangeCount: 0,
      excludedCount: 0,
      truncatedDays: false,
      details: []
    };

    var tripCandidates = tripDocs.map(function (t) {
      var tr = t.trip || {};
      var dates = (tr.preferredDates && tr.preferredDates.length ? tr.preferredDates : (tr.dates || [])).slice();
      dates.sort();
      return {
        index: all.indexOf(t),
        fileName: t.fileName || '',
        date: tr.primaryDate || dates[0] || '',
        amount: Math.round((parseFloat(tr.amount != null ? tr.amount : t.amount) || 0) * 100),
        used: false
      };
    });

    // 出差起止日期：优先用户选择，否则按「真实出差日」推断。
    // 关键修复：没有行程单的「待定」发票，其开票日期只是收据打印日，
    // 不能用来推断 / 撑大出差区间，否则会把补贴算到开票日上（bug）。
    // 仅在没有行程单、无法从真实出差日推断时，才退回发票开票日期。
    var datePool = [];
    tripCandidates.forEach(function (t) {
      var d = parseDay(t.date);
      if (d) datePool.push(d);
    });
    if (datePool.length === 0) {
      // 一张行程单都没有时才退回发票日期推断。仍分两档：
      //   ① 票面真实出行日/入住日（dateSource=travel/stay）——可信；
      //   ② 都拿不到才用开票日兜底（开票日只是打印日，容易把区间撑大）。
      invoices.forEach(function (inv) {
        var src = inv.dateSource || '';
        if (src !== 'travel' && src !== 'stay') return;
        var d = parseDay(inv.date || inv.issueDate);
        if (d) datePool.push(d);
      });
      if (datePool.length === 0) {
        invoices.forEach(function (inv) {
          var d = parseDay(inv.issueDate || inv.date);
          if (d) datePool.push(d);
        });
      }
    }
    var today = new Date();
    today = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    var start = parseDay(cfg.startDate) ||
      (datePool.length ? new Date(Math.min.apply(null, datePool.map(Number))) : today);
    var end = parseDay(cfg.endDate) ||
      (datePool.length ? new Date(Math.max.apply(null, datePool.map(Number))) : start);
    if (end < start) { var tmp = start; start = end; end = tmp; }

    var dayList = [];
    var cur = start;
    while (cur <= end && dayList.length < cfg.maxDays) {
      dayList.push(dayKey(cur));
      cur = addDays(cur, 1);
    }
    stats.truncatedDays = cur <= end;

    var cells = {};
    // 预览编辑用：金额格/日期行 -> 原始票据索引。正式 PDF 不依赖这些数据。
    // 一张汇总发票可能按多张行程单拆到多个日期，所以这里按「每一笔分摊」记录。
    var cellSources = {};
    var rowSources = {};
    var allowanceCents = Math.round(cfg.dailyAllowance * 100);
    dayList.forEach(function (k) {
      cells[k] = emptyCell();
      cells[k].allowance = allowanceCents;
    });
    var outCell = emptyCell();
    var outDates = {};

    // ------------------------------------------------------------------
    // 金额口径（用户确认）：金额一律以发票为准、整笔填一次；行程单金额
    // 只用于「把发票归到同一张卡」，既不写入格子，也不参与合计。
    // 分组以行程单为锚点：行程单金额(分)严格等于某几张发票金额之和时，
    // 这几张发票归为该行程单的一组；未被认领的发票各自单独成组。
    // ------------------------------------------------------------------
    function centsOf(inv) { return Math.max(0, Math.round((parseFloat(inv && inv.amount) || 0) * 100)); }

    // 一张票可能拆成多笔（混合票：住宿 + 交通开在同一张发票上）。
    // 普通票只有一笔，金额 = 票面额；拆出的每一笔写入不同费用列，合计恒等于票面金额。
    // 用户在弹窗里手工指定「填入位置」后不再拆分——那是明确的人工结论。
    function piecesOf(inv) {
      var cents = centsOf(inv);
      var manual = inv && inv.__reportCategory;
      if (manual && SELECTABLE_CATS.indexOf(manual) !== -1) return [{ cat: manual, cents: cents }];
      var sp = normalizeSplits(inv && inv.splits, cents);
      if (!sp) return [{ cat: categorize(inv, cfg), cents: cents }];
      return sp;
    }

    // 在候选发票里找金额之和【严格等于】target 的组合（单位：分，无容差）。
    // 优先单张完全相等，其次多张（最多 12 张，避免组合爆炸）。
    // 在候选发票里找「金额相等」的一张：同额多张时必须挑离行程日最近的那张，
    // 否则两段行程（各 12 元）+ 两张 12 元发票会按文件顺序乱配，
    // 「6-02 的行程配到 6-09 开的票」，归行日期整片错位。
    function nearestByDate(list, preferTs) {
      var best = list[0];
      var bestGap = Math.abs((best.ts || 0) - (preferTs || 0));
      for (var i = 1; i < list.length; i++) {
        var gap = Math.abs((list[i].ts || 0) - (preferTs || 0));
        if (gap < bestGap) { best = list[i]; bestGap = gap; }
      }
      return best;
    }

    function findInvoiceSubset(pool, target, preferTs) {
      var singles = pool.filter(function (p) { return p.cents === target; });
      if (singles.length) return [nearestByDate(singles, preferTs)];
      var found = null;
      var limit = pool.slice(0, 12);
      function dfs(i, sum, picked) {
        if (found) return;
        if (sum === target && picked.length > 1) { found = picked.slice(); return; }
        if (i >= limit.length || sum > target) return;
        picked.push(limit[i]);
        dfs(i + 1, sum + limit[i].cents, picked);
        picked.pop();
        dfs(i + 1, sum, picked);
      }
      dfs(0, 0, []);
      return found;
    }

    var usedInvoice = {};
    var matchedInvoice = {};
    var claimedTrip = {};
    var tripGroups = [];   // { invoiceIndices:[...], trip: tripCandidate|null }

    // 配组顺序也要确定：按行程日期从早到晚处理，同一天再按原始顺序。
    // 这样「先被认领的是哪张发票」不再取决于上传/遍历顺序，重跑结果可复现。
    var tripOrder = tripCandidates.slice().sort(function (a, b) {
      var da = a.date || '', db = b.date || '';
      if (da !== db) return da < db ? -1 : 1;
      return a.index - b.index;
    });

    tripOrder.forEach(function (trip) {
      if (!(trip.amount > 0)) return;
      var preferTs = (parseDay(trip.date) || { getTime: function () { return 0; } }).getTime();
      var pool = invoices.filter(function (inv) {
        return !usedInvoice[all.indexOf(inv)] && centsOf(inv) > 0;
      }).map(function (inv) {
        var d0 = parseDay(inv.__reportDate) || parseDay(inv.issueDate || inv.date);
        return { idx: all.indexOf(inv), cents: centsOf(inv), ts: d0 ? d0.getTime() : 0 };
      });
      // 先按「距行程日的远近」再按原始顺序，DFS 取到的第一种组合也就是最合理的那种
      pool.sort(function (a, b) {
        var gap = Math.abs(a.ts - preferTs) - Math.abs(b.ts - preferTs);
        return gap !== 0 ? gap : a.idx - b.idx;
      });
      var subset = findInvoiceSubset(pool, trip.amount, preferTs);
      if (subset && subset.length) {
        subset.forEach(function (s) {
          usedInvoice[s.idx] = true;
          matchedInvoice[s.idx] = true;
        });
        claimedTrip[trip.index] = true;
        tripGroups.push({
          invoiceIndices: subset.map(function (s) { return s.idx; }),
          trip: trip
        });
      }
    });
    // 没有行程单认领的发票：各自单独成组，按开票日期归行。
    invoices.forEach(function (inv) {
      var idx = all.indexOf(inv);
      if (usedInvoice[idx]) return;
      tripGroups.push({ invoiceIndices: [idx], trip: null });
    });

    // ---- 逐组填入：每张发票的金额整笔写入一次；行程单金额绝不进入格子 ----
    tripGroups.forEach(function (grp) {
      var grpTrip = grp.trip;
      var tripDate = grpTrip ? grpTrip.date : '';

      grp.invoiceIndices.forEach(function (invIndex) {
        var inv = all[invIndex];
        if (!inv) return;
        var amt = centsOf(inv);
        var cat = categorize(inv, cfg);
        var manualDay = parseDay(inv.__reportDate);
        var by, pieceDate;
        if (manualDay) {
          pieceDate = dayKey(manualDay);
          by = '人工确认日期';
        } else if (tripDate && parseDay(tripDate)) {
          pieceDate = tripDate;
          by = '行程单归行';
        } else {
          var day = parseDay(inv.issueDate || inv.date) || start;
          pieceDate = dayKey(day);
          by = '开票日期';
        }
        if (inv.__reportExcluded) {
          // 已移出：不写入格子/合计/问题，但保留明细供卡片显示与拖回。
          stats.excludedCount += 1;
          stats.details.push({
            index: invIndex, fileName: inv.fileName || '', category: cat,
            categoryManual: !!(inv.__reportCategory && SELECTABLE_CATS.indexOf(inv.__reportCategory) !== -1),
            by: '已移出表格', dates: [], pieces: [],
            cents: amt, outOfRange: false, excluded: true, manual: !!manualDay
          });
          return;
        }

        var inRange = Object.prototype.hasOwnProperty.call(cells, pieceDate);
        var targetKey = inRange ? pieceDate : '__out__';
        var target = inRange ? cells[pieceDate] : outCell;
        // 混合票会在这里写两列（住宿费 + 车船费-其他），其余票只有一笔。
        var pieces = piecesOf(inv);
        var detailPieces = [];
        if (!rowSources[targetKey]) rowSources[targetKey] = [];
        pieces.forEach(function (pc) {
          target[pc.cat] += pc.cents;
          detailPieces.push({ date: pieceDate, cents: pc.cents, by: by, cat: pc.cat });
          var cellKey = targetKey + '|' + pc.cat;
          if (!cellSources[cellKey]) cellSources[cellKey] = [];
          cellSources[cellKey].push({ index: invIndex, cents: pc.cents, by: by, fileName: inv.fileName || '' });
        });
        // count 记的是「票据张数」，一张混合票只算一张
        target.count += 1;
        rowSources[targetKey].push({ index: invIndex, cents: amt, by: by, fileName: inv.fileName || '' });
        if (!inRange) {
          stats.outOfRangeCount += 1;
          outDates[pieceDate] = (outDates[pieceDate] || 0) + 1;
        }
        stats.details.push({
          index: invIndex, fileName: inv.fileName || '',
          category: pieces.length > 1 ? 'mixed' : pieces[0].cat,
          categoryManual: !!(inv.__reportCategory && SELECTABLE_CATS.indexOf(inv.__reportCategory) !== -1),
          by: by, dates: [pieceDate], pieces: detailPieces, cents: amt,
          outOfRange: !inRange, excluded: false, manual: !!manualDay
        });
      });
    });

    stats.matchedInvoices = Object.keys(matchedInvoice).length;
    stats.unmatchedTrips = tripCandidates.filter(function (t) {
      return !claimedTrip[t.index] && t.amount > 0;
    }).length;
    // 诊断提示：未被认领的行程单里，金额接近某张未认领发票的，视为疑似核对不一致。
    stats.mismatch = tripCandidates.filter(function (t) {
      if (claimedTrip[t.index] || !(t.amount > 0)) return false;
      var tol = Math.max(200, Math.round(t.amount * 0.2));
      return invoices.some(function (inv) {
        var idx = all.indexOf(inv);
        return !usedInvoice[idx] && Math.abs(centsOf(inv) - t.amount) <= tol;
      });
    }).length;

    // ------------------------------------------------------------------
    // 确认弹窗右侧「行程卡片」配组（仅 UI 视图，不参与金额/补贴计算）：
    //   一张行程单是容器，金额严格相等的一组发票（1~N 张）归到这张卡；
    //   卡片金额一律取组内发票金额之和，行程单金额只用于分组、不计费；
    //   没有行程单认领的发票各自单独成卡（key=inv-<idx>，兼容既有拖拽）；
    //   没有发票认领的行程单 => 单独一张「未核对」卡，方便用户发现异常。
    // ------------------------------------------------------------------
    var tripByIndex = {};
    tripDocs.forEach(function (t) {
      tripByIndex[all.indexOf(t)] = t;
    });
    var groups = [];
    tripGroups.forEach(function (grp) {
      var invIndices = grp.invoiceIndices.slice();
      if (!invIndices.length) return;
      var firstIdx = invIndices[0];
      var inv = all[firstIdx];
      var trips = [];
      if (grp.trip) {
        var c = grp.trip;
        var td = tripByIndex[c.index];
        trips.push({
          index: c.index,
          fileName: c.fileName || (td && td.fileName) || '',
          date: c.date,
          amountCents: c.amount
        });
      }
      // 组内发票金额之和：行程单金额分文不取。
      var amtSum = invIndices.reduce(function (s, i) { return s + centsOf(all[i]); }, 0);
      groups.push({
        key: 'inv-' + firstIdx,
        type: 'invoice',
        invoiceIndices: invIndices,
        tripIndices: trips.map(function (t) { return t.index; }),
        trips: trips,
        invoice: inv,
        category: categorize(inv, cfg),
        amountCents: amtSum,
        date: (function () {
          var d = parseDay(inv.__reportDate) || (grp.trip && parseDay(grp.trip.date)) ||
            parseDay(inv.issueDate || inv.date);
          return d ? dayKey(d) : '';
        })(),
        outOfRange: false
      });
    });
    tripCandidates.forEach(function (t) {
      if (claimedTrip[t.index] || !(t.amount > 0)) return;
      var td = tripByIndex[t.index];
      groups.push({
        key: 'trip-' + t.index,
        type: 'orphanTrip',
        invoiceIndices: [],
        tripIndices: [t.index],
        trips: [{
          index: t.index, fileName: t.fileName || (td && td.fileName) || '',
          date: t.date, amountCents: t.amount
        }],
        invoice: null,
        category: 'taxi',
        amountCents: 0,
        date: t.date,
        outOfRange: false
      });
    });
    // 超范围标记回填：草稿里被人工日期挪到范围外的发票，卡片也要能一眼看出。
    var outIdx = {};
    (stats.details || []).forEach(function (d) { if (d.outOfRange) outIdx[d.index] = true; });
    groups.forEach(function (g) {
      g.outOfRange = g.invoiceIndices.some(function (i) { return outIdx[i]; });
      // 组内所有发票都被移出 => 整张卡标记「已移出表格」，可重新拖回归行。
      g.excluded = g.invoiceIndices.length > 0 && g.invoiceIndices.every(function (i) {
        return !!(all[i] && all[i].__reportExcluded);
      });
    });

    var totals = emptyCell();
    dayList.forEach(function (k) { COLS.forEach(function (c) { totals[c] += cells[k][c]; }); });
    COLS.forEach(function (c) { totals[c] += outCell[c]; });

    var dayRows = dayList.map(function (k) {
      return { key: k, date: parseDay(k), cells: cells[k], subtotal: sumCell(cells[k]), outOfRange: false };
    });
    var outRow = null;
    if (outCell.count > 0) {
      outRow = {
        key: '__out__', cells: outCell, subtotal: sumCell(outCell), outOfRange: true,
        dates: Object.keys(outDates).sort()
      };
    }

    return {
      config: cfg, start: start, end: end, dayRows: dayRows, outRow: outRow,
      totals: totals, grandTotal: sumCell(totals), stats: stats,
      cellSources: cellSources, rowSources: rowSources, groups: groups
    };
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmt(cents, showZero) {
    if (!cents) return showZero ? '0' : '';
    var v = cents / 100;
    return v % 1 === 0 ? String(v) : v.toFixed(2);
  }

  /*
   * 版式蓝本：差旅费用报销清单（内部表单模板）
   *   A4 纵向；右上「编号：YF-FBCW10-2022」；黑体 16pt 居中标题
   *   「出差记录及费用报销清单」；下一行「出差人：…   2026年9月6日- 9月10日」；
   *   10 列细线表、两行表头（车船费跨三列，第二行才是普票费/打的费/其他）；
   *   数据行 10.5pt 宋体、每天重复填地点与原因、金额空值留空、小计列留空；
   *   合计行加粗且每列都写数（含 0）。原件无记账凭证附件、大写金额与签章栏。
   */
  function generateExpenseReportHTML(invoiceData, totalAmountOverride, cfgInput, helpers) {
    var model = buildTripModel(invoiceData, cfgInput);
    var cfg = model.config;
    var border = '#000000';
    // 确认弹窗内的预览：去掉 A4 底部大片留白，只保留表格本体（正式 PDF 版式不受影响）
    var previewMode = !!(helpers && helpers.preview);

    // Word tblGrid 列宽（twips）换算成百分比，保持原件各列比例。
    // 小计列要容纳多位数合计金额（如 1042.36），原来只给 8.7% 导致数字顶破右边框，
    // 这里明显加宽；日期/地点/原因三列内容很短，相应收窄。金额另按位数自适应字号
    // （见 amountStyle），双保险防止大金额溢出。
    var colWidths = [11.2, 11.5, 11.5, 8.0, 8.0, 6.5, 9.0, 7.0, 12.5, 11.8];
    var colgroup = '<colgroup>' + colWidths.map(function (w) {
      return '<col style="width:' + w + '%">';
    }).join('') + '</colgroup>';

    // 1pt = 1.333px @96dpi：12pt→16px、10.5pt→14px、10pt→13px、16pt→21px
    var base = 'border:1px solid ' + border + ';padding:1px 3px;vertical-align:middle;' +
      'font-family:SimSun,宋体,serif;color:#000;';
    var thBig = base + 'text-align:center;font-weight:bold;font-size:16px;';
    var thSmall = base + 'text-align:center;font-weight:bold;font-size:13px;';
    var thSub = base + 'text-align:center;font-weight:normal;font-size:13px;';
    var tdCenter = base + 'text-align:center;font-size:14px;';
    var tdRight = base + 'text-align:right;font-size:14px;padding-right:4px;';
    var tdBold = base + 'font-weight:bold;font-size:14px;';

    // 金额列：位数越多字号越小，保证大额（如 1042.36 甚至更长）不会顶破单元格右边框。
    // 右内边距收到 4px，给数字多留空间；white-space:nowrap 避免数字被折行。
    function amountStyle(text, bold) {
      var len = String(text == null ? '' : text).length;
      var size = len > 9 ? 10 : len > 7 ? 11 : len > 6 ? 12 : 14;
      return (bold ? tdBold + 'text-align:right;' : tdRight) +
        'white-space:nowrap;font-size:' + size + 'px;';
    }

    // 两行表头：第一行 车船费 跨 3 列，住宿费/补贴/其他(退票费)/小计 跨两行；
    // 第二行才是 车船费 下的 普票费/打的费/其他 三个子列。
    var thead = '<thead>' +
      '<tr style="height:24px;">' +
        '<th rowspan="2" style="' + thBig + '">日期</th>' +
        '<th rowspan="2" style="' + thBig + '">出差地点</th>' +
        '<th rowspan="2" style="' + thBig + '">出差原因</th>' +
        '<th colspan="3" style="' + thBig + '">车船费</th>' +
        '<th rowspan="2" style="' + thSmall + '">住宿费</th>' +
        '<th rowspan="2" style="' + thSmall + '">补贴</th>' +
        '<th rowspan="2" style="' + thSmall + '">其他<br>（退票费）</th>' +
        '<th rowspan="2" style="' + thSmall + '">小计</th>' +
      '</tr>' +
      '<tr style="height:22px;">' +
        '<th style="' + thSub + '">普票费</th>' +
        '<th style="' + thSub + '">打的费</th>' +
        '<th style="' + thSub + '">其他</th>' +
      '</tr></thead>';

    // 原件日期写作 2026/9/6（月日不补零）
    function cnDate(d) {
      return d ? d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate() : '';
    }
    function rangeText(s, e) {
      if (!s || !e) return '';
      return s.getFullYear() + '年' + (s.getMonth() + 1) + '月' + s.getDate() + '日' +
        '- ' + (s.getFullYear() !== e.getFullYear() ? e.getFullYear() + '年' : '') +
        (e.getMonth() + 1) + '月' + e.getDate() + '日';
    }

    // 预览模式的点击定位信息；正式 PDF 输出不带这些属性，版式完全不受影响。
    function previewAttrs(rowKey, cat) {
      if (!previewMode || !rowKey) return '';
      var sources = cat
        ? (model.cellSources[rowKey + '|' + cat] || [])
        : (model.rowSources[rowKey] || []);
      return ' class="erc-cell-hot" data-row-key="' + esc(rowKey) + '"' +
        (cat ? ' data-cat="' + esc(cat) + '"' : '') +
        ' data-source-count="' + sources.length + '"';
    }

    // 预览模式：金额格里叠一排「票据 chip」（图标 + 金额），多张票据带数量角标。
    // 只在 previewMode 生成；正式 PDF 的 cellsHTML 输出与改造前逐字一致。
    function chipsHTML(rowKey, cat) {
      if (!previewMode || !rowKey || cat === 'allowance') return '';
      var sources = model.cellSources[rowKey + '|' + cat] || [];
      if (!sources.length) return '';
      // 同一张票若拆到本格多次，合并成一个 chip，金额累加。
      var merged = {};
      var order = [];
      sources.forEach(function (s) {
        if (!merged[s.index]) { merged[s.index] = { index: s.index, cents: 0, fileName: s.fileName }; order.push(s.index); }
        merged[s.index].cents += s.cents;
      });
      var st = CAT_STYLE[cat] || CAT_STYLE.transportOther;
      var chips = order.map(function (idx) {
        var m = merged[idx];
        return '<span class="erc-chip" data-chip-idx="' + m.index + '" draggable="true"' +
          ' title="' + esc(m.fileName) + ' · 拖到其它格改归行 / 拖到右侧票据区移出"' +
          ' style="background:' + st.bg + ';color:' + st.color + ';border-color:' + st.border + '">' +
          st.icon + '<b>' + fmt(m.cents, false) + '</b></span>';
      }).join('');
      return '<span class="erc-chip-row" data-chip-cat="' + esc(cat) + '">' + chips + '</span>';
    }

    function cellsHTML(c, showZero, bold, rowKey) {
      return COLS.map(function (k) {
        var text = fmt(c[k], showZero);
        var inner = text + chipsHTML(rowKey, k);
        return '<td style="' + amountStyle(text, bold) + (previewMode && !bold ? 'position:relative;' : '') + '"' +
          previewAttrs(rowKey, k) + '>' + inner + '</td>';
      }).join('');
    }

    function rowHTML(r) {
      var c = r.cells;
      var bg = r.outOfRange ? 'background:#fff8e1;' : '';
      var dateLabel = r.outOfRange ? '⚠ 超范围' : cnDate(r.date);
      // 原件每一个日期行都重复填写出差地点与出差原因
      var location = r.outOfRange ? '日期超范围' : esc(cfg.location);
      var reason = r.outOfRange ? '不计补贴' : esc(cfg.reason);
      var subtotal = (cfg.showRowSubtotal || r.outOfRange) ? fmt(r.subtotal, false) : '';
      return '<tr style="height:26px;' + bg + '">' +
        '<td style="' + tdCenter + bg + '"' + previewAttrs(r.key, null) + '>' + dateLabel + '</td>' +
        '<td style="' + tdCenter + bg + '">' + location + '</td>' +
        '<td style="' + tdCenter + bg + '">' + reason + '</td>' +
        cellsHTML(c, false, false, r.key) +
        '<td style="' + tdCenter + bg + '">' + subtotal + '</td>' +
        '</tr>';
    }

    var rows = model.dayRows.map(function (r) { return { type: 'day', data: r }; });
    if (model.outRow) rows.push({ type: 'out', data: model.outRow });
    var chunks = [];
    for (var i = 0; i < rows.length; i += cfg.rowsPerPage) chunks.push(rows.slice(i, i + cfg.rowsPerPage));
    if (chunks.length === 0) chunks.push([]);

    var grandText = fmt(model.grandTotal, true);
    var totalRow = '<tr style="height:26px;">' +
      '<td style="' + tdBold + 'text-align:center;">合计</td>' +
      '<td style="' + tdBold + 'text-align:center;">/</td>' +
      '<td style="' + tdBold + 'text-align:center;">/</td>' +
      cellsHTML(model.totals, true, true) +
      '<td style="' + amountStyle(grandText, true) + '">' + grandText + '</td>' +
      '</tr>';

    function buildPage(chunk, pageIndex, isLast) {
      var body = '';
      chunk.forEach(function (item) {
        if (item.type === 'out') {
          var ods = item.data.dates.map(function (k) {
            return cnDate(parseDay(k));
          }).filter(Boolean).join('、');
          body += '<tr style="height:20px;background:#fff8e1;">' +
            '<td colspan="10" style="' + base + 'text-align:left;font-size:11px;color:#92400e;"' +
            previewAttrs('__out__', null) + '>' +
            '⚠ 超范围票据（' + esc(ods) + '）：日期不在出差范围内，金额计入合计，不计补贴</td></tr>';
          body += rowHTML(item.data);
        } else {
          body += rowHTML(item.data);
        }
      });
      if (isLast) body += totalRow;

      // A4 = 210 × 297mm ≈ 794 × 1123px @96dpi；页边距 20mm ≈ 76px
      var pageStyle = previewMode
        ? 'width:794px;height:auto;background:#fff;padding:24px;'
        : 'width:794px;height:1123px;background:#fff;padding:76px;';
      return '<div class="expenseReportPage' + (previewMode ? ' expenseReportPagePreview' : '') + '" style="' +
        pageStyle +
        'font-family:SimSun,宋体,serif;color:#000;box-sizing:border-box;' +
        'display:flex;flex-direction:column;">' +
        '<div style="text-align:right;font-size:14px;line-height:1.5;height:22px;">' +
          (cfg.formNo ? '编号：' + esc(cfg.formNo) : '') + '</div>' +
        '<h1 style="text-align:center;font-family:SimHei,黑体,sans-serif;font-size:21px;' +
          'font-weight:bold;letter-spacing:2px;margin:16px 0 18px;">出差记录及费用报销清单</h1>' +
        '<div style="display:flex;justify-content:space-between;font-size:16px;margin-bottom:10px;">' +
          '<span>出差人：' + esc(cfg.traveler || '') + '</span>' +
          '<span>' + esc(rangeText(model.start, model.end)) + '</span>' +
        '</div>' +
        '<table style="width:100%;border-collapse:collapse;table-layout:fixed;' +
          'border:1px solid ' + border + ';">' + colgroup + thead +
          '<tbody>' + body + '</tbody></table>' +
        '</div>';
    }

    var allPagesHTML = chunks.map(function (c, i) {
      return buildPage(c, i, i === chunks.length - 1);
    }).join('');

    // 预览 chip 样式：数字保持原位，chip 以小标签浮在数字下方一行。
    // 仅 preview 模式注入；正式打印版式里不会出现任何 chip 相关 DOM/CSS。
    var previewChipStyle = previewMode
      ? '<style>' +
        '.erc-chip-row{display:flex;flex-wrap:wrap;gap:2px;justify-content:flex-end;margin-top:2px;line-height:1;}' +
        '.erc-chip{display:inline-flex;align-items:center;gap:1px;padding:1px 3px;border:1px solid;border-radius:4px;' +
        'font-family:-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;font-size:9px;white-space:nowrap;cursor:grab;}' +
        '.erc-chip b{font-weight:700;font-size:9px;}' +
        '.erc-chip:hover{box-shadow:0 0 0 1px currentColor;}' +
        '.erc-chip.is-dragging{opacity:.4;}' +
        '.erc-chip:active{cursor:grabbing;}' +
        '</style>'
      : '';
    return '<div id="expenseReport">' + previewChipStyle + allPagesHTML + '</div>';
  }

  /*
   * 生成前诊断：列出日期超出出差范围的票据，按原始 invoiceData 索引定位。
   * 确认弹窗用它高亮问题行、控制「确认生成」按钮；Node 回归脚本也直接调用。
   */
  function analyzeExpenseReport(invoiceData, cfgInput) {
    var model = buildTripModel(invoiceData, cfgInput);
    var issues = [];
    (model.stats.details || []).forEach(function (d) {
      if (!d.outOfRange) return;
      issues.push({
        index: d.index,
        fileName: d.fileName,
        category: d.category,
        dates: d.dates.slice(),
        amount: d.cents / 100,
        manual: !!d.manual,
        by: d.by
      });
    });
    return {
      model: model,
      issues: issues,
      start: model.start,
      end: model.end,
      dayKeys: model.dayRows.map(function (r) { return r.key; })
    };
  }

  return {
    DEFAULT_CONFIG: DEFAULT_CONFIG,
    COLS: COLS,
    COL_LABEL: COL_LABEL,
    SELECTABLE_CATS: SELECTABLE_CATS,
    buildTripModel: buildTripModel,
    analyzeExpenseReport: analyzeExpenseReport,
    generateExpenseReportHTML: generateExpenseReportHTML,
    CAT_STYLE: CAT_STYLE,
    utils: { parseDay: parseDay, dayKey: dayKey, slashDate: slashDate, categorize: categorize, fmt: fmt,
      pickAmount: pickAmount, overrideKey: overrideKey, resolveOverride: resolveOverride,
      normalizeSplits: normalizeSplits }
  };
});
