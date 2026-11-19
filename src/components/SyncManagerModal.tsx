import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  CloudOff,
  Database,
  RefreshCw,
  Trash2,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useBackLayer } from '../contexts/NavigationContext';
import { useStoreData } from '../contexts/StoreDataContext';
import type { PendingOperationType } from '../types';
import { formatDateTime } from '../utils/format';
import { ModalSubPageHeader } from './UnifiedBackHeader';

interface SyncManagerModalProps {
  open: boolean;
  onClose: () => void;
}

export function getPendingTypeLabel(t: PendingOperationType): string {
  switch (t) {
    case 'sale':
      return 'فاتورة مبيعات';
    case 'purchase':
      return 'فاتورة مشتريات';
    case 'return':
      return 'مرتجع عميل';
    case 'voucher':
      return 'سند قبض/صرف';
    case 'expense':
      return 'مصروف تشغيلي';
    case 'stock_adjust':
      return 'تعديل/جرد مخزون';
    case 'cash_adjust':
      return 'حركة صندوق يدوية';
    case 'product_create':
      return 'إضافة صنف جديد';
    case 'product_update':
      return 'تعديل بيانات صنف';
    case 'product_delete':
      return 'حذف صنف';
    case 'customer_create':
      return 'إضافة عميل جديد';
    case 'customer_update':
      return 'تعديل بيانات عميل';
    case 'supplier_create':
      return 'إضافة مورد جديد';
    case 'supplier_update':
      return 'تعديل بيانات مورد';
    case 'sale_cancel':
      return 'إلغاء فاتورة مبيعات';
  }
}

