import React, { useMemo, useRef, useState } from 'react';
import { Camera, ClipboardCheck, ScanBarcode, Search } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  useNavigation,
  useSectionDirtyGuard,
} from '../contexts/NavigationContext';
import { useStoreData } from '../contexts/StoreDataContext';
import { useHardwareBarcodeScanner } from '../hooks/useHardwareBarcodeScanner';
import { recordStockAdjustment } from '../services/accountingService';
import { normalizeBarcode } from '../utils/barcode';
import {
  formatDateTime,
  formatMoney,
  formatNumber,
  movementTypeLabel,
} from '../utils/format';
import { CameraBarcodeModal } from './CameraBarcodeModal';
import { PageHeader } from './UnifiedBackHeader';

export const InventoryView: React.FC = () => {
  const { actorInfo, isAdmin, hasPermission } = useAuth();
  const {
    products,
    stockMovements,
    settings,
    reservedStockByProductId,
    productByCode,
  } = useStoreData();
  const { activeSection, activeSubTab, setSubTab } = useNavigation();

  const canStocktake =
    isAdmin || hasPermission('canStocktake') || hasPermission('canManageProducts');

  const tab: 'levels' | 'stocktake' | 'movements' =
    activeSection === 'inventory' &&
    (activeSubTab === 'levels' ||
      (activeSubTab === 'stocktake' && canStocktake) ||
      activeSubTab === 'movements')
      ? activeSubTab
      : 'levels';
  const setTab = (next: 'levels' | 'stocktake' | 'movements') => setSubTab(next);
  const [searchCode, setSearchCode] = useState('');
  const [cameraOpen, setCameraOpen] = useState(false);

  // Stocktake / adjustment form
  const [stocktakeBarcodeInput, setStocktakeBarcodeInput] = useState('');
  const [selectedProdId, setSelectedProdId] = useState('');
  const [adjustMode, setAdjustMode] = useState<'stocktake' | 'in' | 'out'>('stocktake');
  const [qtyValue, setQtyValue] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null
  );

  const stocktakeScanRef = useRef<HTMLInputElement>(null);

  useSectionDirtyGuard('inventory', {
    isDirty: () =>
      tab === 'stocktake' &&
      (selectedProdId !== '' || qtyValue !== '' || reason.trim() !== ''),
    onDiscard: () => {
      setSelectedProdId('');
      setQtyValue('');
      setReason('');
      setStocktakeBarcodeInput('');
    },
  });

  const productById = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products]
  );

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === selectedProdId) || null,
    [products, selectedProdId]
  );

  const selectProductForStocktakeByCode = (raw: string): { ok: boolean; message: string } => {
    const clean = normalizeBarcode(raw);
    if (!clean) {
      return { ok: false, message: 'يرجى إدخال كود أو باركود صالح.' };
    }
    const found = productByCode.get(clean);
    if (!found) {
      const msg = `لم يتم العثور على صنف بالكود أو الباركود "${clean}".`;
      setFeedback({ type: 'err', text: msg });
      return { ok: false, message: msg };
    }
    setSelectedProdId(found.id);
    if (adjustMode === 'stocktake') {
      setQtyValue(String(found.stock));
    }
    setStocktakeBarcodeInput('');
    const msg = `تم اختيار الصنف "${found.name}" (${found.code}) · الرصيد المسجل: ${found.stock} ${found.unit}`;
    setFeedback({ type: 'ok', text: msg });
    return { ok: true, message: msg };
  };

  // External USB / Bluetooth scanner support across Inventory tabs
  useHardwareBarcodeScanner({
    enabled: activeSection === 'inventory' && !cameraOpen,
    skipElementRef: tab === 'stocktake' ? stocktakeScanRef : undefined,
    onScan: (scanned) => {
      const clean = normalizeBarcode(scanned);
      if (!clean) return;
      if (tab === 'stocktake' && canStocktake) {
        selectProductForStocktakeByCode(clean);
      } else {
        setSearchCode(clean);
      }
    },
  });

  const filteredProducts = useMemo(() => {
    const q = searchCode.trim().toLowerCase();
    const qNorm = normalizeBarcode(searchCode);
    return products.filter((p) => {
      if (!q) return true;
      const pBar = normalizeBarcode(p.barcode);
      const pCode = normalizeBarcode(p.code);
      return (
        p.code.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q) ||
        (p.barcode && p.barcode.toLowerCase().includes(q)) ||
        (qNorm.length > 0 && (pBar.includes(qNorm) || pCode.includes(qNorm)))
      );
    });
  }, [products, searchCode]);

  const filteredMovements = useMemo(() => {
    const q = searchCode.trim().toLowerCase();
    const qNorm = normalizeBarcode(searchCode);
    return stockMovements.filter((m) => {
      if (!q) return true;
      const linkedProd = productById.get(m.productId);
      const barNorm = normalizeBarcode(linkedProd?.barcode);
      return (
        m.productCode.toLowerCase().includes(q) ||
        m.productName.toLowerCase().includes(q) ||
        (m.referenceNumber && m.referenceNumber.toLowerCase().includes(q)) ||
        (linkedProd?.barcode && linkedProd.barcode.toLowerCase().includes(q)) ||
        (qNorm.length > 0 && barNorm.includes(qNorm))
      );
    });
  }, [stockMovements, searchCode, productById]);

  const totalCostVal = useMemo(
    () => products.reduce((a, p) => a + p.stock * p.costPrice, 0),
    [products]
  );
  const totalRetailVal = useMemo(
    () => products.reduce((a, p) => a + p.stock * p.sellPrice, 0),
    [products]
  );

  const handleStockAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actorInfo || !selectedProduct) return;
    setFeedback(null);
    setSaving(true);
    try {
      const result = await recordStockAdjustment(actorInfo, {
        productId: selectedProduct.id,
        productName: selectedProduct.name,
        mode: adjustMode,
        quantityOrActual: Number(qtyValue) || 0,
        expectedStockAtCapture: selectedProduct.stock,
        reason: reason.trim() || 'جرد دوري للمخزون',
      });
      setFeedback({
        type: 'ok',
        text: result.queued
          ? `تم حفظ تعديل مخزون "${selectedProduct.name}" محلياً وسيُزامن فور عودة الاتصال.`
          : `تم تحديث مخزون "${selectedProduct.name}" وتوثيق الحركة في السجل.`,
      });
      setQtyValue('');
      setReason('');
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'تعذر تعديل المخزون.',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      <PageHeader
        title="إدارة المخزون والجرد"
        subtitle="متابعة الكميات · البحث والجرد بالباركود · سجل حركة كل صنف بالكود والباركود"
        actions={
          <div className="ui-segmented">
            <button
              type="button"
              onClick={() => setTab('levels')}
              className={`ui-segmented-btn ${
                tab === 'levels' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              أرصدة المخزون
            </button>
            {canStocktake && (
              <button
                type="button"
                onClick={() => setTab('stocktake')}
                className={`ui-segmented-btn ${
                  tab === 'stocktake'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600'
                }`}
              >
                الجرد والوارد/المنصرف
              </button>
            )}
            <button
              type="button"
              onClick={() => setTab('movements')}
              className={`ui-segmented-btn ${
                tab === 'movements'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600'
              }`}
            >
              تقرير حركة الأصناف ({stockMovements.length})
            </button>
          </div>
        }
      />

      {/* Valuation Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
        <div className="ui-card p-4">
          <div className="text-xs text-slate-500">إجمالي قيمة المخزون (بسعر الشراء)</div>
          <div className="text-xl font-bold font-mono-num text-slate-900 mt-1">
            {formatMoney(totalCostVal, settings.currency)}
          </div>
        </div>
        <div className="ui-card p-4">
          <div className="text-xs text-slate-500">القيمة المتوقعة (بسعر البيع)</div>
          <div className="text-xl font-bold font-mono-num text-emerald-700 mt-1">
            {formatMoney(totalRetailVal, settings.currency)}
          </div>
        </div>
        <div className="ui-card p-4">
          <div className="text-xs text-slate-500">أصناف تحت الحد الأدنى / نافدة</div>
          <div className="text-xl font-bold font-mono-num text-amber-700 mt-1">
            {products.filter((p) => p.stock <= p.minStock).length} صنف
          </div>
        </div>
      </div>

      {tab === 'stocktake' && canStocktake && (
        <form onSubmit={handleStockAdjust} className="ui-card p-4 sm:p-6 space-y-4 max-w-2xl">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <ClipboardCheck className="w-5 h-5 text-emerald-700" />
            <h2 className="text-base font-bold text-slate-900">
              تسجيل جرد فعلي أو حركة وارد / منصرف
            </h2>
          </div>

          {feedback && (
            <div
              className={`p-3 rounded-xl text-xs border ${
                feedback.type === 'ok'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-red-50 border-red-200 text-red-700'
              }`}
            >
              {feedback.text}
            </div>
          )}

          {/* Barcode lookup for stocktake */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2">
            <label className="block text-xs font-semibold text-slate-700">
              مسح باركود الصنف للجرد السريع (بالكاميرا أو قارئ USB/Bluetooth)
            </label>
            <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
              <input
                ref={stocktakeScanRef}
                type="text"
                value={stocktakeBarcodeInput}
                onChange={(e) => setStocktakeBarcodeInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    selectProductForStocktakeByCode(stocktakeBarcodeInput);
                  }
                }}
                placeholder="امسح أو اكتب الباركود / الكود لتحديد الصنف..."
                className="ui-input font-mono-num"
                dir="ltr"
              />
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => selectProductForStocktakeByCode(stocktakeBarcodeInput)}
                  className="flex-1 sm:flex-none px-3.5 py-2.5 min-h-[42px] bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl cursor-pointer whitespace-nowrap shrink-0"
                >
                  تحديد الصنف
                </button>
                <button
                  type="button"
                  onClick={() => setCameraOpen(true)}
                  className="flex-1 sm:flex-none ui-btn-primary text-xs min-h-[42px]"
                >
                  <Camera className="w-4 h-4" />
                  <span>مسح</span>
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                اختر الصنف (بالكود أو الباركود أو الاسم) *
              </label>
              <select
                required
                value={selectedProdId}
                onChange={(e) => {
                  setSelectedProdId(e.target.value);
                  const found = products.find((p) => p.id === e.target.value);
                  if (found && adjustMode === 'stocktake') {
                    setQtyValue(String(found.stock));
                  }
                }}
                className="ui-input"
              >
                <option value="">-- اختر صنفاً --</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    [{p.code}
                    {p.barcode ? ` · ${p.barcode}` : ''}] {p.name} (الكمية المسجلة: {p.stock}{' '}
                    {p.unit})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                نوع العملية
              </label>
              <select
                value={adjustMode}
                onChange={(e) =>
                  setAdjustMode(e.target.value as 'stocktake' | 'in' | 'out')
                }
                className="ui-input"
              >
                <option value="stocktake">جرد فعلي (تحديد الرصيد الفعلي)</option>
                <option value="in">إضافة وارد للمخزون (+)</option>
                <option value="out">صرف / إتلاف من المخزون (-)</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                {adjustMode === 'stocktake' ? 'الكمية الفعلية المعدودة *' : 'الكمية *'}
              </label>
              <input
                required
                type="number"
                min="0"
                step="any"
                value={qtyValue}
                onChange={(e) => setQtyValue(e.target.value)}
                className="ui-input font-mono-num"
              />
            </div>

            {selectedProduct && adjustMode === 'stocktake' && qtyValue !== '' && (
              <div className="sm:col-span-2 p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs flex items-center justify-between">
                <span>
                  الرصيد المسجل: <strong className="font-mono-num">{selectedProduct.stock}</strong>
                </span>
                <span>
                  الفرق (العجز / الزيادة):{' '}
                  <strong
                    className={`font-mono-num ${
                      Number(qtyValue) - selectedProduct.stock < 0
                        ? 'text-red-700'
                        : Number(qtyValue) - selectedProduct.stock > 0
                        ? 'text-emerald-700'
                        : 'text-slate-900'
                    }`}
                  >
                    {Number(qtyValue) - selectedProduct.stock > 0 ? '+' : ''}
                    {formatNumber(Number(qtyValue) - selectedProduct.stock)}
                  </strong>
                </span>
              </div>
            )}

            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                السبب / الملاحظة *
              </label>
              <input
                required
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="مثال: جرد شهري / بضاعة تالفة / تسوية عجز"
                className="ui-input"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="ui-btn-primary w-full sm:w-auto"
          >
            {saving ? 'جاري التحديث...' : 'اعتماد وحفظ حركة المخزون'}
          </button>
        </form>
      )}

      {tab !== 'stocktake' && (
        <div className="ui-card p-3.5 sm:p-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2 max-w-xl">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchCode}
                onChange={(e) => setSearchCode(e.target.value)}
                placeholder="بحث بالباركود أو كود الصنف أو اسمه..."
                className="ui-input pr-10"
              />
            </div>
            <button
              type="button"
              onClick={() => setCameraOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 min-h-[42px] text-xs font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-xl shrink-0 cursor-pointer whitespace-nowrap"
            >
              <Camera className="w-4 h-4" />
              <span>مسح باركود</span>
            </button>
          </div>

          {tab === 'levels' ? (
            <>
              {/* Mobile Cards */}
              <div className="md:hidden divide-y divide-slate-100 border border-slate-200/80 rounded-xl overflow-hidden">
                {filteredProducts.map((p) => {
                  const reserved = reservedStockByProductId.get(p.id) || 0;
                  return (
                    <div key={p.id} className="p-3.5 space-y-1.5 bg-white">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-bold text-slate-900 text-sm truncate">
                            {p.name}
                          </div>
                          <div className="text-xs font-mono-num text-slate-500">
                            {p.code}
                            {p.barcode ? ` · ${p.barcode}` : ''}
                          </div>
                        </div>
                        <span
                          className={`text-xs font-semibold shrink-0 ${
                            p.stock === 0
                              ? 'text-red-700'
                              : p.stock <= p.minStock
                              ? 'text-amber-700'
                              : 'text-emerald-700'
                          }`}
                        >
                          {p.stock === 0 ? 'نفد' : p.stock <= p.minStock ? 'منخفض' : 'جيد'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-2 text-xs pt-1">
                        <span className="font-mono-num font-bold text-slate-900">
                          المتوفر: {formatNumber(p.stock)} {p.unit}
                          {reserved > 0 ? ` (محجوز: ${formatNumber(reserved)})` : ''}
                        </span>
                        <span className="font-mono-num text-slate-600">
                          {formatMoney(p.stock * p.costPrice, settings.currency)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Desktop Table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50/90 border-b border-slate-200 text-xs text-slate-600">
                    <tr>
                      <th className="text-right py-2.5 px-4 font-semibold">الكود / الباركود</th>
                      <th className="text-right py-2.5 px-4 font-semibold">الصنف</th>
                      <th className="text-center py-2.5 px-4 font-semibold">المتوفر</th>
                      <th className="text-center py-2.5 px-4 font-semibold">الحد الأدنى</th>
                      <th className="text-left py-2.5 px-4 font-semibold">قيمة المخزون (تكلفة)</th>
                      <th className="text-right py-2.5 px-4 font-semibold">التنبيه</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredProducts.map((p) => {
                      const reserved = reservedStockByProductId.get(p.id) || 0;
                      return (
                        <tr key={p.id} className="hover:bg-slate-50/70">
                          <td className="py-2.5 px-4 font-mono-num text-slate-700">
                            <div className="font-semibold text-slate-900">{p.code}</div>
                            {p.barcode && (
                              <div
                                className="inline-flex items-center gap-1 text-[11px] text-emerald-700 mt-0.5"
                                dir="ltr"
                              >
                                <ScanBarcode className="w-3 h-3 shrink-0" />
                                <span>{p.barcode}</span>
                              </div>
                            )}
                          </td>
                          <td className="py-2.5 px-4 font-medium text-slate-900">{p.name}</td>
                          <td className="py-2.5 px-4 text-center font-mono-num font-bold">
                            {formatNumber(p.stock)} {p.unit}
                            {reserved > 0 && (
                              <div className="text-[11px] font-normal text-amber-700">
                                محجوز محلياً: {formatNumber(reserved)}
                              </div>
                            )}
                          </td>
                          <td className="py-2.5 px-4 text-center font-mono-num text-slate-500">
                            {formatNumber(p.minStock)}
                          </td>
                          <td className="py-2.5 px-4 text-left font-mono-num">
                            {formatMoney(p.stock * p.costPrice, settings.currency)}
                          </td>
                          <td className="py-2.5 px-4 text-xs">
                            {p.stock === 0 ? (
                              <span className="text-red-700 font-semibold">نفد</span>
                            ) : p.stock <= p.minStock ? (
                              <span className="text-amber-700 font-semibold">منخفض</span>
                            ) : (
                              <span className="text-emerald-700 font-medium">جيد</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <>
              {/* Mobile Movement Cards */}
              <div className="md:hidden divide-y divide-slate-100 border border-slate-200/80 rounded-xl overflow-hidden">
                {filteredMovements.map((m) => (
                  <div key={m.id} className="p-3.5 space-y-1.5 bg-white text-xs">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-bold text-slate-900 truncate">{m.productName}</div>
                        <div className="text-slate-500">
                          {movementTypeLabel(m.type)} · {m.productCode}
                        </div>
                      </div>
                      <span
                        className={`font-mono-num font-bold text-sm shrink-0 ${
                          m.qtyChange > 0
                            ? 'text-emerald-700'
                            : m.qtyChange < 0
                            ? 'text-red-700'
                            : 'text-slate-600'
                        }`}
                      >
                        {m.qtyChange > 0 ? `+${m.qtyChange}` : m.qtyChange}
                      </span>
                    </div>
                    <div className="text-slate-600">{m.reason}</div>
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <span>
                        {m.previousStock} ← {m.newStock} · {m.employeeName}
                      </span>
                      <span className="font-mono-num">{formatDateTime(m.createdAt)}</span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop Movements Table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50/90 border-b border-slate-200 text-xs text-slate-600">
                    <tr>
                      <th className="text-right py-2.5 px-3 font-semibold">التاريخ</th>
                      <th className="text-right py-2.5 px-3 font-semibold">الكود / الصنف</th>
                      <th className="text-right py-2.5 px-3 font-semibold">نوع الحركة</th>
                      <th className="text-center py-2.5 px-3 font-semibold">التغير</th>
                      <th className="text-center py-2.5 px-3 font-semibold">قبل ← بعد</th>
                      <th className="text-right py-2.5 px-3 font-semibold">السبب / المرجع</th>
                      <th className="text-right py-2.5 px-3 font-semibold">الموظف</th>
                      <th className="text-right py-2.5 px-3 font-semibold">الجهاز</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredMovements.map((m) => {
                      const prod = productById.get(m.productId);
                      return (
                        <tr key={m.id} className="hover:bg-slate-50/70">
                          <td className="py-2.5 px-3 text-xs text-slate-500">
                            {formatDateTime(m.createdAt)}
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="font-medium text-slate-900">{m.productName}</div>
                            <div className="text-xs font-mono-num text-slate-500">
                              {m.productCode}
                              {prod?.barcode ? ` · ${prod.barcode}` : ''}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-xs font-medium text-slate-700">
                            {movementTypeLabel(m.type)}
                          </td>
                          <td
                            className={`py-2.5 px-3 text-center font-mono-num font-bold ${
                              m.qtyChange > 0
                                ? 'text-emerald-700'
                                : m.qtyChange < 0
                                ? 'text-red-700'
                                : 'text-slate-600'
                            }`}
                          >
                            {m.qtyChange > 0 ? `+${m.qtyChange}` : m.qtyChange}
                          </td>
                          <td className="py-2.5 px-3 text-center font-mono-num text-xs text-slate-600">
                            {m.previousStock} ← {m.newStock}
                          </td>
                          <td className="py-2.5 px-3 text-xs text-slate-600">{m.reason}</td>
                          <td className="py-2.5 px-3 text-xs text-slate-700">
                            {m.employeeName}
                          </td>
                          <td className="py-2.5 px-3 text-xs text-slate-500">
                            {m.deviceName || '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      <CameraBarcodeModal
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        title={
          tab === 'stocktake'
            ? 'مسح باركود الصنف للجرد'
            : 'البحث في المخزون بالباركود'
        }
        onDetected={(rawCode) => {
          const clean = normalizeBarcode(rawCode);
          if (!clean) {
            return { ok: false, message: 'رمز الباركود غير صالح.' };
          }
          if (tab === 'stocktake' && canStocktake) {
            return selectProductForStocktakeByCode(clean);
          }
          setSearchCode(clean);
          const found = productByCode.get(clean);
          if (found) {
            return { ok: true, message: `تم العثور على: ${found.name} (${found.code})` };
          }
          return {
            ok: false,
            message: `لم يتم العثور على صنف بالباركود "${clean}"`,
          };
        }}
      />
    </div>
  );
};
