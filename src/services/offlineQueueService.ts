import { Capacitor } from '@capacitor/core';
import { Network } from '@capacitor/network';
import type { PendingOperation, SyncMetaState } from '../types';
import { localDbService } from './localDbService';

const LEGACY_STORAGE_KEY = 'alhussam_pending_ops_v1';
export const PENDING_OPS_EVENT = 'alhussam:pending-ops-changed';
export const SYNC_META_EVENT = 'alhussam:sync-meta-changed';

let memoryOpsCache: PendingOperation[] = [];
let memorySyncMeta: SyncMetaState = {
  lastSuccessfulSyncIso: null,
  lastSyncError: null,
  totalSyncedCount: 0,
};
let seqCounter = Date.now();
let initialized = false;
let initPromise: Promise<void> | null = null;
let liveOnlineFlag = typeof navigator !== 'undefined' ? navigator.onLine : true;

function emitOpsChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(PENDING_OPS_EVENT));
  }
}

function emitMetaChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SYNC_META_EVENT));
  }
}

export function setNetworkOnlineState(online: boolean): void {
  liveOnlineFlag = online;
}

export function isAppOnline(): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return false;
  }
  return liveOnlineFlag;
}

export async function refreshNativeNetworkStatus(): Promise<boolean> {
  if (Capacitor.isNativePlatform()) {
    try {
      const status = await Network.getStatus();
      liveOnlineFlag = Boolean(status.connected);
      return liveOnlineFlag;
    } catch {
      // fallback to navigator.onLine
    }
  }
  liveOnlineFlag = typeof navigator !== 'undefined' ? navigator.onLine : true;
  return liveOnlineFlag;
}

function nextSeq(): number {
  const now = Date.now();
  seqCounter = now > seqCounter ? now : seqCounter + 1;
  return seqCounter;
}

export async function initOfflineQueue(): Promise<void> {
  if (initialized) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    await localDbService.init();

    // Migrate any legacy localStorage queue items into persistent SQLite/IndexedDB and clean up localStorage
    try {
      if (typeof localStorage !== 'undefined') {
        const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
        if (legacyRaw) {
          const parsed = JSON.parse(legacyRaw);
          if (Array.isArray(parsed)) {
            for (const item of parsed as PendingOperation[]) {
              if (item && item.operationId) {
                const withSeq: PendingOperation = {
                  ...item,
                  seq: typeof item.seq === 'number' ? item.seq : nextSeq(),
                };
                await localDbService.putPendingOperation(withSeq);
              }
            }
          }
          localStorage.removeItem(LEGACY_STORAGE_KEY);
        }
      }
    } catch {
      // ignore storage access issues
    }

    memoryOpsCache = await localDbService.getPendingOperations();
    for (const op of memoryOpsCache) {
      if (typeof op.seq === 'number' && op.seq > seqCounter) {
        seqCounter = op.seq;
      }
    }

    // Reset any interrupted 'syncing' status left over from an abrupt app close back to 'pending'
    let recovered = false;
    memoryOpsCache = await Promise.all(
      memoryOpsCache.map(async (op) => {
        if (op.status === 'syncing') {
          recovered = true;
          const fixed: PendingOperation = { ...op, status: 'pending' };
          await localDbService.putPendingOperation(fixed);
          return fixed;
        }
        return op;
      })
    );

    memorySyncMeta = await localDbService.getSyncMetaState();
    await refreshNativeNetworkStatus();

    initialized = true;
    if (recovered || memoryOpsCache.length > 0) {
      emitOpsChanged();
    }
    emitMetaChanged();
  })();

  return initPromise;
}

export function loadAllQueueOperations(): PendingOperation[] {
  return [...memoryOpsCache];
}

export function loadPendingOperations(): PendingOperation[] {
  return memoryOpsCache.filter((op) => op.status !== 'synced');
}

export function getSyncMetaCache(): SyncMetaState {
  return { ...memorySyncMeta };
}

export async function updateSyncMeta(patch: Partial<SyncMetaState>): Promise<SyncMetaState> {
  await initOfflineQueue();
  memorySyncMeta = await localDbService.saveSyncMetaState(patch);
  emitMetaChanged();
  return memorySyncMeta;
}

