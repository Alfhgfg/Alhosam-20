import { Capacitor } from '@capacitor/core';
import {
  CapacitorSQLite,
  SQLiteConnection,
  type SQLiteDBConnection,
} from '@capacitor-community/sqlite';
import type { LocalDbEngine, PendingOperation, SyncMetaState } from '../types';

export type LocalCollectionName =
  | 'settings'
  | 'counters'
  | 'products'
  | 'customers'
  | 'suppliers'
  | 'sales'
  | 'purchases'
  | 'returns'
  | 'stock_movements'
  | 'expenses'
  | 'vouchers'
  | 'cash_transactions'
  | 'audit_logs'
  | 'users'
  | 'staff_invites'
  | 'devices';

const SQLITE_DB_NAME = 'alhussam_pos_db';
const IDB_NAME = 'alhussam_pos_idb_v1';
const IDB_VERSION = 1;

const STORE_ENTITIES = 'entities';
const STORE_PENDING_OPS = 'pending_operations';
const STORE_AUTH_CACHE = 'auth_cache';
const STORE_SYNC_META = 'sync_meta';

/**
 * Timestamp-compatible wrapper for rehydrated Firestore timestamps & offline timestamps.
 * Implements the methods used throughout the app (.toDate(), .toMillis(), .seconds, .nanoseconds).
 */
export class LocalTimestamp {
  readonly seconds: number;
  readonly nanoseconds: number;
  private readonly ms: number;

  constructor(ms: number) {
    this.ms = Number.isFinite(ms) ? ms : Date.now();
    this.seconds = Math.floor(this.ms / 1000);
    this.nanoseconds = Math.round((this.ms - this.seconds * 1000) * 1_000_000);
  }

  toDate(): Date {
    return new Date(this.ms);
  }

  toMillis(): number {
    return this.ms;
  }

  isEqual(other: { toMillis?: () => number } | null | undefined): boolean {
    return Boolean(other && typeof other.toMillis === 'function' && other.toMillis() === this.ms);
  }

  valueOf(): string {
    return String(this.ms);
  }
}

export function makeLocalTimestamp(ms: number = Date.now()): LocalTimestamp {
  return new LocalTimestamp(ms);
}

export function serializeValueForDb(val: unknown): unknown {
  if (val === null || val === undefined) return val;
  if (typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    if (typeof obj.toMillis === 'function') {
      return { __alhussamTsMs: (obj.toMillis as () => number)() };
    }
    if (val instanceof Date) {
      return { __alhussamTsMs: val.getTime() };
    }
    if (Array.isArray(val)) {
      return val.map((item) => serializeValueForDb(item));
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v !== undefined) {
        out[k] = serializeValueForDb(v);
      }
    }
    return out;
  }
  return val;
}

export function hydrateValueFromDb(val: unknown): unknown {
  if (val === null || val === undefined) return val;
  if (typeof val === 'object') {
    if (Array.isArray(val)) {
      return val.map((item) => hydrateValueFromDb(item));
    }
    const obj = val as Record<string, unknown>;
    if (
      typeof obj.__alhussamTsMs === 'number' &&
      Object.keys(obj).length === 1
    ) {
      return new LocalTimestamp(obj.__alhussamTsMs);
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = hydrateValueFromDb(v);
    }
    return out;
  }
  return val;
}

interface EntityRecordRow {
  compositeKey: string;
  collectionName: LocalCollectionName;
  docId: string;
  dataJson: string;
  updatedMs: number;
}

interface AuthCacheRow {
  key: string;
  dataJson: string;
  updatedMs: number;
}

interface SyncMetaRow {
  key: string;
  valueJson: string;
}

