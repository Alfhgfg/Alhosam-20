import React from 'react';
import type { StoreLogoMode } from '../types';

interface StoreBrandLogoProps {
  mode?: StoreLogoMode;
  customDataUrl?: string;
  storeName: string;
  compact?: boolean;
  monochrome?: boolean;
}

export const StoreBrandLogo: React.FC<StoreBrandLogoProps> = ({
  mode = 'default',
  customDataUrl,
  storeName,
  compact = false,
  monochrome = false,
}) => {
  if (mode === 'none') return null;

  const boxSize = compact ? 'w-11 h-11' : 'w-14 h-14';

  if (mode === 'custom' && customDataUrl) {
    return (
      <div
        className={`${boxSize} rounded-xl border border-slate-200 bg-white flex items-center justify-center overflow-hidden shrink-0 p-1`}
      >
        <img
          src={customDataUrl}
          alt={storeName}
          className="w-full h-full object-contain"
        />
      </div>
    );
  }

  if (mode === 'minimal' || monochrome) {
    return (
      <div
        className={`${boxSize} rounded-xl border-2 border-slate-900 bg-white text-slate-900 flex flex-col items-center justify-center shrink-0`}
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 48 48"
          className={compact ? 'w-7 h-7' : 'w-9 h-9'}
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M8 17L12 9H36L40 17"
            stroke="currentColor"
            strokeWidth="2.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M7 17H41C41 20.5 38.4 23 35.5 23C32.6 23 30 20.5 30 17C30 20.5 27.3 23 24 23C20.7 23 18 20.5 18 17C18 20.5 15.4 23 12.5 23C9.6 23 7 20.5 7 17Z"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinejoin="round"
          />
          <path
            d="M11 23V38H37V23"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M20 38V29H28V38"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    );
  }

  // Default crafted commercial emblem for بقالة الحسام
  return (
    <div
      className={`${boxSize} rounded-xl bg-emerald-800 text-white border border-emerald-900 flex items-center justify-center shrink-0 relative overflow-hidden`}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 56 56"
        className={compact ? 'w-8 h-8' : 'w-10 h-10'}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <rect
          x="4"
          y="4"
          width="48"
          height="48"
          rx="10"
          stroke="#A7F3D0"
          strokeOpacity="0.45"
          strokeWidth="1.5"
        />
        <path
          d="M12 21L16.5 12H39.5L44 21"
          stroke="#FFFFFF"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M11 21H45C45 24.5 42.3 27 39.2 27C36.1 27 33.5 24.5 33.5 21C33.5 24.5 31 27 28 27C25 27 22.5 24.5 22.5 21C22.5 24.5 19.9 27 16.8 27C13.7 27 11 24.5 11 21Z"
          fill="#10B981"
          fillOpacity="0.32"
          stroke="#FFFFFF"
          strokeWidth="2.2"
          strokeLinejoin="round"
        />
        <path
          d="M15 27.5V43H41V27.5"
          stroke="#FFFFFF"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M23.5 43V33.5H32.5V43"
          stroke="#A7F3D0"
          strokeWidth="2.4"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
};