export const SyncManagerModal: React.FC<SyncManagerModalProps> = ({ open, onClose }) => {
  const {
    syncStatus,
    pendingOperations,
    allQueueOperations,
    flushPendingQueue,
    resolveConflictOperation,
  } = useStoreData();

  const [tab, setTab] = useState<'pending' | 'synced'>('pending');
  const [confirmDiscardId, setConfirmDiscardId] = useState<string | null>(null);

  const requestBack = useBackLayer({
    id: 'sync-manager',
    active: open,
    onClose,
  });

  const syncedOperations = useMemo(
    () =>
      allQueueOperations
        .filter((op) => op.status === 'synced')
        .slice()
        .reverse(),
    [allQueueOperations]
  );

  if (!open) return null;

  const unsyncedTotal = syncStatus.pendingCount + syncStatus.conflictCount;

  const dbEngineLabel =
    syncStatus.localDbEngine === 'sqlite'
      ? 'SQLite محلي دائم (Android)'
      : syncStatus.localDbEngine === 'indexeddb'
      ? 'IndexedDB محلي دائم'
      : 'ذاكرة محلية';

  const overallSyncLabel = syncStatus.isSyncing
    ? 'جاري المزامنة مع السحابة...'
    : syncStatus.conflictCount > 0
    ? `يوجد ${syncStatus.conflictCount} تعارض يتطلب معالجة`
    : syncStatus.pendingCount > 0
    ? syncStatus.isOnline
      ? 'جاهز للترحيل إلى Firebase'
      : 'بانتظار عودة الاتصال بالإنترنت'
    : 'جميع العمليات متزامنة بالكامل';

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 overflow-y-auto no-print">
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-3xl overflow-hidden shadow-xl">
        <ModalSubPageHeader
          title="إدارة المزامنة والعمل دون اتصال"
          subtitle="حفظ فوري في قاعدة البيانات المحلية الدائمة وترحيل دقيق إلى Firebase دون تكرار"
          onBack={requestBack}
        />

        <div className="p-5 space-y-4">
          {/* Status Cards Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div
              className={`p-3 rounded-xl border ${
                syncStatus.isOnline
                  ? 'bg-emerald-50/60 border-emerald-200 text-emerald-900'
                  : 'bg-amber-50 border-amber-200 text-amber-900'
              }`}
            >
              <div className="flex items-center gap-1.5 font-semibold">
                {syncStatus.isOnline ? (
                  <Wifi className="w-4 h-4 text-emerald-700 shrink-0" />
                ) : (
                  <WifiOff className="w-4 h-4 text-amber-700 shrink-0" />
                )}
                <span>حالة الإنترنت</span>
              </div>
              <div className="text-sm font-bold mt-1">
                {syncStatus.isOnline ? 'متصل بالإنترنت' : 'غير متصل'}
              </div>
              <div className="text-[11px] opacity-80 mt-0.5">
                وضع النظام:{' '}
                {syncStatus.systemMode === 'online' ? 'متصل بالسحابة' : 'يعمل دون اتصال'}
              </div>
            </div>

            <div className="p-3 rounded-xl border border-slate-200 bg-slate-50">
              <div className="flex items-center gap-1.5 font-semibold text-slate-700">
                <CloudOff className="w-4 h-4 text-amber-700 shrink-0" />
                <span>العمليات غير المرحّلة</span>
              </div>
              <div
                className={`text-lg font-bold font-mono-num mt-1 ${
                  unsyncedTotal > 0 ? 'text-amber-700' : 'text-slate-900'
                }`}
              >
                {unsyncedTotal}
              </div>
              <div className="text-[11px] text-slate-500">
                بانتظار الترحيل: {syncStatus.pendingCount} · تعارض: {syncStatus.conflictCount}
              </div>
            </div>

            <div className="p-3 rounded-xl border border-slate-200 bg-slate-50">
              <div className="flex items-center gap-1.5 font-semibold text-slate-700">
                <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                <span>العمليات المرحّلة</span>
              </div>
              <div className="text-lg font-bold font-mono-num text-emerald-700 mt-1">
                {syncStatus.totalSyncedEver}
              </div>
              <div className="text-[11px] text-slate-500 truncate">
                سجل محلي محفوظ: {syncStatus.syncedCount}
              </div>
            </div>

            <div className="p-3 rounded-xl border border-slate-200 bg-slate-50">
              <div className="flex items-center gap-1.5 font-semibold text-slate-700">
                <Clock className="w-4 h-4 text-slate-600 shrink-0" />
                <span>آخر مزامنة ناجحة</span>
              </div>
              <div className="text-xs font-bold font-mono-num text-slate-900 mt-1.5">
                {syncStatus.lastSuccessfulSyncIso
                  ? formatDateTime(syncStatus.lastSuccessfulSyncIso)
                  : 'لم تتم بعد'}
              </div>
              <div className="flex items-center gap-1 text-[11px] text-slate-500 mt-0.5 truncate">
                <Database className="w-3 h-3 shrink-0" />
                <span className="truncate">{dbEngineLabel}</span>
              </div>
            </div>
          </div>

          {/* Sync Status Banner + Sync Now Button */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl border border-slate-200 bg-slate-50">
            <div className="space-y-0.5">
              <div className="text-xs font-bold text-slate-900 flex items-center gap-2">
                <span>حالة المزامنة:</span>
                <span
                  className={
                    syncStatus.conflictCount > 0
                      ? 'text-red-700'
                      : syncStatus.pendingCount > 0
                      ? 'text-amber-700'
                      : 'text-emerald-700'
                  }
                >
                  {overallSyncLabel}
                </span>
              </div>
              {syncStatus.lastSyncError && (
                <div className="text-[11px] text-red-700 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>{syncStatus.lastSyncError}</span>
                </div>
              )}
            </div>

            <button
              type="button"
              disabled={!syncStatus.isOnline || syncStatus.isSyncing}
              onClick={() => void flushPendingQueue()}
              className="inline-flex items-center gap-1.5 px-4 py-2 bg-emerald-700 hover:bg-emerald-800 disabled:bg-slate-300 text-white text-xs font-semibold rounded-xl cursor-pointer whitespace-nowrap"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${syncStatus.isSyncing ? 'animate-spin' : ''}`}
              />
              <span>{syncStatus.isSyncing ? 'جاري المزامنة...' : 'مزامنة الآن'}</span>
            </button>
          </div>

          {/* Tabs */}
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl w-fit">
            <button
              type="button"
              onClick={() => setTab('pending')}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg cursor-pointer ${
                tab === 'pending' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              غير المرحّلة ({pendingOperations.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('synced')}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg cursor-pointer ${
                tab === 'synced' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600'
              }`}
            >
              العمليات المرحّلة ({syncedOperations.length})
            </button>
          </div>

          {/* Operations List */}
          {tab === 'pending' ? (
            pendingOperations.length === 0 ? (
              <div className="py-10 text-center text-sm text-slate-500 border border-dashed border-slate-200 rounded-xl">
                جميع العمليات متزامنة مع السحابة ولا توجد عمليات معلقة.
              </div>
            ) : (
              <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl max-h-80 overflow-y-auto">
                {pendingOperations.map((op) => {
                  const isStocktakeConflict =
                    op.status === 'conflict' &&
                    op.type === 'stock_adjust' &&
                    op.payload.mode === 'stocktake';
                  const isEntityUpdateConflict =
                    op.status === 'conflict' &&
                    (op.type === 'product_update' ||
                      op.type === 'customer_update' ||
                      op.type === 'supplier_update');

                  return (
                    <div key={op.operationId} className="p-4 space-y-2 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="font-semibold text-slate-900">
                          {getPendingTypeLabel(op.type)} ·{' '}
                          <span className="font-mono-num text-emerald-700">
                            {op.localTempRef}
                          </span>
                        </div>
                        <span
                          className={`font-semibold px-2 py-0.5 rounded-md ${
                            op.status === 'conflict'
                              ? 'bg-red-50 text-red-700'
                              : op.status === 'syncing'
                              ? 'bg-blue-50 text-blue-700'
                              : 'bg-amber-50 text-amber-800'
                          }`}
                        >
                          {op.status === 'conflict'
                            ? 'تعارض يتطلب معالجة'
                            : op.status === 'syncing'
                            ? 'جاري المزامنة...'
                            : 'بانتظار الترحيل'}
                        </span>
                      </div>

                      <div className="text-slate-700 font-medium">{op.summary}</div>
                      <div className="text-slate-400">
                        {formatDateTime(op.createdAtIso)} · الموظف: {op.actor.name} · الجهاز:{' '}
                        {op.actor.deviceName} · المحاولات: {op.attempts}
                      </div>

                      {op.errorMessage && (
                        <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-700 flex items-start gap-2">
                          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                          <span>{op.errorMessage}</span>
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        {syncStatus.isOnline && (
                          <button
                            type="button"
                            onClick={() =>
                              void resolveConflictOperation(op.operationId, 'retry')
                            }
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-700 text-white rounded-lg cursor-pointer"
                          >
                            <RefreshCw className="w-3 h-3" />
                            <span>إعادة المحاولة</span>
                          </button>
                        )}

                        {syncStatus.isOnline && isStocktakeConflict && (
                          <button
                            type="button"
                            onClick={() =>
                              void resolveConflictOperation(op.operationId, 'apply_delta')
                            }
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-600 text-white rounded-lg cursor-pointer"
                          >
                            <span>تطبيق فرق الجرد على الرصيد الحالي</span>
                          </button>
                        )}

                        {syncStatus.isOnline &&
                          (isStocktakeConflict || isEntityUpdateConflict) && (
                            <button
                              type="button"
                              onClick={() =>
                                void resolveConflictOperation(op.operationId, 'force_apply')
                              }
                              className="inline-flex items-center gap-1 px-2.5 py-1 bg-slate-800 text-white rounded-lg cursor-pointer"
                            >
                              <span>اعتماد التعديل المحلي قسراً</span>
                            </button>
                          )}

                        {confirmDiscardId === op.operationId ? (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setConfirmDiscardId(null);
                                void resolveConflictOperation(op.operationId, 'discard');
                              }}
                              className="px-2.5 py-1 bg-red-600 text-white rounded-lg font-semibold cursor-pointer"
                            >
                              تأكيد الإلغاء والحذف
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDiscardId(null)}
                              className="px-2 py-1 border border-slate-200 rounded-lg text-slate-600 cursor-pointer"
                            >
                              تراجع
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDiscardId(op.operationId)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-red-700 bg-red-50 border border-red-200 rounded-lg cursor-pointer"
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>حذف من الانتظار</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          ) : syncedOperations.length === 0 ? (
            <div className="py-10 text-center text-sm text-slate-500 border border-dashed border-slate-200 rounded-xl">
              لم يتم ترحيل عمليات محلية مسجلة بعد في هذا السجل.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl max-h-80 overflow-y-auto">
              {syncedOperations.map((op) => (
                <div key={op.operationId} className="p-3.5 space-y-1 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="font-semibold text-slate-900">
                      {getPendingTypeLabel(op.type)} ·{' '}
                      <span className="font-mono-num text-emerald-700">
                        {op.resolvedReferenceNumber || op.localTempRef}
                      </span>
                    </div>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 font-semibold">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>تمت المزامنة</span>
                    </span>
                  </div>
                  <div className="text-slate-700">{op.summary}</div>
                  <div className="text-slate-400">
                    أُنشئت: {formatDateTime(op.createdAtIso)}
                    {op.syncedAtIso ? ` · رُحّلت: ${formatDateTime(op.syncedAtIso)}` : ''} ·{' '}
                    {op.actor.name}
                  </div>
                </div>
              ))}
            </div>
          )}

        </div>
      </div>
    </div>
  );
};
