import React, { useMemo, useRef, useState } from 'react';
import {
  Banknote,
  Camera,
  CheckCircle2,
  Eye,
  FileText,
  Phone,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  useBackLayer,
  useNavigation,
  useSectionDirtyGuard,
} from '../contexts/NavigationContext';
import { useStoreData } from '../contexts/StoreDataContext';
import { useHardwareBarcodeScanner } from '../hooks/useHardwareBarcodeScanner';
import {
  createSupplier,
  executePurchase,
  recordVoucher,
} from '../services/accountingService';
import type { PaymentMethod, Product, PurchaseInvoice, Supplier } from '../types';
import { normalizeBarcode } from '../utils/barcode';
import {
  formatDateTime,
  formatMoney,
  paymentMethodLabel,
  roundMoney,
} from '../utils/format';
import { CameraBarcodeModal } from './CameraBarcodeModal';
import { ModalSubPageHeader, PageHeader } from './UnifiedBackHeader';

interface PurchaseLine {
  product: Product;
  qty: number;
  costPrice: number;
  updateProductCost: boolean;
}

export const SuppliersPurchasesView: React.FC = () => {
  const { actorInfo } = useAuth();
  const { suppliers, purchases, products, vouchers, settings, productByCode, isOnline } =
    useStoreData();
  const { activeSection, activeSubTab, setSubTab } = useNavigation();

  const tab: 'new_purchase' | 'history' | 'suppliers' =
    activeSection === 'suppliers' &&
    (activeSubTab === 'new_purchase' ||
      activeSubTab === 'history' ||
      activeSubTab === 'suppliers')
      ? activeSubTab
      : 'new_purchase';
  const setTab = (next: 'new_purchase' | 'history' | 'suppliers') => setSubTab(next);

  // New purchase form
  const [supplierId, setSupplierId] = useState('');
  const [codeSearch, setCodeSearch] = useState('');
  const [items, setItems] = useState<PurchaseLine[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [paidAmountInput, setPaidAmountInput] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null
  );

  // Add supplier modal
  const [showAddSupp, setShowAddSupp] = useState(false);
  const [suppName, setSuppName] = useState('');
  const [suppPhone, setSuppPhone] = useState('');
  const [suppAddress, setSuppAddress] = useState('');
  const [savingSupp, setSavingSupp] = useState(false);

  // Pay supplier modal
  const [paySupp, setPaySupp] = useState<Supplier | null>(null);
  const [payAmt, setPayAmt] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [paying, setPaying] = useState(false);
  const initialPayAmtRef = useRef('');
  const codeSearchInputRef = useRef<HTMLInputElement>(null);

  // Supplier statement & purchase detail modals
  const [stmtSupp, setStmtSupp] = useState<Supplier | null>(null);
  const [selectedPurchase, setSelectedPurchase] = useState<PurchaseInvoice | null>(null);

  const liveStmtSupp = useMemo(
    () =>
      stmtSupp
        ? suppliers.find((s) => s.id === stmtSupp.id) || stmtSupp
        : null,
    [stmtSupp, suppliers]
  );

  useSectionDirtyGuard('suppliers', {
    isDirty: () =>
      tab === 'new_purchase' &&
      (items.length > 0 ||
        supplierId !== '' ||
        notes.trim() !== '' ||
        paidAmountInput !== ''),
    dirtyMessage:
      items.length > 0
        ? 'توجد فاتورة شراء غير محفوظة، هل تريد الخروج دون حفظ؟'
        : undefined,
    onDiscard: () => {
      setItems([]);
      setSupplierId('');
      setPaidAmountInput('');
      setNotes('');
      setCodeSearch('');
    },
  });

  const requestCloseAddSupp = useBackLayer({
    id: 'supplier-add',
    active: showAddSupp,
    onClose: () => setShowAddSupp(false),
    isDirty: () =>
      suppName.trim() !== '' || suppPhone.trim() !== '' || suppAddress.trim() !== '',
    onDiscard: () => {
      setSuppName('');
      setSuppPhone('');
      setSuppAddress('');
    },
  });

  const requestClosePaySupp = useBackLayer({
    id: 'supplier-payment',
    active: Boolean(paySupp),
    onClose: () => setPaySupp(null),
    isDirty: () => payAmt !== initialPayAmtRef.current || payNotes.trim() !== '',
    onDiscard: () => {
      setPayAmt('');
      setPayNotes('');
    },
  });

  const requestCloseStmtSupp = useBackLayer({
    id: 'supplier-statement',
    active: Boolean(liveStmtSupp),
    onClose: () => setStmtSupp(null),
  });

  const requestClosePurchaseDetail = useBackLayer({
    id: 'purchase-detail',
    active: Boolean(selectedPurchase),
    onClose: () => setSelectedPurchase(null),
  });

  const selectedSupplier = useMemo(
    () => suppliers.find((s) => s.id === supplierId) || null,
    [suppliers, supplierId]
  );

  const totalPurchase = useMemo(
    () => roundMoney(items.reduce((a, l) => a + l.qty * l.costPrice, 0)),
    [items]
  );

  const paidAmount =
    paymentMethod === 'cash'
      ? totalPurchase
      : paymentMethod === 'credit'
      ? 0
      : roundMoney(Math.min(Math.max(0, Number(paidAmountInput) || 0), totalPurchase));

  const addProductLine = (prod: Product) => {
    setItems((prev) => {
      if (prev.some((x) => x.product.id === prod.id)) {
        return prev.map((x) =>
          x.product.id === prod.id ? { ...x, qty: x.qty + 1 } : x
        );
      }
      return [
        ...prev,
        { product: prod, qty: 1, costPrice: prod.costPrice, updateProductCost: true },
      ];
    });
  };

  useHardwareBarcodeScanner({
    enabled:
      activeSection === 'suppliers' &&
      tab === 'new_purchase' &&
      !cameraOpen &&
      !showAddSupp &&
      !paySupp &&
      !liveStmtSupp &&
      !selectedPurchase,
    skipElementRef: codeSearchInputRef,
    onScan: (scanned) => {
      const clean = normalizeBarcode(scanned);
      if (!clean) return;
      const found = productByCode.get(clean);
      if (!found) {
        setFeedback({
          type: 'err',
          text: `لم يتم العثور على صنف بالباركود أو الكود "${clean}".`,
        });
        return;
      }
      addProductLine(found);
      setFeedback({
        type: 'ok',
        text: `تمت إضافة "${found.name}" (${found.code}) إلى فاتورة الشراء.`,
      });
    },
  });

  const handleCodeAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const rawTrim = codeSearch.trim();
    const clean = normalizeBarcode(rawTrim);
    if (!rawTrim) return;
    const found =
      (clean ? productByCode.get(clean) : undefined) ||
      products.find((p) => p.name.toLowerCase().includes(rawTrim.toLowerCase()));
    if (!found) {
      setFeedback({
        type: 'err',
        text: `لم يتم العثور على صنف مطابق لـ "${clean || rawTrim}".`,
      });
      return;
    }
    addProductLine(found);
    setCodeSearch('');
    setFeedback(null);
  };

  const handleSubmitPurchase = async () => {
    if (!actorInfo || !selectedSupplier) {
      setFeedback({ type: 'err', text: 'يرجى اختيار المورد أولاً.' });
      return;
    }
    if (items.length === 0) {
      setFeedback({ type: 'err', text: 'يرجى إضافة صنف واحد على الأقل.' });
      return;
    }
    setSubmitting(true);
    setFeedback(null);
    try {
      const result = await executePurchase(actorInfo, {
        supplier: selectedSupplier,
        items: items.map((l) => ({
          productId: l.product.id,
          qty: l.qty,
          costPrice: l.costPrice,
          updateProductCost: l.updateProductCost,
        })),
        paymentMethod,
        paidAmount,
        notes,
      });
      setItems([]);
      setPaidAmountInput('');
      setNotes('');
      setFeedback({
        type: 'ok',
        text: result.queued
          ? 'تم حفظ فاتورة الشراء محلياً وستُزامن تلقائياً فور عودة الاتصال.'
          : 'تم اعتماد فاتورة الشراء وزيادة المخزون وتحديث حساب المورد بنجاح.',
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'تعذر تسجيل فاتورة الشراء.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actorInfo) return;
    setSavingSupp(true);
    try {
      const createdName = suppName;
      const id = await createSupplier(actorInfo, {
        name: suppName,
        phone: suppPhone,
        address: suppAddress,
      });
      setSupplierId(id);
      setShowAddSupp(false);
      setSuppName('');
      setSuppPhone('');
      setSuppAddress('');
      setFeedback({
        type: 'ok',
        text: !isOnline
          ? `تم حفظ المورد "${createdName}" محلياً وسيُزامن فور عودة الاتصال.`
          : `تم تسجيل المورد "${createdName}" بنجاح.`,
      });
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'تعذر إضافة المورد.',
      });
    } finally {
      setSavingSupp(false);
    }
  };

  const handlePaySupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actorInfo || !paySupp) return;
    setPaying(true);
    setFeedback(null);
    try {
      const result = await recordVoucher(actorInfo, {
        type: 'payment',
        partyType: 'supplier',
        partyId: paySupp.id,
        partyName: paySupp.name,
        amount: Number(payAmt) || 0,
        notes: payNotes.trim() || 'سداد مستحقات مورد',
      });
      setFeedback({
        type: 'ok',
        text: result.queued
          ? `تم حفظ سند الصرف (${result.voucherNumber}) محلياً وسيُزامن فور عودة الاتصال.`
          : `تم تسجيل سند الصرف ${result.voucherNumber} وتحديث حساب المورد.`,
      });
      setPaySupp(null);
      setPayAmt('');
      setPayNotes('');
    } catch (err) {
      setFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : 'تعذر تسجيل سند الصرف.',
      });
    } finally {
      setPaying(false);
    }
  };

  const openPaySupplierModal = (s: Supplier) => {
    const initAmt = s.balanceDue > 0 ? String(s.balanceDue) : '';
    initialPayAmtRef.current = initAmt;
    setPaySupp(s);
    setPayAmt(initAmt);
    setPayNotes('');
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="المشتريات والموردون"
        subtitle="فواتير شراء البضائع · زيادة المخزون تلقائياً · مستحقات الموردين وسندات الصرف"
        actions={
          <div className="ui-segmented">
            <button
              type="button"
              onClick={() => setTab('new_purchase')}
              className={`ui-segmented-btn ${tab === 'new_purchase' ? 'is-active' : ''}`}
            >
              فاتورة شراء جديدة
            </button>
            <button
              type="button"
              onClick={() => setTab('history')}
              className={`ui-segmented-btn ${tab === 'history' ? 'is-active' : ''}`}
            >
              سجل المشتريات ({purchases.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('suppliers')}
              className={`ui-segmented-btn ${tab === 'suppliers' ? 'is-active' : ''}`}
            >
              دليل الموردين ({suppliers.length})
            </button>
          </div>
        }
      />

      {feedback && (
        <div
          className={`p-3.5 rounded-xl text-xs font-medium border ${
            feedback.type === 'ok'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-red-50 border-red-200 text-red-700'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {tab === 'new_purchase' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          <div className="lg:col-span-8 ui-card p-4 sm:p-5 space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[220px]">
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  المورد *
                </label>
                <select
                  value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}
                  className="ui-input bg-white"
                >
                  <option value="">-- اختر المورد --</option>
                  {suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.supplierCode})
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="button"
                onClick={() => setShowAddSupp(true)}
                className="inline-flex items-center justify-center gap-1.5 px-3.5 min-h-[42px] text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-xl cursor-pointer whitespace-nowrap shrink-0"
              >
                <Plus className="w-4 h-4" />
                <span>مورد جديد</span>
              </button>
            </div>

            <form onSubmit={handleCodeAdd} className="flex flex-wrap sm:flex-nowrap gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  ref={codeSearchInputRef}
                  type="text"
                  value={codeSearch}
                  onChange={(e) => setCodeSearch(e.target.value)}
                  placeholder="امسح الباركود أو أدخل كود الصنف أو اسمه..."
                  className="ui-input pr-10"
                />
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <button
                  type="submit"
                  className="flex-1 sm:flex-none px-4 min-h-[42px] bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl cursor-pointer whitespace-nowrap"
                >
                  إضافة
                </button>
                <button
                  type="button"
                  onClick={() => setCameraOpen(true)}
                  className="flex-1 sm:flex-none ui-btn-primary px-3.5 text-xs"
                >
                  <Camera className="w-4 h-4" />
                  <span>مسح بالكاميرا</span>
                </button>
              </div>
            </form>

            {/* Quick pick list */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              {products.slice(0, 12).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => addProductLine(p)}
                  className="px-3 min-h-[34px] text-xs font-medium bg-slate-100 hover:bg-emerald-50 hover:text-emerald-800 text-slate-700 border border-transparent hover:border-emerald-200 rounded-xl whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                >
                  + {p.name} ({p.code})
                </button>
              ))}
            </div>

            {items.length === 0 ? (
              <div className="py-12 text-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-xl bg-slate-50/50">
                لم يتم إضافة أصناف لفاتورة الشراء بعد.
              </div>
            ) : (
              <>
                {/* Mobile Line Cards */}
                <div className="md:hidden divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
                  {items.map((line) => (
                    <div key={line.product.id} className="p-3.5 space-y-2.5 bg-white">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-semibold text-sm text-slate-900 truncate">
                            {line.product.name}
                          </div>
                          <div className="text-xs font-mono-num text-slate-500">
                            {line.product.code}
                            {line.product.barcode ? ` · ${line.product.barcode}` : ''}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setItems((prev) =>
                              prev.filter((x) => x.product.id !== line.product.id)
                            )
                          }
                          className="p-2 text-slate-400 hover:text-red-600 rounded-lg cursor-pointer"
                          aria-label="حذف الصنف"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-2.5">
                        <div>
                          <label className="block text-[11px] font-medium text-slate-500 mb-1">
                            الكمية
                          </label>
                          <input
                            type="number"
                            min="1"
                            step="any"
                            value={line.qty}
                            onChange={(e) => {
                              const q = Math.max(0, Number(e.target.value) || 0);
                              setItems((prev) =>
                                prev.map((x) =>
                                  x.product.id === line.product.id ? { ...x, qty: q } : x
                                )
                              );
                            }}
                            className="ui-input text-center font-mono-num"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-medium text-slate-500 mb-1">
                            سعر الشراء
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={line.costPrice}
                            onChange={(e) => {
                              const c = Math.max(0, Number(e.target.value) || 0);
                              setItems((prev) =>
                                prev.map((x) =>
                                  x.product.id === line.product.id
                                    ? { ...x, costPrice: c }
                                    : x
                                )
                              );
                            }}
                            className="ui-input text-center font-mono-num"
                          />
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-1 text-xs">
                        <label className="inline-flex items-center gap-2 text-slate-600 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={line.updateProductCost}
                            onChange={(e) =>
                              setItems((prev) =>
                                prev.map((x) =>
                                  x.product.id === line.product.id
                                    ? { ...x, updateProductCost: e.target.checked }
                                    : x
                                )
                              )
                            }
                            className="w-4 h-4 accent-emerald-700"
                          />
                          <span>تحديث تكلفة الصنف</span>
                        </label>
                        <span className="font-mono-num font-bold text-slate-900">
                          {formatMoney(line.qty * line.costPrice, settings.currency)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Desktop Table */}
                <div className="hidden md:block overflow-x-auto border border-slate-200 rounded-xl">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                      <tr>
                        <th className="text-right py-2.5 px-3">الكود / الصنف</th>
                        <th className="text-center py-2.5 px-3">الكمية</th>
                        <th className="text-center py-2.5 px-3">سعر الشراء</th>
                        <th className="text-center py-2.5 px-3">تحديث تكلفة الصنف</th>
                        <th className="text-left py-2.5 px-3">الإجمالي</th>
                        <th className="py-2.5 px-2"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {items.map((line) => (
                        <tr key={line.product.id}>
                          <td className="py-2.5 px-3">
                            <div className="font-medium text-slate-900">{line.product.name}</div>
                            <div className="text-xs font-mono-num text-slate-500">
                              {line.product.code}
                              {line.product.barcode ? ` · ${line.product.barcode}` : ''}
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <input
                              type="number"
                              min="1"
                              step="any"
                              value={line.qty}
                              onChange={(e) => {
                                const q = Math.max(0, Number(e.target.value) || 0);
                                setItems((prev) =>
                                  prev.map((x) =>
                                    x.product.id === line.product.id ? { ...x, qty: q } : x
                                  )
                                );
                              }}
                              className="w-20 px-2 py-1.5 text-center font-mono-num border border-slate-200 rounded-lg"
                            />
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={line.costPrice}
                              onChange={(e) => {
                                const c = Math.max(0, Number(e.target.value) || 0);
                                setItems((prev) =>
                                  prev.map((x) =>
                                    x.product.id === line.product.id
                                      ? { ...x, costPrice: c }
                                      : x
                                  )
                                );
                              }}
                              className="w-24 px-2 py-1.5 text-center font-mono-num border border-slate-200 rounded-lg"
                            />
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <input
                              type="checkbox"
                              checked={line.updateProductCost}
                              onChange={(e) =>
                                setItems((prev) =>
                                  prev.map((x) =>
                                    x.product.id === line.product.id
                                      ? { ...x, updateProductCost: e.target.checked }
                                      : x
                                  )
                                )
                              }
                              className="w-4 h-4 accent-emerald-700"
                            />
                          </td>
                          <td className="py-2.5 px-3 text-left font-mono-num font-bold">
                            {formatMoney(line.qty * line.costPrice, settings.currency)}
                          </td>
                          <td className="py-2.5 px-2 text-center">
                            <button
                              type="button"
                              onClick={() =>
                                setItems((prev) =>
                                  prev.filter((x) => x.product.id !== line.product.id)
                                )
                              }
                              className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>

          <div className="lg:col-span-4 ui-card p-5 space-y-4 lg:sticky lg:top-20">
            <h2 className="text-base font-bold text-slate-900 border-b border-slate-100 pb-3">
              ملخص فاتورة الشراء
            </h2>
            <div className="ui-segmented grid grid-cols-3 w-full">
              {(
                [
                  ['cash', 'نقدي'],
                  ['partial', 'دفع جزئي'],
                  ['credit', 'آجل'],
                ] as const
              ).map(([m, lbl]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setPaymentMethod(m)}
                  className={`ui-segmented-btn ${paymentMethod === m ? 'is-active' : ''}`}
                >
                  {lbl}
                </button>
              ))}
            </div>

            {paymentMethod === 'partial' && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  المبلغ المدفوع للمورد
                </label>
                <input
                  type="number"
                  min="0"
                  max={totalPurchase}
                  step="0.01"
                  value={paidAmountInput}
                  onChange={(e) => setPaidAmountInput(e.target.value)}
                  className="ui-input font-mono-num"
                />
              </div>
            )}

            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="رقم مرجعي أو ملاحظات..."
              className="ui-input text-xs"
            />

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2 text-sm">
              <div className="flex justify-between font-bold text-slate-900">
                <span>إجمالي الفاتورة</span>
                <span className="font-mono-num">
                  {formatMoney(totalPurchase, settings.currency)}
                </span>
              </div>
              <div className="flex justify-between text-xs text-emerald-700">
                <span>المدفوع من الصندوق</span>
                <span className="font-mono-num">
                  {formatMoney(paidAmount, settings.currency)}
                </span>
              </div>
              <div className="flex justify-between text-xs text-red-700">
                <span>المتبقي للمورد</span>
                <span className="font-mono-num">
                  {formatMoney(Math.max(0, totalPurchase - paidAmount), settings.currency)}
                </span>
              </div>
            </div>

            <button
              type="button"
              disabled={submitting}
              onClick={handleSubmitPurchase}
              className="ui-btn-primary w-full min-h-[48px] text-sm font-bold"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>
                {submitting ? 'جاري الاعتماد...' : 'اعتماد الفاتورة وإضافة للمخزون'}
              </span>
            </button>
          </div>
        </div>
      )}

      {tab === 'history' && (
        <div className="ui-card overflow-hidden">
          {purchases.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">
              لا توجد فواتير شراء مسجلة بعد.
            </div>
          ) : (
            <>
              {/* Mobile Purchase Cards */}
              <div className="md:hidden divide-y divide-slate-100">
                {purchases.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedPurchase(p)}
                    className="w-full text-right p-4 space-y-2 hover:bg-slate-50 cursor-pointer"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-mono-num font-bold text-sm text-emerald-700">
                          {p.purchaseNumber}
                        </div>
                        <div className="font-semibold text-slate-900 text-sm truncate">
                          {p.supplierName}
                        </div>
                      </div>
                      <div className="text-left shrink-0">
                        <div className="font-mono-num font-bold text-sm text-slate-900">
                          {formatMoney(p.total, settings.currency)}
                        </div>
                        <div className="text-[11px] text-slate-500">
                          {paymentMethodLabel(p.paymentMethod)}
                        </div>
                      </div>
                    </div>
                    <div className="text-xs text-slate-600 line-clamp-2">
                      {p.items.map((i) => `${i.name} (${i.qty})`).join(' · ')}
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-400 pt-0.5">
                      <span>{formatDateTime(p.createdAt)}</span>
                      {p.remainingAmount > 0 && (
                        <span className="font-mono-num font-semibold text-red-700">
                          متبقي: {formatMoney(p.remainingAmount, settings.currency)}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>

              {/* Desktop Table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50/90 border-b border-slate-200 text-xs text-slate-600">
                    <tr>
                      <th className="text-right py-3 px-4">رقم الفاتورة</th>
                      <th className="text-right py-3 px-4">المورد</th>
                      <th className="text-right py-3 px-4">الأصناف</th>
                      <th className="text-left py-3 px-4">الإجمالي</th>
                      <th className="text-left py-3 px-4">المدفوع</th>
                      <th className="text-left py-3 px-4">المتبقي</th>
                      <th className="text-right py-3 px-4">الموظف والجهاز</th>
                      <th className="text-right py-3 px-4">التاريخ</th>
                      <th className="text-center py-3 px-4">عرض</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {purchases.map((p) => (
                      <tr
                        key={p.id}
                        onClick={() => setSelectedPurchase(p)}
                        className="hover:bg-slate-50/80 cursor-pointer"
                      >
                        <td className="py-3 px-4 font-mono-num font-semibold text-emerald-700">
                          {p.purchaseNumber}
                        </td>
                        <td className="py-3 px-4 font-medium text-slate-900">
                          {p.supplierName}
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-600">
                          {p.items.map((i) => `${i.name} (${i.qty})`).join(' · ')}
                        </td>
                        <td className="py-3 px-4 text-left font-mono-num font-bold">
                          {formatMoney(p.total, settings.currency)}
                        </td>
                        <td className="py-3 px-4 text-left font-mono-num text-emerald-700">
                          {formatMoney(p.paidAmount, settings.currency)} (
                          {paymentMethodLabel(p.paymentMethod)})
                        </td>
                        <td className="py-3 px-4 text-left font-mono-num text-red-700">
                          {formatMoney(p.remainingAmount, settings.currency)}
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-600">
                          <div>{p.employeeName}</div>
                          {p.deviceName && (
                            <div className="text-[11px] text-slate-400">{p.deviceName}</div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-500">
                          {formatDateTime(p.createdAt)}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedPurchase(p);
                            }}
                            className="p-1.5 text-slate-500 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg cursor-pointer"
                            title="تفاصيل الفاتورة"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'suppliers' && (
        <div className="ui-card overflow-hidden">
          <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200 flex items-center justify-between gap-3">
            <h2 className="text-sm font-bold text-slate-900">قائمة الموردين</h2>
            <button
              type="button"
              onClick={() => setShowAddSupp(true)}
              className="ui-btn-primary px-3.5 min-h-[38px] text-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>إضافة مورد</span>
            </button>
          </div>
          {suppliers.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">
              لا يوجد موردون مسجلون بعد.
            </div>
          ) : (
            <>
              {/* Mobile Supplier Cards */}
              <div className="md:hidden divide-y divide-slate-100">
                {suppliers.map((s) => (
                  <div key={s.id} className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-bold text-slate-900 text-sm truncate">
                          {s.name}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2 text-xs text-slate-500 mt-0.5">
                          <span className="font-mono-num">{s.supplierCode}</span>
                          {s.phone && (
                            <span className="inline-flex items-center gap-1 font-mono-num">
                              <Phone className="w-3 h-3" />
                              {s.phone}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-left shrink-0">
                        <div className="text-[11px] text-slate-400">المتبقي له</div>
                        <div
                          className={`text-sm font-bold font-mono-num ${
                            s.balanceDue > 0 ? 'text-red-700' : 'text-emerald-700'
                          }`}
                        >
                          {formatMoney(s.balanceDue, settings.currency)}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs bg-slate-50/80 border border-slate-100 rounded-xl p-2.5">
                      <div>
                        <span className="text-slate-500">المشتريات: </span>
                        <span className="font-mono-num font-semibold text-slate-800">
                          {formatMoney(s.totalPurchases, settings.currency)}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500">المدفوع: </span>
                        <span className="font-mono-num font-semibold text-emerald-700">
                          {formatMoney(s.totalPaid, settings.currency)}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setStmtSupp(s)}
                        className="flex-1 ui-btn-secondary px-3 min-h-[40px] text-xs"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        <span>كشف حساب</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => openPaySupplierModal(s)}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 min-h-[40px] text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-xl cursor-pointer whitespace-nowrap"
                      >
                        <Banknote className="w-3.5 h-3.5" />
                        <span>سند صرف</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Desktop Table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50/90 border-b border-slate-200 text-xs text-slate-600">
                    <tr>
                      <th className="text-right py-3 px-4">الكود</th>
                      <th className="text-right py-3 px-4">المورد</th>
                      <th className="text-right py-3 px-4">الهاتف</th>
                      <th className="text-left py-3 px-4">إجمالي المشتريات</th>
                      <th className="text-left py-3 px-4">المدفوع</th>
                      <th className="text-left py-3 px-4">المتبقي له</th>
                      <th className="text-center py-3 px-4">إجراءات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {suppliers.map((s) => (
                      <tr key={s.id} className="hover:bg-slate-50/80">
                        <td className="py-3 px-4 font-mono-num text-xs text-slate-600">
                          {s.supplierCode}
                        </td>
                        <td className="py-3 px-4 font-semibold text-slate-900">{s.name}</td>
                        <td className="py-3 px-4 font-mono-num text-xs text-slate-600">
                          {s.phone || '—'}
                        </td>
                        <td className="py-3 px-4 text-left font-mono-num">
                          {formatMoney(s.totalPurchases, settings.currency)}
                        </td>
                        <td className="py-3 px-4 text-left font-mono-num text-emerald-700">
                          {formatMoney(s.totalPaid, settings.currency)}
                        </td>
                        <td className="py-3 px-4 text-left font-mono-num font-bold text-red-700">
                          {formatMoney(s.balanceDue, settings.currency)}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <button
                              type="button"
                              onClick={() => setStmtSupp(s)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg hover:bg-slate-100 cursor-pointer"
                            >
                              <FileText className="w-3.5 h-3.5" />
                              <span>كشف حساب</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => openPaySupplierModal(s)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg cursor-pointer"
                            >
                              <Banknote className="w-3.5 h-3.5" />
                              <span>سند صرف</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* Add Supplier Modal */}
      {showAddSupp && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-[1px] flex items-end sm:items-center justify-center p-0 sm:p-4">
          <form
            onSubmit={handleCreateSupplier}
            className="bg-white border border-slate-200 rounded-t-2xl sm:rounded-2xl w-full max-w-md max-h-[92dvh] flex flex-col overflow-hidden shadow-2xl"
          >
            <ModalSubPageHeader title="إضافة مورد جديد" onBack={requestCloseAddSupp} />
            <div className="p-5 sm:p-6 space-y-4 overflow-y-auto">
              <div className="space-y-3.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    اسم المورد / الشركة *
                  </label>
                  <input
                    required
                    type="text"
                    value={suppName}
                    onChange={(e) => setSuppName(e.target.value)}
                    className="ui-input"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    رقم الهاتف
                  </label>
                  <input
                    type="text"
                    value={suppPhone}
                    onChange={(e) => setSuppPhone(e.target.value)}
                    className="ui-input font-mono-num"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    العنوان
                  </label>
                  <input
                    type="text"
                    value={suppAddress}
                    onChange={(e) => setSuppAddress(e.target.value)}
                    className="ui-input"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="submit"
                  disabled={savingSupp}
                  className="ui-btn-primary w-full sm:w-auto px-5 text-sm"
                >
                  <Plus className="w-4 h-4" />
                  <span>{savingSupp ? 'جاري الحفظ...' : 'حفظ المورد'}</span>
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Pay Supplier Modal */}
      {paySupp && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-[1px] flex items-end sm:items-center justify-center p-0 sm:p-4">
          <form
            onSubmit={handlePaySupplier}
            className="bg-white border border-slate-200 rounded-t-2xl sm:rounded-2xl w-full max-w-md max-h-[92dvh] flex flex-col overflow-hidden shadow-2xl"
          >
            <ModalSubPageHeader
              title={`سند صرف للمورد: ${paySupp.name}`}
              onBack={requestClosePaySupp}
            />
            <div className="p-5 sm:p-6 space-y-4 overflow-y-auto">
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs flex items-center justify-between">
                <span className="text-slate-600">المبلغ المستحق للمورد</span>
                <strong className="font-mono-num text-sm text-red-700">
                  {formatMoney(paySupp.balanceDue, settings.currency)}
                </strong>
              </div>
              <div className="space-y-3.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    المبلغ المدفوع *
                  </label>
                  <input
                    required
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={payAmt}
                    onChange={(e) => setPayAmt(e.target.value)}
                    className="ui-input font-mono-num"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    ملاحظات
                  </label>
                  <input
                    type="text"
                    value={payNotes}
                    onChange={(e) => setPayNotes(e.target.value)}
                    className="ui-input"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="submit"
                  disabled={paying}
                  className="ui-btn-primary w-full sm:w-auto px-5 text-sm"
                >
                  <Banknote className="w-4 h-4" />
                  <span>{paying ? 'جاري التسجيل...' : 'تأكيد الصرف'}</span>
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Supplier Statement Modal */}
      {liveStmtSupp && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-[1px] flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-t-2xl sm:rounded-2xl w-full max-w-2xl max-h-[92dvh] flex flex-col overflow-hidden shadow-2xl">
            <ModalSubPageHeader
              title={`كشف حساب المورد: ${liveStmtSupp.name}`}
              subtitle={`${liveStmtSupp.supplierCode} · ${liveStmtSupp.phone || 'بدون هاتف'}`}
              onBack={requestCloseStmtSupp}
            />
            <div className="p-5 sm:p-6 space-y-4 overflow-y-auto">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-xs">
                <div>
                  <span className="text-slate-500">إجمالي المشتريات</span>
                  <strong className="block font-mono-num text-sm text-slate-900 mt-0.5">
                    {formatMoney(liveStmtSupp.totalPurchases, settings.currency)}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-500">إجمالي المدفوع</span>
                  <strong className="block font-mono-num text-sm text-emerald-700 mt-0.5">
                    {formatMoney(liveStmtSupp.totalPaid, settings.currency)}
                  </strong>
                </div>
                <div>
                  <span className="text-slate-500">المتبقي</span>
                  <strong className="block font-mono-num text-sm text-red-700 mt-0.5">
                    {formatMoney(liveStmtSupp.balanceDue, settings.currency)}
                  </strong>
                </div>
              </div>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                <h4 className="text-xs font-bold text-slate-700">فواتير الشراء</h4>
                {purchases
                  .filter((p) => p.supplierId === liveStmtSupp.id)
                  .map((p) => (
                    <button
                      type="button"
                      key={p.id}
                      onClick={() => setSelectedPurchase(p)}
                      className="w-full text-right flex flex-wrap justify-between gap-2 text-xs border-b border-slate-100 py-2.5 px-2.5 hover:bg-slate-50 rounded-lg cursor-pointer"
                    >
                      <span className="font-mono-num font-semibold text-emerald-700">
                        {p.purchaseNumber} · {formatDateTime(p.createdAt)}
                      </span>
                      <span className="font-mono-num">
                        إجمالي: {formatMoney(p.total, settings.currency)} · مدفوع:{' '}
                        {formatMoney(p.paidAmount, settings.currency)}
                      </span>
                    </button>
                  ))}
              </div>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                <h4 className="text-xs font-bold text-slate-700">سندات الصرف</h4>
                {vouchers
                  .filter((v) => v.partyType === 'supplier' && v.partyId === liveStmtSupp.id)
                  .map((v) => (
                    <div
                      key={v.id}
                      className="flex justify-between text-xs border-b border-slate-100 py-2.5 px-1"
                    >
                      <span className="font-mono-num font-semibold">
                        {v.voucherNumber} · {formatDateTime(v.createdAt)}
                      </span>
                      <span className="font-mono-num text-emerald-700 font-semibold">
                        {formatMoney(v.amount, settings.currency)}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Purchase Invoice Detail Modal */}
      {selectedPurchase && (
        <div className="fixed inset-0 z-[55] bg-slate-900/50 backdrop-blur-[1px] flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-t-2xl sm:rounded-2xl w-full max-w-2xl max-h-[92dvh] flex flex-col overflow-hidden shadow-2xl">
            <ModalSubPageHeader
              title={`تفاصيل فاتورة الشراء: ${selectedPurchase.purchaseNumber}`}
              subtitle={`${selectedPurchase.supplierName} · ${formatDateTime(
                selectedPurchase.createdAt
              )}`}
              onBack={requestClosePurchaseDetail}
            />
            <div className="p-5 sm:p-6 space-y-4 overflow-y-auto">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-xs">
                <div>
                  <div className="text-slate-500">المورد</div>
                  <div className="font-bold text-slate-900 mt-0.5">
                    {selectedPurchase.supplierName}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">طريقة الدفع</div>
                  <div className="font-bold text-slate-900 mt-0.5">
                    {paymentMethodLabel(selectedPurchase.paymentMethod)}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">الموظف</div>
                  <div className="font-bold text-slate-900 mt-0.5">
                    {selectedPurchase.employeeName}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">الجهاز</div>
                  <div className="font-bold text-slate-900 mt-0.5">
                    {selectedPurchase.deviceName || '—'}
                  </div>
                </div>
              </div>

              <div className="border border-slate-200 rounded-xl overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                    <tr>
                      <th className="text-right py-2.5 px-3">الكود / الصنف</th>
                      <th className="text-center py-2.5 px-3">الكمية</th>
                      <th className="text-left py-2.5 px-3">سعر التكلفة</th>
                      <th className="text-left py-2.5 px-3">الإجمالي</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {selectedPurchase.items.map((item, idx) => (
                      <tr key={`${item.productId}_${idx}`}>
                        <td className="py-2 px-3">
                          <div className="font-semibold text-slate-900">{item.name}</div>
                          <div className="font-mono-num text-[11px] text-slate-500">
                            {item.code} · {item.unit}
                          </div>
                        </td>
                        <td className="py-2 px-3 text-center font-mono-num">{item.qty}</td>
                        <td className="py-2 px-3 text-left font-mono-num">
                          {formatMoney(item.costPrice, settings.currency)}
                        </td>
                        <td className="py-2 px-3 text-left font-mono-num font-bold">
                          {formatMoney(item.lineTotal, settings.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {selectedPurchase.notes && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700">
                  <strong>ملاحظات:</strong> {selectedPurchase.notes}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-xs">
                <div>
                  <div className="text-slate-500">إجمالي الفاتورة</div>
                  <div className="font-mono-num font-bold text-slate-900 text-sm mt-0.5">
                    {formatMoney(selectedPurchase.total, settings.currency)}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">المدفوع</div>
                  <div className="font-mono-num font-bold text-emerald-700 text-sm mt-0.5">
                    {formatMoney(selectedPurchase.paidAmount, settings.currency)}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">المتبقي للمورد</div>
                  <div className="font-mono-num font-bold text-red-700 text-sm mt-0.5">
                    {formatMoney(selectedPurchase.remainingAmount, settings.currency)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <CameraBarcodeModal
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        allowContinuous
        defaultContinuous
        title="مسح باركود الأصناف لفاتورة الشراء"
        onDetected={(rawCode) => {
          const clean = normalizeBarcode(rawCode);
          if (!clean) {
            return { ok: false, message: 'رمز الباركود غير صالح.' };
          }
          const found = productByCode.get(clean);
          if (!found) {
            return {
              ok: false,
              message: `لم يتم العثور على صنف بالباركود "${clean}"`,
            };
          }
          addProductLine(found);
          setFeedback(null);
          return {
            ok: true,
            message: `تمت إضافة "${found.name}" (${found.code}) لفاتورة الشراء`,
          };
        }}
      />
    </div>
  );
};
