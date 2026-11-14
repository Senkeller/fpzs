/*
 * 二次开发验证脚本：行程单半页裁剪
 * ------------------------------------------------------------------
 * 用法：
 *   node verify-trip-crop.js
 *   PDF_LIB_PATH=/path/to/pdf-lib.min.js node verify-trip-crop.js
 *
 * 说明：
 *   - 只依赖 Node.js（无第三方依赖也能跑完 decide 分支单测）；
 *   - 若能找到 pdf-lib（require('pdf-lib') 或 PDF_LIB_PATH 指向 UMD 文件），
 *     会额外生成一份模拟 A4 行程单 PDF，验证 CropBox 修改与合并嵌入路径；
 *   - 本脚本不修改项目任何文件，可随时删除。
 */
'use strict';

const path = require('path');

/* ---------- 1. Mock 浏览器环境后加载业务模块 ---------- */
global.window = global;
global.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {}
};
global.Blob = class MockBlob {
  constructor() {}
  async arrayBuffer() { return new ArrayBuffer(0); }
};
global.document = {
  readyState: 'loading',
  addEventListener: () => {},
  getElementById: () => null,
  createElement: () => ({
    style: {}, innerHTML: '', textContent: '',
    appendChild() {}, setAttribute() {}, addEventListener() {},
    querySelector: () => null
  }),
  body: { appendChild() {} }
};

const core = require('./static/js/custom/trip-crop.js');
const CFG = core.config;

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  ' + extra : '')); }
}
function near(a, b, tol) { return Math.abs(a - b) <= (tol === undefined ? 1 : tol); }

const A4W = 595.28, A4H = 841.89;
const mkAnalysis = (o) => Object.assign({
  width: A4W, height: A4H, rotate: 0,
  contentBottom: 380, contentBottomMax: 380,
  textItems: 42, text: '行程单 里程 起步价 乘客 实付金额', pages: 1
}, o || {});

console.log('\n=== A. decide 决策分支 ===');
{
  const d = core.decide(mkAnalysis(), '滴滴出行行程单.pdf');
  check('A4 行程单（文件名命中）应裁剪', d.crop === true);
  check('裁剪高度取目标比例下限 421pt', d.crop && near(d.newH, A4W / CFG.targetRatio, 0.5),
    d.crop ? 'newH=' + d.newH.toFixed(1) : '');
  check('裁剪后比例对齐双联槽位', d.crop && near(d.croppedRatio, CFG.targetRatio, 0.01),
    d.crop ? 'ratio=' + d.croppedRatio.toFixed(3) : '');
}
{
  const d = core.decide(mkAnalysis({ contentBottom: 520 }), '打车_行程单_2026.pdf');
  check('内容超过半页时按内容边界裁剪', d.crop && near(d.newH, 520 + CFG.padding, 0.5),
    d.crop ? 'newH=' + d.newH.toFixed(1) : '');
}
{
  const d = core.decide(mkAnalysis({ text: '普通说明文字', contentBottom: 300 }), 'scan_001.pdf');
  check('无关键词但内容集中上半页 → 仍裁剪', d.crop === true);
}
{
  const d = core.decide(mkAnalysis({ width: 683, height: 504, contentBottom: 240 }), '增值税电子普通发票.pdf');
  check('非 A4 的发票 → 跳过', d.crop === false && /非 A4/.test(d.reason), d.reason);
}
{
  const d = core.decide(mkAnalysis({ text: '合同正文', contentBottom: 800 }), 'contract.pdf');
  check('A4 满页文档且无行程单特征 → 跳过', d.crop === false, d.reason);
}
{
  const d = core.decide(mkAnalysis({ rotate: 90 }), '行程单.pdf');
  check('旋转页 → 跳过', d.crop === false, d.reason);
}
{
  const d = core.decide(null, 'x.pdf');
  check('无文本层 → 跳过', d.crop === false, d.reason);
}
{
  const d = core.decide(mkAnalysis({ contentBottom: 40 }), '行程单.pdf');
  check('内容过少 → 跳过', d.crop === false, d.reason);
}
{
  // 来自 verify-pdf-assets.js 的实测：3 份行程单都是 A4 竖版；4 张发票里
  // 3 张非 A4，但「滴滴出行电子发票.pdf」同样是 595.3×841.9 且命中平台关键词，
  // 曾经会被误裁掉下半页。这里固定为回归用例。
  const tripNames = [
    '网约车A_打车电子行程单.pdf',
    '网约车B_打车电子行程单.pdf',
    '网约车C_滴滴出行行程报销单.pdf'
  ];
  tripNames.forEach((n) => {
    const d = core.decide(mkAnalysis(), n);
    check('真实行程单文件名 → 裁剪  ' + n.slice(0, 14), d.crop === true, d.reason || '');
  });
  const dInv = core.decide(mkAnalysis(), '滴滴出行电子发票.pdf');
  check('A4 竖版的电子发票 → 不误裁', dInv.crop === false && /发票/.test(dInv.reason), dInv.reason);
  const dFull = core.decide(mkAnalysis({ contentBottom: 800 }), '滴滴出行.pdf');
  check('A4 且命中平台关键词但内容满页 → 跳过', dFull.crop === false, dFull.reason);
}

