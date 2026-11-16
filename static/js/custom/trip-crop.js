/*
 * 行程单半页裁剪模块（二次开发新增）
 * ------------------------------------------------------------------
 * 目标：打车/网约车行程单通常是 A4 竖版，但有效内容只在上半部分，
 *       下半页全空白。直接参与「A4 双联合并」时会被按整页高度缩放，
 *       内容缩小到约 0.475 倍，字小且浪费半个槽位。
 *
 * 做法：在 PDF 字节进入任何处理环节之前，把它识别出来并把 CropBox
 *       裁到上半部分。项目原有的合并逻辑（static/js/alert-dialog.js）
 *       会在 cropBox.height < mediaBox.height * 0.95 时按 CropBox 嵌入，
 *       并按 min(A4W/vw, halfH/vh) * 0.95 缩放 —— 裁剪后自动放大近一倍，
 *       正好铺满一个双联槽位。预览 / 合并 / 报销单 / 打印全部受益。
 *
 * 触发条件（三者综合，避免误伤发票）：
 *   1. 只处理用户上传的 File（带 name），内部生成的 Blob 一律放过；
 *   2. 页面必须是无旋转的 A4 竖版（≈595.28 x 841.89 pt）。多数发票非 A4
 *      会被排除，但实测「滴滴出行电子发票.pdf」也是 A4 竖版且命中平台关键词，
 *      因此文件名标明「电子发票 / 增值税 / 发票号码」的一律直接放过；
 *   3. 文件名 / PDF 文本层命中行程单关键词，或文本明显集中在上半页；
 *      仅平台名命中且内容接近整页时跳过（只有明确写「行程单」才豁免）。
 *
 * 裁剪高度 = clamp( max(内容底部 + padding, 页面宽 / targetRatio), ... )
 *   targetRatio 默认 595.28 / 420.945 ≈ 1.414，即 A4 双联槽位比例。
 *   这样不同平台行程单裁出来的宽高比与发票在版面上的展示比例一致，
 *   不会出现「一张大一张小」。
 *
 * 依赖：window.pdfjsLib（文本坐标）、window.PDFLib（设置 CropBox）。
 *       两者缺失时自动降级为不处理，不会影响原有功能。
 *
 * 调试：右下角折叠面板，或控制台访问 window.__tripCropConfig /
 *       window.__tripCropCore（decide / analyze / applyCrop / getLogs）。
 */
