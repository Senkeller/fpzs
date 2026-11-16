(function () {
  // 复用同一个提示框只改文案：生成报销单是多阶段任务，反复 remove/append
  // 会闪屏，也让用户看不出到底卡在渲染还是卡在合并。
  window.updateProcessingNotification = function (action) {
    const el = document.getElementById('processing-notification');
    if (!el) { window.showProcessingNotification(action); return; }
    const label = el.querySelector('.processing-label');
    if (label) label.textContent = '正在' + action + '...';
  };

  window.showProcessingNotification = function (action) {
    const notification = document.createElement('div');
    notification.id = 'processing-notification';
    notification.innerHTML = `
      <div style="display: flex; align-items: center; gap: 12px;">
        <div class="spinner"></div>
        <span class="processing-label">正在${action}...</span>
      </div>
    `;
    notification.style.cssText = `position: fixed;top: 20px;right: 20px;padding: 16px 24px;background: white;color: #1f2937;border: 2px solid #3b82f6;border-radius: 12px;box-shadow: 0 4px 12px rgba(0,0,0,0.15);z-index: 99999;font-size: 15px;font-weight: 500;animation: slideIn 0.3s;`;

    if (!document.getElementById('spinner-style')) {
      const spinnerStyle = document.createElement('style');
      spinnerStyle.id = 'spinner-style';
      spinnerStyle.textContent = `
        .spinner {
          width: 20px;
          height: 20px;
          border: 3px solid #e5e7eb;
          border-top-color: #3b82f6;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `;
      document.head.appendChild(spinnerStyle);
    }

    const oldNotification = document.getElementById('processing-notification');
    if (oldNotification) oldNotification.remove();
    document.body.appendChild(notification);
  };

  window.showSuccessNotification = function (message) {
    const oldNotification = document.getElementById('processing-notification');
    if (oldNotification) oldNotification.remove();
    const notification = document.createElement('div');
    notification.textContent = message;
    notification.style.cssText = `position: fixed;top: 20px;right: 20px;padding: 12px 20px;background: #10b981;color: white;border-radius: 8px;box-shadow: 0 4px 6px rgba(0,0,0,0.1);z-index: 99999;font-size: 14px;animation: slideIn 0.3s;`;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
  };
})();