interface BackendDriver {
  engine: LocalDbEngine;
  init(): Promise<void>;
  getCollection<T>(collectionName: LocalCollectionName): Promise<T[]>;
  replaceCollection<T extends { id?: string }>(
    collectionName: LocalCollectionName,
    docs: T[],
    idSelector?: (doc: T) => string
  ): Promise<void>;
  upsertEntity<T>(
    collectionName: LocalCollectionName,
    docId: string,
    data: T
  ): Promise<void>;
  deleteEntity(collectionName: LocalCollectionName, docId: string): Promise<void>;
  getPendingOperations(): Promise<PendingOperation[]>;
  putPendingOperation(op: PendingOperation): Promise<void>;
  deletePendingOperation(operationId: string): Promise<void>;
  clearSyncedOperationsOlderThan(maxKeepCount: number): Promise<void>;
  getAuthCache<T>(key: string): Promise<T | null>;
  setAuthCache<T>(key: string, data: T | null): Promise<void>;
  getSyncMeta<T>(key: string): Promise<T | null>;
  setSyncMeta<T>(key: string, value: T): Promise<void>;
  clearAllStoreData(): Promise<void>;
}

// ---------------- SQLITE DRIVER (ANDROID CAPACITOR) ----------------
class CapacitorSqliteDriver implements BackendDriver {
  readonly engine: LocalDbEngine = 'sqlite';
  private sqlite = new SQLiteConnection(CapacitorSQLite);
  private db: SQLiteDBConnection | null = null;
  private initPromise: Promise<void> | null = null;

