interface AndroidPrintBridge {
  printCurrentPage?: (jobName: string) => void;
  printHtml?: (htmlContent: string, jobName: string) => void;
}

function getAndroidPrintBridge(): AndroidPrintBridge | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { AndroidPrintBridge?: AndroidPrintBridge };
  return w.AndroidPrintBridge ?? null;
}

/**
 * Triggers native system printing on Android WebView (connecting to Wi-Fi, Bluetooth, USB, or PDF printers)
 * or standard browser `window.print()` on desktop/mobile web.
 */
export function printCurrentView(jobName = 'بقالة الحسام - طباعة'): void {
  const bridge = getAndroidPrintBridge();
  if (bridge?.printCurrentPage) {
    bridge.printCurrentPage(jobName);
    return;
  }
  window.print();
}

/**
 * Prints standalone HTML (such as barcode labels sheets or thermal stickers)
 * without opening blocked popups (`window.open`), working on both Android PrintManager and Web browsers.
 */
export function printHtmlDocument(
  htmlContent: string,
  jobName = 'بقالة الحسام - ملصق باركود'
): void {
  const bridge = getAndroidPrintBridge();
  if (bridge?.printHtml) {
    bridge.printHtml(htmlContent, jobName);
    return;
  }

  // Web fallback: print cleanly through an invisible iframe
  const existing = document.getElementById('alhussam-hidden-print-frame');
  if (existing) {
    existing.remove();
  }

  const iframe = document.createElement('iframe');
  iframe.id = 'alhussam-hidden-print-frame';
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.style.opacity = '0';
  iframe.style.pointerEvents = 'none';
  document.body.appendChild(iframe);

  const cleanup = () => {
    window.setTimeout(() => {
      iframe.remove();
    }, 1500);
  };

  iframe.onload = () => {
    try {
      const win = iframe.contentWindow;
      if (!win) {
        cleanup();
        return;
      }
      win.focus();
      win.print();
    } finally {
      cleanup();
    }
  };

  const doc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!doc) {
    iframe.remove();
    return;
  }
  doc.open();
  doc.write(htmlContent);
  doc.close();
}
