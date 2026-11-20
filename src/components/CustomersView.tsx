import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Banknote,
  Edit2,
  FileText,
  Phone,
  Plus,
  Printer,
  Search,
  UserCheck,
  Users,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useBackLayer } from '../contexts/NavigationContext';
import { useStoreData } from '../contexts/StoreDataContext';
import {
  createCustomer,
  recordVoucher,
  updateCustomer,
} from '../services/accountingService';
import type { Customer, SaleInvoice } from '../types';
import {
  formatDateTime,
  formatMoney,
  paymentMethodLabel,
} from '../utils/format';
import { printCurrentView } from '../utils/print';
import { InvoiceDetailModal } from './InvoiceDetailModal';
import { ModalSubPageHeader, PageHeader } from './UnifiedBackHeader';

export const CustomersView: React.FC = () => {
  const { actorInfo, isAdmin } = useAuth();
  const { customers, sales, returns, vouchers, settings } = useStoreData();

  const [search, setSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [selectedSale, setSelectedSale] = useState<SaleInvoice | null>(null);

  // Add/Edit Modal
  const [formOpen, setFormOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Receipt Voucher Modal (تسديد دين عميل)
  const [payCustomer, setPayCustomer] = useState<Customer | null>(null);
  const [payAmount, setPayAmount] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [paying, setPaying] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return customers.filter(
      (c) =>
        !q ||
        c.name.toLowerCase().includes(q) ||
        c.customerCode.toLowerCase().includes(q) ||
        (c.phone && c.phone.includes(q))
    );
  }, [customers, search]);

  const totalDebts = useMemo(
    () => customers.reduce((a, c) => a + Math.max(0, c.balanceDue), 0),
    [customers]
  );

  // Statement for selectedCustomer
  const statementData = useMemo(() => {
    if (!selectedCustomer) return { custSales: [], custReturns: [], custVouchers: [] };
    return {
      custSales: sales.filter((s) => s.customerId === selectedCustomer.id),
      custReturns: returns.filter((r) => r.customerId === selectedCustomer.id),
      custVouchers: vouchers.filter(
        (v) => v.partyType === 'customer' && v.partyId === selectedCustomer.id
      ),
    };
  }, [selectedCustomer, sales, returns, vouchers]);

  const liveSelectedCustomer = useMemo(
    () =>
      selectedCustomer
        ? customers.find((c) => c.id === selectedCustomer.id) || selectedCustomer
        : null,
    [selectedCustomer, customers]
  );

  const initialFormSnapRef = useRef({
    name: '',
    phone: '',
    address: '',
    notes: '',
  });
  const initialPayAmtRef = useRef('');

  const requestCloseStatement = useBackLayer({
    id: 'customer-statement',
    active: Boolean(liveSelectedCustomer),
    onClose: () => setSelectedCustomer(null),
  });

  const requestCloseCustomerForm = useBackLayer({
    id: 'customer-form',
    active: formOpen,
    onClose: () => setFormOpen(false),
    isDirty: () => {
      const s = initialFormSnapRef.current;
      return (
        name !== s.name ||
        phone !== s.phone ||
        address !== s.address ||
        notes !== s.notes
      );
    },
  });

  const requestClosePayment = useBackLayer({
    id: 'customer-payment',
    active: Boolean(payCustomer),
    onClose: () => setPayCustomer(null),
    isDirty: () =>
      payAmount !== initialPayAmtRef.current || payNotes.trim() !== '',
    onDiscard: () => {
      setPayAmount('');
      setPayNotes('');
    },
  });

  const openAdd = () => {
    setEditingCustomer(null);
    initialFormSnapRef.current = { name: '', phone: '', address: '', notes: '' };
    setName('');
    setPhone('');
    setAddress('');
    setNotes('');
    setErrorMsg(null);
    setFormOpen(true);
  };

  const openEdit = (c: Customer) => {
    setEditingCustomer(c);
    const snap = {
      name: c.name,
      phone: c.phone || '',
      address: c.address || '',
      notes: c.notes || '',
    };
    initialFormSnapRef.current = snap;
    setName(snap.name);
    setPhone(snap.phone);
    setAddress(snap.address);
    setNotes(snap.notes);
    setErrorMsg(null);
    setFormOpen(true);
  };

  const openPaymentModal = (c: Customer) => {
    const initAmt = c.balanceDue > 0 ? String(c.balanceDue) : '';
    initialPayAmtRef.current = initAmt;
    setPayCustomer(c);
    setPayAmount(initAmt);
    setPayNotes('');
  };

  const handleSaveCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actorInfo) return;
    setSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      if (editingCustomer) {
        const res = await updateCustomer(actorInfo, editingCustomer, {
          name,
          phone,
          address,
          notes,
        });
        setSuccessMsg(
          res.queued
            ? `تم حفظ تعديل العميل "${name}" محلياً وسيُزامن فور عودة الاتصال.`
            : `تم تحديث بيانات العميل "${name}" بنجاح.`
        );
      } else {
        const res = await createCustomer(actorInfo, { name, phone, address, notes });
        setSuccessMsg(
          res.queued
            ? `تم حفظ العميل الجديد "${name}" محلياً وسيُزامن فور عودة الاتصال.`
            : `تم تسجيل العميل "${name}" بنجاح.`
        );
      }
      setFormOpen(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر حفظ بيانات العميل.');
    } finally {
      setSaving(false);
    }
  };

  const handleReceivePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actorInfo || !payCustomer) return;
    setPaying(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const result = await recordVoucher(actorInfo, {
        type: 'receipt',
        partyType: 'customer',
        partyId: payCustomer.id,
        partyName: payCustomer.name,
        amount: Number(payAmount) || 0,
        notes: payNotes.trim() || 'تسديد دفعة من الحساب',
      });
      setSuccessMsg(
        result.queued
          ? `تم حفظ سند القبض (${result.voucherNumber}) للعميل ${payCustomer.name} محلياً وسيُزامن فور عودة الاتصال.`
          : `تم تسجيل سند القبض ${result.voucherNumber} وتحديث رصيد العميل والصندوق.`
      );
      setPayCustomer(null);
      setPayAmount('');
      setPayNotes('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'تعذر تسجيل السند.');
    } finally {
      setPaying(false);
    }
  };

  return (
    <>
      <div className={liveSelectedCustomer ? 'space-y-5 no-print' : 'space-y-5'}>
        <PageHeader
          title="العملاء والديون"
          subtitle="سجل العملاء · إجمالي المشتريات والمدفوعات · الديون المتبقية · سندات القبض"
          actions={
            <button
              type="button"
              onClick={openAdd}
              className="ui-btn-primary px-4 text-sm"
            >
              <Plus className="w-4 h-4" />
              <span>إضافة عميل جديد</span>
            </button>
          }
        />

        {/* Summary KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
          <div className="ui-card p-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-medium text-slate-500">عدد العملاء المسجلين</div>
              <div className="text-2xl font-bold font-mono-num text-slate-900 mt-1">
                {customers.length}
              </div>
            </div>
            <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
              <Users className="w-5 h-5" />
            </div>
          </div>

          <div className="ui-card p-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-medium text-slate-500">إجمالي الديون المستحقة</div>
              <div className="text-2xl font-bold font-mono-num text-red-700 mt-1 truncate">
                {formatMoney(totalDebts, settings.currency)}
              </div>
            </div>
            <div className="w-10 h-10 rounded-xl bg-red-50 text-red-700 flex items-center justify-center shrink-0">
              <Banknote className="w-5 h-5" />
            </div>
          </div>

          <div className="ui-card p-4 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-medium text-slate-500">عملاء بأرصدة مستحقة</div>
              <div className="text-2xl font-bold font-mono-num text-amber-700 mt-1">
                {customers.filter((c) => c.balanceDue > 0).length}
              </div>
            </div>
            <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
          </div>
        </div>

        {errorMsg && (
          <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-medium">
            {errorMsg}
          </div>
        )}

        {successMsg && (
          <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-medium">
            {successMsg}
          </div>
        )}

        {/* Search */}
        <div className="ui-card p-3.5">
          <div className="relative max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="بحث باسم العميل أو الكود أو الهاتف..."
              className="ui-input pr-10"
            />
          </div>
        </div>

        {/* Customers Directory: Mobile Cards + Desktop Table */}
        <div className="ui-card overflow-hidden">
          {filtered.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">
              لا يوجد عملاء مطابقون للبحث.
            </div>
          ) : (
            <>
              {/* Mobile Cards */}
              <div className="md:hidden divide-y divide-slate-100">
                {filtered.map((c) => (
                  <div key={c.id} className="p-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-bold text-slate-900 text-sm truncate">
                          {c.name}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 mt-0.5">
                          <span className="font-mono-num font-semibold text-slate-600">
                            {c.customerCode}
                          </span>
                          {c.phone && (
                            <span className="inline-flex items-center gap-1 font-mono-num">
                              <Phone className="w-3 h-3" />
                              {c.phone}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="text-left shrink-0">
                        <div className="text-[11px] text-slate-400">الدين المتبقي</div>
                        <div
                          className={`text-sm font-bold font-mono-num ${
                            c.balanceDue > 0 ? 'text-red-700' : 'text-emerald-700'
                          }`}
                        >
                          {formatMoney(c.balanceDue, settings.currency)}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs bg-slate-50/80 border border-slate-100 rounded-xl p-2.5">
                      <div>
                        <span className="text-slate-500">المشتريات: </span>
                        <span className="font-mono-num font-semibold text-slate-800">
                          {formatMoney(c.totalPurchases, settings.currency)}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500">المدفوع: </span>
                        <span className="font-mono-num font-semibold text-emerald-700">
                          {formatMoney(c.totalPaid, settings.currency)}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedCustomer(c)}
                        className="flex-1 ui-btn-secondary px-3 min-h-[40px] text-xs"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        <span>كشف حساب</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => openPaymentModal(c)}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 min-h-[40px] text-xs font-semibold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-xl cursor-pointer whitespace-nowrap"
                      >
                        <Banknote className="w-3.5 h-3.5" />
                        <span>قبض دفعة</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => openEdit(c)}
                        className="ui-btn-secondary px-2.5 min-h-[40px] min-w-[40px]"
                        title="تعديل"
                        aria-label={`تعديل ${c.name}`}
                      >
                        <Edit2 className="w-4 h-4" />
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
                      <th className="text-right py-3 px-4 font-semibold">الكود</th>
                      <th className="text-right py-3 px-4 font-semibold">اسم العميل</th>
                      <th className="text-right py-3 px-4 font-semibold">الهاتف والعنوان</th>
                      <th className="text-left py-3 px-4 font-semibold">إجمالي المشتريات</th>
                      <th className="text-left py-3 px-4 font-semibold">المدفوع</th>
                      <th className="text-left py-3 px-4 font-semibold">المتبقي (الدين)</th>
                      <th className="text-center py-3 px-4 font-semibold">إجراءات</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filtered.map((c) => (
                      <tr key={c.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="py-3 px-4 font-mono-num text-xs font-semibold text-slate-600">
                          {c.customerCode}
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-900">{c.name}</div>
                          <div className="text-xs text-slate-400">
                            تاريخ التسجيل: {formatDateTime(c.createdAt)}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-xs text-slate-600">
                          <div className="font-mono-num">{c.phone || '—'}</div>
                          <div>{c.address || ''}</div>
                        </td>
                        <td className="py-3 px-4 text-left font-mono-num">
                          {formatMoney(c.totalPurchases, settings.currency)}
                        </td>
                        <td className="py-3 px-4 text-left font-mono-num text-emerald-700 font-medium">
                          {formatMoney(c.totalPaid, settings.currency)}
                        </td>
                        <td className="py-3 px-4 text-left font-mono-num font-bold">
                          <span className={c.balanceDue > 0 ? 'text-red-700' : 'text-slate-700'}>
                            {formatMoney(c.balanceDue, settings.currency)}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setSelectedCustomer(c)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-100 cursor-pointer whitespace-nowrap"
                            >
                              <FileText className="w-3.5 h-3.5" />
                              <span>كشف حساب</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => openPaymentModal(c)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 cursor-pointer whitespace-nowrap"
                            >
                              <Banknote className="w-3.5 h-3.5" />
                              <span>قبض دفعة</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => openEdit(c)}
                              className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg hover:bg-slate-100 cursor-pointer"
                              title="تعديل"
                            >
                              <Edit2 className="w-4 h-4" />
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
      </div>

      {/* Customer Statement Modal */}
      {liveSelectedCustomer && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-[1px] flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto print:static print:inset-auto print:bg-white print:p-0 print:block">
          <div className="bg-white border border-slate-200 rounded-t-2xl sm:rounded-2xl w-full max-w-3xl max-h-[92dvh] flex flex-col overflow-hidden print-container shadow-2xl print:max-h-none print:rounded-none print:shadow-none print:border-0">
            <ModalSubPageHeader
              title={`كشف حساب العميل: ${liveSelectedCustomer.name}`}
              subtitle={`${liveSelectedCustomer.customerCode} · ${
                liveSelectedCustomer.phone || 'بدون هاتف'
              }`}
              onBack={requestCloseStatement}
              actions={
                <button
                  type="button"
                  onClick={() =>
                    printCurrentView(`كشف حساب - ${liveSelectedCustomer.name}`)
                  }
                  className="ui-btn-primary px-3 min-h-[38px] text-xs"
                >
                  <Printer className="w-3.5 h-3.5" />
                  <span>طباعة الكشف</span>
                </button>
              }
            />

            <div className="p-4 sm:p-6 space-y-5 overflow-y-auto print:overflow-visible">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm">
                <div>
                  <div className="text-xs text-slate-500">إجمالي المشتريات</div>
                  <div className="font-bold font-mono-num text-slate-900 mt-0.5">
                    {formatMoney(liveSelectedCustomer.totalPurchases, settings.currency)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">إجمالي المدفوع</div>
                  <div className="font-bold font-mono-num text-emerald-700 mt-0.5">
                    {formatMoney(liveSelectedCustomer.totalPaid, settings.currency)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">الرصيد المتبقي (الدين)</div>
                  <div className="font-bold font-mono-num text-red-700 mt-0.5">
                    {formatMoney(liveSelectedCustomer.balanceDue, settings.currency)}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="text-sm font-bold text-slate-900">
                  سجل الفواتير ({statementData.custSales.length})
                </h4>
                {statementData.custSales.length === 0 ? (
                  <p className="text-xs text-slate-500">لا توجد فواتير مسجلة لهذا العميل.</p>
                ) : (
                  <div className="border border-slate-200 rounded-xl overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                        <tr>
                          <th className="text-right py-2.5 px-3">الفاتورة</th>
                          <th className="text-right py-2.5 px-3">التاريخ</th>
                          <th className="text-right py-2.5 px-3">البائع</th>
                          <th className="text-left py-2.5 px-3">الإجمالي</th>
                          <th className="text-left py-2.5 px-3">المدفوع</th>
                          <th className="text-left py-2.5 px-3">المتبقي</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {statementData.custSales.map((s) => (
                          <tr
                            key={s.id}
                            onClick={() => setSelectedSale(s)}
                            className="hover:bg-slate-50 cursor-pointer"
                          >
                            <td className="py-2.5 px-3 font-mono-num font-semibold text-emerald-700 whitespace-nowrap">
                              {s.invoiceNumber} ({paymentMethodLabel(s.paymentMethod)})
                            </td>
                            <td className="py-2.5 px-3 text-slate-500 whitespace-nowrap">
                              {formatDateTime(s.createdAt)}
                            </td>
                            <td className="py-2.5 px-3">{s.employeeName}</td>
                            <td className="py-2.5 px-3 text-left font-mono-num font-semibold whitespace-nowrap">
                              {formatMoney(s.total, settings.currency)}
                            </td>
                            <td className="py-2.5 px-3 text-left font-mono-num text-emerald-700 whitespace-nowrap">
                              {formatMoney(s.paidAmount, settings.currency)}
                            </td>
                            <td className="py-2.5 px-3 text-left font-mono-num text-red-700 whitespace-nowrap">
                              {formatMoney(s.remainingAmount, settings.currency)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <h4 className="text-sm font-bold text-slate-900">
                  سندات القبض والتسديد ({statementData.custVouchers.length})
                </h4>
                {statementData.custVouchers.length === 0 ? (
                  <p className="text-xs text-slate-500">لا توجد سندات قبض مسجلة.</p>
                ) : (
                  <div className="border border-slate-200 rounded-xl overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                        <tr>
                          <th className="text-right py-2.5 px-3">رقم السند</th>
                          <th className="text-right py-2.5 px-3">التاريخ</th>
                          <th className="text-right py-2.5 px-3">الملاحظات</th>
                          <th className="text-left py-2.5 px-3">المبلغ المقبوض</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {statementData.custVouchers.map((v) => (
                          <tr key={v.id}>
                            <td className="py-2.5 px-3 font-mono-num font-semibold whitespace-nowrap">
                              {v.voucherNumber}
                            </td>
                            <td className="py-2.5 px-3 text-slate-500 whitespace-nowrap">
                              {formatDateTime(v.createdAt)}
                            </td>
                            <td className="py-2.5 px-3">{v.notes || '—'}</td>
                            <td className="py-2.5 px-3 text-left font-mono-num font-bold text-emerald-700 whitespace-nowrap">
                              {formatMoney(v.amount, settings.currency)}
                            </td>
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

      {/* Add/Edit Customer Modal */}
      {formOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-[1px] flex items-end sm:items-center justify-center p-0 sm:p-4">
          <form
            onSubmit={handleSaveCustomer}
            className="bg-white border border-slate-200 rounded-t-2xl sm:rounded-2xl w-full max-w-md max-h-[92dvh] flex flex-col overflow-hidden shadow-2xl"
          >
            <ModalSubPageHeader
              title={editingCustomer ? 'تعديل بيانات العميل' : 'إضافة عميل جديد'}
              onBack={requestCloseCustomerForm}
            />
            <div className="p-5 sm:p-6 space-y-4 overflow-y-auto">
              <div className="space-y-3.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    اسم العميل *
                  </label>
                  <input
                    required
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="ui-input"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    رقم الهاتف
                  </label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="ui-input font-mono-num"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    العنوان
                  </label>
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    className="ui-input"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    ملاحظات
                  </label>
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="ui-input"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="ui-btn-primary w-full sm:w-auto px-5 text-sm"
                >
                  <UserCheck className="w-4 h-4" />
                  <span>{saving ? 'جاري الحفظ...' : 'حفظ بيانات العميل'}</span>
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* Customer Payment Voucher Modal */}
      {payCustomer && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-[1px] flex items-end sm:items-center justify-center p-0 sm:p-4">
          <form
            onSubmit={handleReceivePayment}
            className="bg-white border border-slate-200 rounded-t-2xl sm:rounded-2xl w-full max-w-md max-h-[92dvh] flex flex-col overflow-hidden shadow-2xl"
          >
            <ModalSubPageHeader
              title={`سند قبض: ${payCustomer.name}`}
              onBack={requestClosePayment}
            />
            <div className="p-5 sm:p-6 space-y-4 overflow-y-auto">
              <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl text-xs flex items-center justify-between">
                <span className="text-slate-600">الرصيد المستحق حالياً</span>
                <strong className="font-mono-num text-sm text-red-700">
                  {formatMoney(payCustomer.balanceDue, settings.currency)}
                </strong>
              </div>
              <div className="space-y-3.5">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    المبلغ المستلم ({settings.currency}) *
                  </label>
                  <input
                    required
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={payAmount}
                    onChange={(e) => setPayAmount(e.target.value)}
                    className="ui-input font-mono-num"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                    ملاحظات السند
                  </label>
                  <input
                    type="text"
                    value={payNotes}
                    onChange={(e) => setPayNotes(e.target.value)}
                    placeholder="مثال: دفعة نقدية من الحساب"
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
                  <span>{paying ? 'جاري التسجيل...' : 'تأكيد القبض وتحديث الصندوق'}</span>
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      <InvoiceDetailModal
        sale={selectedSale}
        onClose={() => setSelectedSale(null)}
        showProfit={isAdmin}
      />
    </>
  );
};
