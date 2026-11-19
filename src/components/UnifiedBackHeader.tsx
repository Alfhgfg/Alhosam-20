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
      className={`inline-flex items-center justify-center gap-1.5 ${
        compact ? 'px-2.5 py-1.5 min-h-[38px]' : 'px-3 py-1.5 min-h-[40px]'
      } rounded-xl border border-slate-200 bg-slate-100 hover:bg-slate-200 active:bg-slate-300 text-slate-800 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 ${className}`}
    >
      <ArrowRight className="w-4 h-4 shrink-0 text-slate-700" />
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
      className={`px-4 sm:px-6 py-3.5 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-2.5 shrink-0 no-print ${className}`}
    >
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <BackButton onClick={onBack} label={backLabel} />
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm sm:text-base font-bold text-slate-900 truncate">
              {title}
            </h3>
            {badge}
          </div>
          {subtitle && (
            <p className="text-[11px] text-slate-500 mt-0.5 truncate">
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
