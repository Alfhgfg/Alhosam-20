import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AlertTriangle, ArrowRight, Power } from 'lucide-react';
import type { NavSection } from '../types';

export interface NavEntry {
  section: NavSection;
  subTab?: string;
}

export interface BackLayerOptions {
  id: string;
  active: boolean;
  onClose: () => void;
  isDirty?: () => boolean;
  dirtyMessage?: string;
  onDiscard?: () => void;
}

interface InternalOverlay {
  key: string;
  id: string;
  onClose: () => void;
  isDirty?: () => boolean;
  dirtyMessage?: string;
  onDiscard?: () => void;
}

export interface SectionGuardConfig {
  isDirty: () => boolean;
  dirtyMessage?: string;
  onDiscard?: () => void;
}

interface PendingConfirmState {
  message: string;
  onConfirm: () => void;
}

interface NavigationContextValue {
  currentEntry: NavEntry;
  activeSection: NavSection;
  activeSubTab: string | undefined;
  sectionHistory: NavEntry[];
  previousEntry: NavEntry | null;
  canGoBack: boolean;
  hasActiveOverlay: boolean;
  navigateTo: (section: NavSection, subTab?: string) => void;
  setSubTab: (subTab: string) => void;
  goBack: (forceDiscard?: boolean) => void;
  requestGuard: (action: () => void, scopeSection?: NavSection) => void;
  resetHistoryToDashboard: () => void;
  registerOverlay: (overlay: InternalOverlay) => void;
  unregisterOverlay: (key: string, fromBack?: boolean) => void;
  registerSectionGuard: (section: NavSection, guard: SectionGuardConfig | null) => void;
}

const DEFAULT_DIRTY_MESSAGE =
  'هناك تغييرات غير محفوظة، هل تريد الخروج دون حفظ؟';

export const SECTION_TITLES: Record<NavSection, string> = {
  dashboard: 'لوحة التحكم',
  pos: 'نقطة البيع (الكاشير)',
  products: 'الأصناف والأكواد',
  inventory: 'المخزون والجرد',
  customers: 'العملاء والديون',
  suppliers: 'المشتريات والموردون',
  returns: 'المرتجعات والإلغاء',
  finance: 'الحسابات والصندوق',
  reports: 'التقارير والتصدير',
  staff: 'الموظفون والإعدادات',
};

export const SUBTAB_TITLES: Record<string, string> = {
  // Inventory
  levels: 'أرصدة المخزون',
  stocktake: 'الجرد والوارد/المنصرف',
  movements: 'حركة الأصناف',
  // Suppliers & Purchases
  new_purchase: 'فاتورة شراء جديدة',
  history: 'سجل المشتريات',
  suppliers: 'دليل الموردين',
  // Finance
  cashbox: 'الصندوق النقدي',
  expenses: 'المصروفات',
  vouchers: 'سندات القبض والصرف',
  pnl: 'الأرباح والخسائر',
  // Staff & Settings
  staff: 'الموظفون والصلاحيات',
  devices: 'الأجهزة والمراقبة',
  audit: 'سجل التدقيق',
  settings: 'الإعدادات والنسخ الاحتياطي',
};

export const DEFAULT_SUBTABS: Partial<Record<NavSection, string>> = {
  inventory: 'levels',
  suppliers: 'new_purchase',
  finance: 'cashbox',
  staff: 'staff',
};

function isSameEntry(a: NavEntry, b: NavEntry): boolean {
  const subA = a.subTab ?? DEFAULT_SUBTABS[a.section];
  const subB = b.subTab ?? DEFAULT_SUBTABS[b.section];
  return a.section === b.section && subA === subB;
}

const NavigationContext = createContext<NavigationContextValue | null>(null);

declare global {
  interface Window {
    __ALHUSSAM_ON_ANDROID_BACK__?: () => void;
    AndroidNavBridge?: {
      exitApp?: () => void;
      showExitHint?: (msg: string) => void;
    };
  }
}

