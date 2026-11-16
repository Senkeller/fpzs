import fs from 'fs';
import path from 'path';
import url from 'url';
import { pathToFileURL } from 'url';
import * as ResEdit from '../.workbuddy/build/node_modules/resedit/dist/index.js';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const exePath = process.argv[2] || path.join(ROOT, 'dist', 'InvoiceHelper.exe');
// 图标路径：取 argv 中既不是 exe 也不是 -- 开头 flag 的那个；否则用默认 app-icon.ico
const icoPath = (process.argv.slice(2).find((a) => a !== exePath && !a.startsWith('--'))) || path.join(ROOT, 'app-icon.ico');
const GUI = process.argv.includes('--gui') || !!process.env.GUI;

if (!fs.existsSync(exePath)) { console.error('exe 不存在:', exePath); process.exit(1); }

// ---- 若无 ico，从品牌图 apple-icon.png 生成多尺寸 ico ----
if (!fs.existsSync(icoPath)) {
  const src = path.join(ROOT, 'apple-icon.png');
  if (!fs.existsSync(src)) { console.error('缺少图标源文件:', src); process.exit(1); }
  const pngToIco = (await import(pathToFileURL(path.join(ROOT, '.workbuddy', 'build', 'node_modules', 'png-to-ico', 'index.js')).href)).default;
  const buf = await pngToIco(src, { sizes: [16, 24, 32, 48, 64, 128, 256] });
  fs.writeFileSync(icoPath, buf);
  console.log('已生成图标:', icoPath, '(' + buf.length + ' bytes)');
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const ver = String(pkg.version || '1.0.0').split('-')[0];
const [ma, mi, pa] = ver.split('.').map(Number);
const fv = [ma || 0, mi || 0, pa || 0, 0];

const data = fs.readFileSync(exePath);
const beforeSize = data.length;

const exe = ResEdit.NtExecutable.from(data, { ignoreCert: true });
const res = ResEdit.NtExecutableResource.from(exe);

// ---- 图标：复用现有图标组 ID=1 / lang=1033，替换成多尺寸 ico ----
const iconFile = ResEdit.Data.IconFile.from(fs.readFileSync(icoPath));
ResEdit.Resource.IconGroupEntry.replaceIconsForResource(
  res.entries, 1, 1033, iconFile.icons.map((item) => item.data)
);

// ---- 版本信息：zh-CN (lang 2052) + UTF-16 代码页 1200 ----
const viList = ResEdit.Resource.VersionInfo.fromEntries(res.entries);
let vi = viList[0];
if (!vi) vi = ResEdit.Resource.VersionInfo.create();
vi.setFileVersion(fv[0], fv[1], fv[2], fv[3], 2052);
vi.setProductVersion(fv[0], fv[1], fv[2], fv[3], 2052);
vi.setStringValues({ lang: 2052, codepage: 1200 }, {
  FileDescription: '发票打印助手 · 本地单文件便携版',
  ProductName: '发票打印助手',
  CompanyName: 'fpzs',
  LegalCopyright: 'Copyright © All Rights Reserved',
  InternalName: 'InvoiceHelper',
  OriginalFilename: 'InvoiceHelper.exe',
});
vi.outputToResourceEntries(res.entries);

res.outputResource(exe);
const generated = exe.generate(); // pe-library 返回 ArrayBuffer
const out = generated instanceof ArrayBuffer ? new Uint8Array(generated) : generated;

// ---- 可选：隐藏黑色控制台窗口（GUI 子系统）----
if (GUI) {
  const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const e_lfanew = dv.getUint32(0x3c, true);
  const subOff = e_lfanew + 0x5c; // COFF + 可选头 + Subsystem 字段
  if (dv.getUint16(subOff, true) === 3) dv.setUint16(subOff, 2, true); // 3=控制台 -> 2=窗口
  console.log('GUI 模式：已隐藏控制台窗口（退出请访问 /__quit 或任务管理器结束进程）');
}

const afterSize = out.length;

// ---- 安全检查：SEA 数据必须保留；体积不能大幅缩水 ----
const reParse = ResEdit.NtExecutable.from(Buffer.from(out), { ignoreCert: true });
const reRes = ResEdit.NtExecutableResource.from(reParse);
const hasBlob = reRes.entries.some((e) => e.type === 10);
if (!hasBlob) { console.error('致命：SEA 数据(NODE_SEA_BLOB)丢失，中止写入'); process.exit(2); }
if (afterSize < beforeSize * 0.9) { console.error('致命：产物体积异常缩小，疑似资源丢失，中止写入'); process.exit(3); }

fs.writeFileSync(exePath, Buffer.from(out));
console.log('OK: 已写入图标 + 版本信息');
console.log('  文件大小', (Number(beforeSize) / 1048576).toFixed(2), '->', (Number(afterSize) / 1048576).toFixed(2), 'MiB');
console.log('  NODE_SEA_BLOB 保留:', hasBlob);
