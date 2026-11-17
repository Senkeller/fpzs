/*
 * 票据识别层回归测试（识别规则，不是表格逻辑）
 * ------------------------------------------------------------------
 * 为什么要单独一个脚本：
 *   verify-real-nanning.js 里的金额/日期是「老版本识别结果」固化的常量，直接喂给
 *   buildTripModel —— 它只验证表格算得对不对，**验证不了票认得对不对**。
 *   真实踩过的坑：携程代订住宿票被扫进「车船费-其他」，61+107+45 项断言全绿都没拦住。
 *   真 PDF 的文本层在 Node 里还原不了（依赖自定义 cmap），但识别规则本身可以：
 *   这里伪造 window.pdfjsLib，把我们想要的「票面文本」当作文本层喂给
 *   extractInvoiceDataFromPdf，于是在 Node 里就能锁死识别行为。
 *
 * 覆盖：
 *   · 住宿票三种排版：携程「入住2026年06月02日」/ 同程「入住日期：」/ 直营只有「住宿费」
 *   · 跨年住宿（12-30 入住、01-02 离店）
 *   · 网约车备注里出现酒店名 —— 绝不能判成住宿
 *   · 铁路票的出行日（「2026年06月02日08:10开」与「2026-06-02 08:30开」两种）
 *   · 日期后紧跟时刻（去空格后 2026-06-1009:30）不被日期正则吞掉
 *   · 汽车站客运票（只印「交通运输服务」不印「旅客运输服务」）
 *   · 机票行程单：文件名带「行程单」但有价税合计 → 必须判发票，否则重复计费
 *   · 归类优先级：人工指定 > 票据类型硬结论 docKind > 关键词
 *
 * 用法：node verify-recognition.js
 * 说明：本脚本不读任何 PDF、不依赖网络与浏览器，纯 Node 跑。
 */
'use strict';

const table = require('./static/js/custom/expense-report-table.js');

// ------------------------------------------------------------------
// 伪造 pdf.js：只实现识别核心用到的那三个方法
//   getDocument({data}) → { promise: pdf }
//   pdf.numPages / pdf.getPage(i) → page.getTextContent() → { items:[{str, transform}] }
// 文本按空白切片塞进 items，识别核心会自己 join(' ') 还原成一整段再压缩去空格。
// ------------------------------------------------------------------
globalThis.window = globalThis;
// 识别核心用 new URL('static/cmaps/', window.location.href)，缺了 location 会整体抛错
globalThis.location = { href: 'http://127.0.0.1/main.html' };

function fakePdf(text) {
  const items = String(text).split(/\s+/).filter(Boolean).map((str, i) => ({
    str,
    transform: [1, 0, 0, 1, 40, 700 - i * 10],
  }));
  return {
    GlobalWorkerOptions: {},
    getDocument: () => ({
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => ({ getTextContent: async () => ({ items }) }),
      }),
    }),
  };
}

require('./static/js/custom/expense-report-core.js');
const core = globalThis.__expenseReportCore;

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  ' + extra : '')); }
}
function ymd(d) {
  return d instanceof Date
    ? d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
    : '';
}

// 把票面文本当作文本层跑一遍识别
async function recognize(text, fileName) {
  globalThis.pdfjsLib = fakePdf(text);
  const file = { arrayBuffer: async () => new ArrayBuffer(8) };
  return core.extractInvoiceDataFromPdf(fileName, file);
}

