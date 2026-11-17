/* ------------------------------------------------------------------------
 * 出差日期区间选择器（酒店入住式：一个控件选「开始 → 结束」）
 *
 * 为什么不用两个 <input type="date">：
 *   两次点击、两次弹日历、两个原生面板的月份状态互不同步，用户还要自己
 *   保证先后顺序。这里合成一个控件：点一次打开日历，第一下选开始日、
 *   第二下选结束日，中间区间实时铺色，天数直接算好显示。
 *
 * 对外接口：
 *   TripDateRange.mount(hostEl, { startInput, endInput, onChange })
 *     startInput / endInput：真实值仍写在这两个 <input> 里（YYYY-MM-DD），
 *     沿用原有 readTripConfigFromUI() 的读法，外部代码零改动。
 *   window.__erTripRangeRefresh()：外部（确认弹窗）改了隐藏域的值之后调用，
 *     重新把值同步到界面。
 *
 * 注意：本页 Tailwind preflight 会把所有元素的 padding/margin/border 归零
 * （:not(#\#):not(#\#) 两个 ID 特异性），写在 <style> 里的普通类选择器全输。
 * 所以这里的样式一律内联，不建立样式表依赖，也不跟特异性打架。
 * ---------------------------------------------------------------------- */
(function (global) {
  'use strict';
  if (global.TripDateRange) return;

  var WEEK = ['日', '一', '二', '三', '四', '五', '六'];

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function keyOf(y, m, d) { return y + '-' + pad(m + 1) + '-' + pad(d); }
  function parseKey(s) {
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(s || ''));
    if (!m) return null;
    return { y: +m[1], m: +m[2] - 1, d: +m[3] };
  }
  function showKey(s) {
    var p = parseKey(s);
    return p ? p.y + '/' + pad(p.m + 1) + '/' + pad(p.d) : '';
  }
  function todayKey() {
    var t = new Date();
    return keyOf(t.getFullYear(), t.getMonth(), t.getDate());
  }
  function shiftKey(s, n) {
    var p = parseKey(s);
    if (!p) return '';
    var t = new Date(p.y, p.m, p.d + n);
    return keyOf(t.getFullYear(), t.getMonth(), t.getDate());
  }
  function dayDiff(a, b) {
    var pa = parseKey(a), pb = parseKey(b);
    if (!pa || !pb) return 0;
    return Math.round((new Date(pb.y, pb.m, pb.d) - new Date(pa.y, pa.m, pa.d)) / 86400000);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var C = {
    ink: '#111827',
    sub: '#6b7280',
    faint: '#9ca3af',
    line: '#d1d5db',
    primary: '#4338ca',
    band: '#eef2ff',
    bandSoft: '#f5f7ff'
  };

  function mount(host, opts) {
    if (!host) return null;
    opts = opts || {};
    var startInput = opts.startInput || null;
    var endInput = opts.endInput || null;

    var start = (startInput && startInput.value) || '';
    var end = (endInput && endInput.value) || '';
    if (!parseKey(start)) start = '';
    if (!parseKey(end)) end = '';

    var open = false;
    var picking = start ? (end ? 'start' : 'end') : 'start';
    var hover = '';
    var base = parseKey(start || todayKey());
    var viewY = base.y;
    var viewM = base.m;

    /* ---------------- DOM 骨架（只建一次，后续只换 innerHTML） ---------------- */
    var wrap = document.createElement('div');
    wrap.setAttribute('data-tdr', '1');
    wrap.style.cssText = 'position:relative;width:100%;box-sizing:border-box;';

    var trigger = document.createElement('div');
    trigger.setAttribute('role', 'button');
    trigger.tabIndex = 0;
    trigger.title = '点击选择出差开始与结束日期';
    trigger.style.cssText = 'display:flex;align-items:center;gap:6px;width:100%;box-sizing:border-box;' +
      'min-height:30px;padding:3px 8px;border:1px solid ' + C.line + ';border-radius:5px;overflow:hidden;' +
      'background:#fff;font-size:12px;line-height:1.45;color:' + C.ink + ';cursor:pointer;' +
      'transition:border-color .15s,box-shadow .15s;user-select:none;';

    var pop = document.createElement('div');
    pop.style.cssText = 'position:absolute;left:0;top:calc(100% + 6px);z-index:99999;width:292px;' +
      'box-sizing:border-box;padding:10px;background:#fff;border:1px solid #e5e7eb;border-radius:10px;' +
      'box-shadow:0 12px 32px rgba(15,23,42,.14);font-size:12px;color:' + C.ink + ';display:none;';

    wrap.appendChild(trigger);
    wrap.appendChild(pop);
    host.innerHTML = '';
    host.appendChild(wrap);

    /* ------------------------------ 渲染 ------------------------------ */
    function triggerHTML() {
      var nowPick = open ? picking : '';
      var capStyle = function (active) {
        return 'font-size:10px;color:' + (active ? C.primary : C.faint) + ';white-space:nowrap;flex:none;' +
          (active ? 'font-weight:700;' : '');
      };
      var valStyle = function (fake) {
        return 'font-size:12px;font-weight:600;color:' + (fake ? '#c0c6d2' : C.ink) + ';';
      };
      var days = (start && end) ? dayDiff(start, end) + 1 : 0;
      return '' +
        '<span style="font-size:12px;line-height:1;opacity:.7;">📅</span>' +
        '<span style="display:flex;align-items:baseline;gap:4px;min-width:0;overflow:hidden;">' +
          '<span style="' + capStyle(nowPick === 'start' || nowPick === 'end') + '">开始</span>' +
          '<b style="' + valStyle(!start) + 'white-space:nowrap;">' + (start ? showKey(start) : '选择日期') + '</b>' +
        '</span>' +
        '<span style="color:#c7cbe0;font-size:11px;">→</span>' +
        '<span style="display:flex;align-items:baseline;gap:4px;min-width:0;overflow:hidden;">' +
          '<span style="' + capStyle(nowPick === 'end') + '">结束</span>' +
          '<b style="' + valStyle(!end) + 'white-space:nowrap;">' + (end ? showKey(end) : '选择日期') + '</b>' +
        '</span>' +
        (days
          ? '<span style="margin-left:auto;flex:none;font-size:10px;font-weight:700;color:' + C.primary +
            ';background:' + C.band + ';border-radius:9px;padding:1px 6px;">' + days + ' 天</span>'
          : '<span style="margin-left:auto;flex:none;"></span>');
    }

    function navBtnHTML(dir, text, title) {
      return '<button type="button" data-nav="' + dir + '" title="' + esc(title) + '" style="' +
        'width:24px;height:24px;padding:0;border:0;border-radius:6px;background:#f3f4f6;color:#4b5563;' +
        'font-size:12px;line-height:24px;text-align:center;cursor:pointer;flex:none;">' + text + '</button>';
    }

    function footBtnHTML(act, text, strong) {
      return '<button type="button" data-act="' + act + '" style="' +
        'padding:3px 8px;border:1px solid ' + (strong ? '#c7d2fe' : '#e5e7eb') + ';border-radius:6px;background:' +
        (strong ? C.band : '#fff') + ';color:' + (strong ? C.primary : '#4b5563') + ';' +
        'font-size:11px;line-height:1.5;cursor:pointer;">' + text + '</button>';
    }

    function cellHTML(d) {
      var k = keyOf(d.getFullYear(), d.getMonth(), d.getDate());
      var inMonth = d.getMonth() === viewM && d.getFullYear() === viewY;
      var isStart = k === start;
      var isEnd = k === end;
      var hasRange = !!(start && end && start !== end);
      var inBand = !!(start && end && k > start && k < end);
      var previewTo = (picking === 'end' && start && !end && hover && hover > start) ? hover : '';
      var inPreview = !!(previewTo && k > start && k <= previewTo);
      var isPreviewEnd = !!(previewTo && k === previewTo);
      var isToday = k === todayKey();

      // 端点所在格子铺半条色带，让色带贴住圆形端点，不出现断口
      var band = 'transparent';
      if (isStart && hasRange) band = 'linear-gradient(to right,transparent 0 50%,' + C.band + ' 50% 100%)';
      else if (isEnd && hasRange) band = 'linear-gradient(to left,transparent 0 50%,' + C.band + ' 50% 100%)';
      else if (inBand) band = C.band;
      else if (inPreview) band = C.bandSoft;

      var inner = 'width:30px;height:30px;line-height:30px;border-radius:15px;text-align:center;font-size:12px;';
      if (isStart || isEnd) {
        inner += 'background:' + C.primary + ';color:#fff;font-weight:700;';
      } else if (isPreviewEnd) {
        inner += 'background:#e0e7ff;color:' + C.primary + ';font-weight:700;';
      } else if (isToday) {
        inner += 'color:' + C.primary + ';font-weight:700;box-shadow:inset 0 0 0 1px #c7d2fe;';
      } else {
        inner += 'color:' + (inMonth ? '#374151' : '#cbd5e1') + ';';
      }

      return '<div data-day="' + k + '" title="' + showKey(k) + '" style="' +
        'display:flex;align-items:center;justify-content:center;height:32px;cursor:pointer;' +
        'background:' + band + ';">' +
        '<span style="' + inner + '">' + d.getDate() + '</span></div>';
    }

    function gridHTML() {
      var offset = new Date(viewY, viewM, 1).getDay();
      var cells = [];
      for (var i = 0; i < 42; i++) {
        cells.push(cellHTML(new Date(viewY, viewM, 1 - offset + i)));
      }
      return '<div style="display:grid;grid-template-columns:repeat(7,1fr);">' + cells.join('') + '</div>';
    }

    function hintText() {
      if (picking === 'end' && start) {
        return '再点结束日（' + showKey(start).slice(5) + ' 起）';
      }
      if (start && end) {
        return '已选 ' + (dayDiff(start, end) + 1) + ' 天，点日期可重选';
      }
      return '点一下选开始日，第二下选结束日';
    }

    function popHTML() {
      var weekRow = WEEK.map(function (w) {
        return '<div style="text-align:center;font-size:11px;color:' + C.faint + ';padding:2px 0;">' + w + '</div>';
      }).join('');
      var done = !!(start && end);
      return '' +
        '<div style="display:flex;align-items:center;gap:4px;margin-bottom:6px;">' +
          navBtnHTML('-12', '«', '上一年') +
          navBtnHTML('-1', '‹', '上一月') +
          '<div style="flex:1;text-align:center;font-size:13px;font-weight:700;color:' + C.ink + ';">' +
            viewY + ' 年 ' + (viewM + 1) + ' 月</div>' +
          navBtnHTML('1', '›', '下一月') +
          navBtnHTML('12', '»', '下一年') +
        '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(7,1fr);margin-bottom:2px;">' + weekRow + '</div>' +
        gridHTML() +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;' +
          'margin-top:8px;padding-top:8px;border-top:1px solid #f1f5f9;">' +
          '<span style="font-size:11px;color:' + C.sub + ';line-height:1.4;flex:1 1 auto;min-width:0;' +
            'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(hintText()) + '</span>' +
          '<span style="display:flex;gap:5px;flex:none;">' +
            footBtnHTML('clear', '清除') + footBtnHTML('today', '今天') +
            (done ? footBtnHTML('done', '完成', true) : '') +
          '</span>' +
        '</div>';
    }

    function place() {
      var tr = trigger.getBoundingClientRect();
      var wr = wrap.getBoundingClientRect();
      var ph = pop.offsetHeight || 320;
      var vh = global.innerHeight;
      var belowTop = tr.bottom + 6;        // 贴在触发器下方的位置（视口坐标）
      var wantTop = belowTop;
      var spaceBelow = vh - belowTop - 8;
      if (spaceBelow < ph) {
        if (spaceBelow >= ph * 0.5) {
          // 差得不多：整体上移一点点就够，别整块翻走（翻上去会盖住卡片标题）
          wantTop = Math.max(8, vh - ph - 8);
        } else if (tr.top - ph - 6 >= 8) {
          wantTop = tr.top - ph - 6;       // 确实装不下：翻到上方
        } else {
          wantTop = Math.max(8, vh - ph - 8); // 上下都不够：贴着视口放，保证完整可见
        }
      }
      // absolute 定位相对于 wrap，换算成 wrap 内坐标
      pop.style.top = Math.round(wantTop - wr.top) + 'px';
      pop.style.bottom = '';
      pop.style.left = '0';
      if (wr.left + 292 + 8 > global.innerWidth) {
        pop.style.left = Math.round(wr.width - 292) + 'px';
      }
    }

    function render() {
      trigger.innerHTML = triggerHTML();
      trigger.style.borderColor = open ? '#a5b4fc' : C.line;
      trigger.style.boxShadow = open ? '0 0 0 3px rgba(99,102,241,.12)' : 'none';
      if (open) {
        pop.style.display = 'block';
        pop.innerHTML = popHTML();
        place();
      } else {
        pop.style.display = 'none';
        pop.innerHTML = '';
      }
    }

    /* ------------------------------ 交互 ------------------------------ */
    function commit() {
      if (startInput) startInput.value = start || '';
      if (endInput) endInput.value = end || '';
      try {
        if (startInput) startInput.dispatchEvent(new Event('change', { bubbles: true }));
        if (endInput) endInput.dispatchEvent(new Event('change', { bubbles: true }));
      } catch (e) { /* 老浏览器忽略 */ }
      if (typeof opts.onChange === 'function') {
        opts.onChange({
          startDate: start || '',
          endDate: end || '',
          days: (start && end) ? dayDiff(start, end) + 1 : 0
        });
      }
    }

    function gotoMonth(key) {
      var p = parseKey(key);
      if (!p) return;
      viewY = p.y;
      viewM = p.m;
    }

    function pickDay(k) {
      if (picking === 'end') {
        if (!start) {
          start = k;
          picking = 'end';
        } else if (k < start) {
          // 结束日点到了开始日之前：当成重选开始日，不强行对调，免得用户懵
          start = k;
          end = '';
          picking = 'end';
        } else {
          end = k;
          picking = 'start';
        }
      } else {
        start = k;
        if (end && end < start) end = '';
        // 选完开始日必须进入「等待结束日」状态。原来写的是 picking = end ? 'start' : 'end'，
        // 于是只要结束日已经有值，picking 就永远停在 'start'：用户每点一天只是平移开始日，
        // 结束日怎么点都不会变（想改区间只能先点一个晚于结束日的日期把结束日清空，再回头点）。
        picking = 'end';
      }
      hover = '';
      gotoMonth(k);
      render();
      commit();
      trigger.focus && trigger.focus();
    }

    trigger.addEventListener('click', function () {
      open = !open;
      if (open) {
        if (!start) {
          picking = 'start';
          gotoMonth(todayKey());
        } else if (!end) {
          picking = 'end';
        } else {
          picking = 'start';
        }
      }
      render();
    });

    trigger.addEventListener('mouseenter', function () {
      if (!open) trigger.style.borderColor = '#a5b4fc';
    });
    trigger.addEventListener('mouseleave', function () {
      if (!open) trigger.style.borderColor = C.line;
    });

    trigger.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        trigger.click();
      }
    });

    // 日期格子用 mousedown 提交：hover 预览会重绘格子，click 可能落在被替换的节点上
    pop.addEventListener('mousedown', function (e) {
      var cell = e.target.closest && e.target.closest('[data-day]');
      if (cell) {
        e.preventDefault();
        pickDay(cell.getAttribute('data-day'));
        return;
      }
      var nav = e.target.closest && e.target.closest('[data-nav]');
      if (nav) {
        e.preventDefault();
        var step = parseInt(nav.getAttribute('data-nav'), 10) || 0;
        var d = new Date(viewY, viewM + step, 1);
        viewY = d.getFullYear();
        viewM = d.getMonth();
        render();
        return;
      }
      var act = e.target.closest && e.target.closest('[data-act]');
      if (act) {
        e.preventDefault();
        var a = act.getAttribute('data-act');
        if (a === 'clear') {
          start = ''; end = ''; picking = 'start'; hover = '';
          render(); commit();
        } else if (a === 'today') {
          var tk = todayKey();
          start = tk; end = tk; picking = 'start'; hover = '';
          gotoMonth(tk);
          render(); commit();
        } else if (a === 'done') {
          open = false;
          render();
        }
      }
    });

    pop.addEventListener('mouseover', function (e) {
      if (!(picking === 'end' && start && !end)) return;
      var cell = e.target.closest && e.target.closest('[data-day]');
      var k = cell ? cell.getAttribute('data-day') : '';
      if (k === hover) return;
      hover = k && k > start ? k : '';
      var g = pop.querySelector('[data-day]');
      if (!g) return;
      // 只刷新格子，不动头部/底部，避免整块重排
      var grid = g.parentElement;
      grid.innerHTML = (function () {
        var offset = new Date(viewY, viewM, 1).getDay();
        var out = [];
        for (var i = 0; i < 42; i++) out.push(cellHTML(new Date(viewY, viewM, 1 - offset + i)));
        return out.join('');
      })();
    });

    pop.addEventListener('mouseleave', function () {
      if (!(picking === 'end' && start && !end) || !hover) return;
      hover = '';
      render();
    });

    function onDocDown(e) {
      if (!open) return;
      if (wrap.contains(e.target)) return;
      open = false;
      render();
    }
    function onDocKey(e) {
      if (open && e.key === 'Escape') {
        open = false;
        render();
        // 只收起日历，不要连带把外面的确认弹窗也 Esc 掉（会丢人工修正）
        e.preventDefault();
        if (e.stopImmediatePropagation) e.stopImmediatePropagation();
        else e.stopPropagation();
      }
    }
    document.addEventListener('mousedown', onDocDown, true);
    // capture 阶段：必须比确认弹窗自己的 Esc 处理更早拿到事件
    document.addEventListener('keydown', onDocKey, true);

    function refresh() {
      var s = (startInput && startInput.value) || '';
      var e2 = (endInput && endInput.value) || '';
      if (!parseKey(s)) s = '';
      if (!parseKey(e2)) e2 = '';
      if (s && e2 && e2 < s) { var t = s; s = e2; e2 = t; }
      if (s === start && e2 === end) return;
      start = s;
      end = e2;
      picking = start ? (end ? 'start' : 'end') : 'start';
      if (start) gotoMonth(start);
      render();
    }

    render();
    // 卡片上那个是「主」实例：确认弹窗里改了出差范围后，靠它把新值刷到卡片上。
    // 弹窗内部自己也用到这个组件，但那一个传 expose:false，别把主实例的钩子顶掉。
    if (opts.expose !== false) global.__erTripRangeRefresh = refresh;

    return {
      refresh: refresh,
      get value() { return { startDate: start, endDate: end }; },
      destroy: function () {
        document.removeEventListener('mousedown', onDocDown, true);
        document.removeEventListener('keydown', onDocKey, true);
        wrap.remove();
      }
    };
  }

  global.TripDateRange = { mount: mount };
})(window);
