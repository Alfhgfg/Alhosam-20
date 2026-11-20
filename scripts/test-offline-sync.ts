import assert from 'node:assert/strict';
import {
  hydrateValueFromDb,
  localDbService,
  LocalTimestamp,
  makeLocalTimestamp,
  serializeValueForDb,
} from '../src/services/localDbService';
import {
  projectStoreWithPendingOps,
  type StoreBaselineData,
} from '../src/services/localProjectionService';
import {
  computeReservedStockMap,
  enqueuePendingOperation,
  getSyncMetaCache,
  initOfflineQueue,
  isNetworkOrOfflineError,
  loadAllQueueOperations,
  loadPendingOperations,
  markOperationSynced,
  reloadQueueFromDbForTests,
  setNetworkOnlineState,
  updatePendingOperation,
  updateSyncMeta,
} from '../src/services/offlineQueueService';
import type {
  Counters,
  Customer,
  PendingOperation,
  Product,
  Supplier,
} from '../src/types';
import {
  buildBarcodeSvgMarkup,
  computeEan13CheckDigit,
  encodeBarcode,
  findBarcodeConflict,
  generateUniqueProductBarcode,
  isValidBarcodeFormat,
  isValidEan13,
  normalizeBarcode,
} from '../src/utils/barcode';
import { roundMoney } from '../src/utils/format';

const ACTOR = {
  uid: 'staff_uid_1',
  name: 'أحمد البائع',
  role: 'admin' as const,
  deviceId: 'dev_android_1',
  deviceName: 'Alhusam-14',
};

function makeTs(offsetMs = 0): LocalTimestamp {
  return makeLocalTimestamp(Date.UTC(2026, 4, 10, 9, 0, 0) + offsetMs);
}

function makeInitialBaseline(): StoreBaselineData {
  const t0 = makeTs();
  const counters: Counters = {
    nextProductSeq: 1003,
    nextCustomerSeq: 1002,
    nextSupplierSeq: 1002,
    nextInvoiceSeq: 10,
    nextPurchaseSeq: 5,
    nextReturnSeq: 2,
    nextVoucherSeq: 3,
    cashBalance: 5000,
    updatedAt: t0 as unknown as Counters['updatedAt'],
  };

  const products: Product[] = [
    {
      id: 'prod_rice',
      code: 'HS-1001',
      barcode: '629100000001',
      name: 'أرز بسمتي 5 كيلو',
      category: 'مواد غذائية',
      unit: 'كيس',
      costPrice: 1500,
      sellPrice: 2000,
      stock: 20,
      minStock: 5,
      isActive: true,
      createdBy: ACTOR.uid,
      createdAt: t0 as unknown as Product['createdAt'],
      updatedAt: t0 as unknown as Product['updatedAt'],
    },
    {
      id: 'prod_oil',
      code: 'HS-1002',
      barcode: '629100000002',
      name: 'زيت طبخ 1.8 لتر',
      category: 'زيوت',
      unit: 'حبة',
      costPrice: 800,
      sellPrice: 1100,
      stock: 15,
      minStock: 4,
      isActive: true,
      createdBy: ACTOR.uid,
      createdAt: t0 as unknown as Product['createdAt'],
      updatedAt: t0 as unknown as Product['updatedAt'],
    },
  ];

  const customers: Customer[] = [
    {
      id: 'cust_ali',
      customerCode: 'C-1001',
      name: 'علي صالح',
      phone: '777111222',
      totalPurchases: 3000,
      totalPaid: 2000,
      balanceDue: 1000,
      createdBy: ACTOR.uid,
      createdAt: t0 as unknown as Customer['createdAt'],
      updatedAt: t0 as unknown as Customer['updatedAt'],
    },
  ];

  const suppliers: Supplier[] = [
    {
      id: 'supp_yemen',
      supplierCode: 'S-1001',
      name: 'شركة الخير التجارية',
      phone: '01223344',
      totalPurchases: 10000,
      totalPaid: 7000,
      balanceDue: 3000,
      createdBy: ACTOR.uid,
      createdAt: t0 as unknown as Supplier['createdAt'],
      updatedAt: t0 as unknown as Supplier['updatedAt'],
    },
  ];

  return {
    counters,
    products,
    customers,
    suppliers,
    sales: [],
    purchases: [],
    returns: [],
    stockMovements: [],
    expenses: [],
    vouchers: [],
    cashTransactions: [],
    auditLogs: [],
  };
}

// Simulated authoritative Cloud Firestore ledger with processed_operations idempotency & concurrency checks
interface CloudLedger {
  counters: Counters;
  products: Map<string, Product & { updatedAtMs: number }>;
  customers: Map<string, Customer & { updatedAtMs: number }>;
  suppliers: Map<string, Supplier & { updatedAtMs: number }>;
  sales: Map<string, { id: string; invoiceNumber: string; total: number; paidAmount: number; remainingAmount: number; customerId?: string; status: string; items: Array<{ productId: string; qty: number; unitPrice: number }> }>;
  purchases: Map<string, { id: string; total: number }>;
  returns: Map<string, { id: string; refundAmount: number }>;
  expenses: Map<string, { id: string; amount: number }>;
  vouchers: Map<string, { id: string; amount: number }>;
  cashTransactions: Array<{ id: string; delta: number }>;
  stockMovements: Array<{ id: string; productId: string; qtyChange: number }>;
  processedOperations: Set<string>;
}

