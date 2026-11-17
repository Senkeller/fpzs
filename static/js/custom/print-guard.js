(function () {
  function textIncludes(node, keywords) {
    if (!node) return false;
    const text = (node.innerText || node.textContent || '').trim();
    return keywords.some((k) => text.includes(k));
  }

  function isClickable(node) {
    return (
      node.matches &&
      (node.matches("button, a, [role='button'], [data-slot='button']") ||
        (node.closest && node.closest("button, a, [role='button'], [data-slot='button']")))
    );
  }

  function getClickable(node) {
    if (!node) return null;
    return node.matches && node.matches("button, a, [role='button'], [data-slot='button']")
      ? node
      : (node.closest && node.closest("button, a, [role='button'], [data-slot='button']")) || null;
  }

  // URL.createObjectURL 已由 main-bootstrap.js 统一补丁并写入
  // window.__lastPdfBlobUrl；这里不再重复 monkey-patch 全局 API。
  function setLastPdfUrl(url) {
    if (url) window.__lastPdfBlobUrl = url;
  }
  function currentPdfUrl() {
    return window.__mergedPdfBlobUrl || window.__lastPdfBlobUrl || null;
  }

  const originalFetch = window.fetch;
  window.fetch = async function () {
    const res = await originalFetch.apply(this, arguments);
    try {
      const ct = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
      if (ct && ct.includes('application/pdf')) {
        const blob = await res.clone().blob();
        const pdfUrl = URL.createObjectURL(blob);
        setLastPdfUrl(pdfUrl);
      }
    } catch (e) {}
    return res;
  };

  function scanForPdfLinks(root = document) {
    const nodes = root.querySelectorAll(
      'a[href$=".pdf"], a[href^="blob:"], a[href*=".pdf?"], embed[type="application/pdf"], object[type="application/pdf"], iframe[src$=".pdf"], iframe[src^="blob:"]'
    );
    nodes.forEach((n) => {
      const url = n.href || n.src;
      if (url) setLastPdfUrl(url);
    });
  }

  async function printPdf(url) {
    if (!url) return false;
    try {
      let iframe = document.getElementById('__hidden_pdf_printer');
      if (!iframe) {
        iframe = document.createElement('iframe');
        iframe.id = '__hidden_pdf_printer';
        iframe.style.position = 'fixed';
        iframe.style.right = '0';
        iframe.style.bottom = '0';
        iframe.style.width = '0';
        iframe.style.height = '0';
        iframe.style.border = '0';
        iframe.style.opacity = '0';
        iframe.style.pointerEvents = 'none';
        document.body.appendChild(iframe);
      }
      return new Promise((resolve) => {
        const onLoad = () => {
          setTimeout(() => {
            try {
              if (iframe.contentWindow) {
                iframe.contentWindow.focus();
                iframe.contentWindow.print();
              }
            } catch (e) {
              console.warn('打印失败，尝试回退到整页打印', e);
              window.print();
            }
          }, 300);
          iframe.removeEventListener('load', onLoad);
          resolve(true);
        };
        iframe.addEventListener('load', onLoad);
        iframe.src = url;
      });
    } catch (e) {
      console.error('PDF 打印失败', e);
      return false;
    }
  }

  const printKeywords = ['一键打印', '立即打印', 'Print'];
  const downloadKeywords = ['下载', 'Download', '下载合并', '保存统计'];

  document.addEventListener(
    'click',
    async (ev) => {
      const target = ev.target;
      if (!isClickable(target)) return;
      const btn = getClickable(target);

      const isHeader = btn && (btn.closest('header') || btn.tagName === 'H1' || btn.tagName === 'H2' || btn.tagName === 'H3');
      if (isHeader) return;

      // 报销单卡片的打印按钮有自己的目标 PDF，别被这里的「找当前 PDF」逻辑劫走
      if (btn && btn.hasAttribute('data-er-print')) return;

      if (btn && textIncludes(btn, downloadKeywords)) return;

      if (btn && textIncludes(btn, printKeywords)) {
        ev.preventDefault();
        ev.stopPropagation();
        try {
          let url = currentPdfUrl();
          if (!url) {
            const deadline = Date.now() + 8000;
            while (!url && Date.now() < deadline) {
              scanForPdfLinks();
              url = currentPdfUrl();
              if (url) break;
              await new Promise((r) => setTimeout(r, 400));
            }
          }
          if (url) {
            await printPdf(url);
          } else {
            window.print();
          }
        } catch (e) {}
      }
    },
    true
  );

  // 不再劫持 window.confirm：任何「含打印字样就自动 true」的全局补丁，
  // 都可能把「打印并删除…」这类真正的二次确认一起放行。

  scanForPdfLinks();
  const mo = new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes.forEach((n) => {
        if (!(n instanceof Element)) return;
        scanForPdfLinks(n);
      });
    }
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
})();