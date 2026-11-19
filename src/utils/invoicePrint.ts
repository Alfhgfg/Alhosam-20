import QRCode from 'qrcode';
import type {
  InvoicePaperSize,
  SaleInvoice,
  StoreLogoMode,
  StoreSettings,
} from '../types';
import {
  formatDateTime,
  formatMoney,
  paymentMethodLabel,
  saleStatusLabel,
} from './format';

export interface InvoicePreferences {
  paperSize: InvoicePaperSize;
  showCustomerInfo: boolean;
  showSellerInfo: boolean;
  showProductCode: boolean;
  showDiscount: boolean;
  showQrCode: boolean;
}

const LOCAL_PREFS_KEY = 'alhussam_invoice_prefs_v1';

export function resolveInvoicePreferences(
  settings: StoreSettings
): InvoicePreferences {
  const base: InvoicePreferences = {
    paperSize: settings.defaultPaperSize || 'a4',
    showCustomerInfo: settings.showCustomerInfo ?? true,
    showSellerInfo: settings.showSellerInfo ?? true,
    showProductCode: settings.showProductCode ?? true,
    showDiscount: settings.showDiscount ?? true,
    showQrCode: settings.showQrCode ?? true,
  };

  if (typeof window === 'undefined') return base;
  try {
    const raw = window.localStorage.getItem(LOCAL_PREFS_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<InvoicePreferences>;
    return {
      paperSize:
        parsed.paperSize === 'a4' ||
        parsed.paperSize === '80mm' ||
        parsed.paperSize === '58mm'
          ? parsed.paperSize
          : base.paperSize,
      showCustomerInfo:
        typeof parsed.showCustomerInfo === 'boolean'
          ? parsed.showCustomerInfo
          : base.showCustomerInfo,
      showSellerInfo:
        typeof parsed.showSellerInfo === 'boolean'
          ? parsed.showSellerInfo
          : base.showSellerInfo,
      showProductCode:
        typeof parsed.showProductCode === 'boolean'
          ? parsed.showProductCode
          : base.showProductCode,
      showDiscount:
        typeof parsed.showDiscount === 'boolean'
          ? parsed.showDiscount
          : base.showDiscount,
      showQrCode:
        typeof parsed.showQrCode === 'boolean'
          ? parsed.showQrCode
          : base.showQrCode,
    };
  } catch {
    return base;
  }
}

export function saveLocalInvoicePreferences(prefs: InvoicePreferences): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LOCAL_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // ignore storage quota failure
  }
}

export function clearLocalInvoicePreferences(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(LOCAL_PREFS_KEY);
  } catch {
    // ignore
  }
}

export function buildInvoiceQrPayload(
  sale: SaleInvoice,
  settings: StoreSettings
): string {
  const lines = [
    settings.storeName || 'بقالة الحسام',
    `INV: ${sale.invoiceNumber}`,
    `DATE: ${formatDateTime(sale.createdAt)}`,
    `TOTAL: ${formatMoney(sale.total, settings.currency)}`,
    `PAID: ${formatMoney(sale.paidAmount, settings.currency)}`,
    `DUE: ${formatMoney(sale.remainingAmount, settings.currency)}`,
    `PAY: ${paymentMethodLabel(sale.paymentMethod)}`,
    `STATUS: ${saleStatusLabel(sale.status)}`,
  ];
  return lines.join('\n');
}

export async function generateInvoiceQrDataUrl(
  sale: SaleInvoice,
  settings: StoreSettings
): Promise<string> {
  const payload = buildInvoiceQrPayload(sale, settings);
  return QRCode.toDataURL(payload, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 180,
    color: {
      dark: '#0f172a',
      light: '#ffffff',
    },
  });
}

export async function resizeLogoToDataUrl(file: File): Promise<string> {
  const MAX_LEN = 32000;
  const imgUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('تعذر قراءة ملف الصورة المختار.'));
      el.src = imgUrl;
    });

    const maxDims = [180, 128, 96];
    const qualities = [0.85, 0.7, 0.55];

    for (const maxDim of maxDims) {
      const scale = Math.min(1, maxDim / Math.max(img.width || 1, img.height || 1));
      const w = Math.max(1, Math.round((img.width || maxDim) * scale));
      const h = Math.max(1, Math.round((img.height || maxDim) * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);

      for (const q of qualities) {
        const webp = canvas.toDataURL('image/webp', q);
        if (webp.startsWith('data:image/webp') && webp.length <= MAX_LEN) {
          return webp;
        }
        const png = canvas.toDataURL('image/png');
        if (png.length <= MAX_LEN) {
          return png;
        }
      }
    }

    throw new Error('حجم الشعار كبير جداً حتى بعد الضغط، يرجى اختيار صورة أبسط أو أصغر.');
  } finally {
    URL.revokeObjectURL(imgUrl);
  }
}

export function logoModeLabel(mode: StoreLogoMode | undefined): string {
  switch (mode) {
    case 'minimal':
      return 'ختم أحادي مبسط (مناسب للحراري)';
    case 'custom':
      return 'شعار مخصص (صورة مرفوعة)';
    case 'none':
      return 'بدون شعار';
    default:
      return 'الشعار الرسمي لبقالة الحسام';
  }
}

export function paperSizeLabel(size: InvoicePaperSize): string {
  switch (size) {
    case '80mm':
      return 'حراري 80mm';
    case '58mm':
      return 'حراري 58mm';
    default:
      return 'A4 قياسي';
  }
}
