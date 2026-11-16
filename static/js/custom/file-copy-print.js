(function () {
  // 文件名不是唯一标识：不同目录的同名发票会互相覆盖。
  // 用 name + size + lastModified 做 key；两个脚本共用这个 helper。
  window.__fileKey = function (file) {
    if (!file) return '';
    // 分隔符用 ::（Windows/macOS 文件名均不允许冒号），且不会像 \0 那样被 HTML 属性吞掉
    return [file.name || '', file.size || 0, file.lastModified || 0].join('::');
  };

  window.__findFileKeyByName = function (name) {
    const cache = window.__fileDebugCache;
    if (!cache) return null;
    for (const [key, file] of cache.entries()) {
      if (file && file.name === name) return key;
    }
    return null;
  };

  window.__fileDebugCache = new Map();
  let copyCounter = 0;

  document.addEventListener('change', function (e) {
    if (e.target && e.target.tagName === 'INPUT' && e.target.type === 'file') {
      const files = e.target.files;
      for (let i = 0; i < files.length; i++) {
        window.__fileDebugCache.set(window.__fileKey(files[i]), files[i]);
      }
    }
  }, true);

  document.addEventListener('drop', function (e) {
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const file = e.dataTransfer.files[i];
        if (!window.__fileDebugCache.has(window.__fileKey(file))) {
          window.__fileDebugCache.set(window.__fileKey(file), file);
        }
      }
    }

    setTimeout(() => {
      const fileInputs = document.querySelectorAll('input[type="file"]');
      fileInputs.forEach(input => {
        if (input.files && input.files.length > 0) {
          for (let i = 0; i < input.files.length; i++) {
            const file = input.files[i];
            if (!window.__fileDebugCache.has(file.name)) {
              window.__fileDebugCache.set(file.name, file);
            }
          }
        }
      });
      addCopyButtons();
    }, 500);
  }, true);

  function addCopyButtons() {
    if (window.__fileDebugCache.size === 0) return;

    let targetElements = null;
    const fileAreas = document.querySelectorAll('[role="complementary"], aside, [class*="file"], [class*="upload"], main');

    if (fileAreas.length > 0) {
      targetElements = [];
      fileAreas.forEach(area => {
        targetElements.push(...area.querySelectorAll('*'));
      });
    } else {
      targetElements = document.body.querySelectorAll('*');
    }

    const processedFiles = new Set();
    targetElements.forEach(elem => {
      const text = elem.textContent || '';
      if (!text.toLowerCase().includes('.pdf')) return;
      const fileNameMatch = text.match(/([^\s\/\\]+\.pdf)/i);
      if (!fileNameMatch) return;
      const fileName = fileNameMatch[1];
      const fileKey = window.__findFileKeyByName(fileName);
      if (!fileKey) return;
      if (processedFiles.has(fileKey)) return;
      if (fileName.includes('_副本')) return;
      if (fileName.includes('报销单') || fileName.startsWith('000_')) return;
      const buttons = elem.querySelectorAll('button');
      if (buttons.length === 0) return;
      if (text.length > 500) return;
      const hasRadioGroup = text.includes('清单放最后') || text.includes('原地输出') || text.includes('抽丢清单');
      if (hasRadioGroup) return;
      if (elem.querySelector('.my-copy-btn')) return;
      let targetButton = null;
      buttons.forEach((btn) => {
        const btnText = btn.textContent?.trim() || '';
        const btnClass = btn.className || '';
        const btnHTML = btn.innerHTML || '';
        if (btnClass.includes('success') || btnClass.includes('check') || btnHTML.includes('✓') || btnHTML.includes('check') || btn.querySelector('[class*="check"]') || btn.querySelector('[class*="success"]')) {
          targetButton = btn;
        }
        if ((btnHTML.includes('×') || btnHTML.includes('close') || btnText === 'X' || btnText === '×') && !targetButton) {
          targetButton = btn;
        }
      });

      const copyBtn = document.createElement('button');
      copyBtn.className = 'my-copy-btn';
      copyBtn.textContent = '复制';
      copyBtn.title = `复制 ${fileName}`;
      copyBtn.dataset.fileKey = fileKey;
      copyBtn.style.cssText = `display: inline-flex !important;align-items: center !important;justify-content: center !important;padding: 4px 12px !important;margin: 0 4px !important;background: #2563eb !important;color: white !important;border: none !important;border-radius: 6px !important;cursor: pointer !important;font-size: 13px !important;font-weight: 500 !important;white-space: nowrap !important;transition: background 0.2s !important;`;
      copyBtn.addEventListener('mouseenter', () => { copyBtn.style.background = '#1d4ed8 !important'; });
      copyBtn.addEventListener('mouseleave', () => { copyBtn.style.background = '#2563eb !important'; });
      copyBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        copyFile(copyBtn.dataset.fileKey, fileName);
      });
      if (targetButton) {
        try {
          targetButton.parentElement.insertBefore(copyBtn, targetButton);
          processedFiles.add(fileKey);
        } catch (e) {
          try {
            buttons[0].parentElement.insertBefore(copyBtn, buttons[0].nextSibling);
            processedFiles.add(fileKey);
          } catch (e2) { }
        }
      } else {
        try {
          const lastBtn = buttons[buttons.length - 1];
          lastBtn.parentElement.insertBefore(copyBtn, lastBtn);
          processedFiles.add(fileKey);
        } catch (e) { }
      }
    });
  }

  async function copyFile(fileKey, displayName) {
    const file = window.__fileDebugCache.get(fileKey);
    if (!file) return;
    const fileName = file.name;
    copyCounter++;
    // 大小写无关的扩展名替换；否则 INVOICE.PDF 复制后同名，反而覆盖原文件。
    const newFileName = fileName.replace(/\.pdf$/i, `_副本${copyCounter}.pdf`);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const originalBytes = new Uint8Array(arrayBuffer);
      const timestamp = Date.now();
      const randomId = Math.random().toString(36).substring(2, 15);
      const comment = `\n%%PDF-COPY-${timestamp}-${randomId}-END%%\n`;
      const commentBytes = new TextEncoder().encode(comment);
      const newBytes = new Uint8Array(originalBytes.length + commentBytes.length);
      newBytes.set(originalBytes, 0);
      newBytes.set(commentBytes, originalBytes.length);
      const copiedFile = new File([newBytes], newFileName, { type: file.type, lastModified: Date.now() });
      const fileInput = document.querySelector('input[type="file"]');
      if (!fileInput) return;
      // 追加副本，绝不替换用户已经选好的其他票据。
      const dataTransfer = new DataTransfer();
      for (const existing of Array.from(fileInput.files || [])) dataTransfer.items.add(existing);
      dataTransfer.items.add(copiedFile);
      fileInput.files = dataTransfer.files;
      const event = new Event('change', { bubbles: true });
      fileInput.dispatchEvent(event);
      const notification = document.createElement('div');
      notification.textContent = `✅ 已复制: ${fileName}`;
      notification.style.cssText = `position: fixed;top: 20px;right: 20px;padding: 12px 20px;background: #10b981;color: white;border-radius: 8px;box-shadow: 0 4px 6px rgba(0,0,0,0.1);z-index: 99999;font-size: 14px;animation: slideIn 0.3s;`;
      document.body.appendChild(notification);
      setTimeout(() => notification.remove(), 3000);
    } catch (e) {
      alert(`❌ 复制失败: ${e.message}`);
    }
  }

  const style = document.createElement('style');
  style.textContent = `@keyframes slideIn { from { transform: translateX(400px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }`;
  document.head.appendChild(style);

  function initCopyButtonFeature() {
    addCopyButtons();
    if (window.requestIdleCallback) {
      function scheduleCheck() {
        requestIdleCallback(() => {
          addCopyButtons();
          setTimeout(scheduleCheck, 2000);
        }, { timeout: 3000 });
      }
      scheduleCheck();
    } else {
      setInterval(addCopyButtons, 2000);
    }

    let observerTimer = null;
    const observer = new MutationObserver(() => {
      if (observerTimer) return;
      observerTimer = setTimeout(() => {
        addCopyButtons();
        observerTimer = null;
      }, 500);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(initCopyButtonFeature, 1000);
    });
  } else {
    setTimeout(initCopyButtonFeature, 1000);
  }

  function hideExpenseReportFiles() {
    const fileAreas = document.querySelectorAll('[role="complementary"], aside, [class*="file"], [class*="upload"]');
    if (fileAreas.length === 0) return;
    fileAreas.forEach(area => {
      const elements = area.querySelectorAll('*');
      elements.forEach(elem => {
        const text = elem.textContent || '';
        if (text.length < 200 && text.includes('000_报销单') && text.includes('.pdf')) {
          let fileItem = elem;
          let depth = 0;
          while (fileItem && depth < 5) {
            const hasButtons = fileItem.querySelectorAll('button').length > 0;
            const hasFileName = fileItem.textContent.includes('.pdf');
            if (hasButtons && hasFileName && fileItem.textContent.length < 300) {
              if (!fileItem.hasAttribute('data-expense-report-hidden')) {
                fileItem.style.display = 'none';
                fileItem.setAttribute('data-expense-report-hidden', 'true');
              }
              break;
            }
            fileItem = fileItem.parentElement;
            depth++;
          }
        }
      });
    });
  }

  function initHideExpenseReportFiles() {
    hideExpenseReportFiles();
    let observerTimer = null;
    const observer = new MutationObserver(() => {
      if (observerTimer) return;
      observerTimer = setTimeout(() => {
        hideExpenseReportFiles();
        observerTimer = null;
      }, 300);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setInterval(hideExpenseReportFiles, 2000);
  }

  document.addEventListener('click', function (e) {
    const button = e.target.closest('button');
    if (!button) return;
    const text = button.textContent || button.innerText || '';
    if (text.includes('打印') || text.includes('Print') || text.includes('下载') || text.includes('Download') || text.includes('合并')) {
      if (!text.includes('打印') && !text.includes('Print')) {
        showProcessingNotification(text);
      }
      if (text.includes('打印') || text.includes('Print')) {
        if (window.__mergedPdfBlobUrl) {
          e.stopImmediatePropagation();
          e.preventDefault();
          const iframeId = 'print-iframe-QeuOa42kUm1C';
          let pf = document.getElementById(iframeId);
          if (pf) pf.remove();
          pf = document.createElement('iframe');
          pf.id = iframeId;
          pf.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:none;';
          document.body.appendChild(pf);
          pf.onload = () => { try { pf.contentWindow.focus(); pf.contentWindow.print(); } catch (err) { window.print(); } };
          pf.src = window.__mergedPdfBlobUrl;
          return;
        }
        setTimeout(() => tryTriggerPrint(), 1000);
      }
    }
  }, true);

  function tryTriggerPrint() {
    const iframes = document.querySelectorAll('iframe');
    iframes.forEach(iframe => {
      try {
        const src = iframe.src || '';
        if (src.includes('.pdf') || src.startsWith('blob:')) {
          setTimeout(() => {
            try {
              iframe.contentWindow.print();
              showSuccessNotification('✅ 已打开打印对话框');
            } catch (e) { }
          }, 500);
        }
      } catch (e) { }
    });
  }

  window.initHideExpenseReportFiles = initHideExpenseReportFiles;
})();