import type {
  EcSaleRecord,
  PurchaseInvoice,
  PurchaseInvoicePaymentStatus,
  PurchaseOrder,
  PurchaseOrderBillingStatus,
  PurchaseOrderLineItem,
  PurchaseOrderPaymentStatus,
  SaleRecord,
  TaxRate,
} from '@/types'
import { computeSaleTaxBuckets, computeTax, computeTaxBuckets, saleFeesToTaxLines } from '@/lib/tax'

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
  // Trust the stored 税込 total when present (wholesale orders carry the exact
  // amount charged / on the invoice) — this avoids rounding drift and country-string
  // tax re-derivation. Falls back to computing tax for legacy direct sales.
  if (sale.taxIncludedTotal != null && sale.taxIncludedTotal > 0) return sale.taxIncludedTotal
  // invoiceAmount already includes fee items (税抜); add tax computed over items +
  // fee items (each with its own rate) + shipping (10%).
  const base = sale.invoiceAmount > 0 ? sale.invoiceAmount : sale.revenue
  const lines = [...(sale.items ?? []), ...saleFeesToTaxLines(sale.fees)]
  return base + computeSaleTaxBuckets(lines, sale.shippingFee ?? 0).tax
}

export function computePoTaxIncluded(po: PurchaseOrder): number {
  // Stored totalAmount is items-only (税抜); fees are kept in separate fields,
  // so the cash total is items + fees + tax-on-both.
  const fees = (po.shippingFee ?? 0) + (po.otherFees ?? 0)
  return (po.totalAmount ?? 0) + fees + computeTax(po.items ?? [], fees)
}

/**
 * Is this payment row confirmed (actual cash), as opposed to a scheduled-but-unpaid
 * installment? Legacy rows have no `paid` flag and are treated as confirmed.
 * Scheduled deposit/balance installments set `paid:false` until confirmed.
 */
export function isPaymentConfirmed(p: { paid?: boolean }): boolean {
  return p.paid !== false
}

