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

      // ── 票据去重（关键）────────────────────────────────────────────
      // 同一个 PDF 在 __invoiceDataCache 里会有两条记录：
      //   alert-dialog.js 按「文件名」写一条，本脚本按「文件指纹」写一条。
      // 所以直接 Object.values(cache) 会把“上传 10 个文件”算成 20 份票据。
      // 这里按「文件身份 + 金额」归一：有指纹用指纹，没有指纹退回文件名；
      // 加上金额是为了不同内容的同名文件不会被误合并（同金额同名的极少数
      // 情况在界面上本来就无法区分，合并更符合直觉）。
      function dedupeReceipts(list) {
        const seen = new Set();
        const out = [];
        (list || []).forEach((item) => {
          if (!item) return;
          const name = item.fileName || item.name || '';
          const identity = (name && findFileKeyByName(name)) || name;
          const cents = Math.round((parseFloat(item.amount) || 0) * 100);
          // 完全拿不到文件名的条目无法判定重复，原样保留。
          if (!identity) { out.push(item); return; }
          const key = identity + '|' + cents;
          if (seen.has(key)) return;
          seen.add(key);
          out.push(item);
        });
        return out;
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

      // ── 发票统计卡片修正：按“当前上传文件”分类（发票 / 行程单）──
      // 缓存里会残留已删除/清空的历史文件；旧逻辑直接遍历 __invoiceDataCache，
      // 于是上传 10 个文件却可能显示 16 张发票 + 4 份行程单。现在以 React 的
      // invoiceFiles 为事实源，只统计当前文件，并对同一文件的重复缓存键去重。
      function currentUploadedFiles() {
        // React 状态里 invoiceFiles 与用户看到的文件数量严格一致。
        try {
          const root = document.querySelector('#__next') || document.body;
          const fk = root && Object.keys(root).find(
            (k) => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance')
          );
          if (fk) {
            let found = null;
            const visit = (node, depth) => {
              if (found || !node || depth > 20) return;
              let hook = node.memoizedState;
              while (hook) {
                const state = hook.memoizedState;
                if (state && Array.isArray(state.invoiceFiles)) {
                  found = state.invoiceFiles;
                  return;
                }
                if (state && state.current && Array.isArray(state.current.invoiceFiles)) {
                  found = state.current.invoiceFiles;
                  return;
                }
                hook = hook.next;
              }
              visit(node.child, depth + 1);
              visit(node.sibling, depth + 1);
            };
            visit(root[fk], 0);
            if (found) {
              return found
                .map((entry) => (entry && entry.file) || entry)
                .filter((file) => file && (file.name || file.fileName));
            }
          }
        } catch (e) { /* React 内部结构不可用时退回 input.files */ }

        try {
          const inputs = document.querySelectorAll('input[type="file"]');
          const files = [];
          inputs.forEach((input) => {
            for (const file of (input.files || [])) files.push(file);
          });
          return inputs.length > 0 ? files : null;
        } catch (e) {
          return null;
        }
      }

      function collectStatsItems() {
        const selector = window.__expenseReportCore && window.__expenseReportCore.selectInvoiceStatsItems;
        const files = currentUploadedFiles();
        if (typeof selector === 'function') {
          return selector(files, window.__invoiceDataCache || {}, fileKeyOf);
        }
        // 兜底：core 未加载新选择器时维持旧行为，但仍按文件身份去重。
        return {
          known: Array.isArray(files),
          items: dedupeReceipts(Object.values(window.__invoiceDataCache || {}).filter((v) => v &&
            !/^报销单[_-]|^报销单\.pdf$/i.test(v.fileName || '') &&
            !(v.fileName || '').startsWith('000_')))
        };
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
          const { items, known } = collectStatsItems();
          if (!items.length && !known) return false;
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
                // 金额优先级交给 utils.pickAmount：票面价税合计/行程单核对金额才由识别结果拍板，
                // 打分猜出来的数仍让 React 先上，两个来源对不上时把差额留在 amountAlt 里提示用户。
                const picked = (window.__expenseReportTable && window.__expenseReportTable.utils.pickAmount)
                  ? window.__expenseReportTable.utils.pickAmount(cached, reactAmount)
                  : { amount: reactAmount != null ? reactAmount : (cached.amount || 0),
                      amountAlt: null, amountAltFrom: '', amountSource: cached.amountSource || '' };
                const amount = picked.amount;
                const amountAlt = picked.amountAlt;
                const amountAltFrom = picked.amountAltFrom;
                // 项目名同理：识别结果比 React 更懂「*生产生活服务*经纪代理+服务*代订住宿费」这种拆行，
                // 但识别失败时会退化成占位的「电子发票」，那种情况仍用 React 读到的名字。
                const recognizedName = (cached.itemName && cached.itemName !== '电子发票') ? cached.itemName : '';
                const reactName = inv.itemName || inv.name || '';
                return {
                  amount,
                  amountAlt,
                  amountAltFrom,
                  amountSource: picked.amountSource,
                  issueDate: cached.date || inv.date || new Date(),
                  date: cached.date || inv.date || new Date(),
                  projectName: recognizedName || reactName || '电子发票',
                  itemName: recognizedName || reactName || '电子发票',
                  fileName: inv.fileName || '',
                  isTrip: !!cached.isTrip,
                  trip: cached.trip || null,
                  // 住宿/班车等票据类型硬结论（识别阶段产出），确认弹窗与表格据此优先归类
                  docKind: cached.docKind || '',
                  dateSource: cached.dateSource || '',
                  // 混合票（住宿+交通同一张）的拆分明细，表格按它把金额写进两列
                  splits: cached.splits || null,
                };
              });

              let tot = null;
              if (typeof statsTotal === 'number') tot = statsTotal / 100;

              // React 侧也可能把同一文件报两次，统一按文件身份去重后再返回。
              invoices = dedupeReceipts(invoices);
              return { invoices, totalAmount: tot, totalCount: invoices.length };
            }
          }
        } catch (e) {
          console.log('React获取失败:', e.message);
        }

        if (window.__invoiceDataCache) {
          // 缓存里同一文件有「文件名键 + 指纹键」两条记录，必须先归一再去重，
          // 否则上传 10 个文件会显示成 20 份票据。
          const cached = dedupeReceipts(Object.values(window.__invoiceDataCache).filter(
            (inv) => inv && !/^报销单[_-]|^报销单\.pdf$/i.test(inv.fileName) && !inv.fileName.startsWith('000_')
          ));

          if (cached.length > 0) {
            const domStats = parseStatsFromDOM();
            const totalAmount = domStats.totalAmount !== null ? domStats.totalAmount : null;
            return {
              invoices: cached.map((inv) => ({
                amount: inv.amount,
                // 金额可信度：guess/yen 表示这个数是从票面文字推测的，确认弹窗要给「!」提示
                amountSource: inv.amountSource || '',
                issueDate: inv.date,
                date: inv.date,
                projectName: inv.itemName,
                itemName: inv.itemName,
                fileName: inv.fileName,
                isTrip: !!inv.isTrip,
                trip: inv.trip || null,
                docKind: inv.docKind || '',
                dateSource: inv.dateSource || '',
                splits: inv.splits || null,
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

          const fresh = dedupeReceipts(Object.values(window.__invoiceDataCache).filter(
            (inv) => inv && !/^报销单[_-]|^报销单\.pdf$/i.test(inv.fileName) && !inv.fileName.startsWith('000_')
          ));

          if (fresh.length > 0) {
            const domStats = parseStatsFromDOM();
            return {
              invoices: fresh.map((inv) => ({
                amount: inv.amount,
                // 金额可信度：guess/yen 表示这个数是从票面文字推测的，确认弹窗要给「!」提示
                amountSource: inv.amountSource || '',
                issueDate: inv.date,
                date: inv.date,
                projectName: inv.itemName,
                itemName: inv.itemName,
                fileName: inv.fileName,
                isTrip: !!inv.isTrip,
                trip: inv.trip || null,
                docKind: inv.docKind || '',
                dateSource: inv.dateSource || '',
                splits: inv.splits || null,
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

      function expenseFingerprint(inv) {
        // 文件指纹（name::size::lastModified）：与上传顺序无关，重传同一文件也命中
        const name = String((inv && inv.fileName) || '');
        return (name && findFileKeyByName(name)) || '';
      }

      function expenseOverrideKey(inv, idx) {
        // 键用文件指纹而不是「文件名::序号」：用户重传同一批票据、或增删其中
        // 一两张时序号会整体平移，旧写法会让上次核对过的日期/费用列静默套到别的票。
        const api = window.__expenseReportTable;
        const fp = expenseFingerprint(inv);
        if (api && api.utils.overrideKey) return api.utils.overrideKey(inv && inv.fileName, fp, idx);
        return fp || (String((inv && inv.fileName) || '') + '::#' + idx);
      }

      // 取某张票的人工修正记录：指纹优先；指纹变了（另存/重新导出）但文件名
      // 唯一命中时仍认；同名多条则放弃匹配——宁可让用户重新确认，也不能张冠李戴。
      function findExpenseOverride(ov, inv, idx) {
        const api = window.__expenseReportTable;
        const name = (inv && inv.fileName) || '';
        if (api && api.utils.resolveOverride) {
          return api.utils.resolveOverride(ov, name, expenseFingerprint(inv), idx);
        }
        return ov[expenseOverrideKey(inv, idx)] || null;
      }

      function applyExpenseReportOverrides(invoiceData) {
        const ov = window.__expenseReportOverrides || {};
        (invoiceData || []).forEach((inv, idx) => {
          const o = findExpenseOverride(ov, inv, idx);
          if (!o) return;
          if (o.projectName != null) { inv.projectName = o.projectName; inv.itemName = o.itemName; }
          if (o.amount != null) inv.amount = o.amount;
          // 用户上次已经核对过这张票的金额：别再拿同一张票的「金额存疑」提示烦他
          if (o.amountConfirmed) { inv.__amountConfirmed = true; inv.amountSource = 'manual'; }
          if (o.reportDate) inv.__reportDate = o.reportDate;
          else delete inv.__reportDate;
          if (o.category) inv.__reportCategory = o.category;
          else delete inv.__reportCategory;
          if (o.excluded) inv.__reportExcluded = true;
          else delete inv.__reportExcluded;
          if (o.tripDate && inv.trip) inv.trip = Object.assign({}, inv.trip, { primaryDate: o.tripDate });
        });
        return invoiceData;
      }

      function saveExpenseReportOverrides(invoiceData) {
        const ov = {};
        (invoiceData || []).forEach((inv, idx) => {
          // 手动补录的票不在 overrides 里：它自己存在 __manualReceipts，
          // 混进来会留下一堆 fileName 为空的键，下次匹配反而容易张冠李戴。
          if (inv && inv.__manual) return;
          ov[expenseOverrideKey(inv, idx)] = {
            projectName: inv.projectName, itemName: inv.itemName, amount: inv.amount,
            amountConfirmed: !!inv.__amountConfirmed,
            reportDate: inv.__reportDate || '',
            category: inv.__reportCategory || '',
            excluded: !!inv.__reportExcluded,
            tripDate: (inv.trip && inv.trip.primaryDate) || ''
          };
        });
        window.__expenseReportOverrides = ov;
      }

      // ------------------------------------------------------------------
      // 手动补录的纸质票据存这里，和文件识别缓存完全分开：
      //   · 没有对应文件，去重/识别/行程配组都不该碰它
      //   · 只在本页会话内保留（与人工修正 overrides 同一策略），刷新即清空
      //   · 每条有稳定 id，增删不影响别的条目
      // ------------------------------------------------------------------
      function loadManualReceipts() {
        return Array.isArray(window.__manualReceipts) ? window.__manualReceipts.slice() : [];
      }

      function saveManualReceipts(list) {
        window.__manualReceipts = (list || []).slice();
      }

      function nextManualId() {
        let max = 0;
        loadManualReceipts().forEach((r) => {
          const n = parseInt(String((r && r.id) || '').replace(/\D/g, ''), 10);
          if (isFinite(n) && n > max) max = n;
        });
        return 'm' + (max + 1);
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
            // 一张上传的票都没有时也允许出单——只要之前手动补录过实体票，
            // 「这趟全是纸质票」是合法场景，不该被「请先上传发票」挡在门外。
            if (!loadManualReceipts().length) {
              alert('❌ 请先上传发票文件，或点「＋ 手动补录」添加一张纸质票\n\n提示：上传后稍等片刻，系统会自动识别发票信息。');
              return false;
            }
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
          showSuccessNotification('✅ 报销单已确认并生成！预览在右侧，下方卡片可直接「打印」或「下载」。');
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
      // 生成前强制确认窗口：左侧报销单实时预览，右侧逐张发票完整表格。
      // 右侧默认落在「待处理」：只列需要人看一眼的票（超范围 / 金额待核 / 混合票拆分），
      // 一张待处理都没有时自动回「全部票据」，免得开窗正对一张空列表。
      // 预览与表格双向定位高亮。
      // 点击预览单元格 -> 弹出「这张格子由哪些票据组成」的编辑面板。
      // 返回 Promise<draft[] | false>；false = 用户取消，不生成任何 PDF。
      // totalAmountFromStats 仅保留给调用方传参兼容，合计以表格模型为准。
      // ------------------------------------------------------------------
      function showExpenseReportConfirmDialog(invoiceData, totalAmountFromStats) {
        return new Promise((resolve) => {
          const api = window.__expenseReportTable;
          if (!api) { alert('❌ 差旅报销单模块未加载'); resolve(false); return; }

          // 副本操作：取消即丢弃，不污染 React / 识别缓存里的原始数据
          const baseDraft = invoiceData.map(inv => Object.assign({}, inv, {
            trip: inv.trip ? Object.assign({}, inv.trip) : null
          }));
          // 手动补录的纸质票追加在最后：原票据索引不变（cellSources / overrides 都按索引取值），
          // 它们也不进识别缓存，只在本次生成的草稿里作为普通发票参与填表。
          const draft = baseDraft.concat(
            loadManualReceipts().map(r => api.utils.manualReceipt(r, readTripConfigFromUI().startDate))
          );
          const cfg = Object.assign({}, readTripConfigFromUI());
          let settled = false;
          let currentIssues = [];
          let currentAnalysis = null;
          let sideTab = 'all';
          // 用户手动点过右侧标签后就不再自动切默认视图：他正在看「全部票据」时
          // 不该因为改了一张票的日期而被弹回「待处理」。
          let sideTabPinned = false;
          let activeCell = null;
          // 手动补录表单：null = 收起。表单值放这里而不是直接读 DOM，
          // 这样 refresh() 重绘侧栏时用户正在敲的数不会丢。
          let manualForm = null;

          const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
          })[c]);
          const cnDay = (dt) => dt ? (dt.getFullYear() + '/' + (dt.getMonth() + 1) + '/' + dt.getDate()) : '';
          const yuan = (cents) => '¥' + ((cents || 0) / 100).toFixed(2);
          const first = api.analyzeExpenseReport(draft, cfg);
          currentAnalysis = first;

          function dateForRow(inv, i, analysis) {
            if (inv.isTrip) {
              const p = inv.trip && inv.trip.primaryDate;
              return p ? String(p).slice(0, 10) : formatDateForInput(inv.issueDate || inv.date);
            }
            const d = (analysis.model.stats.details || []).find(x => x.index === i);
            return (d && d.dates && d.dates[0]) || inv.__reportDate ||
              formatDateForInput(inv.issueDate || inv.date);
          }

          function dayOptionsHTML(analysis) {
            return (analysis.dayKeys || []).map(k =>
              `<option value="${k}">${k}</option>`).join('');
          }

          function catSelectHTML(inv, i) {
            if (inv.isTrip) return '<span class="erc-muted">仅核对日期/金额</span>';
            // 手动补录的票没有票面可认，不存在「自动识别」这一档：类别就是用户选的那个。
            if (inv.__manual) {
              const list = api.SELECTABLE_CATS || [];
              return `<select class="erc-input erc-cat is-manual" data-idx="${i}" title="选择这条手动记录填入的费用列">
                ${list.map(k =>
                  `<option value="${k}" ${inv.__reportCategory === k ? 'selected' : ''}>${esc(api.COL_LABEL[k] || k)}</option>`).join('')}
              </select>`;
            }
            const catList = api.SELECTABLE_CATS || ['ticket', 'taxi', 'transportOther', 'lodging', 'refund'];
            const manualCat = !!inv.__reportCategory;
            // 自动识别那一档要忽略人工指定再算一次，否则选完就显示成「自动识别（普票费）」
            // 却仍在用人工值，用户看不出自己到底改没改。
            const autoCat = api.utils.categorize(Object.assign({}, inv, { __reportCategory: '' }), cfg);
            const autoLabel = '自动识别（' + esc(api.COL_LABEL[autoCat] || autoCat) + '）';
            // 「自动识别」这一档必须一直可选项：混合票的人工指定会关掉拆分，
            // 下拉里没有回头路的话，200 住宿 + 50 交通 就永久并成 250 进一列了。
            return `<select class="erc-input erc-cat${manualCat ? ' is-manual' : ''}" data-idx="${i}"
              title="选择该发票填入的费用列；选「自动识别」恢复按票据内容判断">
              <option value="" ${manualCat ? '' : 'selected'}>${autoLabel}</option>
              ${catList.map(k =>
                `<option value="${k}" ${manualCat === k ? 'selected' : ''}>${esc(api.COL_LABEL[k] || k)}</option>`).join('')}
            </select>`;
          }

          // 右侧「行程卡片」：一张发票 + 金额核对到的 0~N 张行程单 = 一张可拖拽卡片。
          // 视觉上按费用类别整体着色：实色标题带 + 淡色卡体 + 类别边框 + 大图标，五类一眼可分。
          // 信息去重原则（每个数字/名词只出现一次，除非它表达的是不同含义）：
          //   · 卡片标题 = 费用类别；行内下拉不再重复渲染类别色标签
          //   · 金额：单张发票只在行内出现一次，≥2 张时标题带才额外给出合计
          //   · 行程单：张数/日期集中在凭证条，标题副行不再重复「N 张行程单」
          //   · 「已入表」等常态状态不占行，只有需要动作（超范围/已移出）才出状态行
          // ---- 手动补录纸质票 ----
          // 场景：手上是实体票、没上传 PDF，但报销清单必须体现这笔钱。
          // 只让人填「金额 + 费用列 + 归行日期（+可选说明）」，其余全按普通发票走。
          function pad2(n) { return String(n).padStart(2, '0'); }

          // 默认日期：今天；今天在区间外就夹到区间里（默认值不该一上来就「超范围」）
          function defaultManualDate() {
            const s = currentAnalysis && currentAnalysis.start;
            const e = currentAnalysis && currentAnalysis.end;
            const t = new Date();
            let d = new Date(t.getFullYear(), t.getMonth(), t.getDate());
            if (s && d < s) d = s;
            if (e && d > e) d = e;
            return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
          }

          // 草稿里的手动条目回写到 window.__manualReceipts：增删改都在这里同步，
          // 关掉弹窗（哪怕取消）后再点生成，补录的票还在。
          function syncManualReceipts() {
            const list = [];
            draft.forEach((inv) => {
              if (!inv || !inv.__manual) return;
              list.push({
                id: inv.__manualId || '',
                amount: inv.amount,
                category: inv.__reportCategory || 'ticket',
                date: inv.__reportDate || '',
                name: inv.projectName || '',
                excluded: !!inv.__reportExcluded
              });
            });
            saveManualReceipts(list);
          }

          function openManualForm(preset) {
            const cats = api.SELECTABLE_CATS || [];
            const cat = preset && cats.indexOf(preset.cat) !== -1 ? preset.cat : 'ticket';
            manualForm = {
              amount: '',
              cat: cat,
              date: (preset && /^\d{4}-\d{2}-\d{2}$/.test(preset.date || '')) ? preset.date : defaultManualDate(),
              name: ''
            };
            renderSide();
            sideList.scrollTop = 0;
            const box = sideList.querySelector('[data-manual-field="amount"]');
            if (box) box.focus();
          }

          function addManualReceipt() {
            if (!manualForm) return;
            const amt = parseFloat(String(manualForm.amount).replace(/[^\d.]/g, ''));
            const box = sideList.querySelector('[data-manual-field="amount"]');
            if (!isFinite(amt) || amt <= 0) {
              // 不弹 alert：正在填表时被打断最烦。让金额框自身变红说明问题。
              if (box) { box.style.borderColor = '#dc2626'; box.style.background = '#fef2f2'; box.focus(); }
              return;
            }
            const rec = api.utils.manualReceipt({
              id: nextManualId(), amount: amt, category: manualForm.cat,
              date: manualForm.date, name: manualForm.name
            }, defaultManualDate());
            draft.push(rec);
            manualForm = null;
            refresh();
            // 新卡片可能排在列表末尾，滚过去并高亮一下，否则用户以为没加上
            const card = sideList.querySelector('.erc-inv-row[data-idx="' + (draft.length - 1) + '"]');
            if (card) {
              card.scrollIntoView({ block: 'center' });
              card.classList.add('is-selected');
              setTimeout(() => card.classList.remove('is-selected'), 1600);
            }
          }

          function manualFormHTML() {
            if (!manualForm) return '';
            const cats = api.SELECTABLE_CATS || [];
            const opts = cats.map(k =>
              `<option value="${k}" ${manualForm.cat === k ? 'selected' : ''}>${esc(api.COL_LABEL[k] || k)}</option>`).join('');
            return `<div class="erc-manual-form">
              <div class="erc-manual-form-title">手动补录纸质发票<span>没上传文件的实体票在这里补，金额与日期由你填</span></div>
              <div class="erc-field-row">
                <div class="erc-field"><span>金额</span>
                  <input class="erc-input" data-manual-field="amount" type="number" step="0.01" min="0"
                    placeholder="0.00" value="${esc(manualForm.amount)}"></div>
                <div class="erc-field"><span>填入位置</span>
                  <select class="erc-input" data-manual-field="cat">${opts}</select></div>
              </div>
              <div class="erc-field"><span>归行日期</span>
                <input class="erc-input" data-manual-field="date" type="date" value="${esc(manualForm.date)}"></div>
              <div class="erc-field"><span>说明（可选）</span>
                <input class="erc-input" data-manual-field="name" type="text" maxlength="40"
                  placeholder="如：南宁—北京 高铁票" value="${esc(manualForm.name)}"></div>
              <div class="erc-manual-actions">
                <button type="button" class="erc-manual-add" data-manual-add>添加这张票</button>
                <button type="button" class="erc-manual-cancel" data-manual-cancel>取消</button>
                <span class="erc-muted">金额框里按回车也能添加</span>
              </div>
            </div>`;
          }

          function groupCardHTML(g, analysis, badSet) {
            const orphan = g.type === 'orphanTrip';
            const cat = g.category;
            // 未核对到发票的行程单用中性灰（它不计费，避免误当某类费用）
            const st = orphan ? (api.CAT_STYLE.trip || api.CAT_STYLE.transportOther)
                              : (api.CAT_STYLE[cat] || api.CAT_STYLE.transportOther);
            const bad = g.outOfRange || g.invoiceIndices.some(i => badSet.has(i));
            const invCount = g.invoiceIndices.length;
            const tripCount = g.trips.length;
            const tripNames = g.trips.map(t => esc(t.fileName || t.date)).join('、');
            const tripDates = Array.from(new Set(g.trips.map(t => t.date).filter(Boolean))).join('、');
            // 凭证条用短日期（09-10），把完整的可编辑日期留给下方「归行日期」，
            // 否则同一张卡上下两行都是 2026/09/10，读起来像同一个字段写了两遍。
            const shortDay = (k) => {
              const m = String(k || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
              return m ? m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0') : String(k || '');
            };
            const tripShortDates = tripDates ? tripDates.split('、').map(shortDay).join('、') : '';
            const tripTotal = g.trips.reduce((s, t) => s + t.amountCents, 0);
            const catLabel = api.COL_LABEL[cat] || cat;
            const excluded = !!g.excluded;
            const headTitle = orphan ? '未核对发票的行程单' : esc(catLabel);
            // 副行只在有额外信息时出现：多张发票 / 已移出。单张发票时省掉一整行。
            const subText = orphan ? '金额不计入报销单'
              : (excluded ? '已移出 · 可拖回归行' : (invCount > 1 ? invCount + ' 张发票' : ''));
            // 单张发票的金额由行内输入框承载；合计只在真正的“合计”场景出现。
            const headAmt = (!orphan && invCount > 1) ? yuan(g.amountCents) : '';

            // 行程单凭证条：白底 + 类别色边框，在淡色卡体上凸显；多张合计标注张数与日期。
            // 金额与发票合计相同时不再重复（那是同一个数），仅在无发票或对不上时展示。
            const showTripAmt = tripCount > 0 && (!invCount || tripTotal !== g.amountCents);
            // 无行程单时的归行依据：住宿票按入住日、旅客运输票按出行日，其余才是开票日期。
            // 直接说「按开票日期归行」会误导用户以为酒店票被排到开票那天。
            const noTripBy = (function () {
              const src = (g.invoice && g.invoice.dateSource) ||
                ((draft[g.invoiceIndices[0]] || {}).dateSource);
              return src === 'stay' ? '按入住日归行'
                : src === 'travel' ? '按出行日归行'
                : src === 'manual' ? '手动指定日期' : '按开票日期归行';
            })();
            const tripBar = tripCount
              ? `<div class="erc-trip-bar" style="background:#fff;border-color:${st.border};" title="${tripNames}">
                   <span class="erc-trip-ico">📋</span>
                   <span class="erc-trip-meta">行程单${tripCount > 1 ? ' ×' + tripCount : ''}${tripShortDates ? ' · ' + esc(tripShortDates) : ''}</span>
                   ${showTripAmt ? `<b class="erc-trip-amt" style="color:${st.color};" title="行程单金额仅用于分组，不计入报销（票面与发票合计不一致）">${yuan(tripTotal)}</b>` : ''}
                 </div>`
              : `<div class="erc-trip-bar is-empty" title="无行程单的发票按${noTripBy.replace('归行', '')}归行">
                   <span class="erc-trip-ico">🧾</span>
                   <span class="erc-trip-meta">无行程单 · ${noTripBy}</span></div>`;

            const invoiceRows = g.invoiceIndices.map(i => {
              const inv = draft[i];
              if (!inv) return '';
              const isBad = badSet.has(i) || (analysis.issues || []).some(x => x.index === i);
              // 按每张发票自己的类别着色：手动改过费用列后即时反映，不被整卡类别带偏。
              const invCat = api.utils.categorize(inv, cfg);
              const invSt = api.CAT_STYLE[invCat] || api.CAT_STYLE.transportOther;
              const manualMark = inv.__reportCategory
                ? ' <span style="color:#7c3aed;font-weight:700;" title="已人工指定费用列">✎</span>' : '';
              // 状态行只在需要动作时出现：超范围可一键选日期；已移出给出拖回提示。
              // 金额存疑的票另挂一枚「金额待核」小签——金额框上的「!」只够提示，
              // 在「待处理」列表里得让人一眼看出是哪一张、为什么被列进来。
              const amtPending = inv.amountAlt != null || inv.amountSource === 'guess' || inv.amountSource === 'yen';
              const pendTag = (!inv.__reportExcluded && amtPending)
                ? `<span class="erc-pend-tag erc-pend-amount" title="金额是按票面文字推测的，或两个来源对不上；核对票面「价税合计」后可直接改">金额待核</span>`
                : '';
              // 手动补录的票：标签说明它不是识别出来的，删除是彻底删掉这条记录
              // （和「移出表格」不同——移出只是不计入，还能拖回来）。
              const manualFoot = inv.__manual
                ? `<span class="erc-manual-tag" title="手动补录：不对应已上传的文件">手动</span>` +
                  `<button type="button" class="erc-manual-del" data-manual-del="${i}" title="删除这条手动记录">删除</button>`
                : '';
              const footHead = inv.__reportExcluded
                ? `<span class="erc-muted" style="color:#64748b;">已移出 · 拖回表格恢复</span>`
                : (isBad
                  ? `<select class="erc-input erc-quick" data-idx="${i}" title="放入出差日期"><option value="">⚠ 超范围 · 选择出差日期…</option>${dayOptionsHTML(analysis)}</select>`
                  : '');
              const foot = (footHead || pendTag || manualFoot)
                ? `<div class="erc-inv-foot">${footHead}${pendTag}${manualFoot}</div>` : '';
              // 金额存疑的两种情形，都用金额框里的「!」提示，鼠标悬停看两个数：
              //   1) 识别结果与 React 解析器对不上（都能读到数时才有此情形）
              //   2) 票面根本没印「价税合计（小写）」，金额是按票面文字推测的
              // 单靠一个数字用户发现不了「系统读错了」，而金额错一位直接影响报销总额。
              const amtWarn = (function () {
                const shown = (parseFloat(inv.amount) || 0).toFixed(2);
                if (inv.amountAlt != null) {
                  const altIsRec = inv.amountAltFrom === 'recognition';
                  const rec = altIsRec ? inv.amountAlt : inv.amount;
                  const prs = altIsRec ? inv.amount : inv.amountAlt;
                  return `<span class="erc-amt-warn" title="两个来源不一致：识别结果 ¥${(rec || 0).toFixed(2)} / 解析器 ¥${(prs || 0).toFixed(2)}，当前采用 ¥${shown}。请核对票面「价税合计」，可直接改。">!</span>`;
                }
                const src = inv.amountSource;
                if (src === 'guess' || src === 'yen') {
                  return `<span class="erc-amt-warn" title="这张票没印「价税合计（小写）」，¥${shown} 是从票面文字推测的。请核对后直接改。">!</span>`;
                }
                return '';
              })();
              // 混合票（住宿+交通同一张）：金额会被拆到两列，必须明说，否则用户
              // 只看到「住宿费 ¥250」会以为交通那 50 元写丢了。
              // 数的口径必须和表格一致：用户改过金额后按原比例归一，提示不能还写着旧的两笔。
              const splitNote = (function () {
                if (!Array.isArray(inv.splits) || inv.splits.length < 2 || inv.__reportCategory) return '';
                const norm = api.utils.normalizeSplits
                  ? api.utils.normalizeSplits(inv.splits, Math.round((parseFloat(inv.amount) || 0) * 100))
                  : null;
                if (!norm) return '';
                const parts = norm.map(pc => (pc.cat === 'lodging' ? '住宿费 ' : '车船费-其他 ') + yuan(pc.cents));
                return `<div class="erc-inv-foot"><span class="erc-muted" style="color:#7c3aed;">⤺ 混合票已按票面明细拆分：${esc(parts.join(' + '))}</span></div>`;
              })();
              return `<div class="erc-inv-row${isBad ? ' is-bad' : ''}" data-idx="${i}" data-inv-card="${g.key}">
                <div class="erc-inv-head">
                  <span class="erc-cat-dot" style="background:${invSt.color};" title="${esc(api.COL_LABEL[invCat] || invCat)}"></span>
                  <input class="erc-input erc-name" data-idx="${i}" type="text" value="${esc(inv.projectName || inv.itemName || '电子发票')}"
                    title="${esc(inv.projectName || inv.itemName || inv.fileName || '电子发票')}">
                  <span class="erc-amt-box" title="票面金额（可直接修改）"><span>¥</span>
                    <input class="erc-input erc-amount" data-idx="${i}" type="number" step="0.01" min="0" value="${(parseFloat(inv.amount) || 0).toFixed(2)}">${amtWarn}</span>
                </div>
                <div class="erc-inv-fields">
                  <div class="erc-field"><span>填入位置${manualMark}</span>${catSelectHTML(inv, i)}</div>
                  <div class="erc-field"><span>归行日期</span>
                    <input class="erc-input erc-date" data-idx="${i}" type="date" value="${dateForRow(inv, i, analysis)}"></div>
                </div>
                ${splitNote}
                ${foot}
              </div>`;
            }).join('');

            return `<div class="erc-group-card${bad ? ' is-bad' : ''}${excluded ? ' is-excluded' : ''}" data-group-key="${esc(g.key)}" draggable="true"
                      style="border-color:${st.border};border-left:4px solid ${st.color};background:${bad ? '#fffaf3' : st.bg};">
              <div class="erc-group-head" style="background:${st.color};">
                <span class="erc-drag-handle" title="拖到左侧报销单格子里">⠿</span>
                <span class="erc-cat-badge">${st.icon}</span>
                <div class="erc-group-title">
                  <b>${headTitle}</b>
                  ${subText ? `<div class="erc-group-sub">${esc(subText)}</div>` : ''}
                </div>
                ${excluded
                  ? '<span class="erc-bad-flag" style="background:#64748b;" title="已移出报销单，拖回格子即可重新计入">已移出</span>'
                  : (bad ? '<span class="erc-bad-flag" title="日期超出出差范围">⚠ 超范围</span>' : '')}
                ${headAmt ? `<span class="erc-group-amt">${headAmt}</span>` : ''}
              </div>
              ${tripBar}
              ${invoiceRows || '<div class="erc-muted" style="padding:6px 2px;">该行程单未匹配到发票，金额不计入报销单。</div>'}
            </div>`;
          }

          function issueCardHTML(issue, analysis) {
            const inv = draft[issue.index];
            if (!inv) return '';
            return `<div class="erc-issue" data-idx="${issue.index}">
              <div class="erc-issue-top"><span class="erc-tag is-bad">超范围</span><b>${yuan(issue.amount)}</b></div>
              <div class="erc-issue-name">${esc(inv.projectName || inv.itemName || issue.fileName || '电子发票')}</div>
              <div class="erc-muted">票据日期 ${dateForRow(inv, issue.index, analysis)}</div>
              <select class="erc-input erc-quick" data-idx="${issue.index}"><option value="">放入出差日期…</option>${dayOptionsHTML(analysis)}</select>
            </div>`;
          }

          function cellTitle(rowKey, cat) {
            const label = rowKey === '__out__' ? '超范围票据' : rowKey;
            return cat ? `${label} · ${api.COL_LABEL[cat] || cat}`
              : `${label} · ${rowKey === '__out__' ? '全部' : '当日票据'}`;
          }

          const overlay = document.createElement('div');
          // pointer-events:auto 不能省。app 用 Radix 弹窗时会锁 body 的 pointer-events
          // （body{pointer-events:none} + 弹窗自己 auto），我们的浮层挂在 body 下会继承 none，
          // 结果是弹窗画得好好地、鼠标点「取消/确认生成」却穿透到底下的遮罩上，整层点不动。
          // 这里显式 auto，把本层及其子树从 body 的锁里摘出来。
          overlay.style.cssText = 'position:fixed;inset:0;pointer-events:auto;background:rgba(15,23,42,0.55);z-index:100000;display:flex;align-items:center;justify-content:center;padding:16px;';
          overlay.innerHTML = `
            <style>
              .erc-dialog{background:#fff;border-radius:16px;width:min(1440px,96vw);max-height:94vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 24px 70px rgba(15,23,42,.35);font-family:-apple-system,'Segoe UI','Microsoft YaHei',sans-serif;color:#111827;}
              .erc-body{flex:1;display:flex;gap:12px;padding:12px 16px;min-height:0;}
              .erc-canvas{flex:1;min-width:0;display:flex;flex-direction:column;position:relative;}
              .erc-side{width:clamp(410px,42vw,640px);flex:none;display:flex;flex-direction:column;min-height:0;border:1px solid #e5e7eb;border-radius:10px;background:#fff;}
              .erc-side-head{padding:9px 10px;border-bottom:1px solid #eef0f4;}
              .erc-side-tabs{display:flex;gap:5px;}
              .erc-side-tabs button,.erc-view-switch button{padding:5px 9px;border:1px solid #dfe3ea;border-radius:6px;background:#fff;color:#4b5563;font-size:11px;cursor:pointer;}
              .erc-side-tabs button.on,.erc-view-switch button.on{border-color:#4338ca;background:#eef2ff;color:#3730a3;}
              .erc-legend{display:flex;flex-wrap:wrap;gap:4px 9px;margin-top:8px;padding-top:7px;border-top:1px dashed #eef0f4;font-size:10px;color:#6b7280;}
              .erc-legend span{display:inline-flex;align-items:center;gap:3px;white-space:nowrap;}
              .erc-legend i{width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center;border-radius:4px;font-style:normal;font-size:10px;line-height:1;}
              /* 全局只说一次的话（行程单不计金额），替代原先每张卡重复的括注 */
              .erc-note{margin-top:6px;font-size:10px;line-height:1.5;color:#9ca3af;}
              .erc-side-list{flex:1;min-height:0;overflow:auto;padding:0;}
              /* 「待处理」顶部小结：几笔、分别是哪种，省得用户在卡片堆里自己找 */
              .erc-pend-strip{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:8px 10px;border-bottom:1px solid #eef0f4;background:#fcfcfd;font-size:11px;color:#4b5563;}
              .erc-pend-tag{display:inline-flex;align-items:center;gap:4px;padding:1px 7px;border-radius:99px;border:1px solid #e5e7eb;background:#fff;font-weight:600;}
              .erc-pend-tag b{font-weight:700;}
              .erc-pend-out{border-color:#fecaca;background:#fef2f2;color:#b91c1c;}
              .erc-pend-amount{border-color:#fde68a;background:#fffbeb;color:#b45309;}
              .erc-pend-split{border-color:#ddd6fe;background:#f5f3ff;color:#6d28d9;}
              /* 手动补录：没有文件、只有一笔金额的实体票 */
              .erc-manual-new{margin-left:auto;padding:5px 9px;border:1px dashed #a5b4fc;border-radius:6px;background:#eef2ff;color:#3730a3;font-size:11px;font-weight:600;cursor:pointer;}
              .erc-manual-new:hover{background:#e0e7ff;}
              .erc-manual-form{margin:10px 10px 0;padding:9px;border:1px solid #ddd6fe;border-radius:9px;background:#faf9ff;}
              .erc-manual-form-title{display:flex;align-items:baseline;gap:6px;font-size:12px;font-weight:700;color:#4c1d95;margin-bottom:2px;}
              .erc-manual-form-title span{font-weight:400;font-size:10px;color:#8b5cf6;}
              .erc-manual-form .erc-field{margin-bottom:6px;}
              .erc-manual-actions{display:flex;align-items:center;gap:6px;margin-top:2px;}
              .erc-manual-add{padding:5px 12px;border:none;border-radius:6px;background:#4338ca;color:#fff;font-size:11px;font-weight:600;cursor:pointer;}
              .erc-manual-add:hover{background:#3730a3;}
              .erc-manual-cancel{padding:5px 10px;border:1px solid #d1d5db;border-radius:6px;background:#fff;color:#4b5563;font-size:11px;cursor:pointer;}
              .erc-manual-tag{display:inline-flex;align-items:center;padding:0 6px;border-radius:99px;border:1px solid #ddd6fe;background:#f5f3ff;color:#6d28d9;font-size:10px;font-weight:600;white-space:nowrap;}
              .erc-manual-del{padding:1px 7px;border:1px solid #fecaca;border-radius:6px;background:#fff;color:#b91c1c;font-size:10px;cursor:pointer;}
              .erc-manual-del:hover{background:#fef2f2;}
              .erc-card-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(248px,1fr));gap:10px;align-content:start;padding:10px;}
              .erc-group-card{border:1px solid #cbd5e1;border-left:4px solid #cbd5e1;border-radius:10px;background:#fff;padding:8px;font-size:12px;transition:box-shadow .12s,transform .12s;box-shadow:0 1px 2px rgba(15,23,42,.05);}
              .erc-group-card:hover{box-shadow:0 4px 14px rgba(15,23,42,.13);transform:translateY(-1px);}
              .erc-group-card.is-bad{background:#fffaf3;}
              .erc-group-card.is-dragging{opacity:.45;transform:scale(.98);}
              .erc-group-card.is-selected{outline:2px solid #4338ca;outline-offset:-2px;box-shadow:0 4px 14px rgba(67,56,202,.2);}
              .erc-group-head{display:flex;align-items:center;gap:6px;margin-bottom:6px;padding:5px 7px;border-radius:7px;}
              .erc-drag-handle{cursor:grab;color:rgba(255,255,255,.85);font-size:15px;line-height:1;user-select:none;}
              .erc-drag-handle:active{cursor:grabbing;}
              .erc-cat-badge{width:25px;height:25px;flex:none;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.25);border-radius:6px;font-size:14px;line-height:1;}
              .erc-group-title{flex:1;min-width:0;color:#fff;line-height:1.3;}
              .erc-group-title b{display:block;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
              .erc-group-sub{font-size:10px;color:rgba(255,255,255,.82);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
              .erc-bad-flag{flex:none;background:#dc2626;color:#fff;font-size:10px;font-weight:700;padding:2px 6px;border-radius:8px;white-space:nowrap;}
              .erc-group-amt{font-weight:700;color:#fff;white-space:nowrap;font-size:12px;text-shadow:0 1px 1px rgba(0,0,0,.12);}
              .erc-trip-bar{display:flex;align-items:center;gap:5px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:6px;padding:4px 6px;margin-bottom:6px;font-size:10px;color:#475569;}
              .erc-trip-bar.is-empty{background:#fafafa;border-style:dashed;}
              .erc-trip-ico{font-size:12px;}
              .erc-trip-meta{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
              .erc-trip-amt{white-space:nowrap;color:#334155;}
              .erc-inv-row{border:1px solid #eef0f4;border-radius:7px;padding:6px;margin-bottom:6px;background:#fff;}
              .erc-group-card>.erc-inv-row:last-child{margin-bottom:0;}
              .erc-inv-row.is-bad{border-color:#fdba74;background:#fff7ed;}
              .erc-inv-head{display:flex;align-items:center;gap:5px;}
              .erc-inv-head .erc-name{flex:1;min-width:0;font-weight:600;}
              .erc-cat-dot{width:7px;height:7px;border-radius:50%;flex:none;}
              .erc-inv-amt{white-space:nowrap;color:#111827;font-size:11px;}
              /* 票面金额：¥ 前缀 + 右对齐输入框，读作“这张票多少钱”，不再是独立一行表单 */
              .erc-amt-box{flex:none;display:flex;align-items:center;gap:3px;padding:0 5px;border:1px solid #dfe3ea;border-radius:6px;background:#f8fafc;}
              .erc-amt-box>span{font-size:10px;color:#9ca3af;line-height:1;}
              .erc-amt-box .erc-amount{border:none;background:transparent;padding:5px 0;text-align:right;font-size:11px;font-weight:700;color:#111827;box-shadow:none;}
              .erc-amt-box .erc-amount:focus{outline:none;box-shadow:none;}
              .erc-amt-box:focus-within{border-color:#4338ca;background:#fff;}
              .erc-amt-box input::-webkit-outer-spin-button,.erc-amt-box input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0;}
              .erc-amt-box input[type=number]{-moz-appearance:textfield;}
              /* 金额存疑的小黄标：不抢布局，悬停看具体原因。
                 选择器要压过上面的 .erc-amt-box>span（那个是给「¥」用的灰字）。 */
              .erc-amt-box>span.erc-amt-warn{flex:none;width:12px;height:12px;line-height:12px;text-align:center;border-radius:50%;background:#f59e0b;color:#fff;font-size:9px;font-weight:800;cursor:help;}
              .erc-inv-fields{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:5px;}
              .erc-inv-foot{display:flex;align-items:center;justify-content:space-between;gap:5px;margin-top:5px;}
              .erc-inv-foot .erc-quick{width:100%;}
              .erc-tag{padding:2px 6px;border-radius:10px;background:#eef2ff;color:#4338ca;font-size:10px;white-space:nowrap;}
              .erc-tag.is-bad{background:#ffedd5;color:#c2410c;}
              .erc-field-row{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px;}
              .erc-field{display:flex;flex-direction:column;gap:3px;min-width:0;}
              .erc-field>span{font-size:10px;color:#9ca3af;}
              .erc-chip-drop{outline:2px dashed #4338ca!important;background:#eef2ff!important;}
              .erc-chip.is-dragging{opacity:.4;}
              .erc-side.is-eject-target{outline:2px dashed #dc2626;outline-offset:-3px;background:#fff5f5;}
              .erc-side.is-eject-target .erc-side-head{background:#fee2e2;}
              .erc-eject-hint{display:none;align-items:center;justify-content:center;gap:5px;padding:6px;margin:0 10px 8px;border:1px dashed #dc2626;border-radius:7px;background:#fef2f2;color:#b91c1c;font-size:11px;font-weight:700;}
              .erc-side.is-eject-target .erc-eject-hint{display:flex;}
              .erc-group-card.is-excluded{opacity:.72;border-style:dashed;}
              .erc-group-card.is-excluded .erc-group-head{filter:grayscale(.55);}
              .erc-input{width:100%;box-sizing:border-box;padding:5px 7px;border:1px solid #dfe3ea;border-radius:6px;font-size:12px;background:#fff;color:#111827;}
              .erc-input:disabled{background:#f8fafc;color:#9ca3af;}
              .erc-input.is-manual{border-color:#7c3aed;background:#faf5ff;}
              .erc-issue{border:1px solid #fdba74;background:#fff7ed;border-radius:8px;padding:9px;margin-bottom:8px;}
              .erc-issue-top{display:flex;justify-content:space-between;align-items:center;font-size:13px;color:#9a3412;}
              .erc-issue-name{font-size:12px;margin:6px 0 3px;word-break:break-all;}
              .erc-issue select{margin-top:7px;}
              .erc-muted{font-size:11px;color:#9ca3af;}
              .erc-pop{position:absolute;z-index:20;width:326px;max-height:76%;overflow:auto;background:#fff;border:1px solid #a5b4fc;border-radius:10px;padding:10px;box-shadow:0 12px 32px rgba(15,23,42,.22);font-size:12px;}
              .erc-pop-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-weight:700;color:#3730a3;}
              .erc-pop-row{border:1px solid #eef0f4;border-radius:8px;padding:8px;margin-bottom:7px;background:#fff;}
              .erc-pop-row .erc-input{margin-top:5px;}
              .erc-pop-actions{display:flex;justify-content:space-between;gap:6px;margin-top:8px;}
              .erc-pop-actions button{padding:5px 9px;border:1px solid #d1d5db;border-radius:6px;background:#fff;color:#4338ca;font-size:11px;cursor:pointer;}
              .erc-eject-btn{margin-top:6px;padding:4px 8px;border:1px solid #fecaca;border-radius:6px;background:#fff5f5;color:#b91c1c;font-size:10px;cursor:pointer;}
              .erc-eject-btn:hover{background:#fee2e2;}
              .erc-cell-hot{cursor:pointer;}
              .erc-cell-hot:hover{outline:1px dashed #6366f1;background:#eef2ff!important;}
              .erc-cell-active{outline:2px solid #4338ca;background:#eef2ff!important;}
              .erc-dialog.erc-v-preview .erc-side{display:none;}
              .erc-dialog.erc-v-tickets .erc-canvas{display:none;}
              /* 只看票据时预览已隐藏，侧栏就该铺满整块空间，别留一条空荡荡的右边距 */
              .erc-dialog.erc-v-tickets .erc-side{width:100%;max-width:none;}
              .erc-dialog.erc-v-tickets .erc-body{padding-top:10px;}

              /* ------------------------------------------------------------------
                 间距抢救（重要，别删）
                 Tailwind v4 的 preflight 里有一条
                   :not(#\#):not(#\#){box-sizing:border-box;border:0;margin:0;padding:0}
                 它带着 2 个 ID 的特异性，会压过本 style 里所有普通类选择器的
                 padding / margin / border —— 表现就是卡片贴边、输入框没有内边距、
                 各区块之间没有分隔线，一片信息糊在一起。
                 所以下面这批间距必须带 !important，否则一个字都不会生效。
                 ------------------------------------------------------------------ */
              .erc-body{padding:12px 16px!important;}
              .erc-side{border:1px solid #e5e7eb!important;}
              .erc-side-head{padding:9px 10px!important;border-bottom:1px solid #eef0f4!important;}
              /* preflight 把控件的 font / background 也归零成 inherit / transparent，
                 修复前按钮是 16px 无底色的纯文字、输入框没有白底，这里补回设计值。 */
              .erc-side-tabs button,
              .erc-view-switch button{padding:5px 9px!important;border:1px solid #dfe3ea!important;background:#fff!important;color:#4b5563!important;font-size:11px!important;border-radius:6px!important;cursor:pointer!important;}
              .erc-side-tabs button.on,
              .erc-view-switch button.on{border-color:#4338ca!important;background:#eef2ff!important;color:#3730a3!important;}
              .erc-legend{margin-top:8px!important;padding-top:7px!important;border-top:1px dashed #eef0f4!important;}
              .erc-note{margin-top:6px!important;}
              .erc-card-grid{padding:10px!important;align-items:start;}
              .erc-group-card{padding:8px!important;border:1px solid #cbd5e1!important;}
              .erc-group-head{padding:5px 7px!important;margin-bottom:6px!important;}
              .erc-trip-bar{padding:3px 6px!important;margin-bottom:6px!important;border:1px solid #e2e8f0!important;}
              .erc-inv-row{padding:6px!important;margin-bottom:6px!important;border:1px solid #eef0f4!important;}
              .erc-group-card>.erc-inv-row:last-child{margin-bottom:0!important;}
              .erc-inv-row.is-bad{border-color:#fdba74!important;}
              .erc-inv-fields,
              .erc-inv-foot{margin-top:5px!important;}
              .erc-amt-box{padding:0 5px!important;border:1px solid #dfe3ea!important;width:auto!important;}
              .erc-amt-box .erc-amount{width:62px!important;padding:4px 0!important;border:0!important;background:transparent!important;}
              .erc-input{padding:5px 7px!important;border:1px solid #dfe3ea!important;background:#fff!important;color:#111827!important;font-size:12px!important;}
              .erc-input.is-manual{border-color:#7c3aed!important;}
              .erc-bad-flag{padding:2px 6px!important;}
              .erc-tag{padding:2px 6px!important;}
              .erc-issue{padding:9px!important;margin-bottom:8px!important;border:1px solid #fdba74!important;}
              .erc-issue-name{margin:6px 0 3px!important;}
              .erc-issue select{margin-top:7px!important;}
              .erc-pop{padding:10px!important;border:1px solid #a5b4fc!important;}
              .erc-pop-head{margin-bottom:8px!important;}
              .erc-pop-row{padding:8px!important;margin-bottom:7px!important;border:1px solid #eef0f4!important;}
              .erc-pop-row .erc-input{margin-top:5px!important;}
              .erc-field-row{margin-top:6px!important;}
              .erc-pop-actions{margin-top:8px!important;}
              .erc-pop-actions button{padding:5px 9px!important;border:1px solid #d1d5db!important;}
              .erc-eject-btn{margin-top:6px!important;padding:4px 8px!important;border:1px solid #fecaca!important;}
              .erc-eject-hint{padding:6px!important;margin:0 10px 8px!important;}

              @media (max-width:900px){
                .erc-body{flex-direction:column;overflow:auto;}
                .erc-canvas{flex:none;height:58vh;}
                .erc-side{width:100%;height:34vh;flex:none;}
                .erc-dialog.erc-v-tickets .erc-canvas{display:none;}
                .erc-dialog.erc-v-tickets .erc-side{height:76vh;}
              }
            </style>
            <div id="erc_dialog" class="erc-dialog">
              <div style="display:flex;align-items:center;gap:10px;padding:15px 20px;border-bottom:1px solid #eef0f4;">
                <span style="font-size:20px;">✏️</span>
                <div style="flex:1;">
                  <div style="font-size:17px;font-weight:700;">确认报销单内容</div>
                  <div style="font-size:12px;color:#6b7280;margin-top:2px;">预览即最终报销单内容；点击日期行或金额格直接修改对应票据。超范围票据处理完才能生成。</div>
                </div>
                <button id="erc_close_x" title="关闭" style="width:28px;height:28px;border:none;border-radius:50%;background:#f3f4f6;color:#db2777;font-size:14px;cursor:pointer;">●</button>
              </div>
              <div id="erc_banner"></div>
              <div style="display:flex;align-items:center;gap:9px;flex-wrap:wrap;padding:9px 20px;background:#fafbff;border-bottom:1px solid #eef0f4;font-size:12px;">
                <span style="font-weight:600;color:#374151;">🧳 出差范围</span>
                <input id="erc_start" type="hidden">
                <input id="erc_end" type="hidden">
                <div id="erc_range_host" style="width:300px;flex:none;"></div>
                <span id="erc_meta" style="color:#6b7280;"></span>
                <div class="erc-view-switch" style="margin-left:auto;display:flex;gap:4px;">
                  <button type="button" data-view="split" class="on">分栏</button>
                  <button type="button" data-view="preview">预览</button>
                  <button type="button" data-view="tickets">票据</button>
                </div>
              </div>
              <div class="erc-body">
                <div class="erc-canvas">
                  <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;font-size:12px;font-weight:600;color:#374151;">
                    <span>📄 报销单预览（实时）<span style="font-weight:400;color:#9ca3af;"> · 点击日期行 / 金额格编辑</span></span>
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
                <aside class="erc-side">
                  <div class="erc-side-head">
                    <div class="erc-side-tabs">
                      <button type="button" data-tab="issues" class="on">待处理 <span id="erc_issue_count">0</span></button>
                      <button type="button" data-tab="all">全部票据 <span id="erc_all_count">0</span></button>
                      <button type="button" id="erc_manual_new" class="erc-manual-new" title="手上是实体票、没有上传文件时，在这里补录一张">＋ 手动补录</button>
                    </div>
                    <div class="erc-legend" id="erc_legend"></div>
                    <div class="erc-note">行程单仅作分组依据，不计入报销金额。</div>
                  </div>
                  <div class="erc-eject-hint">🗑 松开鼠标：把这些票据移出报销单</div>
                  <div id="erc_side_list" class="erc-side-list"></div>
                </aside>
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
          const dialog = $('erc_dialog');
          const banner = $('erc_banner'), preview = $('erc_preview'), viewport = $('erc_viewport');
          const canvas = dialog.querySelector('.erc-canvas');
          const sideList = $('erc_side_list');
          const startInput = $('erc_start'), endInput = $('erc_end'), meta = $('erc_meta');
          const stats = $('erc_stats'), keep = $('erc_keep'), confirmBtn = $('erc_confirm');
          const cancelBtn = $('erc_cancel'), closeX = $('erc_close_x'), zoomBtn = $('erc_zoom');
          const scaleIn = $('erc_scale_in'), scaleOut = $('erc_scale_out'), scaleVal = $('erc_scale_val');
          // 颜色图例：由 CAT_STYLE 驱动，与卡片标题带、预览 chip 始终同源。
          const legend = $('erc_legend');
          if (legend) {
            const shortLabel = { ticket: '普票', taxi: '打的', transportOther: '车船', lodging: '住宿', refund: '退票' };
            legend.innerHTML = (api.SELECTABLE_CATS || ['ticket', 'taxi', 'transportOther', 'lodging', 'refund'])
              .map(k => {
                const s = api.CAT_STYLE[k];
                if (!s) return '';
                return `<span title="${esc(api.COL_LABEL[k] || k)}"><i style="background:${s.color};">${s.icon}</i>${esc(shortLabel[k] || api.COL_LABEL[k] || k)}</span>`;
              }).join('');
          }
          const pop = document.createElement('div');
          pop.className = 'erc-pop';
          pop.style.display = 'none';
          canvas.appendChild(pop);
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

          // 拖拽/「移入」时改费用列。混合票例外：它的金额本来就该分两列，
          // 拖到某个格子通常只是想改归行日期，强行指定单一费用列会把另一笔钱
          // 静默并进来（200 住宿 + 50 交通 变成 250 住宿）。要强制并成一列，
          // 用户可以在「填入位置」下拉里明确选择。
          function applyCategory(idx, cat) {
            const inv = draft[idx];
            if (!inv) return;
            if (!cat) { delete inv.__reportCategory; return; }
            if (Array.isArray(inv.splits) && inv.splits.length > 1) return;
            inv.__reportCategory = cat;
          }

          function syncTripRangeToCard() {
            const s = document.getElementById('__er_trip_start');
            const e = document.getElementById('__er_trip_end');
            if (s) s.value = cfg.startDate || '';
            if (e) e.value = cfg.endDate || '';
            if (typeof setTripExpenseConfig === 'function') {
              setTripExpenseConfig({ startDate: cfg.startDate, endDate: cfg.endDate });
            }
            // 卡片上的日期区间控件同步新值（弹窗里改出差范围时即时反映）
            if (typeof window.__erTripRangeRefresh === 'function') window.__erTripRangeRefresh();
          }

          // ---- 「待处理」口径 ----
          // 只列真要人看一眼的票，按严重程度排序。三类：
          //   out    归行日期超出出差范围 —— 不改就不能生成（硬阻塞）
          //   amount 金额存疑（两个来源对不上 / 票面没印价税合计）—— 错一位直接影响合计
          //   split  混合票已按票面明细拆到两列 —— 拆得对不对需要过一眼
          // 已移出表格的票不算待处理：那是用户主动移出的结论，不是待办。
          const PENDING_KINDS = {
            out: { level: 3, label: '超范围' },
            amount: { level: 2, label: '金额待核' },
            split: { level: 1, label: '拆分待确认' }
          };
          const PENDING_ORDER = ['out', 'amount', 'split'];

          function pendingKindsOf(idx, analysis, badSet) {
            const inv = draft[idx];
            if (!inv) return [];
            // 判定规则放在表格模块（utils.pendingKinds），Node 里可直接回归
            if (api.utils && api.utils.pendingKinds) return api.utils.pendingKinds(inv, badSet.has(idx));
            if (inv.isTrip || inv.__reportExcluded) return [];
            const kinds = [];
            if (badSet.has(idx)) kinds.push('out');
            if (inv.amountAlt != null || inv.amountSource === 'guess' || inv.amountSource === 'yen') kinds.push('amount');
            if (Array.isArray(inv.splits) && inv.splits.length > 1 && !inv.__reportCategory) kinds.push('split');
            return kinds;
          }

          // 逐票展开成 { index, kinds, level }，按严重程度降序；同级保持原始顺序，避免列表跳动。
          function pendingSummary(analysis) {
            const badSet = new Set(((analysis && analysis.issues) || []).map(x => x.index));
            const items = [];
            draft.forEach((inv, i) => {
              const kinds = pendingKindsOf(i, analysis, badSet);
              if (!kinds.length) return;
              let level = 0;
              kinds.forEach(k => { level = Math.max(level, PENDING_KINDS[k].level); });
              items.push({ index: i, kinds: kinds, level: level });
            });
            items.sort((a, b) => b.level - a.level || a.index - b.index);
            return items;
          }

          // 顶部小结：告诉用户「一共几笔、分别是哪种」，而不是只丢一堆卡片让他自己找。
          function pendingStripHTML(summary) {
            if (!summary.length) return '';
            const tally = {};
            summary.forEach(x => x.kinds.forEach(k => { tally[k] = (tally[k] || 0) + 1; }));
            const tags = PENDING_ORDER.filter(k => tally[k]).map(k => {
              const m = PENDING_KINDS[k];
              return `<span class="erc-pend-tag erc-pend-${k}">${m.label} <b>${tally[k]}</b></span>`;
            }).join('');
            return `<div class="erc-pend-strip">
              <span>待处理 <b style="color:#111827;">${summary.length}</b> 张</span>${tags}
              <span class="erc-muted" style="margin-left:auto;font-weight:400;">改好会自动移出这里</span>
            </div>`;
          }

          function renderSide() {
            const summary = pendingSummary(currentAnalysis);
            const pendingSet = new Set(summary.map(x => x.index));
            // 默认落在「待处理」；一张待处理都没有时回「全部票据」——空列表没有信息量。
            // 用户手动切过标签就不再抢他的选择，除非待处理已经清零。
            if (!summary.length) sideTab = 'all';
            else if (!sideTabPinned) sideTab = 'issues';
            const allCount = $('erc_all_count');
            if (allCount) allCount.textContent = String(draft.length);
            const countEl = $('erc_issue_count');
            if (countEl) countEl.textContent = String(summary.length);
            dialog.querySelectorAll('.erc-side-tabs button[data-tab]').forEach(btn => {
              btn.classList.toggle('on', btn.dataset.tab === sideTab);
            });
            const badSet = new Set(currentIssues.map(x => x.index));
            const groups = (currentAnalysis.model.groups || []);
            if (sideTab === 'issues') {
              const levelOf = new Map(summary.map(x => [x.index, x.level]));
              const groupLevel = (g) => g.invoiceIndices.reduce((m, i) => Math.max(m, levelOf.get(i) || 0), 0);
              // 严重程度高的卡排前面：先解决「不改不能生成」的，再看金额待核。
              const badGroups = groups
                .filter(g => g.invoiceIndices.some(i => pendingSet.has(i)))
                .sort((a, b) => groupLevel(b) - groupLevel(a));
              if (!badGroups.length) {
                sideList.innerHTML = manualFormHTML() + `<div class="erc-issue" style="border-color:#bbf7d0;background:#f0fdf4;">
                  <div style="font-size:12px;color:#166534;font-weight:700;">没有待处理票据</div>
                  <div class="erc-muted" style="margin-top:6px;">所有票据日期都在出差范围内、金额无存疑。切到「全部票据」可逐张复核。</div>
                </div>`;
                return;
              }
              sideList.innerHTML = manualFormHTML() + pendingStripHTML(summary) + `<div class="erc-card-grid">` +
                badGroups.map(g => groupCardHTML(g, currentAnalysis, badSet)).join('') + `</div>`;
              syncRowHighlight();
              return;
            }
            sideList.innerHTML = manualFormHTML() + `<div class="erc-card-grid">` +
              groups.map(g => groupCardHTML(g, currentAnalysis, badSet)).join('') + `</div>`;
            syncRowHighlight();
          }

          // 预览单元格 <-> 右侧表格行联动：点一个格子，表格里构成它的票据行高亮。
          function syncRowHighlight() {
            sideList.querySelectorAll('.is-selected').forEach(el => el.classList.remove('is-selected'));
            if (!activeCell || !activeCell.rowKey || !currentAnalysis) return;
            const model = currentAnalysis.model;
            const sources = activeCell.cat
              ? (model.cellSources[activeCell.rowKey + '|' + activeCell.cat] || [])
              : (model.rowSources[activeCell.rowKey] || []);
            const seen = new Set();
            sources.forEach(s => {
              if (seen.has(s.index)) return;
              seen.add(s.index);
              const card = sideList.querySelector('.erc-inv-row[data-idx="' + s.index + '"]');
              if (card) {
                card.classList.add('is-selected');
                const group = card.closest('.erc-group-card');
                if (group) group.classList.add('is-selected');
              }
            });
          }

          function findActiveAnchor() {
            if (!activeCell) return null;
            return Array.from(preview.querySelectorAll('td.erc-cell-hot')).find(td =>
              td.dataset.rowKey === activeCell.rowKey &&
              (activeCell.cat ? td.dataset.cat === activeCell.cat : !td.dataset.cat)) || null;
          }

          function positionPopover() {
            preview.querySelectorAll('.erc-cell-active').forEach(td => td.classList.remove('erc-cell-active'));
            if (!activeCell) { pop.style.display = 'none'; return; }
            const anchor = findActiveAnchor();
            if (!anchor) { pop.style.display = 'none'; return; }
            anchor.classList.add('erc-cell-active');
            pop.style.display = 'block';
            const a = anchor.getBoundingClientRect();
            const c = canvas.getBoundingClientRect();
            let left = a.right - c.left + 10;
            if (left + pop.offsetWidth > c.clientWidth - 8) left = a.left - c.left - pop.offsetWidth - 10;
            left = Math.max(8, left);
            const top = Math.max(8, Math.min(a.top - c.top, canvas.clientHeight - pop.offsetHeight - 8));
            pop.style.left = left + 'px';
            pop.style.top = top + 'px';
          }

          function popSourceRowsHTML(sources) {
            return sources.map(s => {
              const inv = draft[s.index];
              if (!inv) return '';
              const by = Array.isArray(s.by) ? s.by.join('、') : (s.by || '');
              const invCents = Math.round((parseFloat(inv.amount) || 0) * 100);
              // 只有「分摊额 ≠ 票面额」时才值得再写一个数；相等时它和下面的金额输入框是同一个数字。
              const splitDiff = s.cents !== invCents;
              return `<div class="erc-pop-row">
                <div style="display:flex;justify-content:space-between;gap:8px;">
                  <b style="word-break:break-all;">${esc(inv.projectName || inv.itemName || s.fileName || '电子发票')}</b>
                  ${splitDiff ? `<span class="erc-muted" style="white-space:nowrap;">分摊 ${yuan(s.cents)}</span>` : ''}
                </div>
                ${by ? `<div class="erc-muted">${esc(by)}</div>` : ''}
                <div class="erc-field-row">
                  <div class="erc-field"><span>金额</span>
                    <input class="erc-input erc-amount" data-idx="${s.index}" type="number" step="0.01" min="0" value="${(parseFloat(inv.amount) || 0).toFixed(2)}" ${inv.isTrip ? 'disabled' : ''}></div>
                  <div class="erc-field"><span>填入位置</span>${catSelectHTML(inv, s.index)}</div>
                </div>
                <div class="erc-field"><span style="font-size:10px;color:#9ca3af;">归行日期</span>
                  <input class="erc-input erc-date" data-idx="${s.index}" type="date" value="${dateForRow(inv, s.index, currentAnalysis)}"></div>
                <button type="button" class="erc-eject-btn" data-eject-idx="${s.index}" title="从报销单移出（金额不再计入，票据留在右侧可拖回）">🗑 从报销单移出</button>
              </div>`;
            }).join('');
          }

          function renderPopover() {
            if (!activeCell || !activeCell.rowKey) { pop.style.display = 'none'; return; }
            const { rowKey, cat } = activeCell;
            const model = currentAnalysis.model;
            const rawSources = cat
              ? (model.cellSources[rowKey + '|' + cat] || [])
              : (model.rowSources[rowKey] || []);
            // 同一张票若被拆到同一格多次，只显示一行，金额合并展示。
            const grouped = new Map();
            rawSources.forEach(s => {
              const g = grouped.get(s.index) || { index: s.index, cents: 0, by: [], fileName: s.fileName };
              g.cents += s.cents;
              if (s.by && g.by.indexOf(s.by) === -1) g.by.push(s.by);
              grouped.set(s.index, g);
            });
            const sources = Array.from(grouped.values());
            let body = '';
            if (cat === 'allowance' && rowKey !== '__out__') {
              body = `<div class="erc-muted" style="margin-bottom:8px;">补贴按出差天数自动计算（${cfg.dailyAllowance} 元/天），不按单张票据修改。</div>` +
                popSourceRowsHTML(sources);
            } else if (!sources.length) {
              const used = new Set(rawSources.map(s => s.index));
              const candidates = draft.map((inv, i) => ({ inv, i }))
                .filter(x => !x.inv.isTrip && !used.has(x.i))
                .slice(0, 10);
              body = '<div class="erc-muted" style="margin-bottom:8px;">当前格子没有票据，可把一张票移进来：</div>' +
                (candidates.length ? candidates.map(({ inv, i }) =>
                  `<div class="erc-pop-row" style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
                    <div style="min-width:0;"><div style="word-break:break-all;">${esc(inv.projectName || inv.itemName || inv.fileName || '电子发票')}</div>
                      <div class="erc-muted">${yuan(Math.round((parseFloat(inv.amount) || 0) * 100))}</div></div>
                    <button type="button" data-move-idx="${i}" data-move-cat="${esc(cat || api.utils.categorize(inv, cfg))}" data-move-date="${esc(rowKey === '__out__' ? '' : rowKey)}">移入</button>
                  </div>`).join('')
                  : '<div class="erc-muted">没有可移动的票据。</div>') +
                // 实体票没上传时，从这一格直接补录：日期和费用列都已经带好，只填金额
                `<div class="erc-pop-row" style="margin-top:8px;border-top:1px dashed #eef0f4;padding-top:8px;">
                  <button type="button" data-manual-here data-cat="${esc(cat || '')}" data-date="${esc(rowKey === '__out__' ? '' : rowKey)}">＋ 补录一张纸质票到这一格</button>
                </div>`;
            } else {
              body = popSourceRowsHTML(sources);
            }
            pop.innerHTML = `<div class="erc-pop-head"><span>${esc(cellTitle(rowKey, cat))}</span>
                <button type="button" data-pop-close title="关闭">×</button></div>
              ${body}
              <div class="erc-pop-actions">
                <button type="button" data-pop-open-list>在票据列表中打开</button>
                <button type="button" data-pop-close>完成</button>
              </div>`;
            positionPopover();
          }

          function openCell(rowKey, cat) {
            if (!rowKey) return;
            activeCell = { rowKey, cat: cat || null };
            renderPopover();
            syncRowHighlight();
            const first = sideList.querySelector('.erc-group-card.is-selected');
            if (first && sideTab === 'all') first.scrollIntoView({ block: 'nearest' });
          }

          function closePopover() {
            activeCell = null;
            pop.style.display = 'none';
            preview.querySelectorAll('.erc-cell-active').forEach(td => td.classList.remove('erc-cell-active'));
            sideList.querySelectorAll('.is-selected').forEach(el => el.classList.remove('is-selected'));
          }

          function locateFirstIssue() {
            if (!currentIssues.length) return;
            const issue = currentIssues[0];
            sideTab = 'issues';
            sideTabPinned = true;
            renderSide();
            const card = sideList.querySelector('.erc-inv-row[data-idx="' + issue.index + '"]');
            if (card) card.scrollIntoView({ block: 'center' });
            openCell('__out__', issue.category);
          }

          function setViewMode(mode) {
            dialog.classList.remove('erc-v-preview', 'erc-v-tickets');
            if (mode !== 'split') dialog.classList.add('erc-v-' + mode);
            dialog.querySelectorAll('.erc-view-switch button').forEach(btn => {
              btn.classList.toggle('on', btn.dataset.view === mode);
            });
            requestAnimationFrame(() => { fitPreview(); positionPopover(); });
          }

          function refresh(options) {
            // 手动补录的改动（金额/日期/费用列/移出）先回写到持久列表，
            // 这样哪怕直接取消弹窗，补录的票也不会丢。
            syncManualReceipts();
            const analysis = api.analyzeExpenseReport(draft, cfg);
            currentAnalysis = analysis;
            currentIssues = analysis.issues;
            preview.innerHTML = generateExpenseReportHTML(draft, null, cfg, { preview: true });
            fitPreview();
            if (!(options && options.skipSide)) renderSide();
            else {
              // 输入过程中不重绘侧栏（避免抢焦点），但「待处理」的笔数要跟着走：
              // 用户在金额框里改一个数，这张票可能立刻就不再是待处理了。
              const countEl = $('erc_issue_count');
              if (countEl) countEl.textContent = String(pendingSummary(analysis).length);
            }
            if (activeCell) renderPopover();

            const rangeTxt = cnDay(analysis.start) + ' ~ ' + cnDay(analysis.end);
            if (currentIssues.length) {
              const dates = Array.from(new Set(currentIssues.map(x => x.dates[0]).filter(Boolean))).join('、');
              banner.style.cssText = 'display:flex;align-items:center;gap:12px;padding:10px 20px;background:#fef2f2;border-bottom:1px solid #fecaca;color:#991b1b;font-size:12px;line-height:1.6;';
              banner.innerHTML = `<div style="flex:1;">⚠ 检测到 <b>${currentIssues.length}</b> 笔票据日期超出出差范围（${esc(rangeTxt)}）：<b>${esc(dates)}</b>。点击预览中的超范围行或右侧待处理卡片，选择正确出差日期；全部修正后才能生成报销单。</div>
                <button id="erc_locate" style="white-space:nowrap;padding:5px 11px;border:1px solid #fca5a5;border-radius:6px;background:#fff;color:#b91c1c;font-size:11px;cursor:pointer;">定位第 1 笔</button>`;
            } else {
              banner.style.cssText = 'padding:10px 20px;background:#f0fdf4;border-bottom:1px solid #bbf7d0;color:#166534;font-size:12px;line-height:1.6;';
              banner.innerHTML = `✓ 已核对：所有票据日期均落在出差范围（${esc(rangeTxt)}）内，预览无「超范围」行。确认内容无误后点击「确认生成」。`;
            }

            const invoiceCount = draft.filter(x => !x.isTrip).length;
            const tripCount = draft.length - invoiceCount;
            const manualCount = draft.filter(x => x.__manual).length;
            meta.textContent = `出差人：${cfg.traveler || '未填'} · ${cfg.location || '地点未填'} · ${cfg.reason || '原因未填'} · 补贴 ${cfg.dailyAllowance} 元/天`;
            stats.textContent = `共 ${draft.length} 项（${invoiceCount} 张发票 / ${tripCount} 张行程单）` +
              (manualCount ? `，其中手动补录 ${manualCount} 张` : '') +
              ` · 预览合计 ¥${(analysis.model.grandTotal / 100).toFixed(2)} · 待处理 ${pendingSummary(analysis).length} 笔` +
              (currentIssues.length ? `（其中超范围 ${currentIssues.length}）` : '');

            const blocked = currentIssues.length > 0 && !keep.checked;
            confirmBtn.disabled = blocked;
            confirmBtn.style.opacity = blocked ? '0.55' : '1';
            confirmBtn.style.cursor = blocked ? 'not-allowed' : 'pointer';
            confirmBtn.textContent = blocked
              ? `请先修正 ${currentIssues.length} 笔超范围票据`
              : (currentIssues.length ? `仍要生成（含 ${currentIssues.length} 笔超范围）` : '确认生成');
            // 首帧布局稳定后再贴合一次，避免初次缩放比例偏差
            requestAnimationFrame(() => { fitPreview(); positionPopover(); });
          }

          function onFieldChange(e) {
            const t = e.target;
            if (!t || t.dataset.idx === undefined) return;
            const idx = parseInt(t.dataset.idx, 10);
            if (isNaN(idx) || !draft[idx]) return;
            if (t.classList.contains('erc-name')) {
              draft[idx].projectName = t.value; draft[idx].itemName = t.value;
            } else if (t.classList.contains('erc-amount')) {
              // 负数金额会直接把合计算成负数（红字发票不在本工具报销口径内），一律归零；
              // 输入框同时带 min="0"，浏览器上下箭头也走不到负值。
              // 只在真的填了负数时才回写输入框，否则别动用户正在敲的字（会跳光标）。
              const v = parseFloat(t.value);
              draft[idx].amount = isNaN(v) ? 0 : Math.max(0, v);
              if (!isNaN(v) && v < 0) {
                console.warn('⚠️ 金额不能为负，已按 0 处理：', t.value);
                t.value = '0.00';
              }
              // 用户亲手确认过金额，两种「金额存疑」提示到此为止（并记住，下次生成不再叨叨）
              delete draft[idx].amountAlt; delete draft[idx].amountAltFrom;
              draft[idx].amountSource = 'manual';
              draft[idx].__amountConfirmed = true;
            } else if (t.classList.contains('erc-cat')) {
              // 手动选择发票填入的费用列（普票费/打的费/其他/住宿/退票费）
              if (t.value) draft[idx].__reportCategory = t.value;
              else delete draft[idx].__reportCategory;
            } else if (t.classList.contains('erc-date')) {
              applyDate(idx, t.value);
            } else if (t.classList.contains('erc-quick') && t.value) {
              applyDate(idx, t.value);
              const root = t.closest('.erc-pop, .erc-side') || sideList;
              root.querySelectorAll('.erc-date[data-idx="' + idx + '"]').forEach(di => { di.value = t.value; });
            }
            // 输入过程中不重绘抽屉，避免抢焦点；change 事件时再整体刷新。
            refresh({ skipSide: e.type === 'input' && sideList.contains(t) });
          }

          function onResize() { fitPreview(); positionPopover(); }

          function finish(ok) {
            if (settled) return;
            settled = true;
            if (window.__ercRangeInst) { try { window.__ercRangeInst.destroy(); } catch (e) {} window.__ercRangeInst = null; }
            document.removeEventListener('keydown', onKey);
            document.removeEventListener('dragend', endDragVisuals);
            window.removeEventListener('resize', onResize);
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            if (ok) {
              syncTripRangeToCard();
              saveExpenseReportOverrides(draft);
              resolve(draft);
            } else {
              resolve(false);
            }
          }

          function onKey(e) {
            if (e.key !== 'Escape') return;
            if (pop.style.display !== 'none') { closePopover(); return; }
            finish(false);
          }

          // ----------------------------------------------------------------
          // 拖拽：三个方向，底层都是改 draft 的 __reportDate / __reportCategory /
          // __reportExcluded（与编辑面板同源）：
          //   1) 右侧行程卡片 / 单张发票 -> 左侧格子：填入/改归行（含已移出票据拖回）
          //   2) 预览里已填入的 chip -> 另一个格子：改归行
          //   3) 预览 chip / 卡片 -> 右侧票据区：移出报销单（不计合计，仍留卡片可拖回）
          // ----------------------------------------------------------------
          let dragPayload = null;

          function payloadFromCard(card) {
            if (!card) return null;
            const invRow = card.closest('.erc-inv-row') || (card.classList.contains('erc-inv-row') ? card : null);
            if (invRow) return { type: 'invoice', indices: [parseInt(invRow.dataset.idx, 10)] };
            const group = card.closest('.erc-group-card') || (card.classList.contains('erc-group-card') ? card : null);
            if (group) {
              const g = (currentAnalysis.model.groups || []).find(x => x.key === group.dataset.groupKey);
              if (g) return { type: 'group', key: g.key, indices: g.invoiceIndices.slice() };
            }
            return null;
          }

          function beginDrag(e, payload, sourceEl) {
            dragPayload = payload;
            if (!dragPayload || !dragPayload.indices.length) { dragPayload = null; e.preventDefault(); return false; }
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', JSON.stringify(dragPayload));
            if (sourceEl) sourceEl.classList.add('is-dragging');
            return true;
          }

          function endDragVisuals() {
            dragPayload = null;
            sideList.querySelectorAll('.is-dragging').forEach(el => el.classList.remove('is-dragging'));
            preview.querySelectorAll('.erc-chip-drop, .erc-chip.is-dragging').forEach(el => {
              el.classList.remove('erc-chip-drop'); el.classList.remove('is-dragging');
            });
            dialog.querySelector('.erc-side').classList.remove('is-eject-target');
          }

          // 源 1：右侧卡片 / 发票行
          sideList.addEventListener('dragstart', (e) => {
            const handle = e.target.closest('.erc-drag-handle');
            const card = e.target.closest('.erc-group-card, .erc-inv-row');
            if (!card) return;
            // 发票行里的输入框/下拉不是拖拽把手，避免拖歪文字选择。
            if (e.target.closest('input, select, button') && !handle) { e.preventDefault(); return; }
            beginDrag(e, payloadFromCard(handle ? handle.closest('.erc-group-card') : card),
              card.closest('.erc-group-card') || card);
          });

          // 源 2：预览里已填入的 chip —— 可拖到别的格子改归行，或拖到右侧移出。
          preview.addEventListener('dragstart', (e) => {
            const chip = e.target.closest('.erc-chip');
            if (!chip) return;
            const idx = parseInt(chip.dataset.chipIdx, 10);
            if (isNaN(idx) || !draft[idx] || draft[idx].isTrip) { e.preventDefault(); return; }
            beginDrag(e, { type: 'chip', indices: [idx] }, chip);
          });

          // dragend 可能落在 preview / sideList / 文档任意处，统一挂 document 清理。
          // 必须记名并在 finish() 里摘掉：闭包持有整个弹窗 DOM 与 draft，
          // 只加不删的话每开一次弹窗就多一个监听器、多留一整套 DOM 不放。
          document.addEventListener('dragend', endDragVisuals);

          preview.addEventListener('dragover', (e) => {
            const td = e.target.closest('td.erc-cell-hot');
            if (!td || td.dataset.cat === 'allowance' || !dragPayload) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            preview.querySelectorAll('.erc-chip-drop').forEach(el => el.classList.remove('erc-chip-drop'));
            td.classList.add('erc-chip-drop');
          });
          preview.addEventListener('dragleave', (e) => {
            const td = e.target.closest('td.erc-cell-hot');
            if (td && !td.contains(e.relatedTarget)) td.classList.remove('erc-chip-drop');
          });
          preview.addEventListener('drop', (e) => {
            const td = e.target.closest('td.erc-cell-hot');
            preview.querySelectorAll('.erc-chip-drop').forEach(el => el.classList.remove('erc-chip-drop'));
            if (!td || !dragPayload) return;
            e.preventDefault();
            const rowKey = td.dataset.rowKey;
            const cat = td.dataset.cat || null;
            if (cat === 'allowance') return; // 补贴按天数自动算，不接受发票拖入
            const date = rowKey === '__out__' ? '' : rowKey;
            let moved = 0;
            dragPayload.indices.forEach(idx => {
              const inv = draft[idx];
              if (!inv || inv.isTrip) return; // 行程单不计费，不能作为发票拖入
              delete inv.__reportExcluded; // 拖回表格：清除「已移出」标记，重新计入
              if (cat) applyCategory(idx, cat);
              if (date) applyDate(idx, date);
              else { delete inv.__reportDate; applyDate(idx, ''); }
              moved += 1;
            });
            dragPayload = null;
            if (moved) {
              activeCell = { rowKey, cat: cat || null };
              refresh();
              openCell(rowKey, cat);
            }
          });

          // 目标 B：右侧票据区 —— 把 chip / 卡片拖到这里即从报销单移出。
          const sideEl = dialog.querySelector('.erc-side');
          sideEl.addEventListener('dragover', (e) => {
            if (!dragPayload) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            sideEl.classList.add('is-eject-target');
          });
          sideEl.addEventListener('dragleave', (e) => {
            if (!sideEl.contains(e.relatedTarget)) sideEl.classList.remove('is-eject-target');
          });
          sideEl.addEventListener('drop', (e) => {
            sideEl.classList.remove('is-eject-target');
            if (!dragPayload) return;
            e.preventDefault();
            let ejected = 0;
            dragPayload.indices.forEach(idx => {
              const inv = draft[idx];
              if (!inv || inv.isTrip) return;
              inv.__reportExcluded = true;
              ejected += 1;
            });
            dragPayload = null;
            if (ejected) {
              sideTab = 'all';
              sideTabPinned = true;
              closePopover();
              refresh();
            }
          });

          preview.addEventListener('click', (e) => {
            // 点 chip 时，除弹出格子的编辑面板外，额外高亮对应发票卡。
            const chip = e.target.closest('.erc-chip');
            if (chip && sideTab === 'all') {
              const idx = parseInt(chip.dataset.chipIdx, 10);
              const row = sideList.querySelector('.erc-inv-row[data-idx="' + idx + '"]');
              if (row) row.scrollIntoView({ block: 'nearest' });
            }
            const td = e.target.closest('td.erc-cell-hot');
            if (td) openCell(td.dataset.rowKey, td.dataset.cat || null);
          });
          canvas.addEventListener('click', (e) => {
            if (!e.target.closest('td.erc-cell-hot') && !e.target.closest('.erc-pop')) closePopover();
          });
          pop.addEventListener('change', onFieldChange);
          pop.addEventListener('click', (e) => {
            if (e.target.closest('[data-pop-close]')) { closePopover(); return; }
            const moveBtn = e.target.closest('[data-move-idx]');
            if (moveBtn) {
              const idx = parseInt(moveBtn.dataset.moveIdx, 10);
              if (!isNaN(idx) && draft[idx]) {
                delete draft[idx].__reportExcluded; // 移入即重新计入
                if (moveBtn.dataset.moveCat) applyCategory(idx, moveBtn.dataset.moveCat);
                applyDate(idx, moveBtn.dataset.moveDate);
                refresh();
              }
              return;
            }
            const ejectBtn = e.target.closest('[data-eject-idx]');
            if (ejectBtn) {
              const idx = parseInt(ejectBtn.dataset.ejectIdx, 10);
              if (!isNaN(idx) && draft[idx] && !draft[idx].isTrip) {
                draft[idx].__reportExcluded = true;
                closePopover();
                refresh();
              }
              return;
            }
            const manualHere = e.target.closest('[data-manual-here]');
            if (manualHere) {
              // 从空格子补录：日期/费用列已经带好，用户只需填金额
              closePopover();
              openManualForm({ cat: manualHere.dataset.cat, date: manualHere.dataset.date });
              return;
            }
            if (e.target.closest('[data-pop-open-list]')) {
              sideTab = 'all';
              sideTabPinned = true;
              renderSide();
              const idx = activeCell ? (currentAnalysis.model.rowSources[activeCell.rowKey] || [])[0] : null;
              if (idx) {
                const card = sideList.querySelector('.erc-inv-row[data-idx="' + idx.index + '"]');
                if (card) { card.scrollIntoView({ block: 'center' }); const input = card.querySelector('.erc-name'); if (input) input.focus(); }
              }
            }
          });
          sideList.addEventListener('input', onFieldChange);
          sideList.addEventListener('change', onFieldChange);

          // ---- 手动补录表单的事件 ----
          // 表单值写回 manualForm（而不是只留在 DOM）：refresh() 会重绘侧栏，
          // 只读 DOM 的话用户敲一半的字会被下一次重绘清空。
          sideList.addEventListener('input', (e) => {
            const el = e.target.closest('[data-manual-field]');
            if (!el || !manualForm) return;
            manualForm[el.dataset.manualField] = el.value;
            if (el.dataset.manualField === 'amount') {
              el.style.borderColor = '';
              el.style.background = '';
            }
          });
          sideList.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            if (!e.target.closest('.erc-manual-form')) return;
            e.preventDefault();
            addManualReceipt();
          });
          sideList.addEventListener('click', (e) => {
            if (e.target.closest('[data-manual-add]')) { addManualReceipt(); return; }
            if (e.target.closest('[data-manual-cancel]')) { manualForm = null; renderSide(); return; }
            const del = e.target.closest('[data-manual-del]');
            if (del) {
              const idx = parseInt(del.dataset.manualDel, 10);
              if (!isNaN(idx) && draft[idx] && draft[idx].__manual) {
                // 彻底删掉这条手动记录（不是「移出」），下次生成也不会再出现
                draft.splice(idx, 1);
                closePopover();
                refresh();
              }
            }
          });
          const manualNewBtn = $('erc_manual_new');
          if (manualNewBtn) manualNewBtn.addEventListener('click', () => openManualForm(null));
          dialog.querySelectorAll('.erc-side-tabs button[data-tab]').forEach(btn => {
            btn.addEventListener('click', () => { sideTab = btn.dataset.tab; sideTabPinned = true; renderSide(); });
          });
          dialog.querySelectorAll('.erc-view-switch button').forEach(btn => {
            btn.addEventListener('click', () => setViewMode(btn.dataset.view));
          });
          banner.addEventListener('click', (e) => {
            if (e.target && e.target.id === 'erc_locate') locateFirstIssue();
          });
          startInput.addEventListener('change', () => { cfg.startDate = startInput.value; syncTripRangeToCard(); refresh(); });
          endInput.addEventListener('change', () => { cfg.endDate = endInput.value; syncTripRangeToCard(); refresh(); });
          keep.addEventListener('change', refresh);
          cancelBtn.addEventListener('click', () => finish(false));
          closeX.addEventListener('click', () => finish(false));
          overlay.addEventListener('click', (e) => { if (e.target === overlay) finish(false); });
          document.addEventListener('keydown', onKey);
          window.addEventListener('resize', onResize);
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
          // 弹窗顶部的出差范围也用区间控件：一次点开选完起止，值仍写回 erc_start / erc_end
          const rangeHost2 = document.getElementById('erc_range_host');
          if (rangeHost2 && window.TripDateRange) {
            // onChange 不必接：改动会派发 change 到 erc_start / erc_end，
            // 那两个监听器负责把值同步回卡片（syncTripRangeToCard）。
            window.__ercRangeInst = window.TripDateRange.mount(rangeHost2, {
              startInput: startInput,
              endInput: endInput,
              expose: false
            });
          }
          setViewMode(window.innerWidth <= 900 ? 'preview' : 'split');
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

      // 直接打印当前已生成的报销单 PDF：走隐藏 iframe，避免用户滚回页面顶部点「打印」。
      // 注意不能复用顶部按钮的逻辑——那边的全局 click 拦截会把 blob 换成合并发票那份。
      function printPdfBlob(pdfBlob) {
        const blob = pdfBlob instanceof Blob ? pdfBlob : null;
        if (!blob) return false;

        const url = URL.createObjectURL(blob);
        const frameId = '__er_print_frame';
        const old = document.getElementById(frameId);
        if (old) old.remove();

        const frame = document.createElement('iframe');
        frame.id = frameId;
        frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:none;opacity:0;pointer-events:none;';
        // 只触发一次打印：PDF 查看器内部还可能再触发一次 load。
        let fired = false;
        frame.addEventListener('load', () => {
          if (fired) return;
          fired = true;
          // 等 PDF 查看器渲染完再调 print，否则弹出来是空白页。
          setTimeout(() => {
            try {
              frame.contentWindow.focus();
              frame.contentWindow.print();
            } catch (e) {
              console.warn('⚠️ iframe 打印失败，回退到新窗口打开', e);
              try { window.open(url, '_blank'); } catch (e2) {}
            }
          }, 400);
        });
        document.body.appendChild(frame);
        // #toolbar=0 让查看器别顶一条工具栏，打印区域更干净
        frame.src = url + '#toolbar=0&navpanes=0&statusbar=0&zoom=page-width';

        // 打印对话框可能开很久，blob URL 留足时间再回收
        setTimeout(() => {
          try { frame.remove(); } catch (e) {}
          URL.revokeObjectURL(url);
        }, 10 * 60 * 1000);
        return true;
      }
      window.printPdfBlob = printPdfBlob;

      function printExpenseReport() {
        if (window.__currentExpenseReportBlob) return printPdfBlob(window.__currentExpenseReportBlob);
        showSuccessNotification('⚠️ 还没生成报销单，先点「生成报销单」');
        return false;
      }
      window.printExpenseReport = printExpenseReport;

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
              点一次「生成报销单」即可：先弹出确认窗口，左侧实时预览、右侧核对票据，超范围票据须重选归行日期。生成完成后「打印」「下载」按钮变为可用，无需返回页面顶部。
            </p>
          </div>
          <div class="er-trip-config" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin-bottom:12px;padding:10px 12px;background:#fafbff;border:1px solid #e8ecf7;border-radius:8px;">
            <div style="grid-column:1/-1;font-size:12px;font-weight:600;color:#374151;">🧳 出差信息</div>
            <div style="grid-column:span 2;min-width:0;display:flex;flex-direction:column;gap:3px;">
              <span style="font-size:11px;color:#4b5563;">出差日期</span>
              <input id="__er_trip_start" type="hidden">
              <input id="__er_trip_end" type="hidden">
              <div id="__er_trip_range"></div>
            </div>
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
          <div style="display:flex;flex-direction:column;gap:8px;">
            <button class="er-btn-gen" title="生成前会先弹出确认窗口，确认后才产出 PDF" style="
              width:100%;padding:11px 16px;
              background:#4338ca;color:#fff;border:none;border-radius:8px;
              font-size:14px;font-weight:600;cursor:pointer;
              box-shadow:0 6px 16px rgba(67,56,202,0.22);
              transition:background 0.2s,box-shadow 0.2s,transform 0.2s;">
              📋 生成报销单
            </button>
            <div style="display:flex;gap:8px;align-items:stretch;">
              <button class="er-btn-print" data-er-print="1" disabled title="生成报销单后可打印" style="
                flex:1;min-width:0;padding:10px 12px;background:white;color:#4338ca;
                border:1px solid #c7cbe8;border-radius:8px;font-size:14px;font-weight:600;
                cursor:not-allowed;opacity:0.5;
                transition:background 0.2s,border-color 0.2s,opacity 0.2s;">
                🖨️ 打印
              </button>
              <button class="er-btn-dl" disabled title="生成报销单后可下载" style="
                flex:1;min-width:0;padding:10px 12px;background:white;color:#4338ca;
                border:1px solid #c7cbe8;border-radius:8px;font-size:14px;font-weight:600;
                cursor:not-allowed;opacity:0.5;
                transition:background 0.2s,border-color 0.2s,opacity 0.2s;">
                ⬇️ 下载
              </button>
              <button class="er-btn-del" title="删除已生成的报销单" style="
                flex:none;padding:10px 14px;background:white;color:#ef4444;
                border:1px solid #fca5a5;border-radius:8px;font-size:14px;
                cursor:pointer;transition:background 0.2s;">
                🗑️
              </button>
            </div>
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

        // 出差日期：一个控件选「开始 → 结束」（酒店入住式），值仍写回两个隐藏域，
        // readTripConfigFromUI() 无需改动。
        const rangeHost = card.querySelector('#__er_trip_range');
        if (rangeHost && window.TripDateRange) {
          // 卡片会被整体重建（重新生成 HTML），旧实例的 wrap 已脱离文档，
          // 但它在 document 上挂的 mousedown / keydown 监听还在，闭包也还引用着旧 DOM。
          // 不显式销毁的话，每重建一次就多漏一套。
          if (window.__erCardRangeInst) {
            try { window.__erCardRangeInst.destroy(); } catch (e) {}
            window.__erCardRangeInst = null;
          }
          window.__erCardRangeInst = window.TripDateRange.mount(rangeHost, {
            startInput: card.querySelector('#__er_trip_start'),
            endInput: card.querySelector('#__er_trip_end'),
            onChange: () => readTripConfigFromUI()
          });
        } else if (rangeHost) {
          console.warn('⚠️ trip-date-range.js 未加载，出差日期退化为隐藏域');
        }

        card.querySelectorAll('.er-trip-config input').forEach(el => {
          el.addEventListener('change', () => readTripConfigFromUI());
        });

        const genBtn = card.querySelector('.er-btn-gen');
        const printBtn = card.querySelector('.er-btn-print');
        const dlBtn  = card.querySelector('.er-btn-dl');
        const delBtn = card.querySelector('.er-btn-del');

        // 下载 / 打印按钮只针对「已生成」的那份 PDF，不重新生成一遍
        const syncDownloadBtn = () => {
          const has = !!window.__currentExpenseReportBlob;
          dlBtn.disabled = !has;
          dlBtn.style.opacity = has ? '1' : '0.5';
          dlBtn.style.cursor = has ? 'pointer' : 'not-allowed';
          dlBtn.title = has ? '下载已生成的报销单 PDF' : '生成报销单后可下载';
          if (printBtn) {
            printBtn.disabled = !has;
            printBtn.style.opacity = has ? '1' : '0.5';
            printBtn.style.cursor = has ? 'pointer' : 'not-allowed';
            printBtn.title = has ? '打印已生成的报销单 PDF（不必滚回页面顶部）' : '生成报销单后可打印';
          }
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

        if (printBtn) {
          printBtn.addEventListener('click', () => {
            if (printBtn.disabled) { syncDownloadBtn(); return; }
            const ok = window.printExpenseReport ? window.printExpenseReport() : false;
            if (ok) showSuccessNotification('🖨️ 已调起打印，选择打印机即可');
            syncDownloadBtn();
          });
        }

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
        if (printBtn) {
          printBtn.onmouseenter = () => { if (!printBtn.disabled) printBtn.style.background = '#f5f6fb'; };
          printBtn.onmouseleave = () => { printBtn.style.background = 'white'; };
        }
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
          // 防抖：这个 observer 会在任何 DOM 变动后全量扫一遍 data-slot="card"。
          // 不加防抖的话，日历每重绘一次、输入框每变一次都要重扫；更要紧的是
          // React 提交过程中统计卡片会瞬时消失，一扫描就误判「卡片没了」，
          // 把报销单卡片删掉重建 —— 用户正开着的日期面板会突然关掉。
          let _cardCheckTimer = 0;
          const _cardObserver = new MutationObserver(() => {
            clearTimeout(_cardCheckTimer);
            _cardCheckTimer = setTimeout(() => {
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
            }, 400);
          });
          _cardObserver.observe(document.body, { childList: true, subtree: true });

          setTimeout(() => { _cardObserver.disconnect(); clearTimeout(_cardCheckTimer); }, 90000);
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
