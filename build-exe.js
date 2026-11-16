'use strict';
/*
 * 把「发票打印助手」构建成 Windows 单文件 exe（Node 22 Single Executable Application）
 *
 *   node build-exe.js
 *
 * 产物：dist/InvoiceHelper.exe
 * 原理：把 main.html + 404.html + 图标 + static/ 下全部资源作为 SEA assets 嵌进
 *       node.exe 的 PE 资源节；运行时用 node:sea.getAsset 读文件，不释放临时目录、
 *       不需要 Node 运行时、不需要联网。
 *
 * 注意：Node SEA 的 embedderRequire 不支持相对 require，所以本脚本会把
 *       safe-path.js 内联成 .workbuddy/build/portable-server.bundle.js 作为入口。
 *       改过 safe-path.js / portable-server.js 后必须重新执行本脚本。
 *
 * 依赖：仅构建时需要 postject（自动装到 .workbuddy/build/，不污染项目 package.json）。
 *       生成的 exe 运行时零依赖。
 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const ROOT = __dirname;
const BUILD = path.join(ROOT, '.workbuddy', 'build');
const DIST = path.join(ROOT, 'dist');
const EXE = path.join(DIST, 'InvoiceHelper.exe');
const BLOB = path.join(BUILD, 'sea-prep.blob');
const FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

fs.mkdirSync(BUILD, { recursive: true });
fs.mkdirSync(DIST, { recursive: true });

// ---- 1. 收集需要嵌入的静态资源（不含样例票据、测试脚本、文档、服务端源码） ----
const TOP = ['main.html', '404.html', 'manifest.json', 'favicon.ico',
  'apple-icon.png', 'icon0.svg', 'icon1.png'];
const files = TOP.filter(f => fs.existsSync(path.join(ROOT, f)));

function walk(dir) {
  for (const name of fs.readdirSync(path.join(ROOT, dir))) {
    const rel = path.join(dir, name);
    const st = fs.statSync(path.join(ROOT, rel));
    if (st.isDirectory()) walk(rel);
    else if (st.isFile()) files.push(rel);
  }
}
walk('static');

// assets 的 key 是运行时 sea.getAsset(key) 用的相对路径，value 用绝对路径，
// 这样配置文件可以放在 .workbuddy/build/ 而不影响资源定位。
const assets = {};
let bytes = 0;
for (const f of files) {
  const key = f.split(path.sep).join('/');
  assets[key] = path.join(ROOT, f);
  bytes += fs.statSync(path.join(ROOT, f)).size;
}
console.log('Embed ' + files.length + ' files, ' + (bytes / 1024 / 1024).toFixed(2) + ' MiB');

// ---- 2. 生成 SEA 入口 ----
// Node SEA 的 embedderRequire 只解析内置模块，require('./safe-path.js') 会抛
// ERR_UNKNOWN_BUILTIN_MODULE。因此构建时把 safe-path.js 内联成单文件入口：
// 源码仍只有一份（server.js 直接 require 它），exe 拿到的是打包副本。
function buildSeaEntry() {
  const portable = fs.readFileSync(path.join(ROOT, 'portable-server.js'), 'utf8');
  const safe = fs.readFileSync(path.join(ROOT, 'safe-path.js'), 'utf8');
  const marker = /^const \{[^}]+\} = require\('\.\/safe-path\.js'\);$/m;
  if (!marker.test(portable)) throw new Error('未找到 safe-path.js 的 require 行，无法内联');
  const inlined = [
    '/* safe-path.js inlined by build-exe.js — Node SEA 不支持相对 require */',
    'const { MIME, FALLBACK_PAGE, legacyRedirect, toAsset, resolveSafe } = (function () {',
    '  const module = { exports: {} };',
    safe,
    '  return module.exports;',
    '})();',
  ].join('\n');
  const out = path.join(BUILD, 'portable-server.bundle.js');
  fs.writeFileSync(out, portable.replace(marker, inlined));
  return out;
}
const SEA_MAIN = buildSeaEntry();
console.log('SEA entry: ' + path.relative(ROOT, SEA_MAIN));

// ---- 3. 生成 SEA 配置并产出 blob（配置是构建产物，只放构建目录） ----
const cfg = {
  main: SEA_MAIN,
  output: BLOB,
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,
  assets,
};
const cfgPath = path.join(BUILD, 'sea-config.json');
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
cp.execFileSync(process.execPath, ['--experimental-sea-config', cfgPath],
  { cwd: ROOT, stdio: 'inherit' });
if (!fs.existsSync(BLOB)) throw new Error('SEA blob 未生成');
console.log('Blob: ' + (fs.statSync(BLOB).size / 1024 / 1024).toFixed(2) + ' MiB');

// ---- 4. 复制 node.exe 作为 exe 外壳 ----
fs.copyFileSync(process.execPath, EXE);
console.log('Base exe: ' + (fs.statSync(EXE).size / 1024 / 1024).toFixed(2) + ' MiB');

// ---- 5. postject 注入资源节 ----
const cli = path.join(BUILD, 'node_modules', 'postject', 'dist', 'cli.js');
const needInstall = !fs.existsSync(cli)
  || !fs.existsSync(path.join(BUILD, 'node_modules', 'resedit', 'dist', 'index.js'))
  || !fs.existsSync(path.join(BUILD, 'node_modules', 'png-to-ico', 'index.js'));
if (needInstall) {
  console.log('Installing build-time deps (postject, resedit, png-to-ico) ...');
  cp.execSync('npm install --prefix "' + BUILD + '" postject resedit png-to-ico --no-audit --no-fund --loglevel=error',
    { cwd: ROOT, stdio: 'inherit' });
}
if (!fs.existsSync(cli)) throw new Error('postject 安装失败：' + cli);
cp.execFileSync(process.execPath, [cli, EXE, 'NODE_SEA_BLOB', BLOB, '--sentinel-fuse', FUSE],
  { cwd: ROOT, stdio: 'inherit' });

// ---- 6. 注入图标 + 版本信息（纯 JS，免外部原生工具；可选 GUI=1 隐藏控制台窗口）----
console.log('Embedding icon & version info ...');
const metaArgs = [path.join(ROOT, 'tools', 'set-exe-metadata.mjs'), EXE];
if (process.env.GUI) metaArgs.push('--gui');
cp.execFileSync(process.execPath, metaArgs, { cwd: ROOT, stdio: 'inherit' });

console.log('');
console.log('DONE: ' + EXE + '  (' + (fs.statSync(EXE).size / 1024 / 1024).toFixed(2) + ' MiB)');
console.log('Double-click it, or run:  set NO_BROWSER=1 && "' + EXE + '"');
if (process.env.GUI) console.log('GUI 模式已启用：双击无黑窗口，退出请访问 http://127.0.0.1:8000/__quit');