(function () {
  'use strict';

  var A4W = 595.28;
  var A4H = 841.89;
  var STORE_KEY = '__tripCropSettings';

  var CFG = window.__tripCropConfig = {
    enabled: true,
    targetRatio: A4W / (A4H / 2), // ≈1.414，与 A4 双联槽位一致
    padding: 18,                  // 内容底部额外保留的空白（pt）
    maxContentRatio: 0.72,        // 内容底部超过页高 72% 视为整页文档
    minContentRatio: 0.10,        // 内容太少，判定为异常/扫描件
    a4Tolerance: 0.08,            // A4 尺寸容差
    percentile: 0.95,             // 用文本底部分位数抵抗孤立页脚
    debug: false
  };

  try {
    var saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
    Object.keys(CFG).forEach(function (k) {
      if (saved[k] !== undefined) CFG[k] = saved[k];
    });
  } catch (e) {}

  function saveCfg() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        enabled: CFG.enabled,
        targetRatio: CFG.targetRatio,
        padding: CFG.padding
      }));
    } catch (e) {}
  }

  var NAME_RE = /行程单|打车|滴滴|出行|用车|网约车|出租车|高德|曹操|T3|trip|itinerary|ride/i;
  var TEXT_RE = /行程单|里程|起步价|上车|下车|乘客|网约车|用车|滴滴|高德|曹操|服务平台|预估|实付|行程时间|订单编号/i;
  // 真实票据里存在 A4 竖版的电子发票（如「滴滴出行电子发票.pdf」），
  // 它会同时命中上面的平台关键词。因此文件名明确写着发票时必须直接放过。
  var INVOICE_NAME_RE = /电子发票|增值税|发票号码|invoice/i;
  var TRIP_DOC_RE = /行程单|行程报销单|itinerary|trip[\s_-]*(report|sheet)/i;

  var cache = new WeakMap();
  var logs = [];

  function addLog(entry) {
    entry.time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    logs.unshift(entry);
    if (logs.length > 30) logs.length = 30;
    if (CFG.debug) console.info('[行程裁剪]', entry);
    renderLogs();
  }

  function shortName(name) {
    name = name || '(无名)';
    return name.length > 28 ? name.slice(0, 12) + '…' + name.slice(-12) : name;
  }

  /* ------------------------------------------------------------------ *
   * 1. 分析：用 pdf.js 取第一页尺寸、旋转、文本与内容底部边界
   * ------------------------------------------------------------------ */
  async function waitForLibs(maxWait) {
    var end = Date.now() + (maxWait || 6000);
    while (Date.now() < end) {
      if (window.pdfjsLib && window.PDFLib) return true;
      await new Promise(function (r) { setTimeout(r, 150); });
    }
    return false;
  }

  // viewport 变换矩阵 × 文本变换矩阵（不依赖 pdfjsLib.Util，兼容 v4）
  function mulTransform(v, t) {
    return [
      v[0] * t[0] + v[2] * t[1],
      v[1] * t[0] + v[3] * t[1],
      v[0] * t[2] + v[2] * t[3],
      v[1] * t[2] + v[3] * t[3],
      v[0] * t[4] + v[2] * t[5] + v[4],
      v[1] * t[4] + v[3] * t[5] + v[5]
    ];
  }

  async function analyze(buf) {
    if (!window.pdfjsLib) return null;
    // 复用项目已有的 workerSrc 设置
    try {
      if (window.__expenseReportCore && window.__expenseReportCore.initPdfJs) {
        window.__expenseReportCore.initPdfJs();
      }
    } catch (e) {}

    var pdf = null;
    try {
      pdf = await window.pdfjsLib.getDocument({
        data: buf.slice(0), // pdf.js 会 transfer 传入的 buffer，必须给副本
        cMapUrl: new URL('static/cmaps/', window.location.href).href,
        cMapPacked: true,
        useSystemFonts: true
      }).promise;

      var page = await pdf.getPage(1);
      var vp = page.getViewport({ scale: 1 });
      var tc = await page.getTextContent();
      var bottoms = [];
      var text = '';

      for (var i = 0; i < tc.items.length; i++) {
        var it = tc.items[i];
        if (!it.str || !it.str.trim() || !it.transform) continue;
        text += it.str + ' ';
        var tx = mulTransform(vp.transform, it.transform);
        var fontH = Math.sqrt(tx[2] * tx[2] + tx[3] * tx[3]) || (it.height || 0);
        // viewport 的 y 向下为正，文字基线下方还有下伸部
        var bottom = tx[5] + Math.max(2, fontH * 0.25);
        if (bottom > 0 && bottom <= vp.height + 2) bottoms.push(bottom);
      }

      if (!bottoms.length) return null;
      bottoms.sort(function (a, b) { return a - b; });

      // 用分位数而不是最大值，避免页脚一行小字把裁剪线拉回页底
      var idx = Math.min(bottoms.length - 1, Math.floor(bottoms.length * CFG.percentile));
      var contentBottom = bottoms[idx];

      return {
        width: vp.width,
        height: vp.height,
        rotate: page.rotate || 0,
        contentBottom: contentBottom,
        contentBottomMax: bottoms[bottoms.length - 1],
        textItems: bottoms.length,
        text: text.slice(0, 4000),
        pages: pdf.numPages
      };
    } catch (e) {
      return { error: e && e.message ? e.message : String(e) };
    } finally {
      try { if (pdf) await pdf.destroy(); } catch (e) {}
    }
  }

  /* ------------------------------------------------------------------ *
   * 2. 决策：是否裁剪、裁到多高
   *    纯函数，便于单测
   * ------------------------------------------------------------------ */
  function decide(a, name) {
    if (!a || a.error) return { crop: false, reason: a && a.error ? '解析失败：' + a.error : '无文本层' };

    var fileName = name || '';
    var nameHit = NAME_RE.test(fileName);
    var textHit = TEXT_RE.test(a.text || '');
    var tripDocName = TRIP_DOC_RE.test(fileName);
    var invoiceName = INVOICE_NAME_RE.test(fileName) && !tripDocName;
    var w = a.width, h = a.height;

    if (a.rotate % 360 !== 0) {
      return { crop: false, reason: '页面有旋转，跳过' };
    }

    var isA4Portrait =
      Math.abs(w - A4W) < A4W * CFG.a4Tolerance &&
      Math.abs(h - A4H) < A4H * CFG.a4Tolerance &&
      h > w;
    if (!isA4Portrait) {
      // 多数发票不是 A4 竖版，这里直接放过，正是「比例不同」的处理方式
      return { crop: false, reason: '非 A4 竖版（按发票处理）' };
    }
    // 但并非全部：实测「滴滴出行电子发票.pdf」就是 595.3×841.9 的 A4，
    // 且文件名命中平台关键词。带「电子发票 / 增值税 / 发票号码」的一律按发票处理。
    if (invoiceName) {
      return { crop: false, reason: '文件名标明为发票（按发票处理）' };
    }

    var ratio = a.contentBottom / h;

    if (ratio < CFG.minContentRatio) {
      return { crop: false, reason: '内容过少，疑似扫描件/异常' };
    }

    // 内容接近整页时不裁；只有文件名明确是行程单才豁免（真行程单下半页空白）
    if (ratio > CFG.maxContentRatio && !tripDocName) {
      return { crop: false, reason: '内容接近整页，跳过' };
    }
    if (!nameHit && !textHit && ratio > 0.60) {
      return { crop: false, reason: '无行程单特征且内容超过上半页' };
    }

    // 目标比例 → 至少保留这么高，保证裁完与发票在双联里的展示比例一致
    var minH = w / (CFG.targetRatio || 1.414);
    var wanted = Math.max(a.contentBottom + (CFG.padding || 0), minH);
    var newH = Math.min(wanted, h * 0.97);
    if (newH >= h * 0.97) {
      return { crop: false, reason: '可裁掉的空白不足 3%' };
    }

    return {
      crop: true,
      newH: newH,
      originalRatio: w / h,
      croppedRatio: w / newH,
      contentBottom: a.contentBottom,
      contentRatio: ratio,
      nameHit: nameHit,
      textHit: textHit,
      pages: a.pages
    };
  }

  /* ------------------------------------------------------------------ *
   * 3. 应用：只改 CropBox，保留 MediaBox
   *    合并逻辑靠 cropBox.height < mediaBox.height * 0.95 触发裁剪嵌入
   * ------------------------------------------------------------------ */
  async function applyCrop(buf, newH) {
    var PDFLib = window.PDFLib;
    var doc = await PDFLib.PDFDocument.load(buf, {
      ignoreEncryption: true,
      updateMetadata: false
    });
    var changed = 0;
    for (var i = 0; i < doc.getPageCount(); i++) {
      var p = doc.getPage(i);
      var cb = p.getCropBox();
      var mb = p.getMediaBox();
      // 已经自带有效裁剪框的页面不重复处理
      if (cb.height < mb.height * 0.95) continue;
      var h = Math.min(newH, mb.height);
      p.setCropBox(mb.x, mb.y + mb.height - h, mb.width, h);
      changed++;
    }
    if (!changed) return null;
    var out = await doc.save();
    return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
  }

  /* ------------------------------------------------------------------ *
   * 4. 挂载：链式包装 Blob.prototype.arrayBuffer
   *    本文件用 defer 在 main.html 末尾加载，因此包在
   *    patchArrayBufferForCropBox（负责负 CropBox 归一化）的外层：
   *    tripCrop -> normalizePdf -> 原生 arrayBuffer
   * ------------------------------------------------------------------ */
  var prevArrayBuffer = Blob.prototype.arrayBuffer;

  Blob.prototype.arrayBuffer = async function () {
    var buf = await prevArrayBuffer.call(this);

    if (!CFG.enabled) return buf;
    // 只处理用户上传的 File；内部生成的合并 Blob / 报销单 Blob 没有 name
    if (!this.name || !/\.pdf$/i.test(this.name)) return buf;
    if (this.type && this.type !== 'application/pdf') return buf;
    if (!buf || buf.byteLength < 1000) return buf;

    if (cache.has(this)) {
      var hit = cache.get(this);
      return hit ? hit.slice().buffer : buf;
    }

    var ready = await waitForLibs(6000);
    if (!ready) {
      addLog({ name: this.name, status: 'skip', reason: 'pdf.js / pdf-lib 未就绪，未裁剪' });
      cache.set(this, null);
      return buf;
    }

    try {
      var a = await analyze(buf);
      var d = decide(a, this.name);
      if (!d.crop) {
        addLog({
          name: this.name, status: 'skip', reason: d.reason,
          size: a && a.width ? Math.round(a.width) + '×' + Math.round(a.height) : '-',
          ratio: a && a.width ? (a.width / a.height).toFixed(2) : '-'
        });
        cache.set(this, null);
        return buf;
      }

      var outBuf = await applyCrop(buf, d.newH);
      if (!outBuf) {
        addLog({ name: this.name, status: 'skip', reason: '页面已自带 CropBox' });
        cache.set(this, null);
        return buf;
      }

      var snapshot = new Uint8Array(outBuf);
      cache.set(this, snapshot);

      addLog({
        name: this.name,
        status: 'crop',
        size: Math.round(a.width) + '×' + Math.round(a.height),
        cropH: Math.round(d.newH),
        contentBottom: Math.round(d.contentBottom),
        originalRatio: d.originalRatio.toFixed(2),
        croppedRatio: d.croppedRatio.toFixed(2),
        hit: (d.nameHit ? '文件名 ' : '') + (d.textHit ? '文本' : '') || '内容分布',
        pages: d.pages
      });

      // pdf.js / pdf-lib 可能 detach 传入的 buffer，每次返回新副本
      return snapshot.slice().buffer;
    } catch (e) {
      console.warn('[行程裁剪] 处理失败，已回退原文件:', this.name, e);
      addLog({ name: this.name, status: 'skip', reason: '异常：' + (e && e.message) });
      cache.set(this, null);
      return buf;
    }
  };

  /* ------------------------------------------------------------------ *
   * 5. 调试面板（可折叠，默认收起，不干扰原有操作）
   * ------------------------------------------------------------------ */
  var panelBody = null;

  function renderLogs() {
    if (!panelBody) return;
    var list = panelBody.querySelector('[data-role="logs"]');
    if (!list) return;
    list.innerHTML = '';
    logs.slice(0, 8).forEach(function (e) {
      var row = document.createElement('div');
      row.style.cssText = 'padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:11px;line-height:1.5;word-break:break-all;';
      var color = e.status === 'crop' ? '#0f766e' : '#94a3b8';
      var label = e.status === 'crop' ? '已裁剪' : '跳过';
      var detail = e.status === 'crop'
        ? '原 ' + e.size + ' → 高 ' + e.cropH + 'pt ｜ 比例 ' + e.originalRatio + ' → ' + e.croppedRatio + ' ｜ 命中 ' + e.hit
        : (e.reason || '') + (e.size && e.size !== '-' ? '（' + e.size + '，比例 ' + e.ratio + '）' : '');
      row.innerHTML = '<span style="color:' + color + ';font-weight:600;">' + label + '</span> ' +
        '<span style="color:#334155;">' + shortName(e.name) + '</span>' +
        '<div style="color:#64748b;margin-top:2px;">' + detail + '</div>';
      list.appendChild(row);
    });
    if (!logs.length) {
      list.innerHTML = '<div style="padding:8px 0;color:#94a3b8;font-size:11px;">上传 PDF 后这里会显示识别与裁剪结果</div>';
    }
  }

  function buildPanel() {
    if (document.getElementById('__trip_crop_panel')) return;
    var box = document.createElement('div');
    box.id = '__trip_crop_panel';
    box.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483000;' +
      'font:13px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;background:#fff;color:#1f2937;' +
      'border:1px solid #d1d5db;border-radius:12px;box-shadow:0 6px 24px rgba(15,23,42,.14);width:300px;';

    var head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:10px 12px;cursor:pointer;user-select:none;';
    head.innerHTML = '<span style="font-weight:600;font-size:13px;">行程单半页裁剪</span>' +
      '<span data-role="toggle" style="color:#64748b;font-size:12px;">展开 ▾</span>';

    panelBody = document.createElement('div');
    panelBody.style.cssText = 'display:none;padding:0 12px 12px;border-top:1px solid #e2e8f0;';

    var mkRow = function (label, input) {
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;padding-top:10px;font-size:12px;color:#475569;';
      var l = document.createElement('span');
      l.textContent = label;
      input.style.cssText = 'width:92px;padding:3px 6px;border:1px solid #cbd5e1;border-radius:6px;font-size:12px;color:#1f2937;';
      row.appendChild(l);
      row.appendChild(input);
      panelBody.appendChild(row);
      return row;
    };

    var chk = document.createElement('input');
    chk.type = 'checkbox';
    chk.checked = !!CFG.enabled;
    chk.style.cssText = 'width:auto;padding:0;';
    chk.addEventListener('change', function () {
      CFG.enabled = chk.checked;
      saveCfg();
      addLog({ name: '设置', status: chk.checked ? 'crop' : 'skip', reason: chk.checked ? '自动裁剪已开启' : '自动裁剪已关闭' });
    });
    var rowChk = mkRow('自动裁剪', chk);
    rowChk.querySelector('input').style.width = 'auto';

    var ratioInput = document.createElement('input');
    ratioInput.type = 'number';
    ratioInput.step = '0.01';
    ratioInput.min = '0.5';
    ratioInput.max = '4';
    ratioInput.value = String(Number(CFG.targetRatio).toFixed(3));
    ratioInput.addEventListener('change', function () {
      var v = parseFloat(ratioInput.value);
      if (v > 0.5 && v < 4) { CFG.targetRatio = v; saveCfg(); }
    });
    mkRow('目标宽高比', ratioInput);

    var padInput = document.createElement('input');
    padInput.type = 'number';
    padInput.step = '2';
    padInput.min = '0';
    padInput.max = '200';
    padInput.value = String(CFG.padding);
    padInput.addEventListener('change', function () {
      var v = parseFloat(padInput.value);
      if (!isNaN(v) && v >= 0) { CFG.padding = v; saveCfg(); }
    });
    mkRow('底部留白 pt', padInput);

    var tip = document.createElement('div');
    tip.style.cssText = 'margin-top:10px;padding:7px 8px;background:#f8fafc;border-radius:6px;font-size:11px;color:#64748b;line-height:1.6;';
    tip.textContent = '仅处理 A4 竖版、内容集中在上半页的上传文件；非 A4、文件名标明发票或内容接近整页的文件自动跳过。改动即时生效，修改设置后请重新上传文件。';
    panelBody.appendChild(tip);

    var logTitle = document.createElement('div');
    logTitle.style.cssText = 'margin-top:10px;font-size:11px;color:#94a3b8;';
    logTitle.textContent = '处理记录（最近 8 条）';
    panelBody.appendChild(logTitle);

    var list = document.createElement('div');
    list.setAttribute('data-role', 'logs');
    list.style.cssText = 'max-height:180px;overflow:auto;';
    panelBody.appendChild(list);

    head.addEventListener('click', function () {
      var open = panelBody.style.display !== 'none';
      panelBody.style.display = open ? 'none' : 'block';
      head.querySelector('[data-role="toggle"]').textContent = open ? '展开 ▾' : '收起 ▴';
      if (!open) renderLogs();
    });

    box.appendChild(head);
    box.appendChild(panelBody);
    document.body.appendChild(box);
    renderLogs();
  }

  window.__tripCropCore = {
    decide: decide,
    analyze: analyze,
    applyCrop: applyCrop,
    getLogs: function () { return logs.slice(); },
    clearCache: function () { cache = new WeakMap(); },
    config: CFG
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = window.__tripCropCore;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildPanel);
  } else {
    buildPanel();
  }
})();