// ------------------------------------------------------------------
// 票面样本（按真实票面的字段顺序手写，金额/日期都可核对）
// ------------------------------------------------------------------
const SAMPLE = {
  // 携程代订：项目名被拆成两段，备注里写「入住…，退房…」
  ctrip: `电子发票（普通发票） 发票号码：26332000001234567890 开票日期：2026年06月11日
    购买方 名称：某某公司
    *生产生活服务*经纪代理服务 *生产生活服务*经纪代理服务 代订住宿费 261.00
    价税合计（大写）贰佰陆拾壹圆整 （小写）¥261.00
    备注：柏曼酒店（柳州融水商贸城地王步行街店），入住2026年06月02日，退房06月04日 订单号123`,

  // 同程/飞猪排版：多「日期」二字，且退房写成「离店」
  tongcheng: `电子发票 发票号码：26332000001234567891 开票日期：2026年06月11日
    *住宿服务*住宿费 180.00
    价税合计（小写）¥180.00
    备注：某某酒店 入住日期：2026-06-02 离店日期：2026-06-04`,

  // 直营酒店：只有「住宿费」，票面没有任何入住/退房信息
  direct: `电子发票 发票号码：26332000001234567892 开票日期：2026年06月05日
    *住宿服务*住宿费 300.00
    价税合计（小写）¥300.00
    销售方名称：杭州某某酒店管理有限公司`,

  // 网约车：备注里出现酒店名与「入住」字样，不能因此被判成住宿
  taxiWithHotel: `电子发票 发票号码：26332000001234567893 开票日期：2026年06月03日
    *交通运输服务*客运服务费 24.48
    价税合计（小写）¥24.48
    备注：06-03 杭州东站-柏曼酒店 入住送客 车牌号浙A12345 里程12.3公里`,

  // 混合票：住宿费与交通运输服务开在同一张发票上
  mixed: `电子发票 发票号码：26332000001234567894 开票日期：2026年06月11日
    *生产生活服务*代订住宿费 200.00 *交通运输服务*客运服务费 50.00
    价税合计（小写）¥250.00
    备注：入住2026年06月02日 退房06月03日`,

  // 铁路票：开票日期排在乘车日期之前
  railChinese: `电子发票（铁路电子客票） 发票号码：26119123456789 开票日期：2026年06月04日
    杭州东站 G1234 德清站 2026年06月02日 08:30开 二等座
    票价：¥12.00 乘车人：郑圣龙
    价税合计（小写）¥12.00`,

  // 铁路票：乘车日期印成 ISO，且后面紧跟时刻（去空格后粘成 2026-06-0208:30开）
  railIso: `电子发票（铁路电子客票） 发票号码：26119123456790 开票日期：2026年06月04日
    杭州东站 G1234 德清站 2026-06-02 08:30开 二等座
    票价：¥12.00 乘车人：郑圣龙
    价税合计（小写）¥12.00`,

  // 汽车站客运票：只印「交通运输服务」，不印「旅客运输服务」
  bus: `电子发票 发票号码：26332000001234567895 开票日期：2026年06月11日
    *交通运输服务*客运费 75.00
    价税合计（小写）¥75.00
    备注：融水汽车站-桂林客运站 2026-06-10 09:30 乘车人郑圣龙`,

  // 机票行程单：文件名含「行程单」，但票面有价税合计 → 是发票，不是行程单
  airTicket: `航空运输电子客票行程单 发票号码：26119123456791 开票日期：2026年06月08日
    *航空运输服务*机票款 880.00
    价税合计（小写）¥880.00
    乘机日期 2026-06-02 杭州-南宁`,

  // 退票费
  refund: `电子发票 发票号码：26332000001234567896 开票日期：2026年06月09日
    *其他现代服务*退票费 38.00
    价税合计（小写）¥38.00`,

  // 跨年住宿：离店日省略年份，按入住年补全会得到「早于入住日」的错误日期
  crossYear: `电子发票 发票号码：26332000001234567897 开票日期：2027年01月05日
    *住宿服务*住宿费 400.00
    价税合计（小写）¥400.00
    备注：某某酒店 入住2026年12月30日 退房01月02日`,

  // 行程单（无价税合计，靠文件名强特征判）
  tripSheet: `高德地图—打车——行程单 AMAP ITINERARY 申请时间：2026-06-11
    上车时间 2026-06-02 07:12 起点 某某研究院 终点 德清航站楼 11.70元`,
};

