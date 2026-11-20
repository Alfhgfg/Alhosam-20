import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  Copy,
  MapPin,
  Phone,
  Printer,
  RotateCcw,
  Save,
  SlidersHorizontal,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useBackLayer } from '../contexts/NavigationContext';
import { useStoreData } from '../contexts/StoreDataContext';
import { updateStoreSettings } from '../services/accountingService';
import type { InvoicePaperSize, SaleInvoice, SaleStatus } from '../types';
import {
  formatDateTime,
  formatMoney,
  formatNumber,
  paymentMethodLabel,
  roundMoney,
  saleStatusLabel,
} from '../utils/format';
import {
  clearLocalInvoicePreferences,
  generateInvoiceQrDataUrl,
  paperSizeLabel,
  resolveInvoicePreferences,
  saveLocalInvoicePreferences,
  type InvoicePreferences,
} from '../utils/invoicePrint';
import { printCurrentView } from '../utils/print';
import { StoreBrandLogo } from './StoreBrandLogo';
import { BackButton } from './UnifiedBackHeader';

interface InvoiceDetailModalProps {
  sale: SaleInvoice | null;
  onClose: () => void;
  showProfit?: boolean;
}

function statusStyleClasses(status: SaleStatus): string {
  switch (status) {
    case 'completed':
      return 'border-emerald-700 text-emerald-800 bg-emerald-50/80';
    case 'cancelled':
      return 'border-red-700 text-red-800 bg-red-50/80';
    case 'partial_return':
    case 'returned':
      return 'border-amber-700 text-amber-800 bg-amber-50/80';
  }
}