  async init(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      const ret = await this.sqlite.checkConnectionsConsistency();
      const isConn = (await this.sqlite.isConnection(SQLITE_DB_NAME, false)).result;
      if (ret.result && isConn) {
        this.db = await this.sqlite.retrieveConnection(SQLITE_DB_NAME, false);
      } else {
        this.db = await this.sqlite.createConnection(
          SQLITE_DB_NAME,
          false,
          'no-encryption',
          1,
          false
        );
      }
      await this.db.open();
      await this.db.execute(`
        CREATE TABLE IF NOT EXISTS entities (
          collection_name TEXT NOT NULL,
          doc_id TEXT NOT NULL,
          data_json TEXT NOT NULL,
          updated_ms INTEGER NOT NULL,
          PRIMARY KEY (collection_name, doc_id)
        );
        CREATE INDEX IF NOT EXISTS idx_entities_col ON entities (collection_name);

        CREATE TABLE IF NOT EXISTS pending_operations (
          operation_id TEXT PRIMARY KEY,
          seq INTEGER NOT NULL,
          type TEXT NOT NULL,
          status TEXT NOT NULL,
          data_json TEXT NOT NULL,
          created_at_iso TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_pending_seq ON pending_operations (seq ASC);

        CREATE TABLE IF NOT EXISTS auth_cache (
          cache_key TEXT PRIMARY KEY,
          data_json TEXT NOT NULL,
          updated_ms INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sync_meta (
          meta_key TEXT PRIMARY KEY,
          value_json TEXT NOT NULL
        );
      `);
    })().catch((err) => {
      this.initPromise = null;
      this.db = null;
      throw err;
    });

    return this.initPromise;
  }

  private async conn(): Promise<SQLiteDBConnection> {
    await this.init();
    if (!this.db) throw new Error('SQLite connection not initialized');
    return this.db;
  }

  async getCollection<T>(collectionName: LocalCollectionName): Promise<T[]> {
    const db = await this.conn();
    const res = await db.query(
      'SELECT doc_id, data_json FROM entities WHERE collection_name = ?',
      [collectionName]
    );
    const rows = res.values || [];
    const items: T[] = [];
    for (const r of rows) {
      try {
        const parsed = hydrateValueFromDb(JSON.parse(String(r.data_json))) as Record<
          string,
          unknown
        >;
        if (!parsed.id && r.doc_id) {
          parsed.id = String(r.doc_id);
        }
        items.push(parsed as T);
      } catch {
        // skip corrupted row
      }
    }
    return items;
  }

  async replaceCollection<T extends { id?: string }>(
    collectionName: LocalCollectionName,
    docs: T[],
    idSelector?: (doc: T) => string
  ): Promise<void> {
    const db = await this.conn();
    const now = Date.now();
    const setStatements: { statement: string; values: unknown[] }[] = [
      {
        statement: 'DELETE FROM entities WHERE collection_name = ?',
        values: [collectionName],
      },
    ];
    for (const item of docs) {
      const docId = idSelector ? idSelector(item) : String(item.id || 'main');
      const serialized = JSON.stringify(serializeValueForDb(item));
      setStatements.push({
        statement:
          'INSERT OR REPLACE INTO entities (collection_name, doc_id, data_json, updated_ms) VALUES (?, ?, ?, ?)',
        values: [collectionName, docId, serialized, now],
      });
    }
    await db.executeSet(setStatements, true);
  }

  async upsertEntity<T>(
    collectionName: LocalCollectionName,
    docId: string,
    data: T
  ): Promise<void> {
    const db = await this.conn();
    const serialized = JSON.stringify(serializeValueForDb(data));
    await db.run(
      'INSERT OR REPLACE INTO entities (collection_name, doc_id, data_json, updated_ms) VALUES (?, ?, ?, ?)',
      [collectionName, docId, serialized, Date.now()]
    );
  }

  async deleteEntity(collectionName: LocalCollectionName, docId: string): Promise<void> {
    const db = await this.conn();
    await db.run(
      'DELETE FROM entities WHERE collection_name = ? AND doc_id = ?',
      [collectionName, docId]
    );
  }

  async getPendingOperations(): Promise<PendingOperation[]> {
    const db = await this.conn();
    const res = await db.query(
      'SELECT data_json FROM pending_operations ORDER BY seq ASC, created_at_iso ASC'
    );
    const out: PendingOperation[] = [];
    for (const r of res.values || []) {
      try {
        out.push(JSON.parse(String(r.data_json)) as PendingOperation);
      } catch {
        // ignore invalid row
      }
    }
    return out;
  }

  async putPendingOperation(op: PendingOperation): Promise<void> {
    const db = await this.conn();
    const seq = typeof op.seq === 'number' ? op.seq : Date.now();
    const withSeq: PendingOperation = { ...op, seq };
    await db.run(
      'INSERT OR REPLACE INTO pending_operations (operation_id, seq, type, status, data_json, created_at_iso) VALUES (?, ?, ?, ?, ?, ?)',
      [
        withSeq.operationId,
        seq,
        withSeq.type,
        withSeq.status,
        JSON.stringify(withSeq),
        withSeq.createdAtIso,
      ]
    );
  }

  async deletePendingOperation(operationId: string): Promise<void> {
    const db = await this.conn();
    await db.run('DELETE FROM pending_operations WHERE operation_id = ?', [operationId]);
  }

  async clearSyncedOperationsOlderThan(maxKeepCount: number): Promise<void> {
    const ops = await this.getPendingOperations();
    const synced = ops.filter((o) => o.status === 'synced');
    if (synced.length <= maxKeepCount) return;
    const toRemove = synced.slice(0, synced.length - maxKeepCount);
    const db = await this.conn();
    await db.executeSet(
      toRemove.map((o) => ({
        statement: 'DELETE FROM pending_operations WHERE operation_id = ?',
        values: [o.operationId],
      })),
      true
    );
  }

  async getAuthCache<T>(key: string): Promise<T | null> {
    const db = await this.conn();
    const res = await db.query(
      'SELECT data_json FROM auth_cache WHERE cache_key = ?',
      [key]
    );
    const row = res.values?.[0];
    if (!row?.data_json) return null;
    return hydrateValueFromDb(JSON.parse(String(row.data_json))) as T;
  }

  async setAuthCache<T>(key: string, data: T | null): Promise<void> {
    const db = await this.conn();
    if (data === null) {
      await db.run('DELETE FROM auth_cache WHERE cache_key = ?', [key]);
      return;
    }
    await db.run(
      'INSERT OR REPLACE INTO auth_cache (cache_key, data_json, updated_ms) VALUES (?, ?, ?)',
      [key, JSON.stringify(serializeValueForDb(data)), Date.now()]
    );
  }

  async getSyncMeta<T>(key: string): Promise<T | null> {
    const db = await this.conn();
    const res = await db.query(
      'SELECT value_json FROM sync_meta WHERE meta_key = ?',
      [key]
    );
    const row = res.values?.[0];
    if (!row?.value_json) return null;
    return JSON.parse(String(row.value_json)) as T;
  }

  async setSyncMeta<T>(key: string, value: T): Promise<void> {
    const db = await this.conn();
    await db.run(
      'INSERT OR REPLACE INTO sync_meta (meta_key, value_json) VALUES (?, ?)',
      [key, JSON.stringify(value)]
    );
  }

  async clearAllStoreData(): Promise<void> {
    const db = await this.conn();
    await db.execute(`
      DELETE FROM entities;
      DELETE FROM pending_operations;
      DELETE FROM sync_meta;
    `);
  }
}

