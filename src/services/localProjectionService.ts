import type {
  AuditLog,
  CashTransaction,
  Counters,
  Customer,
  Expense,
  PaymentMethod,
  PendingOperation,
  Product,
  PurchaseInvoice,
  PurchaseItem,
  ReturnItem,
  SaleInvoice,
  SaleItem,
  SalesReturn,
  StockMovement,
  Supplier,
  Voucher,
} from '../types';
import { roundMoney, truncateText } from '../utils/format';
import { makeLocalTimestamp } from './localDbService';

export interface StoreBaselineData {
  counters: Counters;
  products: Product[];
  customers: Customer[];
  suppliers: Supplier[];
  sales: SaleInvoice[];
  purchases: PurchaseInvoice[];
  returns: SalesReturn[];
  stockMovements: StockMovement[];
  expenses: Expense[];
  vouchers: Voucher[];
  cashTransactions: CashTransaction[];
  auditLogs: AuditLog[];
}

function toMs(iso: string | undefined): number {
  if (!iso) return Date.now();
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

function cloneArray<T extends object>(arr: T[]): T[] {
  return arr.map((item) => ({ ...item }));
}

function sortByCreatedDesc<T extends { createdAt: { toMillis: () => number } | null }>(
  arr: T[]
): T[] {
  return [...arr].sort(
    (a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0)
  );
}

/**
 * Pure deterministic projection: takes the server/local baseline and replays all
 * un-synced pending operations in sequence without mutating inputs.
 * Guarantees UI, Dashboard, Inventory, Debts, Cashbox, and Reports reflect
 * offline actions immediately and survive app restarts without double-counting.
 */
export function projectStoreWithPendingOps(
  baseline: StoreBaselineData,
  pendingOperations: PendingOperation[],
  idMap: Record<string, { referenceId: string; referenceNumber?: string }> = {}
): StoreBaselineData {
  const activeOps = pendingOperations
    .filter((op) => op.status !== 'synced')
    .sort((a, b) => {
      const seqDiff = (a.seq || 0) - (b.seq || 0);
      if (seqDiff !== 0) return seqDiff;
      return a.createdAtIso.localeCompare(b.createdAtIso);
    });

  if (activeOps.length === 0) {
    return baseline;
  }

  const counters: Counters = { ...baseline.counters };
  let products = cloneArray(baseline.products);
  const customers = cloneArray(baseline.customers);
  const suppliers = cloneArray(baseline.suppliers);
  const sales = cloneArray(baseline.sales);
  const purchases = cloneArray(baseline.purchases);
  const returns = cloneArray(baseline.returns);
  const stockMovements = cloneArray(baseline.stockMovements);
  const expenses = cloneArray(baseline.expenses);
  const vouchers = cloneArray(baseline.vouchers);
  const cashTransactions = cloneArray(baseline.cashTransactions);
  const auditLogs = cloneArray(baseline.auditLogs);

  const findProduct = (id: string) => products.find((p) => p.id === id);
  const findCustomer = (id: string) => customers.find((c) => c.id === id);
  const findSupplier = (id: string) => suppliers.find((s) => s.id === id);

  for (const op of activeOps) {
    const p = op.payload;
    const ts = makeLocalTimestamp(toMs(op.createdAtIso));
    const actor = op.actor;

    if (op.type === 'product_create') {
      const productId = String(p.productId || op.operationId);
      if (products.some((x) => x.id === productId)) continue;
      const code = String(p.code || op.localTempRef).toUpperCase();
      const stock = Math.max(0, Number(p.stock || 0));
      const newProd: Product = {
        id: productId,
        code,
        barcode: typeof p.barcode === 'string' && p.barcode.trim() ? p.barcode.trim() : undefined,
        name: String(p.name || 'صنف جديد'),
        category: String(p.category || 'عام'),
        description:
          typeof p.description === 'string' && p.description.trim()
            ? p.description.trim()
            : undefined,
        unit: String(p.unit || 'حبة'),
        costPrice: roundMoney(Math.max(0, Number(p.costPrice || 0))),
        sellPrice: roundMoney(Math.max(0, Number(p.sellPrice || 0))),
        stock,
        minStock: Math.max(0, Number(p.minStock || 0)),
        isActive: true,
        createdBy: actor.uid,
        createdAt: ts as unknown as Product['createdAt'],
        updatedAt: ts as unknown as Product['updatedAt'],
      };
      products.push(newProd);
      counters.nextProductSeq = Math.max(counters.nextProductSeq + 1, 1002);

      if (stock > 0) {
        stockMovements.unshift({
          id: `local_mov_${op.operationId}`,
          productId,
          productCode: code,
          productName: newProd.name,
          type: 'in',
          qtyChange: stock,
          previousStock: 0,
          newStock: stock,
          referenceType: 'initial',
          referenceId: productId,
          referenceNumber: code,
          reason: 'رصيد افتتاحي عند إضافة الصنف (محلي)',
          employeeId: actor.uid,
          employeeName: actor.name,
          deviceId: actor.deviceId,
          deviceName: actor.deviceName,
          createdAt: ts as unknown as StockMovement['createdAt'],
        });
      }
      continue;
    }

    if (op.type === 'product_update') {
      const productId = String(p.productId || '');
      const target = findProduct(productId);
      if (!target) continue;
      target.name = String(p.name ?? target.name);
      target.category = String(p.category ?? target.category);
      target.unit = String(p.unit ?? target.unit);
      target.costPrice = roundMoney(Math.max(0, Number(p.costPrice ?? target.costPrice)));
      target.sellPrice = roundMoney(Math.max(0, Number(p.sellPrice ?? target.sellPrice)));
      target.minStock = Math.max(0, Number(p.minStock ?? target.minStock));
      if (typeof p.isActive === 'boolean') target.isActive = p.isActive;
      target.barcode =
        typeof p.barcode === 'string' && p.barcode.trim() ? p.barcode.trim() : undefined;
      target.description =
        typeof p.description === 'string' && p.description.trim()
          ? p.description.trim()
          : undefined;
      target.updatedAt = ts as unknown as Product['updatedAt'];
      continue;
    }

    if (op.type === 'product_delete') {
      const productId = String(p.productId || '');
      products = products.filter((x) => x.id !== productId);
      continue;
    }

    if (op.type === 'customer_create') {
      const customerId = String(p.customerId || op.operationId);
      if (customers.some((c) => c.id === customerId)) continue;
      const custCode = String(p.customerCode || op.localTempRef);
      customers.unshift({
        id: customerId,
        customerCode: custCode,
        name: String(p.name || 'عميل جديد'),
        phone: typeof p.phone === 'string' && p.phone.trim() ? p.phone.trim() : undefined,
        address: typeof p.address === 'string' && p.address.trim() ? p.address.trim() : undefined,
        notes: typeof p.notes === 'string' && p.notes.trim() ? p.notes.trim() : undefined,
        totalPurchases: 0,
        totalPaid: 0,
        balanceDue: 0,
        createdBy: actor.uid,
        createdAt: ts as unknown as Customer['createdAt'],
        updatedAt: ts as unknown as Customer['updatedAt'],
      });
      counters.nextCustomerSeq = Math.max(counters.nextCustomerSeq + 1, 1002);
      continue;
    }

    if (op.type === 'customer_update') {
      const customerId = String(p.customerId || '');
      const target = findCustomer(customerId);
      if (!target) continue;
      target.name = String(p.name ?? target.name);
      target.phone = typeof p.phone === 'string' && p.phone.trim() ? p.phone.trim() : undefined;
      target.address =
        typeof p.address === 'string' && p.address.trim() ? p.address.trim() : undefined;
      target.notes = typeof p.notes === 'string' && p.notes.trim() ? p.notes.trim() : undefined;
      target.updatedAt = ts as unknown as Customer['updatedAt'];
      continue;
    }

    if (op.type === 'supplier_create') {
      const supplierId = String(p.supplierId || op.operationId);
      if (suppliers.some((s) => s.id === supplierId)) continue;
      const suppCode = String(p.supplierCode || op.localTempRef);
      suppliers.unshift({
        id: supplierId,
        supplierCode: suppCode,
        name: String(p.name || 'مورد جديد'),
        phone: typeof p.phone === 'string' && p.phone.trim() ? p.phone.trim() : undefined,
        address: typeof p.address === 'string' && p.address.trim() ? p.address.trim() : undefined,
        notes: typeof p.notes === 'string' && p.notes.trim() ? p.notes.trim() : undefined,
        totalPurchases: 0,
        totalPaid: 0,
        balanceDue: 0,
        createdBy: actor.uid,
        createdAt: ts as unknown as Supplier['createdAt'],
        updatedAt: ts as unknown as Supplier['updatedAt'],
      });
      counters.nextSupplierSeq = Math.max(counters.nextSupplierSeq + 1, 1002);
      continue;
    }

    if (op.type === 'supplier_update') {
      const supplierId = String(p.supplierId || '');
      const target = findSupplier(supplierId);
      if (!target) continue;
      target.name = String(p.name ?? target.name);
      target.phone = typeof p.phone === 'string' && p.phone.trim() ? p.phone.trim() : undefined;
      target.address =
        typeof p.address === 'string' && p.address.trim() ? p.address.trim() : undefined;
      target.notes = typeof p.notes === 'string' && p.notes.trim() ? p.notes.trim() : undefined;
      target.updatedAt = ts as unknown as Supplier['updatedAt'];
      continue;
    }

    if (op.type === 'sale') {
      const saleId = String(p.saleId || op.operationId);
      if (
        sales.some((s) => s.id === saleId || s.operationId === op.operationId)
      ) {
        continue;
      }

      const reqItems =
        (p.items as Array<{
          productId: string;
          qty: number;
          unitPrice: number;
          code?: string;
          name?: string;
          unit?: string;
          costPrice?: number;
        }>) || [];
      const customerInput = p.customer as {
        id: string;
        customerCode: string;
        name: string;
      } | null;
      const paymentMethod = (p.paymentMethod as PaymentMethod) || 'cash';

      const saleItems: SaleItem[] = [];
      let subtotal = 0;
      let totalCost = 0;

      reqItems.forEach((it, idx) => {
        const prod = findProduct(it.productId);
        const unitPrice = roundMoney(Math.max(0, Number(it.unitPrice) || 0));
        const costPrice = roundMoney(prod ? prod.costPrice : Number(it.costPrice) || 0);
        const lineTotal = roundMoney(unitPrice * it.qty);
        subtotal = roundMoney(subtotal + lineTotal);
        totalCost = roundMoney(totalCost + costPrice * it.qty);

        saleItems.push({
          productId: it.productId,
          code: prod?.code || it.code || '',
          name: prod?.name || it.name || 'صنف',
          unit: prod?.unit || it.unit || 'حبة',
          qty: it.qty,
          costPrice,
          unitPrice,
          lineTotal,
        });

        if (prod) {
          const prevStock = prod.stock;
          const newStock = Math.max(0, roundMoney(prevStock - it.qty));
          prod.stock = newStock;
          stockMovements.unshift({
            id: `local_mov_${op.operationId}_${idx}`,
            productId: prod.id,
            productCode: prod.code,
            productName: prod.name,
            type: 'sale',
            qtyChange: -it.qty,
            previousStock: prevStock,
            newStock,
            referenceType: 'sale',
            referenceId: saleId,
            referenceNumber: op.localTempRef,
            reason: `فاتورة مبيعات رقم ${op.localTempRef} (محلي)`,
            employeeId: actor.uid,
            employeeName: actor.name,
            deviceId: actor.deviceId,
            deviceName: actor.deviceName,
            createdAt: ts as unknown as StockMovement['createdAt'],
          });
        }
      });

      const discount = roundMoney(
        Math.min(Math.max(0, Number(p.discount || 0)), subtotal)
      );
      const total = roundMoney(Math.max(0, subtotal - discount));
      const paidAmount =
        paymentMethod === 'cash'
          ? total
          : paymentMethod === 'credit'
          ? 0
          : roundMoney(Math.min(Math.max(0, Number(p.paidAmount || 0)), total));
      const remainingAmount = roundMoney(Math.max(0, total - paidAmount));
      const netProfit = roundMoney(total - totalCost);

      if (customerInput?.id) {
        const cust = findCustomer(customerInput.id);
        if (cust) {
          cust.totalPurchases = roundMoney(cust.totalPurchases + total);
          cust.totalPaid = roundMoney(cust.totalPaid + paidAmount);
          cust.balanceDue = roundMoney(cust.balanceDue + remainingAmount);
        }
      }

      if (paidAmount > 0) {
        counters.cashBalance = roundMoney(counters.cashBalance + paidAmount);
        cashTransactions.unshift({
          id: `local_cash_${op.operationId}`,
          type: 'in',
          category: 'مبيعات',
          amount: paidAmount,
          balanceAfter: counters.cashBalance,
          referenceId: saleId,
          referenceNumber: op.localTempRef,
          description: `تحصيل فاتورة مبيعات ${op.localTempRef} - ${
            customerInput?.name || 'عميل نقدي عام'
          }`,
          employeeId: actor.uid,
          employeeName: actor.name,
          deviceId: actor.deviceId,
          deviceName: actor.deviceName,
          createdAt: ts as unknown as CashTransaction['createdAt'],
        });
      }

      sales.unshift({
        id: saleId,
        invoiceNumber: op.localTempRef,
        employeeId: actor.uid,
        employeeName: actor.name,
        deviceId: actor.deviceId,
        deviceName: actor.deviceName,
        operationId: op.operationId,
        customerId: customerInput?.id,
        customerCode: customerInput?.customerCode,
        customerName: customerInput?.name || 'عميل نقدي عام',
        items: saleItems,
        subtotal,
        discount,
        total,
        paidAmount,
        remainingAmount,
        totalCost,
        netProfit,
        paymentMethod,
        status: 'completed',
        notes: typeof p.notes === 'string' && p.notes.trim() ? p.notes : undefined,
        isOfflinePending: true,
        createdAt: ts as unknown as SaleInvoice['createdAt'],
        updatedAt: ts as unknown as SaleInvoice['updatedAt'],
      });

      auditLogs.unshift({
        id: `local_aud_${op.operationId}`,
        action: 'عملية بيع (محلي)',
        entityType: 'sale',
        entityId: saleId,
        summary: op.summary,
        actorId: actor.uid,
        actorName: actor.name,
        actorRole: actor.role,
        deviceId: actor.deviceId,
        deviceName: actor.deviceName,
        createdAt: ts as unknown as AuditLog['createdAt'],
      });
      continue;
    }

    if (op.type === 'purchase') {
      const purchaseId = String(p.purchaseId || op.operationId);
      if (
        purchases.some(
          (x) => x.id === purchaseId || x.operationId === op.operationId
        )
      ) {
        continue;
      }

      const supplierInput = p.supplier as {
        id: string;
        supplierCode?: string;
        name: string;
      };
      const reqItems =
        (p.items as Array<{
          productId: string;
          qty: number;
          costPrice: number;
          updateProductCost: boolean;
        }>) || [];
      const paymentMethod = (p.paymentMethod as PaymentMethod) || 'cash';

      const purchaseItems: PurchaseItem[] = [];
      let total = 0;

      reqItems.forEach((it, idx) => {
        const prod = findProduct(it.productId);
        const costPrice = roundMoney(Math.max(0, Number(it.costPrice) || 0));
        const lineTotal = roundMoney(costPrice * it.qty);
        total = roundMoney(total + lineTotal);

        purchaseItems.push({
          productId: it.productId,
          code: prod?.code || '',
          name: prod?.name || 'صنف',
          unit: prod?.unit || 'حبة',
          qty: it.qty,
          costPrice,
          lineTotal,
        });

        if (prod) {
          const prevStock = prod.stock;
          const newStock = roundMoney(prevStock + it.qty);
          prod.stock = newStock;
          if (it.updateProductCost) {
            prod.costPrice = costPrice;
          }
          stockMovements.unshift({
            id: `local_mov_${op.operationId}_${idx}`,
            productId: prod.id,
            productCode: prod.code,
            productName: prod.name,
            type: 'purchase',
            qtyChange: it.qty,
            previousStock: prevStock,
            newStock,
            referenceType: 'purchase',
            referenceId: purchaseId,
            referenceNumber: op.localTempRef,
            reason: `فاتورة مشتريات رقم ${op.localTempRef} من ${supplierInput.name} (محلي)`,
            employeeId: actor.uid,
            employeeName: actor.name,
            deviceId: actor.deviceId,
            deviceName: actor.deviceName,
            createdAt: ts as unknown as StockMovement['createdAt'],
          });
        }
      });

      const paidAmount =
        paymentMethod === 'cash'
          ? total
          : paymentMethod === 'credit'
          ? 0
          : roundMoney(Math.min(Math.max(0, Number(p.paidAmount || 0)), total));
      const remainingAmount = roundMoney(Math.max(0, total - paidAmount));

      const supp = findSupplier(supplierInput.id);
      if (supp) {
        supp.totalPurchases = roundMoney(supp.totalPurchases + total);
        supp.totalPaid = roundMoney(supp.totalPaid + paidAmount);
        supp.balanceDue = roundMoney(supp.balanceDue + remainingAmount);
      }

      if (paidAmount > 0) {
        counters.cashBalance = roundMoney(counters.cashBalance - paidAmount);
        cashTransactions.unshift({
          id: `local_cash_${op.operationId}`,
          type: 'out',
          category: 'مشتريات',
          amount: paidAmount,
          balanceAfter: counters.cashBalance,
          referenceId: purchaseId,
          referenceNumber: op.localTempRef,
          description: `سداد فاتورة شراء ${op.localTempRef} للمورد ${supplierInput.name}`,
          employeeId: actor.uid,
          employeeName: actor.name,
          deviceId: actor.deviceId,
          deviceName: actor.deviceName,
          createdAt: ts as unknown as CashTransaction['createdAt'],
        });
      }

      purchases.unshift({
        id: purchaseId,
        purchaseNumber: op.localTempRef,
        supplierId: supplierInput.id,
        supplierCode: supplierInput.supplierCode,
        supplierName: supplierInput.name,
        employeeId: actor.uid,
        employeeName: actor.name,
        deviceId: actor.deviceId,
        deviceName: actor.deviceName,
        operationId: op.operationId,
        items: purchaseItems,
        total,
        paidAmount,
        remainingAmount,
        paymentMethod,
        status: 'completed',
        notes: typeof p.notes === 'string' && p.notes.trim() ? p.notes : undefined,
        createdAt: ts as unknown as PurchaseInvoice['createdAt'],
        updatedAt: ts as unknown as PurchaseInvoice['updatedAt'],
      });
      continue;
    }

    if (op.type === 'return') {
      const returnId = String(p.returnId || op.operationId);
      if (returns.some((r) => r.id === returnId || r.operationId === op.operationId)) {
        continue;
      }

      const rawSaleId = String(p.saleId || '');
      const resolvedSaleId = idMap[rawSaleId]?.referenceId || rawSaleId;
      const targetSale = sales.find(
        (s) => s.id === resolvedSaleId || s.id === rawSaleId
      );
      if (!targetSale || targetSale.status === 'cancelled') continue;

      const itemsToReturn = (p.itemsToReturn as Array<{ productId: string; qty: number }>) || [];
      const restockValid = Boolean(p.restockValid);
      const refundCash = Boolean(p.refundCash);
      const reason = String(p.reason || 'مرتجع عميل');
      const discountRatio =
        targetSale.subtotal > 0 ? targetSale.total / targetSale.subtotal : 1;

      const returnItems: ReturnItem[] = [];
      let refundAmount = 0;
      let returnedCost = 0;

      itemsToReturn.forEach((req, idx) => {
        const origItem = targetSale.items.find((x) => x.productId === req.productId);
        if (!origItem || req.qty <= 0) return;

        const effectiveUnitPrice = roundMoney(origItem.unitPrice * discountRatio);
        const lineTotal = roundMoney(effectiveUnitPrice * req.qty);
        const lineCost = roundMoney(origItem.costPrice * req.qty);
        refundAmount = roundMoney(refundAmount + lineTotal);
        returnedCost = roundMoney(returnedCost + lineCost);

        returnItems.push({
          productId: origItem.productId,
          code: origItem.code,
          name: origItem.name,
          qty: req.qty,
          unitPrice: effectiveUnitPrice,
          costPrice: origItem.costPrice,
          lineTotal,
        });

        if (restockValid) {
          const prod = findProduct(origItem.productId);
          if (prod) {
            const prevStock = prod.stock;
            const newStock = roundMoney(prevStock + req.qty);
            prod.stock = newStock;
            stockMovements.unshift({
              id: `local_mov_${op.operationId}_${idx}`,
              productId: prod.id,
              productCode: prod.code,
              productName: prod.name,
              type: 'return',
              qtyChange: req.qty,
              previousStock: prevStock,
              newStock,
              referenceType: 'return',
              referenceId: returnId,
              referenceNumber: op.localTempRef,
              reason: `مرتجع فاتورة ${targetSale.invoiceNumber}: ${reason}`,
              employeeId: actor.uid,
              employeeName: actor.name,
              deviceId: actor.deviceId,
              deviceName: actor.deviceName,
              createdAt: ts as unknown as StockMovement['createdAt'],
            });
          }
        }
      });

      const returnedProfit = roundMoney(refundAmount - returnedCost);

      // Determine partial vs full return
      const returnedSoFar = new Map<string, number>();
      for (const r of returns) {
        if (r.saleId === targetSale.id) {
          for (const it of r.items) {
            returnedSoFar.set(it.productId, (returnedSoFar.get(it.productId) || 0) + it.qty);
          }
        }
      }
      for (const it of returnItems) {
        returnedSoFar.set(it.productId, (returnedSoFar.get(it.productId) || 0) + it.qty);
      }
      const allReturned = targetSale.items.every(
        (orig) => (returnedSoFar.get(orig.productId) || 0) >= orig.qty
      );
      targetSale.status = allReturned ? 'returned' : 'partial_return';

      if (targetSale.customerId) {
        const cust = findCustomer(targetSale.customerId);
        if (cust) {
          const debtReduction = refundCash ? 0 : Math.min(cust.balanceDue, refundAmount);
          cust.totalPurchases = Math.max(0, roundMoney(cust.totalPurchases - refundAmount));
          cust.totalPaid = refundCash
            ? Math.max(0, roundMoney(cust.totalPaid - refundAmount))
            : cust.totalPaid;
          cust.balanceDue = roundMoney(cust.balanceDue - debtReduction);
        }
      }

      if (refundCash && refundAmount > 0) {
        counters.cashBalance = roundMoney(counters.cashBalance - refundAmount);
        cashTransactions.unshift({
          id: `local_cash_${op.operationId}`,
          type: 'out',
          category: 'مرتجعات',
          amount: refundAmount,
          balanceAfter: counters.cashBalance,
          referenceId: returnId,
          referenceNumber: op.localTempRef,
          description: `رد مبلغ مرتجع ${op.localTempRef} عن فاتورة ${targetSale.invoiceNumber}`,
          employeeId: actor.uid,
          employeeName: actor.name,
          deviceId: actor.deviceId,
          deviceName: actor.deviceName,
          createdAt: ts as unknown as CashTransaction['createdAt'],
        });
      }

      returns.unshift({
        id: returnId,
        returnNumber: op.localTempRef,
        saleId: targetSale.id,
        invoiceNumber: targetSale.invoiceNumber,
        customerId: targetSale.customerId,
        customerName: targetSale.customerName,
        employeeId: actor.uid,
        employeeName: actor.name,
        deviceId: actor.deviceId,
        deviceName: actor.deviceName,
        operationId: op.operationId,
        items: returnItems,
        refundAmount,
        returnedCost,
        returnedProfit,
        reason,
        restockValid,
        createdAt: ts as unknown as SalesReturn['createdAt'],
      });
      continue;
    }

    if (op.type === 'sale_cancel') {
      const rawSaleId = String(p.saleId || '');
      const resolvedSaleId = idMap[rawSaleId]?.referenceId || rawSaleId;
      const targetSale = sales.find(
        (s) => s.id === resolvedSaleId || s.id === rawSaleId
      );
      if (!targetSale || targetSale.status === 'cancelled') continue;

      const reason = String(p.reason || 'إلغاء فاتورة');
      targetSale.status = 'cancelled';
      targetSale.notes = truncateText(`ملغاة: ${reason}`, 300);

      targetSale.items.forEach((it, idx) => {
        const prod = findProduct(it.productId);
        if (prod) {
          const prevStock = prod.stock;
          const newStock = roundMoney(prevStock + it.qty);
          prod.stock = newStock;
          stockMovements.unshift({
            id: `local_mov_${op.operationId}_${idx}`,
            productId: prod.id,
            productCode: prod.code,
            productName: prod.name,
            type: 'cancel_restore',
            qtyChange: it.qty,
            previousStock: prevStock,
            newStock,
            referenceType: 'sale_cancel',
            referenceId: targetSale.id,
            referenceNumber: targetSale.invoiceNumber,
            reason: `إلغاء فاتورة ${targetSale.invoiceNumber}: ${reason}`,
            employeeId: actor.uid,
            employeeName: actor.name,
            deviceId: actor.deviceId,
            deviceName: actor.deviceName,
            createdAt: ts as unknown as StockMovement['createdAt'],
          });
        }
      });

      if (targetSale.customerId) {
        const cust = findCustomer(targetSale.customerId);
        if (cust) {
          cust.totalPurchases = Math.max(0, roundMoney(cust.totalPurchases - targetSale.total));
          cust.totalPaid = Math.max(0, roundMoney(cust.totalPaid - targetSale.paidAmount));
          cust.balanceDue = roundMoney(cust.balanceDue - targetSale.remainingAmount);
        }
      }

      if (targetSale.paidAmount > 0) {
        counters.cashBalance = roundMoney(counters.cashBalance - targetSale.paidAmount);
        cashTransactions.unshift({
          id: `local_cash_${op.operationId}`,
          type: 'out',
          category: 'إلغاء فاتورة',
          amount: targetSale.paidAmount,
          balanceAfter: counters.cashBalance,
          referenceId: targetSale.id,
          referenceNumber: targetSale.invoiceNumber,
          description: `عكس تحصيل فاتورة ملغاة ${targetSale.invoiceNumber}`,
          employeeId: actor.uid,
          employeeName: actor.name,
          deviceId: actor.deviceId,
          deviceName: actor.deviceName,
          createdAt: ts as unknown as CashTransaction['createdAt'],
        });
      }
      continue;
    }

    if (op.type === 'stock_adjust') {
      const productId = String(p.productId || '');
      const prod = findProduct(productId);
      if (!prod) continue;
      const mode = (p.mode as 'in' | 'out' | 'stocktake') || 'stocktake';
      const qtyVal = Number(p.quantityOrActual || 0);
      const prevStock = prod.stock;
      let newStock = prevStock;
      let qtyChange = 0;

      if (mode === 'in') {
        qtyChange = Math.max(0, qtyVal);
        newStock = roundMoney(prevStock + qtyChange);
      } else if (mode === 'out') {
        qtyChange = -Math.max(0, qtyVal);
        newStock = Math.max(0, roundMoney(prevStock + qtyChange));
      } else {
        newStock = Math.max(0, qtyVal);
        qtyChange = roundMoney(newStock - prevStock);
      }

      prod.stock = newStock;
      stockMovements.unshift({
        id: `local_mov_${op.operationId}`,
        productId: prod.id,
        productCode: prod.code,
        productName: prod.name,
        type: mode,
        qtyChange,
        previousStock: prevStock,
        newStock,
        referenceType: 'inventory',
        referenceId: prod.id,
        referenceNumber: prod.code,
        reason: String(p.reason || 'تعديل مخزون (محلي)'),
        employeeId: actor.uid,
        employeeName: actor.name,
        deviceId: actor.deviceId,
        deviceName: actor.deviceName,
        createdAt: ts as unknown as StockMovement['createdAt'],
      });
      continue;
    }

    if (op.type === 'expense') {
      const expId = String(p.expenseId || op.operationId);
      if (expenses.some((e) => e.id === expId || e.operationId === op.operationId)) {
        continue;
      }
      const amount = roundMoney(Math.max(0, Number(p.amount || 0)));
      const title = String(p.title || 'مصروف');
      const category = String(p.category || 'عام');

      counters.cashBalance = roundMoney(counters.cashBalance - amount);
      expenses.unshift({
        id: expId,
        title,
        category,
        amount,
        notes: typeof p.notes === 'string' && p.notes.trim() ? p.notes : undefined,
        employeeId: actor.uid,
        employeeName: actor.name,
        deviceId: actor.deviceId,
        deviceName: actor.deviceName,
        operationId: op.operationId,
        createdAt: ts as unknown as Expense['createdAt'],
      });
      cashTransactions.unshift({
        id: `local_cash_${op.operationId}`,
        type: 'out',
        category: 'مصروفات',
        amount,
        balanceAfter: counters.cashBalance,
        referenceId: expId,
        description: `مصروف: ${title}`,
        employeeId: actor.uid,
        employeeName: actor.name,
        deviceId: actor.deviceId,
        deviceName: actor.deviceName,
        createdAt: ts as unknown as CashTransaction['createdAt'],
      });
      continue;
    }

    if (op.type === 'voucher') {
      const voucherId = String(p.voucherId || op.operationId);
      if (vouchers.some((v) => v.id === voucherId || v.operationId === op.operationId)) {
        continue;
      }
      const type = (p.type as 'receipt' | 'payment') || 'receipt';
      const partyType = (p.partyType as 'customer' | 'supplier') || 'customer';
      const partyId = String(p.partyId || '');
      const amount = roundMoney(Math.max(0, Number(p.amount || 0)));
      let partyName = String(p.partyName || '');

      if (partyType === 'customer') {
        const cust = findCustomer(partyId);
        if (cust) {
          partyName = cust.name;
          cust.totalPaid = roundMoney(cust.totalPaid + amount);
          cust.balanceDue = roundMoney(cust.balanceDue - amount);
        }
      } else {
        const supp = findSupplier(partyId);
        if (supp) {
          partyName = supp.name;
          supp.totalPaid = roundMoney(supp.totalPaid + amount);
          supp.balanceDue = roundMoney(supp.balanceDue - amount);
        }
      }

      counters.cashBalance =
        type === 'receipt'
          ? roundMoney(counters.cashBalance + amount)
          : roundMoney(counters.cashBalance - amount);

      vouchers.unshift({
        id: voucherId,
        voucherNumber: op.localTempRef,
        type,
        partyType,
        partyId,
        partyName: partyName || 'طرف',
        amount,
        notes: typeof p.notes === 'string' && p.notes.trim() ? p.notes : undefined,
        employeeId: actor.uid,
        employeeName: actor.name,
        deviceId: actor.deviceId,
        deviceName: actor.deviceName,
        operationId: op.operationId,
        createdAt: ts as unknown as Voucher['createdAt'],
      });

      cashTransactions.unshift({
        id: `local_cash_${op.operationId}`,
        type: type === 'receipt' ? 'in' : 'out',
        category: type === 'receipt' ? 'سند قبض' : 'سند صرف',
        amount,
        balanceAfter: counters.cashBalance,
        referenceId: voucherId,
        referenceNumber: op.localTempRef,
        description: `${type === 'receipt' ? 'قبض من' : 'صرف إلى'} ${partyName} (${op.localTempRef})`,
        employeeId: actor.uid,
        employeeName: actor.name,
        deviceId: actor.deviceId,
        deviceName: actor.deviceName,
        createdAt: ts as unknown as CashTransaction['createdAt'],
      });
      continue;
    }

    if (op.type === 'cash_adjust') {
      const cashTxId = String(p.cashTxId || `local_cash_${op.operationId}`);
      if (cashTransactions.some((c) => c.id === cashTxId)) continue;
      const type = (p.type as 'in' | 'out') || 'in';
      const amount = roundMoney(Math.max(0, Number(p.amount || 0)));
      const description = String(p.description || 'حركة صندوق يدوية');

      counters.cashBalance =
        type === 'in'
          ? roundMoney(counters.cashBalance + amount)
          : roundMoney(counters.cashBalance - amount);

      cashTransactions.unshift({
        id: cashTxId,
        type,
        category: type === 'in' ? 'إيداع يدوي' : 'سحب يدوي',
        amount,
        balanceAfter: counters.cashBalance,
        description,
        employeeId: actor.uid,
        employeeName: actor.name,
        deviceId: actor.deviceId,
        deviceName: actor.deviceName,
        createdAt: ts as unknown as CashTransaction['createdAt'],
      });
    }
  }

  return {
    counters,
    products: products.sort((a, b) => a.name.localeCompare(b.name, 'ar')),
    customers: sortByCreatedDesc(customers),
    suppliers: sortByCreatedDesc(suppliers),
    sales: sortByCreatedDesc(sales),
    purchases: sortByCreatedDesc(purchases),
    returns: sortByCreatedDesc(returns),
    stockMovements: sortByCreatedDesc(stockMovements),
    expenses: sortByCreatedDesc(expenses),
    vouchers: sortByCreatedDesc(vouchers),
    cashTransactions: sortByCreatedDesc(cashTransactions),
    auditLogs: sortByCreatedDesc(auditLogs),
  };
}
