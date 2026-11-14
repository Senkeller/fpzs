<div align="center">

# 🧾 发票打印助手 · 本地定制版

**电子发票 / 打车行程单批量合并打印工具 —— 智能合并 · 自动识别 · 差旅报销单 · 一键打印**

所有数据在浏览器本地处理，不上传服务器、不登录、无使用限制，**运行时零外部网络请求**。

![版本](https://img.shields.io/badge/version-6.1.0%20custom-16a34a?style=flat-square)
![许可](https://img.shields.io/badge/license-All%20Rights%20Reserved-d97706?style=flat-square)
![离线](https://img.shields.io/badge/离线-完全可用-0f9d6a?style=flat-square)
![纯前端](https://img.shields.io/badge/纯前端-静态站点-4338ca?style=flat-square)

</div>

> ⚠️ 本目录是基于上游公开项目做的**个人学习 / 研究用途二次开发版本**，不是官方发行版。
> 许可证为 **All Rights Reserved**，**禁止对外分发**（包括 `dist/*.exe` 与整个源码目录），详见文末。

---

## 📑 目录

- [✨ 亮点速览](#-亮点速览)
- [🆕 二次开发改动](#-二次开发改动)
- [⚡ 快速开始](#-快速开始)
- [🔄 使用流程](#-使用流程)
- [🧠 工作原理](#-工作原理)
- [🧳 便携版与离线说明](#-便携版与离线说明)
- [📦 部署方式](#-部署方式)
- [🧪 验证与覆盖边界](#-验证与覆盖边界)
- [🗂️ 项目结构](#️-项目结构)
- [🛠️ 技术架构](#️-技术架构)
- [🧱 自定义业务模块](#-自定义业务模块)
- [❓ 常见问题](#-常见问题)
- [🔧 故障排除](#-故障排除)
- [📜 许可证与版权](#-许可证与版权)

---

## ✨ 亮点速览

| | 能力 | 说明 |
|:---:|:---|:---|
| 📥 | **批量合并** | 拖入多份 PDF，自动排进 A4 双联版面（每页 2 张） |
| ✂️ | **行程单半页裁剪** | A4 行程单自动裁去下半页空白，归一化到与发票一致的展示比例 |
| 🔍 | **自动识别** | 提取金额、日期、项目名称，实时统计合计 |
| 📄 | **差旅报销单** | 表格化清单：按出差日期归行、金额分类汇总、补贴自动计算 |
| 🖨️ | **一键打印** | 合并后一次输出，省掉逐张打开、逐张打印 |
| 📦 | **完全离线** | 三个 PDF 库、pdf.js worker、cmaps / 字体全部本地，运行时无 CDN 请求 |
| 🔒 | **隐私安全** | 全流程浏览器本地处理，票据不上传、不落服务端 |

---

## 🆕 二次开发改动

相对上游 v6.1.0，本目录的定制内容：

| 方向 | 改动 |
|---|---|
| **入口收敛** | 移除 `index.html` 落地页，`/` 直接返回 `main.html`；旧书签 `/index.html`、`/index.txt` 重定向到功能页 |
| **界面精简** | 移除「实用技巧」弹窗、顶部「返回首页」按钮、`Star on GitHub` 悬浮按钮、顶部访问信息统计挂件 |
| **行程单裁剪** | 新增 `static/js/custom/trip-crop.js`：识别 A4 竖版行程单 → 按内容边界裁 CropBox → 归一化比例，合并双联自动受益 |
| **报销单重构** | 拆出 `static/js/custom/expense-report-table.js`，改为按日期归行的差旅清单；移除中文大写、签章栏、记账凭证附件 |
| **生成前强制确认** | 自动 / 手动两条入口统一为「先确认再生成」：弹窗左侧实时预览报销单（含 ⚠ 超范围提示行），右侧逐张核对票据项目名 / 金额 / 归行日期；超范围票据必须改到出差范围内（或显式勾选保留）才能点「确认生成」。人工修正会缓存到下次生成 |
| **离线化** | `static/vendor/`（pdf-lib / html2canvas / jsPDF）+ `static/cmaps/` + `static/standard_fonts/` + 本地 worker，全项目无运行时外部请求 |
| **便携分发** | `portable-server.js`（普通 Node / SEA 两用）、`start.bat`、`build-exe.js` → `dist/InvoiceHelper.exe` |
| **安全加固** | `safe-path.js` 统一两个服务器的路径解析：修复路径穿越与畸形 URL 打崩进程；默认只绑 `127.0.0.1`；移除通配 CORS；收紧 `window.confirm` 全局劫持 |

<details>
<summary>上游版本历史（本定制版不再维护落地页）</summary>

- `v6.1.0` · 2026-07-10：官网首页「适用场景 / FAQ / 标签区 / SEO」优化 —— **该落地页在本目录已移除**
- `v6.0.x` · 2026-06-25：铁路电子客票适配（票价识别、站名排序、CropBox 倒置修复、detached ArrayBuffer 修复）

</details>

---

## ⚡ 快速开始

> ❗ **不能双击 `main.html` 用 `file://` 打开**：CSS / 字体 / webpack chunk 会被 CORS 拦截，pdf.js worker 与 cmaps 也读不到。必须走本地 HTTP 服务。

| 方式 | 操作 | 是否需要 Node |
|------|------|--------------|
| **单文件 exe（推荐）** | 双击 `dist/InvoiceHelper.exe` | 否，零依赖，约 98 MB |
| **一键脚本** | 双击 `start.bat` | 有系统 Node 时用 Node，否则自动改用 exe |
| **便携服务** | `node portable-server.js` | 是（Node 20+） |
| **开发 / 局域网** | `node server.js` | 是（Node 20+） |

启动后打开 **<http://127.0.0.1:8000/>**，关闭命令行窗口即停止。

> 🔐 **单实例守卫（便携版 / exe）**：重复启动不会新开窗口或端口。第二次启动会探测 8000 上的 `/__healthz` 健康端点，确认是本程序在跑后直接打开浏览器到已有实例并退出。只有 8000 空闲、或 8000 被**其他程序**占用时才会真正启动（后者自动顺延 +1）。如需强制多开，设 `MULTI_INSTANCE=1`。

```bash
npm start          # = node portable-server.js
npm run start:dev  # = node server.js
```

<details>
<summary>📋 环境变量 & 环境要求</summary>

| 变量 | 作用 |
|---|---|
| `PORT=8000` | 起始端口；便携版占用时自动顺延（先探测是否本程序，是则复用），`server.js` 则直接报错退出 |
| `MULTI_INSTANCE=1` | 便携版 / exe 关闭单实例守卫，恢复「端口被占就顺延」的旧多开行为 |
| `NO_BROWSER=1` | 不自动打开浏览器（无人值守 / 服务器场景） |
| `HOST=0.0.0.0` | **仅 `server.js`**：显式开放局域网访问。默认只绑 `127.0.0.1`，开放前请确认防火墙与网络环境 |

| 项目 | 要求 |
|------|------|
| 操作系统 | Windows 10 / 11（exe 为 x64） |
| 运行环境 | Node.js **20+**（构建单文件 exe 需要 **22+**，用到 Node SEA） |
| 浏览器 | Chrome / Edge（建议） |
| 磁盘空间 | 约 150 MB（含 exe） |

</details>

---

## 🔄 使用流程

```mermaid
flowchart LR
    A[📥 上传发票 / 行程单] --> B[✂️ 行程单半页裁剪]
    B --> C[🔍 自动合并 & 识别]
    C --> D[📄 生成报销单]
    D --> G["✏️ 强制确认窗口<br/>预览 + 核对票据日期]"
    G -->|超范围票据未修正| G
    G -->|确认无误| E[👁️ 生成并合并预览]
    C --> E
    E --> F[🖨️ 打印 / 下载]
```

| 流程 | 步骤 |
|------|------|
| **基本打印** | 上传 → 自动合并 A4 双联 → 预览 → 打印 / 下载 |
| **混合票据** | 上传发票 + 打车行程单 → 右下角「行程单半页裁剪」面板查看裁剪日志 → 合并 |
| **报销单** | 填写出差范围 / 地点 / 补贴 → 点「生成报销单」→ **强制确认窗口**：左侧预览清单、右侧逐张核对票据 → 把 ⚠ 超范围票据的「归行日期」改到出差范围内（或调整上方出差范围）→ 「确认生成」→ 与发票合并 → 下载 / 打印 |

> ⚠️ 两个生成按钮（含「生成并下载」）都会先打开确认窗口，**不确认不会生成任何 PDF**。超范围票据未修正时「确认生成」默认禁用；确属跨期票据可勾选「我已核对，允许保留超范围票据」后显式放行。人工改过的项目名 / 金额 / 归行日期会缓存，下次生成继续生效。
>
> 裁剪配置（目标宽高比、底部留白、开关）存在 `localStorage`，**改完设置需重新上传文件**（结果有缓存）。

---

## 🧠 工作原理

票据的**识别、裁剪、合并、打印全部在浏览器端完成**，服务端只负责吐静态文件：

- **文本提取**：`pdf.js` 读 PDF 文本层，正则匹配「价税合计 / 小写 / 支付金额 / 票价」等字段。扫描件（无文本层）无法识别。
- **行程单裁剪**：`trip-crop.js` 包装 `Blob.prototype.arrayBuffer`，在字节进入任何环节前用 pdf.js 定位内容底部、用 pdf-lib 改写 `CropBox`。合并逻辑发现 `cropBox.height < mediaBox.height * 0.95` 时按裁剪区嵌入，因此缩放系数约 `0.475 → 0.950`，内容放大近一倍。
- **坐标归一化**：部分票据 CropBox/MediaBox 坐标颠倒，读取前统一修正，避免预览倒置。
- **PDF 合并**：`pdf-lib` 把每张票据嵌入 A4 版面（每页 2 张），报销单利用奇数页空白区拼接。
- **零上传**：基于 `File API` + `ArrayBuffer`，关闭页面即清除。

---

## 🧳 便携版与离线说明

**结论：可以完全离线。** 前端是纯静态站点，服务端只有 Node 内置模块的百来行代码，没有数据库、没有后端 API、没有原生插件。

### 离线化改动

- `static/vendor/`：html2canvas 1.4.1、jsPDF 2.5.1、pdf-lib 1.17.1 随项目自带
- `static/js/pdf.worker.min.mjs`：本地 worker（同时改掉 `pdfjs-lib.js` 的默认值与 `_initialize()` 重置点）
- `static/cmaps/`（169 个）+ `static/standard_fonts/`（16 个）：pdf.js 中文字符映射与标准字体
- 断网实测：外部请求 0；真实票据上传 → 报销单 410.55 元 → 5 页合并 PDF 全链路通过

### 构建单文件 exe

```bash
npm run build:exe
# 或 node build-exe.js
```

产物 `dist/InvoiceHelper.exe`（Windows x64，约 98 MB）。原理是 Node 22 SEA：把 `main.html` + `404.html` + 图标 + `static/` 共 243 个文件（约 10.15 MiB）作为 assets 嵌进 `node.exe` 的 PE 资源节，运行时用 `node:sea.getAsset()` 读内存，不释放临时目录、不需要 Node、不需要联网。构建配置 `sea-config.json` 与临时入口都生成在 `.workbuddy/build/`（构建产物，不进源码根目录）；`postject` 只在构建期临时装到该目录，不污染项目依赖。

> ⚠️ Node SEA 的 `embedderRequire` **只认内置模块**，不支持 `require('./xxx.js')`。所以构建脚本会把 `safe-path.js` 内联成 `.workbuddy/build/portable-server.bundle.js` 作为 SEA 入口。**源码仍只有一份**：`server.js` 直接 require 原文件，exe 拿到的是构建期内联的副本。改动 `safe-path.js` 或 `portable-server.js` 后必须重新 `npm run build:exe`。
>
> ⚠️ `main.html` 与 `static/**` 也是**构建时嵌入**的资产。改过前端代码（例如报销单确认窗口）后，用 `dist/InvoiceHelper.exe` 日常使用时必须重新构建，否则 exe 里仍是旧页面。用 `node server.js` / `npm start` 跑源码目录则实时读盘，无需重建。

> ⚠️ postject 改写 PE 后原 Node 数字签名失效，构建会提示 `The signature seems corrupted!`，首次运行可能被 SmartScreen 拦截。**本定制版仅供本人自用，不得对外分发**（见许可证）。

### 三种形态对比

| | `dist/InvoiceHelper.exe` | `start.bat` + 源码目录 | `node server.js` |
|---|---|---|---|
| 拷贝即用 | 单文件 | 整目录（约 10 MB） | 整目录 |
| 需要 Node | 否 | 是（或随包 `runtime\node.exe`） | 是 |
| 需要联网 | 否 | 否 | 否 |
| 默认监听 | `127.0.0.1` | `127.0.0.1` | `127.0.0.1`（可 `HOST` 开放） |
| 端口占用 | 自动 +1 | 自动 +1 | 报错退出 |
| 适用场景 | 日常使用 | 开发调试 | 局域网 / Nginx 前置 |

---

## 📦 部署方式

<details>
<summary><b>本地 / 局域网</b></summary>

```bash
node server.js
# 仅本机：http://127.0.0.1:8000/

# 需要局域网访问时显式开放：
#   Windows:  set HOST=0.0.0.0 && node server.js
#   POSIX:    HOST=0.0.0.0 node server.js
# 然后访问 http://<本机IP>:8000/，并确认防火墙放行
```

`server.js` 默认只绑回环地址，这是刻意的安全默认值；开放到局域网前请确认网络可信。
</details>

<details>
<summary><b>Nginx / Apache 前置</b></summary>

项目附带 `nginx.conf` 与 `.htaccess`，均已把默认入口改为 `main.html`、旧 `/index.html` 重定向到功能页。使用前修改 `root`、`server_name`、SSL 证书路径，然后 `nginx -t && nginx -s reload`。

静态托管时请保证 `.mjs` 返回 `text/javascript`、`.bcmap` 可被读取，否则 pdf.js worker 与中文映射表会失效。
</details>

---

## 🧪 验证与覆盖边界

```bash
npm test
```

| 脚本 | 覆盖内容 |
|---|---|
| `verify-trip-crop.js` | 行程单裁剪决策分支、CropBox 改写、双联合并嵌入尺寸（19 项） |
| `verify-expense-report.js` | 报销单表格模型：归行、汇总、超范围、HTML 版式；生成前确认的人工日期覆盖 / 超范围诊断 / 预览版式 / 页面链路静态约束（60 项） |
| `verify-real-nanning.js` | 用 7 份真实票据的**固化识别结果**回归报销单逻辑（30 项） |
| `verify-pdf-assets.js` | 零依赖校验真实 PDF 的文件结构、页数、页面尺寸与文本流存在性（33 项） |

> 📐 **实测结论**：3 份行程单都是 A4 竖版 `595.3×841.9pt`，裁剪前提成立；4 张发票里 3 张非 A4，但 **`滴滴出行电子发票.pdf` 也是 A4 竖版**，且文件名命中平台关键词，早期版本会把它误裁掉下半页。现已加两道防线：文件名标明「电子发票 / 增值税 / 发票号码」直接跳过、内容接近整页直接跳过（仅明确写「行程单」的文件名豁免），并固化为回归用例。

> ⚠️ **重要**：`verify-real-nanning.js` 里的 7 份票据金额 / 日期是浏览器里识别后**固化的常量**，脚本本身**不解析 PDF**。所以「全部测试通过」**不等于**「PDF 文本提取正确」。文本提取链路（`pdf.js` + 字段正则）目前没有自动化回归，改动这块后请用真实票据在浏览器里人工验证。
>
> `2026-9 南宁/` 内的 7 份 PDF 含真实公司名、金额与行程，属于隐私数据，**不要随源码目录分享**（已由 `.gitignore` 排除）。

---

## 🗂️ 项目结构

```
📁 fpzs-main/
├── 📄 main.html                    # 唯一入口 / 功能主页面（含大量内联脚本）
├── 📄 404.html                     # 404 页
├── ⚙️ safe-path.js                 # 两个服务器共用的安全路径 / MIME 解析
├── ⚙️ server.js                    # 开发 / 局域网静态服务器
├── ⚙️ portable-server.js           # 便携服务（普通 Node + SEA exe 共用，exe 的 main）
├── ⚙️ build-exe.js                 # Node 22 SEA 单文件 exe 构建脚本
├── 🚀 start.bat                    # Windows 一键启动（Node → exe 兜底）
├── 📦 package.json                 # 仅 scripts / engines，运行期零依赖
├── ⚙️ nginx.conf / .htaccess       # 反向代理与 Apache 配置
├── 📄 manifest.json / favicon.ico / icon0.svg / icon1.png / apple-icon.png
├── 📜 LICENSE                      # All Rights Reserved
├── 📁 dist/
│   └── 🧱 InvoiceHelper.exe        # 构建产物（约 98 MB，不进版本库）
├── 📁 static/
│   ├── 🧰 vendor/                  # pdf-lib / html2canvas / jsPDF（本地化）
│   ├── 🔤 cmaps/                   # pdf.js 中文字符映射（169 个 .bcmap）
│   ├── 🔤 standard_fonts/          # pdf.js 标准字体（16 个）
│   ├── 🎨 css/ · 🖼️ picture/ · 🔤 font/
│   └── 📜 js/
│       ├── custom/                 # 自定义业务模块（见下表）
│       ├── invoice-tool-ui.js      # 主 UI（打包后的 React chunk）
│       ├── alert-dialog.js         # A4 双联合并逻辑所在 chunk
│       ├── pdfjs-lib.js / pdf.worker.min.mjs
│       └── chunks/                 # 同一批 chunk 的另一份副本（改动需同步）
├── 🧪 verify-trip-crop.js / verify-expense-report.js
├── 🧪 verify-real-nanning.js / verify-pdf-assets.js
└── 📁 .workbuddy/                  # 工作区数据：backup / build / memory / preview
```

> ⚠️ `static/js/` 与 `static/chunks/` 存在两套同名 chunk 且并非字节相同。**修改任一 UI chunk 必须两处同步**，否则会出现「改了却没生效」。

---

## 🛠️ 技术架构

| 技术 | 用途 |
|------|------|
| Next.js 静态导出（成品） | 应用框架；本目录**只有构建产物，没有 React/Next 源码，也没有 build 流程** |
| React | UI 组件与状态管理（已打包进 `static/js/`） |
| `pdf-lib` | PDF 创建、合并、页面嵌入、CropBox 改写 |
| `pdfjs-dist` 4.8.69 | PDF 文本提取与页面渲染 |
| `html2canvas` + `jsPDF` | 报销单 HTML → PDF |
| Node.js 内置 `http` | 静态文件服务器；Node 22 SEA 用于单文件 exe |

> 💡 所有前端依赖已打包在 `static/js/`、`static/vendor/`，**无需 `npm install`，运行时无外部网络请求**。`package.json` 里没有运行期依赖，只提供 `scripts`。

---

## 🧱 自定义业务模块

`static/js/custom/` 是手写的业务逻辑，与打包后的 React 框架解耦：

| 模块 | 职责 |
|------|------|
| `expense-report-core.js` | 发票数据提取、报销单 HTML 生成、PDF 合并、同车牌 + 项目智能归类 |
| `expense-report-table.js` | 差旅报销单表格模型：按日期归行、分类汇总、补贴计算、HTML 版式；`analyzeExpenseReport()` 生成前诊断超范围票据，`__reportDate` 支持人工指定归行日期，`__reportCategory` 支持人工指定费用列，`helpers.preview` 输出紧凑预览版式 |
| `trip-crop.js` | 行程单半页裁剪：A4 判定、内容边界检测、CropBox 改写、调试面板 |
| `file-copy-print.js` | 文件复制（改尾部字节使 MD5 变化，绕过打印去重） |
| `print-guard.js` | 打印拦截与合并 PDF 打印；仅对打印类提示自动确认 |
| `notifications.js` | 全局 Toast 通知 |

> ⚠️ 注意：报销单 HTML 模板、DOM 注入与部分核心逻辑仍在 `main.html` 的内联脚本里（内联 script 占全文约 73%），`custom/` 并非「全部业务逻辑」。内联脚本中还有若干 `_legacy*` 重复函数，改动前先全局搜一遍。

---

## ❓ 常见问题

<details>
<summary><b>要注册 / 联网 / 安装吗？</b></summary>

不需要注册，也不需要联网。双击 `dist/InvoiceHelper.exe` 或 `start.bat` 即可，全程本机处理。仅在使用 `node portable-server.js` / `node server.js` 时需要 Node.js。
</details>

<details>
<summary><b>上传的票据会泄露吗？</b></summary>

不会。票据在浏览器本地处理，不上传、不存云端，关闭页面即清除。服务端只提供静态文件，绑定 `127.0.0.1`，不接收任何票据数据。
</details>

<details>
<summary><b>识别不准 / 行程单没被裁剪怎么办？</b></summary>

- PDF 需含**可提取文本层**，扫描件、加密或损坏文件无法解析
- 展开右下角「行程单半页裁剪」面板看日志：会写明是被裁剪还是跳过，以及跳过原因（非 A4 竖版 / 文件名标明发票 / 内容接近整页 / 旋转页 / 无文本层）
- 裁剪比例不合适可在面板里调「目标宽高比」「底部留白」，**改完需重新上传文件**
</details>

<details>
<summary><b>点「生成报销单」没反应 / 提示超范围票据？</b></summary>

现在所有生成入口都会先弹出确认窗口，不会直接出 PDF。窗口左侧是报销单实时预览（含 ⚠ 超范围提示行），右侧是逐张票据数据表。

- 顶部红色横幅会列出超范围票据的日期与笔数，对应行状态为「⚠ 超范围」，日期框橙色高亮。
- 在该行「归行日期」里选一个出差范围内的日期，或用「放入出差日期…」快捷下拉，左侧预览的「超范围」行会立即消失。
- 每行发票还有「填入位置」下拉（普票费 / 打的费 / 其他 / 住宿费 / 退票费）：系统按项目名关键词自动归类，若归错可手动改到正确的费用列，改后下拉变紫、状态格标注「计入：xxx ✎」，金额实时挪到所选列；手动选择会缓存，下次生成继续生效。
- 若确实是跨期出差，改上方的「出差范围」起止日期即可；实在要保留跨期票据，勾选底部「我已核对，允许保留超范围票据」后显式放行。
- 全部修正前「确认生成」是禁用的；点「取消」/ ESC / 窗口空白处不会生成任何文件。

</details>

<details>
<summary><b>同一张发票要打印多份？</b></summary>

点击文件旁的「复制」创建副本，副本会改尾部字节使 MD5 变化，绕过打印系统的重复文件校验。
</details>

---

## 🔧 故障排除

<details>
<summary><b>页面空白 / 加载失败</b></summary>

- 确认服务已启动，且访问的是 `http://127.0.0.1:8000/` 而不是 `file://`
- 按 F12 检查控制台资源加载错误，确认 `static/` 目录完整
- 改过 chunk 或 CDN 本地化配置后按 `Ctrl+F5` 强刷（服务端已设 `no-store`，一般不需要）
</details>

<details>
<summary><b>端口被占用</b></summary>

- 便携版 / exe 默认**单实例**：再启动一次只复用已有 8000 实例并打开浏览器，不会开新窗口。反复双击却弹出多个窗口，是旧版本遗留的多开实例，关掉多余窗口即可（新版已根治）
- 8000 被**其他程序**占用时，便携版 / exe 会自动顺延到 8001、8002…；`server.js` 会直接报错退出
- 指定端口：`set PORT=3000 && node server.js`（exe / 便携版同用 `PORT` 环境变量）
- 查占用：`netstat -ano | findstr 8000`
- 强制多开（调试用）：`set MULTI_INSTANCE=1 && node portable-server.js`
</details>

<details>
<summary><b>局域网访问不了 / exe 被拦</b></summary>

- 局域网：必须用 `HOST=0.0.0.0 node server.js`（默认只绑回环地址），并放行防火墙
- exe 首次运行被 SmartScreen 拦：属无签名产物，自用可点「仍要运行」
- 打印无反应：确认浏览器未阻止弹窗，或改用下载后手动打印
</details>

---

## 📜 许可证与版权

<div align="center">

**版权所有 © 2025-2026 Tom-wc · 保留所有权利（All Rights Reserved）**

</div>

上游源代码公开**仅供个人学习、研究与交流**，**未采用**任何开源许可证。未经著作权人书面授权，**禁止商业使用、复制镜像、二次分发或发布竞争性衍生产品**。完整条款见 [LICENSE](./LICENSE)。

本目录的定制内容同样受上述条款约束：

- ✅ 允许：本人学习研究、本机 / 内部自用
- ❌ 禁止：对外提供在线服务、分发 `dist/InvoiceHelper.exe`、分发完整源码目录、移除版权声明
- ⚠️ `2026-9 南宁/` 与测试脚本中含真实票据信息，分享前必须移除

上游项目地址与授权咨询方式请以其公开仓库 / 官方站点说明为准。**对外发布或商用前，务必先取得书面授权。**
