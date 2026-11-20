import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Capacitor } from '@capacitor/core';
import { Network } from '@capacitor/network';
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { flushSinglePendingOperation } from '../services/accountingService';
import { localDbService } from '../services/localDbService';
import {
  projectStoreWithPendingOps,
  type StoreBaselineData,
} from '../services/localProjectionService';
import {
  computeReservedStockMap,
  getSyncMetaCache,
  initOfflineQueue,
  isAppOnline,
  isNetworkOrOfflineError,
  loadAllQueueOperations,
  loadPendingOperations,
  markOperationSynced,
  PENDING_OPS_EVENT,
  refreshNativeNetworkStatus,
  removePendingOperation,
  setNetworkOnlineState,
  SYNC_META_EVENT,
  updatePendingOperation,
  updateSyncMeta,
} from '../services/offlineQueueService';
import { useAuth } from './AuthContext';
import { normalizeBarcode } from '../utils/barcode';
import type {
  AuditLog,
  CashTransaction,
  ConflictResolutionStrategy,
  Counters,
  Customer,
  DeviceRecord,
  Expense,
  LocalDbEngine,
  PendingOperation,
  Product,
  PurchaseInvoice,
  SaleInvoice,
  SalesReturn,
  StaffInvite,
  StockMovement,
  StoreSettings,
  Supplier,
  SyncMetaState,
  SyncStatusSummary,
  UserProfile,
  Voucher,
} from '../types';

interface StoreDataContextValue {
  settings: StoreSettings;
  counters: Counters;
  products: Product[];
  customers: Customer[];
  suppliers: Supplier[];
  sales: SaleInvoice[];
  purchases: PurchaseInvoice[];
  returns: SalesReturn[];
  stockMovements: StockMovement[];
  expenses: Expense[];
  vouchers: Voucher[];
  cashTransactions: CashTransaction[];
  auditLogs: AuditLog[];
  staffUsers: UserProfile[];
  staffInvites: StaffInvite[];
  devices: DeviceRecord[];
  pendingOperations: PendingOperation[];
  allQueueOperations: PendingOperation[];
  reservedStockByProductId: Map<string, number>;
  isSyncingQueue: boolean;
  syncNotice: string | null;
  recentSaleAlert: string | null;
  syncStatus: SyncStatusSummary;
  dismissSyncNotice: () => void;
  dismissSaleAlert: () => void;
  flushPendingQueue: () => Promise<void>;
  retryPendingOperation: (operationId: string) => Promise<void>;
  discardPendingOperation: (operationId: string) => void;
  resolveConflictOperation: (
    operationId: string,
    strategy: ConflictResolutionStrategy
  ) => Promise<void>;
  dataLoading: boolean;
  isOnline: boolean;
  hasPendingSync: boolean;
  productByCode: Map<string, Product>;
  productById: Map<string, Product>;
  customerById: Map<string, Customer>;
  supplierById: Map<string, Supplier>;
}

const DEFAULT_SETTINGS: StoreSettings = {
  storeName: 'بقالة الحسام',
  phone: '',
  address: '',
  contactInfo: '',
  promoText: '',
  currency: 'ر.ي',
  receiptFooter: 'شكراً لتسوقكم من بقالة الحسام',
  logoMode: 'default',
  logoDataUrl: '',
  defaultPaperSize: 'a4',
  showCustomerInfo: true,
  showSellerInfo: true,
  showProductCode: true,
  showDiscount: true,
  showQrCode: true,
  updatedAt: null,
};

const DEFAULT_COUNTERS: Counters = {
  nextProductSeq: 1001,
  nextCustomerSeq: 1001,
  nextSupplierSeq: 1001,
  nextInvoiceSeq: 1,
  nextPurchaseSeq: 1,
  nextReturnSeq: 1,
  nextVoucherSeq: 1,
  cashBalance: 0,
  updatedAt: null,
};

const EMPTY_BASELINE: StoreBaselineData = {
  counters: DEFAULT_COUNTERS,
  products: [],
  customers: [],
  suppliers: [],
  sales: [],
  purchases: [],
  returns: [],
  stockMovements: [],
  expenses: [],
  vouchers: [],
  cashTransactions: [],
  auditLogs: [],
};

const StoreDataContext = createContext<StoreDataContextValue | null>(null);