export const InvoiceDetailModal: React.FC<InvoiceDetailModalProps> = ({
  sale,
  onClose,
  showProfit = false,
}) => {
  const { isAdmin, actorInfo } = useAuth();
  const { settings } = useStoreData();

  const [copied, setCopied] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [printProfit, setPrintProfit] = useState(false);
  const [savingDefaults, setSavingDefaults] = useState(false);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [prefs, setPrefs] = useState<InvoicePreferences>(() =>
    resolveInvoicePreferences(settings)
  );

  const requestBack = useBackLayer({
    id: 'invoice-detail',
    active: Boolean(sale),
    onClose,
  });

  // Sync prefs if store defaults update and no local override overrides everything
  useEffect(() => {
    setPrefs(resolveInvoicePreferences(settings));
  }, [settings]);

  // Mark body attribute while modal is mounted with a sale so @media print isolates this portal
  useEffect(() => {
    if (!sale) return;
    document.body.setAttribute('data-invoice-modal-open', 'true');
    return () => {
      document.body.removeAttribute('data-invoice-modal-open');
    };
  }, [sale]);

  // Generate QR code offline whenever sale or settings change
  useEffect(() => {
    if (!sale || !prefs.showQrCode) {
      setQrDataUrl('');
      return;
    }
    let cancelled = false;
    void generateInvoiceQrDataUrl(sale, settings)
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl('');
      });
    return () => {
      cancelled = true;
    };
  }, [sale, settings, prefs.showQrCode]);

  const itemStats = useMemo(() => {
    if (!sale) return { hasLineDiscounts: false, totalLineDiscounts: 0 };
    let totalLineDiscounts = 0;
    for (const item of sale.items) {
      const gross = roundMoney(item.unitPrice * item.qty);
      const diff = roundMoney(gross - item.lineTotal);
      if (diff > 0.009) {
        totalLineDiscounts = roundMoney(totalLineDiscounts + diff);
      }
    }
    return {
      hasLineDiscounts: totalLineDiscounts > 0.009,
      totalLineDiscounts,
    };
  }, [sale]);

  if (!sale) return null;

  const updatePref = <K extends keyof InvoicePreferences>(
    key: K,
    value: InvoicePreferences[K]
  ) => {
    setPrefs((prev) => {
      const next = { ...prev, [key]: value };
      saveLocalInvoicePreferences(next);
      return next;
    });
  };

  const handleResetPrefs = () => {
    clearLocalInvoicePreferences();
    setPrefs({
      paperSize: settings.defaultPaperSize || 'a4',
      showCustomerInfo: settings.showCustomerInfo ?? true,
      showSellerInfo: settings.showSellerInfo ?? true,
      showProductCode: settings.showProductCode ?? true,
      showDiscount: settings.showDiscount ?? true,
      showQrCode: settings.showQrCode ?? true,
    });
    setSaveNotice('تمت استعادة الإعدادات الافتراضية للمتجر.');
    setTimeout(() => setSaveNotice(null), 2500);
  };

  const handleSaveAsStoreDefaults = async () => {
    if (!isAdmin || !actorInfo) return;
    setSavingDefaults(true);
    setSaveNotice(null);
    try {
      await updateStoreSettings(actorInfo, {
        storeName: settings.storeName,
        phone: settings.phone,
        address: settings.address,
        contactInfo: settings.contactInfo || '',
        promoText: settings.promoText || '',
        currency: settings.currency,
        receiptFooter: settings.receiptFooter,
        logoMode: settings.logoMode || 'default',
        logoDataUrl: settings.logoDataUrl || '',
        defaultPaperSize: prefs.paperSize,
        showCustomerInfo: prefs.showCustomerInfo,
        showSellerInfo: prefs.showSellerInfo,
        showProductCode: prefs.showProductCode,
        showDiscount: prefs.showDiscount,
        showQrCode: prefs.showQrCode,
      });
      clearLocalInvoicePreferences();
      setSaveNotice('تم حفظ تفضيلات الفاتورة كإعداد افتراضي لجميع الأجهزة.');
      setTimeout(() => setSaveNotice(null), 3000);
    } catch (err) {
      setSaveNotice(
        err instanceof Error ? err.message : 'تعذر حفظ الإعدادات الافتراضية.'
      );
    } finally {
      setSavingDefaults(false);
    }
  };

  const handlePrint = () => {
    printCurrentView(`فاتورة بيع - ${sale.invoiceNumber}`);
  };

  const handleCopyShare = async () => {
    const lines = [
      `${settings.storeName} - فاتورة رقم ${sale.invoiceNumber}`,
      `التاريخ: ${formatDateTime(sale.createdAt)}`,
      `الحالة: ${saleStatusLabel(sale.status)}`,
      ...(prefs.showCustomerInfo
        ? [
            `العميل: ${sale.customerName}${
              sale.customerCode ? ` (${sale.customerCode})` : ''
            }`,
          ]
        : []),
      ...(prefs.showSellerInfo ? [`البائع: ${sale.employeeName}`] : []),
      ...(sale.deviceName ? [`الجهاز: ${sale.deviceName}`] : []),
      `طريقة الدفع: ${paymentMethodLabel(sale.paymentMethod)}`,
      `----------------`,
      ...sale.items.map(
        (it) =>
          `• ${it.name}${prefs.showProductCode ? ` [${it.code}]` : ''} × ${
            it.qty
          } ${it.unit} = ${formatMoney(it.lineTotal, settings.currency)}`
      ),
      `----------------`,
      `المجموع قبل الخصم: ${formatMoney(sale.subtotal, settings.currency)}`,
      ...(sale.discount > 0
        ? [`الخصم: -${formatMoney(sale.discount, settings.currency)}`]
        : []),
      `المجموع النهائي: ${formatMoney(sale.total, settings.currency)}`,
      `المدفوع: ${formatMoney(sale.paidAmount, settings.currency)}`,
      `المتبقي: ${formatMoney(sale.remainingAmount, settings.currency)}`,
      ...(settings.receiptFooter ? [settings.receiptFooter] : []),
      ...(settings.promoText ? [settings.promoText] : []),
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard blocked fallback ignored
    }
  };

  const isThermal = prefs.paperSize === '80mm' || prefs.paperSize === '58mm';
  const is58mm = prefs.paperSize === '58mm';
  const showDiscountCol =
    !isThermal && prefs.showDiscount && itemStats.hasLineDiscounts;
  const effectiveDiscountTotal = sale.discount;
  const pagePrintStyle =
    prefs.paperSize === '80mm'
      ? '@media print { @page { size: 80mm auto; margin: 3mm; } }'
      : prefs.paperSize === '58mm'
      ? '@media print { @page { size: 58mm auto; margin: 2mm; } }'
      : '@media print { @page { size: A4 portrait; margin: 10mm; } }';

  const thankYouMessage =
    settings.receiptFooter?.trim() || 'شكراً لتسوقكم من بقالة الحسام';

  const modalContent = (
    <div
      id="invoice-print-root"
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-[1px] flex items-center justify-center p-2 sm:p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label={`فاتورة بيع رقم ${sale.invoiceNumber}`}
    >
      <style>{pagePrintStyle}</style>

      <div className="invoice-modal-shell bg-slate-100 border border-slate-300 rounded-2xl w-full max-w-4xl max-h-[95dvh] flex flex-col overflow-hidden shadow-2xl">
        {/* Top Action & Paper Toolbar (no-print) */}
        <div className="bg-white border-b border-slate-200 px-3.5 sm:px-5 py-3 flex flex-col gap-2.5 no-print shrink-0">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex items-center gap-2.5 min-w-0">
              <BackButton onClick={requestBack} compact />
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm sm:text-base font-bold text-slate-900 font-display truncate">
                    فاتورة بيع #{sale.invoiceNumber}
                  </h3>
                  <span
                    className={`text-[11px] font-bold px-2 py-0.5 rounded border ${statusStyleClasses(
                      sale.status
                    )}`}
                  >
                    {saleStatusLabel(sale.status)}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                  {formatDateTime(sale.createdAt)} · البائع: {sale.employeeName}
                  {sale.deviceName ? ` · ${sale.deviceName}` : ''}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setCustomizeOpen((v) => !v)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg border cursor-pointer whitespace-nowrap shrink-0 transition-colors ${
                  customizeOpen
                    ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                <span>تخصيص</span>
              </button>

              <button
                type="button"
                onClick={handleCopyShare}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 cursor-pointer whitespace-nowrap shrink-0"
              >
                {copied ? (
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
                <span>{copied ? 'تم النسخ' : 'نسخ'}</span>
              </button>

              <button
                type="button"
                onClick={handlePrint}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>طباعة / PDF</span>
              </button>
            </div>
          </div>

          {/* Quick Paper Size Switcher */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-100">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-semibold text-slate-500 ml-1">
                حجم الورق:
              </span>
              {(['a4', '80mm', '58mm'] as InvoicePaperSize[]).map((size) => {
                const active = prefs.paperSize === size;
                return (
                  <button
                    key={size}
                    type="button"
                    onClick={() => updatePref('paperSize', size)}
                    className={`px-2.5 py-1 text-[11px] font-semibold rounded-md border cursor-pointer whitespace-nowrap shrink-0 transition-colors ${
                      active
                        ? 'bg-slate-900 text-white border-slate-900'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                    }`}
                  >
                    {paperSizeLabel(size)}
                  </button>
                );
              })}
            </div>

            {showProfit && (
              <label className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={printProfit}
                  onChange={(e) => setPrintProfit(e.target.checked)}
                  className="rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
                />
                <span>تضمين صافي الربح في الطباعة</span>
              </label>
            )}
          </div>

          {/* Inline Customization Drawer */}
          {customizeOpen && (
            <div className="mt-1 p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold text-slate-800">
                  خيارات عرض الفاتورة والطباعة
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleResetPrefs}
                    className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-600 hover:text-slate-900 bg-white border border-slate-200 rounded-md cursor-pointer whitespace-nowrap"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>استعادة الافتراضي</span>
                  </button>
                  {isAdmin && (
                    <button
                      type="button"
                      disabled={savingDefaults}
                      onClick={handleSaveAsStoreDefaults}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-md cursor-pointer whitespace-nowrap disabled:opacity-60"
                    >
                      <Save className="w-3 h-3" />
                      <span>
                        {savingDefaults
                          ? 'جاري الحفظ...'
                          : 'حفظ كافتراضي للمتجر'}
                      </span>
                    </button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 text-xs">
                {(
                  [
                    { key: 'showCustomerInfo', label: 'بيانات العميل' },
                    { key: 'showSellerInfo', label: 'بيانات البائع' },
                    { key: 'showProductCode', label: 'أكواد الأصناف' },
                    { key: 'showDiscount', label: 'إظهار الخصم' },
                    { key: 'showQrCode', label: 'رمز QR للفاتورة' },
                  ] as const
                ).map((item) => (
                  <label
                    key={item.key}
                    className="flex items-center gap-2 px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg cursor-pointer hover:border-emerald-300"
                  >
                    <input
                      type="checkbox"
                      checked={prefs[item.key]}
                      onChange={(e) => updatePref(item.key, e.target.checked)}
                      className="rounded border-slate-300 text-emerald-700 focus:ring-emerald-600"
                    />
                    <span className="text-slate-700 font-medium">
                      {item.label}
                    </span>
                  </label>
                ))}
              </div>

              {saveNotice && (
                <div className="text-[11px] font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5">
                  {saveNotice}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Scrollable Preview Area */}
        <div className="invoice-modal-scroll flex-1 overflow-y-auto p-3 sm:p-6 bg-slate-200/70">
          {sale.isOfflinePending && (
            <div className="mb-3 mx-auto max-w-[794px] p-3 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 text-xs font-medium no-print">
              فاتورة محفوظة محلياً — بانتظار المزامنة مع السحابة فور عودة الاتصال بالإنترنت.
            </div>
          )}

          {/* Printable Commercial Sheet */}
          <article
            data-paper={prefs.paperSize}
            className={`invoice-sheet bg-white text-slate-900 mx-auto print-container ${
              prefs.paperSize === 'a4'
                ? 'w-full max-w-[794px] border border-slate-300 rounded-xl shadow-sm p-4 sm:p-8'
                : prefs.paperSize === '80mm'
                ? 'w-full max-w-[310px] border border-slate-300 rounded-lg shadow-sm p-3.5 text-[11px]'
                : 'w-full max-w-[232px] border border-slate-300 rounded-lg shadow-sm p-2.5 text-[10px]'
            }`}
          >
            {isThermal ? (
              /* ================= THERMAL RECEIPT LAYOUT (80mm / 58mm) ================= */
              <div className="space-y-2.5">
                {/* Thermal Header */}
                <header className="invoice-avoid-break text-center border-b border-dashed border-slate-400 pb-2.5 space-y-1">
                  {settings.logoMode !== 'none' && (
                    <div className="flex justify-center mb-1">
                      <StoreBrandLogo
                        mode={settings.logoMode}
                        customDataUrl={settings.logoDataUrl}
                        storeName={settings.storeName}
                        compact
                        monochrome={settings.logoMode !== 'custom'}
                      />
                    </div>
                  )}
                  <h1
                    className={`font-display font-bold text-slate-950 leading-tight ${
                      is58mm ? 'text-sm' : 'text-base'
                    }`}
                  >
                    {settings.storeName}
                  </h1>
                  {settings.address && (
                    <p className="text-slate-700 leading-snug">
                      {settings.address}
                    </p>
                  )}
                  {(settings.phone || settings.contactInfo) && (
                    <p className="text-slate-700 font-mono-num leading-snug">
                      {[settings.phone, settings.contactInfo]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  )}
                  <div className="pt-1 mt-1 border-t border-dotted border-slate-300 flex items-center justify-between gap-1 text-slate-900 font-semibold">
                    <span>فاتورة بيع</span>
                    <span className="font-mono-num font-bold">
                      #{sale.invoiceNumber}
                    </span>
                  </div>
                </header>

                {/* Thermal Metadata */}
                <section className="invoice-avoid-break border-b border-dashed border-slate-400 pb-2 space-y-1 text-slate-800">
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-600">التاريخ:</span>
                    <span className="font-mono-num text-left">
                      {formatDateTime(sale.createdAt)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-600">الحالة:</span>
                    <span className="font-bold">
                      {saleStatusLabel(sale.status)}
                    </span>
                  </div>
                  {prefs.showCustomerInfo && (
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-600">العميل:</span>
                      <span className="font-semibold text-left truncate">
                        {sale.customerName}
                        {sale.customerCode ? ` (${sale.customerCode})` : ''}
                      </span>
                    </div>
                  )}
                  {prefs.showSellerInfo && (
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-600">البائع:</span>
                      <span className="font-medium text-left truncate">
                        {sale.employeeName}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-600">الجهاز:</span>
                    <span className="text-left truncate">
                      {sale.deviceName || 'نقطة البيع'}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-600">الدفع:</span>
                    <span className="font-bold">
                      {paymentMethodLabel(sale.paymentMethod)}
                    </span>
                  </div>
                </section>

                {/* Thermal Items Table */}
                <section className="border-b border-dashed border-slate-400 pb-2">
                  {is58mm ? (
                    <table className="w-full invoice-items-table border-collapse">
                      <thead>
                        <tr className="border-b border-slate-400 text-slate-700 font-bold">
                          <th className="text-right py-1 font-bold">الصنف</th>
                          <th className="text-left py-1 font-bold">الإجمالي</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-dotted divide-slate-300">
                        {sale.items.map((item, idx) => (
                          <tr key={`${item.productId}_${idx}`}>
                            <td className="py-1.5 pl-1 align-top">
                              <div className="font-semibold text-slate-950 leading-snug break-words">
                                {item.name}
                              </div>
                              <div className="text-[9px] text-slate-600 font-mono-num mt-0.5">
                                {prefs.showProductCode ? `[${item.code}] ` : ''}
                                {formatNumber(item.qty)} {item.unit} ×{' '}
                                {formatMoney(item.unitPrice, settings.currency)}
                              </div>
                            </td>
                            <td className="py-1.5 text-left align-top font-mono-num font-bold text-slate-950 whitespace-nowrap">
                              {formatMoney(item.lineTotal, settings.currency)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <table className="w-full invoice-items-table border-collapse">
                      <thead>
                        <tr className="border-b border-slate-400 text-slate-800">
                          <th className="text-right py-1 font-bold">الصنف</th>
                          <th className="text-center py-1 font-bold whitespace-nowrap px-1">
                            الكمية
                          </th>
                          <th className="text-left py-1 font-bold whitespace-nowrap px-1">
                            السعر
                          </th>
                          <th className="text-left py-1 font-bold whitespace-nowrap">
                            الإجمالي
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-dotted divide-slate-300">
                        {sale.items.map((item, idx) => (
                          <tr key={`${item.productId}_${idx}`}>
                            <td className="py-1.5 pl-1 align-top">
                              <div className="font-semibold text-slate-950 leading-snug break-words">
                                {item.name}
                              </div>
                              {prefs.showProductCode && (
                                <div className="text-[9px] font-mono-num text-slate-600">
                                  #{item.code}
                                </div>
                              )}
                            </td>
                            <td className="py-1.5 px-1 text-center align-top font-mono-num whitespace-nowrap">
                              {formatNumber(item.qty)}
                              <div className="text-[9px] text-slate-600">
                                {item.unit}
                              </div>
                            </td>
                            <td className="py-1.5 px-1 text-left align-top font-mono-num whitespace-nowrap">
                              {formatNumber(item.unitPrice)}
                            </td>
                            <td className="py-1.5 text-left align-top font-mono-num font-bold text-slate-950 whitespace-nowrap">
                              {formatNumber(item.lineTotal)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </section>

                {/* Thermal Totals Summary */}
                <section className="invoice-avoid-break space-y-1 border-b border-dashed border-slate-400 pb-2.5">
                  <div className="flex justify-between text-slate-700">
                    <span>المجموع قبل الخصم</span>
                    <span className="font-mono-num">
                      {formatMoney(sale.subtotal, settings.currency)}
                    </span>
                  </div>
                  {prefs.showDiscount && effectiveDiscountTotal > 0 && (
                    <div className="flex justify-between text-slate-800">
                      <span>الخصم</span>
                      <span className="font-mono-num font-semibold">
                        - {formatMoney(effectiveDiscountTotal, settings.currency)}
                      </span>
                    </div>
                  )}
                  <div
                    className={`flex justify-between items-baseline border-y border-slate-900 py-1.5 my-1 font-extrabold text-slate-950 ${
                      is58mm ? 'text-xs' : 'text-sm'
                    }`}
                  >
                    <span>المجموع النهائي</span>
                    <span className="font-mono-num">
                      {formatMoney(sale.total, settings.currency)}
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-800">
                    <span>المدفوع</span>
                    <span className="font-mono-num font-semibold">
                      {formatMoney(sale.paidAmount, settings.currency)}
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-900">
                    <span>المتبقي</span>
                    <span className="font-mono-num font-semibold">
                      {formatMoney(sale.remainingAmount, settings.currency)}
                    </span>
                  </div>
                  {showProfit && (
                    <div
                      className={`flex justify-between text-slate-700 border-t border-dotted border-slate-300 pt-1 text-[10px] ${
                        printProfit ? '' : 'no-print'
                      }`}
                    >
                      <span>صافي الربح (للمسؤول)</span>
                      <span className="font-mono-num font-semibold">
                        {formatMoney(sale.netProfit, settings.currency)}
                      </span>
                    </div>
                  )}
                </section>

                {/* Thermal Footer & QR */}
                <footer className="invoice-avoid-break text-center space-y-1.5 pt-0.5">
                  {sale.notes && (
                    <p className="text-slate-700 text-[10px] bg-slate-50 border border-slate-200 rounded p-1.5 text-right">
                      ملاحظات: {sale.notes}
                    </p>
                  )}
                  <p className="font-bold text-slate-900">{thankYouMessage}</p>
                  {settings.promoText && (
                    <p className="text-slate-700 leading-snug">
                      {settings.promoText}
                    </p>
                  )}
                  {prefs.showQrCode && qrDataUrl && (
                    <div className="pt-1 flex flex-col items-center gap-1">
                      <img
                        src={qrDataUrl}
                        alt={`QR الفاتورة ${sale.invoiceNumber}`}
                        className={is58mm ? 'w-20 h-20' : 'w-24 h-24'}
                      />
                      <span className="text-[9px] font-mono-num text-slate-500">
                        {sale.invoiceNumber}
                      </span>
                    </div>
                  )}
                </footer>
              </div>
            ) : (
              /* ================= A4 COMMERCIAL ACCOUNTING INVOICE ================= */
              <div className="space-y-5">
                {/* Commercial Header */}
                <header className="invoice-avoid-break border-b-2 border-slate-900 pb-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                  <div className="flex items-start gap-3.5">
                    <StoreBrandLogo
                      mode={settings.logoMode}
                      customDataUrl={settings.logoDataUrl}
                      storeName={settings.storeName}
                    />
                    <div className="space-y-1 min-w-0">
                      <h1 className="font-display text-xl sm:text-2xl font-bold text-slate-950 tracking-tight leading-tight">
                        {settings.storeName}
                      </h1>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
                        {settings.address && (
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                            <span>{settings.address}</span>
                          </span>
                        )}
                        {settings.phone && (
                          <span className="inline-flex items-center gap-1 font-mono-num">
                            <Phone className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                            <span dir="ltr">{settings.phone}</span>
                          </span>
                        )}
                      </div>
                      {settings.contactInfo && (
                        <p className="text-xs text-slate-500">
                          {settings.contactInfo}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="sm:text-left shrink-0 border border-slate-300 bg-slate-50/70 rounded-xl px-4 py-3 min-w-[215px]">
                    <div className="flex items-center justify-between sm:justify-end gap-2 border-b border-slate-200 pb-1.5 mb-2">
                      <span className="text-[11px] font-bold text-slate-600">
                        فاتورة مبيعات
                      </span>
                      <span
                        className={`text-[11px] font-bold px-2 py-0.5 rounded border ${statusStyleClasses(
                          sale.status
                        )}`}
                      >
                        {saleStatusLabel(sale.status)}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-xs text-slate-500">رقم الفاتورة</span>
                      <span className="font-mono-num text-base sm:text-lg font-extrabold text-slate-950">
                        {sale.invoiceNumber}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between gap-3 mt-1 text-xs text-slate-600">
                      <span>التاريخ والوقت</span>
                      <span className="font-mono-num font-medium text-slate-800">
                        {formatDateTime(sale.createdAt)}
                      </span>
                    </div>
                  </div>
                </header>

                {/* Parties, POS Terminal & Payment Grid */}
                <section className="invoice-avoid-break grid grid-cols-2 sm:grid-cols-4 border border-slate-200 rounded-xl overflow-hidden divide-y sm:divide-y-0 sm:divide-x sm:divide-x-reverse divide-slate-200 bg-slate-50/50">
                  {prefs.showCustomerInfo && (
                    <div className="px-3.5 py-2.5">
                      <div className="text-[11px] font-semibold text-slate-500">
                        العميل
                      </div>
                      <div className="text-xs sm:text-sm font-bold text-slate-900 mt-0.5 break-words">
                        {sale.customerName}
                      </div>
                      {sale.customerCode && (
                        <div className="text-[11px] font-mono-num text-slate-500 mt-0.5">
                          كود: {sale.customerCode}
                        </div>
                      )}
                    </div>
                  )}

                  {prefs.showSellerInfo && (
                    <div className="px-3.5 py-2.5">
                      <div className="text-[11px] font-semibold text-slate-500">
                        البائع / الموظف
                      </div>
                      <div className="text-xs sm:text-sm font-bold text-slate-900 mt-0.5 break-words">
                        {sale.employeeName}
                      </div>
                    </div>
                  )}

                  <div className="px-3.5 py-2.5">
                    <div className="text-[11px] font-semibold text-slate-500">
                      نقطة البيع / الجهاز
                    </div>
                    <div className="text-xs sm:text-sm font-semibold text-slate-900 mt-0.5 break-words">
                      {sale.deviceName || 'غير محدد'}
                    </div>
                  </div>

                  <div className="px-3.5 py-2.5">
                    <div className="text-[11px] font-semibold text-slate-500">
                      طريقة الدفع
                    </div>
                    <div className="text-xs sm:text-sm font-bold text-emerald-800 mt-0.5">
                      {paymentMethodLabel(sale.paymentMethod)}
                    </div>
                  </div>
                </section>

                {/* Line Items Table (RTL Arabic Column Sequence) */}
                <section className="border border-slate-300 rounded-xl overflow-hidden">
                  <div className="overflow-x-auto print:overflow-visible">
                    <table className="w-full invoice-items-table border-collapse text-xs sm:text-sm">
                      <thead>
                        <tr className="bg-slate-900 text-white text-[11px] sm:text-xs">
                          <th className="py-2.5 px-2.5 text-center font-semibold w-9">
                            #
                          </th>
                          {prefs.showProductCode && (
                            <th className="py-2.5 px-2.5 text-right font-semibold whitespace-nowrap">
                              الكود
                            </th>
                          )}
                          <th className="py-2.5 px-3 text-right font-semibold min-w-[130px]">
                            الصنف
                          </th>
                          <th className="py-2.5 px-2.5 text-center font-semibold whitespace-nowrap">
                            الكمية والوحدة
                          </th>
                          <th className="py-2.5 px-2.5 text-left font-semibold whitespace-nowrap">
                            سعر الوحدة
                          </th>
                          {showDiscountCol && (
                            <th className="py-2.5 px-2.5 text-left font-semibold whitespace-nowrap">
                              الخصم
                            </th>
                          )}
                          <th className="py-2.5 px-3 text-left font-semibold whitespace-nowrap">
                            إجمالي الصنف
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {sale.items.map((item, idx) => {
                          const lineDisc = roundMoney(
                            item.unitPrice * item.qty - item.lineTotal
                          );
                          return (
                            <tr
                              key={`${item.productId}_${idx}`}
                              className={idx % 2 === 1 ? 'bg-slate-50/60' : 'bg-white'}
                            >
                              <td className="py-2.5 px-2.5 text-center font-mono-num text-xs text-slate-500">
                                {idx + 1}
                              </td>
                              {prefs.showProductCode && (
                                <td className="py-2.5 px-2.5 font-mono-num text-xs text-slate-600 whitespace-nowrap">
                                  {item.code}
                                </td>
                              )}
                              <td className="py-2.5 px-3 font-semibold text-slate-900 leading-snug break-words">
                                {item.name}
                              </td>
                              <td className="py-2.5 px-2.5 text-center font-mono-num whitespace-nowrap text-slate-800">
                                <span className="font-semibold">
                                  {formatNumber(item.qty)}
                                </span>{' '}
                                <span className="text-xs text-slate-500 font-sans">
                                  {item.unit}
                                </span>
                              </td>
                              <td className="py-2.5 px-2.5 text-left font-mono-num whitespace-nowrap text-slate-700">
                                {formatMoney(item.unitPrice, settings.currency)}
                              </td>
                              {showDiscountCol && (
                                <td className="py-2.5 px-2.5 text-left font-mono-num whitespace-nowrap text-amber-700">
                                  {lineDisc > 0.009
                                    ? formatMoney(lineDisc, settings.currency)
                                    : '—'}
                                </td>
                              )}
                              <td className="py-2.5 px-3 text-left font-mono-num font-bold text-slate-950 whitespace-nowrap">
                                {formatMoney(item.lineTotal, settings.currency)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>

                {/* Totals Ledger + Notes + QR */}
                <section className="invoice-avoid-break grid grid-cols-1 md:grid-cols-12 gap-4 items-stretch pt-1">
                  {/* Right Column: Notes & QR Verification */}
                  <div className="md:col-span-6 flex flex-col justify-between gap-3">
                    {sale.notes ? (
                      <div className="border border-slate-200 bg-slate-50/70 rounded-xl p-3 text-xs text-slate-700 leading-relaxed">
                        <span className="font-bold text-slate-900 block mb-0.5">
                          ملاحظات الفاتورة:
                        </span>
                        {sale.notes}
                      </div>
                    ) : (
                      <div />
                    )}

                    <div className="border border-slate-200 rounded-xl p-3.5 bg-slate-50/40 flex items-center justify-between gap-3">
                      <div className="space-y-1 min-w-0">
                        <div className="text-xs sm:text-sm font-bold text-emerald-900 font-display">
                          {thankYouMessage}
                        </div>
                        {settings.promoText && (
                          <div className="text-xs text-slate-600 leading-relaxed">
                            {settings.promoText}
                          </div>
                        )}
                        {(settings.phone || settings.contactInfo) && (
                          <div className="text-[11px] text-slate-500 pt-0.5">
                            {[settings.phone, settings.contactInfo]
                              .filter(Boolean)
                              .join(' · ')}
                          </div>
                        )}
                      </div>

                      {prefs.showQrCode && qrDataUrl && (
                        <div className="shrink-0 flex flex-col items-center gap-1 border border-slate-200 bg-white rounded-lg p-1.5">
                          <img
                            src={qrDataUrl}
                            alt={`رمز QR للفاتورة ${sale.invoiceNumber}`}
                            className="w-20 h-20"
                          />
                          <span className="text-[9px] font-mono-num text-slate-500">
                            {sale.invoiceNumber}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Left Column: Financial Summary Card */}
                  <div className="md:col-span-6 border border-slate-300 rounded-xl overflow-hidden flex flex-col justify-between bg-white">
                    <div className="p-4 space-y-2.5 text-xs sm:text-sm">
                      <div className="flex items-center justify-between text-slate-600">
                        <span>المجموع قبل الخصم</span>
                        <span className="font-mono-num font-medium text-slate-800">
                          {formatMoney(sale.subtotal, settings.currency)}
                        </span>
                      </div>

                      {prefs.showDiscount && (
                        <div className="flex items-center justify-between text-amber-800">
                          <span>إجمالي الخصومات</span>
                          <span className="font-mono-num font-medium">
                            {effectiveDiscountTotal > 0
                              ? `- ${formatMoney(
                                  effectiveDiscountTotal,
                                  settings.currency
                                )}`
                              : formatMoney(0, settings.currency)}
                          </span>
                        </div>
                      )}

                      <div className="flex items-center justify-between bg-emerald-900 text-white rounded-lg px-3.5 py-2.5 my-1">
                        <span className="font-display font-bold text-sm sm:text-base">
                          المجموع النهائي
                        </span>
                        <span className="font-mono-num font-extrabold text-lg sm:text-xl tracking-tight">
                          {formatMoney(sale.total, settings.currency)}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-emerald-800 pt-0.5">
                        <span className="font-medium">المبلغ المدفوع</span>
                        <span className="font-mono-num font-bold">
                          {formatMoney(sale.paidAmount, settings.currency)}
                        </span>
                      </div>

                      <div
                        className={`flex items-center justify-between ${
                          sale.remainingAmount > 0
                            ? 'text-red-700'
                            : 'text-slate-600'
                        }`}
                      >
                        <span className="font-medium">المبلغ المتبقي (آجل)</span>
                        <span className="font-mono-num font-bold">
                          {formatMoney(sale.remainingAmount, settings.currency)}
                        </span>
                      </div>

                      {showProfit && (
                        <div
                          className={`flex items-center justify-between text-slate-700 border-t border-slate-200 pt-2 text-xs ${
                            printProfit ? '' : 'no-print'
                          }`}
                        >
                          <span>صافي ربح الفاتورة (للمسؤول)</span>
                          <span className="font-mono-num font-semibold">
                            {formatMoney(sale.netProfit, settings.currency)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              </div>
            )}
          </article>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
};