(async () => {
  // ----------------------------------------------------------------
  console.log('\n=== 住宿票：三种排版都要能定出住宿 + 入住日 ===');
  // ----------------------------------------------------------------
  const ctrip = await recognize(SAMPLE.ctrip, '携程住宿发票.pdf');
  check('携程代订票判为住宿（docKind=lodging）', ctrip.docKind === 'lodging', ctrip.docKind);
  check('携程票项目名被改写为「代订住宿费 + 酒店名」',
    /代订住宿费/.test(ctrip.itemName) && /柏曼酒店/.test(ctrip.itemName), ctrip.itemName);
  check('携程票金额取价税合计 261.00', ctrip.amount === 261, String(ctrip.amount));
  check('携程票按入住日归行 2026-06-02', ymd(ctrip.date) === '2026-06-02' && ctrip.dateSource === 'stay',
    ymd(ctrip.date) + ' / ' + ctrip.dateSource);
  check('携程票入住/退房日期都解析出来',
    ctrip.lodging && ctrip.lodging.checkIn === '2026-06-02' && ctrip.lodging.checkOut === '2026-06-04',
    ctrip.lodging && (ctrip.lodging.checkIn + '~' + ctrip.lodging.checkOut));
  check('携程票进「住宿费」列而不是车船费-其他',
    table.utils.categorize(ctrip, null) === 'lodging', table.utils.categorize(ctrip, null));

  const tongcheng = await recognize(SAMPLE.tongcheng, '住宿发票.pdf');
  check('「入住日期：」排版也能抓到入住日（少认这两个字就会退回开票日）',
    tongcheng.lodging && tongcheng.lodging.checkIn === '2026-06-02',
    tongcheng.lodging && tongcheng.lodging.checkIn);
  check('「离店日期」作为退房别名被识别',
    tongcheng.lodging && tongcheng.lodging.checkOut === '2026-06-04',
    tongcheng.lodging && tongcheng.lodging.checkOut);
  check('同程排版按入住日归行，不是开票日 06-11',
    ymd(tongcheng.date) === '2026-06-02' && tongcheng.dateSource === 'stay',
    ymd(tongcheng.date));

  const direct = await recognize(SAMPLE.direct, '酒店发票.pdf');
  check('无入住日期的直营住宿票仍判为住宿', direct.docKind === 'lodging', direct.docKind);
  check('没有入住日时退回开票日归行（dateSource=billing）',
    direct.dateSource === 'billing' && ymd(direct.date) === '2026-06-05', ymd(direct.date));

  const cross = await recognize(SAMPLE.crossYear, '住宿.pdf');
  check('跨年住宿：入住 12-30 归行正确', ymd(cross.date) === '2026-12-30', ymd(cross.date));
  check('跨年住宿：离店日顺延到次年而不是回到入住年',
    cross.lodging && cross.lodging.checkOut === '2027-01-02',
    cross.lodging && cross.lodging.checkOut);

  // ----------------------------------------------------------------
  console.log('\n=== 交通票：出行日与「不许误判成住宿」 ===');
  // ----------------------------------------------------------------
  const taxi = await recognize(SAMPLE.taxiWithHotel, '滴滴出行电子发票.pdf');
  check('网约车备注含酒店名/「入住」也不判住宿', taxi.docKind !== 'lodging',
    'docKind=' + (taxi.docKind || '∅'));
  check('网约车仍进「打的费」', table.utils.categorize(taxi, null) === 'taxi',
    table.utils.categorize(taxi, null));

  const railA = await recognize(SAMPLE.railChinese, '火车票.pdf');
  check('铁路票「2026年06月02日08:30开」识别出行日 06-02',
    railA.travelDate === '2026-06-02' && railA.dateSource === 'travel',
    railA.travelDate + ' / ' + railA.dateSource);
  check('铁路票归行用出行日而不是开票日 06-04', ymd(railA.date) === '2026-06-02', ymd(railA.date));

  const railB = await recognize(SAMPLE.railIso, '火车票2.pdf');
  check('铁路票「2026-06-02 08:30开」也能识别出行日（去空格后日期紧贴时刻）',
    railB.travelDate === '2026-06-02' && ymd(railB.date) === '2026-06-02',
    railB.travelDate + ' / ' + ymd(railB.date));

  const bus = await recognize(SAMPLE.bus, '汽车票.pdf');
  check('汽车站客运票判为班车（docKind=bus）', bus.docKind === 'bus', bus.docKind);
  check('只印「交通运输服务」的客运票也能拿到出行日 06-10',
    bus.travelDate === '2026-06-10' && ymd(bus.date) === '2026-06-10',
    bus.travelDate + ' / ' + ymd(bus.date));
  check('班车票进「车船费-其他」而不是「打的费」',
    table.utils.categorize(bus, null) === 'transportOther', table.utils.categorize(bus, null));

  // ----------------------------------------------------------------
  console.log('\n=== 票种边界：行程单 / 机票 / 退票费 ===');
  // ----------------------------------------------------------------
  const air = await recognize(SAMPLE.airTicket, '机票行程单.pdf');
  check('文件名带「行程单」但有价税合计 → 判发票，不重复计费', air.isTrip === false,
    String(air.isTrip));
  check('机票进「普票费」', table.utils.categorize(air, null) === 'ticket',
    table.utils.categorize(air, null));

  const refund = await recognize(SAMPLE.refund, '退票费发票.pdf');
  check('退票费进「其他（退票费）」', table.utils.categorize(refund, null) === 'refund',
    table.utils.categorize(refund, null));

  const sheet = await recognize(SAMPLE.tripSheet, '高德打车电子行程单.pdf');
  check('无价税合计 + 文件名写行程单 → 判行程单', sheet.isTrip === true, String(sheet.isTrip));

  // ----------------------------------------------------------------
  console.log('\n=== 归类优先级：人工指定 > 票据类型硬结论 > 关键词 ===');
  // ----------------------------------------------------------------
  check('docKind=lodging 压过「客运服务」关键词（旧 bug 真凶）',
    table.utils.categorize({ fileName: 'x.pdf', projectName: '交通运输服务客运服务', docKind: 'lodging' }, null) === 'lodging');
  check('docKind=bus 压过「客运服务」关键词，不进打的费',
    table.utils.categorize({ fileName: 'x.pdf', projectName: '交通运输服务客运服务', docKind: 'bus' }, null) === 'transportOther');
  check('人工 __reportCategory 压过 docKind',
    table.utils.categorize({ fileName: 'x.pdf', projectName: '住宿费', docKind: 'lodging', __reportCategory: 'taxi' }, null) === 'taxi');
  check('非法 __reportCategory 被忽略，回落到 docKind',
    table.utils.categorize({ fileName: 'x.pdf', projectName: '住宿费', docKind: 'lodging', __reportCategory: 'allowance' }, null) === 'lodging');

  // ----------------------------------------------------------------
  // 混合票：住宿与交通开在同一张发票上（商旅平台合并开票）。
  // 以前整笔进一列（住宿 ¥250 全进住宿费，¥50 交通费凭空消失），
  // 现在按票面明细行的金额比例拆到两列，合计恒等于票面价税合计。
  // ----------------------------------------------------------------
  console.log('\n=== 混合票拆行：按明细行金额拆分，合计不差分 ===');
  const mixed = await recognize(SAMPLE.mixed, '携程商旅发票.pdf');
  check('混合票 → docKind=mixed', mixed.docKind === 'mixed', 'docKind=' + (mixed.docKind || '∅'));
  const mixedL = (mixed.splits || []).find(s => s.kind === 'lodging');
  const mixedT = (mixed.splits || []).find(s => s.kind === 'transportOther');
  check('拆出住宿 ¥200', !!mixedL && Math.abs(mixedL.amount - 200) < 0.005, mixedL && mixedL.amount);
  check('拆出交通 ¥50', !!mixedT && Math.abs(mixedT.amount - 50) < 0.005, mixedT && mixedT.amount);
  check('拆分后合计 == 价税合计 250',
    (mixed.splits || []).reduce((s, p) => s + p.amount, 0).toFixed(2) === '250.00',
    (mixed.splits || []).reduce((s, p) => s + p.amount, 0).toFixed(2));
  check('混合票按入住日归行（票面写了入住，比开票日更接近真实消费）',
    mixed.dateSource === 'stay' && ymd(mixed.date) === '2026-06-02', ymd(mixed.date));
  check('混合票项目名写清两笔金额', /住宿 200\.00/.test(mixed.itemName) && /交通 50\.00/.test(mixed.itemName),
    mixed.itemName);

  // 含税排版：明细行是不含税金额（200 含 6% → 188.68 + 11.32 税额），
  // 两行之和 240 ≠ 250，仍应按比例拆出 200/50 上下（容差 1 分内归一到总额）。
  const mixedTaxed = await recognize(`电子发票 发票号码：26332000001234567896 开票日期：2026年06月11日
    购买方 名称：某某公司 *生产生活服务*代订住宿费 1 188.68 188.68 6% 11.32
    *交通运输服务*客运服务费 1 45.87 45.87 9% 4.13
    价税合计（大写）贰佰伍拾圆整 （小写）¥250.00
    备注：入住2026年06月02日 退房06月03日`, '混合含税票.pdf');
  const mtL = (mixedTaxed.splits || []).find(s => s.kind === 'lodging');
  check('不含税明细行也按比例拆（住宿 ≈200）', !!mtL && Math.abs(mtL.amount - 200) <= 0.5, mtL && mtL.amount);

  // 明细行认不全（有一行既不是住宿也不是交通）→ 不拆，宁可整笔进一列
  const mixedUnclear = await recognize(`电子发票 发票号码：26332000001234567897 开票日期：2026年06月11日
    *生产生活服务*代订住宿费 200.00 *信息技术服务*技术服务费 50.00
    价税合计（小写）¥250.00`, '混合不明票.pdf');
  check('明细行含无法归类的项目 → 不拆票', !mixedUnclear.splits,
    mixedUnclear.splits ? JSON.stringify(mixedUnclear.splits) : 'null');

  // 两行都是交通（一张发票开了两段行程）→ 没有住宿，不算混合票
  const twoLegs = await recognize(`电子发票 发票号码：26332000001234567898 开票日期：2026年06月11日
    *交通运输服务*客运服务费 30.00 *交通运输服务*客运服务费 20.00
    价税合计（小写）¥50.00`, '两段行程.pdf');
  check('两行都是交通 → 不拆票', !twoLegs.splits, twoLegs.splits ? 'splits' : 'null');

  // 项目名被 pdf.js 拆成多个文本项（真票上很常见：携程代订票拆成「*生产生活服务*经纪代理」
  // + 「服务*代订住宿费」，有的版式干脆拆成「*」+「住宿服务」+「*住宿费」）。
  // 星号标记只在「本行已读到金额/税率」时才算新行，否则当项目名续接，
  // 否则一个项目被劈成两行，金额只认到半截，整张混合票就不拆了。
  const splitName = await recognize(`电子发票 发票号码：26332000001234567899 开票日期：2026年06月11日
    * *住宿服务 *住宿费 200.00
    *交通运输服务*客运服务费 50.00
    价税合计（小写）¥250.00
    备注：入住2026年06月02日 退房06月03日`, '携程商旅发票2.pdf');
  const snL = (splitName.splits || []).find(s => s.kind === 'lodging');
  const snT = (splitName.splits || []).find(s => s.kind === 'transportOther');
  check('项目名被拆成多个文本项时仍能拆行',
    !!snL && !!snT && Math.abs(snL.amount - 200) < 0.005 && Math.abs(snT.amount - 50) < 0.005,
    splitName.splits ? JSON.stringify(splitName.splits) : 'null');

  // 机票与住宿开在同一张票上：机票应进「普票费」，而拆票只会写住宿费/车船费-其他两列。
  // 硬拆会把机票钱写进车船费-其他（错列且难发现），所以直接放弃拆票。
  const airMixed = await recognize(`电子发票 发票号码：26332000001234567900 开票日期：2026年06月11日
    旅客运输服务 *生产生活服务*代订住宿费 600.00 *航空运输服务*机票款 880.00
    价税合计（小写）¥1480.00`, '机票酒店合并票.pdf');
  check('机票+住宿同票 → 不拆票（机票进普票费，不能混进车船费-其他）',
    !airMixed.splits, airMixed.splits ? JSON.stringify(airMixed.splits) : 'null');

  // ----------------------------------------------------------------
  // 金额来源 amountSource：决定「金额」这一格到底信谁
  //   票面写了「价税合计（小写）」= 法定总额（total），识别结果可以压过 React 解析器；
  //   只有「金额：」这类散字段 = 按行打分猜的（guess），猜错了不能连累报销单，
  //   所以主流程仍让 React 的数先上，只在两个数打架时提示用户核对。
  // ----------------------------------------------------------------
  console.log('\n=== 金额来源：只有票面价税合计才算「可信」 ===');
  check('携程票（有价税合计）→ amountSource=total', ctrip.amountSource === 'total', ctrip.amountSource);
  check('直营酒店票（有价税合计）→ amountSource=total', direct.amountSource === 'total', direct.amountSource);

  const guessOnly = await recognize(
    `电子发票 发票号码：26332000001234567900 开票日期：2026年06月05日
     *信息技术服务*技术服务费 100.00
     金额：¥88.50 税率：6% 税额：¥5.31`,
    '技术服务费.pdf');
  check('只有「金额：」无价税合计 → amountSource=guess', guessOnly.amountSource === 'guess',
    guessOnly.amountSource + ' / ' + guessOnly.amount);

  check('行程单 → amountSource=trip（金额取核对金额）', sheet.amountSource === 'trip', sheet.amountSource);

  // 完全读不到金额时不能假装可信
  const noAmount = await recognize('电子发票 发票号码：26332000001234567901 开票日期：2026年06月05日 购买方 某某公司',
    '识别失败发票.pdf');
  check('读不到任何金额 → amountSource 不是 total',
    noAmount.amountSource !== 'total', noAmount.amountSource + ' / ' + noAmount.amount);

  // 铁路电子客票的真实排版：「票价:」标签后紧跟的是座位号/乘车人/电子客票号，
  // 「￥12.00」单独印在版尾 —— 「票价」正则匹配不到数字，只能靠全票唯一金额兜底。
  // 全票只有一个金额时没有歧义，不能算「猜」，否则每张火车票都要弹一次核对提示。
  const railSole = await recognize(
    `电子发票（铁路电子客票） 发票号码：26339131724000109394 开票日期：2026年06月04日
     德清 站 杭州东 站 G7625 2026年06月02日 08:10开 13车05D号
     票价: 二等座 3308211999****2355 郑圣龙 电子客票号:3172493086060295700892026
     ￥ 12.00`,
    '电子发票郑圣龙,德清 - 杭州东,票价.pdf');
  check('铁路票「票价:」与金额分开印 → 全票唯一金额，amountSource=sole',
    railSole.amountSource === 'sole' && railSole.amount === 12,
    railSole.amountSource + ' / ' + railSole.amount);

  // 多个 ¥ 金额互相竞争又没有价税合计 → 只能取最大，属于「猜」，必须提示用户核对
  const multiAmt = await recognize(
    `电子发票 发票号码：26332000001234567902 开票日期：2026年06月05日
     *经纪代理服务*服务费 ¥100.00 税额 ¥6.00 合计 ¥106.00`,
    '多金额票.pdf');
  check('多个 ¥ 金额竞争且无价税合计 → amountSource=yen（需人工核对）',
    multiAmt.amountSource === 'yen', multiAmt.amountSource + ' / ' + multiAmt.amount);

  // ----------------------------------------------------------------
  // 金额仲裁（utils.pickAmount）：识别结果 vs React 解析器，谁说了算
  //   · 有价税合计 → 识别结果优先（法定总额），并把 React 的数挂成提示
  //   · 只是打分猜的 → React 先上，把识别结果挂成提示
  //   · 两边一致 / 只有一边有 → 不出提示
  // ----------------------------------------------------------------
  console.log('\n=== 金额仲裁：价税合计说了算，猜测值不顶别人 ===');
  const p1 = table.utils.pickAmount({ amount: 261, amountSource: 'total' }, 218);
  check('有价税合计 + React 读错 → 采用识别结果 261', p1.amount === 261, String(p1.amount));
  check('…并把 React 的 218 挂成提示（不静默丢弃）',
    p1.amountAlt === 218 && p1.amountAltFrom === 'react', p1.amountAlt + ' / ' + p1.amountAltFrom);

  const p2 = table.utils.pickAmount({ amount: 88.5, amountSource: 'guess' }, 100);
  check('只是打分猜的金额 → 让 React 先上 100', p2.amount === 100, String(p2.amount));
  check('…把猜测的 88.5 挂成提示',
    p2.amountAlt === 88.5 && p2.amountAltFrom === 'recognition', p2.amountAlt + ' / ' + p2.amountAltFrom);

  const p3 = table.utils.pickAmount({ amount: 12, amountSource: 'total' }, 12);
  check('两边一致 → 不出分歧提示', p3.amount === 12 && p3.amountAlt == null, String(p3.amountAlt));

  const p4 = table.utils.pickAmount({ amount: 12, amountSource: 'total' }, null);
  check('React 没给金额 → 用识别结果且不提示', p4.amount === 12 && p4.amountAlt == null,
    p4.amount + ' / ' + p4.amountAlt);

  const p5 = table.utils.pickAmount({}, 33.33);
  check('识别失败（无缓存）→ 用 React 的数且不提示', p5.amount === 33.33 && p5.amountAlt == null,
    String(p5.amount));

  const p6 = table.utils.pickAmount({ amount: 12, amountSource: 'sole' }, 15);
  check('全票唯一金额也按可信处理（铁路票不会被 React 的低数顶掉）', p6.amount === 12, String(p6.amount));

  console.log('\n=== 结果：' + pass + ' 通过 / ' + fail + ' 失败 ===');
  process.exit(fail ? 1 : 0);
})();
