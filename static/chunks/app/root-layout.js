(self.webpackChunk_N_E = self.webpackChunk_N_E || []).push([
  [177],
  {
    347: () => {},
    951: (e, r, t) => {
      "use strict";
      t.d(r, { Initializer: () => E });
      var a = t(5155);
      t(3548);
      var s = t(2115),
        o = t(6988);
      let n = () => {
        (console.log("initPolyfills"),
          Promise.withResolvers ||
            (Promise.withResolvers = function () {
              let e, r;
              return {
                promise: new Promise((t, a) => {
                  ((e = t), (r = a));
                }),
                resolve: e,
                reject: r,
              };
            }));
      };
      var i = t(5390),
        c = t(7262),
        u = t(9572);
      async function x() {
        u.d.user.isLoggedIn = !1;
      }
      let g = async () => {
        (console.log(
          "Initializer",
          "app(ver: ".concat(o.m.app.version, ") init..."),
        ),
          n(),
          await void 0,
          await x(),
          setTimeout(() => {
            console.log("[背景特效] 🎨 初始化炫酷背景...");
            const C = [
              "rgba(102,126,234,0.8)",
              "rgba(118,75,162,0.8)",
              "rgba(240,147,251,0.8)",
              "rgba(79,172,254,0.8)",
              "rgba(0,242,254,0.8)",
              "rgba(250,112,154,0.8)",
            ];
            const P = 50,
              F = document.createDocumentFragment();
            for (let e = 0; e < P; e++) {
              const t = document.createElement("div");
              t.className = "bg-particle";
              const c = C[Math.floor(Math.random() * C.length)];
              ((t.style.cssText = `position:fixed;width:${Math.random() * 4 + 2}px;height:${Math.random() * 4 + 2}px;background:${c};border-radius:50%;pointer-events:none;z-index:9998;left:${Math.random() * 100}%;top:${Math.random() * 100}%;animation:particle-float ${10 + Math.random() * 10}s linear infinite;animation-delay:${Math.random() * 15}s;box-shadow:0 0 15px ${c}`),
                F.appendChild(t));
            }
            document.body.appendChild(F);
            console.log("[背景特效] ✅ 已添加", P, "个彩色粒子");
            const H = [
              {
                size: 500,
                top: "5%",
                left: "5%",
                color: "rgba(102,126,234,0.25)",
                duration: "10s",
                delay: "0s",
              },
              {
                size: 450,
                top: "40%",
                right: "5%",
                color: "rgba(240,147,251,0.25)",
                duration: "12s",
                delay: "2s",
              },
              {
                size: 400,
                bottom: "10%",
                left: "10%",
                color: "rgba(79,172,254,0.25)",
                duration: "14s",
                delay: "4s",
              },
              {
                size: 380,
                top: "60%",
                left: "40%",
                color: "rgba(250,112,154,0.25)",
                duration: "16s",
                delay: "6s",
              },
              {
                size: 420,
                bottom: "30%",
                right: "25%",
                color: "rgba(67,233,123,0.25)",
                duration: "13s",
                delay: "3s",
              },
            ];
            H.forEach((e, n) => {
              const t = document.createElement("div");
              t.className = "bg-floating-shape";
              let a = "";
              (e.top && (a += `top:${e.top};`),
                e.bottom && (a += `bottom:${e.bottom};`),
                e.left && (a += `left:${e.left};`),
                e.right && (a += `right:${e.right};`),
                (t.style.cssText = `position:fixed;width:${e.size}px;height:${e.size}px;background:radial-gradient(circle,${e.color} 0%,transparent 70%);border-radius:50%;pointer-events:none;z-index:9996;filter:blur(70px);animation:shape-float ${e.duration} ease-in-out infinite;animation-delay:${e.delay};${a}`),
                document.body.appendChild(t),
                console.log("[背景特效] ✅ 已添加浮动形状", n + 1));
            });
            const A = document.createElement("style");
            A.id = "bg-effects-keyframes";
            ((A.textContent =
              "@keyframes particle-float{0%{transform:translateY(0) translateX(0);opacity:0}10%{opacity:0.9}90%{opacity:0.9}100%{transform:translateY(-100vh) translateX(30px);opacity:0}}@keyframes shape-float{0%,100%{transform:translateY(0) scale(1) rotate(0deg)}50%{transform:translateY(-30px) scale(1.08) rotate(5deg)}}"),
              document.head.appendChild(A));
            console.log("[背景特效] ✅ 已添加动画样式");
            setTimeout(() => {
              const e = document.querySelectorAll(
                ".bg-particle, .bg-floating-shape",
              );
              console.log("[背景特效] 📊 验证：共", e.length, "个动态元素");
            }, 100);
            console.log("[背景特效] 🎉 完成！");
          }, 1000));
      };
      var m = t(6766),
        h = t(285),
        f = t(9434),
        v = t(429),
        y = t(1366);
      // 二次开发：右下角「联系」浮窗已按需求移除，组件保留空实现以避免上层引用报错。
      function k() {
        return null;
      }
      function E() {
        return (
          (0, s.useEffect)(() => {
            g();
          }, []),
          (0, a.jsxs)(a.Fragment, {
            children: [(0, a.jsx)(k, {})],
          })
        );
      }
    },
    6335: (e, r, t) => {
      (Promise.resolve().then(t.bind(t, 8865)),
        Promise.resolve().then(t.bind(t, 6485)),
        Promise.resolve().then(t.bind(t, 6096)),
        Promise.resolve().then(t.t.bind(t, 4147, 23)),
        Promise.resolve().then(t.t.bind(t, 8489, 23)),
        Promise.resolve().then(t.t.bind(t, 347, 23)),
        Promise.resolve().then(t.bind(t, 951)),
        Promise.resolve().then(t.bind(t, 9074)));
    },
    9074: (e, r, t) => {
      "use strict";
      t.d(r, { Toaster: () => n });
      var a = t(5155),
        s = t(1362),
        o = t(6671);
      let n = (e) => {
        let { ...r } = e,
          { theme: t = "system" } = (0, s.D)();
        return (0, a.jsx)(o.l$, {
          theme: t,
          className: "toaster group",
          style: {
            "--normal-bg": "var(--popover)",
            "--normal-text": "var(--popover-foreground)",
            "--normal-border": "var(--border)",
            "--error-bg": "dark" === t ? "#7f1d1d" : "#fee2e2",
            "--error-text": "dark" === t ? "#fca5a5" : "#dc2626",
            "--error-border": "dark" === t ? "#991b1b" : "#fecaca",
            "--success-bg": "dark" === t ? "#14532d" : "#dcfce7",
            "--success-text": "dark" === t ? "#86efac" : "#16a34a",
            "--success-border": "dark" === t ? "#166534" : "#bbf7d0",
            "--warning-bg": "dark" === t ? "#78350f" : "#fef3c7",
            "--warning-text": "dark" === t ? "#fbbf24" : "#d97706",
            "--warning-border": "dark" === t ? "#92400e" : "#fde68a",
            "--info-bg": "dark" === t ? "#1e3a8a" : "#dbeafe",
            "--info-text": "dark" === t ? "#93c5fd" : "#2563eb",
            "--info-border": "dark" === t ? "#1d4ed8" : "#bfdbfe",
          },
          ...r,
        });
      };
    },
  },
  (e) => {
    var r = (r) => e((e.s = r));
    (e.O(0, [481, 690, 991, 69, 715, 822, 49, 788, 441, 684, 358], () =>
      r(6335),
    ),
      (_N_E = e.O()));
  },
]);
