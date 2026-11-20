import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Banknote,
  FileText,
  MonitorSmartphone,
  Package,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useStoreData } from '../contexts/StoreDataContext';
import type { NavSection, SaleInvoice } from '../types';
import {
  formatDateTime,
  formatMoney,
  formatNumber,
  isSameDay,
  paymentMethodLabel,
  saleStatusLabel,
} from '../utils/format';
import { InvoiceDetailModal } from './InvoiceDetailModal';
import { PageHeader } from './UnifiedBackHeader';

interface DashboardViewProps {
  onNavigate: (sec: NavSection, subTab?: string) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({ onNavigate }) => {
  const { isAdmin, hasPermission } = useAuth();
  const {
    settings,
    counters,
    products,
    customers,
    suppliers,
    sales,
    returns,
    expenses,
    auditLogs,
    devices,
    pendingOperations,
    dataLoading,
  } = useStoreData();

  const [selectedSale, setSelectedSale] = useState<SaleInvoice | null>(null);

  const metrics = useMemo(() => {
    const validSales = sales.filter((s) => s.status !== 'cancelled');
    const todaySales = validSales.filter((s) => isSameDay(s.createdAt));

    const todaySalesTotal = todaySales.reduce((acc, s) => acc + s.total, 0);
    const todayReturnsTotal = returns
      .filter((r) => isSameDay(r.createdAt))
      .reduce((acc, r) => acc + r.refundAmount, 0);
    const netTodaySales = Math.max(0, todaySalesTotal - todayReturnsTotal);

    const grossProfitTotal = validSales.reduce((acc, s) => acc + s.netProfit, 0);
    const returnedProfitTotal = returns.reduce((acc, r) => acc + r.returnedProfit, 0);
    const totalExpenses = expenses.reduce((acc, e) => acc + e.amount, 0);
    const netProfit = grossProfitTotal - returnedProfitTotal - totalExpenses;

    const todayProfit =
      todaySales.reduce((acc, s) => acc + s.netProfit, 0) -
      returns
        .filter((r) => isSameDay(r.createdAt))
        .reduce((acc, r) => acc + r.returnedProfit, 0) -
      expenses
        .filter((e) => isSameDay(e.createdAt))
        .reduce((acc, e) => acc + e.amount, 0);

    const inventoryCostValue = products.reduce(
      (acc, p) => acc + p.stock * p.costPrice,
      0
    );
    const customerDebts = customers.reduce((acc, c) => acc + Math.max(0, c.balanceDue), 0);
    const supplierPayables = suppliers.reduce(
      (acc, s) => acc + Math.max(0, s.balanceDue),
      0
    );
    const lowStockProducts = products.filter((p) => p.stock <= p.minStock);

    // Top selling products
    const productStats = new Map<
      string,
      { code: string; name: string; qty: number; revenue: number }
    >();
    for (const s of validSales) {
      for (const it of s.items) {
        const cur = productStats.get(it.productId) || {
          code: it.code,
          name: it.name,
          qty: 0,
          revenue: 0,
        };
        cur.qty += it.qty;
        cur.revenue += it.lineTotal;
        productStats.set(it.productId, cur);
      }
    }
    const topProducts = Array.from(productStats.values())
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 6);

    // Employee activity
    const empMap = new Map<
      string,
      {
        employeeId: string;
        employeeName: string;
        count: number;
        total: number;
        paid: number;
        lastAt: SaleInvoice['createdAt'];
      }
    >();
    for (const s of validSales) {
      const cur = empMap.get(s.employeeId) || {
        employeeId: s.employeeId,
        employeeName: s.employeeName,
        count: 0,
        total: 0,
        paid: 0,
        lastAt: s.createdAt,
      };
      cur.count += 1;
      cur.total += s.total;
      cur.paid += s.paidAmount;
      empMap.set(s.employeeId, cur);
    }
    const employeeActivity = Array.from(empMap.values()).sort(
      (a, b) => b.total - a.total
    );

    return {
      netTodaySales,
      todayInvoiceCount: todaySales.length,
      netProfit,
      todayProfit,
      totalExpenses,
      inventoryCostValue,
      customerDebts,
      supplierPayables,
      lowStockProducts,
      topProducts,
      employeeActivity,
    };
  }, [sales, returns, expenses, products, customers, suppliers]);

