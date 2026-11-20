import React from 'react';
import { ArrowRight } from 'lucide-react';

interface BackButtonProps {
  onClick: () => void;
  label?: string;
  compact?: boolean;
  className?: string;
  title?: string;
}

/**
 * Unified RTL Back Button used consistently across main sub-page top bars,
 * detail screens, modals, and sub-forms.
 */
export const BackButton: React.FC<BackButtonProps> = ({
  onClick,
  label = 'رجوع',
  compact = false,
  className = '',
  title = 'العودة إلى الصفحة السابقة',
}) => {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={label}
      className={`group inline-flex items-center justify-center gap-1.5 ${
        compact ? 'px-2.5 py-1.5 min-h-[40px]' : 'px-3 py-1.5 min-h-[42px]'
      } rounded-xl border border-slate-200/90 bg-white hover:bg-emerald-50 hover:border-emerald-300 active:bg-emerald-100 text-slate-800 hover:text-emerald-900 text-xs font-semibold shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-all duration-150 cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 ${className}`}
    >
      <span className="w-6 h-6 rounded-lg bg-slate-100 group-hover:bg-emerald-700 text-slate-700 group-hover:text-white flex items-center justify-center transition-colors shrink-0">
        <ArrowRight className="w-3.5 h-3.5" />
      </span>
      <span>{label}</span>
    </button>
  );
};

interface ModalSubPageHeaderProps {
  title: string;
  subtitle?: string;
  onBack: () => void;
  backLabel?: string;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

/**
 * Unified RTL top header bar for sub-pages, detail modals, and form dialogs.
 * Places the unified BackButton at the leading RTL edge, clear title in the middle,
 * and contextual actions on the trailing edge without clutter.
 */
export const ModalSubPageHeader: React.FC<ModalSubPageHeaderProps> = ({
  title,
  subtitle,
  onBack,
  backLabel = 'رجوع',
  badge,
  actions,
  className = '',
}) => {
  return (
    <div
      className={`px-4 sm:px-6 py-3.5 border-b border-slate-200/80 bg-white flex flex-wrap items-center justify-between gap-2.5 shrink-0 no-print ${className}`}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <BackButton onClick={onBack} label={backLabel} compact />
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm sm:text-base font-bold text-slate-900 truncate">
              {title}
            </h3>
            {badge}
          </div>
          {subtitle && (
            <p className="text-[11px] sm:text-xs text-slate-500 mt-0.5 truncate">
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {actions && (
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 flex-wrap">
          {actions}
        </div>
      )}
    </div>
  );
};

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  onBack?: () => void;
  backLabel?: string;
  className?: string;
}

/**
 * Unified top section header for main workspace views and sub-pages.
 */
export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  subtitle,
  actions,
  onBack,
  backLabel = 'رجوع',
  className = '',
}) => {
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 sm:gap-4 ${className}`}>
      <div className="flex items-center gap-3 min-w-0">
        {onBack && <BackButton onClick={onBack} label={backLabel} compact />}
        <div className="min-w-0">
          <h1 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight truncate">
            {title}
          </h1>
          {subtitle && (
            <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          {actions}
        </div>
      )}
    </div>
  );
};
