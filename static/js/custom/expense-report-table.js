/*
 * 差旅费报销单表格生成（二次开发）
 * ------------------------------------------------------------------
 * 表格结构（10 列）：
 *   日期 | 出差地点 | 出差原因 | 车船费(普票费 / 打的费 / 其他) | 住宿费 | 补贴 | 其他(退票费) | 小计
 *
 * 业务规则：
 *   - 用户指定出差起止日期，范围内每天一行，补贴默认 50 元/天；
 *   - 发票金额按项目名归到对应费用列（关键词可在 config.keywords 里改）；
 *   - 行程单不是发票：仅用于「金额核对 + 提供真实乘车日期」，不重复计金额；
 *     单张行程单金额 == 发票金额，或多张行程单金额之和 == 发票金额时配对成功，
 *     配对成功后按行程单日期归行；否则退回开票日期；
 *   - 没有行程单且开票日期超出出差范围的票据，单列为「超范围票据」（不计补贴）。
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
      lodging: ['住宿', '酒店', '宾馆', '客房', '民宿', '房费'],
      // 其他（退票费）
      refund: ['退票', '改签', '退费', '手续费', '其他']
    }
  };

  // 数值列顺序 = 表格列顺序（不含小计）
  var COLS = ['ticket', 'taxi', 'transportOther', 'lodging', 'allowance', 'refund'];

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

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
    if (y < 2015 || y > 2035 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
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
    var text = ((inv && (inv.projectName || inv.itemName || inv.name) || '') + ' ' +
      ((inv && inv.fileName) || '')).toLowerCase();
    var kw = cfg.keywords;
    var groups = ['refund', 'lodging', 'taxi', 'ticket', 'transportOther'];
    for (var i = 0; i < groups.length; i++) {
      var g = groups[i];
      var words = kw[g] || [];
      for (var j = 0; j < words.length; j++) {
        if (text.indexOf(String(words[j]).toLowerCase()) !== -1) return g;
      }
    }
    return 'transportOther'; // 未识别的一律进「车船费-其他」，绝不丢钱
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
      truncatedDays: false,
      details: []
    };

    var tripCandidates = tripDocs.map(function (t) {
      var tr = t.trip || {};
      var dates = (tr.preferredDates && tr.preferredDates.length ? tr.preferredDates : (tr.dates || [])).slice();
      dates.sort();
      return {
        fileName: t.fileName || '',
        date: tr.primaryDate || dates[0] || '',
        amount: Math.round((parseFloat(tr.amount != null ? tr.amount : t.amount) || 0) * 100),
        used: false
      };
    });

    // 出差起止日期：优先用户选择，其次按票据日期推断
    var datePool = [];
    invoices.forEach(function (inv) { var d = parseDay(inv.issueDate || inv.date); if (d) datePool.push(d); });
    tripCandidates.forEach(function (t) { var d = parseDay(t.date); if (d) datePool.push(d); });
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
    var allowanceCents = Math.round(cfg.dailyAllowance * 100);
    dayList.forEach(function (k) {
      cells[k] = emptyCell();
      cells[k].allowance = allowanceCents;
    });
    var outCell = emptyCell();
    var outDates = {};

    function matchTrips(inv) {
      var amt = Math.round((parseFloat(inv.amount) || 0) * 100);
      if (amt <= 0) return null;
      var unused = tripCandidates.filter(function (t) { return !t.used && t.date && t.amount > 0; });
      for (var i = 0; i < unused.length; i++) {
        if (Math.abs(unused[i].amount - amt) <= 2) {
          unused[i].used = true;
          return [{ date: unused[i].date, cents: amt, by: '行程单金额核对一致' }];
        }
      }
      var sub = findSubset(unused.slice(0, 12), amt);
      if (sub && sub.length > 1) {
        sub.forEach(function (t) { t.used = true; });
        return sub.map(function (t) { return { date: t.date, cents: t.amount, by: '多张行程单合计核对一致' }; });
      }
      // 只有「看起来是同一笔、金额却对不上」才算核对不一致。
      // 一张本来就没有行程单的票据（如长途汽车票）不该因为还剩别的行程单就被误报。
      var tolerance = Math.max(200, Math.round(amt * 0.2));
      var nearSingle = unused.some(function (t) { return Math.abs(t.amount - amt) <= tolerance; });
      var sumUnused = unused.reduce(function (s, t) { return s + t.amount; }, 0);
      var nearSum = Math.abs(sumUnused - amt) <= tolerance;
      if (nearSingle || nearSum) stats.mismatch += 1;
      return null;
    }

    invoices.forEach(function (inv) {
      var amt = Math.round((parseFloat(inv.amount) || 0) * 100);
      var cat = categorize(inv, cfg);
      var matches = matchTrips(inv);
      var pieces;
      if (matches && matches.length) {
        stats.matchedInvoices += 1;
        pieces = matches;
      } else {
        var d = parseDay(inv.issueDate || inv.date) || start;
        pieces = [{ date: dayKey(d), cents: amt, by: '开票日期' }];
      }
      pieces.forEach(function (p) {
        var inRange = Object.prototype.hasOwnProperty.call(cells, p.date);
        var target = inRange ? cells[p.date] : outCell;
        target[cat] += p.cents;
        target.count += 1;
        if (!inRange) {
          stats.outOfRangeCount += 1;
          outDates[p.date] = (outDates[p.date] || 0) + 1;
        }
      });
      stats.details.push({
        fileName: inv.fileName || '',
        category: cat,
        by: pieces[0].by,
        dates: pieces.map(function (p) { return p.date; }),
        cents: amt
      });
    });

    stats.unmatchedTrips = tripCandidates.filter(function (t) { return !t.used && t.amount > 0; }).length;

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
      totals: totals, grandTotal: sumCell(totals), stats: stats
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
   *   「出差记录及费用报销清单」；下一行「出差人：…   2026 年 9月6 ~ 9月10日」；
   *   10 列细线表、三行表头（车船费跨两行三列，第三行才是普票费/打的费/其他）；
   *   数据行 10.5pt 宋体、每天重复填地点与原因、金额空值留空、小计列留空；
   *   合计行加粗且每列都写数（含 0）。原件无记账凭证附件、大写金额与签章栏。
   */
  function generateExpenseReportHTML(invoiceData, totalAmountOverride, cfgInput, helpers) {
    var model = buildTripModel(invoiceData, cfgInput);
    var cfg = model.config;
    var border = '#000000';

    // Word tblGrid 列宽（twips）换算成百分比，保持原件各列比例
    var colWidths = [11.9, 12.0, 12.0, 8.3, 8.3, 6.3, 10.5, 8.5, 12.4, 8.7];
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
    var tdRight = base + 'text-align:right;font-size:14px;padding-right:7px;';
    var tdBold = base + 'font-weight:bold;font-size:14px;';

    var thead = '<thead>' +
      '<tr style="height:24px;">' +
        '<th rowspan="2" style="' + thBig + '">日期</th>' +
        '<th rowspan="2" style="' + thBig + '">出差地点</th>' +
        '<th rowspan="2" style="' + thBig + '">出差原因</th>' +
        '<th colspan="3" rowspan="2" style="' + thBig + '">车船费</th>' +
        '<th rowspan="2" style="' + thSmall + '">住宿费</th>' +
        '<th rowspan="2" style="' + thSmall + '">补贴</th>' +
        '<th style="' + thSmall + '">其他</th>' +
        '<th rowspan="2" style="' + thSmall + '">小计</th>' +
      '</tr>' +
      '<tr style="height:22px;"><th style="' + thSmall + '">（退票费）</th></tr>' +
      '<tr style="height:22px;">' +
        '<th style="' + thSub + '"></th><th style="' + thSub + '"></th><th style="' + thSub + '"></th>' +
        '<th style="' + thSub + '">普票费</th>' +
        '<th style="' + thSub + '">打的费</th>' +
        '<th style="' + thSub + '">其他</th>' +
        '<th style="' + thSub + '"></th><th style="' + thSub + '"></th>' +
        '<th style="' + thSub + '"></th><th style="' + thSub + '"></th>' +
      '</tr></thead>';

    // 原件日期写作 2026/9/6（月日不补零）
    function cnDate(d) {
      return d ? d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate() : '';
    }
    function rangeText(s, e) {
      if (!s || !e) return '';
      return s.getFullYear() + ' 年 ' + (s.getMonth() + 1) + '月' + s.getDate() +
        ' ~ ' + (s.getFullYear() !== e.getFullYear() ? e.getFullYear() + ' 年 ' : '') +
        (e.getMonth() + 1) + '月' + e.getDate() + '日';
    }

    function cellsHTML(c, showZero, bold) {
      return COLS.map(function (k) {
        return '<td style="' + (bold ? tdBold + 'text-align:right;padding-right:7px;' : tdRight) + '">' +
          fmt(c[k], showZero) + '</td>';
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
        '<td style="' + tdCenter + bg + '">' + dateLabel + '</td>' +
        '<td style="' + tdCenter + bg + '">' + location + '</td>' +
        '<td style="' + tdCenter + bg + '">' + reason + '</td>' +
        cellsHTML(c, false, false) +
        '<td style="' + tdCenter + bg + '">' + subtotal + '</td>' +
        '</tr>';
    }

    var rows = model.dayRows.map(function (r) { return { type: 'day', data: r }; });
    if (model.outRow) rows.push({ type: 'out', data: model.outRow });
    var chunks = [];
    for (var i = 0; i < rows.length; i += cfg.rowsPerPage) chunks.push(rows.slice(i, i + cfg.rowsPerPage));
    if (chunks.length === 0) chunks.push([]);

    var totalRow = '<tr style="height:26px;">' +
      '<td style="' + tdBold + 'text-align:center;">合计</td>' +
      '<td style="' + tdBold + 'text-align:center;">/</td>' +
      '<td style="' + tdBold + 'text-align:center;">/</td>' +
      cellsHTML(model.totals, true, true) +
      '<td style="' + tdBold + 'text-align:center;">' + fmt(model.grandTotal, true) + '</td>' +
      '</tr>';

    function buildPage(chunk, pageIndex, isLast) {
      var body = '';
      chunk.forEach(function (item) {
        if (item.type === 'out') {
          var ods = item.data.dates.map(function (k) {
            return cnDate(parseDay(k));
          }).filter(Boolean).join('、');
          body += '<tr style="height:20px;background:#fff8e1;">' +
            '<td colspan="10" style="' + base + 'text-align:left;font-size:11px;color:#92400e;">' +
            '⚠ 超范围票据（' + esc(ods) + '）：日期不在出差范围内，金额计入合计，不计补贴</td></tr>';
          body += rowHTML(item.data);
        } else {
          body += rowHTML(item.data);
        }
      });
      if (isLast) body += totalRow;

      // A4 = 210 × 297mm ≈ 794 × 1123px @96dpi；页边距 20mm ≈ 76px
      return '<div class="expenseReportPage" style="' +
        'width:794px;height:1123px;background:#fff;padding:76px;' +
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
    return '<div id="expenseReport">' + allPagesHTML + '</div>';
  }

  return {
    DEFAULT_CONFIG: DEFAULT_CONFIG,
    COLS: COLS,
    buildTripModel: buildTripModel,
    generateExpenseReportHTML: generateExpenseReportHTML,
    utils: { parseDay: parseDay, dayKey: dayKey, slashDate: slashDate, categorize: categorize, fmt: fmt }
  };
});