  const canViewFinances = isAdmin || hasPermission('canViewReports');

  if (dataLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="h-24 ui-card animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 sm:space-y-6">
      <PageHeader
        title={isAdmin ? 'لوحة تحكم المسؤول' : 'ملخص المبيعات اليومية'}
        subtitle={`متابعة لحظية للمبيعات والمخزون وحركة الموظفين في ${settings.storeName}`}
        actions={
          <button
            type="button"
            onClick={() => onNavigate('pos')}
            className="ui-btn-primary w-full sm:w-auto"
          >
            <span>فتح شاشة البيع السريع</span>
            <ArrowUpRight className="w-4 h-4" />
          </button>
        }
      />

      {/* KPI Grid — 2 columns on mobile for zero bloat, 4 on desktop */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="ui-card p-3.5 sm:p-4 space-y-2">
          <div className="flex items-center justify-between gap-2 text-[11px] sm:text-xs font-medium text-slate-500">
            <span className="truncate">صافي مبيعات اليوم</span>
            <span className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
              <Banknote className="w-4 h-4" />
            </span>
          </div>
          <div className="text-lg sm:text-2xl font-bold text-slate-900 font-mono-num truncate">
            {formatMoney(metrics.netTodaySales, settings.currency)}
          </div>
          <div className="text-[11px] sm:text-xs text-slate-500">
            فواتير اليوم:{' '}
            <span className="font-mono-num font-semibold text-slate-800">
              {metrics.todayInvoiceCount}
            </span>
          </div>
        </div>

        {canViewFinances ? (
          <div className="ui-card p-3.5 sm:p-4 space-y-2">
            <div className="flex items-center justify-between gap-2 text-[11px] sm:text-xs font-medium text-slate-500">
              <span className="truncate">صافي الأرباح التراكمي</span>
              <span className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
                <TrendingUp className="w-4 h-4" />
              </span>
            </div>
            <div className="text-lg sm:text-2xl font-bold text-emerald-700 font-mono-num truncate">
              {formatMoney(metrics.netProfit, settings.currency)}
            </div>
            <div className="text-[11px] sm:text-xs text-slate-500 truncate">
              ربح اليوم:{' '}
              <span className="font-mono-num font-semibold text-slate-800">
                {formatMoney(metrics.todayProfit, settings.currency)}
              </span>
            </div>
          </div>
        ) : (
          <div className="ui-card p-3.5 sm:p-4 space-y-2">
            <div className="flex items-center justify-between gap-2 text-[11px] sm:text-xs font-medium text-slate-500">
              <span className="truncate">فواتيري المسجلة</span>
              <span className="w-7 h-7 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center shrink-0">
                <FileText className="w-4 h-4" />
              </span>
            </div>
            <div className="text-lg sm:text-2xl font-bold text-slate-900 font-mono-num">
              {sales.length}
            </div>
            <div className="text-[11px] sm:text-xs text-slate-500 truncate">
              إجمالي العمليات بحسابك
            </div>
          </div>
        )}

        {canViewFinances && (
          <div className="ui-card p-3.5 sm:p-4 space-y-2">
            <div className="flex items-center justify-between gap-2 text-[11px] sm:text-xs font-medium text-slate-500">
              <span className="truncate">الصندوق النقدي</span>
              <span className="w-7 h-7 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
                <Wallet className="w-4 h-4" />
              </span>
            </div>
            <div className="text-lg sm:text-2xl font-bold text-slate-900 font-mono-num truncate">
              {formatMoney(counters.cashBalance, settings.currency)}
            </div>
            <div className="text-[11px] sm:text-xs text-slate-500 truncate">
              المصروفات:{' '}
              <span className="font-mono-num font-semibold text-red-700">
                {formatMoney(metrics.totalExpenses, settings.currency)}
              </span>
            </div>
          </div>
        )}

        <div className="ui-card p-3.5 sm:p-4 space-y-2">
          <div className="flex items-center justify-between gap-2 text-[11px] sm:text-xs font-medium text-slate-500">
            <span className="truncate">قيمة المخزون (تكلفة)</span>
            <span className="w-7 h-7 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
              <Package className="w-4 h-4" />
            </span>
          </div>
          <div className="text-lg sm:text-2xl font-bold text-slate-900 font-mono-num truncate">
            {formatMoney(metrics.inventoryCostValue, settings.currency)}
          </div>
          <div className="text-[11px] sm:text-xs text-slate-500 truncate">
            الأصناف:{' '}
            <span className="font-mono-num font-semibold text-slate-800">
              {products.length}
            </span>{' '}
            · منخفض:{' '}
            <span className="font-mono-num font-semibold text-amber-700">
              {metrics.lowStockProducts.length}
            </span>
          </div>
        </div>

        <div className="ui-card p-3.5 sm:p-4 space-y-2">
          <div className="flex items-center justify-between gap-2 text-[11px] sm:text-xs font-medium text-slate-500">
            <span className="truncate">ديون العملاء المستحقة</span>
            <span className="w-7 h-7 rounded-lg bg-red-50 text-red-700 flex items-center justify-center shrink-0">
              <Users className="w-4 h-4" />
            </span>
          </div>
          <div className="text-lg sm:text-2xl font-bold text-red-700 font-mono-num truncate">
            {formatMoney(metrics.customerDebts, settings.currency)}
          </div>
          <div className="text-[11px] sm:text-xs text-slate-500">
            العملاء:{' '}
            <span className="font-mono-num font-semibold text-slate-800">
              {customers.length}
            </span>
          </div>
        </div>

        {canViewFinances && (
          <div className="ui-card p-3.5 sm:p-4 space-y-2">
            <div className="flex items-center justify-between gap-2 text-[11px] sm:text-xs font-medium text-slate-500">
              <span className="truncate">مستحقات الموردين</span>
              <span className="w-7 h-7 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center shrink-0">
                <FileText className="w-4 h-4" />
              </span>
            </div>
            <div className="text-lg sm:text-2xl font-bold text-slate-900 font-mono-num truncate">
              {formatMoney(metrics.supplierPayables, settings.currency)}
            </div>
            <div className="text-[11px] sm:text-xs text-slate-500">
              الموردون:{' '}
              <span className="font-mono-num font-semibold text-slate-800">
                {suppliers.length}
              </span>
            </div>
          </div>
        )}

        {isAdmin && (
          <button
            type="button"
            onClick={() => onNavigate('staff', 'devices')}
            className="ui-card-interactive p-3.5 sm:p-4 space-y-2 text-right cursor-pointer"
          >
            <div className="flex items-center justify-between gap-2 text-[11px] sm:text-xs font-medium text-slate-500">
              <span className="truncate">الأجهزة المتصلة</span>
              <span className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
                <MonitorSmartphone className="w-4 h-4" />
              </span>
            </div>
            <div className="text-lg sm:text-2xl font-bold text-slate-900 font-mono-num">
              {devices.filter((d) => d.status === 'active').length}
              <span className="text-xs font-normal text-slate-400 mr-1.5">
                / {devices.length}
              </span>
            </div>
            <div className="text-[11px] sm:text-xs text-slate-500 truncate">
              محظور:{' '}
              <span className="font-mono-num font-semibold text-red-700">
                {devices.filter((d) => d.status === 'blocked').length}
              </span>
              {pendingOperations.length > 0 && (
                <>
                  {' '}
                  · معلق:{' '}
                  <span className="font-mono-num font-semibold text-amber-700">
                    {pendingOperations.length}
                  </span>
                </>
              )}
            </div>
          </button>
        )}
      </div>

      {/* Alerts + Top Products + Employee Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 sm:gap-6">
        {/* Recent Sales Live Feed */}
        <div className="lg:col-span-2 ui-card overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-4 sm:px-5 py-3.5 border-b border-slate-200/80">
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-bold text-slate-900">
                آخر عمليات البيع (مباشر)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5 truncate">
                اضغط على أي عملية لعرض تفاصيل الفاتورة كاملة والأصناف والموظف
              </p>
            </div>
            <span className="text-xs font-mono-num font-semibold text-slate-500 shrink-0">
              {sales.length} فاتورة
            </span>
          </div>

          {sales.length === 0 ? (
            <div className="p-8 sm:p-10 text-center space-y-3">
              <p className="text-sm text-slate-500">لا توجد عمليات بيع مسجلة حتى الآن.</p>
              <button
                type="button"
                onClick={() => onNavigate('pos')}
                className="ui-btn-primary text-xs"
              >
                تسجيل أول فاتورة بيع
              </button>
            </div>
          ) : (
            <>
              {/* Mobile Card Feed */}
              <div className="md:hidden divide-y divide-slate-100">
                {sales.slice(0, 12).map((sale) => (
                  <button
                    key={sale.id}
                    type="button"
                    onClick={() => setSelectedSale(sale)}
                    className="w-full text-right p-3.5 hover:bg-slate-50 active:bg-slate-100/80 transition-colors cursor-pointer space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono-num font-bold text-sm text-slate-900">
                        {sale.invoiceNumber}
                      </span>
                      <span className="font-mono-num font-bold text-sm text-emerald-700">
                        {formatMoney(sale.total, settings.currency)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-xs text-slate-600">
                      <span className="font-medium text-slate-800 truncate">
                        {sale.customerName} · {sale.items.length} صنف
                      </span>
                      <span
                        className={`font-semibold shrink-0 ${
                          sale.isOfflinePending
                            ? 'text-amber-700'
                            : sale.status === 'cancelled'
                            ? 'text-red-700'
                            : sale.status === 'completed'
                            ? 'text-emerald-700'
                            : 'text-amber-700'
                        }`}
                      >
                        {sale.isOfflinePending ? 'قيد المزامنة' : saleStatusLabel(sale.status)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
                      <span className="truncate">
                        {sale.employeeName} · {paymentMethodLabel(sale.paymentMethod)}
                      </span>
                      <span className="font-mono-num shrink-0">
                        {formatDateTime(sale.createdAt)}
                      </span>
                    </div>
                  </button>
                ))}
              </div>

              {/* Desktop Table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50/90 border-b border-slate-200 text-xs text-slate-600">
                    <tr>
                      <th className="text-right py-2.5 px-4 font-semibold">الفاتورة</th>
                      <th className="text-right py-2.5 px-4 font-semibold">الموظف</th>
                      <th className="text-right py-2.5 px-4 font-semibold">العميل</th>
                      <th className="text-left py-2.5 px-4 font-semibold">الإجمالي</th>
                      <th className="text-left py-2.5 px-4 font-semibold">المدفوع / المتبقي</th>
                      <th className="text-right py-2.5 px-4 font-semibold">الحالة</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {sales.slice(0, 12).map((sale) => (
                      <tr
                        key={sale.id}
                        onClick={() => setSelectedSale(sale)}
                        className="hover:bg-emerald-50/40 transition-colors cursor-pointer"
                      >
                        <td className="py-3 px-4">
                          <div className="font-mono-num font-semibold text-slate-900">
                            {sale.invoiceNumber}
                          </div>
                          <div className="text-xs text-slate-500">
                            {formatDateTime(sale.createdAt)}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="text-slate-700">{sale.employeeName}</div>
                          {sale.deviceName && (
                            <div className="text-[11px] text-slate-400">
                              {sale.deviceName}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          <div className="text-slate-900 font-medium">{sale.customerName}</div>
                          <div className="text-xs text-slate-500">
                            {sale.items.length} صنف · {paymentMethodLabel(sale.paymentMethod)}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-left font-mono-num font-bold text-slate-900">
                          {formatMoney(sale.total, settings.currency)}
                        </td>
                        <td className="py-3 px-4 text-left font-mono-num text-xs">
                          <div className="text-emerald-700 font-semibold">
                            مدفوع: {formatMoney(sale.paidAmount, settings.currency)}
                          </div>
                          {sale.remainingAmount > 0 && (
                            <div className="text-red-700">
                              متبقي: {formatMoney(sale.remainingAmount, settings.currency)}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 text-xs font-semibold">
                          {sale.isOfflinePending ? (
                            <span className="text-amber-700">قيد المزامنة</span>
                          ) : (
                            <span
                              className={
                                sale.status === 'cancelled'
                                  ? 'text-red-700'
                                  : sale.status === 'completed'
                                  ? 'text-emerald-700'
                                  : 'text-amber-700'
                              }
                            >
                              {saleStatusLabel(sale.status)}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        {/* Right Side: Stock Alerts & Top Products */}
        <div className="space-y-5">
          {/* Low stock alerts */}
          <div className="ui-card overflow-hidden">
            <div className="flex items-center justify-between px-4 sm:px-5 py-3.5 border-b border-slate-200/80">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                <h2 className="text-sm font-bold text-slate-900">تنبيهات المخزون</h2>
              </div>
              <button
                type="button"
                onClick={() => onNavigate('inventory')}
                className="text-xs font-semibold text-emerald-700 hover:underline cursor-pointer"
              >
                فتح المخزون
              </button>
            </div>
            {metrics.lowStockProducts.length === 0 ? (
              <div className="p-5 text-xs text-slate-500">
                جميع الأصناف متوفرة فوق الحد الأدنى.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
                {metrics.lowStockProducts.slice(0, 8).map((p) => (
                  <div
                    key={p.id}
                    className="px-4 sm:px-5 py-3 flex items-center justify-between gap-2 text-sm"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900 truncate">{p.name}</div>
                      <div className="text-xs text-slate-500 font-mono-num">
                        كود: {p.code} · الحد الأدنى: {p.minStock}
                      </div>
                    </div>
                    <div
                      className={`font-mono-num font-bold text-xs sm:text-sm shrink-0 ${
                        p.stock === 0 ? 'text-red-700' : 'text-amber-700'
                      }`}
                    >
                      {p.stock === 0 ? 'نفد (0)' : `${formatNumber(p.stock)} ${p.unit}`}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Top selling products */}
          <div className="ui-card overflow-hidden">
            <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200/80">
              <h2 className="text-sm font-bold text-slate-900">الأصناف الأكثر مبيعاً</h2>
            </div>
            {metrics.topProducts.length === 0 ? (
              <div className="p-5 text-xs text-slate-500">لا توجد بيانات مبيعات بعد.</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {metrics.topProducts.map((tp, idx) => (
                  <div
                    key={tp.code}
                    className="px-4 sm:px-5 py-2.5 flex items-center justify-between gap-2 text-sm"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="text-xs font-mono-num font-semibold text-slate-400 w-4 shrink-0">
                        {idx + 1}.
                      </span>
                      <div className="truncate">
                        <div className="font-medium text-slate-900 truncate">{tp.name}</div>
                        <div className="text-xs font-mono-num text-slate-500">{tp.code}</div>
                      </div>
                    </div>
                    <div className="text-left shrink-0">
                      <div className="font-mono-num font-semibold text-slate-900 text-xs sm:text-sm">
                        {formatNumber(tp.qty)} وحدة
                      </div>
                      <div className="text-xs font-mono-num text-emerald-700 font-medium">
                        {formatMoney(tp.revenue, settings.currency)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Admin Only: Employee Activity & Recent Audit Alerts */}
      {isAdmin && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 sm:gap-6">
          <div className="ui-card overflow-hidden">
            <div className="flex items-center justify-between px-4 sm:px-5 py-3.5 border-b border-slate-200/80">
              <h2 className="text-sm font-bold text-slate-900">نشاط الموظفين</h2>
              <button
                type="button"
                onClick={() => onNavigate('staff', 'staff')}
                className="text-xs font-semibold text-emerald-700 hover:underline cursor-pointer"
              >
                إدارة الموظفين
              </button>
            </div>
            {metrics.employeeActivity.length === 0 ? (
              <div className="p-5 text-xs text-slate-500">لا يوجد نشاط مسجل بعد.</div>
            ) : (
              <>
                <div className="md:hidden divide-y divide-slate-100">
                  {metrics.employeeActivity.map((emp) => (
                    <div
                      key={emp.employeeId}
                      className="p-3.5 flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="font-bold text-slate-900 truncate">
                          {emp.employeeName}
                        </div>
                        <div className="text-slate-500 mt-0.5">
                          {emp.count} فاتورة · {formatDateTime(emp.lastAt)}
                        </div>
                      </div>
                      <div className="font-mono-num font-bold text-emerald-700 shrink-0">
                        {formatMoney(emp.total, settings.currency)}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50/90 border-b border-slate-200 text-xs text-slate-600">
                      <tr>
                        <th className="text-right py-2 px-4 font-semibold">الموظف</th>
                        <th className="text-center py-2 px-4 font-semibold">الفواتير</th>
                        <th className="text-left py-2 px-4 font-semibold">إجمالي المبيعات</th>
                        <th className="text-left py-2 px-4 font-semibold">آخر عملية</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {metrics.employeeActivity.map((emp) => (
                        <tr key={emp.employeeId} className="hover:bg-slate-50/70">
                          <td className="py-2.5 px-4 font-medium text-slate-900">
                            {emp.employeeName}
                          </td>
                          <td className="py-2.5 px-4 text-center font-mono-num">
                            {emp.count}
                          </td>
                          <td className="py-2.5 px-4 text-left font-mono-num font-semibold text-emerald-700">
                            {formatMoney(emp.total, settings.currency)}
                          </td>
                          <td className="py-2.5 px-4 text-left text-xs text-slate-500">
                            {formatDateTime(emp.lastAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>

          <div className="ui-card overflow-hidden">
            <div className="flex items-center justify-between px-4 sm:px-5 py-3.5 border-b border-slate-200/80">
              <h2 className="text-sm font-bold text-slate-900">أحدث سجلات المراقبة والتدقيق</h2>
              <button
                type="button"
                onClick={() => onNavigate('staff', 'audit')}
                className="text-xs font-semibold text-emerald-700 hover:underline cursor-pointer"
              >
                عرض السجل الكامل
              </button>
            </div>
            {auditLogs.length === 0 ? (
              <div className="p-5 text-xs text-slate-500">لا توجد سجلات تدقيق بعد.</div>
            ) : (
              <div className="divide-y divide-slate-100 max-h-64 overflow-y-auto">
                {auditLogs.slice(0, 8).map((log) => (
                  <div key={log.id} className="px-4 sm:px-5 py-3 text-xs space-y-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900">
                        {log.action} · {log.actorName}
                        {log.deviceName ? (
                          <span className="text-slate-500 font-normal">
                            {' '}({log.deviceName})
                          </span>
                        ) : null}
                      </span>
                      <span className="text-slate-400 font-mono-num">
                        {formatDateTime(log.createdAt)}
                      </span>
                    </div>
                    <p className="text-slate-600">{log.summary}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <InvoiceDetailModal
        sale={selectedSale}
        onClose={() => setSelectedSale(null)}
        showProfit={isAdmin}
      />
    </div>
  );
};