// ---------------- INDEXEDDB DRIVER (WEB / BROWSER / FALLBACK) ----------------
class IndexedDbDriver implements BackendDriver {
  readonly engine: LocalDbEngine = 'indexeddb';
  private db: IDBDatabase | null = null;
  private initPromise: Promise<IDBDatabase> | null = null;

  async init(): Promise<void> {
    await this.openDb();
  }

  private openDb(): Promise<IDBDatabase> {
    if (this.db) return Promise.resolve(this.db);
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB is unavailable'));
        return;
      }
      const req = indexedDB.open(IDB_NAME, IDB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_ENTITIES)) {
          const store = db.createObjectStore(STORE_ENTITIES, { keyPath: 'compositeKey' });
          store.createIndex('collectionName', 'collectionName', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_PENDING_OPS)) {
          const store = db.createObjectStore(STORE_PENDING_OPS, { keyPath: 'operationId' });
          store.createIndex('seq', 'seq', { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_AUTH_CACHE)) {
          db.createObjectStore(STORE_AUTH_CACHE, { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains(STORE_SYNC_META)) {
          db.createObjectStore(STORE_SYNC_META, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => {
        this.db = req.result;
        this.db.onclose = () => {
          this.db = null;
          this.initPromise = null;
        };
        resolve(this.db);
      };
      req.onerror = () => {
        this.initPromise = null;
        reject(req.error || new Error('Failed to open IndexedDB'));
      };
    });

    return this.initPromise;
  }

  private async withStore<R>(
    storeName: string,
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore, tx: IDBTransaction) => Promise<R> | R
  ): Promise<R> {
    const db = await this.openDb();
    return new Promise<R>((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let result: R;
      let hasResult = false;

      tx.oncomplete = () => {
        resolve(hasResult ? result : (undefined as unknown as R));
      };
      tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
      tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));

      Promise.resolve(fn(store, tx))
        .then((res) => {
          result = res;
          hasResult = true;
        })
        .catch((err) => {
          try {
            tx.abort();
          } catch {
            // ignore abort error
          }
          reject(err);
        });
    });
  }

  private reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB request failed'));
    });
  }

  async getCollection<T>(collectionName: LocalCollectionName): Promise<T[]> {
    return this.withStore(STORE_ENTITIES, 'readonly', async (store) => {
      const idx = store.index('collectionName');
      const rows = (await this.reqToPromise(idx.getAll(collectionName))) as EntityRecordRow[];
      const out: T[] = [];
      for (const r of rows) {
        try {
          const parsed = hydrateValueFromDb(JSON.parse(r.dataJson)) as Record<string, unknown>;
          if (!parsed.id && r.docId) parsed.id = r.docId;
          out.push(parsed as T);
        } catch {
          // ignore bad row
        }
      }
      return out;
    });
  }

  async replaceCollection<T extends { id?: string }>(
    collectionName: LocalCollectionName,
    docs: T[],
    idSelector?: (doc: T) => string
  ): Promise<void> {
    const now = Date.now();
    await this.withStore(STORE_ENTITIES, 'readwrite', async (store) => {
      const idx = store.index('collectionName');
      const existingKeys = (await this.reqToPromise(
        idx.getAllKeys(collectionName)
      )) as IDBValidKey[];
      for (const key of existingKeys) {
        store.delete(key);
      }
      for (const item of docs) {
        const docId = idSelector ? idSelector(item) : String(item.id || 'main');
        const row: EntityRecordRow = {
          compositeKey: `${collectionName}::${docId}`,
          collectionName,
          docId,
          dataJson: JSON.stringify(serializeValueForDb(item)),
          updatedMs: now,
        };
        store.put(row);
      }
    });
  }

  async upsertEntity<T>(
    collectionName: LocalCollectionName,
    docId: string,
    data: T
  ): Promise<void> {
    const row: EntityRecordRow = {
      compositeKey: `${collectionName}::${docId}`,
      collectionName,
      docId,
      dataJson: JSON.stringify(serializeValueForDb(data)),
      updatedMs: Date.now(),
    };
    await this.withStore(STORE_ENTITIES, 'readwrite', (store) => {
      store.put(row);
    });
  }

  async deleteEntity(collectionName: LocalCollectionName, docId: string): Promise<void> {
    await this.withStore(STORE_ENTITIES, 'readwrite', (store) => {
      store.delete(`${collectionName}::${docId}`);
    });
  }

  async getPendingOperations(): Promise<PendingOperation[]> {
    return this.withStore(STORE_PENDING_OPS, 'readonly', async (store) => {
      const rows = (await this.reqToPromise(store.getAll())) as PendingOperation[];
      return rows.sort((a, b) => {
        const seqDiff = (a.seq || 0) - (b.seq || 0);
        if (seqDiff !== 0) return seqDiff;
        return a.createdAtIso.localeCompare(b.createdAtIso);
      });
    });
  }

  async putPendingOperation(op: PendingOperation): Promise<void> {
    const seq = typeof op.seq === 'number' ? op.seq : Date.now();
    const withSeq: PendingOperation = { ...op, seq };
    await this.withStore(STORE_PENDING_OPS, 'readwrite', (store) => {
      store.put(withSeq);
    });
  }

  async deletePendingOperation(operationId: string): Promise<void> {
    await this.withStore(STORE_PENDING_OPS, 'readwrite', (store) => {
      store.delete(operationId);
    });
  }

  async clearSyncedOperationsOlderThan(maxKeepCount: number): Promise<void> {
    const ops = await this.getPendingOperations();
    const synced = ops.filter((o) => o.status === 'synced');
    if (synced.length <= maxKeepCount) return;
    const toRemove = synced.slice(0, synced.length - maxKeepCount);
    await this.withStore(STORE_PENDING_OPS, 'readwrite', (store) => {
      for (const op of toRemove) {
        store.delete(op.operationId);
      }
    });
  }

  async getAuthCache<T>(key: string): Promise<T | null> {
    return this.withStore(STORE_AUTH_CACHE, 'readonly', async (store) => {
      const row = (await this.reqToPromise(store.get(key))) as AuthCacheRow | undefined;
      if (!row?.dataJson) return null;
      return hydrateValueFromDb(JSON.parse(row.dataJson)) as T;
    });
  }

  async setAuthCache<T>(key: string, data: T | null): Promise<void> {
    await this.withStore(STORE_AUTH_CACHE, 'readwrite', (store) => {
      if (data === null) {
        store.delete(key);
        return;
      }
      const row: AuthCacheRow = {
        key,
        dataJson: JSON.stringify(serializeValueForDb(data)),
        updatedMs: Date.now(),
      };
      store.put(row);
    });
  }

  async getSyncMeta<T>(key: string): Promise<T | null> {
    return this.withStore(STORE_SYNC_META, 'readonly', async (store) => {
      const row = (await this.reqToPromise(store.get(key))) as SyncMetaRow | undefined;
      if (!row?.valueJson) return null;
      return JSON.parse(row.valueJson) as T;
    });
  }

  async setSyncMeta<T>(key: string, value: T): Promise<void> {
    await this.withStore(STORE_SYNC_META, 'readwrite', (store) => {
      const row: SyncMetaRow = {
        key,
        valueJson: JSON.stringify(value),
      };
      store.put(row);
    });
  }

  async clearAllStoreData(): Promise<void> {
    await this.withStore(STORE_ENTITIES, 'readwrite', (s) => s.clear());
    await this.withStore(STORE_PENDING_OPS, 'readwrite', (s) => s.clear());
    await this.withStore(STORE_SYNC_META, 'readwrite', (s) => s.clear());
  }
}

