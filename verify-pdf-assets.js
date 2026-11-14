'use strict';
/*
 * 真实票据 PDF「文件结构」校验（零依赖，仅用 Node 内置模块）
 * ------------------------------------------------------------------
 * 背景：verify-real-nanning.js 里的 7 份票据识别结果是固化常量，脚本本身
 *       不解析 PDF。本脚本补上「磁盘上的 PDF 到底是什么样」这一层，用来
 *       验证 trip-crop.js 的裁剪前提（A4 竖版、含文本层、MediaBox 尺寸）。
 *
 * ⚠️ 覆盖边界：只校验文件结构与文本流存在性，**不校验文本提取是否正确**。
 *    字段识别（金额 / 日期 / 项目）仍需用真实票据在浏览器里人工验证。
 *
 * 目录缺失（例如刚 clone 仓库，票据被 .gitignore 排除）时打印 SKIP 并正常退出，
 * 不阻断 npm test，但会明确提示覆盖缺口。
 *
 * 用法：node verify-pdf-assets.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DIR = path.join(__dirname, '2026-9 南宁');
const A4_W = 595.28;
const A4_H = 841.89;
const TOL = 3;

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  ' + extra : '')); }
}

/** 提取所有 stream，并对 FlateDecode 的流做解压，返回可搜索的 latin1 文本池 */
function inspectStreams(buf) {
  const pool = [];
  let decompressed = 0;
  let textStreams = 0;
  // 必须用 latin1（1 字节 = 1 字符）再跑正则：直接 exec(Buffer) 会按 UTF-8
  // 解码，二进制流里的非 ASCII 字节会让所有下标错位。
  // \b 则是为了避免把 endstream 里的 "stream" 当成新流起点。
  const latin = buf.toString('latin1');
  const re = /\bstream\r?\n/g;
  let m;
  while ((m = re.exec(latin)) !== null) {
    const start = m.index + m[0].length;
    const end = latin.indexOf('endstream', start);
    if (end < 0) { re.lastIndex = start; continue; }
    const dict = latin.slice(Math.max(0, m.index - 600), m.index);
    const raw = buf.slice(start, end);
    if (/\/FlateDecode/.test(dict)) {
      let data = null;
      try { data = zlib.inflateSync(raw, { finishFlush: zlib.constants.Z_SYNC_FLUSH }); }
      catch (e) {
        try { data = zlib.inflateSync(raw.toString('latin1').replace(/\s+$/, ''), { finishFlush: zlib.constants.Z_SYNC_FLUSH }); }
        catch (_) { /* 非 zlib 或已损坏，跳过 */ }
      }
      if (data) {
        const text = data.toString('latin1');
        decompressed++;
        pool.push(text);
        if (/\bBT\b/.test(text) && /\bT[jJ]\b/.test(text)) textStreams++;
      }
    }
    re.lastIndex = end + 9;
  }
  return { pool: pool.join('\n'), decompressed, textStreams };
}

function parseMediaBox(text) {
  const m = /\/MediaBox\s*\[\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\]/.exec(text);
  if (!m) return null;
  const [x1, y1, x2, y2] = m.slice(1).map(Number);
  return { w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
}

function parsePageCount(text) {
  const counts = [...text.matchAll(/\/Type\s*\/Pages\b[\s\S]{0,400}?\/Count\s+(\d+)/g)]
    .map(x => Number(x[1]));
  if (counts.length) return Math.max(...counts);
  const pages = (text.match(/\/Type\s*\/Page\b(?!s)/g) || []).length;
  return pages || null;
}

console.log('\n=== 真实票据 PDF 结构校验（仅结构，不校验文本提取） ===');
if (!fs.existsSync(DIR)) {
  console.log('  [SKIP] 未找到 2026-9 南宁/（票据被 .gitignore 排除，属预期）');
  console.log('  [SKIP] 因此本次未验证 PDF 页尺寸 / 文本层，字段识别链路仍无自动化覆盖');
  console.log('\n=== 结果：0 通过 / 0 失败（样本缺失，已跳过） ===');
  process.exit(0);
}

const files = fs.readdirSync(DIR).filter(f => /\.pdf$/i.test(f)).sort();
if (files.length === 0) {
  console.log('  [SKIP] 2026-9 南宁/ 内没有 PDF');
  console.log('\n=== 结果：0 通过 / 0 失败（样本缺失，已跳过） ===');
  process.exit(0);
}

const rows = [];
for (const name of files) {
  const buf = fs.readFileSync(path.join(DIR, name));
  const head = buf.slice(0, 8).toString('latin1');
  const validHead = head.startsWith('%PDF-');
  const validTail = buf.slice(-2048).toString('latin1').includes('%%EOF');
  const st = inspectStreams(buf);
  const searchable = buf.toString('latin1') + '\n' + st.pool;
  const box = parseMediaBox(searchable);
  const pages = parsePageCount(searchable);
  const isTrip = /行程单|行程报销单/.test(name);
  const isA4 = !!box && Math.abs(box.w - A4_W) < TOL && Math.abs(box.h - A4_H) < TOL;
  const hasTextLayer = st.textStreams > 0 || /\/ToUnicode/.test(searchable);

  rows.push({ name, size: buf.length, box, pages, isTrip, isA4, hasTextLayer, streams: st.decompressed });

  const tag = name.slice(0, 22);
  check(tag + ' · 有效 PDF 头尾', validHead && validTail);
  check(tag + ' · 含可解压内容流', st.decompressed > 0, st.decompressed + ' 个');
  check(tag + ' · 含文本层证据', hasTextLayer, '文本流 ' + st.textStreams + ' 个');
  check(tag + ' · 可提取 MediaBox 与页数', !!box && !!pages,
    box ? box.w.toFixed(1) + '×' + box.h.toFixed(1) + 'pt, ' + pages + ' 页' : '未找到');
}

console.log('\n=== 尺寸汇总（trip-crop.js 的裁剪前提） ===');
for (const r of rows) {
  const dim = r.box ? (r.box.w.toFixed(1) + '×' + r.box.h.toFixed(1)).padStart(14) : '            ?';
  console.log('  ' + dim + ' pt  ' + (r.isA4 ? 'A4竖版' : '非 A4  ') + '  ' +
    (r.isTrip ? '行程单' : '发  票') + '  ' + r.pages + '页  ' + r.name.slice(0, 28));
}

const trips = rows.filter(r => r.isTrip);
const invoices = rows.filter(r => !r.isTrip);
const a4Trips = trips.filter(r => r.isA4);
const nonA4Invoices = invoices.filter(r => !r.isA4);

console.log('\n=== 汇总断言 ===');
check('共 7 份真实票据', rows.length === 7, '实际 ' + rows.length + ' 份');
check('识别为 3 份行程单 + 4 张发票', trips.length === 3 && invoices.length === 4,
  trips.length + ' / ' + invoices.length);
check('行程单均为 A4 竖版（裁剪模块生效前提）', a4Trips.length === trips.length,
  a4Trips.length + '/' + trips.length);
check('至少 1 张发票非 A4（不会被误裁）', nonA4Invoices.length >= 1,
  nonA4Invoices.length + ' 张');
check('所有票据都含文本层（非扫描件）', rows.every(r => r.hasTextLayer),
  rows.filter(r => r.hasTextLayer).length + '/' + rows.length);

console.log('\n  ⚠️ 本脚本不校验字段识别结果；金额 / 日期 / 项目提取请在浏览器里用真实票据验证。');
console.log('\n=== 结果：' + pass + ' 通过 / ' + fail + ' 失败 ===');
process.exit(fail ? 1 : 0);