function createCloudFromBaseline(base: StoreBaselineData): CloudLedger {
  const nowMs = Date.UTC(2026, 4, 10, 9, 0, 0);
  return {
    counters: { ...base.counters },
    products: new Map(
      base.products.map((p) => [p.id, { ...p, updatedAtMs: nowMs }])
    ),
    customers: new Map(
      base.customers.map((c) => [c.id, { ...c, updatedAtMs: nowMs }])
    ),
    suppliers: new Map(
      base.suppliers.map((s) => [s.id, { ...s, updatedAtMs: nowMs }])
    ),
    sales: new Map(),
    purchases: new Map(),
    returns: new Map(),
    expenses: new Map(),
    vouchers: new Map(),
    cashTransactions: [],
    stockMovements: [],
    processedOperations: new Set(),
  };
}

function applyOpToCloud(cloud: CloudLedger, op: PendingOperation): { referenceId?: string; referenceNumber?: string } {
  // STRICT IDEMPOTENCY GUARD: matches processed_operations/{opId} in accountingService.ts
  if (cloud.processedOperations.has(op.operationId)) {
    return { referenceId: op.operationId, referenceNumber: op.localTempRef };
  }

  const p = op.payload;

  if (op.type === 'product_create') {
    const productId = String(p.productId);
    const code = String(p.code);
    const barcode = typeof p.barcode === 'string' ? normalizeBarcode(p.barcode) : undefined;
    for (const existing of cloud.products.values()) {
      if (existing.code === code) {
        throw new Error(`كود الصنف "${code}" مستخدم بالفعل لصنف آخر.`);
      }
      if (barcode && (existing.barcode === barcode || existing.code === barcode)) {
        throw new Error(`الباركود "${barcode}" مستخدم بالفعل لصنف آخر.`);
      }
    }
    const stock = Number(p.stock || 0);
    cloud.products.set(productId, {
      id: productId,
      code,
      barcode,
      name: String(p.name),
      category: String(p.category || 'عام'),
      unit: String(p.unit || 'حبة'),
      costPrice: Number(p.costPrice || 0),
      sellPrice: Number(p.sellPrice || 0),
      stock,
      minStock: Number(p.minStock || 0),
      isActive: true,
      createdBy: op.actor.uid,
      createdAt: null,
      updatedAt: null,
      updatedAtMs: Date.now(),
    });
    cloud.processedOperations.add(op.operationId);
    return { referenceId: productId, referenceNumber: code };
  }

  if (op.type === 'product_update') {
    const productId = String(p.productId);
    const cur = cloud.products.get(productId);
    if (!cur) throw new Error('الصنف غير موجود على الخادم.');
    const baseMs = typeof op.baseState?.baseUpdatedAtMs === 'number' ? op.baseState.baseUpdatedAtMs : null;
    if (!op.forceApply && !p.forceApply && baseMs !== null && cur.updatedAtMs > baseMs + 2000) {
      throw new Error(`تعارض تعديل متزامن للصنف "${cur.name}"`);
    }
    cloud.products.set(productId, {
      ...cur,
      barcode:
        typeof p.barcode === 'string' && normalizeBarcode(p.barcode)
          ? normalizeBarcode(p.barcode)
          : cur.barcode,
      name: String(p.name),
      costPrice: Number(p.costPrice),
      sellPrice: Number(p.sellPrice),
      updatedAtMs: Date.now() + 5000,
    });
    cloud.processedOperations.add(op.operationId);
    return { referenceId: productId, referenceNumber: cur.code };
  }

  if (op.type === 'customer_create') {
    const customerId = String(p.customerId);
    const custCode = `C-${cloud.counters.nextCustomerSeq++}`;
    cloud.customers.set(customerId, {
      id: customerId,
      customerCode: custCode,
      name: String(p.name),
      totalPurchases: 0,
      totalPaid: 0,
      balanceDue: 0,
      createdBy: op.actor.uid,
      createdAt: null,
      updatedAt: null,
      updatedAtMs: Date.now(),
    });
    cloud.processedOperations.add(op.operationId);
    return { referenceId: customerId, referenceNumber: custCode };
  }

  if (op.type === 'supplier_create') {
    const supplierId = String(p.supplierId);
    const suppCode = `S-${cloud.counters.nextSupplierSeq++}`;
    cloud.suppliers.set(supplierId, {
      id: supplierId,
      supplierCode: suppCode,
      name: String(p.name),
      totalPurchases: 0,
      totalPaid: 0,
      balanceDue: 0,
      createdBy: op.actor.uid,
      createdAt: null,
      updatedAt: null,
      updatedAtMs: Date.now(),
    });
    cloud.processedOperations.add(op.operationId);
    return { referenceId: supplierId, referenceNumber: suppCode };
  }

  if (op.type === 'sale') {
    const saleId = String(p.saleId);
    const items = (p.items as Array<{ productId: string; qty: number; unitPrice: number }>) || [];
    let subtotal = 0;
    for (const it of items) {
      const prod = cloud.products.get(it.productId);
      if (!prod) throw new Error('الصنف غير موجود.');
      if (prod.stock < it.qty) {
        throw new Error(`الكمية المتاحة من "${prod.name}" (${prod.stock}) أقل من المطلوب (${it.qty}).`);
      }
      prod.stock = roundMoney(prod.stock - it.qty);
      subtotal = roundMoney(subtotal + it.qty * it.unitPrice);
      cloud.stockMovements.push({ id: `${op.operationId}_${it.productId}`, productId: it.productId, qtyChange: -it.qty });
    }
    const discount = Number(p.discount || 0);
    const total = roundMoney(Math.max(0, subtotal - discount));
    const method = String(p.paymentMethod || 'cash');
    const paidAmount = method === 'cash' ? total : method === 'credit' ? 0 : Number(p.paidAmount || 0);
    const remainingAmount = roundMoney(total - paidAmount);

    const cust = p.customer as { id: string } | null;
    if (cust?.id) {
      const c = cloud.customers.get(cust.id);
      if (c) {
        c.totalPurchases = roundMoney(c.totalPurchases + total);
        c.totalPaid = roundMoney(c.totalPaid + paidAmount);
        c.balanceDue = roundMoney(c.balanceDue + remainingAmount);
      }
    }
    if (paidAmount > 0) {
      cloud.counters.cashBalance = roundMoney(cloud.counters.cashBalance + paidAmount);
      cloud.cashTransactions.push({ id: `cash_${op.operationId}`, delta: paidAmount });
    }
    const invNum = `INV-${String(cloud.counters.nextInvoiceSeq++).padStart(5, '0')}`;
    cloud.sales.set(saleId, {
      id: saleId,
      invoiceNumber: invNum,
      total,
      paidAmount,
      remainingAmount,
      customerId: cust?.id,
      status: 'completed',
      items,
    });
    cloud.processedOperations.add(op.operationId);
    return { referenceId: saleId, referenceNumber: invNum };
  }

  if (op.type === 'purchase') {
    const purchaseId = String(p.purchaseId);
    const items = (p.items as Array<{ productId: string; qty: number; costPrice: number; updateProductCost: boolean }>) || [];
    let total = 0;
    for (const it of items) {
      const prod = cloud.products.get(it.productId);
      if (!prod) throw new Error('الصنف غير موجود للمشتريات.');
      prod.stock = roundMoney(prod.stock + it.qty);
      if (it.updateProductCost) prod.costPrice = it.costPrice;
      total = roundMoney(total + it.qty * it.costPrice);
      cloud.stockMovements.push({ id: `${op.operationId}_${it.productId}`, productId: it.productId, qtyChange: it.qty });
    }
    const method = String(p.paymentMethod || 'cash');
    const paidAmount = method === 'cash' ? total : method === 'credit' ? 0 : Number(p.paidAmount || 0);
    const remaining = roundMoney(total - paidAmount);
    const suppInput = p.supplier as { id: string };
    const supp = cloud.suppliers.get(suppInput.id);
    if (supp) {
      supp.totalPurchases = roundMoney(supp.totalPurchases + total);
      supp.totalPaid = roundMoney(supp.totalPaid + paidAmount);
      supp.balanceDue = roundMoney(supp.balanceDue + remaining);
    }
    if (paidAmount > 0) {
      cloud.counters.cashBalance = roundMoney(cloud.counters.cashBalance - paidAmount);
      cloud.cashTransactions.push({ id: `cash_${op.operationId}`, delta: -paidAmount });
    }
    cloud.purchases.set(purchaseId, { id: purchaseId, total });
    cloud.processedOperations.add(op.operationId);
    return { referenceId: purchaseId };
  }

  if (op.type === 'voucher') {
    const voucherId = String(p.voucherId);
    const amount = Number(p.amount || 0);
    const partyType = String(p.partyType);
    const partyId = String(p.partyId);
    const type = String(p.type);
    if (partyType === 'customer') {
      const c = cloud.customers.get(partyId);
      if (c) {
        c.totalPaid = roundMoney(c.totalPaid + amount);
        c.balanceDue = roundMoney(c.balanceDue - amount);
      }
    } else {
      const s = cloud.suppliers.get(partyId);
      if (s) {
        s.totalPaid = roundMoney(s.totalPaid + amount);
        s.balanceDue = roundMoney(s.balanceDue - amount);
      }
    }
    const delta = type === 'receipt' ? amount : -amount;
    cloud.counters.cashBalance = roundMoney(cloud.counters.cashBalance + delta);
    cloud.cashTransactions.push({ id: `cash_${op.operationId}`, delta });
    cloud.vouchers.set(voucherId, { id: voucherId, amount });
    cloud.processedOperations.add(op.operationId);
    return { referenceId: voucherId };
  }

  if (op.type === 'expense') {
    const expId = String(p.expenseId);
    const amount = Number(p.amount || 0);
    cloud.counters.cashBalance = roundMoney(cloud.counters.cashBalance - amount);
    cloud.cashTransactions.push({ id: `cash_${op.operationId}`, delta: -amount });
    cloud.expenses.set(expId, { id: expId, amount });
    cloud.processedOperations.add(op.operationId);
    return { referenceId: expId };
  }

  if (op.type === 'cash_adjust') {
    const amount = Number(p.amount || 0);
    const delta = p.type === 'in' ? amount : -amount;
    cloud.counters.cashBalance = roundMoney(cloud.counters.cashBalance + delta);
    cloud.cashTransactions.push({ id: `cash_${op.operationId}`, delta });
    cloud.processedOperations.add(op.operationId);
    return { referenceId: 'main' };
  }

  if (op.type === 'return') {
    const returnId = String(p.returnId);
    const sale = cloud.sales.get(String(p.saleId));
    if (!sale) throw new Error('الفاتورة الأصلية غير موجودة.');
    const itemsToReturn = (p.itemsToReturn as Array<{ productId: string; qty: number }>) || [];
    let refund = 0;
    for (const r of itemsToReturn) {
      const orig = sale.items.find((x) => x.productId === r.productId);
      if (!orig) continue;
      refund = roundMoney(refund + orig.unitPrice * r.qty);
      if (p.restockValid) {
        const prod = cloud.products.get(r.productId);
        if (prod) prod.stock = roundMoney(prod.stock + r.qty);
      }
    }
    if (p.refundCash) {
      cloud.counters.cashBalance = roundMoney(cloud.counters.cashBalance - refund);
      cloud.cashTransactions.push({ id: `cash_${op.operationId}`, delta: -refund });
    } else if (sale.customerId) {
      const c = cloud.customers.get(sale.customerId);
      if (c) c.balanceDue = roundMoney(c.balanceDue - refund);
    }
    cloud.returns.set(returnId, { id: returnId, refundAmount: refund });
    cloud.processedOperations.add(op.operationId);
    return { referenceId: returnId };
  }

  if (op.type === 'sale_cancel') {
    const sale = cloud.sales.get(String(p.saleId));
    if (!sale) throw new Error('الفاتورة غير موجودة.');
    if (sale.status !== 'cancelled') {
      sale.status = 'cancelled';
      for (const it of sale.items) {
        const prod = cloud.products.get(it.productId);
        if (prod) prod.stock = roundMoney(prod.stock + it.qty);
      }
      if (sale.customerId) {
        const c = cloud.customers.get(sale.customerId);
        if (c) {
          c.totalPurchases = Math.max(0, roundMoney(c.totalPurchases - sale.total));
          c.totalPaid = Math.max(0, roundMoney(c.totalPaid - sale.paidAmount));
          c.balanceDue = roundMoney(c.balanceDue - sale.remainingAmount);
        }
      }
      if (sale.paidAmount > 0) {
        cloud.counters.cashBalance = roundMoney(cloud.counters.cashBalance - sale.paidAmount);
        cloud.cashTransactions.push({ id: `cash_${op.operationId}`, delta: -sale.paidAmount });
      }
    }
    cloud.processedOperations.add(op.operationId);
    return { referenceId: sale.id, referenceNumber: sale.invoiceNumber };
  }

  if (op.type === 'stock_adjust') {
    const productId = String(p.productId);
    const prod = cloud.products.get(productId);
    if (!prod) throw new Error('الصنف غير موجود.');
    const mode = String(p.mode);
    const val = Number(p.quantityOrActual || 0);
    const expected = typeof p.expectedStockAtCapture === 'number' ? p.expectedStockAtCapture : undefined;

    if (mode === 'stocktake') {
      if (expected !== undefined && prod.stock !== expected) {
        if (p.applyDeltaOnConflict) {
          const delta = roundMoney(val - expected);
          prod.stock = Math.max(0, roundMoney(prod.stock + delta));
        } else if (op.forceApply || p.forceApply) {
          prod.stock = Math.max(0, val);
        } else {
          throw new Error(
            `تعارض جرد للمخزون "${prod.name}": الرصيد تغير أثناء عدم الاتصال (${expected} -> ${prod.stock}).`
          );
        }
      } else {
        prod.stock = Math.max(0, val);
      }
    } else if (mode === 'in') {
      prod.stock = roundMoney(prod.stock + val);
    } else {
      prod.stock = Math.max(0, roundMoney(prod.stock - val));
    }
    cloud.processedOperations.add(op.operationId);
    return { referenceId: productId };
  }

  cloud.processedOperations.add(op.operationId);
  return {};
}