export async function enqueuePendingOperation(
  op: PendingOperation
): Promise<PendingOperation[]> {
  if (memoryOpsCache.some((item) => item.operationId === op.operationId)) {
    return loadPendingOperations();
  }
  const withSeq: PendingOperation = {
    ...op,
    seq: typeof op.seq === 'number' ? op.seq : nextSeq(),
  };
  memoryOpsCache = [...memoryOpsCache, withSeq];
  emitOpsChanged();

  await localDbService.init();
  await localDbService.putPendingOperation(withSeq);
  return loadPendingOperations();
}

export async function updatePendingOperation(
  operationId: string,
  patch: Partial<PendingOperation>
): Promise<PendingOperation[]> {
  let updatedOp: PendingOperation | null = null;
  memoryOpsCache = memoryOpsCache.map((item) => {
    if (item.operationId === operationId) {
      updatedOp = { ...item, ...patch };
      return updatedOp;
    }
    return item;
  });
  emitOpsChanged();

  if (updatedOp) {
    await localDbService.init();
    await localDbService.putPendingOperation(updatedOp);
  }
  return loadPendingOperations();
}

export async function markOperationSynced(
  operationId: string,
  resolvedReferenceId?: string,
  resolvedReferenceNumber?: string
): Promise<PendingOperation[]> {
  const syncedAtIso = new Date().toISOString();
  let updatedOp: PendingOperation | null = null;
  memoryOpsCache = memoryOpsCache.map((item) => {
    if (item.operationId === operationId) {
      updatedOp = {
        ...item,
        status: 'synced',
        errorMessage: undefined,
        syncedAtIso,
        resolvedReferenceId,
        resolvedReferenceNumber,
      };
      return updatedOp;
    }
    return item;
  });
  emitOpsChanged();

  await localDbService.init();
  if (updatedOp) {
    await localDbService.putPendingOperation(updatedOp);
    await localDbService.pruneOldSyncedOperations(200);
  }
  memorySyncMeta = await localDbService.saveSyncMetaState({
    lastSuccessfulSyncIso: syncedAtIso,
    lastSyncError: null,
    totalSyncedCount: memorySyncMeta.totalSyncedCount + 1,
  });
  emitMetaChanged();

  return loadPendingOperations();
}

export async function removePendingOperation(
  operationId: string
): Promise<PendingOperation[]> {
  memoryOpsCache = memoryOpsCache.filter((item) => item.operationId !== operationId);
  emitOpsChanged();

  await localDbService.init();
  await localDbService.deletePendingOperation(operationId);
  return loadPendingOperations();
}

export async function reloadQueueFromDbForTests(): Promise<void> {
  initialized = false;
  initPromise = null;
  memoryOpsCache = [];
  await initOfflineQueue();
}

export function computeReservedStockMap(ops: PendingOperation[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const op of ops) {
    if (op.status === 'conflict' || op.status === 'synced') continue;
    if (op.type === 'sale') {
      const items = (op.payload.items as Array<{ productId?: string; qty?: number }>) || [];
      for (const it of items) {
        if (it.productId && typeof it.qty === 'number' && it.qty > 0) {
          map.set(it.productId, (map.get(it.productId) || 0) + it.qty);
        }
      }
    } else if (op.type === 'stock_adjust') {
      const productId = op.payload.productId as string | undefined;
      const mode = op.payload.mode as string | undefined;
      const qty = op.payload.quantityOrActual as number | undefined;
      if (productId && mode === 'out' && typeof qty === 'number' && qty > 0) {
        map.set(productId, (map.get(productId) || 0) + qty);
      }
    }
  }
  return map;
}

export function isNetworkOrOfflineError(err: unknown): boolean {
  if (!isAppOnline()) {
    return true;
  }
  const code =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code?: unknown }).code || '').toLowerCase()
      : '';
  const msg = (
    err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  ).toLowerCase();

  if (
    code === 'permission-denied' ||
    code === 'invalid-argument' ||
    code === 'unauthenticated' ||
    code === 'failed-precondition'
  ) {
    return false;
  }

  if (code === 'unavailable' || code === 'deadline-exceeded') {
    return true;
  }

  return (
    msg.includes('offline') ||
    msg.includes('client is offline') ||
    msg.includes('unavailable') ||
    msg.includes('network') ||
    msg.includes('failed to fetch') ||
    msg.includes('load failed') ||
    msg.includes('timeout') ||
    msg.includes('network_timeout') ||
    msg.includes('transport errored') ||
    msg.includes('could not reach cloud firestore')
  );
}
