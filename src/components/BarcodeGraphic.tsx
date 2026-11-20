import React, { useMemo, useState } from 'react';
import { Check, Copy, Download, Printer } from 'lucide-react';
import {
  bitsToBarRuns,
  buildBarcodePrintHtml,
  encodeBarcode,
  renderBarcodeLabelPngDataUrl,
  saveImageDataUrlCrossPlatform,
  type BarcodeLabelPaperSize,
} from '../utils/barcode';
import { formatMoney } from '../utils/format';
import { printHtmlDocument } from '../utils/print';

interface BarcodeGraphicProps {
  value: string;
  height?: number;
  showText?: boolean;
  className?: string;
}

export const BarcodeGraphic: React.FC<BarcodeGraphicProps> = ({
  value,
  height = 56,
  showText = true,
  className = '',
}) => {
  const encoded = useMemo(() => encodeBarcode(value), [value]);
  const runs = useMemo(() => bitsToBarRuns(encoded.bits), [encoded.bits]);
  const quiet = 10;
  const totalWidth = encoded.bits.length + quiet * 2;
  const svgHeight = showText ? height + 18 : height;

  return (
    <svg
      viewBox={`0 0 ${totalWidth} ${svgHeight}`}
      className={`w-full h-auto block select-none ${className}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={`باركود ${encoded.value}`}
    >
      <rect x={0} y={0} width={totalWidth} height={svgHeight} fill="#ffffff" />
      {runs.map((run, idx) => (
        <rect
          key={idx}
          x={run.x + quiet}
          y={4}
          width={run.width}
          height={height - 6}
          fill="#0f172a"
        />
      ))}
      {showText && (
        <text
          x={totalWidth / 2}
          y={svgHeight - 3}
          textAnchor="middle"
          fontFamily="IBM Plex Mono, monospace"
          fontSize="11"
          fontWeight="700"
          fill="#0f172a"
        >
          {encoded.value}
        </text>
      )}
    </svg>
  );
};

interface ProductBarcodeCardProps {
  barcodeValue: string;
  productName: string;
  productCode: string;
  sellPrice: number;
  currency: string;
  storeName: string;
  compact?: boolean;
}

export const ProductBarcodeCard: React.FC<ProductBarcodeCardProps> = ({
  barcodeValue,
  productName,
  productCode,
  sellPrice,
  currency,
  storeName,
  compact = false,
}) => {
  const [copies, setCopies] = useState(1);
  const [paperSize, setPaperSize] = useState<BarcodeLabelPaperSize>('50x30mm');
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const encoded = useMemo(() => encodeBarcode(barcodeValue), [barcodeValue]);

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(encoded.value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore clipboard errors
    }
  };

  const handleSavePng = () => {
    try {
      const dataUrl = renderBarcodeLabelPngDataUrl({
        barcodeValue: encoded.value,
        productName,
        productCode,
        sellPrice,
        currency,
        storeName,
      });
      const safeFile = `barcode_${productCode}_${encoded.value}.png`.replace(
        /[^a-zA-Z0-9_.-]/g,
        '_'
      );
      const ok = saveImageDataUrlCrossPlatform(dataUrl, safeFile);
      if (ok) {
        setNotice('تم حفظ صورة الباركود بنجاح.');
        window.setTimeout(() => setNotice(null), 2500);
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'تعذر تصدير صورة الباركود.');
    }
  };

  const handlePrintBarcode = () => {
    const html = buildBarcodePrintHtml({
      barcodeValue: encoded.value,
      productName,
      productCode,
      sellPrice,
      currency,
      storeName,
      copies,
      paperSize,
    });
    printHtmlDocument(html, `باركود - ${productName}`);
  };

  return (
    <div className="border border-slate-200 rounded-2xl bg-slate-50/70 p-4 space-y-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs font-bold text-slate-900">
            الباركود المخصص للصنف ({encoded.format})
          </div>
          <div className="text-[11px] font-mono-num text-slate-500 mt-0.5" dir="ltr">
            {encoded.value}
          </div>
        </div>
        <button
          type="button"
          onClick={handleCopyCode}
          className="ui-btn-secondary px-3 min-h-[36px] text-xs"
        >
          {copied ? (
            <Check className="w-3.5 h-3.5 text-emerald-700" />
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
          <span>{copied ? 'تم النسخ' : 'نسخ الرقم'}</span>
        </button>
      </div>

      {/* Printable Label Visual Preview */}
      <div className="bg-white border border-slate-300 rounded-xl p-3 max-w-xs mx-auto text-center space-y-1.5">
        <div className="flex items-center justify-between gap-2 text-[11px] border-b border-dashed border-slate-200 pb-1">
          <span className="font-semibold text-slate-700 truncate">{storeName}</span>
          <span className="font-mono-num font-bold text-emerald-700 whitespace-nowrap">
            {formatMoney(sellPrice, currency)}
          </span>
        </div>
        <div className="text-xs font-bold text-slate-900 truncate">{productName}</div>
        <div className="max-w-[230px] mx-auto">
          <BarcodeGraphic value={encoded.value} height={compact ? 46 : 56} showText />
        </div>
        <div className="text-[10px] font-mono-num text-slate-500">{productCode}</div>
      </div>

      {/* Print Options + Action Buttons */}
      {!compact && (
        <div className="flex flex-wrap items-end justify-between gap-2.5 pt-2.5 border-t border-slate-200">
          <div className="flex flex-wrap items-center gap-2">
            <div>
              <label className="block text-[11px] text-slate-500 mb-1">
                مقاس ملصق الطباعة
              </label>
              <select
                value={paperSize}
                onChange={(e) => setPaperSize(e.target.value as BarcodeLabelPaperSize)}
                className="px-3 min-h-[38px] text-xs border border-slate-200 rounded-xl bg-white"
              >
                <option value="50x30mm">ملصق باركود 50×30mm</option>
                <option value="58mm">رول حراري 58mm</option>
                <option value="80mm">رول حراري 80mm</option>
                <option value="a4">ورق A4 (شبكة ملصقات)</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-slate-500 mb-1">
                عدد النسخ
              </label>
              <input
                type="number"
                min={1}
                max={120}
                value={copies}
                onChange={(e) =>
                  setCopies(Math.min(120, Math.max(1, Number(e.target.value) || 1)))
                }
                className="w-18 px-2.5 min-h-[38px] text-xs font-mono-num text-center border border-slate-200 rounded-xl bg-white"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={handleSavePng}
              className="ui-btn-secondary px-3 min-h-[40px] text-xs"
            >
              <Download className="w-3.5 h-3.5" />
              <span>حفظ كصورة</span>
            </button>
            <button
              type="button"
              onClick={handlePrintBarcode}
              className="ui-btn-primary px-4 min-h-[40px] text-xs"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>طباعة الباركود</span>
            </button>
          </div>
        </div>
      )}

      {notice && (
        <div className="text-[11px] font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
          {notice}
        </div>
      )}
    </div>
  );
};