// ---------------- MEMORY FALLBACK DRIVER (ONLY FOR RESTRICTED TEST RUNNERS) ----------------
class MemoryDbDriver implements BackendDriver {
  readonly engine: LocalDbEngine = 'memory';
  private entities = new Map<LocalCollectionName, Map<string, string>>();
  private ops = new Map<string, PendingOperation>();
  private auth = new Map<string, string>();
  private meta = new Map<string, string>();

  async init(): Promise<void> {}

  async getCollection<T>(collectionName: LocalCollectionName): Promise<T[]> {
    const col = this.entities.get(collectionName);
    if (!col) return [];
    return Array.from(col.entries()).map(([docId, json]) => {
      const parsed = hydrateValueFromDb(JSON.parse(json)) as Record<string, unknown>;
      if (!parsed.id) parsed.id = docId;
      return parsed as T;
    });
  }

  async replaceCollection<T extends { id?: string }>(
    collectionName: LocalCollectionName,
    docs: T[],
    idSelector?: (doc: T) => string
  ): Promise<void> {
    const col = new Map<string, string>();
    for (const item of docs) {
      const docId = idSelector ? idSelector(item) : String(item.id || 'main');
      col.set(docId, JSON.stringify(serializeValueForDb(item)));
    }
    this.entities.set(collectionName, col);
  }

