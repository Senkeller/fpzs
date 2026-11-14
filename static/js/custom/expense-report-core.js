(function () {
  window.__invoiceDataCache = window.__invoiceDataCache || {};

  // ------------------------------------------------------------------
  // 差旅报销单：行程单（打车/网约车）识别
  // 行程单不是发票，只用来做两件事：
  //   1) 金额与发票核对（配对成功后不重复计入报销金额）；
  //   2) 提供真实乘车日期，优先于发票的开票日期。
  // ------------------------------------------------------------------
  var TRIP_NAME_RE = /行程单|打车|滴滴|出行|用车|网约车|出租车|高德|曹操|t3|trip|itinerary|ride/i;
  var TRIP_STRICT_NAME_RE = /行程单|itinerary|trip/i;
  var INVOICE_TEXT_RE = /价税合计|发票号码|开票日期|纳税人识别号|增值税|电子发票/;
  var TRIP_TEXT_RE = /行程单|用车时间|上车时间|上车|下车|起步价|里程|实付金额|乘客|服务时间|预约时间|出发时间|行程时间/;

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  function extractTripInfo(fullText, compactText, fileName) {
    var text = compactText || '';
    var nameHit = TRIP_NAME_RE.test(fileName || '');
    var looksInvoice = INVOICE_TEXT_RE.test(text);
    var looksTrip = TRIP_TEXT_RE.test(text);
    // 文本像行程单且没有发票特征，或文件名明确写着行程单且不是发票 → 行程单
    var isTrip = !!((looksTrip && !looksInvoice) ||
      (nameHit && TRIP_STRICT_NAME_RE.test(fileName || '') && !looksInvoice));

    var dates = [];
    var preferred = [];
    var dateRe = /(20\d{2})\s*[年\-/.]\s*(\d{1,2})\s*[月\-/.]\s*(\d{1,2})/g;
    var m;
    while ((m = dateRe.exec(fullText || '')) !== null) {
      var y = parseInt(m[1], 10), mo = parseInt(m[2], 10), d = parseInt(m[3], 10);
      if (y < 2015 || y > 2035 || mo < 1 || mo > 12 || d < 1 || d > 31) continue;
      var iso = y + '-' + pad2(mo) + '-' + pad2(d);
      if (dates.indexOf(iso) === -1) dates.push(iso);
    }
    var prefRe = /(?:用车时间|行程时间|行程起止日期|出发时间|上车时间|服务时间|乘车日期|行程日期|用车日期|订单时间)\s*[:：]?\s*(20\d{2})\s*[年\-/.]\s*(\d{1,2})\s*[月\-/.]\s*(\d{1,2})/g;
    while ((m = prefRe.exec(fullText || '')) !== null) {
      var py = parseInt(m[1], 10), pm = parseInt(m[2], 10), pd = parseInt(m[3], 10);
      if (pm >= 1 && pm <= 12 && pd >= 1 && pd <= 31) {
        var piso = py + '-' + pad2(pm) + '-' + pad2(pd);
        if (preferred.indexOf(piso) === -1) preferred.push(piso);
      }
    }
    dates.sort();
    preferred.sort();

    var amount = null;
    var amtRe = /(?:实付金额|实付|合计金额|合计|支付金额|订单金额|车费|总金额)\s*[:：]?\s*[¥￥]?\s*([\d,]+\.?\d{0,2})/g;
    var candidates = [];
    while ((m = amtRe.exec(fullText || '')) !== null) {
      var v = parseFloat(m[1].replace(/,/g, ''));
      if (v > 0 && v < 100000000) candidates.push(v);
    }
    if (candidates.length > 0) {
      amount = Math.max.apply(null, candidates);
    } else {
      var all = [];
      var anyRe = /[¥￥]?\s*([\d,]+\.\d{2})\s*[¥￥]?/g;
      while ((m = anyRe.exec(fullText || '')) !== null) {
        var v2 = parseFloat(m[1].replace(/,/g, ''));
        if (v2 > 0 && v2 < 100000000) all.push(v2);
      }
      if (all.length > 0) amount = Math.max.apply(null, all);
    }

    return {
      isTrip: isTrip,
      dates: dates,
      preferredDates: preferred,
      primaryDate: preferred[0] || dates[0] || '',
      amount: amount,
      fileName: fileName,
    };
  }

  function initPdfJs() {
    try {
      if (window.pdfjsLib) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
            window.__PDF_WORKER_SRC || 'static/js/pdf.worker.min.mjs';
        return true;
      }
    } catch (e) {

    }
    return false;
  }

  async function waitForPdfJs(maxWait) {
    if (window.pdfjsLib) return true;
    const end = Date.now() + (maxWait || 8000);
    while (Date.now() < end) {
      await new Promise(r => setTimeout(r, 300));
      if (window.pdfjsLib) return true;
    }
    return false;
  }

  async function extractInvoiceDataFromPdf(fileName, file) {
    try {
      await waitForPdfJs(8000);
      if (!initPdfJs()) {
        return { amount: 0, date: new Date(), itemName: '电子发票', fileName,
          isTrip: TRIP_STRICT_NAME_RE.test(fileName || ''), trip: null };
      }
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({
        data: arrayBuffer,

        cMapUrl: 'static/cmaps/',
        cMapPacked: true,
      }).promise;

      let fullText = '';
      const posItems = []; // 第1页带坐标的文本项，用于铁路票站名定位
      for (let i = 1; i <= Math.min(pdf.numPages, 3); i++) {
        const page = await pdf.getPage(i);
        const tc = await page.getTextContent();
        fullText += tc.items.map((it) => it.str).join(' ') + '\n';
        if (i === 1) {
          for (const it of tc.items) {
            if (it.transform && it.str.trim()) {
              posItems.push({ str: it.str.trim(), x: it.transform[4], y: it.transform[5] });
            }
          }
        }
      }
      const compactText = fullText.replace(/\s+/g, '');
      // 连续星号一般是身份证掩码（如 330821****2355），会污染「*项目名称*」匹配
      const cleanText = fullText.replace(/\*{2,}/g, ' ');
      const compactCleanText = cleanText.replace(/\s+/g, '');

      // 价税合计是发票的法定总额。实测部分数电票会把金额排版成「1 0 . 2 4 ¥」，
      // 或把模板文字与数值拆到文本流两端，行级正则会读成不含税金额甚至 0。
      function collectYenAmounts() {
        const out = [];
        const push = (v) => { if (v > 0 && v < 100000000) out.push(v); };
        let mm;
        for (const txt of [fullText, compactCleanText]) {
          const before = /[¥￥]\s*([\d,]+\.\d{2})/g;
          while ((mm = before.exec(txt)) !== null) push(parseFloat(mm[1].replace(/,/g, '')));
          // 负向后视防止把「发票号码 + 单价」连成一个巨额数字
          const after = /(?<![\d.])([\d,]{1,10}\.\d{2})\s*[¥￥]/g;
          while ((mm = after.exec(txt)) !== null) push(parseFloat(mm[1].replace(/,/g, '')));
        }
        // 字符间夹空格的金额：「1 0 . 2 4 ¥」；只接受正常的金额形态
        const spaced = /((?:\d\s*){1,8}\.\s*(?:\d\s*){1,2})\s*[¥￥]/g;
        while ((mm = spaced.exec(fullText)) !== null) {
          const s = mm[1].replace(/[\s,]/g, '');
          if (/^(?:0|[1-9]\d{0,5})\.\d{2}$/.test(s)) push(parseFloat(s));
        }
        return out;
      }

      function authoritativeTotal() {
        let mm;
        // 1) 中文大写金额后紧跟的小写金额（最可靠，不含税/税额都在它前面）
        const upperRe = /[壹贰叁肆伍陆柒捌玖拾佰仟万亿零圆元角分整]{2,}[^\d]{0,16}?[¥￥]?\s*([\d,]+\.\d{2})/g;
        while ((mm = upperRe.exec(compactCleanText)) !== null) {
          const v = parseFloat(mm[1].replace(/,/g, ''));
          if (v > 0 && v < 100000000) return v;
        }
        // 2) 「（小写）9.90」
        const smallRe = /[（(]\s*小\s*写\s*[）)]\s*[¥￥]?\s*([\d,]+\.\d{2})/g;
        while ((mm = smallRe.exec(compactCleanText)) !== null) {
          const v = parseFloat(mm[1].replace(/,/g, ''));
          if (v > 0 && v < 100000000) return v;
        }
        // 3) 兜底：所有带 ¥ 的金额取最大值（价税合计恒大于不含税金额与税额）
        const yen = collectYenAmounts();
        return yen.length ? Math.max.apply(null, yen) : 0;
      }

      let amount = 0;
      const authoritative = /价税合计/.test(compactCleanText) ? authoritativeTotal() : 0;
      const normalizedLines = fullText
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean);
      const compactLines = compactText
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean);

      const amountPatterns = [
        { key: '价税合计', weight: 100, pattern: /价税合计[（(]小写[）)]\s*[¥￥]?\s*([\d,]+\.?\d{0,2})/ },
        { key: '价税合计', weight: 98, pattern: /价税合计\s*[（(]\s*小写\s*[）)]\s*[¥￥]?\s*([\d,]+\.?\d{0,2})/ },
        { key: '价税合计', weight: 96, pattern: /价税合计\s*[：:]?\s*[¥￥]\s*([\d,]+\.?\d{0,2})/ },
        { key: '价税合计', weight: 92, pattern: /价\s*税\s*合\s*计[^¥￥\d]*([\d,]+\.?\d{0,2})\s*[¥￥]/ },
        { key: '价税合计', weight: 90, pattern: /价\s*税\s*合\s*计[^¥￥\d]*[¥￥]\s*([\d,]+\.?\d{0,2})/ },
        { key: '支付金额', weight: 95, pattern: /支付金额\s*[：:]?\s*[¥￥]?\s*([\d,]+\.?\d{0,2})/ },
        { key: '应付金额', weight: 94, pattern: /应付金额\s*[：:]?\s*[¥￥]?\s*([\d,]+\.?\d{0,2})/ },
        { key: '小写', weight: 93, pattern: /小写[）)]?\s*[：:]?\s*[¥￥]?\s*([\d,]+\.\d{2})/ },
        { key: '票价', weight: 95, pattern: /票\s*价\s*[：:]?\s*[¥￥]?\s*([\d,]+\.\d{2})/ },
        { key: '总金额', weight: 88, pattern: /总\s*金\s*额\s*[：:]?\s*[¥￥]?\s*([\d,]+\.?\d{0,2})/ },
        { key: '金额', weight: 60, pattern: /金\s*额\s*[：:]?\s*[¥￥]?\s*([\d,]+\.?\d{0,2})/ },
      ];
      const amountKeywords = amountPatterns.map((item) => item.key);

      const contextBoostWords = ['合计', '小写', '支付金额', '应付金额', '价税合计', '总金额'];
      const noiseWords = ['单价', '税额', '税率', '税率/征收率', '数量', '金额税', '金额(不含税)', '金额不含税'];
      const amountsFromText = (text) => {
        const candidates = [];
        for (const item of amountPatterns) {
          const re = new RegExp(item.pattern.source, item.pattern.flags.includes('g') ? item.pattern.flags : item.pattern.flags + 'g');
          let m;
          while ((m = re.exec(text)) !== null) {
            const value = parseFloat(m[1].replace(/,/g, ''));
            if (value > 0 && value < 100000000) {
              candidates.push({ value, score: item.weight, source: item.key, text });
            }
          }
        }
        return candidates;
      };

      const scoreCandidate = (candidate) => {
        let score = candidate.score;
        const t = candidate.text;
        if (contextBoostWords.some((w) => t.includes(w))) score += 10;
        if (noiseWords.some((w) => t.includes(w))) score -= 20;
        if (/\-\s*[\d,]+\.\d{2}/.test(t)) score -= 25;
        if (/单价|税额|税率/.test(t) && !/合计|支付金额|应付金额|小写/.test(t)) score -= 30;
        if (/单价/.test(t) && !/合计|支付金额|应付金额|小写|总金额/.test(t)) score -= 40;
        if (/\b0\.0{1,2}\b/.test(t)) score -= 10;
        return score;
      };

      const lineCandidates = [];
      for (const line of normalizedLines) {
        lineCandidates.push(...amountsFromText(line));
      }
      for (const line of compactLines) {
        lineCandidates.push(...amountsFromText(line));
      }

      if (authoritative > 0) {
        // 有「价税合计」字样时以法定总额为准，避免把不含税金额当成报销金额
        amount = authoritative;
      } else if (lineCandidates.length > 0) {
        const sorted = lineCandidates
          .map((c) => ({ ...c, finalScore: scoreCandidate(c) }))
          .sort((a, b) => b.finalScore - a.finalScore || b.value - a.value);
        amount = sorted[0].value;
      }

      if (!amount) {
        const sorted = [...new Set(collectYenAmounts())].sort((a, b) => b - a);
        if (sorted.length > 0) amount = sorted[0];
      }

      let date = new Date();
      const datePatterns = [
        /开票日期\s*[：:]\s*(\d{4})\s*年?\s*(\d{1,2})\s*月?\s*(\d{1,2})\s*日?/,
        /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/,
        /(\d{4})\s*[年.\-\/]\s*(\d{1,2})\s*[月.\-\/]\s*(\d{1,2})/,
      ];
      for (const p of datePatterns) {
        const m = fullText.match(p) || compactText.match(p);
        if (m) {
          const y = parseInt(m[1]), mo = parseInt(m[2]), d = parseInt(m[3]);
          if (y >= 2015 && y <= 2035 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
            date = new Date(y, mo - 1, d);
            break;
          }
        }
      }

      let itemName = '';
      const headerWords = ['车牌号', '车辆类型', '通行日期', '单价', '数量', '金额', '税率', '税额', '征收率', '类型'];
      const invalidItemWords = ['税收分类编码', '货物或应税劳务', '服务名称', '规格型号', '单位', '合计'];
      const plateMatch = fullText.match(/([京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤川青藏琼宁])\s*([A-HJ-NP-Z][A-HJ-NP-Z0-9]{4,6})/);
      const plateNumber = plateMatch ? plateMatch[1] + plateMatch[2] : '';
      const starMatches = [
        // 先取去空格版本：数电票常把项目名排成「* 交 通 运 输 服 务 * 客 运 服 务 费」
        ...[...compactCleanText.matchAll(/[*＊]([^*＊\d]{1,20})[*＊]([一-龥]{1,12})/g)]
          .map((m) => (m[1].trim() + m[2].trim()).trim()),
        ...[...cleanText.matchAll(/[*＊]\s*([^*＊\n]{1,30})\s*[*＊]\s*([^\s*＊\n]{1,30})/g)]
          .map((m) => (m[1].replace(/\s+/g, '') + m[2].trim()).trim()),
      ].filter((name) => name && !headerWords.includes(name) && !invalidItemWords.some((w) => name.includes(w)));
      const serviceItem = starMatches.find((name) => /通行费|客运|运输|服务|停车|加油|餐饮|住宿/.test(name));
      if (serviceItem) itemName = serviceItem;
      else if (starMatches.length > 0) itemName = starMatches[0];
      // 铁路电子客票：无 *项目* 格式，识别为「火车票 起站-到站」
      // 站名顺序必须按页面 x 坐标(左=出发,右=到达),不能用文本流顺序(会反)
      if (!itemName && /铁路电子客票|中国铁路|12306/.test(compactText)) {
        // 找出所有「站」标记，站名是其同一行、紧靠左侧的中文项
        const markers = posItems.filter((p) => p.str === '站');
        const names = [];
        for (const mk of markers) {
          const cand = posItems
            .filter((p) => p !== mk && Math.abs(p.y - mk.y) < 5 && p.x < mk.x &&
              /^[一-龥]{2,8}$/.test(p.str) && p.str !== '站')
            .sort((a, b) => b.x - a.x)[0]; // 最靠近「站」左侧的中文
          if (cand) names.push({ name: cand.str, x: cand.x });
        }
        names.sort((a, b) => a.x - b.x); // 左=出发，右=到达
        if (names.length >= 2) {
          itemName = `火车票 ${names[0].name}-${names[names.length - 1].name}`;
        } else {
          itemName = '火车票';
        }
      }
      if (!itemName) {
        const itemLine = normalizedLines.find((line) => /通行费|客运|运输服务|停车|加油|餐饮|住宿/.test(line));
        if (itemLine) {
          const m = itemLine.match(/(?:\*[^*＊\n]+\*)?([^\s¥￥\d]{2,20}(?:费|服务|服务费))/);
          if (m) itemName = m[1].trim();
        }
      }
      if (plateNumber && itemName && !itemName.includes(plateNumber)) {
        itemName = itemName + ' ' + plateNumber;
      } else if (plateNumber && !itemName) {
        itemName = plateNumber;
      }
      if (!itemName || headerWords.some((w) => itemName === w) || invalidItemWords.some((w) => itemName.includes(w))) itemName = '';
      if (!itemName) {
        const base = fileName.replace(/\.pdf$/i, '').replace(/[_\-]/g, ' ');
        const cjk = base.match(/[一-龥]{2,10}/g);
        if (cjk) itemName = cjk[0];
      }
      if (!itemName) itemName = '电子发票';
      // 票面写明「长途汽车/汽车票」的旅客运输发票归入「普票费」，而非「车船费-其他」
      if (/长途汽车|汽车票|客运票/.test(compactCleanText) &&
          !/网约车|打车|行程单|ITINERARY/.test(compactCleanText)) {
        itemName = '长途汽车票 ' + itemName;
      }

      const trip = extractTripInfo(fullText, compactText, fileName);
      // 行程单不是发票，主金额也统一成核对金额，避免被表格里的「金额」表头读成 1 或 0
      if (trip.isTrip && trip.amount > 0) amount = trip.amount;
      if (trip.isTrip) {
        console.log('🚕 识别为行程单（仅用于日期/金额核对）:', fileName,
          '日期:', trip.primaryDate, '金额:', trip.amount);
      }
      return { amount, date, itemName, fileName, isTrip: trip.isTrip, trip };
    } catch (err) {
      console.warn(`⚠️ 提取失败 ${fileName}:`, err.message);
      return { amount: 0, date: new Date(), itemName: '电子发票', fileName,
        isTrip: TRIP_STRICT_NAME_RE.test(fileName || ''), trip: null };
    }
  }

  window.__expenseReportCore = {
    initPdfJs,
    extractInvoiceDataFromPdf,
    extractTripInfo,
    TRIP_NAME_RE,
  };


  setTimeout(() => { initPdfJs(); }, 1000);
})();