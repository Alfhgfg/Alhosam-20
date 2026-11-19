import React, { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Bell,
  Boxes,
  CheckCircle2,
  CloudOff,
  Laptop,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  RefreshCw,
  RotateCcw,
  Shield,
  ShoppingCart,
  Smartphone,
  Store,
  Tablet,
  Truck,
  Users,
  Wallet,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import {
  NavigationProvider,
  SUBTAB_TITLES,
  useBackLayer,
  useNavigation,
} from './contexts/NavigationContext';
import { StoreDataProvider, useStoreData } from './contexts/StoreDataContext';
import { CustomersView } from './components/CustomersView';
import { DashboardView } from './components/DashboardView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { FinanceView } from './components/FinanceView';
import { InventoryView } from './components/InventoryView';
import { LoginView } from './components/LoginView';
import { PosView } from './components/PosView';
import { ProductsView } from './components/ProductsView';
import { ReportsView } from './components/ReportsView';
import { ReturnsView } from './components/ReturnsView';
import { StaffAuditView } from './components/StaffAuditView';
import { SuppliersPurchasesView } from './components/SuppliersPurchasesView';
import { SyncManagerModal } from './components/SyncManagerModal';
import { BackButton, ModalSubPageHeader } from './components/UnifiedBackHeader';
import type { NavSection } from './types';
import {
  deviceTypeLabel,
  isAllowedDeviceName,
  REQUIRED_DEVICE_NAME,
} from './utils/device';

interface NavItem {
  id: NavSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  visible: boolean;
}

const MainShell: React.FC = () => {
  const {
    firebaseUser,
    profile,
    loading,
    isAdmin,
    isActiveStaff,
    isDeviceBlocked,
    deviceIdentity,
    deviceRecord,
    hasPermission,
    updateCurrentDeviceName,
    logout,
  } = useAuth();
  const {
    settings,
    isOnline,
    hasPendingSync,
    pendingOperations,
    isSyncingQueue,
    syncNotice,
    recentSaleAlert,
    syncStatus,
    dismissSyncNotice,
    dismissSaleAlert,
  } = useStoreData();
  const {
    activeSection,
    activeSubTab,
    canGoBack,
    navigateTo,
    goBack,
    requestGuard,
    resetHistoryToDashboard,
  } = useNavigation();

  const [visitedSections, setVisitedSections] = useState<Set<NavSection>>(
    () => new Set(['dashboard'])
  );
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [queueModalOpen, setQueueModalOpen] = useState(false);
  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [deviceNameDraft, setDeviceNameDraft] = useState('');
  const [savingDeviceName, setSavingDeviceName] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  const navItems: NavItem[] = useMemo(
    () => [
      { id: 'dashboard', label: 'لوحة التحكم', icon: LayoutDashboard, visible: true },
      { id: 'pos', label: 'نقطة البيع (الكاشير)', icon: ShoppingCart, visible: true },
      { id: 'products', label: 'الأصناف والأكواد', icon: Package, visible: true },
      { id: 'inventory', label: 'المخزون والجرد', icon: Boxes, visible: true },
      { id: 'customers', label: 'العملاء والديون', icon: Users, visible: true },
      {
        id: 'suppliers',
        label: 'المشتريات والموردون',
        icon: Truck,
        visible: isAdmin || hasPermission('canPurchase'),
      },
      {
        id: 'returns',
        label: 'المرتجعات والإلغاء',
        icon: RotateCcw,
        visible:
          isAdmin || hasPermission('canReturn') || hasPermission('canCancelInvoice'),
      },
      { id: 'finance', label: 'الحسابات والصندوق', icon: Wallet, visible: true },
      {
        id: 'reports',
        label: 'التقارير والتصدير',
        icon: BarChart3,
        visible: isAdmin || hasPermission('canViewReports'),
      },
      {
        id: 'staff',
        label: 'الموظفون والأجهزة والتدقيق',
        icon: Shield,
        visible: isAdmin,
      },
    ],
    [isAdmin, hasPermission]
  );

  const visibleNav = useMemo(() => navItems.filter((n) => n.visible), [navItems]);
  const currentNav =
    visibleNav.find((n) => n.id === activeSection) || visibleNav[0];

  const currentDeviceName = deviceRecord?.deviceName || deviceIdentity.deviceName;
  const isDeviceNameAuthorized =
    isAllowedDeviceName(deviceIdentity.deviceName) ||
    isAllowedDeviceName(deviceRecord?.deviceName);

  const isAuthenticatedShell =
    !loading &&
    Boolean(firebaseUser) &&
    isActiveStaff &&
    !isDeviceBlocked &&
    isDeviceNameAuthorized;

  // Keep visited visible sections mounted so search/filters/scroll/drafts stay intact on Back
  useEffect(() => {
    if (!isAuthenticatedShell) return;
    setVisitedSections((prev) => {
      if (prev.has(currentNav.id)) return prev;
      const next = new Set(prev);
      next.add(currentNav.id);
      return next;
    });
  }, [currentNav.id, isAuthenticatedShell]);

  // Register top-level drawers & modals with unified Back stack
  const requestCloseMobileMenu = useBackLayer({
    id: 'mobile-menu-drawer',
    active: isAuthenticatedShell && mobileMenuOpen,
    onClose: () => setMobileMenuOpen(false),
  });

  const requestCloseRenameModal = useBackLayer({
    id: 'rename-device-modal',
    active: isAuthenticatedShell && renameModalOpen,
    onClose: () => setRenameModalOpen(false),
    isDirty: () =>
      renameModalOpen && deviceNameDraft.trim() !== currentDeviceName.trim(),
  });

  if (!isAuthenticatedShell) {
    return <LoginView />;
  }

  const DeviceIcon =
    deviceIdentity.deviceType === 'mobile'
      ? Smartphone
      : deviceIdentity.deviceType === 'tablet'
      ? Tablet
      : Laptop;

  const conflictCount = pendingOperations.filter((o) => o.status === 'conflict').length;
  const subTabTitle = activeSubTab ? SUBTAB_TITLES[activeSubTab] : undefined;

  const handleSelectNav = (id: NavSection, subTab?: string) => {
    if (mobileMenuOpen) {
      setMobileMenuOpen(false);
    }
    navigateTo(id, subTab);
  };

  const openRenameModal = () => {
    setDeviceNameDraft(currentDeviceName);
    setRenameError(null);
    setRenameModalOpen(true);
  };

  const handleSaveDeviceName = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = deviceNameDraft.trim();
    if (!clean) return;
    if (!isAllowedDeviceName(clean)) {
      setRenameError(
        `وفقاً للسياسة الأمنية، يجب أن يكون اسم الجهاز «${REQUIRED_DEVICE_NAME}» حصراً.`
      );
      return;
    }
    setRenameError(null);
    setSavingDeviceName(true);
    try {
      await updateCurrentDeviceName(clean);
      setRenameModalOpen(false);
    } finally {
      setSavingDeviceName(false);
    }
  };

  const handleGuardedLogout = () => {
    requestGuard(() => {
      setMobileMenuOpen(false);
      resetHistoryToDashboard();
      void logout();
    });
  };

  const renderSectionById = (sec: NavSection, isActive: boolean) => {
    switch (sec) {
      case 'dashboard':
        return <DashboardView onNavigate={handleSelectNav} />;
      case 'pos':
        return <PosView isActive={isActive} />;
      case 'products':
        return <ProductsView />;
      case 'inventory':
        return <InventoryView />;
      case 'customers':
        return <CustomersView />;
      case 'suppliers':
        return <SuppliersPurchasesView />;
      case 'returns':
        return <ReturnsView />;
      case 'finance':
        return <FinanceView />;
      case 'reports':
        return <ReportsView />;
      case 'staff':
        return <StaffAuditView />;
    }
  };

  return (
    <div className="min-h-[100dvh] bg-slate-50 flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:shrink-0 bg-white border-l border-slate-200 sticky top-0 h-screen no-print">
        <div className="h-16 px-5 border-b border-slate-200 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-700 text-white flex items-center justify-center shrink-0">
            <Store className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="font-bold text-slate-900 text-sm truncate">
              {settings.storeName}
            </div>
            <div className="text-[11px] text-slate-500 truncate">
              {isAdmin ? 'حساب المسؤول الرئيسي' : 'حساب البائع'} · {settings.currency}
            </div>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {visibleNav.map((item) => {
            const Icon = item.icon;
            const active = currentNav.id === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleSelectNav(item.id)}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors cursor-pointer whitespace-nowrap ${
                  active
                    ? 'bg-emerald-700 text-white'
                    : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="p-3 border-t border-slate-200 space-y-2">
          <div className="px-3 py-2 bg-slate-50 rounded-xl space-y-1">
            <div className="text-xs font-semibold text-slate-900 truncate">
              {profile?.displayName}
            </div>
            <div className="text-[11px] font-mono-num text-slate-500 truncate" dir="ltr">
              {profile?.email}
            </div>
            <button
              type="button"
              onClick={openRenameModal}
              className="w-full flex items-center gap-1.5 text-[11px] text-emerald-700 font-medium hover:underline cursor-pointer pt-0.5"
              title="تعديل اسم الجهاز"
            >
              <DeviceIcon className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{currentDeviceName}</span>
            </button>
          </div>
          <button
            onClick={handleGuardedLogout}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50 rounded-xl transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>تسجيل الخروج</span>
          </button>
        </div>
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex no-print">
          <div
            className="fixed inset-0 bg-slate-900/50"
            onClick={requestCloseMobileMenu}
          />
          <aside className="relative w-72 max-w-[82vw] bg-white h-full flex flex-col border-l border-slate-200 z-10">
            <div className="h-14 px-3.5 border-b border-slate-200 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <BackButton onClick={requestCloseMobileMenu} compact />
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-7 h-7 rounded-lg bg-emerald-700 text-white flex items-center justify-center shrink-0">
                    <Store className="w-3.5 h-3.5" />
                  </div>
                  <span className="font-bold text-slate-900 text-sm truncate">
                    {settings.storeName}
                  </span>
                </div>
              </div>
            </div>

            <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
              {visibleNav.map((item) => {
                const Icon = item.icon;
                const active = currentNav.id === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => handleSelectNav(item.id)}
                    className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium cursor-pointer ${
                      active
                        ? 'bg-emerald-700 text-white'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>

            <div className="p-3 border-t border-slate-200 space-y-2">
              <div className="px-3 py-2 bg-slate-50 rounded-xl text-xs">
                <div className="font-semibold text-slate-900 truncate">
                  {profile?.displayName}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    openRenameModal();
                  }}
                  className="flex items-center gap-1.5 text-[11px] text-emerald-700 font-medium mt-1 cursor-pointer"
                >
                  <DeviceIcon className="w-3.5 h-3.5" />
                  <span>{currentDeviceName}</span>
                </button>
              </div>
              <button
                onClick={handleGuardedLogout}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50 rounded-xl cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                <span>تسجيل الخروج</span>
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Unified Top Navigation Bar */}
        <header className="h-14 bg-white border-b border-slate-200 px-3 sm:px-4 lg:px-6 flex items-center justify-between gap-2 sm:gap-3 sticky top-0 z-30 no-print">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
            {canGoBack ? (
              <BackButton onClick={() => goBack(false)} compact />
            ) : (
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                aria-label="فتح القائمة"
                className="lg:hidden p-2 -mr-1 text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer shrink-0"
              >
                <Menu className="w-5 h-5" />
              </button>
            )}

            <div className="text-sm font-semibold text-slate-900 truncate flex items-center gap-1.5 min-w-0">
              <span className={`${canGoBack ? 'hidden sm:inline' : 'inline'} text-slate-700`}>
                {settings.storeName}
              </span>
              <span className={`${canGoBack ? 'hidden sm:inline' : 'inline'} text-slate-400`}>
                /
              </span>
              <span className="text-emerald-700 truncate">{currentNav.label}</span>
              {subTabTitle && (
                <>
                  <span className="hidden md:inline text-slate-400">/</span>
                  <span className="hidden md:inline text-slate-700 truncate">
                    {subTabTitle}
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={openRenameModal}
              className="hidden sm:inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 px-2.5 py-1.5 rounded-lg cursor-pointer whitespace-nowrap max-w-[170px]"
              title={`${deviceTypeLabel(deviceIdentity.deviceType)} · اضغط لتغيير اسم الجهاز`}
            >
              <DeviceIcon className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
              <span className="truncate">{currentDeviceName}</span>
            </button>

            <button
              type="button"
              onClick={() => setQueueModalOpen(true)}
              className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg border cursor-pointer whitespace-nowrap ${
                conflictCount > 0
                  ? 'bg-red-50 border-red-200 text-red-700'
                  : !isOnline || pendingOperations.length > 0
                  ? 'bg-amber-50 border-amber-200 text-amber-800'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-800'
              }`}
              title="فتح مركز إدارة المزامنة والعمل دون اتصال"
            >
              {isSyncingQueue ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin shrink-0" />
              ) : !isOnline ? (
                <WifiOff className="w-3.5 h-3.5 shrink-0" />
              ) : pendingOperations.length > 0 ? (
                <CloudOff className="w-3.5 h-3.5 shrink-0" />
              ) : (
                <Wifi className="w-3.5 h-3.5 shrink-0" />
              )}
              <span>
                {!isOnline
                  ? pendingOperations.length > 0
                    ? `دون اتصال (${pendingOperations.length})`
                    : 'دون اتصال'
                  : conflictCount > 0
                  ? `تعارض (${conflictCount})`
                  : pendingOperations.length > 0
                  ? `مزامنة (${pendingOperations.length})`
                  : syncStatus.isSyncing || hasPendingSync
                  ? 'جاري المزامنة'
                  : 'متصل · متزامن'}
              </span>
            </button>

            {currentNav.id !== 'pos' && (
              <button
                onClick={() => handleSelectNav('pos')}
                className="px-3 sm:px-3.5 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap"
              >
                شاشة البيع
              </button>
            )}
          </div>
        </header>

        {!isOnline && (
          <div className="bg-amber-50 border-b border-amber-200 px-4 lg:px-6 py-2 text-xs text-amber-900 flex flex-wrap items-center justify-between gap-2 no-print">
            <div className="flex items-center gap-2">
              <WifiOff className="w-3.5 h-3.5 text-amber-700 shrink-0" />
              <span>
                النظام يعمل الآن <strong>دون إنترنت</strong> — جميع المبيعات والعمليات تُحفظ محلياً في قاعدة البيانات الدائمة وستُرحّل تلقائياً فور عودة الاتصال.
              </span>
            </div>
            <button
              type="button"
              onClick={() => setQueueModalOpen(true)}
              className="font-semibold text-amber-900 underline cursor-pointer whitespace-nowrap"
            >
              حالة المزامنة ({pendingOperations.length} معلقة)
            </button>
          </div>
        )}

        {/* Live Cloud Alerts */}
        {(recentSaleAlert || syncNotice) && (
          <div className="px-4 lg:px-6 pt-3 space-y-2 max-w-[1440px] w-full mx-auto no-print">
            {recentSaleAlert && (
              <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-xl text-xs font-medium">
                <div className="flex items-center gap-2">
                  <Bell className="w-4 h-4 text-emerald-700 shrink-0" />
                  <span>{recentSaleAlert}</span>
                </div>
                <button
                  onClick={dismissSaleAlert}
                  className="p-1 text-emerald-700 hover:text-emerald-900 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
            {syncNotice && (
              <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-slate-900 text-white rounded-xl text-xs font-medium">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>{syncNotice}</span>
                </div>
                <button
                  onClick={dismissSyncNotice}
                  className="p-1 text-slate-300 hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        )}

        {/* Visited Sections Kept Mounted to Preserve Search, Filters & Form State on Back */}
        <main className="flex-1 p-3.5 sm:p-4 lg:p-6 pb-24 lg:pb-6 max-w-[1440px] w-full mx-auto">
          {visibleNav
            .filter((item) => visitedSections.has(item.id) || currentNav.id === item.id)
            .map((item) => {
              const isActive = currentNav.id === item.id;
              return (
                <div
                  key={item.id}
                  className={isActive ? 'block' : 'hidden no-print'}
                  aria-hidden={!isActive}
                >
                  {renderSectionById(item.id, isActive)}
                </div>
              );
            })}
        </main>

        {/* Mobile Bottom Quick Navigation */}
        <nav
          aria-label="التنقل السريع"
          className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur border-t border-slate-200 px-2 pt-1.5 pb-[max(0.45rem,env(safe-area-inset-bottom))] grid grid-cols-5 gap-1 no-print"
        >
          {(
            [
              { id: 'dashboard', label: 'الرئيسية', icon: LayoutDashboard },
              { id: 'pos', label: 'الكاشير', icon: ShoppingCart },
              { id: 'products', label: 'الأصناف', icon: Package },
              { id: 'customers', label: 'العملاء', icon: Users },
            ] as const
          ).map((item) => {
            const Icon = item.icon;
            const active = currentNav.id === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelectNav(item.id)}
                className={`flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-xl text-[11px] font-medium cursor-pointer transition-colors ${
                  active
                    ? 'text-emerald-700 bg-emerald-50 font-semibold'
                    : 'text-slate-600'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate max-w-full">{item.label}</span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            className="flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-xl text-[11px] font-medium text-slate-600 cursor-pointer"
          >
            <Menu className="w-4 h-4 shrink-0" />
            <span>المزيد</span>
          </button>
        </nav>
      </div>

      {/* Rename Device Modal */}
      {renameModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4 no-print">
          <form
            onSubmit={handleSaveDeviceName}
            className="bg-white border border-slate-200 rounded-2xl w-full max-w-md overflow-hidden shadow-xl"
          >
            <ModalSubPageHeader
              title="تسمية هذا الجهاز"
              subtitle={`${deviceTypeLabel(deviceIdentity.deviceType)} · ${deviceIdentity.platform}`}
              onBack={requestCloseRenameModal}
            />
            <div className="p-6 space-y-4">
              {renameError && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg leading-relaxed">
                  {renameError}
                </div>
              )}
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-slate-700">
                  الاسم الظاهر للمسؤول وفي الفواتير *
                </label>
                <input
                  required
                  type="text"
                  value={deviceNameDraft}
                  onChange={(e) => {
                    setDeviceNameDraft(e.target.value);
                    if (renameError) setRenameError(null);
                  }}
                  placeholder={`اكتب: ${REQUIRED_DEVICE_NAME}`}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
                <div className="flex items-center justify-between text-[11px] text-slate-500">
                  <span>
                    {deviceTypeLabel(deviceIdentity.deviceType)} · {deviceIdentity.platform}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setDeviceNameDraft(REQUIRED_DEVICE_NAME);
                      if (renameError) setRenameError(null);
                    }}
                    className="text-emerald-700 font-semibold hover:underline cursor-pointer"
                  >
                    تعيين «{REQUIRED_DEVICE_NAME}»
                  </button>
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="submit"
                  disabled={savingDeviceName}
                  className="px-4 py-2 text-xs font-semibold text-white bg-emerald-700 rounded-lg cursor-pointer"
                >
                  {savingDeviceName ? 'جاري الحفظ...' : 'حفظ الاسم'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      <SyncManagerModal open={queueModalOpen} onClose={() => setQueueModalOpen(false)} />
    </div>
  );
};

export default function App() {
  return (
    <ErrorBoundary>
      <NavigationProvider>
        <AuthProvider>
          <StoreDataProvider>
            <MainShell />
          </StoreDataProvider>
        </AuthProvider>
      </NavigationProvider>
    </ErrorBoundary>
  );
}
