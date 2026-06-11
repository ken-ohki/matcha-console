import type {
  EcSaleRecord,
  PurchaseOrder,
  PurchaseOrderPaymentStatus,
  SaleRecord,
} from '@/types'
import { computeSaleTaxBuckets, computeTax } from '@/lib/tax'

export type CashFlowMode = 'actual' | 'plan'

function monthKey(iso: string): string {
  return iso.slice(0, 7)
}

/**
 * Tax-inclusive billed amount for a sale.
 *
 * Tax applicability is decided per line via taxRate (0 = 免税 for exports,
 * 8/10 for domestic) — NOT by country or document language — so this always
 * matches the printed invoice. Export sales should mark their lines 免税.
 */
export function computeSaleTaxIncluded(sale: SaleRecord): number {
  const base = sale.invoiceAmount > 0 ? sale.invoiceAmount : sale.revenue
  const fees = (sale.shippingFee ?? 0) + (sale.otherFees ?? 0)
  return base + computeSaleTaxBuckets(sale.items ?? [], fees).tax
}

export function computePoTaxIncluded(po: PurchaseOrder): number {
  // Stored totalAmount is items-only (税抜); fees are kept in separate fields,
  // so the cash total is items + fees + tax-on-both.
  const fees = (po.shippingFee ?? 0) + (po.otherFees ?? 0)
  return (po.totalAmount ?? 0) + fees + computeTax(po.items ?? [], fees)
}

/** Sum of recorded split payments (税込 cash actually paid). */
export function poPaidTotal(po: { payments?: { amount: number }[] }): number {
  return (po.payments ?? []).reduce((s, p) => s + (Number(p.amount) || 0), 0)
}

/** Outstanding amount on a PO (税込 total − paid), never negative. */
export function poRemaining(po: PurchaseOrder): number {
  return Math.max(0, computePoTaxIncluded(po) - poPaidTotal(po))
}

/**
 * Derive payment status from split payments when present, else fall back to the
 * stored single-payment status. uninvoiced is preserved (no invoice yet).
 */
export function derivePoPaymentStatus(
  po: PurchaseOrder,
  stored: PurchaseOrderPaymentStatus,
): PurchaseOrderPaymentStatus {
  const payments = po.payments ?? []
  if (payments.length === 0) return stored
  const paid = poPaidTotal(po)
  const total = computePoTaxIncluded(po)
  if (paid <= 0) return stored === 'uninvoiced' ? 'uninvoiced' : 'unpaid'
  if (paid >= total) return 'paid'
  return 'partial'
}

export interface MonthlyCashFlow {
  key: string                 // YYYY-MM
  inActual: number
  inExpected: number
  outActual: number
  outExpected: number
  net: number                 // (inActual+inExpected) - (outActual+outExpected) when mode='plan', else actual only
  endBalance: number
}

export interface BuildCashFlowOpts {
  sales: SaleRecord[]
  ecSales: EcSaleRecord[]
  purchaseOrders: PurchaseOrder[]
  startMonth: string          // YYYY-MM (inclusive)
  endMonth: string            // YYYY-MM (inclusive)
  openingBalance: number
  mode: CashFlowMode
}

function nextMonth(key: string): string {
  const [y, m] = key.split('-').map(Number)
  const d = new Date(y, m, 1)            // m is 1-12; new Date with m gives next month
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function buildCashFlowSeries(opts: BuildCashFlowOpts): MonthlyCashFlow[] {
  const { sales, ecSales, purchaseOrders, startMonth, endMonth, openingBalance, mode } = opts

  const buckets = new Map<string, MonthlyCashFlow>()
  const ensure = (key: string): MonthlyCashFlow => {
    let b = buckets.get(key)
    if (!b) {
      b = { key, inActual: 0, inExpected: 0, outActual: 0, outExpected: 0, net: 0, endBalance: 0 }
      buckets.set(key, b)
    }
    return b
  }

  for (const sale of sales) {
    if (sale.status === 'cancelled') continue
    const amount = computeSaleTaxIncluded(sale)
    if (amount <= 0) continue
    if (sale.paymentStatus === 'paid' && sale.paymentDate) {
      ensure(monthKey(sale.paymentDate)).inActual += amount
    } else if (sale.dueDate) {
      ensure(monthKey(sale.dueDate)).inExpected += amount
    }
  }

  for (const ec of ecSales) {
    if (ec.status === 'cancelled') continue
    const amount = ec.revenue ?? ((ec.unitPrice ?? 0) * ec.quantityKg)
    if (amount <= 0) continue
    ensure(monthKey(ec.soldOn)).inActual += amount
  }

  for (const po of purchaseOrders) {
    if (po.status === 'cancelled') continue
    const amount = computePoTaxIncluded(po)
    if (amount <= 0) continue
    const payments = po.payments ?? []
    if (payments.length > 0) {
      // Split payments: each recorded payment is actual cash on its date.
      for (const p of payments) {
        if (!p.paidDate || !(p.amount > 0)) continue
        ensure(monthKey(p.paidDate)).outActual += p.amount
      }
      // The unpaid remainder is expected on the due date.
      const remaining = Math.max(0, amount - poPaidTotal(po))
      if (remaining > 0 && po.paymentDueDate) {
        ensure(monthKey(po.paymentDueDate)).outExpected += remaining
      }
    } else if (po.paymentStatus === 'paid' && po.paidDate) {
      ensure(monthKey(po.paidDate)).outActual += amount
    } else if (po.paymentDueDate) {
      ensure(monthKey(po.paymentDueDate)).outExpected += amount
    }
  }

  // Build dense series from startMonth to endMonth.
  const series: MonthlyCashFlow[] = []
  let cursor = startMonth
  while (cursor <= endMonth) {
    const b = ensure(cursor)
    series.push(b)
    cursor = nextMonth(cursor)
    if (series.length > 240) break // safety
  }

  let running = openingBalance
  for (const b of series) {
    const inflow = b.inActual + (mode === 'plan' ? b.inExpected : 0)
    const outflow = b.outActual + (mode === 'plan' ? b.outExpected : 0)
    b.net = inflow - outflow
    running += b.net
    b.endBalance = running
  }
  return series
}

export function todayMonthKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
