import React, { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Bell,
  Boxes,
  CheckCircle2,
  ChevronLeft,
  CloudOff,
  Edit3,
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
import { StoreBrandLogo } from './components/StoreBrandLogo';
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
  group: 'operations' | 'relations' | 'finance';
  icon: React.ComponentType<{ className?: string }>;
  visible: boolean;
}

const NAV_GROUP_LABELS: Record<NavItem['group'], string> = {
  operations: 'العمليات اليومية',
  relations: 'العملاء والمبيعات',
  finance: 'المالية والإدارة',
};

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
      {
        id: 'dashboard',
        label: 'لوحة التحكم',
        group: 'operations',
        icon: LayoutDashboard,
        visible: true,
      },
      {
        id: 'pos',
        label: 'نقطة البيع (الكاشير)',
        group: 'operations',
        icon: ShoppingCart,
        visible: true,
      },
      {
        id: 'products',
        label: 'الأصناف والأكواد',
        group: 'operations',
        icon: Package,
        visible: true,
      },
      {
        id: 'inventory',
        label: 'المخزون والجرد',
        group: 'operations',
        icon: Boxes,
        visible: true,
      },
      {
        id: 'customers',
        label: 'العملاء والديون',
        group: 'relations',
        icon: Users,
        visible: true,
      },
      {
        id: 'suppliers',
        label: 'المشتريات والموردون',
        group: 'relations',
        icon: Truck,
        visible: isAdmin || hasPermission('canPurchase'),
      },
      {
        id: 'returns',
        label: 'المرتجعات والإلغاء',
        group: 'relations',
        icon: RotateCcw,
        visible:
          isAdmin || hasPermission('canReturn') || hasPermission('canCancelInvoice'),
      },
      {
        id: 'finance',
        label: 'الحسابات والصندوق',
        group: 'finance',
        icon: Wallet,
        visible: true,
      },
      {
        id: 'reports',
        label: 'التقارير والتصدير',
        group: 'finance',
        icon: BarChart3,
        visible: isAdmin || hasPermission('canViewReports'),
      },
      {
        id: 'staff',
        label: 'الموظفون والأجهزة والتدقيق',
        group: 'finance',
        icon: Shield,
        visible: isAdmin,
      },
    ],
    [isAdmin, hasPermission]
  );

  const visibleNav = useMemo(() => navItems.filter((n) => n.visible), [navItems]);
  const groupedNav = useMemo(() => {
    const order: NavItem['group'][] = ['operations', 'relations', 'finance'];
    return order
      .map((group) => ({
        group,
        title: NAV_GROUP_LABELS[group],
        items: visibleNav.filter((item) => item.group === group),
      }))
      .filter((g) => g.items.length > 0);
  }, [visibleNav]);

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

  const activePermissionCount = profile?.permissions
    ? Object.values(profile.permissions).filter(Boolean).length
    : 0;
  const accountSummary = isAdmin
    ? 'مسؤول النظام · كامل الصلاحيات'
    : `بائع · ${activePermissionCount} صلاحيات مفعّلة`;
  const userInitial = (profile?.displayName || 'م').trim().charAt(0).toUpperCase();

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

  const renderSidebarContent = (isMobileDrawer: boolean) => (
    <>
      {/* Brand Header */}
      <div className="px-4 py-3.5 border-b border-slate-200/80 bg-white flex items-center justify-between gap-2.5 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          {isMobileDrawer && (
            <BackButton onClick={requestCloseMobileMenu} compact label="رجوع" />
          )}
          <StoreBrandLogo
            mode={settings.logoMode}
            customDataUrl={settings.logoDataUrl}
            storeName={settings.storeName}
            compact
          />
          <div className="min-w-0">
            <div className="font-display font-bold text-slate-900 text-sm truncate">
              {settings.storeName}
            </div>
            <div className="text-[11px] text-slate-500 truncate">
              النظام المحاسبي · {settings.currency}
            </div>
          </div>
        </div>
      </div>

      {/* Grouped Navigation */}
      <nav
        aria-label="القائمة الرئيسية"
        className="flex-1 px-3 py-3 space-y-4 overflow-y-auto"
      >
        {groupedNav.map((group) => (
          <div key={group.group} className="space-y-1">
            <div className="px-2.5 pb-0.5 text-[11px] font-semibold text-slate-400 tracking-wide">
              {group.title}
            </div>
            <div className="space-y-1">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = currentNav.id === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleSelectNav(item.id)}
                    aria-current={active ? 'page' : undefined}
                    className={`group w-full flex items-center justify-between gap-2.5 px-2.5 py-2 min-h-[44px] lg:min-h-[40px] rounded-xl text-[13.5px] transition-all duration-150 cursor-pointer text-right ${
                      active
                        ? 'bg-emerald-50/90 text-emerald-950 font-bold border border-emerald-200/90 shadow-[0_1px_2px_rgba(4,120,87,0.06)]'
                        : 'text-slate-700 font-medium border border-transparent hover:bg-slate-100/80 hover:text-slate-900'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                          active
                            ? 'bg-emerald-700 text-white shadow-xs'
                            : 'bg-slate-100 text-slate-600 group-hover:bg-slate-200/70 group-hover:text-slate-800'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                      </span>
                      <span className="truncate">{item.label}</span>
                    </div>
                    {active && (
                      <ChevronLeft className="w-4 h-4 text-emerald-700 shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom User Card & Logout */}
      <div className="p-3 border-t border-slate-200/80 bg-slate-50/60 space-y-2.5 shrink-0">
        <div className="p-3 bg-white border border-slate-200/85 rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.03)] space-y-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-emerald-700 text-white font-display font-bold text-sm flex items-center justify-center shrink-0 shadow-xs">
              {userInitial}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs sm:text-[13px] font-bold text-slate-900 truncate">
                {profile?.displayName}
              </div>
              <div className="text-[11px] font-semibold text-emerald-700 truncate">
                {accountSummary}
              </div>
            </div>
          </div>

          {profile?.email && (
            <div
              className="text-[11px] font-mono-num text-slate-500 truncate pt-1 border-t border-slate-100"
              dir="ltr"
            >
              {profile.email}
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              if (isMobileDrawer) setMobileMenuOpen(false);
              openRenameModal();
            }}
            className="w-full flex items-center justify-between gap-2 px-2.5 py-2 min-h-[38px] rounded-xl bg-slate-50 hover:bg-emerald-50/70 border border-slate-200/80 text-[11px] font-semibold text-slate-700 hover:text-emerald-800 transition-colors cursor-pointer"
            title="تعديل اسم الجهاز"
          >
            <span className="flex items-center gap-1.5 min-w-0">
              <DeviceIcon className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
              <span className="truncate">{currentDeviceName}</span>
            </span>
            <Edit3 className="w-3 h-3 text-slate-400 shrink-0" />
          </button>
        </div>

        <button
          type="button"
          onClick={handleGuardedLogout}
          className="w-full flex items-center justify-center gap-2 px-3 py-2.5 min-h-[44px] text-xs font-semibold text-red-700 bg-red-50/80 hover:bg-red-100/90 active:bg-red-200/70 border border-red-200/90 rounded-xl transition-colors cursor-pointer"
        >
          <LogOut className="w-4 h-4 shrink-0" />
          <span>تسجيل الخروج</span>
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-[100dvh] bg-[#f6f8f7] flex">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-72 lg:shrink-0 bg-white border-l border-slate-200/85 sticky top-0 h-screen no-print">
        {renderSidebarContent(false)}
      </aside>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex no-print">
          <div
            className="fixed inset-0 bg-slate-950/50 backdrop-blur-[1px]"
            onClick={requestCloseMobileMenu}
          />
          <aside className="relative w-80 max-w-[86vw] bg-white h-full flex flex-col border-l border-slate-200 z-10 shadow-2xl">
            {renderSidebarContent(true)}
          </aside>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Unified Top Navigation Bar */}
        <header className="h-14 bg-white/95 backdrop-blur-md border-b border-slate-200/85 px-3 sm:px-4 lg:px-6 flex items-center justify-between gap-2 sm:gap-3 sticky top-0 z-30 no-print">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
            {canGoBack ? (
              <BackButton onClick={() => goBack(false)} compact />
            ) : (
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                aria-label="فتح القائمة"
                className="lg:hidden min-w-[42px] min-h-[42px] -mr-1 flex items-center justify-center text-slate-700 hover:bg-slate-100 active:bg-slate-200 rounded-xl cursor-pointer shrink-0 transition-colors"
              >
                <Menu className="w-5 h-5" />
              </button>
            )}

            <div className="text-[13px] sm:text-sm font-semibold text-slate-900 truncate flex items-center gap-1.5 min-w-0">
              <span className={`${canGoBack ? 'hidden sm:inline' : 'inline'} text-slate-500 font-medium`}>
                {settings.storeName}
              </span>
              <span className={`${canGoBack ? 'hidden sm:inline' : 'inline'} text-slate-300`}>
                /
              </span>
              <span className="text-emerald-800 font-bold truncate">{currentNav.label}</span>
              {subTabTitle && (
                <>
                  <span className="hidden md:inline text-slate-300">/</span>
                  <span className="hidden md:inline text-slate-600 font-medium truncate">
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
              className="hidden sm:inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 bg-slate-100/90 hover:bg-slate-200/80 px-2.5 py-2 min-h-[38px] rounded-xl cursor-pointer whitespace-nowrap max-w-[170px] transition-colors"
              title={`${deviceTypeLabel(deviceIdentity.deviceType)} · اضغط لتغيير اسم الجهاز`}
            >
              <DeviceIcon className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
              <span className="truncate">{currentDeviceName}</span>
            </button>

            <button
              type="button"
              onClick={() => setQueueModalOpen(true)}
              className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 sm:px-3 py-2 min-h-[38px] rounded-xl border cursor-pointer whitespace-nowrap transition-colors ${
                conflictCount > 0
                  ? 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100/70'
                  : !isOnline || pendingOperations.length > 0
                  ? 'bg-amber-50 border-amber-200 text-amber-800 hover:bg-amber-100/70'
                  : 'bg-emerald-50/80 border-emerald-200/90 text-emerald-800 hover:bg-emerald-100/70'
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
                type="button"
                onClick={() => handleSelectNav('pos')}
                className="px-3 sm:px-3.5 py-2 min-h-[38px] bg-emerald-700 hover:bg-emerald-800 active:bg-emerald-900 text-white text-xs font-semibold rounded-xl shadow-[0_1px_2px_rgba(4,120,87,0.18)] transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                شاشة البيع
              </button>
            )}
          </div>
        </header>

        {!isOnline && (
          <div className="bg-amber-50/90 border-b border-amber-200/80 px-4 lg:px-6 py-2 text-xs text-amber-900 flex flex-wrap items-center justify-between gap-2 no-print">
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
          <div className="px-3.5 sm:px-4 lg:px-6 pt-3 space-y-2 max-w-[1440px] w-full mx-auto no-print">
            {recentSaleAlert && (
              <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-xl text-xs font-medium shadow-xs">
                <div className="flex items-center gap-2">
                  <Bell className="w-4 h-4 text-emerald-700 shrink-0" />
                  <span>{recentSaleAlert}</span>
                </div>
                <button
                  type="button"
                  onClick={dismissSaleAlert}
                  className="p-1.5 text-emerald-700 hover:text-emerald-900 rounded-lg cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}
            {syncNotice && (
              <div className="flex items-center justify-between gap-3 px-4 py-2.5 bg-slate-900 text-white rounded-xl text-xs font-medium shadow-xs">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>{syncNotice}</span>
                </div>
                <button
                  type="button"
                  onClick={dismissSyncNotice}
                  className="p-1.5 text-slate-300 hover:text-white rounded-lg cursor-pointer"
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
          className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur-md border-t border-slate-200/90 px-2 pt-1.5 pb-[max(0.45rem,env(safe-area-inset-bottom))] grid grid-cols-5 gap-1 shadow-[0_-4px_16px_rgba(15,23,42,0.04)] no-print"
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
                className={`flex flex-col items-center justify-center gap-0.5 py-1.5 min-h-[46px] rounded-xl text-[11px] cursor-pointer transition-colors ${
                  active
                    ? 'text-emerald-800 bg-emerald-50 font-bold'
                    : 'text-slate-600 font-medium hover:bg-slate-50'
                }`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-emerald-700' : ''}`} />
                <span className="truncate max-w-full">{item.label}</span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            className="flex flex-col items-center justify-center gap-0.5 py-1.5 min-h-[46px] rounded-xl text-[11px] font-medium text-slate-600 hover:bg-slate-50 cursor-pointer transition-colors"
          >
            <Menu className="w-4 h-4 shrink-0" />
            <span>القائمة</span>
          </button>
        </nav>
      </div>

      {/* Rename Device Modal */}
      {renameModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/55 backdrop-blur-[1px] flex items-end sm:items-center justify-center p-0 sm:p-4 no-print">
          <form
            onSubmit={handleSaveDeviceName}
            className="bg-white border border-slate-200 rounded-t-2xl sm:rounded-2xl w-full max-w-md overflow-hidden shadow-2xl"
          >
            <ModalSubPageHeader
              title="تسمية هذا الجهاز"
              subtitle={`${deviceTypeLabel(deviceIdentity.deviceType)} · ${deviceIdentity.platform}`}
              onBack={requestCloseRenameModal}
            />
            <div className="p-5 sm:p-6 space-y-4">
              {renameError && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-xl leading-relaxed">
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
                  className="ui-input"
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
                  className="ui-btn-primary w-full sm:w-auto"
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
