import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Barcode,
  Camera,
  CheckCircle2,
  Minus,
  Plus,
  ScanBarcode,
  Search,
  ShoppingCart,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  useBackLayer,
  useSectionDirtyGuard,
} from '../contexts/NavigationContext';
import { useStoreData } from '../contexts/StoreDataContext';
import { useHardwareBarcodeScanner } from '../hooks/useHardwareBarcodeScanner';
import { createCustomer, executeSale } from '../services/accountingService';
import type { Customer, PaymentMethod, Product, SaleInvoice } from '../types';
import { normalizeBarcode } from '../utils/barcode';
import { formatMoney, formatNumber, generateDocId, roundMoney } from '../utils/format';
import { CameraBarcodeModal } from './CameraBarcodeModal';
import { InvoiceDetailModal } from './InvoiceDetailModal';
import { ModalSubPageHeader, PageHeader } from './UnifiedBackHeader';

function playPosScanBeep(success: boolean) {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = success ? 'sine' : 'triangle';
    osc.frequency.setValueAtTime(success ? 1040 : 320, ctx.currentTime);
    gain.gain.setValueAtTime(0.07, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.11);
    window.setTimeout(() => {
      ctx.close().catch(() => {});
    }, 200);
  } catch {
    // Ignore audio context restrictions
  }
}

interface CartLine {
  product: Product;
  qty: number;
  unitPrice: number;
}

interface PosViewProps {
  isActive?: boolean;
}