  async upsertEntity<T>(
    collectionName: LocalCollectionName,
    docId: string,
    data: T
  ): Promise<void> {
    let col = this.entities.get(collectionName);
    if (!col) {
      col = new Map();
      this.entities.set(collectionName, col);
    }
    col.set(docId, JSON.stringify(serializeValueForDb(data)));
  }

  async deleteEntity(collectionName: LocalCollectionName, docId: string): Promise<void> {
    this.entities.get(collectionName)?.delete(docId);
  }

  async getPendingOperations(): Promise<PendingOperation[]> {
    return Array.from(this.ops.values()).sort((a, b) => {
      const seqDiff = (a.seq || 0) - (b.seq || 0);
      if (seqDiff !== 0) return seqDiff;
      return a.createdAtIso.localeCompare(b.createdAtIso);
    });
  }

  async putPendingOperation(op: PendingOperation): Promise<void> {
    const seq = typeof op.seq === 'number' ? op.seq : Date.now();
    this.ops.set(op.operationId, { ...op, seq });
  }

  async deletePendingOperation(operationId: string): Promise<void> {
    this.ops.delete(operationId);
  }

  async clearSyncedOperationsOlderThan(maxKeepCount: number): Promise<void> {
    const ops = await this.getPendingOperations();
    const synced = ops.filter((o) => o.status === 'synced');
    if (synced.length <= maxKeepCount) return;
    for (const o of synced.slice(0, synced.length - maxKeepCount)) {
      this.ops.delete(o.operationId);
    }
  }

  async getAuthCache<T>(key: string): Promise<T | null> {
    const raw = this.auth.get(key);
    if (!raw) return null;
    return hydrateValueFromDb(JSON.parse(raw)) as T;
  }

  async setAuthCache<T>(key: string, data: T | null): Promise<void> {
    if (data === null) this.auth.delete(key);
    else this.auth.set(key, JSON.stringify(serializeValueForDb(data)));
  }

  async getSyncMeta<T>(key: string): Promise<T | null> {
    const raw = this.meta.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  }

  async setSyncMeta<T>(key: string, value: T): Promise<void> {
    this.meta.set(key, JSON.stringify(value));
  }

  async clearAllStoreData(): Promise<void> {
    this.entities.clear();
    this.ops.clear();
    this.meta.clear();
  }
}

// ---------------- SINGLETON FACADE ----------------
let activeDriver: BackendDriver | null = null;
let driverInitPromise: Promise<BackendDriver> | null = null;

async function resolveDriver(): Promise<BackendDriver> {
  if (activeDriver) return activeDriver;
  if (driverInitPromise) return driverInitPromise;

  driverInitPromise = (async () => {
    if (Capacitor.isNativePlatform()) {
      try {
        const sqliteDriver = new CapacitorSqliteDriver();
        await sqliteDriver.init();
        activeDriver = sqliteDriver;
        return sqliteDriver;
      } catch (err) {
        console.warn('[AlHussamLocalDb] SQLite init fallback to IndexedDB:', err);
      }
    }

    if (typeof indexedDB !== 'undefined') {
      try {
        const idbDriver = new IndexedDbDriver();
        await idbDriver.init();
        activeDriver = idbDriver;
        return idbDriver;
      } catch (err) {
        console.warn('[AlHussamLocalDb] IndexedDB init fallback to Memory:', err);
      }
    }

    const memDriver = new MemoryDbDriver();
    await memDriver.init();
    activeDriver = memDriver;
    return memDriver;
  })();

  return driverInitPromise;
}