/* ---------- 2. 尝试加载 pdf-lib ---------- */
let PDFLib = null;
try {
  if (process.env.PDF_LIB_PATH) {
    PDFLib = require(path.resolve(process.env.PDF_LIB_PATH));
  } else {
    try { PDFLib = require('pdf-lib'); }
    catch (e) {
      const os = require('os');
      PDFLib = require(path.join(os.tmpdir(), 'trip-crop-verify', 'pdf-lib.min.js'));
    }
  }
} catch (e) {
  PDFLib = null;
}

if (!PDFLib) {
  console.log('\n=== B. PDF 字节级验证：跳过（未找到 pdf-lib）===');
  console.log('  提示：npm i pdf-lib，或用 PDF_LIB_PATH=/.../pdf-lib.min.js 指定 UMD 文件后重跑。');
} else {
  global.PDFLib = PDFLib;
  (async () => {
    console.log('\n=== B. 真实 PDF：CropBox 修改与合并嵌入 ===');

    const doc = await PDFLib.PDFDocument.create();
    const page = doc.addPage([A4W, A4H]);
    const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
    // 只在 A4 上半部分写内容，模拟打车行程单
    page.drawText('TRIP ITINERARY', { x: 50, y: 780, size: 18, font });
    page.drawText('Distance: 12.5 km   Fare: 36.80', { x: 50, y: 740, size: 12, font });
    page.drawText('Pickup: 09:20   Dropoff: 09:48', { x: 50, y: 715, size: 12, font });
    page.drawText('Amount: CNY 36.80', { x: 50, y: 560, size: 12, font });
    const bytes = await doc.save();
    const original = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

    const before = await PDFLib.PDFDocument.load(original);
    const p0 = before.getPage(0);
    const mb0 = p0.getMediaBox(), cb0 = p0.getCropBox();
    check('原始 PDF 为 A4', near(mb0.width, A4W, 0.1) && near(mb0.height, A4H, 0.1));
    check('原始 CropBox 等于 MediaBox', near(cb0.height, mb0.height, 0.1));

    const d = core.decide(mkAnalysis(), '行程单_2026.pdf');
    const outBuf = await core.applyCrop(original, d.newH);
    check('applyCrop 返回新字节', !!outBuf && outBuf.byteLength > 1000,
      outBuf ? outBuf.byteLength + ' bytes' : '');

    const after = await PDFLib.PDFDocument.load(outBuf);
    const p1 = after.getPage(0);
    const mb1 = p1.getMediaBox(), cb1 = p1.getCropBox();
    check('MediaBox 保持不变（合并逻辑依赖它做判断）',
      near(mb1.width, A4W, 0.1) && near(mb1.height, A4H, 0.1));
    check('CropBox 高度 = 目标高度', near(cb1.height, d.newH, 0.5),
      'cropH=' + cb1.height.toFixed(1));
    check('CropBox 贴住页面顶部（保留上半部分）',
      near(cb1.y + cb1.height, mb1.y + mb1.height, 0.5),
      'top=' + (cb1.y + cb1.height).toFixed(1));

    // 复刻 static/js/alert-dialog.js 的合并判断
    const useBBox = cb1.height < mb1.height * 0.95;
    check('命中合并逻辑的 CropBox 分支', useBBox,
      cb1.height.toFixed(1) + ' < ' + (mb1.height * 0.95).toFixed(1));

    const bbox = {
      left: cb1.x, bottom: cb1.y,
      right: cb1.x + cb1.width, top: cb1.y + cb1.height
    };
    const merged = await PDFLib.PDFDocument.create();
    let embedded = null;
    try {
      [embedded] = await merged.embedPages([p1], [bbox]);
    } catch (e) {
      console.log('  (embedPages 报错: ' + e.message + ')');
    }
    check('embedPages 按 bbox 得到半页尺寸', !!embedded &&
      near(embedded.width, A4W, 1) && near(embedded.height, d.newH, 1),
      embedded ? embedded.width.toFixed(1) + ' x ' + embedded.height.toFixed(1) : 'null');

    // 缩放对比：合并逻辑为 min(A4W/vw, halfH/vh) * 0.95
    const halfH = A4H / 2;
    const scaleBefore = Math.min(A4W / mb0.width, halfH / mb0.height) * 0.95;
    const scaleAfter = embedded
      ? Math.min(A4W / embedded.width, halfH / embedded.height) * 0.95
      : null;
    check('裁剪后内容放大约 2 倍', scaleAfter && scaleAfter / scaleBefore > 1.8,
      scaleAfter ? 'scale ' + scaleBefore.toFixed(3) + ' -> ' + scaleAfter.toFixed(3) : '');

    console.log('\n=== 结果 ===');
    console.log('  ' + pass + ' passed, ' + fail + ' failed');
    process.exit(fail ? 1 : 0);
  })().catch((e) => {
    console.error('验证脚本异常:', e);
    process.exit(1);
  });
}

if (!PDFLib) {
  console.log('\n=== 结果 ===');
  console.log('  ' + pass + ' passed, ' + fail + ' failed（仅决策分支）');
  process.exit(fail ? 1 : 0);
}