export const PosView: React.FC<PosViewProps> = ({ isActive = true }) => {
  const { actorInfo, isAdmin, hasPermission } = useAuth();
  const {
    products,
    customers,
    settings,
    productByCode,
    reservedStockByProductId,
    isOnline,
  } = useStoreData();

  const [codeInput, setCodeInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('الكل');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [paidAmountInput, setPaidAmountInput] = useState<string>('');
  const [discountInput, setDiscountInput] = useState<string>('0');
  const [notes, setNotes] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [scanToast, setScanToast] = useState<string | null>(null);
  const [scannerEnabled, setScannerEnabled] = useState(true);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [completedSale, setCompletedSale] = useState<SaleInvoice | null>(null);

  // Quick add customer modal
  const [showNewCustomer, setShowNewCustomer] = useState(false);
  const [newCustName, setNewCustName] = useState('');
  const [newCustPhone, setNewCustPhone] = useState('');
  const [newCustAddress, setNewCustAddress] = useState('');
  const [savingCustomer, setSavingCustomer] = useState(false);

  const codeFieldRef = useRef<HTMLInputElement>(null);
  const pendingOpIdRef = useRef<string | null>(null);
  const cartRef = useRef<CartLine[]>(cart);
  cartRef.current = cart;

  const canDiscount = isAdmin || hasPermission('canDiscount');
  const canEditPrice = isAdmin || hasPermission('canManageProducts');

  useSectionDirtyGuard('pos', {
    isDirty: () =>
      cart.length > 0 ||
      notes.trim().length > 0 ||
      (Number(discountInput) || 0) > 0,
    dirtyMessage:
      'توجد فاتورة بيع غير محفوظة في السلة، هل تريد الخروج دون حفظ؟',
    onDiscard: () => {
      pendingOpIdRef.current = null;
      setCart([]);
      setNotes('');
      setDiscountInput('0');
      setPaidAmountInput('');
      setSelectedCustomerId('');
      setPaymentMethod('cash');
    },
  });

  const requestCloseNewCustomer = useBackLayer({
    id: 'pos-quick-customer',
    active: showNewCustomer,
    onClose: () => setShowNewCustomer(false),
    isDirty: () =>
      Boolean(
        newCustName.trim() || newCustPhone.trim() || newCustAddress.trim()
      ),
    onDiscard: () => {
      setNewCustName('');
      setNewCustPhone('');
      setNewCustAddress('');
    },
  });

  const availableStock = (product: Product): number => {
    // Projected products from StoreDataContext already reflect pending offline sales and stock adjustments.
    return Math.max(0, roundMoney(product.stock));
  };

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) {
      if (p.isActive) set.add(p.category);
    }
    return ['الكل', ...Array.from(set)];
  }, [products]);

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const qNorm = normalizeBarcode(searchQuery);
    return products.filter((p) => {
      if (!p.isActive) return false;
      if (selectedCategory !== 'الكل' && p.category !== selectedCategory) {
        return false;
      }
      if (!q) return true;
      const pBar = normalizeBarcode(p.barcode);
      const pCode = normalizeBarcode(p.code);
      return (
        p.name.toLowerCase().includes(q) ||
        p.code.toLowerCase().includes(q) ||
        (p.barcode && p.barcode.toLowerCase().includes(q)) ||
        (qNorm.length > 0 && (pBar.includes(qNorm) || pCode.includes(qNorm)))
      );
    });
  }, [products, searchQuery, selectedCategory]);

  const selectedCustomer: Customer | null = useMemo(
    () => customers.find((c) => c.id === selectedCustomerId) || null,
    [customers, selectedCustomerId]
  );

  const addProductToCart = (product: Product): boolean => {
    setErrorMsg(null);
    const avail = availableStock(product);
    if (avail <= 0) {
      setErrorMsg(`الصنف "${product.name}" (${product.code}) غير متوفر في المخزون حالياً.`);
      return false;
    }

    const currentCart = cartRef.current;
    const existing = currentCart.find((l) => l.product.id === product.id);
    if (existing && existing.qty + 1 > avail) {
      setErrorMsg(`الكمية المتاحة من "${product.name}" هي ${avail} فقط.`);
      return false;
    }

    pendingOpIdRef.current = null;
    const nextCart = existing
      ? currentCart.map((l) =>
          l.product.id === product.id ? { ...l, qty: l.qty + 1 } : l
        )
      : [...currentCart, { product, qty: 1, unitPrice: product.sellPrice }];

    cartRef.current = nextCart;
    setCart(nextCart);
    return true;
  };

  const handleScanCode = (rawCode: string, source: 'manual' | 'scanner') => {
    const clean = normalizeBarcode(rawCode);
    if (!clean) return;
    const found = productByCode.get(clean);
    if (!found) {
      setScanToast(null);
      setErrorMsg(`لم يتم العثور على صنف بالكود أو الباركود "${clean}".`);
      if (source === 'scanner') playPosScanBeep(false);
      return;
    }
    const added = addProductToCart(found);
    if (added && source === 'scanner') {
      playPosScanBeep(true);
      setScanToast(`تمت إضافة "${found.name}" (${found.code}) للسلة`);
    } else if (!added && source === 'scanner') {
      playPosScanBeep(false);
    }
  };

  const handleBarcodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleScanCode(codeInput, 'manual');
    setCodeInput('');
    codeFieldRef.current?.focus();
  };

  useEffect(() => {
    if (!scanToast) return;
    const timer = window.setTimeout(() => setScanToast(null), 2500);
    return () => window.clearTimeout(timer);
  }, [scanToast]);

  useHardwareBarcodeScanner({
    enabled:
      isActive &&
      scannerEnabled &&
      !showNewCustomer &&
      !completedSale &&
      !submitting &&
      !cameraOpen,
    skipElementRef: codeFieldRef,
    onScan: (scanned) => handleScanCode(scanned, 'scanner'),
  });

  const updateCartQty = (productId: string, nextQty: number) => {
    setErrorMsg(null);
    pendingOpIdRef.current = null;
    if (nextQty <= 0) {
      setCart((prev) => prev.filter((l) => l.product.id !== productId));
      return;
    }
    setCart((prev) =>
      prev.map((l) => {
        if (l.product.id !== productId) return l;
        const avail = availableStock(l.product);
        if (nextQty > avail) {
          setErrorMsg(`أقصى كمية متاحة من "${l.product.name}" هي ${avail}.`);
          return l;
        }
        return { ...l, qty: nextQty };
      })
    );
  };

  const updateCartPrice = (productId: string, nextPrice: number) => {
    if (!canEditPrice) return;
    pendingOpIdRef.current = null;
    setCart((prev) =>
      prev.map((l) =>
        l.product.id === productId
          ? { ...l, unitPrice: Math.max(0, nextPrice) }
          : l
      )
    );
  };

  const subtotal = useMemo(
    () => roundMoney(cart.reduce((acc, l) => acc + l.qty * l.unitPrice, 0)),
    [cart]
  );

  const discount = useMemo(() => {
    if (!canDiscount) return 0;
    const d = Number(discountInput) || 0;
    return roundMoney(Math.min(Math.max(0, d), subtotal));
  }, [canDiscount, discountInput, subtotal]);

  const total = roundMoney(Math.max(0, subtotal - discount));

  const paidAmount = useMemo(() => {
    if (paymentMethod === 'cash') return total;
    if (paymentMethod === 'credit') return 0;
    const p = Number(paidAmountInput) || 0;
    return roundMoney(Math.min(Math.max(0, p), total));
  }, [paymentMethod, paidAmountInput, total]);

  const remainingAmount = roundMoney(Math.max(0, total - paidAmount));

  const handleCheckout = async () => {
    if (!actorInfo) return;
    setErrorMsg(null);
    setSuccessMsg(null);

    if (cart.length === 0) {
      setErrorMsg('السلة فارغة. أضف أصنافاً أولاً لإتمام الفاتورة.');
      return;
    }
    if ((paymentMethod === 'credit' || paymentMethod === 'partial') && !selectedCustomer) {
      setErrorMsg('يرجى اختيار العميل أو تسجيل عميل جديد للبيع الآجل أو الجزئي.');
      return;
    }

    if (!pendingOpIdRef.current) {
      pendingOpIdRef.current = generateDocId('op');
    }

    setSubmitting(true);
    try {
      const result = await executeSale(actorInfo, {
        customer: selectedCustomer,
        items: cart.map((l) => ({
          productId: l.product.id,
          qty: l.qty,
          unitPrice: l.unitPrice,
          code: l.product.code,
          name: l.product.name,
          unit: l.product.unit,
          costPrice: l.product.costPrice,
        })),
        discount,
        paymentMethod,
        paidAmount,
        notes,
        operationId: pendingOpIdRef.current,
      });

      pendingOpIdRef.current = null;
      setCart([]);
      setDiscountInput('0');
      setPaidAmountInput('');
      setNotes('');
      setPaymentMethod('cash');
      setSelectedCustomerId('');
      setSuccessMsg(
        result.queued
          ? `تم حفظ الفاتورة محلياً برقم مؤقت ${result.invoiceNumber} وستُزامن تلقائياً فور عودة الاتصال.`
          : `تم تسجيل الفاتورة ${result.invoiceNumber} وتحديث المخزون والصندوق بنجاح.`
      );
      setCompletedSale(result.saleData);
      codeFieldRef.current?.focus();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر إتمام عملية البيع.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateQuickCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actorInfo || !newCustName.trim()) return;
    setSavingCustomer(true);
    try {
      const created = await createCustomer(actorInfo, {
        name: newCustName.trim(),
        phone: newCustPhone.trim(),
        address: newCustAddress.trim(),
      });
      setSelectedCustomerId(created.id);
      setShowNewCustomer(false);
      setNewCustName('');
      setNewCustPhone('');
      setNewCustAddress('');
      if (created.queued) {
        setSuccessMsg(`تم حفظ العميل "${created.name}" محلياً وسيُزامن تلقائياً فور عودة الاتصال.`);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر تسجيل العميل.');
    } finally {
      setSavingCustomer(false);
    }
  };

  return (
    <div className="space-y-4 sm:space-y-5">
      <PageHeader
        title="شاشة البيع السريع (الكاشير)"
        subtitle={`أدخل كود الصنف أو الباركود للإضافة الفورية · جميع الفواتير تُحفظ وترتبط بحساب المسؤول لحظياً${
          !isOnline ? ' · وضع عدم الاتصال نشط (حفظ محلي دائم)' : ''
        }`}
      />

      {errorMsg && (
        <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs sm:text-sm flex items-center justify-between gap-3">
          <span>{errorMsg}</span>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="p-1.5 rounded-lg hover:bg-red-100 cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {successMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs sm:text-sm flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessMsg(null)}
            className="p-1.5 rounded-lg hover:bg-emerald-100 cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {scanToast && (
        <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ScanBarcode className="w-4 h-4 shrink-0 text-emerald-700" />
            <span>{scanToast}</span>
          </div>
          <button
            type="button"
            onClick={() => setScanToast(null)}
            className="p-1 rounded-lg hover:bg-emerald-100 cursor-pointer shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Right/Main Panel: Code scanner + Product selector */}
        <div className="lg:col-span-7 space-y-4">
          {/* Quick code / barcode input */}
          <form onSubmit={handleBarcodeSubmit} className="ui-card p-3.5 space-y-2.5">
            <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Barcode className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  ref={codeFieldRef}
                  type="text"
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value)}
                  placeholder="امسح الباركود أو اكتب كود الصنف واضغط Enter..."
                  className="ui-input pr-10 bg-slate-50/70 font-mono-num"
                  autoFocus
                />
              </div>
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <button
                  type="submit"
                  className="flex-1 sm:flex-none min-h-[42px] px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs sm:text-sm font-semibold rounded-xl transition-colors cursor-pointer whitespace-nowrap"
                >
                  إضافة بالكود
                </button>
                <button
                  type="button"
                  onClick={() => setCameraOpen(true)}
                  className="flex-1 sm:flex-none ui-btn-primary text-xs sm:text-sm"
                >
                  <Camera className="w-4 h-4" />
                  <span>مسح بالكاميرا</span>
                </button>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 px-0.5">
              <span>
                يدعم القراءة من الماسح الضوئي (USB / Bluetooth) أو كاميرا الهاتف
              </span>
              <button
                type="button"
                onClick={() => setScannerEnabled((prev) => !prev)}
                className={`inline-flex items-center gap-1 font-semibold cursor-pointer ${
                  scannerEnabled ? 'text-emerald-700' : 'text-slate-500'
                }`}
              >
                <ScanBarcode className="w-3.5 h-3.5" />
                <span>
                  {scannerEnabled ? 'الالتقاط التلقائي مفعل' : 'الالتقاط التلقائي متوقف'}
                </span>
              </button>
            </div>
          </form>

          {/* Search & Category Filter */}
          <div className="ui-card p-3.5 sm:p-4 space-y-3">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="بحث سريع باسم الصنف أو الكود أو الباركود..."
                className="ui-input pr-10"
              />
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3.5 py-2 min-h-[36px] text-xs font-semibold rounded-xl transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    selectedCategory === cat
                      ? 'bg-emerald-700 text-white shadow-xs'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200/80'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>

            {filteredProducts.length === 0 ? (
              <div className="py-10 text-center text-sm text-slate-500">
                لا توجد أصناف مطابقة للبحث.
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-[500px] overflow-y-auto pt-1">
                {filteredProducts.map((product) => {
                  const avail = availableStock(product);
                  const reserved = reservedStockByProductId.get(product.id) || 0;
                  const outOfStock = avail <= 0;
                  const lowStock = avail > 0 && avail <= product.minStock;
                  return (
                    <button
                      key={product.id}
                      type="button"
                      disabled={outOfStock}
                      onClick={() => addProductToCart(product)}
                      className={`text-right p-3 rounded-xl border transition-all duration-150 flex flex-col justify-between gap-2 min-h-[104px] ${
                        outOfStock
                          ? 'bg-slate-50 border-slate-200 opacity-50 cursor-not-allowed'
                          : 'bg-white border-slate-200/90 hover:border-emerald-600 hover:bg-emerald-50/35 active:scale-[0.98] cursor-pointer shadow-[0_1px_2px_rgba(15,23,42,0.03)]'
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="text-[11px] font-mono-num text-slate-500 truncate">
                          {product.code}
                          {product.barcode ? ` · ${product.barcode}` : ''}
                        </div>
                        <div className="text-[13px] sm:text-sm font-bold text-slate-900 line-clamp-2 leading-snug">
                          {product.name}
                        </div>
                      </div>
                      <div className="flex items-end justify-between gap-1 pt-1.5 border-t border-slate-100">
                        <span className="text-xs sm:text-sm font-bold text-emerald-700 font-mono-num">
                          {formatMoney(product.sellPrice, settings.currency)}
                        </span>
                        <span
                          className={`text-[11px] font-mono-num font-medium ${
                            outOfStock
                              ? 'text-red-600'
                              : lowStock
                              ? 'text-amber-700'
                              : 'text-slate-500'
                          }`}
                        >
                          المتاح: {formatNumber(avail)}
                          {reserved > 0 ? ` (${formatNumber(reserved)})` : ''}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Left Panel: Invoice Cart & Checkout */}
        <div className="lg:col-span-5 ui-card overflow-hidden lg:sticky lg:top-20">
          <div className="px-4 py-3.5 border-b border-slate-200/80 flex items-center justify-between bg-slate-50/80">
            <div className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-lg bg-emerald-700 text-white flex items-center justify-center">
                <ShoppingCart className="w-4 h-4" />
              </span>
              <h2 className="text-sm font-bold text-slate-900">
                الفاتورة الحالية {cart.length > 0 ? `(${cart.length})` : ''}
              </h2>
            </div>
            {cart.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  pendingOpIdRef.current = null;
                  setCart([]);
                }}
                className="text-xs font-semibold text-red-600 hover:underline cursor-pointer"
              >
                تفريغ السلة
              </button>
            )}
          </div>

          <div className="p-4 space-y-4">
            {/* Customer selector */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-slate-700">العميل</label>
                <button
                  type="button"
                  onClick={() => setShowNewCustomer(true)}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline cursor-pointer"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>عميل جديد</span>
                </button>
              </div>
              <select
                value={selectedCustomerId}
                onChange={(e) => setSelectedCustomerId(e.target.value)}
                className="ui-input"
              >
                <option value="">عميل نقدي عام</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.customerCode})
                    {c.balanceDue > 0
                      ? ` - دين: ${formatMoney(c.balanceDue, settings.currency)}`
                      : ''}
                  </option>
                ))}
              </select>
            </div>

            {/* Cart Items */}
            {cart.length === 0 ? (
              <div className="py-10 text-center border border-dashed border-slate-200 rounded-xl text-xs text-slate-500">
                أضف أصنافاً من القائمة أو عبر كود الصنف لبدء الفاتورة
              </div>
            ) : (
              <div className="divide-y divide-slate-100 border border-slate-200/90 rounded-xl max-h-72 overflow-y-auto">
                {cart.map((line) => (
                  <div key={line.product.id} className="p-3 space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-slate-900 truncate">
                          {line.product.name}
                        </div>
                        <div className="text-[11px] font-mono-num text-slate-500">
                          {line.product.code}
                          {line.product.barcode ? ` · ${line.product.barcode}` : ''} ·{' '}
                          {line.product.unit}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => updateCartQty(line.product.id, 0)}
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg cursor-pointer shrink-0"
                        aria-label="إزالة"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center border border-slate-200 rounded-xl overflow-hidden bg-slate-50/50">
                        <button
                          type="button"
                          onClick={() => updateCartQty(line.product.id, line.qty - 1)}
                          className="min-w-[36px] min-h-[36px] flex items-center justify-center hover:bg-slate-100 active:bg-slate-200 text-slate-700 cursor-pointer"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <input
                          type="number"
                          min="1"
                          step="any"
                          value={line.qty}
                          onChange={(e) =>
                            updateCartQty(line.product.id, Number(e.target.value) || 0)
                          }
                          className="w-12 text-center text-sm font-mono-num font-bold bg-white py-1.5 border-x border-slate-200 focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => updateCartQty(line.product.id, line.qty + 1)}
                          className="min-w-[36px] min-h-[36px] flex items-center justify-center hover:bg-slate-100 active:bg-slate-200 text-slate-700 cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="flex items-center gap-2">
                        {canEditPrice ? (
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={line.unitPrice}
                            onChange={(e) =>
                              updateCartPrice(
                                line.product.id,
                                Number(e.target.value) || 0
                              )
                            }
                            className="w-20 px-2 py-1.5 text-xs font-mono-num text-left border border-slate-200 rounded-lg bg-white"
                            title="سعر الوحدة"
                          />
                        ) : (
                          <span className="text-xs font-mono-num text-slate-500">
                            × {formatMoney(line.unitPrice, settings.currency)}
                          </span>
                        )}
                        <span className="text-sm font-bold font-mono-num text-slate-900 min-w-[75px] text-left">
                          {formatMoney(line.qty * line.unitPrice, settings.currency)}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Payment & Discount */}
            <div className="space-y-3 border-t border-slate-200/80 pt-3.5">
              <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-xl">
                {(
                  [
                    ['cash', 'نقدي'],
                    ['partial', 'دفع جزئي'],
                    ['credit', 'آجل'],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setPaymentMethod(mode)}
                    className={`py-2 min-h-[38px] text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                      paymentMethod === mode
                        ? 'bg-white text-emerald-800 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    الخصم {!canDiscount && '(يتطلب صلاحية)'}
                  </label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    disabled={!canDiscount}
                    value={discountInput}
                    onChange={(e) => setDiscountInput(e.target.value)}
                    className="ui-input font-mono-num disabled:bg-slate-100"
                  />
                </div>
                {paymentMethod === 'partial' && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      المبلغ المدفوع الآن
                    </label>
                    <input
                      type="number"
                      min="0"
                      max={total}
                      step="0.01"
                      value={paidAmountInput}
                      onChange={(e) => setPaidAmountInput(e.target.value)}
                      placeholder="0.00"
                      className="ui-input font-mono-num"
                    />
                  </div>
                )}
              </div>

              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="ملاحظات اختيارية على الفاتورة..."
                className="ui-input text-xs"
              />

              {/* Totals box */}
              <div className="bg-emerald-50/55 border border-emerald-200/80 rounded-xl p-3.5 space-y-1.5 text-sm">
                <div className="flex justify-between text-slate-600">
                  <span>المجموع الفرعي</span>
                  <span className="font-mono-num">{formatMoney(subtotal, settings.currency)}</span>
                </div>
                {discount > 0 && (
                  <div className="flex justify-between text-amber-700">
                    <span>الخصم</span>
                    <span className="font-mono-num">- {formatMoney(discount, settings.currency)}</span>
                  </div>
                )}
                <div className="flex justify-between text-base font-bold text-slate-900 border-t border-emerald-200/70 pt-2">
                  <span>الإجمالي النهائي</span>
                  <span className="font-mono-num text-emerald-700">
                    {formatMoney(total, settings.currency)}
                  </span>
                </div>
                <div className="flex justify-between text-xs text-slate-600 pt-1">
                  <span>
                    المدفوع:{' '}
                    <strong className="font-mono-num text-emerald-700">
                      {formatMoney(paidAmount, settings.currency)}
                    </strong>
                  </span>
                  <span>
                    المتبقي:{' '}
                    <strong className="font-mono-num text-red-700">
                      {formatMoney(remainingAmount, settings.currency)}
                    </strong>
                  </span>
                </div>
              </div>

              <button
                type="button"
                disabled={submitting || cart.length === 0}
                onClick={handleCheckout}
                className="ui-btn-primary w-full min-h-[48px] text-sm font-bold"
              >
                {submitting ? 'جاري حفظ الفاتورة...' : 'إصدار الفاتورة وحفظ البيع'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Add Customer Modal */}
      {showNewCustomer && (
        <div className="fixed inset-0 z-50 bg-slate-950/55 backdrop-blur-[1px] flex items-end sm:items-center justify-center p-0 sm:p-4">
          <form
            onSubmit={handleCreateQuickCustomer}
            className="bg-white border border-slate-200 rounded-t-2xl sm:rounded-2xl w-full max-w-md overflow-hidden shadow-2xl"
          >
            <ModalSubPageHeader
              title="تسجيل عميل جديد سريع"
              onBack={requestCloseNewCustomer}
            />
            <div className="p-5 sm:p-6 space-y-4">
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    اسم العميل *
                  </label>
                  <input
                    required
                    type="text"
                    value={newCustName}
                    onChange={(e) => setNewCustName(e.target.value)}
                    className="ui-input"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    رقم الهاتف
                  </label>
                  <input
                    type="text"
                    value={newCustPhone}
                    onChange={(e) => setNewCustPhone(e.target.value)}
                    className="ui-input font-mono-num"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    العنوان
                  </label>
                  <input
                    type="text"
                    value={newCustAddress}
                    onChange={(e) => setNewCustAddress(e.target.value)}
                    className="ui-input"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="submit"
                  disabled={savingCustomer}
                  className="ui-btn-primary w-full sm:w-auto text-xs"
                >
                  {savingCustomer ? 'جاري الحفظ...' : 'حفظ واختيار العميل'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      <CameraBarcodeModal
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        allowContinuous
        defaultContinuous
        title="مسح باركود الأصناف بالكاميرا"
        onDetected={(rawCode) => {
          const clean = normalizeBarcode(rawCode);
          if (!clean) {
            return { ok: false, message: 'رمز الباركود غير صالح.' };
          }
          const found = productByCode.get(clean);
          if (!found) {
            setErrorMsg(`لم يتم العثور على صنف بالكود أو الباركود "${clean}".`);
            return {
              ok: false,
              message: `لم يتم العثور على صنف بالباركود "${clean}"`,
            };
          }
          const added = addProductToCart(found);
          if (added) {
            const msg = `تمت إضافة "${found.name}" (${found.code}) للسلة`;
            setScanToast(msg);
            return { ok: true, message: msg };
          }
          const avail = availableStock(found);
          return {
            ok: false,
            message:
              avail <= 0
                ? `الصنف "${found.name}" غير متوفر في المخزون حالياً`
                : `الكمية المتاحة من "${found.name}" هي ${avail} فقط`,
          };
        }}
      />

      <InvoiceDetailModal
        sale={completedSale}
        onClose={() => setCompletedSale(null)}
        showProfit={isAdmin}
      />
    </div>
  );
};