export const NavigationProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [sectionHistory, setSectionHistory] = useState<NavEntry[]>([
    { section: 'dashboard' },
  ]);
  const [overlays, setOverlays] = useState<InternalOverlay[]>([]);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirmState | null>(
    null
  );
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);

  const sectionHistoryRef = useRef<NavEntry[]>(sectionHistory);
  sectionHistoryRef.current = sectionHistory;

  const overlaysRef = useRef<InternalOverlay[]>(overlays);
  overlaysRef.current = overlays;

  const pendingConfirmRef = useRef<PendingConfirmState | null>(pendingConfirm);
  pendingConfirmRef.current = pendingConfirm;

  const exitConfirmOpenRef = useRef<boolean>(exitConfirmOpen);
  exitConfirmOpenRef.current = exitConfirmOpen;

  const sectionGuardsRef = useRef<Partial<Record<NavSection, SectionGuardConfig>>>(
    {}
  );

  // Browser History synchronization
  const seqRef = useRef<number>(0);
  const suppressNextPopRef = useRef<number>(0);
  const pendingDeltaRef = useRef<number>(0);
  const flushScheduledRef = useRef<boolean>(false);

  const scheduleHistoryFlush = useCallback(() => {
    if (flushScheduledRef.current) return;
    flushScheduledRef.current = true;
    queueMicrotask(() => {
      flushScheduledRef.current = false;
      const delta = pendingDeltaRef.current;
      pendingDeltaRef.current = 0;
      if (delta === 0 || typeof window === 'undefined') return;

      try {
        if (delta > 0) {
          for (let i = 0; i < delta; i++) {
            seqRef.current += 1;
            window.history.pushState(
              { alhussamNav: true, seq: seqRef.current },
              ''
            );
          }
        } else {
          const steps = Math.min(-delta, seqRef.current);
          if (steps > 0) {
            seqRef.current -= steps;
            suppressNextPopRef.current += 1;
            window.history.go(-steps);
          }
        }
      } catch {
        // Ignore history restrictions in sandboxed frames
      }
    });
  }, []);

  const pushBrowserHistory = useCallback(() => {
    pendingDeltaRef.current += 1;
    scheduleHistoryFlush();
  }, [scheduleHistoryFlush]);

  const popBrowserHistory = useCallback(() => {
    pendingDeltaRef.current -= 1;
    scheduleHistoryFlush();
  }, [scheduleHistoryFlush]);

  // Initialize base history state once
  useEffect(() => {
    try {
      const currentState = window.history.state;
      if (!currentState || !currentState.alhussamNav) {
        window.history.replaceState({ alhussamNav: true, seq: 0 }, '');
        seqRef.current = 0;
      } else if (typeof currentState.seq === 'number') {
        seqRef.current = currentState.seq;
      }
    } catch {
      // Ignore
    }
  }, []);

  const registerOverlay = useCallback(
    (overlay: InternalOverlay) => {
      const exists = overlaysRef.current.some((o) => o.key === overlay.key);
      if (exists) {
        const next = overlaysRef.current.map((o) =>
          o.key === overlay.key ? overlay : o
        );
        overlaysRef.current = next;
        setOverlays(next);
        return;
      }
      const next = [...overlaysRef.current, overlay];
      overlaysRef.current = next;
      setOverlays(next);
      pushBrowserHistory();
    },
    [pushBrowserHistory]
  );

  const unregisterOverlay = useCallback(
    (key: string, fromBack = false) => {
      const exists = overlaysRef.current.some((o) => o.key === key);
      if (!exists) return;
      const next = overlaysRef.current.filter((o) => o.key !== key);
      overlaysRef.current = next;
      setOverlays(next);
      if (!fromBack) {
        popBrowserHistory();
      }
    },
    [popBrowserHistory]
  );

  const registerSectionGuard = useCallback(
    (section: NavSection, guard: SectionGuardConfig | null) => {
      if (guard) {
        sectionGuardsRef.current[section] = guard;
      } else {
        delete sectionGuardsRef.current[section];
      }
    },
    []
  );

  const getDirtyForTopOverlay = useCallback((): {
    dirty: boolean;
    message: string;
    onDiscard?: () => void;
  } | null => {
    const list = overlaysRef.current;
    if (list.length === 0) return null;
    const top = list[list.length - 1];
    if (top.isDirty && top.isDirty()) {
      return {
        dirty: true,
        message: top.dirtyMessage || DEFAULT_DIRTY_MESSAGE,
        onDiscard: top.onDiscard,
      };
    }
    return { dirty: false, message: '' };
  }, []);

  const getDirtyForCurrentSection = useCallback(
    (targetSection?: NavSection): {
      dirty: boolean;
      message: string;
      onDiscard?: () => void;
    } => {
      const activeSec =
        targetSection ??
        sectionHistoryRef.current[sectionHistoryRef.current.length - 1]?.section ??
        'dashboard';
      const guard = sectionGuardsRef.current[activeSec];
      if (guard && guard.isDirty()) {
        return {
          dirty: true,
          message: guard.dirtyMessage || DEFAULT_DIRTY_MESSAGE,
          onDiscard: guard.onDiscard,
        };
      }
      return { dirty: false, message: '' };
    },
    []
  );

  const executeBackImmediate = useCallback(
    (fromBrowserPop: boolean) => {
      const currentOverlays = overlaysRef.current;
      if (currentOverlays.length > 0) {
        const top = currentOverlays[currentOverlays.length - 1];
        top.onDiscard?.();
        const nextOverlays = currentOverlays.filter((o) => o.key !== top.key);
        overlaysRef.current = nextOverlays;
        setOverlays(nextOverlays);
        if (!fromBrowserPop) {
          popBrowserHistory();
        }
        top.onClose();
        return;
      }

      const hist = sectionHistoryRef.current;
      if (hist.length > 1) {
        const curSec = hist[hist.length - 1].section;
        sectionGuardsRef.current[curSec]?.onDiscard?.();
        const nextHist = hist.slice(0, -1);
        sectionHistoryRef.current = nextHist;
        setSectionHistory(nextHist);
        if (!fromBrowserPop) {
          popBrowserHistory();
        }
      }
    },
    [popBrowserHistory]
  );

  const goBack = useCallback(
    (forceDiscard = false) => {
      if (pendingConfirmRef.current && !forceDiscard) {
        setPendingConfirm(null);
        return;
      }

      const currentOverlays = overlaysRef.current;
      if (currentOverlays.length > 0) {
        if (!forceDiscard) {
          const overlayDirty = getDirtyForTopOverlay();
          if (overlayDirty?.dirty) {
            setPendingConfirm({
              message: overlayDirty.message,
              onConfirm: () => {
                setPendingConfirm(null);
                executeBackImmediate(false);
              },
            });
            return;
          }
        }
        executeBackImmediate(false);
        return;
      }

      const hist = sectionHistoryRef.current;
      if (hist.length <= 1) return;

      if (!forceDiscard) {
        const secDirty = getDirtyForCurrentSection();
        if (secDirty.dirty) {
          setPendingConfirm({
            message: secDirty.message,
            onConfirm: () => {
              setPendingConfirm(null);
              executeBackImmediate(false);
            },
          });
          return;
        }
      }

      executeBackImmediate(false);
    },
    [executeBackImmediate, getDirtyForCurrentSection, getDirtyForTopOverlay]
  );

  const performNavigateImmediate = useCallback(
    (section: NavSection, subTab?: string) => {
      const normalized: NavEntry = {
        section,
        subTab: subTab ?? DEFAULT_SUBTABS[section],
      };

      // Close any open overlays cleanly if user picks a sidebar/bottom nav destination
      if (overlaysRef.current.length > 0) {
        const toClose = [...overlaysRef.current].reverse();
        overlaysRef.current = [];
        setOverlays([]);
        for (const o of toClose) {
          popBrowserHistory();
          o.onClose();
        }
      }

      const hist = sectionHistoryRef.current;
      const top = hist[hist.length - 1];
      if (top && isSameEntry(top, normalized)) {
        return;
      }

      if (section === 'dashboard') {
        const nextHist: NavEntry[] = [{ section: 'dashboard' }];
        sectionHistoryRef.current = nextHist;
        setSectionHistory(nextHist);
        if (hist.length > 1) {
          popBrowserHistory();
        }
        window.scrollTo({ top: 0, behavior: 'auto' });
        return;
      }

      // Keep root as dashboard and replace current active tab so Back from any tab returns directly to home
      const nextHist: NavEntry[] = [{ section: 'dashboard' }, normalized];
      sectionHistoryRef.current = nextHist;
      setSectionHistory(nextHist);
      if (hist.length <= 1) {
        pushBrowserHistory();
      }
      window.scrollTo({ top: 0, behavior: 'auto' });
    },
    [popBrowserHistory, pushBrowserHistory]
  );

  const navigateTo = useCallback(
    (section: NavSection, subTab?: string) => {
      const normalized: NavEntry = {
        section,
        subTab: subTab ?? DEFAULT_SUBTABS[section],
      };
      const hist = sectionHistoryRef.current;
      const top = hist[hist.length - 1];
      if (
        overlaysRef.current.length === 0 &&
        top &&
        isSameEntry(top, normalized)
      ) {
        return;
      }

      // Check overlay dirty first, then current section dirty
      const overlayDirty = getDirtyForTopOverlay();
      const secDirty = getDirtyForCurrentSection();

      const activeDirty = overlayDirty?.dirty
        ? overlayDirty
        : secDirty.dirty
        ? secDirty
        : null;

      if (activeDirty) {
        setPendingConfirm({
          message: activeDirty.message,
          onConfirm: () => {
            setPendingConfirm(null);
            activeDirty.onDiscard?.();
            performNavigateImmediate(section, subTab);
          },
        });
        return;
      }

      performNavigateImmediate(section, subTab);
    },
    [getDirtyForCurrentSection, getDirtyForTopOverlay, performNavigateImmediate]
  );

  const setSubTab = useCallback(
    (subTab: string) => {
      const hist = sectionHistoryRef.current;
      const top = hist[hist.length - 1];
      if (!top) return;
      navigateTo(top.section, subTab);
    },
    [navigateTo]
  );

  const requestGuard = useCallback(
    (action: () => void, scopeSection?: NavSection) => {
      const overlayDirty = getDirtyForTopOverlay();
      const secDirty = getDirtyForCurrentSection(scopeSection);
      const activeDirty = overlayDirty?.dirty
        ? overlayDirty
        : secDirty.dirty
        ? secDirty
        : null;

      if (activeDirty) {
        setPendingConfirm({
          message: activeDirty.message,
          onConfirm: () => {
            setPendingConfirm(null);
            activeDirty.onDiscard?.();
            action();
          },
        });
        return;
      }
      action();
    },
    [getDirtyForCurrentSection, getDirtyForTopOverlay]
  );

  const resetHistoryToDashboard = useCallback(() => {
    overlaysRef.current = [];
    setOverlays([]);
    pendingConfirmRef.current = null;
    setPendingConfirm(null);
    exitConfirmOpenRef.current = false;
    setExitConfirmOpen(false);
    const initial: NavEntry[] = [{ section: 'dashboard' }];
    sectionHistoryRef.current = initial;
    setSectionHistory(initial);
    pendingDeltaRef.current = 0;
    seqRef.current = 0;
    try {
      window.history.replaceState({ alhussamNav: true, seq: 0 }, '');
    } catch {
      // ignore
    }
  }, []);

  // Handle Browser Back / Forward (`popstate`)
  useEffect(() => {
    const onPopState = (e: PopStateEvent) => {
      if (suppressNextPopRef.current > 0) {
        suppressNextPopRef.current -= 1;
        return;
      }

      const targetSeq =
        e.state && e.state.alhussamNav && typeof e.state.seq === 'number'
          ? e.state.seq
          : 0;

      // User pressed Browser Back
      if (targetSeq < seqRef.current) {
        const hasMore =
          overlaysRef.current.length > 0 || sectionHistoryRef.current.length > 1;

        if (!hasMore) {
          // Stay safely at root and ask user whether to exit the app
          seqRef.current = 0;
          try {
            window.history.pushState({ alhussamNav: true, seq: 0 }, '');
          } catch {
            // ignore
          }
          setExitConfirmOpen(true);
          return;
        }

        const overlayDirty = getDirtyForTopOverlay();
        const secDirty =
          overlaysRef.current.length === 0
            ? getDirtyForCurrentSection()
            : { dirty: false, message: '' };
        const activeDirty = overlayDirty?.dirty
          ? overlayDirty
          : secDirty.dirty
          ? secDirty
          : null;

        if (activeDirty) {
          // Restore browser history entry so we don't leave without confirmation
          try {
            window.history.pushState(
              { alhussamNav: true, seq: seqRef.current },
              ''
            );
          } catch {
            // ignore
          }
          setPendingConfirm({
            message: activeDirty.message,
            onConfirm: () => {
              setPendingConfirm(null);
              executeBackImmediate(false);
            },
          });
          return;
        }

        const steps = Math.max(1, seqRef.current - targetSeq);
        seqRef.current = targetSeq;
        for (let i = 0; i < steps; i++) {
          if (
            overlaysRef.current.length === 0 &&
            sectionHistoryRef.current.length <= 1
          ) {
            break;
          }
          executeBackImmediate(true);
        }
        return;
      }

      // User pressed Browser Forward beyond known app state: normalize back to current depth
      if (targetSeq > seqRef.current) {
        try {
          window.history.replaceState(
            { alhussamNav: true, seq: seqRef.current },
            ''
          );
        } catch {
          // ignore
        }
      }
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [executeBackImmediate, getDirtyForCurrentSection, getDirtyForTopOverlay]);

  // Warn before closing/refreshing browser tab if unsaved changes exist
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      const overlayDirty = getDirtyForTopOverlay();
      const secDirty = getDirtyForCurrentSection();
      if (overlayDirty?.dirty || secDirty.dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [getDirtyForCurrentSection, getDirtyForTopOverlay]);

  // Handle Escape key for overlays & dialogs on desktop
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (exitConfirmOpenRef.current) {
        e.preventDefault();
        setExitConfirmOpen(false);
        return;
      }
      if (pendingConfirmRef.current) {
        e.preventDefault();
        setPendingConfirm(null);
        return;
      }
      if (overlaysRef.current.length > 0) {
        e.preventDefault();
        goBack(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [goBack]);

  // Android Hardware Back Bridge (`window.__ALHUSSAM_ON_ANDROID_BACK__`)
  useEffect(() => {
    window.__ALHUSSAM_ON_ANDROID_BACK__ = () => {
      if (exitConfirmOpenRef.current) {
        setExitConfirmOpen(false);
        return;
      }

      if (pendingConfirmRef.current) {
        setPendingConfirm(null);
        return;
      }

      if (
        overlaysRef.current.length > 0 ||
        sectionHistoryRef.current.length > 1
      ) {
        goBack(false);
        return;
      }

      // Root screen (home page): show exit confirmation dialog (نعم / لا)
      setExitConfirmOpen(true);
    };

    return () => {
      delete window.__ALHUSSAM_ON_ANDROID_BACK__;
    };
  }, [goBack]);

  const handleConfirmExitApp = useCallback(() => {
    setExitConfirmOpen(false);
    if (window.AndroidNavBridge?.exitApp) {
      window.AndroidNavBridge.exitApp();
      return;
    }
    try {
      window.close();
    } catch {
      // Ignore browser window.close restrictions
    }
  }, []);

  const currentEntry = sectionHistory[sectionHistory.length - 1] || {
    section: 'dashboard' as NavSection,
  };
  const previousEntry =
    sectionHistory.length > 1 ? sectionHistory[sectionHistory.length - 2] : null;
  const canGoBack = overlays.length > 0 || sectionHistory.length > 1;

  const value = useMemo<NavigationContextValue>(
    () => ({
      currentEntry,
      activeSection: currentEntry.section,
      activeSubTab: currentEntry.subTab ?? DEFAULT_SUBTABS[currentEntry.section],
      sectionHistory,
      previousEntry,
      canGoBack,
      hasActiveOverlay: overlays.length > 0,
      navigateTo,
      setSubTab,
      goBack,
      requestGuard,
      resetHistoryToDashboard,
      registerOverlay,
      unregisterOverlay,
      registerSectionGuard,
    }),
    [
      canGoBack,
      currentEntry,
      goBack,
      navigateTo,
      overlays.length,
      previousEntry,
      registerOverlay,
      registerSectionGuard,
      requestGuard,
      resetHistoryToDashboard,
      sectionHistory,
      setSubTab,
      unregisterOverlay,
    ]
  );

  return (
    <NavigationContext.Provider value={value}>
      {children}

      {/* Unsaved Changes Confirmation Dialog */}
      {pendingConfirm && (
        <div
          className="fixed inset-0 z-[100] bg-slate-950/55 backdrop-blur-[2px] flex items-end sm:items-center justify-center p-0 sm:p-4 no-print"
          role="alertdialog"
          aria-modal="true"
          aria-label="تأكيد الخروج"
        >
          <div className="bg-white border border-slate-200 rounded-t-2xl sm:rounded-2xl w-full max-w-md p-5 sm:p-6 space-y-5 shadow-2xl">
            <div className="flex items-start gap-3.5">
              <div className="w-11 h-11 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-slate-900">
                  تنبيه تغييرات غير محفوظة
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  {pendingConfirm.message}
                </p>
              </div>
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={pendingConfirm.onConfirm}
                className="w-full sm:w-auto min-h-[44px] px-4 py-2.5 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 border border-red-200 rounded-xl transition-colors cursor-pointer whitespace-nowrap"
              >
                الخروج دون حفظ
              </button>
              <button
                type="button"
                onClick={() => setPendingConfirm(null)}
                className="w-full sm:w-auto min-h-[44px] inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-white bg-emerald-700 hover:bg-emerald-800 rounded-xl transition-colors cursor-pointer whitespace-nowrap"
              >
                <ArrowRight className="w-3.5 h-3.5" />
                <span>البقاء ومتابعة العمل</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Exit App Confirmation Dialog */}
      {exitConfirmOpen && (
        <div
          className="fixed inset-0 z-[100] bg-slate-950/55 backdrop-blur-[2px] flex items-end sm:items-center justify-center p-0 sm:p-4 no-print"
          role="alertdialog"
          aria-modal="true"
          aria-label="تأكيد إغلاق التطبيق"
        >
          <div className="bg-white border border-slate-200 rounded-t-2xl sm:rounded-2xl w-full max-w-sm p-5 sm:p-6 space-y-5 shadow-2xl">
            <div className="flex items-start gap-3.5">
              <div className="w-11 h-11 rounded-xl bg-red-50 border border-red-200 text-red-600 flex items-center justify-center shrink-0">
                <Power className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-bold text-slate-900">
                  إغلاق التطبيق
                </h3>
                <p className="text-sm text-slate-600 leading-relaxed">
                  هل تريد اغلاق التطبيق؟
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setExitConfirmOpen(false)}
                className="min-h-[44px] px-4 py-2.5 text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-xl transition-colors cursor-pointer whitespace-nowrap"
              >
                لا
              </button>
              <button
                type="button"
                onClick={handleConfirmExitApp}
                className="min-h-[44px] px-4 py-2.5 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-xl transition-colors cursor-pointer whitespace-nowrap"
              >
                نعم
              </button>
            </div>
          </div>
        </div>
      )}
    </NavigationContext.Provider>
  );
};

export function useNavigation(): NavigationContextValue {
  const ctx = useContext(NavigationContext);
  if (!ctx) {
    throw new Error('useNavigation must be used inside NavigationProvider');
  }
  return ctx;
}

/**
 * Registers a modal, drawer, or sub-screen with the unified Back stack
 * so Top Bar Back, Browser Back, Esc, and Android Back all close it in LIFO order.
 */
export function useBackLayer({
  id,
  active,
  onClose,
  isDirty,
  dirtyMessage,
  onDiscard,
}: BackLayerOptions): () => void {
  const { registerOverlay, unregisterOverlay, goBack } = useNavigation();
  const keyRef = useRef<string>(
    `${id}_${Math.random().toString(36).slice(2, 9)}`
  );

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;
  const dirtyMessageRef = useRef(dirtyMessage);
  dirtyMessageRef.current = dirtyMessage;
  const onDiscardRef = useRef(onDiscard);
  onDiscardRef.current = onDiscard;

  useEffect(() => {
    const key = keyRef.current;
    if (!active) {
      unregisterOverlay(key, false);
      return;
    }

    registerOverlay({
      key,
      id,
      onClose: () => onCloseRef.current(),
      isDirty: () => (isDirtyRef.current ? isDirtyRef.current() : false),
      dirtyMessage: dirtyMessageRef.current,
      onDiscard: () => onDiscardRef.current?.(),
    });

    return () => {
      unregisterOverlay(key, false);
    };
  }, [active, id, registerOverlay, unregisterOverlay]);

  return useCallback(() => {
    goBack(false);
  }, [goBack]);
}

/**
 * Registers an unsaved-changes guard for a main section (e.g., POS cart, Stocktake form, Purchase draft).
 */
export function useSectionDirtyGuard(
  section: NavSection,
  config: SectionGuardConfig | null
) {
  const { registerSectionGuard } = useNavigation();
  const isDirtyRef = useRef(config?.isDirty);
  isDirtyRef.current = config?.isDirty;
  const dirtyMessageRef = useRef(config?.dirtyMessage);
  dirtyMessageRef.current = config?.dirtyMessage;
  const onDiscardRef = useRef(config?.onDiscard);
  onDiscardRef.current = config?.onDiscard;

  const active = Boolean(config);

  useEffect(() => {
    if (!active) {
      registerSectionGuard(section, null);
      return;
    }
    registerSectionGuard(section, {
      isDirty: () => (isDirtyRef.current ? isDirtyRef.current() : false),
      dirtyMessage: dirtyMessageRef.current,
      onDiscard: () => onDiscardRef.current?.(),
    });
    return () => {
      registerSectionGuard(section, null);
    };
  }, [active, registerSectionGuard, section]);
}
