import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  Edit2,
  Eye,
  Plus,
  Printer,
  RefreshCw,
  ScanBarcode,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useBackLayer, useNavigation } from '../contexts/NavigationContext';
import { useStoreData } from '../contexts/StoreDataContext';
import { useHardwareBarcodeScanner } from '../hooks/useHardwareBarcodeScanner';
import {
  createProduct,
  deleteProduct,
  updateProduct,
} from '../services/accountingService';
import type { Product } from '../types';
import {
  findBarcodeConflict,
  generateUniqueProductBarcode,
  isValidBarcodeFormat,
  normalizeBarcode,
} from '../utils/barcode';
import {
  formatDateTime,
  formatMoney,
  formatNumber,
  movementTypeLabel,
} from '../utils/format';
import { BarcodeGraphic, ProductBarcodeCard } from './BarcodeGraphic';
import { CameraBarcodeModal } from './CameraBarcodeModal';
import { ModalSubPageHeader } from './UnifiedBackHeader';

export const ProductsView: React.FC = () => {
  const { actorInfo, isAdmin, hasPermission } = useAuth();
  const { products, stockMovements, settings, counters, productByCode } =
    useStoreData();
  const { activeSection } = useNavigation();

  const canManage = isAdmin || hasPermission('canManageProducts');
  const isSectionActive = activeSection === 'products';

  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<'all' | 'low'>('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [cameraMode, setCameraMode] = useState<'form' | 'search' | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);

  const [autoCode, setAutoCode] = useState(true);
  const [code, setCode] = useState('');
  const [barcode, setBarcode] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState('مواد غذائية');
  const [unit, setUnit] = useState('حبة');
  const [costPrice, setCostPrice] = useState('');
  const [sellPrice, setSellPrice] = useState('');
  const [stock, setStock] = useState('0');
  const [minStock, setMinStock] = useState('5');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);

  const [saving, setSaving] = useState(false);
  const [generatingBulk, setGeneratingBulk] = useState(false);
  const [generatingDetailBarcode, setGeneratingDetailBarcode] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const barcodeInputRef = useRef<HTMLInputElement>(null);

  const initialFormRef = useRef({
    autoCode: true,
    code: '',
    barcode: '',
    name: '',
    category: 'مواد غذائية',
    unit: 'حبة',
    costPrice: '',
    sellPrice: '',
    stock: '0',
    minStock: '5',
    description: '',
    isActive: true,
  });

  const liveDetailProduct = useMemo(
    () =>
      detailProduct
        ? products.find((p) => p.id === detailProduct.id) || detailProduct
        : null,
    [detailProduct, products]
  );

  const productMovements = useMemo(
    () =>
      liveDetailProduct
        ? stockMovements.filter((m) => m.productId === liveDetailProduct.id)
        : [],
    [liveDetailProduct, stockMovements]
  );

  const normalizedFormBarcode = useMemo(() => normalizeBarcode(barcode), [barcode]);

  const barcodeConflict = useMemo(
    () =>
      normalizedFormBarcode
        ? findBarcodeConflict(normalizedFormBarcode, products, editingProduct?.id)
        : null,
    [normalizedFormBarcode, products, editingProduct?.id]
  );

  const barcodeFormatValid = useMemo(
    () => isValidBarcodeFormat(barcode),
    [barcode]
  );

  const productsMissingBarcode = useMemo(
    () => products.filter((p) => !normalizeBarcode(p.barcode)),
    [products]
  );

  const requestCloseDetail = useBackLayer({
    id: 'product-detail-modal',
    active: Boolean(liveDetailProduct),
    onClose: () => setDetailProduct(null),
  });

  const requestCloseProductModal = useBackLayer({
    id: 'product-form-modal',
    active: modalOpen,
    onClose: () => setModalOpen(false),
    isDirty: () => {
      const snap = initialFormRef.current;
      return (
        autoCode !== snap.autoCode ||
        code !== snap.code ||
        barcode !== snap.barcode ||
        name !== snap.name ||
        category !== snap.category ||
        unit !== snap.unit ||
        costPrice !== snap.costPrice ||
        sellPrice !== snap.sellPrice ||
        stock !== snap.stock ||
        minStock !== snap.minStock ||
        description !== snap.description ||
        isActive !== snap.isActive
      );
    },
  });

  // External USB / Bluetooth scanner support inside the Add/Edit Modal
  useHardwareBarcodeScanner({
    enabled: isSectionActive && modalOpen && !cameraMode,
    skipElementRef: barcodeInputRef,
    onScan: (scanned) => {
      const clean = normalizeBarcode(scanned);
      if (clean) {
        setBarcode(clean);
      }
    },
  });

  // External USB / Bluetooth scanner support in the Products list view
  useHardwareBarcodeScanner({
    enabled:
      isSectionActive && !modalOpen && !cameraMode && !liveDetailProduct,
    onScan: (scanned) => {
      const clean = normalizeBarcode(scanned);
      if (!clean) return;
      setSearchQuery(clean);
      const exact = productByCode.get(clean);
      if (exact) {
        setDetailProduct(exact);
      }
    },
  });

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const qNorm = normalizeBarcode(searchQuery);
    return products.filter((p) => {
      if (filterMode === 'low' && p.stock > p.minStock) return false;
      if (!q) return true;
      const pBar = normalizeBarcode(p.barcode);
      const pCode = normalizeBarcode(p.code);
      return (
        p.name.toLowerCase().includes(q) ||
        p.code.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q) ||
        (p.barcode && p.barcode.toLowerCase().includes(q)) ||
        (qNorm.length > 0 && (pBar.includes(qNorm) || pCode.includes(qNorm)))
      );
    });
  }, [products, searchQuery, filterMode]);

  const openAddModal = () => {
    setEditingProduct(null);
    const initialGenerated = generateUniqueProductBarcode(
      products,
      counters.nextProductSeq
    );
    const snap = {
      autoCode: true,
      code: '',
      barcode: initialGenerated,
      name: '',
      category: 'مواد غذائية',
      unit: 'حبة',
      costPrice: '',
      sellPrice: '',
      stock: '0',
      minStock: '5',
      description: '',
      isActive: true,
    };
    initialFormRef.current = snap;
    setAutoCode(snap.autoCode);
    setCode(snap.code);
    setBarcode(snap.barcode);
    setName(snap.name);
    setCategory(snap.category);
    setUnit(snap.unit);
    setCostPrice(snap.costPrice);
    setSellPrice(snap.sellPrice);
    setStock(snap.stock);
    setMinStock(snap.minStock);
    setDescription(snap.description);
    setIsActive(snap.isActive);
    setErrorMsg(null);
    setModalOpen(true);
  };

  const openEditModal = (p: Product) => {
    setEditingProduct(p);
    const snap = {
      autoCode: false,
      code: p.code,
      barcode: p.barcode || '',
      name: p.name,
      category: p.category,
      unit: p.unit,
      costPrice: String(p.costPrice),
      sellPrice: String(p.sellPrice),
      stock: String(p.stock),
      minStock: String(p.minStock),
      description: p.description || '',
      isActive: p.isActive,
    };
    initialFormRef.current = snap;
    setAutoCode(snap.autoCode);
    setCode(snap.code);
    setBarcode(snap.barcode);
    setName(snap.name);
    setCategory(snap.category);
    setUnit(snap.unit);
    setCostPrice(snap.costPrice);
    setSellPrice(snap.sellPrice);
    setStock(snap.stock);
    setMinStock(snap.minStock);
    setDescription(snap.description);
    setIsActive(snap.isActive);
    setErrorMsg(null);
    setModalOpen(true);
  };

  const handleGenerateBarcodeInForm = () => {
    const generated = generateUniqueProductBarcode(
      products,
      counters.nextProductSeq,
      editingProduct?.id
    );
    setBarcode(generated);
    setErrorMsg(null);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actorInfo) return;
    setErrorMsg(null);
    setSuccessMsg(null);

    if (!barcodeFormatValid) {
      setErrorMsg(
        'صيغة الباركود غير صالحة. يرجى استخدام أرقام أو أحرف إنجليزية ورموز قياسية فقط.'
      );
      return;
    }

    if (barcodeConflict) {
      setErrorMsg(
        `الباركود "${normalizedFormBarcode}" مستخدم بالفعل للصنف "${barcodeConflict.name}" (كود: ${barcodeConflict.code}).`
      );
      return;
    }

    setSaving(true);
    try {
      if (editingProduct) {
        const res = await updateProduct(actorInfo, editingProduct, {
          barcode: normalizedFormBarcode,
          name,
          category,
          description,
          unit,
          costPrice: Number(costPrice) || 0,
          sellPrice: Number(sellPrice) || 0,
          minStock: Number(minStock) || 0,
          isActive,
          existingProducts: products,
        });
        setSuccessMsg(
          res.queued
            ? `تم حفظ تعديل الصنف "${name}" بالباركود (${res.barcode}) محلياً وسيُزامن فور عودة الاتصال.`
            : `تم تحديث بيانات الصنف "${name}" وحفظ الباركود (${res.barcode}) بنجاح.`
        );
      } else {
        const res = await createProduct(actorInfo, {
          code: autoCode ? '' : code,
          barcode: normalizedFormBarcode,
          name,
          category,
          description,
          unit,
          costPrice: Number(costPrice) || 0,
          sellPrice: Number(sellPrice) || 0,
          stock: Number(stock) || 0,
          minStock: Number(minStock) || 0,
          existingProducts: products,
        });
        setSuccessMsg(
          res.queued
            ? `تم حفظ الصنف الجديد "${name}" بالباركود (${res.barcode}) محلياً وسيُزامن فور عودة الاتصال.`
            : `تم إضافة الصنف "${name}" وتخصيص الباركود الفريد (${res.barcode}) بنجاح.`
        );
      }
      setModalOpen(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'حدث خطأ أثناء حفظ الصنف.');
    } finally {
      setSaving(false);
    }
  };

  const handleAssignDetailBarcode = async (prod: Product) => {
    if (!actorInfo || !canManage) return;
    setGeneratingDetailBarcode(true);
    setErrorMsg(null);
    try {
      const nextBarcode = generateUniqueProductBarcode(
        products,
        counters.nextProductSeq,
        prod.id
      );
      const res = await updateProduct(actorInfo, prod, {
        barcode: nextBarcode,
        name: prod.name,
        category: prod.category,
        description: prod.description || '',
        unit: prod.unit,
        costPrice: prod.costPrice,
        sellPrice: prod.sellPrice,
        minStock: prod.minStock,
        isActive: prod.isActive,
        existingProducts: products,
      });
      setSuccessMsg(
        res.queued
          ? `تم تخصيص الباركود (${res.barcode}) للصنف "${prod.name}" محلياً وسيُزامن فور عودة الاتصال.`
          : `تم تخصيص الباركود (${res.barcode}) للصنف "${prod.name}" وحفظه بنجاح.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر تخصيص الباركود.');
    } finally {
      setGeneratingDetailBarcode(false);
    }
  };

  const handleBulkGenerateMissingBarcodes = async () => {
    if (!actorInfo || !canManage || productsMissingBarcode.length === 0) return;
    setGeneratingBulk(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    let updatedCount = 0;
    let queuedCount = 0;
    const rollingCatalog: Product[] = products.map((p) => ({ ...p }));

    try {
      for (let i = 0; i < productsMissingBarcode.length; i++) {
        const target = productsMissingBarcode[i];
        const generated = generateUniqueProductBarcode(
          rollingCatalog,
          counters.nextProductSeq + i,
          target.id
        );
        const res = await updateProduct(actorInfo, target, {
          barcode: generated,
          name: target.name,
          category: target.category,
          description: target.description || '',
          unit: target.unit,
          costPrice: target.costPrice,
          sellPrice: target.sellPrice,
          minStock: target.minStock,
          isActive: target.isActive,
          existingProducts: rollingCatalog,
        });
        const idx = rollingCatalog.findIndex((x) => x.id === target.id);
        if (idx >= 0) {
          rollingCatalog[idx] = { ...rollingCatalog[idx], barcode: res.barcode };
        }
        updatedCount++;
        if (res.queued) queuedCount++;
      }

      setSuccessMsg(
        queuedCount > 0
          ? `تم توليد وحفظ باركود فريد لـ ${updatedCount} صنف محلياً وسيُزامن فور عودة الاتصال.`
          : `تم توليد وحفظ باركود فريد لـ ${updatedCount} صنف بنجاح.`
      );
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'حدث خطأ أثناء توليد الباركودات للأصناف.'
      );
    } finally {
      setGeneratingBulk(false);
    }
  };

  const handleDelete = async (p: Product) => {
    if (!actorInfo || !isAdmin) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await deleteProduct(actorInfo, p);
      if (res.queued) {
        setSuccessMsg(`تم جدولة حذف الصنف "${p.name}" محلياً وسيُزامن فور عودة الاتصال.`);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر حذف الصنف.');
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900">إدارة الأصناف والباركود</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            باركود فريد لكل صنف · توليد تلقائي أو مسح بالكاميرا والماسح الضوئي · طباعة وحفظ الملصقات
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canManage && productsMissingBarcode.length > 0 && (
            <button
              type="button"
              disabled={generatingBulk}
              onClick={handleBulkGenerateMissingBarcodes}
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 bg-white border border-emerald-300 text-emerald-800 hover:bg-emerald-50 text-xs font-semibold rounded-xl transition-colors cursor-pointer whitespace-nowrap"
            >
              <ScanBarcode className="w-4 h-4" />
              <span>
                {generatingBulk
                  ? 'جاري توليد الباركود...'
                  : `توليد باركود تلقائي (${productsMissingBarcode.length} صنف)`}
              </span>
            </button>
          )}
          {canManage && (
            <button
              onClick={openAddModal}
              className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold rounded-xl transition-colors cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة صنف جديد</span>
            </button>
          )}
        </div>
      </div>

      {successMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center justify-between gap-2">
          <span>{successMsg}</span>
          <button type="button" onClick={() => setSuccessMsg(null)} className="cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {errorMsg && !modalOpen && (
        <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-center justify-between gap-2">
          <span>{errorMsg}</span>
          <button type="button" onClick={() => setErrorMsg(null)} className="cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 min-w-[240px]">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="بحث بالباركود أو الكود أو اسم الصنف أو التصنيف..."
              className="w-full pr-9 pl-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-600"
            />
          </div>
          <button
            type="button"
            onClick={() => setCameraMode('search')}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-lg shrink-0 cursor-pointer whitespace-nowrap"
            title="البحث بمسح الباركود بالكاميرا"
          >
            <Camera className="w-4 h-4" />
            <span>مسح للبحث</span>
          </button>
        </div>
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
          <button
            onClick={() => setFilterMode('all')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
              filterMode === 'all' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
            }`}
          >
            جميع الأصناف ({products.length})
          </button>
          <button
            onClick={() => setFilterMode('low')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md cursor-pointer ${
              filterMode === 'low' ? 'bg-white text-amber-700 shadow-xs' : 'text-slate-600'
            }`}
          >
            مخزون منخفض ({products.filter((p) => p.stock <= p.minStock).length})
          </button>
        </div>
      </div>

      {/* Products Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {filteredProducts.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <p className="text-sm text-slate-500">لا توجد أصناف مطابقة للبحث أو الفلتر.</p>
            {canManage && products.length === 0 && (
              <button
                onClick={openAddModal}
                className="px-4 py-2 bg-emerald-700 text-white text-xs font-semibold rounded-lg hover:bg-emerald-800 cursor-pointer"
              >
                إضافة أول صنف
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200 text-xs text-slate-600">
                <tr>
                  <th className="text-right py-3 px-4 font-semibold">الكود / الباركود</th>
                  <th className="text-right py-3 px-4 font-semibold">الصنف والتصنيف</th>
                  {isAdmin && (
                    <th className="text-left py-3 px-4 font-semibold">سعر الشراء</th>
                  )}
                  <th className="text-left py-3 px-4 font-semibold">سعر البيع</th>
                  <th className="text-center py-3 px-4 font-semibold">الكمية الحالية</th>
                  <th className="text-center py-3 px-4 font-semibold">الحد الأدنى</th>
                  <th className="text-right py-3 px-4 font-semibold">الحالة</th>
                  <th className="text-center py-3 px-4 font-semibold">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredProducts.map((p) => {
                  const isLow = p.stock <= p.minStock;
                  return (
                    <tr
                      key={p.id}
                      onClick={() => setDetailProduct(p)}
                      className="hover:bg-slate-50 cursor-pointer"
                    >
                      <td className="py-3 px-4 font-mono-num">
                        <div className="font-semibold text-slate-900">{p.code}</div>
                        {p.barcode ? (
                          <div className="inline-flex items-center gap-1 text-xs text-emerald-700 mt-0.5" dir="ltr">
                            <ScanBarcode className="w-3 h-3 shrink-0" />
                            <span>{p.barcode}</span>
                          </div>
                        ) : (
                          <div className="text-[11px] text-amber-700 mt-0.5">
                            بدون باركود
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900">{p.name}</div>
                        <div className="text-xs text-slate-500">
                          {p.category} · {p.unit}
                        </div>
                      </td>
                      {isAdmin && (
                        <td className="py-3 px-4 text-left font-mono-num text-slate-700">
                          {formatMoney(p.costPrice, settings.currency)}
                        </td>
                      )}
                      <td className="py-3 px-4 text-left font-mono-num font-bold text-emerald-700">
                        {formatMoney(p.sellPrice, settings.currency)}
                      </td>
                      <td className="py-3 px-4 text-center font-mono-num font-semibold">
                        <span
                          className={
                            p.stock === 0
                              ? 'text-red-700'
                              : isLow
                              ? 'text-amber-700'
                              : 'text-slate-900'
                          }
                        >
                          {formatNumber(p.stock)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-center font-mono-num text-slate-500">
                        {formatNumber(p.minStock)}
                      </td>
                      <td className="py-3 px-4 text-xs">
                        {!p.isActive ? (
                          <span className="text-slate-500">موقوف</span>
                        ) : p.stock === 0 ? (
                          <span className="text-red-700 font-semibold">نفد المخزون</span>
                        ) : isLow ? (
                          <span className="text-amber-700 font-semibold">مخزون منخفض</span>
                        ) : (
                          <span className="text-emerald-700 font-medium">متوفر</span>
                        )}
                      </td>
                      <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setDetailProduct(p)}
                            className="p-1.5 text-slate-600 hover:text-emerald-700 hover:bg-slate-100 rounded-lg cursor-pointer"
                            title="عرض تفاصيل الصنف والباركود"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDetailProduct(p)}
                            className="p-1.5 text-slate-600 hover:text-emerald-700 hover:bg-slate-100 rounded-lg cursor-pointer"
                            title="طباعة / حفظ باركود الصنف"
                          >
                            <Printer className="w-4 h-4" />
                          </button>
                          {canManage && (
                            <button
                              type="button"
                              onClick={() => openEditModal(p)}
                              className="p-1.5 text-slate-600 hover:text-emerald-700 hover:bg-slate-100 rounded-lg cursor-pointer"
                              title="تعديل"
                            >
                              <Edit2 className="w-4 h-4" />
                            </button>
                          )}
                          {canManage && isAdmin && (
                            <button
                              type="button"
                              onClick={() => handleDelete(p)}
                              className="p-1.5 text-slate-500 hover:text-red-700 hover:bg-red-50 rounded-lg cursor-pointer"
                              title="حذف"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Product Detail Modal */}
      {liveDetailProduct && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-2xl overflow-hidden shadow-xl">
            <ModalSubPageHeader
              title={`تفاصيل الصنف: ${liveDetailProduct.name}`}
              subtitle={`كود: ${liveDetailProduct.code}${
                liveDetailProduct.barcode ? ` · باركود: ${liveDetailProduct.barcode}` : ''
              }`}
              onBack={requestCloseDetail}
              actions={
                canManage ? (
                  <button
                    type="button"
                    onClick={() => openEditModal(liveDetailProduct)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-lg cursor-pointer"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                    <span>تعديل البيانات</span>
                  </button>
                ) : undefined
              }
            />

            <div className="p-6 space-y-5 max-h-[82dvh] overflow-y-auto">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                  <div className="text-slate-500">التصنيف والوحدة</div>
                  <div className="font-bold text-slate-900 mt-1">
                    {liveDetailProduct.category} · {liveDetailProduct.unit}
                  </div>
                </div>
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                  <div className="text-slate-500">سعر البيع</div>
                  <div className="font-bold font-mono-num text-emerald-700 text-sm mt-1">
                    {formatMoney(liveDetailProduct.sellPrice, settings.currency)}
                  </div>
                </div>
                {isAdmin && (
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                    <div className="text-slate-500">سعر الشراء / الربح</div>
                    <div className="font-bold font-mono-num text-slate-900 mt-1">
                      {formatMoney(liveDetailProduct.costPrice, settings.currency)}
                    </div>
                    <div className="text-[11px] font-mono-num text-emerald-700">
                      هامش:{' '}
                      {formatMoney(
                        liveDetailProduct.sellPrice - liveDetailProduct.costPrice,
                        settings.currency
                      )}
                    </div>
                  </div>
                )}
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
                  <div className="text-slate-500">الكمية الحالية</div>
                  <div
                    className={`font-bold font-mono-num text-sm mt-1 ${
                      liveDetailProduct.stock === 0
                        ? 'text-red-700'
                        : liveDetailProduct.stock <= liveDetailProduct.minStock
                        ? 'text-amber-700'
                        : 'text-slate-900'
                    }`}
                  >
                    {formatNumber(liveDetailProduct.stock)} {liveDetailProduct.unit}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    الحد الأدنى: {formatNumber(liveDetailProduct.minStock)}
                  </div>
                </div>
              </div>

              {/* Product Barcode Card: Display, Print & Save PNG */}
              {liveDetailProduct.barcode ? (
                <ProductBarcodeCard
                  barcodeValue={liveDetailProduct.barcode}
                  productName={liveDetailProduct.name}
                  productCode={liveDetailProduct.code}
                  sellPrice={liveDetailProduct.sellPrice}
                  currency={settings.currency}
                  storeName={settings.storeName}
                />
              ) : (
                <div className="p-4 rounded-xl border border-amber-200 bg-amber-50 flex flex-wrap items-center justify-between gap-3">
                  <div className="text-xs text-amber-900">
                    <div className="font-bold">هذا الصنف لا يملك باركوداً مخصصاً بعد</div>
                    <div className="text-amber-800 mt-0.5">
                      يمكنك توليد باركود فريد تلقائياً الآن لطباعته واستخدامه في البيع والجرد.
                    </div>
                  </div>
                  {canManage && (
                    <button
                      type="button"
                      disabled={generatingDetailBarcode}
                      onClick={() => handleAssignDetailBarcode(liveDetailProduct)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold rounded-lg cursor-pointer whitespace-nowrap"
                    >
                      <ScanBarcode className="w-4 h-4" />
                      <span>
                        {generatingDetailBarcode
                          ? 'جاري التخصيص...'
                          : 'توليد باركود تلقائي وحفظه'}
                      </span>
                    </button>
                  )}
                </div>
              )}

              {liveDetailProduct.description && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-700">
                  <span className="font-bold text-slate-900">الوصف: </span>
                  {liveDetailProduct.description}
                </div>
              )}

              <div className="space-y-2">
                <h4 className="text-sm font-bold text-slate-900">
                  سجل حركات هذا الصنف ({productMovements.length})
                </h4>
                {productMovements.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    لا توجد حركات مسجلة لهذا الصنف حتى الآن.
                  </p>
                ) : (
                  <div className="border border-slate-200 rounded-xl overflow-x-auto max-h-64 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                        <tr>
                          <th className="text-right py-2 px-3">التاريخ</th>
                          <th className="text-right py-2 px-3">الحركة</th>
                          <th className="text-center py-2 px-3">التغير</th>
                          <th className="text-center py-2 px-3">قبل ← بعد</th>
                          <th className="text-right py-2 px-3">السبب / المرجع</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {productMovements.slice(0, 30).map((m) => (
                          <tr key={m.id}>
                            <td className="py-2 px-3 text-slate-500 whitespace-nowrap">
                              {formatDateTime(m.createdAt)}
                            </td>
                            <td className="py-2 px-3 font-medium">
                              {movementTypeLabel(m.type)}
                            </td>
                            <td
                              className={`py-2 px-3 text-center font-mono-num font-bold ${
                                m.qtyChange > 0
                                  ? 'text-emerald-700'
                                  : m.qtyChange < 0
                                  ? 'text-red-700'
                                  : 'text-slate-600'
                              }`}
                            >
                              {m.qtyChange > 0 ? `+${m.qtyChange}` : m.qtyChange}
                            </td>
                            <td className="py-2 px-3 text-center font-mono-num text-slate-600">
                              {m.previousStock} ← {m.newStock}
                            </td>
                            <td className="py-2 px-3 text-slate-600">{m.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto">
          <form
            onSubmit={handleSave}
            className="bg-white border border-slate-200 rounded-2xl w-full max-w-xl overflow-hidden shadow-xl"
          >
            <ModalSubPageHeader
              title={
                editingProduct
                  ? `تعديل الصنف (${editingProduct.code})`
                  : 'إضافة صنف جديد'
              }
              onBack={requestCloseProductModal}
            />

            <div className="p-6 space-y-4 max-h-[82dvh] overflow-y-auto">
              {errorMsg && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs">
                  {errorMsg}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {!editingProduct && (
                  <div className="sm:col-span-2 bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-semibold text-slate-700">
                        كود الصنف الفريد
                      </label>
                      <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={autoCode}
                          onChange={(e) => setAutoCode(e.target.checked)}
                        />
                        <span>إنشاء تلقائي (HS-{counters.nextProductSeq})</span>
                      </label>
                    </div>
                    {!autoCode && (
                      <input
                        required
                        type="text"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        placeholder="مثال: PROD-101 (حروف إنجليزية وأرقام فقط)"
                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white font-mono-num"
                        dir="ltr"
                      />
                    )}
                  </div>
                )}

                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    اسم الصنف *
                  </label>
                  <input
                    required
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="مثال: أرز بسمتي 5 كيلو"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    التصنيف *
                  </label>
                  <input
                    required
                    type="text"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    الوحدة *
                  </label>
                  <input
                    required
                    type="text"
                    value={unit}
                    onChange={(e) => setUnit(e.target.value)}
                    placeholder="حبة / كرتون / كيلو"
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    سعر الشراء ({settings.currency}) *
                  </label>
                  <input
                    required
                    type="number"
                    min="0"
                    step="0.01"
                    value={costPrice}
                    onChange={(e) => setCostPrice(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono-num"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    سعر البيع ({settings.currency}) *
                  </label>
                  <input
                    required
                    type="number"
                    min="0"
                    step="0.01"
                    value={sellPrice}
                    onChange={(e) => setSellPrice(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono-num"
                  />
                </div>

                {!editingProduct && (
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      الكمية الافتتاحية
                    </label>
                    <input
                      required
                      type="number"
                      min="0"
                      step="any"
                      value={stock}
                      onChange={(e) => setStock(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono-num"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    الحد الأدنى للمخزون
                  </label>
                  <input
                    required
                    type="number"
                    min="0"
                    step="any"
                    value={minStock}
                    onChange={(e) => setMinStock(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono-num"
                  />
                </div>

                {/* Barcode Input + Auto-generate + Camera Scan + Duplicate Check + Live Preview */}
                <div className="sm:col-span-2 bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="text-xs font-semibold text-slate-800">
                      الباركود الفريد للصنف
                    </label>
                    <span className="text-[11px] text-slate-500">
                      امسح بالكاميرا / قارئ USB/Bluetooth أو اتركه للتوليد التلقائي
                    </span>
                  </div>

                  <div className="flex flex-wrap sm:flex-nowrap items-center gap-1.5">
                    <input
                      ref={barcodeInputRef}
                      type="text"
                      value={barcode}
                      onChange={(e) => setBarcode(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          setBarcode((prev) => normalizeBarcode(prev));
                        }
                      }}
                      placeholder="امسح أو اكتب الباركود، أو اضغط توليد تلقائي..."
                      className={`w-full px-3 py-2 text-sm bg-white border rounded-lg font-mono-num ${
                        barcodeConflict || !barcodeFormatValid
                          ? 'border-red-400 focus:border-red-600'
                          : 'border-slate-200 focus:border-emerald-600'
                      }`}
                      dir="ltr"
                    />
                    <button
                      type="button"
                      onClick={handleGenerateBarcodeInForm}
                      className="inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg shrink-0 cursor-pointer whitespace-nowrap"
                      title="إنشاء باركود EAN-13 فريد تلقائياً"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>توليد تلقائي</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setCameraMode('form')}
                      className="inline-flex items-center gap-1 px-3 py-2 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-lg shrink-0 cursor-pointer whitespace-nowrap"
                      title="التقاط الباركود بالكاميرا"
                    >
                      <Camera className="w-4 h-4" />
                      <span>مسح</span>
                    </button>
                  </div>

                  {!barcodeFormatValid && (
                    <div className="flex items-center gap-1.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        صيغة الباركود يجب أن تحتوي على أرقام أو أحرف إنجليزية ورموز قياسية فقط.
                      </span>
                    </div>
                  )}

                  {barcodeConflict && (
                    <div className="flex items-center gap-1.5 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5 font-medium">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>
                        هذا الباركود مستخدم بالفعل للصنف &quot;{barcodeConflict.name}&quot; (كود:{' '}
                        {barcodeConflict.code}) — لا يمكن تكراره.
                      </span>
                    </div>
                  )}

                  {normalizedFormBarcode &&
                    barcodeFormatValid &&
                    !barcodeConflict && (
                      <div className="bg-white border border-slate-200 rounded-lg p-2.5 max-w-[230px] mx-auto">
                        <BarcodeGraphic
                          value={normalizedFormBarcode}
                          height={42}
                          showText
                        />
                      </div>
                    )}
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    الوصف (اختياري)
                  </label>
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </div>

                {editingProduct && (
                  <label className="sm:col-span-2 inline-flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isActive}
                      onChange={(e) => setIsActive(e.target.checked)}
                    />
                    <span>الصنف نشط ومتاح للبيع</span>
                  </label>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="submit"
                  disabled={saving || Boolean(barcodeConflict) || !barcodeFormatValid}
                  className="px-5 py-2 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-300 rounded-lg cursor-pointer"
                >
                  {saving ? 'جاري الحفظ...' : 'حفظ البيانات'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      <CameraBarcodeModal
        open={cameraMode !== null}
        onClose={() => setCameraMode(null)}
        title={
          cameraMode === 'search'
            ? 'البحث عن صنف بمسح الباركود'
            : 'التقاط باركود الصنف بالكاميرا'
        }
        onDetected={(scanned) => {
          const clean = normalizeBarcode(scanned);
          if (!clean) {
            return { ok: false, message: 'رمز الباركود غير صالح.' };
          }
          if (cameraMode === 'search') {
            setSearchQuery(clean);
            const found = productByCode.get(clean);
            if (found) {
              setDetailProduct(found);
              return { ok: true, message: `تم العثور على: ${found.name} (${found.code})` };
            }
            return {
              ok: false,
              message: `لم يتم العثور على صنف بالباركود "${clean}"`,
            };
          }
          const conflict = findBarcodeConflict(clean, products, editingProduct?.id);
          setBarcode(clean);
          if (conflict) {
            return {
              ok: false,
              message: `تنبيه: الباركود مستخدم بالفعل للصنف "${conflict.name}" (${conflict.code})`,
            };
          }
          return { ok: true, message: `تم التقاط الباركود: ${clean}` };
        }}
      />
    </div>
  );
};