export const SYNC_META_KEYS = {
  STATE: 'sync_meta_state_v1',
  ID_MAP: 'sync_id_map_v1',
} as const;

export const localDbService = {
  async init(): Promise<LocalDbEngine> {
    const d = await resolveDriver();
    return d.engine;
  },

  getEngineSync(): LocalDbEngine {
    if (activeDriver) return activeDriver.engine;
    if (Capacitor.isNativePlatform()) return 'sqlite';
    if (typeof indexedDB !== 'undefined') return 'indexeddb';
    return 'memory';
  },

  async getCollection<T>(collectionName: LocalCollectionName): Promise<T[]> {
    const d = await resolveDriver();
    return d.getCollection<T>(collectionName);
  },

  async replaceCollection<T extends { id?: string }>(
    collectionName: LocalCollectionName,
    docs: T[],
    idSelector?: (doc: T) => string
  ): Promise<void> {
    const d = await resolveDriver();
    return d.replaceCollection(collectionName, docs, idSelector);
  },

  async upsertEntity<T>(
    collectionName: LocalCollectionName,
    docId: string,
    data: T
  ): Promise<void> {
    const d = await resolveDriver();
    return d.upsertEntity(collectionName, docId, data);
  },

  async deleteEntity(collectionName: LocalCollectionName, docId: string): Promise<void> {
    const d = await resolveDriver();
    return d.deleteEntity(collectionName, docId);
  },

  async getPendingOperations(): Promise<PendingOperation[]> {
    const d = await resolveDriver();
    return d.getPendingOperations();
  },

  async putPendingOperation(op: PendingOperation): Promise<void> {
    const d = await resolveDriver();
    return d.putPendingOperation(op);
  },

  async deletePendingOperation(operationId: string): Promise<void> {
    const d = await resolveDriver();
    return d.deletePendingOperation(operationId);
  },

  async pruneOldSyncedOperations(maxKeepCount = 200): Promise<void> {
    const d = await resolveDriver();
    return d.clearSyncedOperationsOlderThan(maxKeepCount);
  },

  async getAuthCache<T>(key: string): Promise<T | null> {
    const d = await resolveDriver();
    return d.getAuthCache<T>(key);
  },

  async setAuthCache<T>(key: string, data: T | null): Promise<void> {
    const d = await resolveDriver();
    return d.setAuthCache<T>(key, data);
  },

  async getSyncMetaState(): Promise<SyncMetaState> {
    const d = await resolveDriver();
    const state = await d.getSyncMeta<SyncMetaState>(SYNC_META_KEYS.STATE);
    return (
      state || {
        lastSuccessfulSyncIso: null,
        lastSyncError: null,
        totalSyncedCount: 0,
      }
    );
  },

  async saveSyncMetaState(patch: Partial<SyncMetaState>): Promise<SyncMetaState> {
    const current = await this.getSyncMetaState();
    const next: SyncMetaState = { ...current, ...patch };
    const d = await resolveDriver();
    await d.setSyncMeta(SYNC_META_KEYS.STATE, next);
    return next;
  },

  async getIdMap(): Promise<Record<string, { referenceId: string; referenceNumber?: string }>> {
    const d = await resolveDriver();
    return (
      (await d.getSyncMeta<Record<string, { referenceId: string; referenceNumber?: string }>>(
        SYNC_META_KEYS.ID_MAP
      )) || {}
    );
  },

  async recordIdMapping(
    localId: string,
    referenceId: string,
    referenceNumber?: string
  ): Promise<void> {
    const d = await resolveDriver();
    const map = await this.getIdMap();
    map[localId] = { referenceId, referenceNumber };
    await d.setSyncMeta(SYNC_META_KEYS.ID_MAP, map);
  },

  async clearAllForTests(): Promise<void> {
    const d = await resolveDriver();
    await d.clearAllStoreData();
  },
};
