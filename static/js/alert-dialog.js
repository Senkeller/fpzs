"use strict";
(self.webpackChunk_N_E = self.webpackChunk_N_E || []).push([
  [788],
  {
    10: (e, t, n) => {
      n.d(t, {
        $v: () => h,
        EO: () => u,
        Lt: () => a,
        Rx: () => f,
        Zr: () => v,
        ck: () => p,
        r7: () => m,
        tv: () => c,
        wd: () => g,
      });
      var o = n(5155);
      n(2115);
      var s = n(4520),
        i = n(9434),
        r = n(285);
      function a(e) {
        let { ...t } = e;
        return (0, o.jsx)(s.bL, { "data-slot": "alert-dialog", ...t });
      }
      function c(e) {
        let { ...t } = e;
        return (0, o.jsx)(s.l9, { "data-slot": "alert-dialog-trigger", ...t });
      }
      function l(e) {
        let { ...t } = e;
        return (0, o.jsx)(s.ZL, { "data-slot": "alert-dialog-portal", ...t });
      }
      function d(e) {
        let { className: t, ...n } = e;
        return (0, o.jsx)(s.hJ, {
          "data-slot": "alert-dialog-overlay",
          className: (0, i.cn)(
            "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-50 bg-black/50",
            t,
          ),
          ...n,
        });
      }
      function u(e) {
        let { className: t, ...n } = e;
        return (0, o.jsxs)(l, {
          children: [
            (0, o.jsx)(d, {}),
            (0, o.jsx)(s.UC, {
              "data-slot": "alert-dialog-content",
              className: (0, i.cn)(
                "bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border p-6 shadow-lg duration-200 sm:max-w-lg",
                t,
              ),
              ...n,
            }),
          ],
        });
      }
      function g(e) {
        let { className: t, ...n } = e;
        return (0, o.jsx)("div", {
          "data-slot": "alert-dialog-header",
          className: (0, i.cn)(
            "flex flex-col gap-2 text-center sm:text-left",
            t,
          ),
          ...n,
        });
      }
      function p(e) {
        let { className: t, ...n } = e;
        return (0, o.jsx)("div", {
          "data-slot": "alert-dialog-footer",
          className: (0, i.cn)(
            "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
            t,
          ),
          ...n,
        });
      }
      function m(e) {
        let { className: t, ...n } = e;
        return (0, o.jsx)(s.hE, {
          "data-slot": "alert-dialog-title",
          className: (0, i.cn)("text-lg font-semibold", t),
          ...n,
        });
      }
      function h(e) {
        let { className: t, ...n } = e;
        return (0, o.jsx)(s.VY, {
          "data-slot": "alert-dialog-description",
          className: (0, i.cn)("text-muted-foreground text-sm", t),
          ...n,
        });
      }
      function f(e) {
        let { className: t, ...n } = e;
        return (0, o.jsx)(s.rc, { className: (0, i.cn)((0, r.r)(), t), ...n });
      }
      function v(e) {
        let { className: t, ...n } = e;
        return (0, o.jsx)(s.ZD, {
          className: (0, i.cn)((0, r.r)({ variant: "outline" }), t),
          ...n,
        });
      }
    },
    285: (e, t, n) => {
      n.d(t, { $: () => c, r: () => a });
      var o = n(5155);
      n(2115);
      var s = n(9708),
        i = n(2085),
        r = n(9434);
      let a = (0, i.F)(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
        {
          variants: {
            variant: {
              default:
                "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90",
              destructive:
                "bg-destructive text-white shadow-xs hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40 dark:bg-destructive/60",
              outline:
                "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50",
              secondary:
                "bg-secondary text-secondary-foreground shadow-xs hover:bg-secondary/80",
              ghost:
                "hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
              link: "text-primary underline-offset-4 hover:underline",
            },
            size: {
              default: "h-9 px-4 py-2 has-[>svg]:px-3",
              sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
              lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
              icon: "size-9",
            },
          },
          defaultVariants: { variant: "default", size: "default" },
        },
      );
      function c(e) {
        let { className: t, variant: n, size: i, asChild: c = !1, ...l } = e,
          d = c ? s.DX : "button";
        return (0, o.jsx)(d, {
          "data-slot": "button",
          className: (0, r.cn)(a({ variant: n, size: i, className: t })),
          ...l,
        });
      }
    },
    1424: (e, t, n) => {
      n.d(t, {
        Cx: () => v,
        T7: () => p,
        Tg: () => f,
        Y3: () => c,
        ZC: () => l,
        _q: () => m,
        a1: () => h,
        gz: () => g,
        hK: () => r,
        hh: () => u,
        vD: () => a,
        w0: () => d,
      });
      var o = n(1352),
        s = n(8155),
        i = n(6988);
      function r() {
        (0, s.t)({ key: "click_start_btn" });
      }
      function a(e) {
        (0, s.t)({ key: "add_files", sum: e });
      }
      function c(e) {
        (0, s.t)({ key: "append_files", sum: e });
      }
      function l() {
        (0, s.t)({ key: "remove_file" });
      }
      function d() {
        (0, s.t)({ key: "clear_list" });
      }
      function u(e) {
        (0, s.t)({ key: "file_extract_empty", segmentation: { id: e } });
      }
      function g(e, t) {
        (0, s.t)({ key: "file_exception", segmentation: { id: e, msg: t } });
      }
      function p(e, t) {
        (console.log("mergeErrorEvent", e, t),
          (0, s.t)({
            key: "merge_exception",
            segmentation: { ids: e, msg: t },
          }));
      }
      function m(e) {
        let t = new o.O().getResult();
        (0, s.t)({
          key: "send_feedback",
          segmentation: {
            content: e,
            bn: t.browser.name,
            bv: t.browser.version,
          },
        });
      }
      function h(e) {
        (0, s.t)({ key: "over_max_files", segmentation: { num: e } });
      }
      function f(e) {
        (0, s.t)({
          key: "browser_not_match",
          segmentation: {
            ver: e,
            ua: navigator.userAgent,
            bn: i.m.browser.name,
            bv: i.m.browser.version,
          },
        });
      }
      function v() {
        (0, s.t)({ key: "new_user_login_success" });
      }
    },
    1932: (e, t, n) => {
      function o(e, t) {
        return (e = e.replace(/\/+$/, "")) + "/" + (t = t.replace(/^\/+/, ""));
      }
      function s(e) {
        if (e.byteLength < 5) return !1;
        let t = new Uint8Array(e);
        return (
          37 === t[0] &&
          80 === t[1] &&
          68 === t[2] &&
          70 === t[3] &&
          45 === t[4]
        );
      }
      n.d(t, { cE: () => s, oq: () => o });
    },
    5390: (e, t, n) => {
      n.d(t, { A: () => i });
      var o = n(1932);
      let s = {
          api: { baseUrl: "", timeout: 5e3 },
          showLanding: !1, /* [已移除] 落地页已下线，顶栏不再显示「返回首页」 */
        },
        i = {
          ...s,
          urls: { api: {} },
        };
    },
    6988: (e, t, n) => {
      var o, s;
      n.d(t, { m: () => r });
      let i = new (n(1352).O)().getResult(),
        r = {
          app: { version: "6.0.0" },
          browser: {
            name: null != (o = i.browser.name) ? o : "unknown",
            version: null != (s = i.browser.version) ? s : "unknown",
          },
          localStorageKeys: {
            user: { nick: "user_nick", icon: "user_icon", uid: "user_uid" },
            mergeConf: {
              noline: "merge_conf_noline",
              method: "merge_conf_method",
            },
            app: {
              invoiceTipsSeen: "invoice-tips-seen",
              savedVersion: "app_saved_version",
            },
            todayOpSum: "today_op",
          },
          limit: { maxFileSize: 5 },
        };
    },
    7117: (e, t, n) => {
      n.d(t, { b: () => s, r: () => o });
      var o = (function (e) {
        return (
          (e[(e.Error = 0)] = "Error"),
          (e[(e.Exception = 1)] = "Exception"),
          e
        );
      })({});
      async function s(e) {
        let t =
            arguments.length > 1 && void 0 !== arguments[1] ? arguments[1] : {},
          { params: n, headers: o = {}, ...s } = t;
        if (n && Object.keys(n).length > 0) {
          let t = new URLSearchParams();
          (Object.entries(n).forEach((e) => {
            let [n, o] = e;
            t.append(n, String(o));
          }),
            (e += (e.includes("?") ? "&" : "?") + t.toString()));
        }
        let i = { ...s, headers: { ...o }, credentials: "include" };
        return await fetch(e, i);
      }
    },
    7262: (e, t, n) => {
      n.d(t, {
        hD: () => I,
        wD: () => z,
        o6: () => O,
        iD: () => D,
        ri: () => T,
        h1: () => A,
        P: () => R,
        Se: () => P,
      });
      var o = n(7117),
        s = n(5390),
        i = n(9249);
      n(3548);
      var r = n(5905),
        a = n(6620),
        c = n(6429),
        l = n(7781),
        d = n(5339),
        u = n(7298),
        g = n(3840),
        p = n(9209),
        m = n(9037);
      class h {}
      ((0, i.Cg)(
        [(0, r.Mx)(), (0, a.Fv)(), (0, i.Sn)("design:type", Number)],
        h.prototype,
        "code",
        void 0,
      ),
        (0, i.Cg)(
          [(0, c.IP)(), (0, a.Fv)(), (0, i.Sn)("design:type", String)],
          h.prototype,
          "text",
          void 0,
        ),
        (0, i.Cg)(
          [(0, c.IP)(), (0, i.Sn)("design:type", String)],
          h.prototype,
          "message",
          void 0,
        ));
      class f {}
      ((0, i.Cg)(
        [(0, c.IP)(), (0, a.Fv)(), (0, i.Sn)("design:type", String)],
        f.prototype,
        "code",
        void 0,
      ),
        (0, i.Cg)(
          [(0, c.IP)(), (0, a.Fv)(), (0, i.Sn)("design:type", String)],
          f.prototype,
          "number",
          void 0,
        ),
        (0, i.Cg)(
          [
            (0, c.IP)(),
            (0, a.Fv)(),
            (0, p.d)((e) => {
              let { value: t } = e;
              return t.toString();
            }),
            (0, i.Sn)("design:type", String),
          ],
          f.prototype,
          "date",
          void 0,
        ),
        (0, i.Cg)(
          [
            (0, r.Mx)(),
            (0, a.Fv)(),
            (0, p.d)((e) => {
              let { value: t } = e;
              return Number(t);
            }),
            (0, i.Sn)("design:type", Number),
          ],
          f.prototype,
          "total",
          void 0,
        ));
      class v {}
      ((0, i.Cg)(
        [
          (0, r.Mx)(),
          (0, a.Fv)(),
          (0, p.d)((e) => {
            let { value: t } = e;
            return Number(t);
          }),
          (0, i.Sn)("design:type", Number),
        ],
        v.prototype,
        "pageno",
        void 0,
      ),
        (0, i.Cg)(
          [
            (0, r.Mx)(),
            (0, a.Fv)(),
            (0, p.d)((e) => {
              let { value: t } = e;
              return Number(t);
            }),
            (0, i.Sn)("design:type", Number),
          ],
          v.prototype,
          "a5",
          void 0,
        ),
        (0, i.Cg)(
          [
            (0, l.QS)(),
            (0, d.K)({ each: !0 }),
            (0, m.Z)(() => f),
            (0, i.Sn)("design:type", Array),
          ],
          v.prototype,
          "invoices",
          void 0,
        ));
      class x {}
      (0, i.Cg)(
        [
          (0, l.QS)(),
          (0, u.X)(),
          (0, d.K)({ each: !0 }),
          (0, m.Z)(() => v),
          (0, i.Sn)("design:type", Array),
        ],
        x.prototype,
        "pages",
        void 0,
      );
      class y extends h {}
      (0, i.Cg)(
        [(0, d.K)(), (0, m.Z)(() => x), (0, i.Sn)("design:type", x)],
        y.prototype,
        "result",
        void 0,
      );
      class b extends h {}
      (0, i.Cg)(
        [(0, g.Zx)(), (0, a.Fv)(), (0, i.Sn)("design:type", Boolean)],
        b.prototype,
        "result",
        void 0,
      );
      class w {}
      ((0, i.Cg)(
        [(0, c.IP)(), (0, i.Sn)("design:type", String)],
        w.prototype,
        "nick",
        void 0,
      ),
        (0, i.Cg)(
          [(0, c.IP)(), (0, i.Sn)("design:type", String)],
          w.prototype,
          "icon",
          void 0,
        ),
        (0, i.Cg)(
          [(0, c.IP)(), (0, i.Sn)("design:type", String)],
          w.prototype,
          "uid",
          void 0,
        ),
        (0, i.Cg)(
          [(0, r.Mx)(), (0, i.Sn)("design:type", Number)],
          w.prototype,
          "new",
          void 0,
        ));
      class _ {}
      ((0, i.Cg)(
        [(0, c.IP)(), (0, a.Fv)(), (0, i.Sn)("design:type", String)],
        _.prototype,
        "id",
        void 0,
      ),
        (0, i.Cg)(
          [(0, r.Mx)(), (0, a.Fv)(), (0, i.Sn)("design:type", Number)],
          _.prototype,
          "size",
          void 0,
        ),
        (0, i.Cg)(
          [
            (0, l.QS)(),
            (0, r.Mx)({}, { each: !0 }),
            (0, a.Fv)(),
            (0, i.Sn)("design:type", Array),
          ],
          _.prototype,
          "ips",
          void 0,
        ));
      class S {}
      ((0, i.Cg)(
        [
          (0, l.QS)(),
          (0, d.K)({ each: !0 }),
          (0, m.Z)(() => _),
          (0, i.Sn)("design:type", Array),
        ],
        S.prototype,
        "pages",
        void 0,
      ),
        (0, i.Cg)(
          [(0, r.Mx)(), (0, a.Fv)(), (0, i.Sn)("design:type", Number)],
          S.prototype,
          "noline",
          void 0,
        ),
        (0, i.Cg)(
          [(0, r.Mx)(), (0, a.Fv)(), (0, i.Sn)("design:type", Number)],
          S.prototype,
          "method",
          void 0,
        ));
      var C = n(3025),
        k = n(3464),
        N = n(6988),
        E = n(9572),
        F = n(1424);
      class I {
        getInfo() {
          if (this.type === o.r.Exception) return this.info.message;
          {
            let e = "status" in this.info ? this.info.status : 0,
              t = "statusText" in this.info ? this.info.statusText : "";
            return e && t
              ? "".concat(e, ": ").concat(t)
              : t
                ? t
                : e
                  ? "状态码： ".concat(e)
                  : "未知";
          }
        }
        static fromResponse(e) {
          return new I({ type: o.r.Error, info: e });
        }
        static fromException(e) {
          let t;
          return (
            (t =
              e instanceof Error
                ? e
                : "object" == typeof e
                  ? Error(JSON.stringify(e))
                  : Error(String(e))),
            new I({ type: o.r.Exception, info: t })
          );
        }
        constructor(e) {
          ((this.__brand = "ApiError"),
            (this.type = e.type),
            (this.info = e.info));
        }
      }
      var _pendingFiles = {};
      async function R(e, t) {
        return { code: 0, result: !1 };
      }
      async function P(e, t) {
        _pendingFiles[e.name] = e;
        if (t) t({ progress: 100 });
        return () => {};
      }
      async function O(e, t) {
        let inv = null, file = null, fname = "";
        for (let k of Object.keys(_pendingFiles)) {
          if (_pendingFiles[k] && _pendingFiles[k].size === t) {
            file = _pendingFiles[k]; fname = k; break;
          }
        }
        if (!file && window.__fileDebugCache) {
          for (let [n, f] of window.__fileDebugCache.entries()) {
            if (f.size === t) { file = f; fname = n; break; }
          }
        }
        if (file && window.__invoiceDataCache && window.__invoiceDataCache[fname]) {
          inv = window.__invoiceDataCache[fname];
        }
        if (!inv && file && window.__expenseReportCore) {
          try {
            inv = await window.__expenseReportCore.extractInvoiceDataFromPdf(fname, file);
            if (window.__invoiceDataCache) window.__invoiceDataCache[fname] = inv;
          } catch(ex) { console.warn("local extract failed:", ex); }
        }
        if (!inv) inv = { amount: 0, date: "" };
        let amt = inv.amount || 0;
        let dt = inv.date ? (inv.date instanceof Date ? inv.date.toISOString().slice(0,10) : String(inv.date)) : "";
        let total = Math.round(amt * 100) || 1;
        return { code: 0, result: { pages: [{ pageno: 1, a5: 1, invoices: [{ code: "0", number: fname.replace(/\.pdf$/i,""), date: dt, total: total }] }] } };
      }
      // 修复某些数电发票(全电发票)的内容流:其 /Length 写成间接引用(如 6 0 R),
      // pdf-lib 1.17.1 顺序解析时拿不到长度而丢弃该流对象,导致 embedPages 在 save()
      // 阶段抛 "Can't embed page with missing Contents"。这里在 load 后从原始字节重建
      // 缺失的内容流对象注入 context,使其可被原生解析(保留矢量文字、不改布局)。
      function _repairMissingContentStreams(PDFLib, pdfDoc, arrayBuf) {
        try {
          var raw = new Uint8Array(arrayBuf);
          // 转成 latin1 字符串用于定位对象(逐字节,避免多字节编码错位)
          var rawStr = '';
          for (var _i = 0; _i < raw.length; _i++) rawStr += String.fromCharCode(raw[_i]);
          var ctx = pdfDoc.context, repaired = 0;
          var pages = pdfDoc.getPages();
          for (var pgi = 0; pgi < pages.length; pgi++) {
            var node = pages[pgi].node;
            var normOk = false;
            try { var ne = node.normalizedEntries(); normOk = !!(ne && ne.Contents); } catch (e) {}
            if (normOk) continue; // 能原生解析的跳过
            var cref = node.get(PDFLib.PDFName.of('Contents'));
            if (!cref || !(cref instanceof PDFLib.PDFRef) || ctx.lookup(cref)) continue;
            var mk = new RegExp('(^|[^0-9])' + cref.objectNumber + ' ' + cref.generationNumber + ' obj');
            var m = mk.exec(rawStr); if (!m) continue;
            var objStart = m.index + (m[1] ? 1 : 0);
            var dictStart = rawStr.indexOf('<<', objStart);
            var streamKw = rawStr.indexOf('stream', dictStart);
            if (dictStart < 0 || streamKw < 0) continue;
            var dictStr = rawStr.slice(dictStart, streamKw);
            var length, li = /\/Length\s+(\d+)\s+(\d+)\s+R/.exec(dictStr), ld = /\/Length\s+(\d+)/.exec(dictStr);
            if (li) { var lo = ctx.lookup(PDFLib.PDFRef.of(+li[1], +li[2])); length = lo && lo.value ? lo.value() : (lo && lo.numberValue); }
            else if (ld) length = +ld[1];
            if (!length) continue;
            var ds = streamKw + 6; if (raw[ds] === 0x0d) ds++; if (raw[ds] === 0x0a) ds++;
            var bytes = raw.slice(ds, ds + length);
            var dict = PDFLib.PDFDict.withContext(ctx);
            var fm = /\/Filter\s*\/(\w+)/.exec(dictStr);
            if (fm) dict.set(PDFLib.PDFName.of('Filter'), PDFLib.PDFName.of(fm[1]));
            dict.set(PDFLib.PDFName.of('Length'), PDFLib.PDFNumber.of(length));
            ctx.assign(cref, PDFLib.PDFRawStream.of(dict, bytes));
            repaired++;
            console.log('🔧 修复数电发票内容流: 对象 ' + cref.objectNumber + ' (' + length + ' 字节)');
          }
          return repaired;
        } catch (e) { console.warn('内容流修复异常(忽略):', e && e.message); return 0; }
      }
      // 修复「描边被推迟到文末」的票据。部分开票系统(如高德/鞍马打车电子发票)把表格
      // 框线的路径构造与描边操作 S 拆得很远,中间夹了几十个 BT/ET 文本块。按 PDF 规范
      // 路径不属于图形状态、BT/ET 不会清空它,Acrobat/WPS 能正常画出边框;但 pdf.js 的
      // endText() 每次遇到 ET 都会 beginPath(),把待描边的路径直接丢掉,于是预览和打印
      // 出来整页没有外框、也没有表格线。这里在每处 BT 之前把当前路径先描边一次,
      // 各渲染器的结果就一致了。只对确实存在该缺陷的页面改写内容流。
      var _PDF_DELIM = ' \t\r\n\f\0()<>[]{}/%';
      var _PDF_PATH_OPS = { m: 1, l: 1, c: 1, v: 1, y: 1, re: 1, h: 1 };
      var _PDF_PAINT_OPS = { S: 1, s: 1, f: 1, F: 1, 'f*': 1, B: 1, 'B*': 1, b: 1, 'b*': 1, n: 1 };

      // 轻量分词：只需辨认操作符与字符串/名字/注释的边界，无需完整解析
      function _pdfTokenize(str) {
        var toks = [], i = 0, n = str.length;
        while (i < n) {
          var c = str.charCodeAt(i);
          if (c === 32 || c === 10 || c === 13 || c === 9 || c === 12 || c === 0) { i++; continue; }
          if (c === 37) { // % 注释
            while (i < n && str.charCodeAt(i) !== 10 && str.charCodeAt(i) !== 13) i++;
            continue;
          }
          var start = i, ch = str[i];
          if (ch === '(') {
            var d = 1; i++;
            while (i < n && d > 0) {
              var cc = str[i];
              if (cc === '\\') { i += 2; continue; }
              if (cc === '(') d++;
              else if (cc === ')') d--;
              i++;
            }
            continue;
          }
          if (ch === '<') {
            if (str[i + 1] === '<') { i += 2; continue; }
            i++;
            while (i < n && str[i] !== '>') i++;
            i++;
            continue;
          }
          if (ch === '>') { i += str[i + 1] === '>' ? 2 : 1; continue; }
          if (ch === '/') {
            i++;
            while (i < n && _PDF_DELIM.indexOf(str[i]) === -1) i++;
            continue;
          }
          if (ch === '[' || ch === ']' || ch === '{' || ch === '}') { i++; continue; }
          while (i < n && _PDF_DELIM.indexOf(str[i]) === -1) i++;
          toks.push({ t: str.slice(start, i), i: start });
        }
        return toks;
      }

      function _pdfPatchDeferredStrokes(content) {
        var toks = _pdfTokenize(content);
        var pending = 0, inserts = [];
        for (var k = 0; k < toks.length; k++) {
          var t = toks[k].t;
          // 内联图像(BI...ID<二进制>EI)里可能藏着任意字节，不做处理以免误伤
          if (t === 'BI') return { text: content, inserted: 0 };
          if (_PDF_PATH_OPS[t]) { pending++; continue; }
          if (_PDF_PAINT_OPS[t]) { pending = 0; continue; }
          if (t === 'BT' && pending > 0) {
            // 只有当这段路径最终是被「描边」时才补，避免给原本只做填充的图形多画一圈边
            var nextPaint = '';
            for (var q = k + 1; q < toks.length; q++) {
              if (_PDF_PAINT_OPS[toks[q].t]) { nextPaint = toks[q].t; break; }
            }
            if (nextPaint === 'S' || nextPaint === 's' || nextPaint === 'B' ||
                nextPaint === 'B*' || nextPaint === 'b' || nextPaint === 'b*') {
              inserts.push(toks[k].i);
            }
            pending = 0;
          }
        }
        if (!inserts.length) return { text: content, inserted: 0 };
        var out = content;
        for (var j = inserts.length - 1; j >= 0; j--) {
          out = out.slice(0, inserts[j]) + 'S\n' + out.slice(inserts[j]);
        }
        return { text: out, inserted: inserts.length };
      }

      function _pdfBytesToLatin1(bytes) {
        var s = '', CH = 8192;
        for (var i = 0; i < bytes.length; i += CH) {
          s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
        }
        return s;
      }
      function _pdfLatin1ToBytes(str) {
        var a = new Uint8Array(str.length);
        for (var i = 0; i < str.length; i++) a[i] = str.charCodeAt(i) & 0xff;
        return a;
      }

      function _repairDeferredStrokes(PDFLib, pdfDoc) {
        try {
          var ctx = pdfDoc.context, fixed = 0;
          var pages = pdfDoc.getPages();
          for (var pgi = 0; pgi < pages.length; pgi++) {
            var node = pages[pgi].node;
            var cref = node.get(PDFLib.PDFName.of('Contents'));
            if (!cref) continue;
            // /Contents 可能是单个流，也可能是流数组（内容按顺序拼接）
            var refs = [];
            var resolved = ctx.lookup(cref);
            if (resolved && typeof resolved.size === 'function' && !resolved.dict) {
              for (var ai = 0; ai < resolved.size(); ai++) refs.push(resolved.get(ai));
            } else {
              refs.push(cref);
            }
            var parts = [], ok = true;
            for (var ri = 0; ri < refs.length; ri++) {
              var st = ctx.lookup(refs[ri]);
              if (!st || !st.dict) { ok = false; break; }
              try { parts.push(_pdfBytesToLatin1(PDFLib.decodePDFRawStream(st).decode())); }
              catch (e) { ok = false; break; }
            }
            if (!ok) continue;
            var res = _pdfPatchDeferredStrokes(parts.join('\n'));
            if (!res.inserted) continue;
            node.set(PDFLib.PDFName.of('Contents'), ctx.register(ctx.flateStream(_pdfLatin1ToBytes(res.text))));
            fixed++;
            console.log('🔧 补齐延迟描边: 第 ' + (pgi + 1) + ' 页, ' + res.inserted + ' 处');
          }
          return fixed;
        } catch (e) { console.warn('延迟描边修复异常(忽略):', e && e.message); return 0; }
      }
      async function A(e, t, n) {
        console.log('🔧 合并参数: noline=', t, 'method=', n, 'files=', e.length);
        try {
          var PDFLib = window.PDFLib;
          if (!PDFLib) return I.fromException(Error("pdf-lib not loaded"));
          var merged = await PDFLib.PDFDocument.create();
          var A4W = 595.28, A4H = 841.89, halfH = A4H / 2;
          var slotUsed = 0;

          for (var item of e) {
            var file = null;
            for (var k of Object.keys(_pendingFiles)) {
              if (_pendingFiles[k] && _pendingFiles[k].size === item.size) { file = _pendingFiles[k]; break; }
            }
            if (!file && window.__fileDebugCache) {
              for (var [, f] of window.__fileDebugCache.entries()) {
                if (f.size === item.size) { file = f; break; }
              }
            }
            if (!file) { console.warn('合并: 未找到文件 size=', item.size); continue; }
            var buf = await file.arrayBuffer();
            var src = await PDFLib.PDFDocument.load(buf, { ignoreEncryption: true });
            // 修复外框/表格线描边被推迟到文末、导致 pdf.js 渲染时整页无边框的票据。
            // 必须放在 _repairMissingContentStreams 之前：后者内部的 normalizedEntries()
            // 会把 /Contents 改写成 pdf-lib 内部的 PDFContentStream，之后就不便按原始流读取了。
            _repairDeferredStrokes(PDFLib, src);
            // 修复内容流 /Length 为间接引用的数电发票,使其可被 pdf-lib 原生嵌入
            _repairMissingContentStreams(PDFLib, src, buf);
            var pageIndices = item.ips && item.ips.length > 0 ? item.ips.map(function(p){return p-1;}) : src.getPageIndices();

            for (var pi = 0; pi < pageIndices.length; pi++) {
              var srcPage = src.getPages()[pageIndices[pi]];
              if (!srcPage) continue;

              var ew = srcPage.getSize().width, eh = srcPage.getSize().height;
              var rot = srcPage.getRotation().angle || 0;
              console.log('📐 合并页面:', {ew, eh, rot, file: file.name || ''});

              // 使用 CropBox（如果小于 MediaBox），只嵌入实际可见内容
              var cropBox = srcPage.getCropBox();
              var mediaBox = srcPage.getMediaBox();
              var bbox = undefined;
              if (cropBox.width < mediaBox.width * 0.95 || cropBox.height < mediaBox.height * 0.95) {
                bbox = {left: cropBox.x, bottom: cropBox.y, right: cropBox.x + cropBox.width, top: cropBox.y + cropBox.height};
                console.log('📐 使用CropBox:', bbox);
              }
              var embedded;
              try {
                embedded = bbox
                  ? (await merged.embedPages([srcPage], [bbox]))[0]
                  : (await merged.embedPages([srcPage]))[0];
              } catch (embedErr) {
                // 单页嵌入失败（页面结构异常等）不应中断整批合并，跳过该页
                console.warn('⚠️ 页面嵌入失败，已跳过: ' + (file.name || '') + ' 第' + (pageIndices[pi] + 1) + '页 -', embedErr && embedErr.message);
                continue;
              }

              var vw = embedded.width, vh = embedded.height;

              // 分配槽位
              var page;
              if (slotUsed === 0 || slotUsed === 2) {
                page = merged.addPage([A4W, A4H]);
                slotUsed = 1;
              } else {
                page = merged.getPage(merged.getPageCount() - 1);
                slotUsed = 2;
              }

              var isTop = (slotUsed === 1);
              var scale = Math.min(A4W / vw, halfH / vh) * 0.95;
              var w = vw * scale, h = vh * scale;
              var x = (A4W - w) / 2;
              var y = isTop ? (A4H - h - 20) : (halfH - h) / 2;
              page.drawPage(embedded, { x: x, y: y, width: w, height: h });

              // 画分割线（t=0 表示需要分割线，在第二张发票放入后画）
              console.log('🔧 分割线检查: t=', t, 'slotUsed=', slotUsed);
              if (!t && slotUsed === 2) {
                console.log('✅ 画分割线');
                page.drawRectangle({
                  x: 20,
                  y: halfH - 0.25,
                  width: A4W - 40,
                  height: 0.5,
                  color: PDFLib.rgb(0.5, 0.5, 0.5),
                });
              }
            }
          }
          if (merged.getPageCount() === 0) {
            // 所有页都被跳过（全空白/全部嵌入失败）时，不要生成空 PDF 让用户拿到坏文件
            throw new Error("没有可合并的有效页面：所选文件可能全部为空白页或格式异常");
          }
          var bytes = await merged.save();
          console.log('✅ 本地合并完成: ' + merged.getPageCount() + ' A4页');
          return new Blob([bytes], { type: "application/pdf" });
        } catch(ex) {
          console.error('❌ 合并失败:', ex);
          return I.fromException(ex);
        }
      }
      async function D(e) {
        return !0;
      }
      async function T() {
        return !0;
      }
      async function z() {
        return !0;
      }
    },
    8155: (e, t, n) => {
      n.d(t, { t: () => r });
      var o = n(9572);
      function r(e) {}
    },
    9434: (e, t, n) => {
      n.d(t, { cn: () => i });
      var o = n(2596),
        s = n(9688);
      function i() {
        for (var e = arguments.length, t = Array(e), n = 0; n < e; n++)
          t[n] = arguments[n];
        return (0, s.QP)((0, o.$)(t));
      }
    },
    9572: (e, t, n) => {
      n.d(t, { d: () => o });
      let o = (0, n(3217).BX)({
        user: { isLoggedIn: null, nick: null, icon: null, uid: null },
      });
    },
  },
]);