export const StoreDataProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const {
    firebaseUser,
    profile,
    isAdmin,
    isActiveStaff,
    isDeviceBlocked,
    deviceIdentity,
    hasPermission,
    ensureDeviceRegistered,
  } = useAuth();

  const [settings, setSettings] = useState<StoreSettings>(DEFAULT_SETTINGS);
  const [baselineData, setBaselineData] = useState<StoreBaselineData>(EMPTY_BASELINE);
  const [staffUsers, setStaffUsers] = useState<UserProfile[]>([]);
  const [staffInvites, setStaffInvites] = useState<StaffInvite[]>([]);
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [isOnline, setIsOnline] = useState<boolean>(() => isAppOnline());
  const [localDbEngine, setLocalDbEngine] = useState<LocalDbEngine>(() =>
    localDbService.getEngineSync()
  );
  const [pendingMap, setPendingMap] = useState<Record<string, boolean>>({});
  const [allQueueOperations, setAllQueueOperations] = useState<PendingOperation[]>(() =>
    loadAllQueueOperations()
  );
  const [syncMeta, setSyncMeta] = useState<SyncMetaState>(() => getSyncMetaCache());
  const [idMap, setIdMap] = useState<
    Record<string, { referenceId: string; referenceNumber?: string }>
  >({});
  const [isSyncingQueue, setIsSyncingQueue] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [recentSaleAlert, setRecentSaleAlert] = useState<string | null>(null);

  const isFlushingRef = useRef(false);
  const seenSaleIdsRef = useRef<Set<string> | null>(null);
  const settingsCurrencyRef = useRef<string>(DEFAULT_SETTINGS.currency);
  const localHydratedRef = useRef(false);

  useEffect(() => {
    settingsCurrencyRef.current = settings.currency || 'ر.ي';
  }, [settings.currency]);

  // Initialize persistent local database + queue + network status listeners
  useEffect(() => {
    let cancelled = false;
    let networkListenerRemove: (() => Promise<void>) | null = null;

    const bootstrapLocal = async () => {
      await initOfflineQueue();
      const online = await refreshNativeNetworkStatus();
      if (cancelled) return;
      setLocalDbEngine(localDbService.getEngineSync());
      setIsOnline(online);
      setAllQueueOperations(loadAllQueueOperations());
      setSyncMeta(getSyncMetaCache());
      try {
        const storedIdMap = await localDbService.getIdMap();
        if (!cancelled) setIdMap(storedIdMap);
      } catch {
        // ignore idMap load failure
      }
    };

    void bootstrapLocal();

    const syncLocalQueue = () => {
      setAllQueueOperations(loadAllQueueOperations());
    };
    const syncLocalMeta = () => {
      setSyncMeta(getSyncMetaCache());
    };
    window.addEventListener(PENDING_OPS_EVENT, syncLocalQueue);
    window.addEventListener(SYNC_META_EVENT, syncLocalMeta);
    window.addEventListener('storage', syncLocalQueue);

    const onOnline = () => {
      setNetworkOnlineState(true);
      setIsOnline(true);
    };
    const onOffline = () => {
      setNetworkOnlineState(false);
      setIsOnline(false);
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    if (Capacitor.isNativePlatform()) {
      Network.addListener('networkStatusChange', (status) => {
        const connected = Boolean(status.connected);
        setNetworkOnlineState(connected);
        setIsOnline(connected);
      })
        .then((handle) => {
          networkListenerRemove = () => handle.remove();
        })
        .catch(() => {});
    }

    return () => {
      cancelled = true;
      window.removeEventListener(PENDING_OPS_EVENT, syncLocalQueue);
      window.removeEventListener(SYNC_META_EVENT, syncLocalMeta);
      window.removeEventListener('storage', syncLocalQueue);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      if (networkListenerRemove) {
        void networkListenerRemove().catch(() => {});
      }
    };
  }, []);

  const markPending = (key: string, pending: boolean) => {
    setPendingMap((prev) => {
      if (prev[key] === pending) return prev;
      return { ...prev, [key]: pending };
    });
  };

  const logSnapshotError = (err: unknown, operationType: OperationType, path: string) => {
    try {
      handleFirestoreError(err, operationType, path);
    } catch {
      // Diagnostic logging only; avoid crashing async onSnapshot listeners
    }
  };

  // Load durable local baseline + attach Firestore live listeners
  useEffect(() => {
    if (!firebaseUser || !isActiveStaff || isDeviceBlocked) {
      setBaselineData(EMPTY_BASELINE);
      setStaffUsers([]);
      setStaffInvites([]);
      setDevices([]);
      seenSaleIdsRef.current = null;
      localHydratedRef.current = false;
      setDataLoading(false);
      return;
    }

    let cancelled = false;
    setDataLoading(true);
    localHydratedRef.current = false;

    const hydrateBaselineFromLocalDb = async () => {
      try {
        await initOfflineQueue();
        const [
          savedSettings,
          savedCounters,
          savedProducts,
          savedCustomers,
          savedSuppliers,
          savedSales,
          savedPurchases,
          savedReturns,
          savedMovements,
          savedExpenses,
          savedVouchers,
          savedCashTx,
          savedAuditLogs,
          savedUsers,
          savedInvites,
          savedDevices,
          savedIdMap,
        ] = await Promise.all([
          localDbService.getCollection<StoreSettings & { id?: string }>('settings'),
          localDbService.getCollection<Counters & { id?: string }>('counters'),
          localDbService.getCollection<Product>('products'),
          localDbService.getCollection<Customer>('customers'),
          localDbService.getCollection<Supplier>('suppliers'),
          localDbService.getCollection<SaleInvoice>('sales'),
          localDbService.getCollection<PurchaseInvoice>('purchases'),
          localDbService.getCollection<SalesReturn>('returns'),
          localDbService.getCollection<StockMovement>('stock_movements'),
          localDbService.getCollection<Expense>('expenses'),
          localDbService.getCollection<Voucher>('vouchers'),
          localDbService.getCollection<CashTransaction>('cash_transactions'),
          localDbService.getCollection<AuditLog>('audit_logs'),
          localDbService.getCollection<UserProfile>('users'),
          localDbService.getCollection<StaffInvite>('staff_invites'),
          localDbService.getCollection<DeviceRecord>('devices'),
          localDbService.getIdMap(),
        ]);

        if (cancelled) return;
        localHydratedRef.current = true;
        setLocalDbEngine(localDbService.getEngineSync());
        setIdMap(savedIdMap);

        if (savedSettings.length > 0) {
          const s = savedSettings[0];
          setSettings({
            ...DEFAULT_SETTINGS,
            ...s,
            storeName: s.storeName || DEFAULT_SETTINGS.storeName,
            phone: s.phone || '',
            address: s.address || '',
            contactInfo: s.contactInfo || '',
            promoText: s.promoText || '',
            currency: s.currency === 'ر.س' ? 'ر.ي' : s.currency || 'ر.ي',
            receiptFooter: s.receiptFooter || DEFAULT_SETTINGS.receiptFooter,
            logoMode: s.logoMode || DEFAULT_SETTINGS.logoMode,
            logoDataUrl: s.logoDataUrl || '',
            defaultPaperSize: s.defaultPaperSize || DEFAULT_SETTINGS.defaultPaperSize,
            showCustomerInfo: s.showCustomerInfo ?? true,
            showSellerInfo: s.showSellerInfo ?? true,
            showProductCode: s.showProductCode ?? true,
            showDiscount: s.showDiscount ?? true,
            showQrCode: s.showQrCode ?? true,
            updatedAt: s.updatedAt || null,
          });
        }

        const hydratedCounters: Counters =
          savedCounters.length > 0
            ? {
                ...DEFAULT_COUNTERS,
                ...savedCounters[0],
              }
            : DEFAULT_COUNTERS;

        if (seenSaleIdsRef.current === null) {
          seenSaleIdsRef.current = new Set(savedSales.map((s) => s.id));
        }

        setBaselineData((prev) => ({
          counters: savedCounters.length > 0 ? hydratedCounters : prev.counters,
          products: savedProducts.length > 0 ? savedProducts : prev.products,
          customers: savedCustomers.length > 0 ? savedCustomers : prev.customers,
          suppliers: savedSuppliers.length > 0 ? savedSuppliers : prev.suppliers,
          sales: savedSales.length > 0 ? savedSales : prev.sales,
          purchases: savedPurchases.length > 0 ? savedPurchases : prev.purchases,
          returns: savedReturns.length > 0 ? savedReturns : prev.returns,
          stockMovements: savedMovements.length > 0 ? savedMovements : prev.stockMovements,
          expenses: savedExpenses.length > 0 ? savedExpenses : prev.expenses,
          vouchers: savedVouchers.length > 0 ? savedVouchers : prev.vouchers,
          cashTransactions: savedCashTx.length > 0 ? savedCashTx : prev.cashTransactions,
          auditLogs: savedAuditLogs.length > 0 ? savedAuditLogs : prev.auditLogs,
        }));

        if (savedUsers.length > 0) setStaffUsers(savedUsers);
        if (savedInvites.length > 0) setStaffInvites(savedInvites);
        if (savedDevices.length > 0) setDevices(savedDevices);

        if (savedProducts.length > 0 || savedSales.length > 0 || !isAppOnline()) {
          setDataLoading(false);
        }
      } catch (err) {
        console.warn('[AlHussamStore] Local baseline hydration notice:', err);
        if (!cancelled && !isAppOnline()) {
          setDataLoading(false);
        }
      }
    };

    void hydrateBaselineFromLocalDb();

    const shouldSkipEmptyOfflineCache = (
      fromCache: boolean,
      docCount: number,
      hasExistingLocal: boolean
    ): boolean => {
      return !isAppOnline() && fromCache && docCount === 0 && hasExistingLocal;
    };

    const unsubs: Unsubscribe[] = [];

    // Settings
    unsubs.push(
      onSnapshot(
        doc(db, 'settings', 'store'),
        (snap) => {
          if (snap.exists()) {
            const raw = snap.data() as StoreSettings;
            const resolved: StoreSettings = {
              ...DEFAULT_SETTINGS,
              ...raw,
              currency: raw.currency === 'ر.س' ? 'ر.ي' : raw.currency || 'ر.ي',
              receiptFooter: raw.receiptFooter || DEFAULT_SETTINGS.receiptFooter,
              logoMode: raw.logoMode || 'default',
              logoDataUrl: raw.logoDataUrl || '',
              defaultPaperSize: raw.defaultPaperSize || 'a4',
              showCustomerInfo: raw.showCustomerInfo ?? true,
              showSellerInfo: raw.showSellerInfo ?? true,
              showProductCode: raw.showProductCode ?? true,
              showDiscount: raw.showDiscount ?? true,
              showQrCode: raw.showQrCode ?? true,
            };
            setSettings(resolved);
            if (!snap.metadata.hasPendingWrites) {
              void localDbService.upsertEntity('settings', 'store', resolved).catch(() => {});
            }
          }
          markPending('settings', snap.metadata.hasPendingWrites);
        },
        (err) => logSnapshotError(err, OperationType.GET, 'settings/store')
      )
    );

    // Counters & cash balance
    unsubs.push(
      onSnapshot(
        doc(db, 'counters', 'main'),
        (snap) => {
          if (snap.exists()) {
            const nextCounters = snap.data() as Counters;
            setBaselineData((prev) => ({ ...prev, counters: nextCounters }));
            if (!snap.metadata.hasPendingWrites) {
              void localDbService.upsertEntity('counters', 'main', nextCounters).catch(() => {});
            }
          }
          markPending('counters', snap.metadata.hasPendingWrites);
        },
        (err) => logSnapshotError(err, OperationType.GET, 'counters/main')
      )
    );

    // Products
    unsubs.push(
      onSnapshot(
        query(collection(db, 'products'), orderBy('name', 'asc')),
        (snap) => {
          const rows = snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<Product, 'id'>),
          }));
          setBaselineData((prev) => {
            if (shouldSkipEmptyOfflineCache(snap.metadata.fromCache, rows.length, prev.products.length > 0)) {
              return prev;
            }
            if (!snap.metadata.hasPendingWrites && (!snap.metadata.fromCache || rows.length > 0)) {
              void localDbService.replaceCollection('products', rows).catch(() => {});
            }
            return { ...prev, products: rows };
          });
          markPending('products', snap.metadata.hasPendingWrites);
          setDataLoading(false);
        },
        (err) => {
          logSnapshotError(err, OperationType.LIST, 'products');
          setDataLoading(false);
        }
      )
    );

    // Customers
    unsubs.push(
      onSnapshot(
        query(collection(db, 'customers'), orderBy('createdAt', 'desc')),
        (snap) => {
          const rows = snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<Customer, 'id'>),
          }));
          setBaselineData((prev) => {
            if (shouldSkipEmptyOfflineCache(snap.metadata.fromCache, rows.length, prev.customers.length > 0)) {
              return prev;
            }
            if (!snap.metadata.hasPendingWrites && (!snap.metadata.fromCache || rows.length > 0)) {
              void localDbService.replaceCollection('customers', rows).catch(() => {});
            }
            return { ...prev, customers: rows };
          });
          markPending('customers', snap.metadata.hasPendingWrites);
        },
        (err) => logSnapshotError(err, OperationType.LIST, 'customers')
      )
    );

    // Suppliers
    unsubs.push(
      onSnapshot(
        query(collection(db, 'suppliers'), orderBy('createdAt', 'desc')),
        (snap) => {
          const rows = snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<Supplier, 'id'>),
          }));
          setBaselineData((prev) => {
            if (shouldSkipEmptyOfflineCache(snap.metadata.fromCache, rows.length, prev.suppliers.length > 0)) {
              return prev;
            }
            if (!snap.metadata.hasPendingWrites && (!snap.metadata.fromCache || rows.length > 0)) {
              void localDbService.replaceCollection('suppliers', rows).catch(() => {});
            }
            return { ...prev, suppliers: rows };
          });
          markPending('suppliers', snap.metadata.hasPendingWrites);
        },
        (err) => logSnapshotError(err, OperationType.LIST, 'suppliers')
      )
    );

    // Sales
    const canSeeAllSales = isAdmin || hasPermission('canViewAllSales');
    const salesQuery = canSeeAllSales
      ? query(collection(db, 'sales'), orderBy('createdAt', 'desc'))
      : query(collection(db, 'sales'), where('employeeId', '==', firebaseUser.uid));

    unsubs.push(
      onSnapshot(
        salesQuery,
        (snap) => {
          const rows = snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<SaleInvoice, 'id'>),
          }));
          if (!canSeeAllSales) {
            rows.sort(
              (a, b) =>
                (b.createdAt?.toMillis() ?? Date.now()) -
                (a.createdAt?.toMillis() ?? Date.now())
            );
          }

          if (seenSaleIdsRef.current === null) {
            seenSaleIdsRef.current = new Set(rows.map((r) => r.id));
          } else if (isAdmin) {
            const newlyArrived = rows.find(
              (r) =>
                !seenSaleIdsRef.current!.has(r.id) &&
                r.deviceId !== deviceIdentity.deviceId
            );
            for (const r of rows) {
              seenSaleIdsRef.current.add(r.id);
            }
            if (newlyArrived) {
              setRecentSaleAlert(
                `بيع فوري جديد: ${newlyArrived.invoiceNumber} — ${newlyArrived.employeeName} (${newlyArrived.deviceName || 'جهاز موظف'}) بقيمة ${newlyArrived.total.toLocaleString('en-US')} ${settingsCurrencyRef.current}`
              );
            }
          }

          setBaselineData((prev) => {
            if (shouldSkipEmptyOfflineCache(snap.metadata.fromCache, rows.length, prev.sales.length > 0)) {
              return prev;
            }
            if (!snap.metadata.hasPendingWrites && (!snap.metadata.fromCache || rows.length > 0)) {
              void localDbService.replaceCollection('sales', rows).catch(() => {});
            }
            return { ...prev, sales: rows };
          });
          markPending('sales', snap.metadata.hasPendingWrites);
        },
        (err) => logSnapshotError(err, OperationType.LIST, 'sales')
      )
    );

    // Returns
    const canSeeAllReturns =
      isAdmin || hasPermission('canViewAllSales') || hasPermission('canReturn');
    const returnsQuery = canSeeAllReturns
      ? query(collection(db, 'returns'), orderBy('createdAt', 'desc'))
      : query(collection(db, 'returns'), where('employeeId', '==', firebaseUser.uid));

    unsubs.push(
      onSnapshot(
        returnsQuery,
        (snap) => {
          const rows = snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<SalesReturn, 'id'>),
          }));
          if (!canSeeAllReturns) {
            rows.sort(
              (a, b) =>
                (b.createdAt?.toMillis() ?? Date.now()) -
                (a.createdAt?.toMillis() ?? Date.now())
            );
          }
          setBaselineData((prev) => {
            if (shouldSkipEmptyOfflineCache(snap.metadata.fromCache, rows.length, prev.returns.length > 0)) {
              return prev;
            }
            if (!snap.metadata.hasPendingWrites && (!snap.metadata.fromCache || rows.length > 0)) {
              void localDbService.replaceCollection('returns', rows).catch(() => {});
            }
            return { ...prev, returns: rows };
          });
          markPending('returns', snap.metadata.hasPendingWrites);
        },
        (err) => logSnapshotError(err, OperationType.LIST, 'returns')
      )
    );

    // Stock Movements
    unsubs.push(
      onSnapshot(
        query(collection(db, 'stock_movements'), orderBy('createdAt', 'desc')),
        (snap) => {
          const rows = snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<StockMovement, 'id'>),
          }));
          setBaselineData((prev) => {
            if (shouldSkipEmptyOfflineCache(snap.metadata.fromCache, rows.length, prev.stockMovements.length > 0)) {
              return prev;
            }
            if (!snap.metadata.hasPendingWrites && (!snap.metadata.fromCache || rows.length > 0)) {
              void localDbService.replaceCollection('stock_movements', rows).catch(() => {});
            }
            return { ...prev, stockMovements: rows };
          });
          markPending('stock_movements', snap.metadata.hasPendingWrites);
        },
        (err) => logSnapshotError(err, OperationType.LIST, 'stock_movements')
      )
    );

    // Vouchers
    unsubs.push(
      onSnapshot(
        query(collection(db, 'vouchers'), orderBy('createdAt', 'desc')),
        (snap) => {
          const rows = snap.docs.map((d) => ({
            id: d.id,
            ...(d.data() as Omit<Voucher, 'id'>),
          }));
          setBaselineData((prev) => {
            if (shouldSkipEmptyOfflineCache(snap.metadata.fromCache, rows.length, prev.vouchers.length > 0)) {
              return prev;
            }
            if (!snap.metadata.hasPendingWrites && (!snap.metadata.fromCache || rows.length > 0)) {
              void localDbService.replaceCollection('vouchers', rows).catch(() => {});
            }
            return { ...prev, vouchers: rows };
          });
          markPending('vouchers', snap.metadata.hasPendingWrites);
        },
        (err) => logSnapshotError(err, OperationType.LIST, 'vouchers')
      )
    );

    // Purchases
    if (isAdmin || hasPermission('canPurchase')) {
      unsubs.push(
        onSnapshot(
          query(collection(db, 'purchases'), orderBy('createdAt', 'desc')),
          (snap) => {
            const rows = snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<PurchaseInvoice, 'id'>),
            }));
            setBaselineData((prev) => {
              if (shouldSkipEmptyOfflineCache(snap.metadata.fromCache, rows.length, prev.purchases.length > 0)) {
                return prev;
              }
              if (!snap.metadata.hasPendingWrites && (!snap.metadata.fromCache || rows.length > 0)) {
                void localDbService.replaceCollection('purchases', rows).catch(() => {});
              }
              return { ...prev, purchases: rows };
            });
            markPending('purchases', snap.metadata.hasPendingWrites);
          },
          (err) => logSnapshotError(err, OperationType.LIST, 'purchases')
        )
      );
    }

    // Expenses
    if (isAdmin || hasPermission('canManageExpenses') || hasPermission('canViewReports')) {
      unsubs.push(
        onSnapshot(
          query(collection(db, 'expenses'), orderBy('createdAt', 'desc')),
          (snap) => {
            const rows = snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<Expense, 'id'>),
            }));
            setBaselineData((prev) => {
              if (shouldSkipEmptyOfflineCache(snap.metadata.fromCache, rows.length, prev.expenses.length > 0)) {
                return prev;
              }
              if (!snap.metadata.hasPendingWrites && (!snap.metadata.fromCache || rows.length > 0)) {
                void localDbService.replaceCollection('expenses', rows).catch(() => {});
              }
              return { ...prev, expenses: rows };
            });
            markPending('expenses', snap.metadata.hasPendingWrites);
          },
          (err) => logSnapshotError(err, OperationType.LIST, 'expenses')
        )
      );
    }

    // Cash Transactions
    if (isAdmin || hasPermission('canViewReports')) {
      unsubs.push(
        onSnapshot(
          query(collection(db, 'cash_transactions'), orderBy('createdAt', 'desc')),
          (snap) => {
            const rows = snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<CashTransaction, 'id'>),
            }));
            setBaselineData((prev) => {
              if (shouldSkipEmptyOfflineCache(snap.metadata.fromCache, rows.length, prev.cashTransactions.length > 0)) {
                return prev;
              }
              if (!snap.metadata.hasPendingWrites && (!snap.metadata.fromCache || rows.length > 0)) {
                void localDbService.replaceCollection('cash_transactions', rows).catch(() => {});
              }
              return { ...prev, cashTransactions: rows };
            });
            markPending('cash_transactions', snap.metadata.hasPendingWrites);
          },
          (err) => logSnapshotError(err, OperationType.LIST, 'cash_transactions')
        )
      );
    }

    // Admin-only collections
    if (isAdmin) {
      unsubs.push(
        onSnapshot(
          query(collection(db, 'audit_logs'), orderBy('createdAt', 'desc')),
          (snap) => {
            const rows = snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<AuditLog, 'id'>),
            }));
            setBaselineData((prev) => {
              if (shouldSkipEmptyOfflineCache(snap.metadata.fromCache, rows.length, prev.auditLogs.length > 0)) {
                return prev;
              }
              if (!snap.metadata.hasPendingWrites && (!snap.metadata.fromCache || rows.length > 0)) {
                void localDbService.replaceCollection('audit_logs', rows).catch(() => {});
              }
              return { ...prev, auditLogs: rows };
            });
          },
          (err) => logSnapshotError(err, OperationType.LIST, 'audit_logs')
        )
      );

      unsubs.push(
        onSnapshot(
          query(collection(db, 'users'), orderBy('createdAt', 'desc')),
          (snap) => {
            const rows = snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<UserProfile, 'id'>),
            }));
            setStaffUsers(rows);
            if (!snap.metadata.hasPendingWrites && (!snap.metadata.fromCache || rows.length > 0)) {
              void localDbService.replaceCollection('users', rows).catch(() => {});
            }
          },
          (err) => logSnapshotError(err, OperationType.LIST, 'users')
        )
      );

      unsubs.push(
        onSnapshot(
          query(collection(db, 'staff_invites'), orderBy('createdAt', 'desc')),
          (snap) => {
            const rows = snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<StaffInvite, 'id'>),
            }));
            setStaffInvites(rows);
            if (!snap.metadata.hasPendingWrites && (!snap.metadata.fromCache || rows.length > 0)) {
              void localDbService.replaceCollection('staff_invites', rows).catch(() => {});
            }
          },
          (err) => logSnapshotError(err, OperationType.LIST, 'staff_invites')
        )
      );

      unsubs.push(
        onSnapshot(
          query(collection(db, 'devices'), orderBy('lastActiveAt', 'desc')),
          (snap) => {
            const rows = snap.docs.map((d) => ({
              id: d.id,
              ...(d.data() as Omit<DeviceRecord, 'id'>),
            }));
            setDevices(rows);
            if (!snap.metadata.hasPendingWrites && (!snap.metadata.fromCache || rows.length > 0)) {
              void localDbService.replaceCollection('devices', rows).catch(() => {});
            }
          },
          (err) => logSnapshotError(err, OperationType.LIST, 'devices')
        )
      );
    }

    return () => {
      cancelled = true;
      unsubs.forEach((u) => u());
    };
  }, [
    firebaseUser,
    isActiveStaff,
    isAdmin,
    isDeviceBlocked,
    deviceIdentity.deviceId,
    profile?.permissions,
  ]);

  useEffect(() => {
    if (!recentSaleAlert) return;
    const t = setTimeout(() => setRecentSaleAlert(null), 7000);
    return () => clearTimeout(t);
  }, [recentSaleAlert]);

  useEffect(() => {
    if (!syncNotice) return;
    const t = setTimeout(() => setSyncNotice(null), 6000);
    return () => clearTimeout(t);
  }, [syncNotice]);

  const flushPendingQueue = useCallback(async () => {
    await initOfflineQueue();
    const currentlyOnline = await refreshNativeNetworkStatus();
    setIsOnline(currentlyOnline);

    if (
      isFlushingRef.current ||
      !currentlyOnline ||
      !firebaseUser ||
      !isActiveStaff ||
      isDeviceBlocked
    ) {
      return;
    }

    const queueSnapshot = loadPendingOperations();
    const runnable = queueSnapshot.filter((op) => op.status === 'pending');
    if (runnable.length === 0) return;

    isFlushingRef.current = true;
    setIsSyncingQueue(true);
    let syncedCount = 0;

    try {
      try {
        const reg = await ensureDeviceRegistered();
        if (reg && reg.status === 'blocked') {
          return;
        }
      } catch (regErr) {
        if (isNetworkOrOfflineError(regErr)) {
          await updateSyncMeta({
            lastSyncError: 'تعذر التحقق من الاتصال بالسحابة. ستُستأنف المزامنة تلقائياً.',
          });
          return;
        }
      }

      const failedEntityIds = new Set<string>();

      for (const op of runnable) {
        if (!isAppOnline()) break;

        // Skip dependent operations if an earlier create/sale operation in this queue failed
        const p = op.payload;
        const referencedIds = [
          p.productId,
          p.customerId,
          p.supplierId,
          p.saleId,
          p.partyId,
        ].filter((v): v is string => typeof v === 'string' && v.length > 0);
        if (referencedIds.some((id) => failedEntityIds.has(id))) {
          continue;
        }

        await updatePendingOperation(op.operationId, {
          status: 'syncing',
          errorMessage: undefined,
        });

        try {
          const result = await flushSinglePendingOperation(op);
          await markOperationSynced(
            op.operationId,
            result?.referenceId,
            result?.referenceNumber
          );
          const refreshedMap = await localDbService.getIdMap();
          setIdMap(refreshedMap);
          syncedCount++;
        } catch (err) {
          if (isNetworkOrOfflineError(err)) {
            const netErrMsg =
              'انقطع الاتصال أثناء ترحيل العمليات. البيانات محفوظة محلياً وستستكمل المزامنة عند عودة الاتصال.';
            await updatePendingOperation(op.operationId, {
              status: 'pending',
              attempts: op.attempts + 1,
              errorMessage: netErrMsg,
            });
            await updateSyncMeta({ lastSyncError: netErrMsg });
            break;
          }

          const rawMsg = err instanceof Error ? err.message : String(err);
          const readableErr = rawMsg.startsWith('{')
            ? 'تعذرت المزامنة بسبب تعارض بيانات أو رفض صلاحية من الخادم.'
            : rawMsg;

          await updatePendingOperation(op.operationId, {
            status: 'conflict',
            attempts: op.attempts + 1,
            errorMessage: readableErr,
          });
          await updateSyncMeta({ lastSyncError: readableErr });

          // Track created entity IDs that conflicted so dependent operations wait cleanly
          if (typeof p.productId === 'string' && op.type === 'product_create') {
            failedEntityIds.add(p.productId);
          }
          if (typeof p.customerId === 'string' && op.type === 'customer_create') {
            failedEntityIds.add(p.customerId);
          }
          if (typeof p.supplierId === 'string' && op.type === 'supplier_create') {
            failedEntityIds.add(p.supplierId);
          }
          if (typeof p.saleId === 'string' && op.type === 'sale') {
            failedEntityIds.add(p.saleId);
          }
        }
      }

      if (syncedCount > 0) {
        setSyncNotice(`تمت مزامنة ${syncedCount} عملية محلية مع السحابة بنجاح دون تكرار.`);
      }
    } finally {
      isFlushingRef.current = false;
      setIsSyncingQueue(false);
    }
  }, [firebaseUser, isActiveStaff, isDeviceBlocked, ensureDeviceRegistered]);

  useEffect(() => {
    if (!isOnline || !firebaseUser || !isActiveStaff || isDeviceBlocked) return;
    void flushPendingQueue();
    const timer = setInterval(() => {
      void flushPendingQueue();
    }, 15000);
    return () => clearInterval(timer);
  }, [isOnline, firebaseUser, isActiveStaff, isDeviceBlocked, flushPendingQueue]);

  const retryPendingOperation = useCallback(
    async (operationId: string) => {
      await updatePendingOperation(operationId, {
        status: 'pending',
        errorMessage: undefined,
      });
      await flushPendingQueue();
    },
    [flushPendingQueue]
  );

  const discardPendingOperation = useCallback((operationId: string) => {
    void removePendingOperation(operationId);
  }, []);

  const resolveConflictOperation = useCallback(
    async (operationId: string, strategy: ConflictResolutionStrategy) => {
      if (strategy === 'discard') {
        await removePendingOperation(operationId);
        return;
      }

      const target = loadAllQueueOperations().find((o) => o.operationId === operationId);
      if (!target) return;

      if (strategy === 'retry') {
        await updatePendingOperation(operationId, {
          status: 'pending',
          errorMessage: undefined,
        });
        await flushPendingQueue();
        return;
      }

      if (strategy === 'apply_delta') {
        const nextPayload = {
          ...target.payload,
          applyDeltaOnConflict: true,
        };
        await updatePendingOperation(operationId, {
          status: 'pending',
          errorMessage: undefined,
          forceApply: false,
          payload: nextPayload,
        });
        await flushPendingQueue();
        return;
      }

      if (strategy === 'force_apply') {
        const nextPayload = {
          ...target.payload,
          applyDeltaOnConflict: false,
          forceApply: true,
        };
        await updatePendingOperation(operationId, {
          status: 'pending',
          errorMessage: undefined,
          forceApply: true,
          payload: nextPayload,
        });
        await flushPendingQueue();
      }
    },
    [flushPendingQueue]
  );

  const pendingOperations = useMemo(
    () => allQueueOperations.filter((op) => op.status !== 'synced'),
    [allQueueOperations]
  );

  const projectedData = useMemo(
    () => projectStoreWithPendingOps(baselineData, pendingOperations, idMap),
    [baselineData, pendingOperations, idMap]
  );

  const reservedStockByProductId = useMemo(
    () => computeReservedStockMap(pendingOperations),
    [pendingOperations]
  );

  const productByCode = useMemo(() => {
    const map = new Map<string, Product>();
    for (const p of projectedData.products) {
      const normCode = normalizeBarcode(p.code);
      if (normCode) {
        map.set(normCode, p);
      }
      const normBarcode = normalizeBarcode(p.barcode);
      if (normBarcode && !map.has(normBarcode)) {
        map.set(normBarcode, p);
      } else if (normBarcode) {
        // Ensure barcode maps directly to the product owning it
        map.set(normBarcode, p);
      }
    }
    return map;
  }, [projectedData.products]);

  const productById = useMemo(() => {
    const map = new Map<string, Product>();
    for (const p of projectedData.products) map.set(p.id, p);
    return map;
  }, [projectedData.products]);

  const customerById = useMemo(() => {
    const map = new Map<string, Customer>();
    for (const c of projectedData.customers) map.set(c.id, c);
    return map;
  }, [projectedData.customers]);

  const supplierById = useMemo(() => {
    const map = new Map<string, Supplier>();
    for (const s of projectedData.suppliers) map.set(s.id, s);
    return map;
  }, [projectedData.suppliers]);

  const hasPendingSync =
    Object.values(pendingMap).some(Boolean) ||
    pendingOperations.some((op) => op.status !== 'conflict');

  const syncStatus = useMemo<SyncStatusSummary>(() => {
    const pendingCount = pendingOperations.filter((op) => op.status !== 'conflict').length;
    const conflictCount = pendingOperations.filter((op) => op.status === 'conflict').length;
    const syncedInHistory = allQueueOperations.filter((op) => op.status === 'synced').length;
    return {
      isOnline,
      systemMode: isOnline ? 'online' : 'offline',
      localDbEngine,
      pendingCount,
      conflictCount,
      syncedCount: syncedInHistory,
      totalSyncedEver: Math.max(syncMeta.totalSyncedCount, syncedInHistory),
      lastSuccessfulSyncIso: syncMeta.lastSuccessfulSyncIso,
      lastSyncError: syncMeta.lastSyncError,
      isSyncing: isSyncingQueue,
    };
  }, [isOnline, localDbEngine, pendingOperations, allQueueOperations, syncMeta, isSyncingQueue]);

  return (
    <StoreDataContext.Provider
      value={{
        settings,
        counters: projectedData.counters,
        products: projectedData.products,
        customers: projectedData.customers,
        suppliers: projectedData.suppliers,
        sales: projectedData.sales,
        purchases: projectedData.purchases,
        returns: projectedData.returns,
        stockMovements: projectedData.stockMovements,
        expenses: projectedData.expenses,
        vouchers: projectedData.vouchers,
        cashTransactions: projectedData.cashTransactions,
        auditLogs: projectedData.auditLogs,
        staffUsers,
        staffInvites,
        devices,
        pendingOperations,
        allQueueOperations,
        reservedStockByProductId,
        isSyncingQueue,
        syncNotice,
        recentSaleAlert,
        syncStatus,
        dismissSyncNotice: () => setSyncNotice(null),
        dismissSaleAlert: () => setRecentSaleAlert(null),
        flushPendingQueue,
        retryPendingOperation,
        discardPendingOperation,
        resolveConflictOperation,
        dataLoading,
        isOnline,
        hasPendingSync,
        productByCode,
        productById,
        customerById,
        supplierById,
      }}
    >
      {children}
    </StoreDataContext.Provider>
  );
};

export function useStoreData(): StoreDataContextValue {
  const ctx = useContext(StoreDataContext);
  if (!ctx) throw new Error('useStoreData must be used inside StoreDataProvider');
  return ctx;
}