async function runTests() {
  console.log('=== Starting Offline Accounting & Sync Practical Test Suite ===');

  // 1. Test serialization / hydration of LocalTimestamp
  const origTs = makeLocalTimestamp(1778400000000);
  const packed = serializeValueForDb({ createdAt: origTs, nested: { updatedAt: origTs } });
  const unpacked = hydrateValueFromDb(JSON.parse(JSON.stringify(packed))) as {
    createdAt: LocalTimestamp;
    nested: { updatedAt: LocalTimestamp };
  };
  assert.equal(unpacked.createdAt.toMillis(), 1778400000000);
  assert.equal(unpacked.nested.updatedAt.toDate().getTime(), 1778400000000);
  console.log('[PASS] 1. LocalTimestamp DB serialization & hydration');

  // 2. Test full offline session workflow across all modules + local projection
  await localDbService.clearAllForTests();
  await initOfflineQueue();
  setNetworkOnlineState(false);

  const baseline = makeInitialBaseline();
  await localDbService.replaceCollection('products', baseline.products);
  await localDbService.replaceCollection('customers', baseline.customers);
  await localDbService.replaceCollection('suppliers', baseline.suppliers);
  await localDbService.upsertEntity('counters', 'main', baseline.counters);

  // Op 1: Create new product offline (milk, stock 10, cost 300, sell 450)
  await enqueuePendingOperation({
    operationId: 'op_01_prod_create',
    seq: 1,
    type: 'product_create',
    summary: 'إضافة حليب طازج',
    localTempRef: 'HS-L0001',
    actor: ACTOR,
      payload: {
      productId: 'prod_milk',
      code: 'HS-L0001',
      barcode: '٢٠٠٠٠٠٠٠١٠٢٠٦',
      name: 'حليب طازج 1 لتر',
      category: 'ألبان',
      unit: 'حبة',
      costPrice: 300,
      sellPrice: 450,
      stock: 10,
      minStock: 2,
    },
    status: 'pending',
    attempts: 0,
    createdAtIso: '2026-05-10T10:00:00.000Z',
  });

  // Op 2: Edit existing product price offline
  await enqueuePendingOperation({
    operationId: 'op_02_prod_update',
    seq: 2,
    type: 'product_update',
    summary: 'تعديل سعر الأرز',
    localTempRef: 'HS-1001',
    actor: ACTOR,
    payload: {
      productId: 'prod_rice',
      code: 'HS-1001',
      name: 'أرز بسمتي 5 كيلو',
      category: 'مواد غذائية',
      unit: 'كيس',
      costPrice: 1500,
      sellPrice: 2100,
      minStock: 5,
      isActive: true,
    },
    baseState: { baseUpdatedAtMs: Date.UTC(2026, 4, 10, 9, 0, 0) },
    status: 'pending',
    attempts: 0,
    createdAtIso: '2026-05-10T10:01:00.000Z',
  });

  // Op 3: Add new supplier + record partial purchase (5 oil @ 750, paid 2000, remaining 1750)
  await enqueuePendingOperation({
    operationId: 'op_03_supp_create',
    seq: 3,
    type: 'supplier_create',
    summary: 'مورد الأمل',
    localTempRef: 'S-L001',
    actor: ACTOR,
    payload: { supplierId: 'supp_amal', supplierCode: 'S-L001', name: 'شركة الأمل' },
    status: 'pending',
    attempts: 0,
    createdAtIso: '2026-05-10T10:02:00.000Z',
  });

  await enqueuePendingOperation({
    operationId: 'op_04_purchase',
    seq: 4,
    type: 'purchase',
    summary: 'شراء زيت',
    localTempRef: 'OFF-PUR-04',
    actor: ACTOR,
    payload: {
      purchaseId: 'pur_off_1',
      supplier: { id: 'supp_amal', supplierCode: 'S-L001', name: 'شركة الأمل' },
      items: [{ productId: 'prod_oil', qty: 5, costPrice: 750, updateProductCost: true }],
      paymentMethod: 'partial',
      paidAmount: 2000,
    },
    status: 'pending',
    attempts: 0,
    createdAtIso: '2026-05-10T10:03:00.000Z',
  });

  // Op 5: Add new customer offline + sell 2 offline-created milk + 1 rice on partial credit (total = 2*450 + 1*2100 = 3000, paid 1200, rem 1800)
  await enqueuePendingOperation({
    operationId: 'op_05_cust_create',
    seq: 5,
    type: 'customer_create',
    summary: 'عميل محمد',
    localTempRef: 'C-L001',
    actor: ACTOR,
    payload: { customerId: 'cust_mohammed', customerCode: 'C-L001', name: 'محمد قائد' },
    status: 'pending',
    attempts: 0,
    createdAtIso: '2026-05-10T10:04:00.000Z',
  });

  await enqueuePendingOperation({
    operationId: 'op_06_sale_partial',
    seq: 6,
    type: 'sale',
    summary: 'بيع جزئي للعميل محمد',
    localTempRef: 'OFF-INV-06',
    actor: ACTOR,
    payload: {
      saleId: 'sale_off_1',
      customer: { id: 'cust_mohammed', customerCode: 'C-L001', name: 'محمد قائد' },
      items: [
        { productId: 'prod_milk', qty: 2, unitPrice: 450, costPrice: 300 },
        { productId: 'prod_rice', qty: 1, unitPrice: 2100, costPrice: 1500 },
      ],
      discount: 0,
      paymentMethod: 'partial',
      paidAmount: 1200,
    },
    status: 'pending',
    attempts: 0,
    createdAtIso: '2026-05-10T10:05:00.000Z',
  });

  // Op 7: Cash sale of 3 oil @ 1100 = 3300 cash
  await enqueuePendingOperation({
    operationId: 'op_07_sale_cash',
    seq: 7,
    type: 'sale',
    summary: 'بيع نقدي زيت',
    localTempRef: 'OFF-INV-07',
    actor: ACTOR,
    payload: {
      saleId: 'sale_off_2',
      customer: null,
      items: [{ productId: 'prod_oil', qty: 3, unitPrice: 1100, costPrice: 750 }],
      discount: 0,
      paymentMethod: 'cash',
      paidAmount: 3300,
    },
    status: 'pending',
    attempts: 0,
    createdAtIso: '2026-05-10T10:06:00.000Z',
  });

  // Op 8: Debt receipt voucher from Ali (+600 cash, Ali debt 1000 -> 400)
  await enqueuePendingOperation({
    operationId: 'op_08_voucher',
    seq: 8,
    type: 'voucher',
    summary: 'سند قبض علي',
    localTempRef: 'OFF-VCH-08',
    actor: ACTOR,
    payload: {
      voucherId: 'vch_off_1',
      type: 'receipt',
      partyType: 'customer',
      partyId: 'cust_ali',
      partyName: 'علي صالح',
      amount: 600,
    },
    status: 'pending',
    attempts: 0,
    createdAtIso: '2026-05-10T10:07:00.000Z',
  });

  // Op 9: Expense (-500 cash) & Manual Cash deposit (+1000 cash)
  await enqueuePendingOperation({
    operationId: 'op_09_expense',
    seq: 9,
    type: 'expense',
    summary: 'أكياس تغليف',
    localTempRef: 'OFF-EXP-09',
    actor: ACTOR,
    payload: { expenseId: 'exp_off_1', title: 'أكياس تغليف', category: 'مستلزمات', amount: 500 },
    status: 'pending',
    attempts: 0,
    createdAtIso: '2026-05-10T10:08:00.000Z',
  });

  await enqueuePendingOperation({
    operationId: 'op_10_cash_in',
    seq: 10,
    type: 'cash_adjust',
    summary: 'تغذية فكة',
    localTempRef: 'OFF-CSH-10',
    actor: ACTOR,
    payload: { cashTxId: 'cash_off_1', type: 'in', amount: 1000, description: 'تغذية درج' },
    status: 'pending',
    attempts: 0,
    createdAtIso: '2026-05-10T10:09:00.000Z',
  });

  // Op 11: Return 1 oil from cash sale (cash refund -1100, stock oil +1)
  await enqueuePendingOperation({
    operationId: 'op_11_return',
    seq: 11,
    type: 'return',
    summary: 'مرتجع 1 زيت',
    localTempRef: 'OFF-RET-11',
    actor: ACTOR,
    payload: {
      returnId: 'ret_off_1',
      saleId: 'sale_off_2',
      itemsToReturn: [{ productId: 'prod_oil', qty: 1 }],
      restockValid: true,
      refundCash: true,
      reason: 'تبديل',
    },
    status: 'pending',
    attempts: 0,
    createdAtIso: '2026-05-10T10:10:00.000Z',
  });

  // Verify local projection BEFORE restart
  const projectedBeforeRestart = projectStoreWithPendingOps(
    baseline,
    loadPendingOperations(),
    {}
  );

  // Cash check: 5000 (start) - 2000 (purchase) + 1200 (partial sale) + 3300 (cash sale) + 600 (voucher) - 500 (expense) + 1000 (deposit) - 1100 (return) = 7500
  assert.equal(projectedBeforeRestart.counters.cashBalance, 7500, 'Projected offline cash balance should be 7500');
  // Stock check:
  // rice: 20 - 1 = 19
  // oil: 15 + 5 - 3 + 1 = 18
  // milk: 10 - 2 = 8
  assert.equal(projectedBeforeRestart.products.find((p) => p.id === 'prod_rice')?.stock, 19);
  assert.equal(projectedBeforeRestart.products.find((p) => p.id === 'prod_oil')?.stock, 18);
  assert.equal(projectedBeforeRestart.products.find((p) => p.id === 'prod_milk')?.stock, 8);
  assert.equal(projectedBeforeRestart.products.find((p) => p.id === 'prod_milk')?.barcode, '2000000010206');
  assert.equal(projectedBeforeRestart.products.find((p) => p.id === 'prod_oil')?.costPrice, 750);
  // Customer check:
  assert.equal(projectedBeforeRestart.customers.find((c) => c.id === 'cust_ali')?.balanceDue, 400);
  assert.equal(projectedBeforeRestart.customers.find((c) => c.id === 'cust_mohammed')?.balanceDue, 1800);
  // Supplier check:
  assert.equal(projectedBeforeRestart.suppliers.find((s) => s.id === 'supp_amal')?.balanceDue, 1750);
  // Reserved stock map check:
  const reserved = computeReservedStockMap(loadPendingOperations());
  assert.equal(reserved.get('prod_oil'), 3);
  console.log('[PASS] 2-7. All offline transactions (sales, purchases, products, customers, suppliers, vouchers, expenses, returns) project accurately');

  // 3. Simulate abrupt close DURING 'syncing' & cold restart while STILL offline
  await updatePendingOperation('op_01_prod_create', { status: 'syncing' });
  await reloadQueueFromDbForTests();

  const reloadedBaseline: StoreBaselineData = {
    counters: (await localDbService.getCollection<Counters>('counters'))[0],
    products: await localDbService.getCollection<Product>('products'),
    customers: await localDbService.getCollection<Customer>('customers'),
    suppliers: await localDbService.getCollection<Supplier>('suppliers'),
    sales: [],
    purchases: [],
    returns: [],
    stockMovements: [],
    expenses: [],
    vouchers: [],
    cashTransactions: [],
    auditLogs: [],
  };
  const opsAfterRestart = loadPendingOperations();
  assert.equal(opsAfterRestart.length, 11);
  assert.equal(opsAfterRestart[0].status, 'pending', 'Interrupted syncing status must auto-recover to pending on boot');
  const projectedAfterRestart = projectStoreWithPendingOps(reloadedBaseline, opsAfterRestart, {});
  assert.equal(projectedAfterRestart.counters.cashBalance, 7500);
  assert.equal(projectedAfterRestart.products.find((p) => p.id === 'prod_oil')?.stock, 18);
  console.log('[PASS] 8. App close & cold restart offline preserves 100% of baseline & queue without data loss');

  // 4. Mid-sync disconnect simulation (sync 4 ops, disconnect on 5th, verify no duplicates & clean resume)
  const cloud = createCloudFromBaseline(baseline);
  setNetworkOnlineState(true);
  const queueBatch1 = loadPendingOperations();
  for (let i = 0; i < queueBatch1.length; i++) {
    const op = queueBatch1[i];
    if (i === 4) {
      // Simulate network drop mid-sync
      const netErr = new Error('unavailable: transport errored while reaching Firestore');
      assert.equal(isNetworkOrOfflineError(netErr), true);
      await updatePendingOperation(op.operationId, {
        status: 'pending',
        attempts: op.attempts + 1,
        errorMessage: 'انقطع الاتصال أثناء الترحيل',
      });
      await updateSyncMeta({ lastSyncError: 'انقطع الاتصال أثناء الترحيل' });
      break;
    }
    const res = applyOpToCloud(cloud, op);
    await markOperationSynced(op.operationId, res.referenceId, res.referenceNumber);
  }

  assert.equal(loadPendingOperations().length, 7, '4 synced ops removed from pending, 7 remain pending');
  assert.equal(loadAllQueueOperations().filter((o) => o.status === 'synced').length, 4);
  assert.equal(getSyncMetaCache().totalSyncedCount, 4);

  // Resume sync after reconnect & verify idempotency (even if op_01 were retried, cloud ignores duplicate operationId)
  const duplicateRes = applyOpToCloud(cloud, queueBatch1[3]); // op_04_purchase again!
  assert.equal(duplicateRes.referenceId, 'op_04_purchase');
  assert.equal(cloud.counters.cashBalance, 3000, 'Replaying already-processed purchase must NOT double-deduct cash');

  for (const op of loadPendingOperations()) {
    const res = applyOpToCloud(cloud, op);
    await markOperationSynced(op.operationId, res.referenceId, res.referenceNumber);
  }

  assert.equal(loadPendingOperations().length, 0);
  assert.equal(getSyncMetaCache().totalSyncedCount, 11);
  assert.equal(cloud.counters.cashBalance, 7500, 'Final Cloud cashBalance MUST match local offline projection 7500');
  assert.equal(cloud.products.get('prod_rice')?.stock, 19);
  assert.equal(cloud.products.get('prod_oil')?.stock, 18);
  assert.equal(cloud.products.get('prod_milk')?.stock, 8);
  assert.equal(cloud.customers.get('cust_ali')?.balanceDue, 400);
  assert.equal(cloud.customers.get('cust_mohammed')?.balanceDue, 1800);
  assert.equal(cloud.suppliers.get('supp_amal')?.balanceDue, 1750);
  console.log('[PASS] 9-10. Mid-sync disconnect, clean resume, and strict operationId idempotency verified');

  // 5. Multi-device conflict & concurrency scenarios:
  // (A) Device 2 sells 4 bags of rice while Device 1 offline sells 2 bags of rice -> delta sync leaves 19 - 4 - 2 = 13!
  cloud.products.get('prod_rice')!.stock -= 4; // Device 2 sold 4 -> server now has 15
  await enqueuePendingOperation({
    operationId: 'op_12_dev1_sale',
    seq: 12,
    type: 'sale',
    summary: 'بيع متزامن أرز',
    localTempRef: 'OFF-INV-12',
    actor: ACTOR,
    payload: {
      saleId: 'sale_dev1_concurrent',
      customer: null,
      items: [{ productId: 'prod_rice', qty: 2, unitPrice: 2100 }],
      discount: 0,
      paymentMethod: 'cash',
      paidAmount: 4200,
    },
    status: 'pending',
    attempts: 0,
    createdAtIso: '2026-05-10T11:00:00.000Z',
  });
  const dev1Op = loadPendingOperations()[0];
  applyOpToCloud(cloud, dev1Op);
  await markOperationSynced(dev1Op.operationId);
  assert.equal(cloud.products.get('prod_rice')?.stock, 13, 'Concurrent delta sales on two devices must preserve both deductions');

  // (B) Stocktake conflict detection & apply_delta resolution:
  // Device 1 captured expectedStockAtCapture = 13, counted 11 (delta = -2 shrinkage).
  // Meanwhile Device 2 sold 3 more bags on server -> server stock = 10!
  cloud.products.get('prod_rice')!.stock = 10;
  await enqueuePendingOperation({
    operationId: 'op_13_stocktake_conflict',
    seq: 13,
    type: 'stock_adjust',
    summary: 'جرد الأرز',
    localTempRef: 'HS-1001',
    actor: ACTOR,
    payload: {
      productId: 'prod_rice',
      mode: 'stocktake',
      quantityOrActual: 11,
      expectedStockAtCapture: 13,
      reason: 'جرد عجز 2 كيس',
    },
    status: 'pending',
    attempts: 0,
    createdAtIso: '2026-05-10T11:05:00.000Z',
  });

  let caughtConflict = false;
  try {
    applyOpToCloud(cloud, loadPendingOperations()[0]);
  } catch (err) {
    caughtConflict = true;
    await updatePendingOperation('op_13_stocktake_conflict', {
      status: 'conflict',
      errorMessage: (err as Error).message,
    });
  }
  assert.equal(caughtConflict, true, 'Stocktake against changed server stock must raise conflict');

  // Resolve with apply_delta -> applies -2 delta onto current server stock 10 => 8!
  await updatePendingOperation('op_13_stocktake_conflict', {
    status: 'pending',
    payload: {
      ...loadPendingOperations()[0].payload,
      applyDeltaOnConflict: true,
    },
  });
  applyOpToCloud(cloud, loadPendingOperations()[0]);
  await markOperationSynced('op_13_stocktake_conflict');
  assert.equal(cloud.products.get('prod_rice')?.stock, 8, 'apply_delta stocktake resolution preserves post-capture sales');

  // (C) Insufficient stock conflict must NOT block unrelated expense op
  await enqueuePendingOperation({
    operationId: 'op_14_oversell',
    seq: 14,
    type: 'sale',
    summary: 'بيع أكثر من الرصيد',
    localTempRef: 'OFF-INV-14',
    actor: ACTOR,
    payload: {
      saleId: 'sale_oversell',
      customer: null,
      items: [{ productId: 'prod_rice', qty: 50, unitPrice: 2100 }],
      discount: 0,
      paymentMethod: 'cash',
      paidAmount: 105000,
    },
    status: 'pending',
    attempts: 0,
    createdAtIso: '2026-05-10T11:10:00.000Z',
  });
  await enqueuePendingOperation({
    operationId: 'op_15_valid_expense',
    seq: 15,
    type: 'expense',
    summary: 'كهرباء',
    localTempRef: 'OFF-EXP-15',
    actor: ACTOR,
    payload: { expenseId: 'exp_after_conflict', title: 'كهرباء', category: 'مرافق', amount: 200 },
    status: 'pending',
    attempts: 0,
    createdAtIso: '2026-05-10T11:11:00.000Z',
  });

  for (const op of loadPendingOperations()) {
    try {
      applyOpToCloud(cloud, op);
      await markOperationSynced(op.operationId);
    } catch (err) {
      assert.equal(isNetworkOrOfflineError(err), false);
      await updatePendingOperation(op.operationId, {
        status: 'conflict',
        errorMessage: (err as Error).message,
      });
    }
  }
  assert.equal(
    loadPendingOperations().find((o) => o.operationId === 'op_14_oversell')?.status,
    'conflict'
  );
  assert.equal(
    loadAllQueueOperations().find((o) => o.operationId === 'op_15_valid_expense')?.status,
    'synced',
    'Valid non-dependent operations must continue syncing when an earlier op conflicts'
  );

  // (D) Sale cancellation offline & sync restores stock, cash & customer debt accurately
  await enqueuePendingOperation({
    operationId: 'op_16_cancel_sale',
    seq: 16,
    type: 'sale_cancel',
    summary: 'إلغاء فاتورة البيع الجزئي',
    localTempRef: 'OFF-INV-06',
    actor: ACTOR,
    payload: { saleId: 'sale_off_1', reason: 'خطأ في الإدخال' },
    status: 'pending',
    attempts: 0,
    createdAtIso: '2026-05-10T11:15:00.000Z',
  });
  const milkBeforeCancel = cloud.products.get('prod_milk')!.stock;
  const riceBeforeCancel = cloud.products.get('prod_rice')!.stock;
  const cashBeforeCancel = cloud.counters.cashBalance;
  applyOpToCloud(cloud, loadPendingOperations().find((o) => o.operationId === 'op_16_cancel_sale')!);
  await markOperationSynced('op_16_cancel_sale');

  assert.equal(cloud.products.get('prod_milk')!.stock, milkBeforeCancel + 2);
  assert.equal(cloud.products.get('prod_rice')!.stock, riceBeforeCancel + 1);
  assert.equal(cloud.counters.cashBalance, cashBeforeCancel - 1200);
  assert.equal(cloud.customers.get('cust_mohammed')!.balanceDue, 0);
  console.log('[PASS] 11-14. Multi-device delta sync, stocktake conflict/resolution, non-blocking error isolation & invoice cancellation verified');

  // 6. Integrated Barcode System Verification
  assert.equal(normalizeBarcode('  \u200E٦٢٩١٠٤١٥٠٠٢١٣\u200F '), '6291041500213');
  assert.equal(normalizeBarcode(' hs-1001 '), 'HS-1001');
  assert.equal(isValidBarcodeFormat('6291041500213'), true);
  assert.equal(isValidBarcodeFormat('HS-1001'), true);
  assert.equal(isValidBarcodeFormat('باركود'), false);

  assert.equal(computeEan13CheckDigit('629104150021'), '3');
  assert.equal(isValidEan13('6291041500213'), true);
  assert.equal(isValidEan13('6291041500214'), false);

  const generated1 = generateUniqueProductBarcode(baseline.products, 1003);
  assert.equal(isValidEan13(generated1), true);
  const augmentedProducts: Product[] = [
    ...baseline.products,
    { ...baseline.products[0], id: 'prod_gen1', code: 'HS-1003', barcode: generated1 },
  ];
  const generated2 = generateUniqueProductBarcode(augmentedProducts, 1003);
  assert.notEqual(generated2, generated1);
  assert.equal(isValidEan13(generated2), true);

  assert.equal(findBarcodeConflict('629100000001', baseline.products)?.id, 'prod_rice');
  assert.equal(findBarcodeConflict('629100000001', baseline.products, 'prod_rice'), null);
  assert.equal(findBarcodeConflict('hs-1002', baseline.products)?.id, 'prod_oil');

  const encEan = encodeBarcode('6291041500213');
  assert.equal(encEan.format, 'EAN-13');
  assert.equal(encEan.bits.length, 95);
  assert.equal(encEan.bits.slice(0, 3), '101');
  assert.equal(encEan.bits.slice(45, 50), '01010');
  assert.equal(encEan.bits.slice(92, 95), '101');

  const enc128 = encodeBarcode('HS-1001');
  assert.equal(enc128.format, 'CODE-128');
  assert.ok(enc128.bits.length > 60);
  const svg = buildBarcodeSvgMarkup('6291041500213');
  assert.ok(svg.startsWith('<svg ') && svg.includes('6291041500213'));
  console.log('[PASS] 15. Barcode normalization, EAN-13/Code-128 encoding, uniqueness & SVG rendering verified');

  console.log('=== ALL 15 PRACTICAL SCENARIOS PASSED PERFECTLY ===');
}

runTests().catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});
