import { useEffect, useRef } from 'react';
import { normalizeBarcode } from '../utils/barcode';

interface UseHardwareBarcodeScannerOptions {
  enabled: boolean;
  onScan: (barcode: string) => void;
  /** Optional element ref whose own form handles Enter directly; global capture skips it. */
  skipElementRef?: React.RefObject<HTMLElement | null>;
}

/**
 * Listens globally for fast keystrokes emitted by USB / Bluetooth HID keyboard-wedge barcode scanners
 * terminated by Enter or Tab, without interfering with normal human typing in form inputs.
 */
export function useHardwareBarcodeScanner({
  enabled,
  onScan,
  skipElementRef,
}: UseHardwareBarcodeScannerOptions): void {
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  const bufferRef = useRef('');
  const lastKeyTimeRef = useRef(0);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const clearBuffer = () => {
      bufferRef.current = '';
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const target = e.target as HTMLElement | null;
      if (target) {
        if (skipElementRef?.current && target === skipElementRef.current) {
          return;
        }
        const tag = target.tagName;
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          target.isContentEditable
        ) {
          return;
        }
      }

      const now = Date.now();

      if (e.key === 'Enter' || e.key === 'Tab') {
        const scanned = normalizeBarcode(bufferRef.current);
        if (scanned.length >= 2 && now - lastKeyTimeRef.current <= 220) {
          e.preventDefault();
          e.stopPropagation();
          clearBuffer();
          onScanRef.current(scanned);
          return;
        }
        clearBuffer();
        return;
      }

      if (e.key.length === 1) {
        if (now - lastKeyTimeRef.current > 200) {
          bufferRef.current = '';
        }
        bufferRef.current += e.key;
        lastKeyTimeRef.current = now;

        if (resetTimerRef.current !== null) {
          window.clearTimeout(resetTimerRef.current);
        }
        resetTimerRef.current = window.setTimeout(() => {
          bufferRef.current = '';
          resetTimerRef.current = null;
        }, 280);
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      clearBuffer();
    };
  }, [enabled, skipElementRef]);
}
