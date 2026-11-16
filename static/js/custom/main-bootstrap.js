    (function () {

      (function patchArrayBufferForCropBox() {
        const _normCache = new WeakMap();
        async function normalizePdf(buffer) {
          try {
            if (!window.PDFLib || buffer.byteLength < 5) return buffer;
            const head = new Uint8Array(buffer.slice(0, 5));
            if (String.fromCharCode.apply(null, head) !== '%PDF-') return buffer;
            const doc = await window.PDFLib.PDFDocument.load(buffer, { updateMetadata: false });
            let changed = false;
            for (const page of doc.getPages()) {
              const cb = page.getCropBox();
              if (cb.width < 0 || cb.height < 0) {
                page.setCropBox(Math.min(cb.x, cb.x + cb.width), Math.min(cb.y, cb.y + cb.height), Math.abs(cb.width), Math.abs(cb.height));
                changed = true;
              }
              const mb = page.getMediaBox();
              if (mb.width < 0 || mb.height < 0) {
                page.setMediaBox(Math.min(mb.x, mb.x + mb.width), Math.min(mb.y, mb.y + mb.height), Math.abs(mb.width), Math.abs(mb.height));
                changed = true;
              }
            }
            if (!changed) return buffer;
            const out = await doc.save();
            return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
          } catch (e) {
            return buffer;
          }
        }
        const origAB = Blob.prototype.arrayBuffer;
        Blob.prototype.arrayBuffer = async function () {
          if (this.type !== 'application/pdf') return origAB.call(this);

          let bytes = _normCache.get(this);
          if (!bytes) {
            const buf = await origAB.call(this);
            const fixed = await normalizePdf(buf);
            bytes = new Uint8Array(fixed);
            _normCache.set(this, bytes);
          }
          return bytes.slice().buffer;
        };
      })();

      const _origCreateObjectURL = URL.createObjectURL.bind(URL);
      URL.createObjectURL = function (obj) {
        const url = _origCreateObjectURL(obj);
        if (obj && obj.type === 'application/pdf' && obj.size > 1000) {
          window.__lastPdfBlobUrl = url;
          window.__lastPdfBlob = obj;

          if (!window.__isGeneratingReport) {
            window.__invoiceMergedBlob = obj;
          }
        }
        return url;
      };

      const { initPdfJs, extractInvoiceDataFromPdf } = window.__expenseReportCore || {};

      window.__invoiceDataCache = window.__invoiceDataCache || {};

      // 与 file-copy-print.js 共用同一套文件键口径：同名文件不再互相覆盖。
      const fileKeyOf = (file) => (window.__fileKey ? window.__fileKey(file) : (file && file.name) || '');
      function findFileKeyByName(name) {
        const cache = window.__fileDebugCache;
        if (!cache || !name) return null;
        for (const [key, file] of cache.entries()) {
          if (file && file.name === name) return key;
        }
        return null;
      }

      function initFileProxy() {
        if (!window.__fileDebugCache) {
          setTimeout(initFileProxy, 600);
          return;
        }

        for (const [key, file] of window.__fileDebugCache.entries()) {
          const name = file && file.name || '';
          if (
            name.toLowerCase().endsWith('.pdf') &&
            !name.includes('_副本') &&
            !/^报销单[_-]|^报销单\.pdf$/i.test(name) &&
            !name.startsWith('000_')
          ) {
            if (!window.__invoiceDataCache[key]) {
              extractInvoiceDataFromPdf(name, file).then((d) => {
                window.__invoiceDataCache[key] = d;
                if (typeof refreshStatsCard === 'function') refreshStatsCard();
              });
            }
          }
        }

        const origSet = Map.prototype.set;
        window.__fileDebugCache.set = function (key, value) {
          // 忽略调用方传来的文件名 key，统一按文件指纹归一化。
          const fileKey = fileKeyOf(value);
          const name = (value && value.name) || '';
          const result = origSet.call(this, fileKey, value);
          if (
            name.toLowerCase().endsWith('.pdf') &&
            !name.includes('_副本') &&
            !/^报销单[_-]|^报销单\.pdf$/i.test(name) &&
            !name.startsWith('000_')
          ) {
            extractInvoiceDataFromPdf(name, value).then((d) => {
              window.__invoiceDataCache[fileKey] = d;
              console.log('✅ 自动识别完成:', name, '¥' + d.amount);
              if (typeof refreshStatsCard === 'function') refreshStatsCard();
            });
          }
          return result;
        };

        console.log('✅ 发票自动识别代理已启动');
      }
      setTimeout(initFileProxy, 300);

      // ── 发票统计卡片修正：按实际识别内容分类（发票 / 行程单）──
      // React 壳的「发票统计」卡片把每个上传文件都计为 1 张发票、且金额含行程单，
      // 这里按 custom 识别结果（isTrip）重写为分类统计。
      function statsItemsFiltered() {
        return Object.values(window.__invoiceDataCache || {}).filter((v) => v &&
          !/^报销单[_-]|^报销单\.pdf$/i.test(v.fileName || '') &&
          !(v.fileName || '').startsWith('000_'));
      }

      function findStatsCard() {
        // 卡片标题恒为「发票统计」（React 渲染），修正只替换 content，标题始终保留
        for (const el of document.querySelectorAll('[data-slot="card"]')) {
          const t = el.textContent || '';
          if (t.includes('发票统计') || (t.includes('发票数量') && t.includes('总金额'))) return el;
        }
        return null;
      }

      function refreshStatsCard() {
        try {
          const items = statsItemsFiltered();
          if (!items.length) return false;
          const card = findStatsCard();
          if (!card) return false;

          const inv = items.filter((v) => !v.isTrip);
          const trips = items.filter((v) => v.isTrip);
          const invAmt = Math.round(inv.reduce((a, v) => a + (parseFloat(v.amount) || 0), 0) * 100) / 100;
          const tripAmt = Math.round(trips.reduce((a, v) => a + (parseFloat(v.amount) || 0), 0) * 100) / 100;
          const sig = [inv.length, invAmt.toFixed(2), trips.length, tripAmt.toFixed(2)].join('|');

          const content = card.querySelector('[data-slot="card-content"]') || card;
          // 内容指纹一致则跳过（防 React 重渲染 / 自身写入触发死循环）
          const cur = content.querySelector('[data-stats-fixed]');
          if (cur && cur.getAttribute('data-stats-sig') === sig) return true;

          content.innerHTML = `
            <div data-stats-fixed="1" data-stats-sig="${sig}" style="display:flex;flex-direction:column;gap:10px;">
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <span style="color:#4b5563;">发票</span>
                <span style="font-weight:600;">${inv.length} 张 · ¥${invAmt.toFixed(2)}</span>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:center;">
                <span style="color:#4b5563;">行程单</span>
                <span style="font-weight:600;color:#b45309;">${trips.length} 份 · ¥${tripAmt.toFixed(2)}
                  <span style="font-weight:400;color:#9ca3af;">（仅核对，不计入）</span></span>
              </div>
              <div style="display:flex;justify-content:space-between;align-items:center;border-top:1px dashed #e5e7eb;padding-top:8px;">
                <span style="color:#4b5563;">合计（发票）</span>
                <span style="font-weight:700;color:#15803d;">¥${invAmt.toFixed(2)}</span>
              </div>
            </div>`;
          return true;
        } catch (e) {
          return false;
        }
      }

      // 挂 MutationObserver：React 把统计卡片重渲染回原样后，立即按实际识别内容修正
      // 注意：本脚本在 <head> 中同步执行，须等 document.body 就绪后再挂观察器
      let _statsFixTimer = null;
      function scheduleStatsFix() {
        if (_statsFixTimer) return;
        _statsFixTimer = setTimeout(() => {
          _statsFixTimer = null;
          refreshStatsCard();
        }, 150);
      }
      (function watchStatsCard() {
        const tryStart = () => {
          if (!document.body) { setTimeout(tryStart, 250); return; }
          const obs = new MutationObserver(() => {
            try {
              // 卡片标题「发票统计」恒存在；React 重渲染恢复原样后能再次捕获并修正
              const card = findStatsCard();
              if (card) scheduleStatsFix();
            } catch (e) { /* ignore */ }
          });
          obs.observe(document.body, { childList: true, subtree: true });
          // 不要按时间自断：页面开着超过 10 分钟后 React 重渲染会把统计卡片
          // 恢复成「行程单也算发票」的错误口径，而那时已经没人再修正它。
          refreshStatsCard();
        };
        tryStart();
      })();

      function parseStatsFromDOM() {
        let totalAmount = null;
        let invoiceCount = null;

        const walk = (el) => {
          if (!el || (invoiceCount !== null && totalAmount !== null)) return;

          const text = (el.textContent || '').trim();
          const countMatch = text.match(/发票数量[：:]\s*(\d+)|(\d+)\s*张/);
          if (countMatch && invoiceCount === null) {
            invoiceCount = parseInt(countMatch[1] || countMatch[2], 10);
          }

          const amountMatch = text.match(/总金额[：:]\s*¥?\s*([\d,]+\.?\d*)|¥\s*([\d,]+\.?\d*)/);
          if (amountMatch && totalAmount === null) {
            totalAmount = parseFloat((amountMatch[1] || amountMatch[2] || '').replace(/,/g, ''));
          }

          if (el.children) {
            for (let i = 0; i < el.children.length; i++) walk(el.children[i]);
          }
        };

        const statsCard = document.querySelector('[class*="stats"]') || document.body;
        walk(statsCard);

        return {
          totalAmount: totalAmount !== null && !isNaN(totalAmount) ? totalAmount : null,
          invoiceCount,
        };
      }

      async function getInvoiceDataFromApp() {
        await new Promise((r) => setTimeout(r, 300));
        let invoices = [];

        try {
          const root = document.querySelector('#__next') || document.body;
          const fk = Object.keys(root).find(
            (k) => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance')
          );

          if (fk) {
            const findStats = (node, depth = 0) => {
              if (depth > 20) return null;

              if (node && node.memoizedState) {
                let cur = node.memoizedState;
                while (cur) {
                  if (cur.memoizedState && cur.memoizedState.stats) return cur.memoizedState.stats;
                  if (cur.memoizedState && cur.memoizedState.invoices) {
                    return { invoices: cur.memoizedState.invoices };
                  }
                  cur = cur.next;
                }
              }

              const rc = node.child ? findStats(node.child, depth + 1) : null;
              if (rc) return rc;
              return node.sibling ? findStats(node.sibling, depth + 1) : null;
            };

            const stats = findStats(root[fk]);
            if (stats && stats.invoices && stats.invoices.length > 0) {
              // 别在生成热路径里逐张 JSON.stringify(inv)：对象里带 File / 日期等大字段，
              // 每张序列化一次就是白白烧掉的几十毫秒。
              console.log('🔍 React 发票数:', stats.invoices.length, '字段:', Object.keys(stats.invoices[0] || {}).join(', '));

              const cache = window.__invoiceDataCache || {};

              if (window.__fileDebugCache) {
                const pending = [];
                for (const inv of stats.invoices) {
                  const fileKey = findFileKeyByName(inv.fileName);
                  if (fileKey && !cache[fileKey]) {
                    const file = window.__fileDebugCache.get(fileKey);
                    if (file) {
                      pending.push(
                        extractInvoiceDataFromPdf(inv.fileName, file).then((d) => {
                          window.__invoiceDataCache[fileKey] = d;
                        })
                      );
                    }
                  }
                }
                if (pending.length > 0) await Promise.all(pending);
              }

              const freshCache = window.__invoiceDataCache || {};
              const statsTotal = stats.totalAmount ?? stats.total ?? stats.amount ?? null;
              invoices = stats.invoices.map((inv) => {
                const cached = freshCache[findFileKeyByName(inv.fileName)] || {};

                const reactAmount = typeof inv.total === 'number' ? inv.total / 100 : null;
                const amount = reactAmount ?? cached.amount ?? 0;
                return {
                  amount,
                  issueDate: cached.date || inv.date || new Date(),
                  date: cached.date || inv.date || new Date(),
                  projectName: inv.itemName || inv.name || cached.itemName || '电子发票',
                  itemName: inv.itemName || inv.name || cached.itemName || '电子发票',
                  fileName: inv.fileName || '',
                  isTrip: !!cached.isTrip,
                  trip: cached.trip || null,
                };
              });

              let tot = null;
              if (typeof statsTotal === 'number') tot = statsTotal / 100;

              return { invoices, totalAmount: tot, totalCount: invoices.length };
            }
          }
        } catch (e) {
          console.log('React获取失败:', e.message);
        }

        if (window.__invoiceDataCache) {
          const cached = Object.values(window.__invoiceDataCache).filter(
            (inv) => inv && !/^报销单[_-]|^报销单\.pdf$/i.test(inv.fileName) && !inv.fileName.startsWith('000_')
          );

          if (cached.length > 0) {
            const domStats = parseStatsFromDOM();
            const totalAmount = domStats.totalAmount !== null ? domStats.totalAmount : null;
            return {
              invoices: cached.map((inv) => ({
                amount: inv.amount,
                issueDate: inv.date,
                date: inv.date,
                projectName: inv.itemName,
                itemName: inv.itemName,
                fileName: inv.fileName,
                isTrip: !!inv.isTrip,
                trip: inv.trip || null,
              })),
              totalAmount,
              totalCount: cached.length,
            };
          }
        }

        if (window.__fileDebugCache && window.__fileDebugCache.size > 0) {
          const pending = [];
          for (const [key, file] of window.__fileDebugCache.entries()) {
            const name = file && file.name || '';
            if (
              name.toLowerCase().endsWith('.pdf') &&
              !name.includes('_副本') &&
              !/^报销单[_-]|^报销单\.pdf$/i.test(name) &&
              !name.startsWith('000_')
            ) {
              if (!window.__invoiceDataCache[key]) {
                pending.push(
                  extractInvoiceDataFromPdf(name, file).then((d) => {
                    window.__invoiceDataCache[key] = d;
                  })
                );
              }
            }
          }

          if (pending.length > 0) await Promise.all(pending);

          const fresh = Object.values(window.__invoiceDataCache).filter(
            (inv) => inv && !/^报销单[_-]|^报销单\.pdf$/i.test(inv.fileName) && !inv.fileName.startsWith('000_')
          );

          if (fresh.length > 0) {
            const domStats = parseStatsFromDOM();
            return {
              invoices: fresh.map((inv) => ({
                amount: inv.amount,
                issueDate: inv.date,
                date: inv.date,
                projectName: inv.itemName,
                itemName: inv.itemName,
                fileName: inv.fileName,
                isTrip: !!inv.isTrip,
                trip: inv.trip || null,
              })),
              totalAmount: domStats.totalAmount,
              totalCount: fresh.length,
            };
          }

          for (const [, file] of window.__fileDebugCache.entries()) {
            const name = file && file.name || '';
            if (
              name.toLowerCase().endsWith('.pdf') &&
              !name.includes('_副本') &&
              !/^报销单[_-]|^报销单\.pdf$/i.test(name) &&
              !name.startsWith('000_')
            ) {
              invoices.push({
                amount: 0,
                date: new Date(),
                issueDate: new Date(),
                projectName: '电子发票',
                itemName: '电子发票',
                fileName: name,
                isTrip: false,
                trip: null,
              });
            }
          }
        }

        const domStats = parseStatsFromDOM();
        return { invoices, totalAmount: domStats.totalAmount, totalCount: invoices.length };
      }

      function numberToChinese(money) {
        const cnNums = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖'];
        const cnIntRadice = ['', '拾', '佰', '仟'];
        const cnIntUnits = ['', '万', '亿', '兆'];
        const cnDecUnits = ['角', '分'];
        const cnInteger = '整';
        const cnIntLast = '元';
        const maxNum = 999999999999.99;

        if (money === 0) return '零元整';
        if (money >= maxNum) return '金额过大';

        let integerNum;
        let decimalNum;
        let chineseStr = '';
        let parts;

        money = parseFloat(money);
        if (money < 0) return '';

        if (money === 0) {
          chineseStr = cnNums[0] + cnIntLast + cnInteger;
          return chineseStr;
        }

        money = money.toString();
        if (money.indexOf('.') === -1) {
          integerNum = money;
          decimalNum = '';
        } else {
          parts = money.split('.');
          integerNum = parts[0];
          decimalNum = parts[1].substr(0, 2);
        }

        if (parseInt(integerNum, 10) > 0) {
          let zeroCount = 0;
          const IntLen = integerNum.length;
          for (let i = 0; i < IntLen; i++) {
            const n = integerNum.substr(i, 1);
            const p = IntLen - i - 1;
            const q = p / 4;
            const m = p % 4;

            if (n === '0') {
              zeroCount++;
            } else {
              if (zeroCount > 0) {
                chineseStr += cnNums[0];
              }
              zeroCount = 0;
              chineseStr += cnNums[parseInt(n)] + cnIntRadice[m];
            }

            if (m === 0 && zeroCount < 4) {
              chineseStr += cnIntUnits[q];
            }
          }
          chineseStr += cnIntLast;
        }

        if (decimalNum !== '') {
          const decLen = decimalNum.length;
          for (let i = 0; i < decLen; i++) {
            const n = decimalNum.substr(i, 1);
            if (n !== '0') {
              chineseStr += cnNums[Number(n)] + cnDecUnits[i];
            }
          }
        }

        if (chineseStr === '') {
          chineseStr += cnNums[0] + cnIntLast + cnInteger;
        } else if (decimalNum === '') {
          chineseStr += cnInteger;
        }

        return chineseStr;
      }

      // ------------------------------------------------------------------
      // 差旅报销单配置：卡片上的出差起止日期 / 地点 / 原因 / 每日补贴
      // 也可在控制台用 window.setTripExpenseConfig({...}) 覆盖（含费用归类关键词）
      // ------------------------------------------------------------------
      window.__tripExpenseConfig = Object.assign(
        { startDate: '', endDate: '', location: '', reason: '', dailyAllowance: 50,
          traveler: '', formNo: 'YF-FBCW10-2022' },
        window.__tripExpenseConfig || {}
      );

      window.setTripExpenseConfig = function (patch) {
        window.__tripExpenseConfig = Object.assign({}, window.__tripExpenseConfig, patch || {});
        return window.__tripExpenseConfig;
      };

      function readTripConfigFromUI() {
        const cfg = Object.assign({}, window.__tripExpenseConfig);
        const val = (id) => {
          const el = document.getElementById(id);
          return el ? el.value : null;
        };
        const s = val('__er_trip_start'), e = val('__er_trip_end');
        const loc = val('__er_trip_location'), reason = val('__er_trip_reason');
        const allowance = val('__er_trip_allowance');
        const traveler = val('__er_trip_traveler'), formNo = val('__er_trip_formno');
        if (s !== null) cfg.startDate = s || '';
        if (e !== null) cfg.endDate = e || '';
        if (loc !== null) cfg.location = loc || '';
        if (reason !== null) cfg.reason = reason || '';
        if (traveler !== null) cfg.traveler = traveler || '';
        if (formNo !== null) cfg.formNo = formNo || '';
        if (allowance !== null && allowance !== '') {
          const n = parseFloat(allowance);
          if (!isNaN(n) && n >= 0) cfg.dailyAllowance = n;
        }
        if (cfg.startDate && cfg.endDate && cfg.startDate > cfg.endDate) {
          console.warn('⚠️ 出差结束日期早于开始日期，已自动对调');
          const t = cfg.startDate; cfg.startDate = cfg.endDate; cfg.endDate = t;
        }
        window.__tripExpenseConfig = cfg;
        return cfg;
      }

      // 差旅费报销单：表格生成已拆到 static/js/custom/expense-report-table.js
      // 保留原函数签名，自动/手动生成两条链路无需改动。
      function generateExpenseReportHTML(invoiceData, totalAmountOverride, tripConfig, options) {
        const api = window.__expenseReportTable;
        if (!api) throw new Error("差旅报销单模块未加载：static/js/custom/expense-report-table.js");
        const uiCfg = (typeof readTripConfigFromUI === "function") ? readTripConfigFromUI() : {};
        const cfg = Object.assign({}, window.__tripExpenseConfig || {}, uiCfg, tripConfig || {});
        return api.generateExpenseReportHTML(invoiceData, totalAmountOverride, cfg,
          { numberToChinese: numberToChinese, preview: !!(options && options.preview) });
      }

      // ------------------------------------------------------------------
      // 生成报销单：两个入口统一走「先人工确认，再生成」
      // 确认过的人工修正（项目名 / 金额 / 归行日期）会缓存在 window 上，
      // 下次重新从 React 取数后依旧生效，不会一刷新就打回原形。
      // ------------------------------------------------------------------
      window.__expenseReportOverrides = window.__expenseReportOverrides || {};

      function expenseOverrideKey(inv, idx) {
        return String((inv && inv.fileName) || '') + '::' + idx;
      }

      function applyExpenseReportOverrides(invoiceData) {
        const ov = window.__expenseReportOverrides || {};
        (invoiceData || []).forEach((inv, idx) => {
          const o = ov[expenseOverrideKey(inv, idx)];
          if (!o) return;
          if (o.projectName != null) { inv.projectName = o.projectName; inv.itemName = o.itemName; }
          if (o.amount != null) inv.amount = o.amount;
          if (o.reportDate) inv.__reportDate = o.reportDate;
          else delete inv.__reportDate;
          if (o.category) inv.__reportCategory = o.category;
          else delete inv.__reportCategory;
          if (o.tripDate && inv.trip) inv.trip = Object.assign({}, inv.trip, { primaryDate: o.tripDate });
        });
        return invoiceData;
      }

      function saveExpenseReportOverrides(invoiceData) {
        const ov = {};
        (invoiceData || []).forEach((inv, idx) => {
          ov[expenseOverrideKey(inv, idx)] = {
            projectName: inv.projectName, itemName: inv.itemName, amount: inv.amount,
            reportDate: inv.__reportDate || '',
            category: inv.__reportCategory || '',
            tripDate: (inv.trip && inv.trip.primaryDate) || ''
          };
        });
        window.__expenseReportOverrides = ov;
      }

      function assertReportLibs() {
        if (typeof html2canvas === 'undefined') throw new Error('html2canvas 库未加载');
        if (!window.jspdf) throw new Error('jsPDF 库未加载');
        if (!window.PDFLib) throw new Error('PDF-lib 库未加载');
        if (!window.__expenseReportTable) throw new Error('差旅报销单模块未加载');
      }

      // ---- 生成性能工具 ----
      const perfNow = () => (window.performance && performance.now ? performance.now() : Date.now());
      // 让浏览器先把当前 DOM 变化画出来，再进入下一段同步重活。
      // 没有这个让帧，html2canvas / jsPDF 的长同步任务会把「正在生成」提示整个堵死，
      // 用户看到的就是「点了确认，屏幕僵住 4-5 秒」。
      const nextPaint = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      const setProcessingText = (text) => {
        if (window.updateProcessingNotification) window.updateProcessingNotification(text);
        else if (window.showProcessingNotification) window.showProcessingNotification(text);
      };

      // 增量重识别：只补识别「尚未识别」的 PDF，避免每次生成都把全部 PDF 用 pdf.js
      // 重新解析一遍（getInvoiceDataFromApp 也只补缺失项，二者叠加会让热缓存再生时
      // 仍全量重解析，是反复「改完重新点生成」等待的主因）。已识别过的跳过即可。
      // 取舍：同名文件被替换内容时不会自动重认（边缘情况；如需可加内容哈希缓存键）。
      async function refreshInvoiceRecognition() {
        if (!window.__fileDebugCache || window.__fileDebugCache.size === 0) return;
        const cache = window.__invoiceDataCache || {};
        const rePending = [];
        for (const [key, file] of window.__fileDebugCache.entries()) {
          const name = file && file.name || '';
          if (name.toLowerCase().endsWith('.pdf') &&
            !name.includes('_副本') && !/^报销单[_-]|^报销单\.pdf$/i.test(name) && !name.startsWith('000_') &&
            !cache[key]) {
            rePending.push(extractInvoiceDataFromPdf(name, file).then(d => { window.__invoiceDataCache[key] = d; }));
          }
        }
        if (rePending.length > 0) await Promise.all(rePending);
      }

      // 报销单 HTML -> A4 PDF。确认弹窗里的紧凑预览样式不影响正式版式。
      //
      // 性能要点：html2canvas 不只看目标元素的样式，它会把「所属 document 的全部
      // 样式表」克隆进自己的渲染文档，再逐元素解析 computed style。主文档里装着
      // Tailwind 全量样式（实测 8 个样式表 / 980 条规则），同一张报销单：
      //   主文档里栅格化 609ms，放进无全局样式的干净 iframe 里只要 122ms（5 倍）。
      // 所以这里先在离屏 iframe 里造一个「只有报销单自身内联样式」的文档再栅格化，
      // 输出像素与主文档渲染完全一致（已逐图比对）。失败则回退主文档渲染。
      /*
       * html2canvas 没有实现 table-cell 的 vertical-align:middle：它按文字节点自身的
       * 行盒 + 字体 baseline 定位，但表格单元格里的文字被画到靠近下边框的位置
       * （实测比浏览器原生渲染低约 8px，14px 字的下留白只剩 2~3px），
       * 所以数字会压在下边框线上——尤其是加粗的合计行最明显。
       * 这里在栅格化前把单元格里的直接文本节点包一层 position:relative 的 span
       * 上移 8px（html2canvas 会按 span 的 bounding rect 定位文字，补偿量经像素
       * 比对与原生渲染一致）。仅用于栅格化；确认弹窗里的预览走浏览器原生渲染，
       * 不需要补偿，因此不在此处处理。
       */
      function compensateReportTextBaseline(root) {
        const doc = root.ownerDocument || document;
        root.querySelectorAll('table td, table th').forEach((cell) => {
          Array.prototype.slice.call(cell.childNodes).forEach((node) => {
            if (node.nodeType === 3 && node.nodeValue && node.nodeValue.trim()) {
              const span = doc.createElement('span');
              span.style.cssText = 'position:relative;top:-8px;';
              span.textContent = node.nodeValue;
              cell.replaceChild(span, node);
            }
          });
        });
      }

      function createReportSandbox(html) {
        const iframe = document.createElement('iframe');
        iframe.setAttribute('aria-hidden', 'true');
        iframe.style.cssText = 'position:fixed;left:-9999px;top:0;width:900px;height:1300px;border:0;z-index:-1;';
        document.body.appendChild(iframe);
        const doc = iframe.contentDocument;
        doc.open();
        doc.write('<!doctype html><html><head><meta charset="utf-8"><title>expense-report</title></head>' +
          '<body style="margin:0;padding:0;background:#fff"></body></html>');
        doc.close();
        const holder = doc.createElement('div');
        holder.innerHTML = html;
        doc.body.appendChild(holder);
        return { iframe, doc, holder };
      }

      async function renderExpenseReportPdf(invoiceData, totalAmountOverride) {
        const t0 = perfNow();
        const reportHTML = generateExpenseReportHTML(invoiceData, totalAmountOverride);

        let sandbox = null;
        let container = null;
        try {
          try {
            sandbox = createReportSandbox(reportHTML);
            // 等 iframe 内的字体与排版就绪，否则会量到 0 高度
            if (sandbox.doc.fonts && sandbox.doc.fonts.ready) await sandbox.doc.fonts.ready;
            await nextPaint();
          } catch (e) {
            console.warn('离屏沙箱创建失败，回退主文档渲染:', e);
            sandbox = null;
          }
          if (!sandbox) {
            container = document.createElement('div');
            container.style.cssText = 'position:fixed;left:-9999px;top:0;z-index:-1;';
            container.innerHTML = reportHTML;
            document.body.appendChild(container);
          }
          const root = sandbox ? sandbox.holder : container;
          // 栅格化前修正 html2canvas 的表格文字基线（原生渲染的弹窗预览不需要）
          compensateReportTextBaseline(root);
          const reportPages = root.querySelectorAll('.expenseReportPage');
          const { jsPDF } = window.jspdf;
          const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
          const pW = pdf.internal.pageSize.getWidth();
          const pH = pdf.internal.pageSize.getHeight();

          for (let pi = 0; pi < reportPages.length; pi++) {
            if (pi > 0) pdf.addPage();
            // 栅格化倍率可调：2 ≈ 192DPI（默认，打印清晰）；嫌慢可在控制台设
            // window.__EXPENSE_REPORT_RASTER_SCALE = 1.5 后重新点生成（144DPI，仍可读）。
            const rasterScale = Number(window.__EXPENSE_REPORT_RASTER_SCALE) || 2;
            setProcessingText(reportPages.length > 1
              ? `正在渲染报销单 ${pi + 1}/${reportPages.length}`
              : '正在渲染报销单');
            await nextPaint();

            const tRaster = perfNow();
            // 不要再传 windowWidth/width/height：沙箱内的元素本身已是 794×1123，
            // 强行指定会多花 ~116ms（实测），而且会改变 html2canvas 的测量方式。
            const canvas = await html2canvas(reportPages[pi], {
              scale: rasterScale, logging: false, backgroundColor: '#ffffff',
            });

            // 原来走 canvas.toDataURL('image/png')：1588x2246 像素先编码成数 MB 的
            // base64 字符串，jsPDF 拿到后还要对原始像素再 deflate 一遍（compress:true）。
            // 这两步是「点确认后卡 4-5 秒」的最大开销。
            // 改成 JPEG 原始字节直传：DCTDecode 不再二次压缩，0.95 画质对表单足够清晰。
            const imgAspect = canvas.width / canvas.height;
            const pdfAspect = pW / pH;
            let drawW, drawH, dx = 0, dy = 0;
            if (imgAspect > pdfAspect) {
              drawW = pW; drawH = pW / imgAspect; dy = (pH - drawH) / 2;
            } else {
              drawH = pH; drawW = pH * imgAspect; dx = (pW - drawW) / 2;
            }

            let placed = false;
            try {
              const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.95));
              if (blob) {
                const imgBytes = new Uint8Array(await blob.arrayBuffer());
                pdf.addImage(imgBytes, 'JPEG', dx, dy, drawW, drawH, undefined, 'FAST');
                placed = true;
                console.log(`⏱️ 第 ${pi + 1} 页：栅格化+编码 ${Math.round(perfNow() - tRaster)}ms，JPEG ${(imgBytes.length / 1024).toFixed(0)}KB`);
              }
            } catch (e) {
              console.warn('JPEG 直传失败，回退 PNG 通道:', e);
            }
            if (!placed) {
              pdf.addImage(canvas.toDataURL('image/png'), 'PNG', dx, dy, drawW, drawH);
              console.log(`⏱️ 第 ${pi + 1} 页：PNG 回退路径 ${Math.round(perfNow() - tRaster)}ms`);
            }
            canvas.width = 0; canvas.height = 0;   // 尽快释放这块大画布
          }
          const reportPdfBytes = pdf.output('arraybuffer');
          console.log('✅ 报销单PDF生成完成，字节数:', reportPdfBytes.byteLength, '页数:', reportPages.length,
            '耗时:', Math.round(perfNow() - t0) + 'ms');
          return reportPdfBytes;
        } finally {
          if (container && container.parentNode) container.parentNode.removeChild(container);
          if (sandbox && sandbox.iframe && sandbox.iframe.parentNode) sandbox.iframe.parentNode.removeChild(sandbox.iframe);
        }
      }

      async function generateExpenseReport() {
        try {
          assertReportLibs();
          await refreshInvoiceRecognition();

          const data = await getInvoiceDataFromApp();
          const invoiceData = Array.isArray(data) ? data : (data.invoices || []);
          if (!invoiceData || invoiceData.length === 0) {
            alert('❌ 请先上传发票文件\n\n提示：上传后稍等片刻，系统会自动识别发票信息。');
            return false;
          }
          const totalAmountFromStats = (data && data.totalAmount != null) ? data.totalAmount : null;
          applyExpenseReportOverrides(invoiceData);
          console.log('📋 发票数量:', invoiceData.length, '总金额(与统计一致):', totalAmountFromStats);

          // 强制人工确认：不确认不生成；超范围票据必须先修正归行日期
          const confirmedData = await showExpenseReportConfirmDialog(invoiceData, totalAmountFromStats);
          if (!confirmedData) return false;

          // 让提示框先真正画到屏幕上，再进入栅格化/合并这些长同步任务。
          // 少了这一帧，「点了确认 → 屏幕僵住」的观感和真卡死没区别。
          const tGen = perfNow();
          setProcessingText('正在渲染报销单');
          await nextPaint();
          const reportPdfBytes = await renderExpenseReportPdf(confirmedData, totalAmountFromStats);
          await mergeReportWithInvoicesForPreview(reportPdfBytes, confirmedData);
          console.log('⏱️ 生成总耗时:', Math.round(perfNow() - tGen) + 'ms');
          showSuccessNotification('✅ 报销单已确认并生成！请在右侧预览窗口查看，可直接下载打印。');
          return true;
        } catch (error) {
          console.error('❌ 生成报销单失败:', error);
          const oldNotif = document.getElementById('processing-notification');
          if (oldNotif) oldNotif.remove();
          alert('❌ 生成报销单失败: ' + error.message);
          return false;
        }
      }

      window.generateExpenseReport = generateExpenseReport;

      // ------------------------------------------------------------------
      // 生成前强制确认窗口：左侧报销单实时预览（含超范围提示行），
      // 右侧票据数据表（项目名 / 金额 / 归行日期可改）。
      // 返回 Promise<draft[] | false>；false = 用户取消，不生成任何 PDF。
      // totalAmountFromStats 仅保留给调用方传参兼容，合计以表格模型为准。
      // ------------------------------------------------------------------
      function showExpenseReportConfirmDialog(invoiceData, totalAmountFromStats) {
        return new Promise((resolve) => {
          const api = window.__expenseReportTable;
          if (!api) { alert('❌ 差旅报销单模块未加载'); resolve(false); return; }

          // 副本操作：取消即丢弃，不污染 React / 识别缓存里的原始数据
          const draft = invoiceData.map(inv => Object.assign({}, inv, {
            trip: inv.trip ? Object.assign({}, inv.trip) : null
          }));
          const cfg = Object.assign({}, readTripConfigFromUI());
          let settled = false;
          let currentIssues = [];

          const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
          })[c]);
          const cnDay = (dt) => dt ? (dt.getFullYear() + '/' + (dt.getMonth() + 1) + '/' + dt.getDate()) : '';
          const first = api.analyzeExpenseReport(draft, cfg);

          function dateForRow(inv, i, analysis) {
            if (inv.isTrip) {
              const p = inv.trip && inv.trip.primaryDate;
              return p ? String(p).slice(0, 10) : formatDateForInput(inv.issueDate || inv.date);
            }
            const d = (analysis.model.stats.details || []).find(x => x.index === i);
            return (d && d.dates && d.dates[0]) || inv.__reportDate ||
              formatDateForInput(inv.issueDate || inv.date);
          }

          function rowHTML(inv, i, analysis) {
            const isTrip = !!inv.isTrip;
            const cell = 'padding:6px 8px;border-bottom:1px solid #eef0f4;';
            // 当前发票归入的费用列：手动选择 > 关键词自动归类
            const curCat = api.utils.categorize(inv, cfg);
            const manualCat = !!inv.__reportCategory;
            const catList = api.SELECTABLE_CATS || ['ticket', 'taxi', 'transportOther', 'lodging', 'refund'];
            const catOptions = catList.map(k =>
              `<option value="${k}" ${curCat === k ? 'selected' : ''}>${esc(api.COL_LABEL[k] || k)}</option>`).join('');
            return `<tr data-idx="${i}" style="background:${isTrip ? '#fffbeb' : '#fff'};">
              <td style="${cell}text-align:center;color:#6b7280;font-size:12px;">${i + 1}</td>
              <td style="${cell}text-align:center;font-size:11px;line-height:1.5;">${isTrip
                ? '🚕 行程单<br><span style="color:#b45309;">仅核对日期/金额</span>' : '发票'}</td>
              <td style="padding:4px 6px;border-bottom:1px solid #eef0f4;">
                <input class="erc-name" data-idx="${i}" type="text" value="${esc(inv.projectName || inv.itemName || '电子发票')}" ${isTrip ? 'disabled' : ''}
                  style="width:100%;box-sizing:border-box;padding:5px 7px;border:1px solid #dfe3ea;border-radius:6px;font-size:12px;"></td>
              <td style="padding:4px 6px;border-bottom:1px solid #eef0f4;">
                <input class="erc-amount" data-idx="${i}" type="number" step="0.01" value="${(parseFloat(inv.amount) || 0).toFixed(2)}" ${isTrip ? 'disabled' : ''}
                  style="width:100%;box-sizing:border-box;padding:5px 7px;border:1px solid #dfe3ea;border-radius:6px;font-size:12px;text-align:right;"></td>
              <td style="padding:4px 6px;border-bottom:1px solid #eef0f4;">
                ${isTrip
                  ? `<div style="text-align:center;color:#9ca3af;font-size:11px;">—</div>`
                  : `<select class="erc-cat" data-idx="${i}" title="选择该发票填入的费用列"
                      style="width:100%;box-sizing:border-box;padding:5px 2px;border:1px solid ${manualCat ? '#7c3aed' : '#dfe3ea'};border-radius:6px;font-size:11px;background:${manualCat ? '#faf5ff' : '#fff'};cursor:pointer;">
                      ${catOptions}
                    </select>`}
              </td>
              <td style="padding:4px 6px;border-bottom:1px solid #eef0f4;">
                <input class="erc-date" data-idx="${i}" type="date" value="${dateForRow(inv, i, analysis)}"
                  style="width:100%;box-sizing:border-box;padding:5px 6px;border:1px solid #d1d5db;border-radius:6px;font-size:12px;"></td>
              <td class="erc-status" style="${cell}text-align:center;font-size:11px;"></td>
            </tr>`;
          }

          const tableHTML = `<table style="width:100%;min-width:720px;border-collapse:collapse;font-size:12px;">
            <thead><tr style="background:#f7f8fc;">
              <th style="padding:8px 6px;border-bottom:1px solid #e5e7eb;width:34px;">序号</th>
              <th style="padding:8px 6px;border-bottom:1px solid #e5e7eb;width:80px;">类型</th>
              <th style="padding:8px 6px;border-bottom:1px solid #e5e7eb;">项目名称</th>
              <th style="padding:8px 6px;border-bottom:1px solid #e5e7eb;width:88px;">金额(元)</th>
              <th style="padding:8px 6px;border-bottom:1px solid #e5e7eb;width:104px;color:#7c3aed;">填入位置</th>
              <th style="padding:8px 6px;border-bottom:1px solid #e5e7eb;width:128px;">归行日期</th>
              <th style="padding:8px 6px;border-bottom:1px solid #e5e7eb;width:116px;">状态 / 快速归位</th>
            </tr></thead>
            <tbody>${draft.map((inv, i) => rowHTML(inv, i, first)).join('')}</tbody>
          </table>`;

          const overlay = document.createElement('div');
          overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.55);z-index:100000;display:flex;align-items:center;justify-content:center;padding:16px;';
          overlay.innerHTML = `
            <div id="erc_dialog" style="background:#fff;border-radius:16px;width:min(1120px,96vw);max-height:92vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 70px rgba(15,23,42,0.35);font-family:-apple-system,'Segoe UI','Microsoft YaHei',sans-serif;color:#111827;">
              <div style="display:flex;align-items:center;gap:10px;padding:15px 20px;border-bottom:1px solid #eef0f4;">
                <span style="font-size:20px;">✏️</span>
                <div style="flex:1;">
                  <div style="font-size:17px;font-weight:700;">确认报销单内容</div>
                  <div style="font-size:12px;color:#6b7280;margin-top:2px;">左侧预览即最终报销单内容；右侧可修改票据的「填入位置（费用列）」与「归行日期」。超范围票据处理完才能生成。</div>
                </div>
                <button id="erc_close_x" title="关闭" style="width:28px;height:28px;border:none;border-radius:50%;background:#f3f4f6;color:#db2777;font-size:14px;cursor:pointer;">●</button>
              </div>
              <div id="erc_banner"></div>
              <div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap;padding:9px 20px;background:#fafbff;border-bottom:1px solid #eef0f4;font-size:12px;">
                <span style="font-weight:600;color:#374151;">🧳 出差范围</span>
                <input id="erc_start" type="date" style="padding:5px 7px;border:1px solid #d1d5db;border-radius:6px;font-size:12px;">
                <span style="color:#9ca3af;">~</span>
                <input id="erc_end" type="date" style="padding:5px 7px;border:1px solid #d1d5db;border-radius:6px;font-size:12px;">
                <span id="erc_meta" style="color:#6b7280;"></span>
                <span style="color:#9ca3af;">日期留空按票据日期推断；改动实时刷新预览</span>
              </div>
              <div style="flex:1;display:flex;gap:14px;padding:12px 16px;min-height:0;">
                <div style="flex:0 0 47%;display:flex;flex-direction:column;min-width:0;">
                  <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;font-size:12px;font-weight:600;color:#374151;">
                    <span>📄 报销单预览（实时）<span style="font-weight:400;color:#9ca3af;">· 可用 + 放大</span></span>
                    <div style="display:flex;align-items:center;gap:4px;">
                      <button id="erc_scale_out" title="缩小" style="width:24px;height:22px;border:1px solid #d1d5db;border-radius:5px;background:#fff;color:#4338ca;font-size:13px;cursor:pointer;">−</button>
                      <span id="erc_scale_val" title="点击恢复适应宽度" style="min-width:34px;text-align:center;font-size:11px;color:#6b7280;cursor:pointer;">适应</span>
                      <button id="erc_scale_in" title="放大" style="width:24px;height:22px;border:1px solid #d1d5db;border-radius:5px;background:#fff;color:#4338ca;font-size:13px;cursor:pointer;">+</button>
                      <button id="erc_zoom" style="margin-left:4px;padding:4px 9px;border:1px solid #d1d5db;border-radius:6px;background:#fff;color:#4338ca;font-size:11px;cursor:pointer;">🔍 原尺寸</button>
                    </div>
                  </div>
                  <div id="erc_viewport" style="flex:1;min-height:200px;overflow:auto;background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;padding:10px;">
                    <div id="erc_preview"></div>
                  </div>
                </div>
                <div style="flex:1;display:flex;flex-direction:column;min-width:0;">
                  <div style="margin-bottom:6px;font-size:12px;font-weight:600;color:#374151;">🧾 票据数据（项目名称 / 金额 / <span style="color:#7c3aed;">填入位置</span> / 归行日期 可修改）</div>
                  <div id="erc_table_wrap" style="flex:1;min-height:200px;overflow:auto;border:1px solid #e5e7eb;border-radius:10px;background:#fff;">${tableHTML}</div>
                </div>
              </div>
              <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:12px 20px;border-top:1px solid #eef0f4;">
                <div style="font-size:12px;color:#4b5563;">
                  <div id="erc_stats" style="font-weight:600;color:#111827;"></div>
                  <label style="display:flex;align-items:center;gap:6px;margin-top:6px;cursor:pointer;">
                    <input id="erc_keep" type="checkbox"> 我已核对，允许保留超范围票据（金额计入合计、不计补贴）
                  </label>
                </div>
                <div style="display:flex;gap:10px;">
                  <button id="erc_cancel" style="padding:9px 20px;border:1px solid #d1d5db;border-radius:8px;background:#fff;color:#374151;cursor:pointer;font-size:13px;">取消</button>
                  <button id="erc_confirm" style="padding:9px 22px;border:none;border-radius:8px;background:#4338ca;color:#fff;cursor:pointer;font-size:13px;font-weight:700;box-shadow:0 4px 14px rgba(67,56,202,0.25);">确认生成</button>
                </div>
              </div>
            </div>`;
          document.body.appendChild(overlay);

          const $ = (id) => overlay.querySelector('#' + id);
          const banner = $('erc_banner'), preview = $('erc_preview'), viewport = $('erc_viewport');
          const tableWrap = $('erc_table_wrap'), tbody = tableWrap.querySelector('tbody');
          const startInput = $('erc_start'), endInput = $('erc_end'), meta = $('erc_meta');
          const stats = $('erc_stats'), keep = $('erc_keep'), confirmBtn = $('erc_confirm');
          const cancelBtn = $('erc_cancel'), closeX = $('erc_close_x'), zoomBtn = $('erc_zoom');
          const scaleIn = $('erc_scale_in'), scaleOut = $('erc_scale_out'), scaleVal = $('erc_scale_val');
          let previewScale = null; // null = 自动适应预览区宽度

          function autoScale() {
            return Math.min(1, Math.max(0.35, (viewport.clientWidth - 24) / 794));
          }

          function fitPreview() {
            const root = preview.querySelector('#expenseReport');
            if (!root) return;
            const scale = previewScale == null ? autoScale() : previewScale;
            root.style.width = '794px';
            root.style.transformOrigin = 'top left';
            root.style.transform = 'scale(' + scale + ')';
            preview.style.height = Math.ceil((root.scrollHeight || 420) * scale) + 'px';
            scaleVal.textContent = Math.round(scale * 100) + '%';
          }

          function stepScale(delta) {
            const cur = previewScale == null ? autoScale() : previewScale;
            previewScale = Math.min(1.5, Math.max(0.4, Math.round((cur + delta) * 10) / 10));
            fitPreview();
          }

          function applyDate(idx, value) {
            const inv = draft[idx];
            if (!inv) return;
            if (inv.isTrip) {
              if (!inv.trip) inv.trip = { isTrip: true, primaryDate: '', dates: [], amount: parseFloat(inv.amount) || 0 };
              inv.trip.primaryDate = value;
            } else if (value) {
              inv.__reportDate = value;
            } else {
              delete inv.__reportDate;
            }
          }

          function syncTripRangeToCard() {
            const s = document.getElementById('__er_trip_start');
            const e = document.getElementById('__er_trip_end');
            if (s) s.value = cfg.startDate || '';
            if (e) e.value = cfg.endDate || '';
            if (typeof setTripExpenseConfig === 'function') {
              setTripExpenseConfig({ startDate: cfg.startDate, endDate: cfg.endDate });
            }
          }

          function refresh() {
            const analysis = api.analyzeExpenseReport(draft, cfg);
            currentIssues = analysis.issues;
            preview.innerHTML = generateExpenseReportHTML(draft, null, cfg, { preview: true });
            fitPreview();

            const badSet = new Set(currentIssues.map(x => x.index));
            draft.forEach((inv, i) => {
              const tr = tbody.querySelector('tr[data-idx="' + i + '"]');
              if (!tr) return;
              const bad = badSet.has(i);
              tr.style.background = bad ? '#fff7ed' : (inv.isTrip ? '#fffbeb' : (i % 2 ? '#fafafa' : '#ffffff'));
              const dateInput = tr.querySelector('.erc-date');
              if (dateInput) {
                dateInput.style.border = bad ? '1px solid #f97316' : '1px solid #d1d5db';
                dateInput.style.boxShadow = bad ? '0 0 0 2px rgba(249,115,22,0.18)' : 'none';
                if (document.activeElement !== dateInput) dateInput.value = dateForRow(inv, i, analysis);
              }
              const st = tr.querySelector('.erc-status');
              if (st) {
                if (bad) {
                  st.innerHTML = `<div style="color:#c2410c;font-weight:700;margin-bottom:3px;">⚠ 超范围</div>
                     <select class="erc-quick" data-idx="${i}" style="width:100%;padding:3px;border:1px solid #fdba74;border-radius:5px;background:#fff;font-size:11px;">
                       <option value="">放入出差日期…</option>
                       ${analysis.dayKeys.map(k => `<option value="${k}">${k}</option>`).join('')}
                     </select>`;
                } else {
                  const cur = api.utils.categorize(inv, cfg);
                  const label = api.COL_LABEL[cur] || cur;
                  const manualMark = inv.__reportCategory ? ' <span style="color:#7c3aed;" title="人工指定费用列">✎</span>' : '';
                  st.innerHTML = `<span style="color:#15803d;">✓ 已入表</span>` +
                    (inv.isTrip
                      ? '<div style="color:#9ca3af;">不重复计金额</div>'
                      : `<div style="color:#6b7280;">计入：${esc(label)}${manualMark}</div>`);
                }
              }
              // 同步「填入位置」下拉：值与手动高亮随模型刷新，但交互中不抢焦点
              const catSel = tr.querySelector('.erc-cat');
              if (catSel && !inv.isTrip) {
                const cur = api.utils.categorize(inv, cfg);
                if (document.activeElement !== catSel) catSel.value = cur;
                const manual = !!inv.__reportCategory;
                catSel.style.border = manual ? '1px solid #7c3aed' : '1px solid #dfe3ea';
                catSel.style.background = manual ? '#faf5ff' : '#fff';
              }
            });

            const rangeTxt = cnDay(analysis.start) + ' ~ ' + cnDay(analysis.end);
            if (currentIssues.length) {
              const dates = Array.from(new Set(currentIssues.map(x => x.dates[0]).filter(Boolean))).join('、');
              banner.style.cssText = 'display:flex;align-items:center;gap:12px;padding:10px 20px;background:#fef2f2;border-bottom:1px solid #fecaca;color:#991b1b;font-size:12px;line-height:1.6;';
              banner.innerHTML = `<div style="flex:1;">⚠ 检测到 <b>${currentIssues.length}</b> 笔票据日期超出出差范围（${esc(rangeTxt)}）：<b>${esc(dates)}</b>。请在右侧「归行日期」选择正确的出差日期，或调整上方出差范围；全部修正后才能生成报销单。</div>
                <button id="erc_locate" style="white-space:nowrap;padding:5px 11px;border:1px solid #fca5a5;border-radius:6px;background:#fff;color:#b91c1c;font-size:11px;cursor:pointer;">定位第 1 笔</button>`;
            } else {
              banner.style.cssText = 'padding:10px 20px;background:#f0fdf4;border-bottom:1px solid #bbf7d0;color:#166534;font-size:12px;line-height:1.6;';
              banner.innerHTML = `✓ 已核对：所有票据日期均落在出差范围（${esc(rangeTxt)}）内，左侧预览无「超范围」行。确认内容无误后点击「确认生成」。`;
            }

            const invoiceCount = draft.filter(x => !x.isTrip).length;
            const tripCount = draft.length - invoiceCount;
            meta.textContent = `出差人：${cfg.traveler || '未填'} · ${cfg.location || '地点未填'} · ${cfg.reason || '原因未填'} · 补贴 ${cfg.dailyAllowance} 元/天`;
            stats.textContent = `共 ${draft.length} 项（${invoiceCount} 张发票 / ${tripCount} 张行程单） · 预览合计 ¥${(analysis.model.grandTotal / 100).toFixed(2)} · 待处理 ${currentIssues.length} 笔超范围`;

            const blocked = currentIssues.length > 0 && !keep.checked;
            confirmBtn.disabled = blocked;
            confirmBtn.style.opacity = blocked ? '0.55' : '1';
            confirmBtn.style.cursor = blocked ? 'not-allowed' : 'pointer';
            confirmBtn.textContent = blocked
              ? `请先修正 ${currentIssues.length} 笔超范围票据`
              : (currentIssues.length ? `仍要生成（含 ${currentIssues.length} 笔超范围）` : '确认生成');
            // 首帧布局稳定后再贴合一次，避免初次缩放比例偏差
            requestAnimationFrame(fitPreview);
          }

          function onFieldChange(e) {
            const t = e.target;
            if (!t || t.dataset.idx === undefined) return;
            const idx = parseInt(t.dataset.idx, 10);
            if (isNaN(idx) || !draft[idx]) return;
            if (t.classList.contains('erc-name')) {
              draft[idx].projectName = t.value; draft[idx].itemName = t.value;
            } else if (t.classList.contains('erc-amount')) {
              const v = parseFloat(t.value); draft[idx].amount = isNaN(v) ? 0 : v;
            } else if (t.classList.contains('erc-cat')) {
              // 手动选择发票填入的费用列（普票费/打的费/其他/住宿/退票费）
              if (t.value) draft[idx].__reportCategory = t.value;
              else delete draft[idx].__reportCategory;
            } else if (t.classList.contains('erc-date')) {
              applyDate(idx, t.value);
            } else if (t.classList.contains('erc-quick') && t.value) {
              applyDate(idx, t.value);
              const di = tbody.querySelector('.erc-date[data-idx="' + idx + '"]');
              if (di) di.value = t.value;
            }
            refresh();
          }

          function finish(ok) {
            if (settled) return;
            settled = true;
            document.removeEventListener('keydown', onKey);
            window.removeEventListener('resize', fitPreview);
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            if (ok) {
              syncTripRangeToCard();
              saveExpenseReportOverrides(draft);
              resolve(draft);
            } else {
              resolve(false);
            }
          }

          function onKey(e) { if (e.key === 'Escape') finish(false); }

          tableWrap.addEventListener('input', onFieldChange);
          tableWrap.addEventListener('change', onFieldChange);
          banner.addEventListener('click', (e) => {
            if (e.target && e.target.id === 'erc_locate' && currentIssues.length) {
              const tr = tbody.querySelector('tr[data-idx="' + currentIssues[0].index + '"]');
              if (tr) {
                tr.scrollIntoView({ block: 'center' });
                const di = tr.querySelector('.erc-date');
                if (di) di.focus();
              }
            }
          });
          startInput.addEventListener('change', () => { cfg.startDate = startInput.value; syncTripRangeToCard(); refresh(); });
          endInput.addEventListener('change', () => { cfg.endDate = endInput.value; syncTripRangeToCard(); refresh(); });
          keep.addEventListener('change', refresh);
          cancelBtn.addEventListener('click', () => finish(false));
          closeX.addEventListener('click', () => finish(false));
          overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(false); });
          document.addEventListener('keydown', onKey);
          window.addEventListener('resize', fitPreview);
          confirmBtn.addEventListener('click', () => { if (!confirmBtn.disabled) finish(true); });
          scaleIn.addEventListener('click', () => stepScale(0.1));
          scaleOut.addEventListener('click', () => stepScale(-0.1));
          scaleVal.addEventListener('click', () => { previewScale = null; fitPreview(); });
          zoomBtn.addEventListener('click', () => {
            const html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>报销单原尺寸预览</title></head>' +
              '<body style="margin:0;background:#eef1f6;padding:16px;">' +
              generateExpenseReportHTML(draft, null, cfg) + '</body></html>';
            const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
            const w = window.open(url, '_blank');
            if (!w) alert('浏览器拦截了新窗口，请允许弹出窗口后重试');
            setTimeout(() => URL.revokeObjectURL(url), 60000);
          });

          startInput.value = cfg.startDate || '';
          endInput.value = cfg.endDate || '';
          refresh();
        });
      }

      function formatDateForInput(d) {
        try {
          const date = d instanceof Date ? d : new Date(d);
          if (isNaN(date.getTime())) return '';
          // 必须用本地年月日：toISOString() 会把东八区的 00:00 换算成前一天
          return date.getFullYear() + '-' +
            String(date.getMonth() + 1).padStart(2, '0') + '-' +
            String(date.getDate()).padStart(2, '0');
        } catch (e) { return ''; }
      }

      // 旧「手动确认生成」按钮保留为别名，行为与自动生成完全一致：都要先确认
      window.generateExpenseReportManual = generateExpenseReport;

      function downloadPdf(pdfData, filename) {
        const blob = pdfData instanceof Blob ? pdfData : new Blob([pdfData], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }

      async function getInvoicePdfFiles() {
        const pdfFiles = [];
        if (!window.__fileDebugCache || window.__fileDebugCache.size === 0) return pdfFiles;
        for (const [, file] of window.__fileDebugCache.entries()) {
          const name = file && file.name || '';
          if (name.toLowerCase().endsWith('.pdf') &&
            !name.includes('_副本') && !/^报销单[_-]|^报销单\.pdf$/i.test(name) && !name.startsWith('000_')) {
            try { pdfFiles.push(await file.arrayBuffer()); } catch (e) { console.error('加载PDF失败:', name, e); }
          }
        }
        return pdfFiles;
      }

      async function _legacyGetInvoiceDataFromApp() {

        await new Promise(resolve => setTimeout(resolve, 500));

        let invoices = [];

        try {
          const rootElement = document.querySelector('#__next') || document.querySelector('[data-reactroot]') || document.body;
          if (rootElement) {
            const fiberKey = Object.keys(rootElement).find(key =>
              key.startsWith('__reactFiber') || key.startsWith('__reactInternalInstance')
            );

            if (fiberKey) {
              let fiber = rootElement[fiberKey];

              const findStats = (node, depth = 0) => {
                if (depth > 20) return null;

                if (node && node.memoizedState) {

                  let current = node.memoizedState;
                  while (current) {
                    if (current.memoizedState && current.memoizedState.stats) {
                      return current.memoizedState.stats;
                    }
                    if (current.memoizedState && current.memoizedState.invoices) {
                      return { invoices: current.memoizedState.invoices };
                    }
                    current = current.next;
                  }
                }

                if (node.child) {
                  const result = findStats(node.child, depth + 1);
                  if (result) return result;
                }
                if (node.sibling) {
                  const result = findStats(node.sibling, depth + 1);
                  if (result) return result;
                }

                return null;
              };

              const stats = findStats(fiber);
              if (stats && stats.invoices && stats.invoices.length > 0) {

                invoices = stats.invoices.map((inv, index) => {
                  const mapped = {

                    number: inv.number || inv.invoiceNumber || '',
                    amount: (inv.total || inv.amount || 0) / 100,
                    issueDate: inv.date || inv.invoiceDate || inv.issueDate || inv.billingDate || new Date(),
                    date: inv.date || inv.invoiceDate || inv.issueDate || inv.billingDate || new Date(),
                    projectName: inv.itemName || inv.goodsName || inv.projectName || inv.item || inv.name || '',
                    itemName: inv.itemName || inv.goodsName || inv.item || inv.name || '',
                    code: inv.code || inv.invoiceCode || '',
                    name: inv.fileName || inv.name || '电子发票'
                  };

                  return mapped;
                });

                let totalAmount = null;
                if (stats.totalAmount !== undefined) totalAmount = stats.totalAmount / 100;
                else if (stats.total !== undefined) totalAmount = stats.total / 100;
                else if (stats.amount !== undefined) totalAmount = stats.amount / 100;

                return {
                  invoices: invoices,
                  totalAmount: totalAmount,
                  totalCount: stats.totalCount || invoices.length
                };
              }
            }
          }
        } catch (error) {
          console.log('⚠️ 从React状态获取失败:', error.message);
        }

        if (invoices.length === 0) {
          const processedFiles = new Set();

          const allElements = document.querySelectorAll('*');
          allElements.forEach(elem => {
            const text = elem.textContent || '';
            if (text.includes('.pdf') && text.length < 300) {
              const pdfMatches = text.match(/([^\s\/\\]+\.pdf)/gi);
              if (pdfMatches) {
                pdfMatches.forEach(fileName => {
                  if (!processedFiles.has(fileName) && !fileName.includes('_副本')) {
                    processedFiles.add(fileName);

                    const amountPatterns = [
                      /_(\d+\.?\d*)_/,
                      /_(\d+\.?\d*)\./,
                      /(\d+\.?\d*)_/,
                      /_(\d+)\.(\d+)_/,
                    ];

                    let amount = 0;
                    for (const pattern of amountPatterns) {
                      const match = fileName.match(pattern);
                      if (match) {
                        amount = parseFloat(match[1]);
                        break;
                      }
                    }

                    if (amount === 0) {
                      const parentText = elem.parentElement?.textContent || '';
                      const amountMatch = parentText.match(/(\d+\.?\d*)\s*元|¥\s*(\d+\.?\d*)/);
                      if (amountMatch) {
                        amount = parseFloat(amountMatch[1] || amountMatch[2]);
                      }
                    }

                    invoices.push({
                      name: fileName.replace('.pdf', ''),
                      amount: amount,
                      date: new Date()
                    });
                  }
                });
              }
            }
          });
        }

        if (invoices.length === 0) {
          console.log('🔍 方法3: 从统计信息提取...');

          const statsElements = document.querySelectorAll('*');
          let invoiceCount = 0;
          let totalAmount = 0;

          statsElements.forEach(elem => {
            const text = elem.textContent || '';

            const countMatch = text.match(/发票数量[：:]\s*(\d+)|(\d+)\s*张/);
            if (countMatch && !invoiceCount) {
              invoiceCount = parseInt(countMatch[1] || countMatch[2]);
            }

            const amountMatch = text.match(/总金额[：:]\s*¥?\s*([\d,]+\.?\d*)|¥\s*([\d,]+\.?\d*)/);
            if (amountMatch && !totalAmount) {
              totalAmount = parseFloat((amountMatch[1] || amountMatch[2]).replace(/,/g, ''));
            }
          });

          if (invoiceCount > 0 && totalAmount > 0) {
            const avgAmount = totalAmount / invoiceCount;
            for (let i = 0; i < invoiceCount; i++) {
              invoices.push({
                name: `电子发票${i + 1}`,
                amount: i === invoiceCount - 1 ?
                  totalAmount - (avgAmount * (invoiceCount - 1)) :
                  avgAmount,
                date: new Date()
              });
            }
          }
        }

        return {
          invoices: invoices,
          totalAmount: null, // 从DOM提取时无法保证总金额精度，设为null让后续逻辑重新计算
          totalCount: invoices.length
        };
      }

      async function mergeReportWithInvoicesForPreview(reportPdfBytes, invoiceData) {
        const tMerge = perfNow();
        setProcessingText('正在合并发票');
        window.__isGeneratingReport = true;
        await nextPaint();

        try {
          const { PDFDocument } = PDFLib;

          let basePdfBytes = null;

          if (window.__invoiceMergedBlob) {
            try {
              basePdfBytes = await window.__invoiceMergedBlob.arrayBuffer();
              console.log('✅ 从__invoiceMergedBlob获取到PDF, size:', basePdfBytes.byteLength);
            } catch (e) {
              console.warn('读取__invoiceMergedBlob失败', e);
            }
          }

          if (!basePdfBytes && window.__lastPdfBlobUrl) {
            try {
              const resp = await fetch(window.__lastPdfBlobUrl);
              basePdfBytes = await resp.arrayBuffer();
              console.log('✅ 从__lastPdfBlobUrl获取到PDF');
            } catch (e) {
              console.warn('fetch __lastPdfBlobUrl failed', e);
            }
          }

          if (!basePdfBytes) {
            console.log('⚠️ 未从React获取到PDF，使用缓存文件');
            const pdfFiles = await getInvoicePdfFiles();
            console.log('📦 缓存中PDF文件数:', pdfFiles.length);
            if (pdfFiles.length > 0) {
              const tmpPdf = await PDFDocument.create();
              for (const f of pdfFiles) {
                const src = await PDFDocument.load(f, { ignoreEncryption: true });
                const pages = await tmpPdf.copyPages(src, src.getPageIndices());
                pages.forEach((p) => tmpPdf.addPage(p));
              }
              basePdfBytes = await tmpPdf.save();
            }
          }

          const mergedPdf = basePdfBytes
            ? await PDFDocument.load(basePdfBytes, { updateMetadata: false })
            : await PDFDocument.create();

          const rptSrc = await PDFDocument.load(reportPdfBytes, { updateMetadata: false });
          const invoicePageCount = mergedPdf.getPageCount();

          const A4W = 595.28, A4H = 841.89;
          const isAlreadyA4 = invoicePageCount > 0 && (function() {
            const pg = mergedPdf.getPage(0);
            const { width, height } = pg.getSize();
            return Math.abs(width - A4W) < 10 && Math.abs(height - A4H) < 10;
          })();

          let finalPdf;
          if (isAlreadyA4) {

            // 报销单按 A4 整页追加，不再占用发票双联的半页槽位
            finalPdf = mergedPdf;
            await nextPaint();
            for (const p of rptSrc.getPages()) {
              const [ep] = await finalPdf.embedPages([p]);
              const pg = finalPdf.addPage([A4W, A4H]);
              pg.drawPage(ep, { x: 0, y: 0, width: A4W, height: A4H });
            }
          } else {

            finalPdf = await PDFDocument.create();
            const halfH = A4H / 2;
            let slotUsed = 0;
            await nextPaint();

            for (let i = 0; i < invoicePageCount; i++) {
              const srcPage = mergedPdf.getPage(i);
              const ew = srcPage.getSize().width, eh = srcPage.getSize().height;
              const rot = srcPage.getRotation().angle || 0;

              const cropBox = srcPage.getCropBox();
              const mediaBox = srcPage.getMediaBox();

              const cbLeft = Math.min(cropBox.x, cropBox.x + cropBox.width);
              const cbRight = Math.max(cropBox.x, cropBox.x + cropBox.width);
              const cbBottom = Math.min(cropBox.y, cropBox.y + cropBox.height);
              const cbTop = Math.max(cropBox.y, cropBox.y + cropBox.height);
              const cbW = cbRight - cbLeft, cbH = cbTop - cbBottom;
              let bbox;
              if (cbW < mediaBox.width * 0.95 || cbH < mediaBox.height * 0.95) {
                bbox = {left: cbLeft, bottom: cbBottom, right: cbRight, top: cbTop};
              }
              const [embedded] = bbox
                ? await finalPdf.embedPages([srcPage], [bbox])
                : await finalPdf.embedPages([srcPage]);

              const vw = embedded.width, vh = embedded.height;
              let page;
              if (slotUsed === 0 || slotUsed === 2) {
                page = finalPdf.addPage([A4W, A4H]);
                slotUsed = 1;
              } else {
                page = finalPdf.getPage(finalPdf.getPageCount() - 1);
                slotUsed = 2;
              }
              const isTop = (slotUsed === 1);
              const scale = Math.min(A4W / vw, halfH / vh);
              const w = vw * scale, h = vh * scale;
              const x = (A4W - w) / 2;
              const y = isTop ? (A4H - h) : (halfH - h) / 2;
              page.drawPage(embedded, { x, y, width: w, height: h });
            }

            const rptPages = rptSrc.getPages();
            for (let ri = 0; ri < rptPages.length; ri++) {
              const [ep] = await finalPdf.embedPages([rptPages[ri]]);
              const page = finalPdf.addPage([A4W, A4H]);
              page.drawPage(ep, { x: 0, y: 0, width: A4W, height: A4H });
            }
          }

          setProcessingText('正在写入 PDF');
          await nextPaint();
          // 实测（真实样例票据 7 页）：useObjectStreams 默认 true 时 save 189ms，
          // 关掉反而 280ms —— 对象流压缩比想象中便宜，别手贱关它。
          const mergedBytes = await finalPdf.save({ addDefaultPage: false, updateFieldAppearances: false });
          const blob = new Blob([mergedBytes], { type: 'application/pdf' });
          window.__currentExpenseReportBlob = blob;
          window.__mergedPdfBlobUrl = URL.createObjectURL(blob);
          showMergedPreview(window.__mergedPdfBlobUrl, finalPdf.getPageCount(), false);

          console.log(
            `✅ 合并完成：${invoicePageCount} 页发票 + 报销单，总 ${finalPdf.getPageCount()} 页`,
            '耗时:', Math.round(perfNow() - tMerge) + 'ms'
          );
        } catch (error) {
          console.error('❌ 合并PDF失败:', error);
          throw error;
        } finally {
          window.__isGeneratingReport = false;
        }
      }

      function showMergedPreview(blobUrl, totalPages) {

        const pdfDoc = document.querySelector('.react-pdf__Document');
        if (!pdfDoc) {
          console.warn('⚠️ 未找到 .react-pdf__Document');
          return;
        }

        const scrollParent = pdfDoc.parentElement;
        if (!scrollParent) return;

        const iframe = document.createElement('iframe');
        iframe.id = '__er_merged_preview';

        iframe.src = blobUrl + '#navpanes=0&toolbar=0&zoom=page-width';
        iframe.style.cssText =
          'display:block;width:calc(100% - 32px);flex:1;min-height:300px;border:none;background:#ffffff;box-sizing:border-box;margin:0 16px;';

        pdfDoc.style.display = 'none';

        const old = document.getElementById('__er_merged_preview');
        if (old) old.remove();

        scrollParent.style.overflow = 'hidden';
        scrollParent.style.position = 'relative';
        scrollParent.style.display = 'flex';
        scrollParent.style.flexDirection = 'column';
        scrollParent.style.flex = '1';
        scrollParent.style.background = '#ffffff';
        scrollParent.appendChild(iframe);

        const sec = document.querySelector('section[aria-label="发票处理工作区"]');
        if (sec) sec.classList.add('merged-preview');

        if (totalPages) {
          const container =
            scrollParent.closest('[data-slot="card"]') || scrollParent.parentElement?.parentElement;
          if (container) {
            const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
            while (walker.nextNode()) {
              const node = walker.currentNode;
              const text = node.textContent.trim();
              if (
                /^\d+$/.test(text) &&
                node.parentElement &&
                node.parentElement.closest &&
                !node.parentElement.closest('.react-pdf__Document')
              ) {
                const num = parseInt(text);
                if (num >= 1 && num <= 20) {
                  node.textContent = String(totalPages);
                  break;
                }
              }
            }
          }
        }

        console.log('✅ 合并PDF已显示在预览区');
      }

      async function showPdfInPreviewOnly(pdfBlob) {
        const blobUrl = URL.createObjectURL(pdfBlob);
        window.__mergedPdfBlobUrl = blobUrl;

        showMergedPreview(blobUrl, null, false);
        const oldFloat = document.getElementById('__er_float_panel');
        if (oldFloat) oldFloat.remove();
      }

      function addDownloadButton(pdfBlob, ds) {
        let dlBar = document.getElementById('__er_dl_bar');
        if (dlBar) dlBar.remove();
        dlBar = document.createElement('div');
        dlBar.id = '__er_dl_bar';
        dlBar.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:99999;';
        dlBar.innerHTML = `<button id="__er_dl_btn" style="padding:10px 24px;background:#4338ca;color:white;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;box-shadow:0 6px 16px rgba(67,56,202,0.22);">⬇️ 下载合并PDF</button>`;
        document.body.appendChild(dlBar);
        document.getElementById('__er_dl_btn').addEventListener('click', () => downloadPdf(pdfBlob, `报销单_${ds}.pdf`));
      }

      function addDownloadButtonToPreview(pdfBlob) {

        window.__currentExpenseReportBlob = pdfBlob || window.__currentExpenseReportBlob;
      }

      async function deleteExpenseReport() {
        window.__currentExpenseReportBlob = null;
        const dlBar = document.getElementById('__er_dl_bar');
        if (dlBar) dlBar.remove();

        const iframe = document.getElementById('__er_merged_preview');
        if (iframe) iframe.remove();

        const sec = document.querySelector('section[aria-label="发票处理工作区"]');
        if (sec) sec.classList.remove('merged-preview');

        const pdfDoc = document.querySelector('.react-pdf__Document');
        if (pdfDoc) pdfDoc.style.display = '';

        if (window.__mergedPdfBlobUrl) {
          URL.revokeObjectURL(window.__mergedPdfBlobUrl);
          window.__mergedPdfBlobUrl = null;
        }

        showSuccessNotification('✅ 报销单已删除');
      }
      window.deleteExpenseReport = deleteExpenseReport;

      function addExpenseReportCard() {
        if (document.querySelector('.expense-report-operations-card')) return;

        let statsCard = null;
        for (const el of document.querySelectorAll('[data-slot="card"]')) {
          const t = el.textContent || '';
          if (t.includes('发票数量') || t.includes('总金额') || t.includes('发票统计')) { statsCard = el; break; }
        }
        if (!statsCard) {
          for (const el of document.querySelectorAll('*')) {
            const t = el.textContent || '';
            if (t.length < 400 && (t.includes('发票数量') || t.includes('总金额'))) {
              statsCard = el.closest('[data-slot="card"]') || el.parentElement; break;
            }
          }
        }
        if (!statsCard) return;

        console.log('✅ 找到容器，插入报销单卡片');

        const card = document.createElement('div');
        card.className = 'expense-report-operations-card';
        card.setAttribute('data-slot', 'card');
        card.style.cssText = `
          background:white; border-radius:12px; border:1px solid #e5e7eb;
          box-shadow:0 1px 4px rgba(0,0,0,0.1); padding:20px 24px; margin-top:16px;
          flex:none !important;
        `;
        card.innerHTML = `
          <div data-slot="card-header" style="padding:0;margin-bottom:12px;">
            <div data-slot="card-title" style="font-weight:700;font-size:1rem;">📋 生成报销单</div>
            <p style="font-size:12px;color:#6b7280;margin-top:5px;line-height:1.5;">
              点一次「生成报销单」即可：先弹出确认窗口，左侧实时预览、右侧核对票据，超范围票据须重选归行日期。生成完成后「下载」按钮变为可用。
            </p>
          </div>
          <div class="er-trip-config" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin-bottom:12px;padding:10px 12px;background:#fafbff;border:1px solid #e8ecf7;border-radius:8px;">
            <div style="grid-column:1/-1;font-size:12px;font-weight:600;color:#374151;">🧳 出差信息</div>
            <label style="font-size:11px;color:#4b5563;display:flex;flex-direction:column;gap:3px;">出差开始
              <input id="__er_trip_start" type="date" style="padding:5px 6px;border:1px solid #d1d5db;border-radius:5px;font-size:12px;">
            </label>
            <label style="font-size:11px;color:#4b5563;display:flex;flex-direction:column;gap:3px;">出差结束
              <input id="__er_trip_end" type="date" style="padding:5px 6px;border:1px solid #d1d5db;border-radius:5px;font-size:12px;">
            </label>
            <label style="font-size:11px;color:#4b5563;display:flex;flex-direction:column;gap:3px;">出差地点
              <input id="__er_trip_location" type="text" placeholder="如：上海" style="padding:5px 6px;border:1px solid #d1d5db;border-radius:5px;font-size:12px;">
            </label>
            <label style="font-size:11px;color:#4b5563;display:flex;flex-direction:column;gap:3px;">出差原因
              <input id="__er_trip_reason" type="text" placeholder="如：客户拜访" style="padding:5px 6px;border:1px solid #d1d5db;border-radius:5px;font-size:12px;">
            </label>
            <label style="font-size:11px;color:#4b5563;display:flex;flex-direction:column;gap:3px;">出差人
              <input id="__er_trip_traveler" type="text" placeholder="请输入出差人" style="padding:5px 6px;border:1px solid #d1d5db;border-radius:5px;font-size:12px;">
            </label>
            <label style="font-size:11px;color:#4b5563;display:flex;flex-direction:column;gap:3px;">表单编号
              <input id="__er_trip_formno" type="text" placeholder="YF-FBCW10-2022" style="padding:5px 6px;border:1px solid #d1d5db;border-radius:5px;font-size:12px;">
            </label>
            <label style="font-size:11px;color:#4b5563;display:flex;flex-direction:column;gap:3px;">每日补贴（元）
              <input id="__er_trip_allowance" type="number" min="0" step="1" value="50" style="padding:5px 6px;border:1px solid #d1d5db;border-radius:5px;font-size:12px;">
            </label>
            <div style="grid-column:1/-1;font-size:11px;color:#6b7280;line-height:1.5;">
              日期留空时按票据日期自动推断；行程单只用于核对日期与金额，不重复计入报销金额。
            </div>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:stretch;">
            <button class="er-btn-gen" title="生成前会先弹出确认窗口，确认后才产出 PDF" style="
              flex:1;min-width:150px;padding:11px 16px;
              background:#4338ca;color:#fff;border:none;border-radius:8px;
              font-size:14px;font-weight:600;cursor:pointer;
              box-shadow:0 6px 16px rgba(67,56,202,0.22);
              transition:background 0.2s,box-shadow 0.2s,transform 0.2s;">
              📋 生成报销单
            </button>
            <button class="er-btn-dl" disabled title="生成报销单后可下载" style="
              padding:11px 16px;background:white;color:#4338ca;
              border:1px solid #c7cbe8;border-radius:8px;font-size:14px;font-weight:600;
              cursor:not-allowed;opacity:0.5;
              transition:background 0.2s,border-color 0.2s,opacity 0.2s;">
              ⬇️ 下载
            </button>
            <button class="er-btn-del" title="删除已生成的报销单" style="
              padding:11px 14px;background:white;color:#ef4444;
              border:1px solid #fca5a5;border-radius:8px;font-size:14px;
              cursor:pointer;transition:background 0.2s;">
              🗑️
            </button>
          </div>
        `;

        const _tc = window.__tripExpenseConfig || {};
        const _setTripVal = (id, v) => {
          const el = card.querySelector('#' + id);
          if (el && v !== undefined && v !== null && v !== '') el.value = v;
        };
        _setTripVal('__er_trip_start', _tc.startDate);
        _setTripVal('__er_trip_end', _tc.endDate);
        _setTripVal('__er_trip_location', _tc.location);
        _setTripVal('__er_trip_reason', _tc.reason);
        _setTripVal('__er_trip_allowance', _tc.dailyAllowance);
        _setTripVal('__er_trip_traveler', _tc.traveler);
        _setTripVal('__er_trip_formno', _tc.formNo);
        card.querySelectorAll('.er-trip-config input').forEach(el => {
          el.addEventListener('change', () => readTripConfigFromUI());
        });

        const genBtn = card.querySelector('.er-btn-gen');
        const dlBtn  = card.querySelector('.er-btn-dl');
        const delBtn = card.querySelector('.er-btn-del');

        // 下载按钮只下载「已生成」的那份 PDF，不再重新生成一遍
        const syncDownloadBtn = () => {
          const has = !!window.__currentExpenseReportBlob;
          dlBtn.disabled = !has;
          dlBtn.style.opacity = has ? '1' : '0.5';
          dlBtn.style.cursor = has ? 'pointer' : 'not-allowed';
          dlBtn.title = has ? '下载已生成的报销单 PDF' : '生成报销单后可下载';
        };

        genBtn.addEventListener('click', async () => {
          if (genBtn.disabled) return;
          const label = genBtn.textContent.trim();
          genBtn.disabled = true;
          genBtn.textContent = '⏳ 正在生成…';
          genBtn.style.opacity = '0.8';
          genBtn.style.cursor = 'progress';
          try {
            const ok = window.generateExpenseReport ? await window.generateExpenseReport() : false;
            if (ok) syncDownloadBtn();
          } finally {
            genBtn.disabled = false;
            genBtn.textContent = label;
            genBtn.style.opacity = '1';
            genBtn.style.cursor = 'pointer';
            syncDownloadBtn();
          }
        });

        dlBtn.addEventListener('click', () => {
          const blob = window.__currentExpenseReportBlob;
          if (!blob) { syncDownloadBtn(); return; }
          const d = new Date();
          const ds = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
          downloadPdf(blob, `报销单_${ds}.pdf`);
        });

        delBtn.addEventListener('click', async () => {
          if (window.deleteExpenseReport) await window.deleteExpenseReport();
          syncDownloadBtn();
        });

        genBtn.onmouseenter = () => {
          if (genBtn.disabled) return;
          genBtn.style.background = '#3730a3';
          genBtn.style.boxShadow = '0 8px 22px rgba(67,56,202,0.30)';
          genBtn.style.transform = 'translateY(-1px)';
        };
        genBtn.onmouseleave = () => {
          genBtn.style.background = '#4338ca';
          genBtn.style.boxShadow = '0 6px 16px rgba(67,56,202,0.22)';
          genBtn.style.transform = 'translateY(0)';
        };
        dlBtn.onmouseenter = () => { if (!dlBtn.disabled) dlBtn.style.background = '#f5f6fb'; };
        dlBtn.onmouseleave = () => { dlBtn.style.background = 'white'; };
        delBtn.onmouseenter = () => delBtn.style.background = '#fef2f2';
        delBtn.onmouseleave = () => delBtn.style.background = 'white';

        syncDownloadBtn();

        statsCard.parentElement.insertBefore(card, statsCard.nextSibling);
        console.log('✅ 报销单卡片已插入');
      }

      let _cardAttempts = 0;
      function tryAddExpenseCard() {
        if (document.querySelector('.expense-report-operations-card')) return;
        if (++_cardAttempts > 10) return;
        addExpenseReportCard();
      }

      function startCardWatcher() {

        const style = document.createElement('style');
        style.id = 'expense-layout-style';
        style.textContent = `
          section[aria-label="发票处理工作区"] {
            align-items: start !important;
          }
          section[aria-label="发票处理工作区"] > div:first-child {
            align-self: start !important;
            height: auto !important;
          }
          section[aria-label="发票处理工作区"].merged-preview {
            align-items: stretch !important;
          }
          section[aria-label="发票处理工作区"].merged-preview > div:first-child {
            align-self: stretch !important;
            height: auto !important;
          }
          section[aria-label="发票处理工作区"].merged-preview > div:first-child {
            display: flex;
            flex-direction: column;
          }
          section[aria-label="发票处理工作区"].merged-preview > div:first-child > [data-slot="card"] {
            flex: 1;
            display: flex;
            flex-direction: column;
          }
          section[aria-label="发票处理工作区"].merged-preview > div:first-child > [data-slot="card"] > [data-slot="card-content"] {
            flex: 1;
            display: flex;
            flex-direction: column;
            min-height: 0;
          }
          section[aria-label="发票处理工作区"].merged-preview > div:first-child > [data-slot="card"] > [data-slot="card-content"] > div {
            flex: 1;
            min-height: 0;
          }
          section[aria-label="发票处理工作区"].merged-preview > div:first-child .react-pdf__Document {
            flex: 1;
            min-height: 0;
            overflow: auto;
          }
          .react-pdf__Page canvas {
            transform: scale(0.95);
            transform-origin: top center;
            margin-top: 24px !important;
          }
          .react-pdf__Document {
            padding-top: 20px;
          }
          @media print {
            .react-pdf__Page canvas {
              transform: scale(0.85);
              transform-origin: top center;
              margin-top: 24px !important;
            }
          }
        `;
        document.head.appendChild(style);

        setTimeout(tryAddExpenseCard, 2000);
        setTimeout(tryAddExpenseCard, 4000);
        setTimeout(tryAddExpenseCard, 8000);

        if (document.body) {
          const _cardObserver = new MutationObserver(() => {
            let hasStats = false;
            for (const el of document.querySelectorAll('[data-slot="card"]')) {
              const t = el.textContent || '';
              // 与 addExpenseReportCard / head 的 findStatsCard 保持一致的判定：
              // 统计卡片标题恒为「发票统计」（ece2d7f 重写内容后不再含「发票数量/总金额」，
              // 若只认这两个词会误判卡片消失并把报销单卡片删掉）。
              if (t.includes('发票统计') || t.includes('发票数量') || t.includes('总金额')) { hasStats = true; break; }
            }
            const card = document.querySelector('.expense-report-operations-card');
            if (hasStats && !card) {
              addExpenseReportCard();
            } else if (!hasStats && card) {
              card.remove();
            }
          });
          _cardObserver.observe(document.body, { childList: true, subtree: true });

          setTimeout(() => _cardObserver.disconnect(), 90000);
        }
      }

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startCardWatcher);
      } else {
        startCardWatcher();
      }

      async function _legacyMergeWithInvoices(reportPdfBytes, invoiceData) {
        try {
          showProcessingNotification('正在合并PDF文件...');

          const { PDFDocument } = PDFLib;

          const mergedPdf = await PDFDocument.load(reportPdfBytes);

          const invoicePdfs = await getInvoicePdfFiles(invoiceData);

          if (invoicePdfs.length === 0) {

            const pdfBytes = await mergedPdf.save();
            downloadPdf(pdfBytes, `报销单_${new Date().getTime()}.pdf`);
            return;
          }

          for (let i = 0; i < invoicePdfs.length; i++) {
            try {
              const invoicePdfBytes = invoicePdfs[i];
              const invoicePdf = await PDFDocument.load(invoicePdfBytes);
              const pages = await mergedPdf.copyPages(invoicePdf, invoicePdf.getPageIndices());

              pages.forEach(page => {
                mergedPdf.addPage(page);
              });
            } catch (error) {
              console.error(`❌ 添加发票 ${i + 1} 失败:`, error);
            }
          }

          const mergedPdfBytes = await mergedPdf.save();

          showPdfInPreview(mergedPdfBytes);

        } catch (error) {
          console.error('❌ PDF合并失败:', error);
          throw error;
        }
      }

      async function _legacyMergeReportWithInvoices(reportPdfBytes, invoiceData) {
        try {
          showProcessingNotification('正在合并PDF文件...');

          const { PDFDocument } = PDFLib;

          const mergedPdf = await PDFDocument.load(reportPdfBytes);

          let existingMergedPdf = null;
          try {
            const previewPanel = document.querySelector('.fixed.top-0.right-0.h-full.z-50');
            if (previewPanel) {
              const iframe = previewPanel.querySelector('iframe');
              if (iframe && iframe.src && iframe.src.startsWith('blob:')) {
                console.log('🔍 发现预览窗口中的PDF:', iframe.src);

                const response = await fetch(iframe.src);
                const existingPdfBytes = await response.arrayBuffer();
                existingMergedPdf = await PDFDocument.load(existingPdfBytes);
                console.log('✅ 成功加载预览窗口中的PDF,页数:', existingMergedPdf.getPageCount());
              }
            }
          } catch (error) {
            console.log('⚠️ 无法从预览窗口获取PDF:', error.message);
          }

          if (existingMergedPdf) {
            console.log('📄 将预览PDF的页面添加到报销单后面');
            const pages = await mergedPdf.copyPages(existingMergedPdf, existingMergedPdf.getPageIndices());
            pages.forEach(page => {
              mergedPdf.addPage(page);
            });
          } else {

            console.log('📦 从缓存获取发票文件');
            const invoicePdfs = await getInvoicePdfFiles(invoiceData);

            if (invoicePdfs.length === 0) {
              console.warn('⚠️ 没有找到发票文件');

              const pdfBytes = await mergedPdf.save();
              const blob = new Blob([pdfBytes], { type: 'application/pdf' });
              showPdfInPreviewOnly(blob);
              return;
            }

            for (let i = 0; i < invoicePdfs.length; i++) {
              try {
                const invoicePdfBytes = invoicePdfs[i];
                const invoicePdf = await PDFDocument.load(invoicePdfBytes);
                const pages = await mergedPdf.copyPages(invoicePdf, invoicePdf.getPageIndices());

                pages.forEach(page => {
                  mergedPdf.addPage(page);
                });
                console.log(`✅ 添加发票 ${i + 1}/${invoicePdfs.length}`);
              } catch (error) {
                console.error(`❌ 添加发票 ${i + 1} 失败:`, error);
              }
            }
          }

          const mergedPdfBytes = await mergedPdf.save();
          const blob = new Blob([mergedPdfBytes], { type: 'application/pdf' });

          console.log('✅ PDF合并完成,总页数:', mergedPdf.getPageCount());

          showPdfInPreviewOnly(blob);

        } catch (error) {
          console.error('❌ PDF合并失败:', error);
          throw error;
        }
      }

      async function _legacyMergeReportWithInvoicesForPreview(reportPdfBytes, invoiceData) {
        try {
          showProcessingNotification('正在合并PDF文件...');

          const { PDFDocument } = PDFLib;

          const mergedPdf = await PDFDocument.load(reportPdfBytes);
          console.log('📋 报销单PDF已加载,页数:', mergedPdf.getPageCount());

          let existingMergedPdf = null;
          let foundPreviewPdf = false;

          try {

            let iframe = null;

            const previewPanel = document.querySelector('.fixed.top-0.right-0.h-full.z-50');
            if (previewPanel) {
              iframe = previewPanel.querySelector('iframe');
              console.log('🔍 方法1: 在预览面板中查找iframe');
            }

            if (!iframe) {
              const iframes = document.querySelectorAll('iframe');
              for (const frame of iframes) {
                if (frame.src && frame.src.startsWith('blob:')) {
                  iframe = frame;
                  console.log('🔍 方法2: 找到blob URL的iframe');
                  break;
                }
              }
            }

            if (iframe && iframe.src && iframe.src.startsWith('blob:')) {
              console.log('🔍 发现预览窗口中的PDF:', iframe.src);

              const response = await fetch(iframe.src);
              const existingPdfBytes = await response.arrayBuffer();
              existingMergedPdf = await PDFDocument.load(existingPdfBytes);
              foundPreviewPdf = true;
              console.log('✅ 成功加载预览窗口中的PDF,页数:', existingMergedPdf.getPageCount());
            } else {
              console.log('⚠️ 未找到预览窗口中的PDF iframe');
            }
          } catch (error) {
            console.log('⚠️ 无法从预览窗口获取PDF:', error.message);
          }

          if (existingMergedPdf && foundPreviewPdf) {
            console.log('📄 将预览PDF的 ' + existingMergedPdf.getPageCount() + ' 页添加到报销单后面');
            const pages = await mergedPdf.copyPages(existingMergedPdf, existingMergedPdf.getPageIndices());
            pages.forEach(page => {
              mergedPdf.addPage(page);
            });
            console.log('✅ 合并完成,总页数:', mergedPdf.getPageCount());
          } else {

            console.log('📦 从缓存获取发票文件');
            const invoicePdfs = await getInvoicePdfFiles(invoiceData);

            if (invoicePdfs.length === 0) {
              console.warn('⚠️ 没有找到发票文件');

              const pdfBytes = await mergedPdf.save();
              const blob = new Blob([pdfBytes], { type: 'application/pdf' });

              window.__currentExpenseReportBlob = blob;

              showPdfInPreviewOnly(blob);
              return;
            }

            for (let i = 0; i < invoicePdfs.length; i++) {
              try {
                const invoicePdfBytes = invoicePdfs[i];
                const invoicePdf = await PDFDocument.load(invoicePdfBytes);
                const pages = await mergedPdf.copyPages(invoicePdf, invoicePdf.getPageIndices());

                pages.forEach(page => {
                  mergedPdf.addPage(page);
                });
                console.log(`✅ 添加发票 ${i + 1}/${invoicePdfs.length},页数: ${invoicePdf.getPageCount()}`);
              } catch (error) {
                console.error(`❌ 添加发票 ${i + 1} 失败:`, error);
              }
            }
            console.log('✅ 从缓存合并完成,总页数:', mergedPdf.getPageCount());
          }

          const mergedPdfBytes = await mergedPdf.save();
          const blob = new Blob([mergedPdfBytes], { type: 'application/pdf' });

          console.log('✅ PDF合并完成,总页数:', mergedPdf.getPageCount());

          window.__currentExpenseReportBlob = blob;

          showPdfInPreviewOnly(blob);

        } catch (error) {
          console.error('❌ PDF合并失败:', error);
          throw error;
        }
      }

      async function _legacyDeleteExpenseReport() {
        try {
          console.log('🗑️ [legacy] 删除报销单,恢复原始发票预览...');

          if (window.__currentExpenseReportBlob) {
            URL.revokeObjectURL(window.__currentExpenseReportBlob);
            window.__currentExpenseReportBlob = null;
          }

          const data = await getInvoiceDataFromApp();
          const invoiceData = Array.isArray(data) ? data : (data.invoices || []);

          if (!invoiceData || invoiceData.length === 0) {
            console.log('⚠️ 没有发票数据,关闭预览窗口');

            const previewPanel = document.querySelector('.fixed.top-0.right-0.h-full.z-50');
            if (previewPanel) {
              previewPanel.classList.add('translate-x-full', 'opacity-0');
              previewPanel.classList.remove('translate-x-0', 'opacity-100');
            }
            showSuccessNotification('✅ 报销单已删除');
            return;
          }

          console.log('📦 重新合并原始发票...');
          const invoicePdfs = await getInvoicePdfFiles(invoiceData);

          if (invoicePdfs.length === 0) {
            console.warn('⚠️ 没有找到发票文件');
            showSuccessNotification('✅ 报销单已删除');
            return;
          }

          const { PDFDocument } = PDFLib;
          const mergedPdf = await PDFDocument.create();

          for (let i = 0; i < invoicePdfs.length; i++) {
            try {
              const invoicePdfBytes = invoicePdfs[i];
              const invoicePdf = await PDFDocument.load(invoicePdfBytes);
              const pages = await mergedPdf.copyPages(invoicePdf, invoicePdf.getPageIndices());
              pages.forEach(page => {
                mergedPdf.addPage(page);
              });
              console.log(`✅ 恢复发票 ${i + 1}/${invoicePdfs.length}`);
            } catch (error) {
              console.error(`❌ 恢复发票 ${i + 1} 失败:`, error);
            }
          }

          const mergedPdfBytes = await mergedPdf.save();
          const blob = new Blob([mergedPdfBytes], { type: 'application/pdf' });

          console.log('✅ 原始发票已恢复,总页数:', mergedPdf.getPageCount());

          showPdfInPreviewOnly(blob);

          showSuccessNotification('✅ 报销单已删除,已恢复原始发票预览');
        } catch (error) {
          console.error('❌ 删除报销单失败:', error);
          alert('❌ 删除报销单失败: ' + error.message);
        }
      }

      window.deleteExpenseReport = deleteExpenseReport;

      function _legacyShowPdfInPreviewOnly(pdfBlob) {
        try {
          console.log('📺 [legacy] 更新预览窗口显示合并后的PDF');

          const blobUrl = URL.createObjectURL(pdfBlob);

          const previewPanel = document.querySelector('.fixed.top-0.right-0.h-full.z-50');
          if (!previewPanel) {

            console.warn('未找到预览面板,回退到下载');
            downloadPdf(pdfBlob, `报销单_${new Date().getTime()}.pdf`);
            return;
          }

          previewPanel.classList.remove('translate-x-full', 'opacity-0');
          previewPanel.classList.add('translate-x-0', 'opacity-100');

          window.__mergedPdfBlobUrl = blobUrl;

          const updateIframe = () => {
            const iframe = previewPanel.querySelector('iframe');
            if (iframe && iframe.src !== blobUrl) {
              console.log('✅ 更新iframe src:', blobUrl);
              iframe.src = blobUrl;
              return true;
            }
            return false;
          };

          setTimeout(() => updateIframe(), 100);

          let updateCount = 0;
          const intervalId = setInterval(() => {
            updateCount++;
            if (updateCount > 10) {
              clearInterval(intervalId);
              console.log('⏹️ 停止监听iframe更新(已尝试10次)');
              return;
            }

            if (updateIframe()) {
              console.log(`✅ 第${updateCount}次更新成功`);
            }
          }, 500);

          setTimeout(() => {
            clearInterval(intervalId);
          }, 5000);

        } catch (error) {
          console.error('❌ 在预览窗口显示报销单失败:', error);

          downloadPdf(pdfBlob, `报销单_${new Date().getTime()}.pdf`);
        }
      }

      function showPdfInPreview(pdfBytes) {
        try {

          const blob = new Blob([pdfBytes], { type: 'application/pdf' });
          const fileName = `报销单_${new Date().getTime()}.pdf`;
          const file = new File([blob], fileName, { type: 'application/pdf' });

          if (window.__fileDebugCache) {
            // 直接写入原 Map：替换整个 Map 会丢掉 initFileProxy 挂上的 set 钩子。
            window.__fileDebugCache.set(fileKeyOf(file), file);
          }

          const fileInput = document.querySelector('input[type="file"]');
          if (fileInput) {

            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(file);

            const changeEvent = new Event('change', { bubbles: true });
            Object.defineProperty(changeEvent, 'target', {
              writable: false,
              value: { files: dataTransfer.files }
            });

            fileInput.dispatchEvent(changeEvent);

          }

          const addFileEvent = new CustomEvent('addExpenseReport', {
            detail: { file, fileName, blob }
          });
          document.dispatchEvent(addFileEvent);

        } catch (error) {
          console.error('❌ 添加报销单到预览失败:', error);

          downloadPdf(pdfBytes, `报销单_${new Date().getTime()}.pdf`);
        }
      }

      async function _legacyGetInvoicePdfFiles(invoiceData) {
        const pdfFiles = [];

        if (window.__fileDebugCache && window.__fileDebugCache.size > 0) {
          console.log('📦 [legacy] 从缓存中获取PDF文件,缓存大小:', window.__fileDebugCache.size);

          for (const [, file] of window.__fileDebugCache.entries()) {
            const fileName = file && file.name || '';
            console.log('检查文件:', fileName);

            if (fileName.toLowerCase().endsWith('.pdf') &&
              !fileName.includes('_副本') &&
              !/^报销单[_-]|^报销单\.pdf$/i.test(fileName) &&
              !fileName.startsWith('000_')) {
              try {
                const arrayBuffer = await file.arrayBuffer();
                pdfFiles.push(arrayBuffer);
                console.log('✅ 成功加载:', fileName);
              } catch (error) {
                console.error(`❌ 加载失败: ${fileName}`, error);
              }
            } else {
              console.log('⏭️ 跳过文件:', fileName);
            }
          }
        } else {
          console.warn('⚠️ 文件缓存为空或不存在');
        }
        console.log(`📊 共获取 ${pdfFiles.length} 个发票PDF文件`);
        return pdfFiles;
      }

      function _legacyAddExpenseReportCard() {
        const existingCards = document.querySelectorAll('.expense-report-operations-card');
        existingCards.forEach(card => {
          console.log('🗑️ 移除已存在的报销单卡片');
          card.remove();
        });

        const statsCards = document.querySelectorAll('[data-slot="card"]');
        let statsCard = null;

        for (const card of statsCards) {
          const cardText = card.textContent || '';
          if (cardText.includes('发票数量') || cardText.includes('总金额')) {
            statsCard = card;
            break;
          }
        }

        if (!statsCard) {
          console.log('⚠️ 未找到发票统计卡片');
          return;
        }

        const reportCard = document.createElement('div');
        reportCard.className = 'expense-report-operations-card';
        reportCard.setAttribute('data-slot', 'card');
        reportCard.style.cssText = `
          background: white;
          border-radius: 12px;
          border: 1px solid #e5e7eb;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
          padding: 24px;
          margin-top: 24px;
          display: flex;
          flex-direction: column;
          gap: 24px;
        `;

        const header = document.createElement('div');
        header.setAttribute('data-slot', 'card-header');
        header.style.cssText = 'padding: 0;';

        const title = document.createElement('div');
        title.setAttribute('data-slot', 'card-title');
        title.style.cssText = 'font-weight: 600; font-size: 1rem; line-height: 1;';
        title.textContent = '📋 报销单操作';

        header.appendChild(title);

        const content = document.createElement('div');
        content.setAttribute('data-slot', 'card-content');
        content.style.cssText = 'padding: 0;';

        const buttonContainer = document.createElement('div');
        buttonContainer.style.cssText = 'display: flex; gap: 12px;';

        const generateBtn = document.createElement('button');
        generateBtn.textContent = '📋 生成报销单（需确认）';
        generateBtn.style.cssText = `
          flex: 1;
          padding: 11px 16px;
          background: #4338ca;
          color: white;
          border: none;
          border-radius: 10px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          box-shadow: 0 6px 16px rgba(67, 56, 202, 0.22);
          transition: all 0.25s cubic-bezier(0.32, 0.72, 0, 1);
        `;

        generateBtn.addEventListener('mouseenter', () => {
          generateBtn.style.background = '#3730a3';
          generateBtn.style.boxShadow = '0 8px 22px rgba(67, 56, 202, 0.30)';
          generateBtn.style.transform = 'translateY(-1px)';
        });

        generateBtn.addEventListener('mouseleave', () => {
          generateBtn.style.background = '#4338ca';
          generateBtn.style.boxShadow = '0 6px 16px rgba(67, 56, 202, 0.22)';
          generateBtn.style.transform = 'translateY(0)';
        });

        generateBtn.addEventListener('click', () => {
          if (window.generateExpenseReport) {
            window.generateExpenseReport();
          }
        });

        const deleteBtn = document.createElement('button');
        deleteBtn.textContent = '🗑️ 删除报销单';
        deleteBtn.style.cssText = `
          flex: 1;
          padding: 10px 16px;
          background: white;
          color: rgb(220, 38, 38);
          border: 1px solid rgb(252, 165, 165);
          border-radius: 6px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        `;

        deleteBtn.addEventListener('mouseenter', () => {
          deleteBtn.style.background = 'rgb(254, 242, 242)';
        });

        deleteBtn.addEventListener('mouseleave', () => {
          deleteBtn.style.background = 'white';
        });

        deleteBtn.addEventListener('click', () => {
          if (window.deleteExpenseReport) {
            window.deleteExpenseReport();
          }
        });

        // 单一生成入口：只保留一个生成按钮，避免页面上出现两个语义相同的按钮
        buttonContainer.appendChild(generateBtn);
        buttonContainer.appendChild(deleteBtn);
        content.appendChild(buttonContainer);

        reportCard.appendChild(header);
        reportCard.appendChild(content);

        statsCard.parentElement.insertBefore(reportCard, statsCard.nextSibling);
        console.log('✅ 报销单操作卡片已添加');
      }

    })();
