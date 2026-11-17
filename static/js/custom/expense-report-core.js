(function () {
  window.__invoiceDataCache = window.__invoiceDataCache || {};

  // ------------------------------------------------------------------
  // 差旅报销单：行程单（打车/网约车）识别
  // 行程单不是发票，只用来做两件事：
  //   1) 金额与发票核对（配对成功后不重复计入报销金额）；
  //   2) 提供真实乘车日期，优先于发票的开票日期。
  // ------------------------------------------------------------------
  var TRIP_NAME_RE = /行程单|打车|滴滴|出行|用车|网约车|出租车|高德|曹操|t3|trip|itinerary|ride/i;
  // 文件名强特征：明确写「行程单 / 行程报销单 / itinerary / trip report|sheet」。
  // 真实票据里既有「…电子行程单.pdf」也有「…行程报销单.pdf」，后者早期会被漏判成发票。
  var TRIP_STRICT_NAME_RE = /行程单|行程报销单|itinerary|trip[\s_-]*(report|sheet)/i;
  // 发票铁证：带金额的「价税合计」或「纳税人识别号」——行程单票面绝不会有。
  // 特意不含「发票号码/开票日期/电子发票/增值税」：这些是行程单关联发票时也会印的弱词。
  var INVOICE_PROOF_RE = /价税合计[^¥￥\d]{0,12}[¥￥]?\s*[\d,]+\.?\d{0,2}|纳税人识别号/;
  // 行程单铁证：行程明细字段——发票票面绝不会有。
  var TRIP_TEXT_RE = /用车时间|上车时间|上车|下车|起步价|里程|实付金额|乘客|服务时间|预约时间|出发时间|行程时间/;

  // 住宿票铁证：直营酒店票项目名为「*住宿服务*住宿费」；携程/同程等代订平台
  // 则是「*生产生活服务*经纪代理服务*代订住宿费」，票面可能一个「酒店」都没有。
  var LODGING_PROOF_RE = /代订住宿|住宿费|住宿服务|客房费|房\s*费|间夜|民宿|旅馆|客栈/;
  // 弱特征：只有「酒店/宾馆」字样还不够（行程单的起点终点里常出现酒店名），
  // 必须同时有入住/退房这类住宿行为字段才认。
  var LODGING_WEAK_RE = /酒店|宾馆|公寓/;
  var LODGING_ACTION_RE = /入住|退房|离店|到店|房费|房型/;
  // 汽车站/运输集团/公共交通：客运班车票的项目名和网约车一模一样都是
  // 「*交通运输服务*客运服务费」，只能靠这几个字段区分，否则会误进「打的费」。
  var BUS_TICKET_RE = /长途汽车|汽车票|客运票|汽车站|客运站|客运班车|公共交通|运输集团/;
  var RIDE_HAIL_RE = /网约车|打车|出租|滴滴|高德|哈啰|曹操|T3|行程单|itinerary|ride/i;

  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  // 'YYYY-MM-DD' → [y, m, d]（用于把住宿票的入住日转成本地 Date，避免 UTC 偏移）
  function parseDayParts(iso) {
    var m = String(iso || '').match(/^(20\d{2})-(\d{1,2})-(\d{1,2})$/);
    return m ? [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)] : null;
  }

  function extractTripInfo(fullText, compactText, fileName) {
    var text = compactText || '';
    var looksTrip = TRIP_TEXT_RE.test(text);
    var hasInvoiceProof = INVOICE_PROOF_RE.test(text);
    var strictTripName = TRIP_STRICT_NAME_RE.test(fileName || '');
    // 用一对互斥的铁证判定，弱词（发票号码/开票日期/电子发票/增值税/价税合计说明）
    // 两边票面都可能出现，一律不参与裁决；文件名也不再一票否决。
    //   1) 有发票铁证（带金额的价税合计 / 纳税人识别号）→ 发票。合并票据也走这条，
    //      金额照常计入且只计一次；真发票名含"行程单"也不会漏算。
    //   2) 有行程明细特征，或文件名明确写行程单/行程报销单 → 行程单。即便文件名
    //      含"电子发票"等票种词（如"高德打车电子发票行程单.pdf"），也按行程单处理，
    //      避免与其对应发票重复计费。
    //   3) 两者皆无 → 默认发票（只有平台名不算行程单）。
    var isTrip = !!(!hasInvoiceProof && (looksTrip || strictTripName));

    var dates = [];
    var preferred = [];
    var dateRe = /(20\d{2})\s*[年\-/.]\s*(\d{1,2})\s*[月\-/.]\s*(\d{1,2})/g;
    var m;
    while ((m = dateRe.exec(fullText || '')) !== null) {
      var y = parseInt(m[1], 10), mo = parseInt(m[2], 10), d = parseInt(m[3], 10);
      var maxDay = (y >= 2015 && y <= 2035 && mo >= 1 && mo <= 12) ? new Date(y, mo, 0).getDate() : 0;
      if (y < 2015 || y > 2035 || mo < 1 || mo > 12 || d < 1 || d > maxDay) continue;
      var iso = y + '-' + pad2(mo) + '-' + pad2(d);
      if (dates.indexOf(iso) === -1) dates.push(iso);
    }
    var prefRe = /(?:用车时间|行程时间|行程起止日期|出发时间|上车时间|服务时间|乘车日期|行程日期|用车日期|订单时间)\s*[:：]?\s*(20\d{2})\s*[年\-/.]\s*(\d{1,2})\s*[月\-/.]\s*(\d{1,2})/g;
    while ((m = prefRe.exec(fullText || '')) !== null) {
      var py = parseInt(m[1], 10), pm = parseInt(m[2], 10), pd = parseInt(m[3], 10);
      var pmax = (py >= 2015 && py <= 2035 && pm >= 1 && pm <= 12) ? new Date(py, pm, 0).getDate() : 0;
      if (pm >= 1 && pm <= 12 && pd >= 1 && pd <= pmax) {
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

  // ------------------------------------------------------------------
  // 混合票拆行：一张发票同时开了住宿与交通（商旅平台合并开票很常见）。
  // 整笔塞进一列会让另一类费用无端多钱、正确的那列少钱，所以按票面明细行的
  // 「金额」列比例把价税合计拆开，拆不开就老实不拆（宁可整笔进一列，也不能拆错）。
  //
  // 为什么按行取「金额」而不是「税额/单价」：
  //   数电票明细行的列序是 项目 | 规格 | 单位 | 数量 | 单价 | 金额 | 税率 | 税额，
  //   税额 > 金额 只在税率 >100% 时出现（不存在），所以「税率前的最后一个金额」
  //   与「整行最大金额」两条路都能落到金额列，互为兜底。
  // ------------------------------------------------------------------
  function isMoneyToken(tk) {
    return /^[¥￥]?[\d,]+\.\d{2}[¥￥]?$/.test(tk);
  }
  function moneyOf(tk) {
    return parseFloat(String(tk).replace(/[¥￥,]/g, ''));
  }
  // 明细行分类：只区分「住宿」和「交通」两类，其余一律算未知（未知就不拆票）。
  function classifyItemRow(text) {
    var t = String(text || '');
    if (/住宿|客房|房费|间夜|民宿|旅馆|客栈|代订住宿/.test(t)) return 'lodging';
    if (/交通运输|旅客运输|客运|通行费|加油|停车费|出租车|网约车/.test(t)) return 'transportOther';
    return '';
  }

  function extractItemSplits(fullText, totalYuan) {
    if (!(totalYuan > 0)) return null;
    var tokens = String(fullText || '').split(/\s+/).filter(Boolean);
    // 票尾的合计/备注/购销方字段不属于明细行：不截断的话，「（小写）¥250.00」
    // 会被并进最后一行，把那一行的金额从 50 读成 250。
    var stopRe = /价税合计|小写|大写|合计|备注|销售方|购买方|发票号码|开票日期|纳税人|收款人|复核人|开票人/;
    var rows = [];
    var cur = null;
    for (var i = 0; i < tokens.length; i++) {
      var tk = tokens[i];
      if (stopRe.test(tk)) { cur = null; continue; }
      if (/^[*＊]/.test(tk)) { cur = { name: tk, toks: [] }; rows.push(cur); continue; }
      if (cur) cur.toks.push(tk);
    }
    if (rows.length < 2) return null;

    var parsed = rows.map(function (row) {
      var toks = row.toks;
      var pctAt = -1, firstMoney = -1, lastMoney = -1, maxM = -1, maxAt = -1, taxAfter = -1;
      for (var j = 0; j < toks.length; j++) {
        var t = toks[j];
        if (pctAt < 0 && /^\d{1,2}(?:\.\d+)?%$/.test(t)) { pctAt = j; continue; }
        if (isMoneyToken(t)) {
          var v = moneyOf(t);
          if (firstMoney < 0) firstMoney = j;
          if (pctAt >= 0 && taxAfter < 0) taxAfter = j;  // 税率右边第一笔 = 税额
          if (pctAt < 0) lastMoney = j;
          if (v > maxM) { maxM = v; maxAt = j; }
        }
      }
      var net = 0;
      if (pctAt >= 0 && lastMoney >= 0) net = moneyOf(toks[lastMoney]);
      else if (maxAt >= 0) net = maxM;
      // 含税金额 = 不含税金额 + 税额。有税额就按含税比例拆，否则两行税率不同时
      // （6% 住宿 + 9% 交通）按不含税比例拆会偏出几毛钱。
      var tax = taxAfter >= 0 ? moneyOf(toks[taxAfter]) : 0;
      var gross = (tax > 0 && tax < net) ? net + tax : net;
      // 项目名可能被拆成多个文本项（*生产生活服务*经纪代理 / 服务*代订住宿费），
      // 第一个金额之前的非数字 token 都算项目名的一部分。
      var nameEnd = firstMoney < 0 ? toks.length : firstMoney;
      var nameText = row.name + ' ' + toks.slice(0, nameEnd).join(' ');
      return { kind: classifyItemRow(nameText), net: net, gross: gross };
    }).filter(function (r) { return r.gross > 0; });

    if (parsed.length < 2) return null;
    // 有没认出来的行就不拆：拆一半漏一半，两边都对不上。
    if (parsed.some(function (r) { return !r.kind; })) return null;
    var byKind = {}, byKindNet = {};
    parsed.forEach(function (r) {
      byKind[r.kind] = (byKind[r.kind] || 0) + r.gross;
      byKindNet[r.kind] = (byKindNet[r.kind] || 0) + r.net;
    });
    if (!byKind.lodging || !byKind.transportOther) return null;
    var kinds = Object.keys(byKind);
    if (kinds.length !== 2) return null;

    var sum = byKind.lodging + byKind.transportOther;
    var sumNet = byKindNet.lodging + byKindNet.transportOther;
    // 行金额若是含税金额，之和应当≈价税合计；若是不含税金额（1/1.06），
    // 差得远但仍在合理比例内则按比例分摊。两边都不像就只能放弃拆票。
    var looksGross = Math.abs(sum - totalYuan) <= 0.02;
    if (!looksGross && (sumNet < totalYuan * 0.5 || sumNet > totalYuan * 1.02 + 0.02)) return null;

    var totalC = Math.round(totalYuan * 100);
    var out = kinds.map(function (k) {
      return { kind: k, cents: Math.round(totalC * byKind[k] / sum) };
    });
    // 尾差补给最大的一笔，保证拆出来的分文之和 == 票面价税合计。
    var acc = out.reduce(function (s, p) { return s + p.cents; }, 0);
    var diff = totalC - acc;
    if (diff !== 0) {
      var big = out.slice().sort(function (a, b) { return b.cents - a.cents; })[0];
      big.cents += diff;
    }
    if (out.some(function (p) { return p.cents <= 0; })) return null;
    return out.map(function (p) { return { kind: p.kind, amount: p.cents / 100 }; });
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

        cMapUrl: new URL('static/cmaps/', window.location.href).href,
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

      // ------------------------------------------------------------------
      // 住宿票据：判定 + 入住/退房日期 + 酒店名
      // 真实票面（携程代订）：项目名拆成「*生产生活服务*经纪代理」和
      // 「服务*代订住宿费」两段，备注里写「柏曼酒店(…)，入住2026年06月02日，
      // 退房06月04日」。旧逻辑只抓到前半段「生产生活服务经纪代理」，
      // 既不像住宿也不像交通，最后兜底进「车船费-其他」——这就是酒店发票分不出来的根因。
      // ------------------------------------------------------------------
      // 「入住」「入住日期」「入住时间」三种写法都要认：携程写「入住2026年06月02日」，
      // 同程/飞猪写「入住日期：2026-06-02」。少认这两个字，整张票的入住日就抓不到，
      // 归行日退回开票日 —— 又变成「住宿票被判超范围」的老毛病。
      function stayDate(label, fallbackYear) {
        var m = compactCleanText.match(
          new RegExp(label + '(?:日期|时间)?\\s*[：:]?\\s*(20\\d{2})\\s*[年\\-/.]\\s*(\\d{1,2})\\s*[月\\-/.]\\s*(\\d{1,2})'));
        if (!m) {
          // 退房日期常省略年份：「退房06月04日」，年份沿用入住年
          var m2 = compactCleanText.match(
            new RegExp(label + '(?:日期|时间)?\\s*[：:]?\\s*(\\d{1,2})\\s*[月\\-/.]\\s*(\\d{1,2})'));
          if (m2 && fallbackYear) m = [null, String(fallbackYear), m2[1], m2[2]];
        }
        if (!m) return '';
        var y = parseInt(m[1], 10), mo = parseInt(m[2], 10), dd = parseInt(m[3], 10);
        var maxDay = (y >= 2015 && y <= 2035 && mo >= 1 && mo <= 12) ? new Date(y, mo, 0).getDate() : 0;
        if (y < 2015 || y > 2035 || mo < 1 || mo > 12 || dd < 1 || dd > maxDay) return '';
        return y + '-' + pad2(mo) + '-' + pad2(dd);
      }
      const stayIn = stayDate('入住');
      const stayInYear = stayIn ? parseInt(stayIn.slice(0, 4), 10) : 0;
      // 退房/离店两种写法都认：同程、飞猪多用「离店日期」。
      let stayOut = stayDate('退房', stayInYear) || stayDate('离店', stayInYear);
      // 跨年住宿（12-30 入住、01-02 离店）：省略年份时按入住年补全会得到「早于入住日」的
      // 荒谬结果，这里顺延一年。只影响卡片上显示的离店日，归行仍取入住日。
      if (stayOut && stayIn && stayOut < stayIn) {
        stayOut = (stayInYear + 1) + stayOut.slice(4);
      }
      const hotelMatch = fullText.match(
        /((?:[一-龥A-Za-z0-9·]{2,26}?(?:酒店|宾馆|旅馆|民宿|客栈|公寓))(?:[（(][^）)]{0,36}[）)])?)/);
      const hotelName = hotelMatch ? hotelMatch[1].replace(/\s+/g, '') : '';
      // 交通铁证在手时绝不认成住宿（防止打车票备注里出现酒店名被误判）
      const hasTransportProof = /交通运输|客运服务|通行费|加油|停车费|出租车|网约车/.test(compactCleanText);
      const isLodging = !hasTransportProof && (
        LODGING_PROOF_RE.test(compactCleanText) ||
        (LODGING_WEAK_RE.test(compactCleanText) && LODGING_ACTION_RE.test(compactCleanText))
      );
      const isBusTicket = BUS_TICKET_RE.test(compactCleanText) && !RIDE_HAIL_RE.test(compactCleanText);

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
      // 金额可信度：下游要拿它决定「信识别结果还是信 React 的解析结果」。
      //   total = 票面明确写出价税合计（含「小写」），是法定总额，最可信
      //   sole  = 票面只有一个 ¥ 金额（铁路电子客票这类排版），没有歧义
      //   trip  = 行程单核对金额
      //   guess = 按行打分挑出来的，可能挑到不含税金额/税额
      //   yen   = 兜底取所有 ¥ 面额最大值（多个金额互相竞争过）
      let amountSource = 'none';
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
        amountSource = 'total';
      } else if (lineCandidates.length > 0) {
        const sorted = lineCandidates
          .map((c) => ({ ...c, finalScore: scoreCandidate(c) }))
          .sort((a, b) => b.finalScore - a.finalScore || b.value - a.value);
        amount = sorted[0].value;
        amountSource = 'guess';
      }

      if (!amount) {
        const sorted = [...new Set(collectYenAmounts())].sort((a, b) => b - a);
        if (sorted.length > 0) {
          amount = sorted[0];
          // 全票只有一个 ¥ 金额时没有歧义，按可信处理：铁路电子客票就是这种票面 ——
          // 「票价:」标签和「￥12.00」印在不同位置，中间隔着座位号/乘车人，正则匹配不到，
          // 只能走这条兜底；但票面只有一个金额，取它不算猜。
          amountSource = sorted.length === 1 ? 'sole' : 'yen';
        }
      }

      // 混合票：票面明细行里同时有住宿和交通，按行金额把总额拆到两列。
      // 拆不开（行认不全 / 金额对不上）返回 null，仍按整笔归类，绝不给错钱。
      let splits = null;
      if (!/行程单/.test(compactCleanText) && /[*＊]/.test(fullText) &&
          /住宿|客房|房费|间夜|代订住宿/.test(compactCleanText) &&
          /交通运输|旅客运输|客运|通行费|加油|停车费|出租车|网约车/.test(compactCleanText)) {
        splits = extractItemSplits(fullText, amount);
      }
      const isMixed = !!(splits && splits.length > 1);

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

      // 旅客运输/铁路票自带的「出行日期 / 乘车日期」比开票日更接近真实消费日：
      // 汽车票常在行程结束后统一开票（出行 6-10、开票 6-11），按开票日归行会
      // 直接落到出差区间外被误报「超范围」。铁路票同理（乘车 6-02、开票 6-04）。
      // 只在票面带旅客运输结构字段时启用，避免误伤普通发票。
      let travelDate = '';
      // 数电客运票的表头是「出行人 / 出行日期 / 交通工具类型」整块排在票面，
      // 值却印在开票日期之后，字段与值并不相邻——所以只能靠「票面有旅客运输结构」
      // + 取全票第一个 ISO 日期两个条件合起来判断。
      // 交通运输服务（客运/通行费/货运）同样按此处理：它们的开票日期一律是
      // 「2026年06月11日」这种年月日格式，不会误抢；只有真正的出行日才印成 ISO。
      if (/旅客运输服务|出行人|交通工具类型|交通运输服务|铁路电子客票/.test(compactCleanText)) {
        const mk = (m) => {
          const y = parseInt(m[1], 10), mo = parseInt(m[2], 10), dd = parseInt(m[3], 10);
          const maxDay = (y >= 2015 && y <= 2035 && mo >= 1 && mo <= 12) ? new Date(y, mo, 0).getDate() : 0;
          if (y < 2015 || y > 2035 || mo < 1 || mo > 12 || dd < 1 || dd > maxDay) return '';
          return y + '-' + pad2(mo) + '-' + pad2(dd);
        };
        // 日期两侧都不能加断言：
        //   前视 / 后视都会把合法日期判掉，因为去空格后日期会和相邻数字粘死——
        //   前面粘身份证尾号（…23552026-06-10萧山机场…），
        //   后面粘发车时刻（2026-06-10 09:30 → 2026-06-1009:30）。
        // 月份/日期都限 {1,2} 位，最多吃到「10」就停，不会把 09:30 的 09 吞进日期。
        const isoM = compactCleanText.match(/(20\d{2})-(\d{1,2})-(\d{1,2})/);
        if (isoM) travelDate = mk(isoM);
        if (!travelDate) {
          const railM = compactCleanText.match(/(20\d{2})年(\d{1,2})月(\d{1,2})日\d{1,2}[:：]\d{2}开/);
          if (railM) travelDate = mk(railM);
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
      // 住宿票：项目名直接写清「住宿费」+ 酒店名，用户一眼能分辨三张同额票据。
      // 携程代订票识别出来的「生产生活服务经纪代理」毫无信息量，必须覆盖掉。
      if (isLodging) {
        const base = /代订住宿/.test(compactCleanText) ? '代订住宿费' : '住宿费';
        itemName = hotelName ? base + ' ' + hotelName : base;
      }
      // 客运班车（汽车站/运输集团/公共交通）归入「车船费-其他」，别混进「打的费」
      if (!isLodging && isBusTicket) {
        itemName = '长途汽车票 ' + itemName;
      }
      // 混合票：项目名写清拆出来的两笔，用户在确认弹窗里能一眼看出这张票会被分到两列
      if (isMixed) {
        const parts = splits.map((s) => (s.kind === 'lodging' ? '住宿 ' : '交通 ') +
          s.amount.toFixed(2));
        itemName = '混合票据（' + parts.join(' + ') + '）' + (hotelName ? ' ' + hotelName : '');
      }

      const trip = extractTripInfo(fullText, compactText, fileName);
      // 行程单不是发票，主金额也统一成核对金额，避免被表格里的「金额」表头读成 1 或 0
      if (trip.isTrip && trip.amount > 0) { amount = trip.amount; amountSource = 'trip'; }
      if (trip.isTrip) {
        console.log('🚕 识别为行程单（仅用于日期/金额核对）:', fileName,
          '日期:', trip.primaryDate, '金额:', trip.amount);
      }
      // 归行日优先级：住宿入住日 > 票面出行日 > 开票日期。
      // 住宿票按入住日算（携程代订票常退房后统一开票，开票日常已超出差区间）；
      // 旅客运输票按出行日算（行程结束才开票，开票日同样容易落到区间外）。
      // 注意：不要叫 issueDate —— 下游 invoice 对象的 issueDate 语义是「归行日」，
      // 这里返回的 billingDate 才是票面开票日期，两者不能混用。
      const billingDate = date;
      if ((isLodging || isMixed) && stayIn) {
        const si = parseDayParts(stayIn);
        if (si) date = new Date(si[0], si[1] - 1, si[2]);
      } else if (travelDate) {
        const ti = parseDayParts(travelDate);
        if (ti) date = new Date(ti[0], ti[1] - 1, ti[2]);
      }
      return {
        amount, date, itemName, fileName, isTrip: trip.isTrip, trip,
        // 金额可信度，见上方 amountSource 注释
        amountSource,
        billingDate,
        travelDate,
        isLodging,
        // 混合票拆出的每一笔（kind: lodging / transportOther），sum 恒等于 amount
        splits: isMixed ? splits : null,
        lodging: (isLodging || isMixed) ? { checkIn: stayIn, checkOut: stayOut, hotel: hotelName } : null,
        // 票据类型硬结论：确认弹窗/表格据此优先归类，不再依赖项目名关键词猜测
        docKind: isMixed ? 'mixed' : (isLodging ? 'lodging' : (isBusTicket ? 'bus' : '')),
        // 归行日的来源，供确认弹窗显示「按入住日 / 按出行日 / 按开票日期归行」
        dateSource: ((isLodging || isMixed) && stayIn) ? 'stay' : (travelDate ? 'travel' : 'billing'),
      };
    } catch (err) {
      console.warn(`⚠️ 提取失败 ${fileName}:`, err.message);
      return { amount: 0, date: new Date(), itemName: '电子发票', fileName,
        isTrip: TRIP_STRICT_NAME_RE.test(fileName || ''), trip: null };
    }
  }

  // 发票统计口径：只统计“当前上传的文件”，不能把历史缓存里的旧票据一起算进去。
  // currentFiles 为 null/undefined 时表示拿不到当前文件列表，退回旧口径（兼容早期调用）。
  function isIgnoredStatsFile(fileName) {
    var name = fileName || '';
    return /^报销单[_-]|^报销单\.pdf$/i.test(name) || name.indexOf('000_') === 0;
  }

  function selectInvoiceStatsItems(currentFiles, cache, keyOf) {
    var cacheObj = cache || {};
    var entries = Object.keys(cacheObj).map(function (key) { return [key, cacheObj[key]]; });
    var normalizeKey = typeof keyOf === 'function'
      ? keyOf
      : function (file) {
          return [file && file.name || '', file && file.size || 0, file && file.lastModified || 0].join('::');
        };

    if (!Array.isArray(currentFiles)) {
      return {
        known: false,
        items: entries.filter(function (entry) {
          return entry[1] && !isIgnoredStatsFile(entry[1].fileName);
        }).map(function (entry) { return entry[1]; })
      };
    }

    var result = new Map();
    var alias = new Map();
    currentFiles.forEach(function (file) {
      if (!file) return;
      var name = file.name || file.fileName || '';
      if (!name || isIgnoredStatsFile(name)) return;
      var canonical = normalizeKey(file) || name;
      if (!result.has(canonical)) {
        // 识别未完成时也先占位，保证“发票 + 行程单”始终等于当前文件数。
        result.set(canonical, { fileName: name, amount: 0, isTrip: false, __pending: true });
      }
      alias.set(canonical, canonical);
      alias.set(name, canonical);
    });

    // 同一文件可能同时存在「文件名」和「指纹」两个历史缓存键；指纹键优先，避免重复计数。
    var seen = new Set();
    entries.sort(function (a, b) {
      return (String(b[0]).indexOf('::') >= 0 ? 1 : 0) - (String(a[0]).indexOf('::') >= 0 ? 1 : 0);
    }).forEach(function (entry) {
      var key = entry[0];
      var value = entry[1];
      if (!value) return;
      var name = value.fileName || '';
      if (isIgnoredStatsFile(name)) return;
      var canonical = alias.get(key) || alias.get(name);
      if (!canonical || seen.has(canonical)) return;
      seen.add(canonical);
      result.set(canonical, value);
    });

    return { known: true, items: Array.from(result.values()) };
  }

  window.__expenseReportCore = {
    initPdfJs,
    extractInvoiceDataFromPdf,
    extractTripInfo,
    selectInvoiceStatsItems,
    TRIP_NAME_RE,
  };


  setTimeout(() => { initPdfJs(); }, 1000);
})();