/** Sum of CONFIRMED split payments (税込 cash actually paid; excludes scheduled installments). */
export function poPaidTotal(po: { payments?: { amount: number; paid?: boolean }[] }): number {
  return (po.payments ?? []).reduce((s, p) => s + (isPaymentConfirmed(p) ? Number(p.amount) || 0 : 0), 0)
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

// ===== Invoice-driven AP helpers =====

/** 税抜 subtotal of a PO line (stored lineTotal, else qty×price). */
export function poLineSubtotal(l: PurchaseOrderLineItem): number {
  return l.lineTotal != null ? Number(l.lineTotal) : (Number(l.quantityKg) || 0) * (Number(l.unitPrice) || 0)
}

/** 税抜 amount on a PO line still awaiting an invoice (never negative). */
export function poLineBillableRemaining(l: PurchaseOrderLineItem): number {
  return Math.max(0, poLineSubtotal(l) - (Number(l.billedAmount) || 0))
}

/**
 * Tax-inclusive UNBILLED remainder of a PO, grossed up per rate bucket (floor once
 * per bucket, mirroring computeTaxBuckets / tax.ts). New-flow header fees (送料/諸費用)
 * are NOT forecast here — they re-enter as adhoc invoice lines when the bill arrives.
 * Returns 0 once billingComplete. Used only for new-flow (non-legacy) POs.
 */
export function poUnbilledTaxIncl(po: PurchaseOrder): number {
  if (po.billingComplete) return 0
  let exempt = 0
  let reduced = 0
  let standard = 0
  for (const l of po.items ?? []) {
    const rem = poLineBillableRemaining(l)
    if (rem <= 0) continue
    const r = l.taxRate == null ? 8 : Number(l.taxRate)
    if (r === 0) exempt += rem
    else if (r === 8) reduced += rem
    else standard += rem
  }
  return exempt + reduced + standard + Math.floor(reduced * 0.08) + Math.floor(standard * 0.1)
}

/** Recompute an invoice's 税抜/税/税込 from its lines (per-bucket floor). */
export function computeInvoiceTotals(
  lines: { quantity: number; unitPrice: number; taxRate: TaxRate }[],
): { subtotal: number; tax: number; total: number } {
  const b = computeTaxBuckets(
    lines.map(l => ({ quantityKg: Number(l.quantity) || 0, unitPrice: Number(l.unitPrice) || 0, taxRate: l.taxRate })),
    0,
  )
  return { subtotal: b.subtotal, tax: b.tax, total: b.total }
}

/** Sum of recorded invoice payments (税込 cash actually paid).
 *  INVARIANT: invoice payments must never carry `paid:false` (the 2-stage deposit/balance
 *  schedule is a PO-only concept), so poPaidTotal's confirmed-only filter is a no-op here. */
export function invoicePaidTotal(inv: { payments?: { amount: number }[] }): number {
  return poPaidTotal(inv)
}

/** Outstanding amount on an invoice (payable − paid), never negative. */
export function invoiceRemaining(inv: PurchaseInvoice): number {
  return Math.max(0, (inv.totalAmount ?? 0) - invoicePaidTotal(inv))
}

/** Derive an invoice's payment status from its payments vs the payable total. */
export function deriveInvoicePaymentStatus(inv: {
  totalAmount: number
  payments?: { amount: number }[]
}): PurchaseInvoicePaymentStatus {
  const paid = invoicePaidTotal(inv)
  if (paid <= 0) return 'unpaid'
  if (paid >= (inv.totalAmount ?? 0)) return 'paid'
  return 'partial'
}

/** Derive a PO's billing status from its line ledger. */
export function derivePoBillingStatus(po: PurchaseOrder): PurchaseOrderBillingStatus {
  if (po.billingComplete) return 'billed'
  const items = po.items ?? []
  const anyBilled = items.some(l => (Number(l.billedAmount) || 0) > 0)
  const anyRemaining = items.some(l => poLineBillableRemaining(l) > 0.5)
  if (!anyBilled) return 'unbilled'
  return anyRemaining ? 'partial' : 'billed'
}

/** True when the PO carries a 前受金＋残額 (deposit/balance) installment schedule. */
export function hasInstallmentSchedule(payments?: { kind?: 'deposit' | 'balance' }[]): boolean {
  return (payments ?? []).some(p => p.kind === 'deposit' || p.kind === 'balance')
}

/**
 * Single coexistence predicate: is this PO paid DIRECTLY on the PO (前受金＋残額 の
 * 分割払い、または旧来の単一/自由分割) rather than via received invoices?
 * A 前受金＋残額 schedule means the PO is the payable (PO-direct), regardless of the
 * flowVersion stamp — it wins first. Otherwise the explicit flowVersion stamp decides;
 * absent stamp (pre-cutover docs) falls back to "any legacy payment marker is present".
 * Used identically by the forecast, the payables page, the financials overdue surface,
 * the unbilled worklist, and the PO detail screen.
 */
export function isLegacyPayablePo(po: PurchaseOrder): boolean {
  if (hasInstallmentSchedule(po.payments)) return true
  if (po.flowVersion === 'invoice') return false
  if (po.flowVersion === 'legacy') return true
  return (po.payments?.length ?? 0) > 0
    || !!po.paidDate
    || po.paymentStatus !== 'uninvoiced'
    || !!po.paymentDueDate
    || !!po.invoice?.url
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
  purchaseInvoices?: PurchaseInvoice[]  // invoice-driven AP payables
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
  const { sales, ecSales, purchaseOrders, purchaseInvoices = [], startMonth, endMonth, openingBalance, mode } = opts

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

  // Any PO referenced by a received invoice flows through the invoice loop ONLY —
  // never also as a legacy payable (guards against pre-cutover / manual-edit states
  // where a PO carries a legacy marker yet was billed via an invoice).
  const invoicedPoIds = new Set(purchaseInvoices.flatMap(inv => inv.linkedPoIds ?? []))

  for (const po of purchaseOrders) {
    if (po.status === 'cancelled') continue
    // A 前受金＋残額 schedule makes the PO a PO-direct payable; route it through the
    // legacy branch even if it happens to be referenced by an invoice (defensive).
    const isSchedule = hasInstallmentSchedule(po.payments)
    if (isLegacyPayablePo(po) && (isSchedule || !invoicedPoIds.has(po.id))) {
      // PO-direct flow: the PO itself is the payable (前受金/残額 or legacy payments).
      const amount = computePoTaxIncluded(po)
      if (amount <= 0) continue
      const payments = po.payments ?? []
      if (payments.length > 0) {
        // Confirmed payments are actual cash on their paidDate. Scheduled-but-unpaid
        // installments (前受金/残額, paid:false) are expected on their OWN dueDate.
        for (const p of payments) {
          if (!(p.amount > 0)) continue
          if (!isPaymentConfirmed(p)) {
            const due = p.dueDate || po.paymentDueDate
            if (due) ensure(monthKey(due)).outExpected += p.amount
          } else if (p.paidDate) {
            ensure(monthKey(p.paidDate)).outActual += p.amount
          }
        }
        // Legacy rows have no scheduled installment → forecast the unpaid remainder on
        // the PO-level due date (unchanged behaviour). Skip when a schedule is present:
        // per-installment dueDates above already cover the outstanding amount.
        const hasScheduled = payments.some(p => p.paid === false)
        if (!hasScheduled) {
          const remaining = Math.max(0, amount - poPaidTotal(po))
          if (remaining > 0 && po.paymentDueDate) {
            ensure(monthKey(po.paymentDueDate)).outExpected += remaining
          }
        }
      } else if (po.paymentStatus === 'paid' && po.paidDate) {
        ensure(monthKey(po.paidDate)).outActual += amount
      } else if (po.paymentDueDate) {
        ensure(monthKey(po.paymentDueDate)).outExpected += amount
      }
      continue
    }
    // NEW (invoice-driven) flow: forecast only the still-unbilled remainder.
    // Billed portions move into the invoice loop below — no double count.
    const unbilled = poUnbilledTaxIncl(po)
    if (unbilled <= 0) continue
    const dueMonth = po.paymentDueDate || po.expectedDeliveryDate || po.orderDate
    if (dueMonth) ensure(monthKey(dueMonth)).outExpected += unbilled
  }

  for (const inv of purchaseInvoices) {
    const amount = inv.totalAmount ?? 0
    if (amount <= 0) continue
    for (const p of inv.payments ?? []) {
      if (p.paidDate && p.amount > 0) ensure(monthKey(p.paidDate)).outActual += p.amount
    }
    const remaining = Math.max(0, amount - invoicePaidTotal(inv))
    if (remaining > 0 && inv.paymentDueDate) ensure(monthKey(inv.paymentDueDate)).outExpected += remaining
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
