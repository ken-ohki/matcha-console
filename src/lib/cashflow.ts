import type {
  EcSaleRecord,
  PurchaseOrder,
  SaleRecord,
} from '@/types'

export type CashFlowMode = 'actual' | 'plan'

function monthKey(iso: string): string {
  return iso.slice(0, 7)
}

function isJpSale(sale: SaleRecord): boolean {
  const c = (sale.country ?? '').trim()
  return c === '' || c === '日本' || c.toLowerCase() === 'japan' || c.toLowerCase() === 'jp'
}

function lineTax(qtyKg: number, unitPrice: number, taxRate: number): number {
  const subtotal = qtyKg * unitPrice
  const rate = taxRate === 8 ? 0.08 : 0.10
  return Math.floor(subtotal * rate)
}

export function computeSaleTaxIncluded(sale: SaleRecord): number {
  const base = sale.invoiceAmount > 0 ? sale.invoiceAmount : sale.revenue
  if (!isJpSale(sale)) return base
  let tax = 0
  for (const item of sale.items ?? []) {
    tax += lineTax(item.quantityKg, item.unitPrice, item.taxRate ?? 8)
  }
  // Fees on sale are treated as 10%-rate (consistent with PO breakdown).
  const fees = (sale.shippingFee ?? 0) + (sale.otherFees ?? 0)
  tax += Math.floor(fees * 0.10)
  return base + tax
}

export function computePoTaxIncluded(po: PurchaseOrder): number {
  let tax = 0
  for (const item of po.items ?? []) {
    tax += lineTax(item.quantityKg, item.unitPrice, item.taxRate ?? 8)
  }
  const fees = (po.shippingFee ?? 0) + (po.otherFees ?? 0)
  tax += Math.floor(fees * 0.10)
  return (po.totalAmount ?? 0) + tax
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
    if (po.paymentStatus === 'paid' && po.paidDate) {
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
