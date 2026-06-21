// Adapter that presents wholesale_orders to the staff accounting screens
// (financials / receivables / shipping) in the existing SaleRecord shape, so the
// direct-sales aggregation/UI keeps working unchanged after the migration.
//
// Gross-profit / fee model is identical to the old direct sales:
//   粗利 = 税抜売上(subtotal+shipping+option fees) − 原価 − 支払手数料
//   原価 = Σ purchaseUnitPrice × kg  (snapshot for migrated orders, live for new ones)
import { getFirebaseAuthInstance } from '@/lib/firebase/config'
import { defaultTaxRateForCountry } from '@/lib/tax'
import type { SaleRecord, SaleLineItem, SaleFeeItem, SaleStatus, PaymentStatus, ShippingStatus, TaxRate } from '@/types'

/** Raw wholesale order as returned by GET /api/wholesale/orders (staff). */
export interface WholesaleOrderRow {
  id: string
  orderNumber?: string
  memberUid?: string
  memberCompanyName?: string
  items?: Array<{ productId: string; productSku?: string; productName?: string; quantityKg: number; unitPriceJpy: number; lineTotalJpy: number; kind?: string }>
  subtotalJpy?: number
  shippingFeeJpy?: number
  optionFeesJpy?: number
  feeLines?: { name?: string; amountJpy?: number; taxRate?: number }[]
  totalJpy?: number
  taxJpy?: number
  status?: string // pending_quote | quoted | pending_payment | paid | shipped | cancelled
  paymentStatus?: string // unpaid | paid
  paymentMethod?: string
  shippingCountry?: string
  shippingAddress?: string
  shippingPostalCode?: string
  contactName?: string
  trackingNumber?: string
  shippingCarrierLabel?: string
  shippedAt?: string
  dueDate?: string
  origin?: string
  costAmountJpy?: number
  grossProfitJpy?: number
  paymentFeeJpy?: number
  createdAtMs?: number
  paidAtMs?: number
  notes?: string
}

export async function fetchWholesaleOrders(): Promise<WholesaleOrderRow[]> {
  const current = getFirebaseAuthInstance().currentUser
  if (!current) throw new Error('未ログイン')
  const token = await current.getIdToken()
  const res = await fetch('/api/wholesale/orders', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
  const data = (await res.json().catch(() => ({}))) as { orders?: WholesaleOrderRow[] }
  return data.orders ?? []
}

/** PATCH a wholesale order (staff). Used by 入金管理 / 発送管理 inline edits. */
export async function patchWholesaleOrder(body: Record<string, unknown>): Promise<void> {
  const current = getFirebaseAuthInstance().currentUser
  if (!current) throw new Error('未ログイン')
  const token = await current.getIdToken()
  const res = await fetch('/api/wholesale/orders', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const d = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(d.error || '更新に失敗しました')
  }
}

function mapStatus(s?: string): SaleStatus {
  if (s === 'cancelled') return 'cancelled'
  // Not yet a committed sale: overseas quote flow, made-to-order approval, and
  // direct-order quotes awaiting customer acceptance. These must NOT count as
  // confirmed revenue in financials/receivables.
  if (s === 'pending_quote' || s === 'quoted' || s === 'pending_approval' || s === 'pending_acceptance') return 'negotiating'
  return 'confirmed' // pending_payment | paid | shipped
}
function mapPaymentStatus(o: WholesaleOrderRow): PaymentStatus {
  if (o.paymentStatus === 'paid') return 'paid'
  // Honour an explicitly-set invoice state (入金管理); otherwise default by status.
  if (o.paymentStatus === 'invoiced') return 'invoiced'
  if (o.paymentStatus === 'uninvoiced') return 'uninvoiced'
  return mapStatus(o.status) === 'confirmed' ? 'invoiced' : 'uninvoiced'
}
function mapShippingStatus(s?: string): ShippingStatus {
  return s === 'shipped' ? 'shipped' : 'ordering'
}
const isoDate = (ms?: number) => (ms ? new Date(ms).toISOString().slice(0, 10) : undefined)

/** Convert one wholesale order into a SaleRecord for the accounting screens. */
export function orderToSale(o: WholesaleOrderRow, costByProduct: Record<string, number>): SaleRecord {
  // Goods tax rate follows the destination: domestic matcha = 8%, export = 免税(0%).
  const lineTaxRate = defaultTaxRateForCountry(o.shippingCountry)
  const items: SaleLineItem[] = (o.items ?? []).map(it => {
    const costPerKg = costByProduct[it.productId] ?? 0
    const quantityKg = Number(it.quantityKg) || 0
    const revenue = Number(it.lineTotalJpy) || 0
    const costAmount = costPerKg * quantityKg
    return {
      productId: it.productId,
      productSku: it.productSku ?? '',
      productName: it.productName ?? '',
      quantityKg,
      unitPrice: Number(it.unitPriceJpy) || 0,
      costPerKg,
      revenue,
      costAmount,
      grossProfit: revenue - costAmount,
      taxRate: lineTaxRate,
    }
  })

  const subtotal = o.subtotalJpy ?? items.reduce((a, it) => a + it.revenue, 0)
  const shippingFee = o.shippingFeeJpy ?? 0
  const optionFees = o.optionFeesJpy ?? 0
  const paymentFee = o.paymentFeeJpy ?? 0

  // Itemize 諸費用 / 小分け加工費 as tax-bearing fee lines so the detail breakdown
  // taxes them (domestic services = 10%, export = 0). The headline 税込 total is
  // taken from the order's stored totalJpy (see taxIncludedTotal below), so this is
  // only for the per-rate display. Each feeLine keeps its own rate; the remaining
  // option portion (per-item 小分け) is the standard service rate.
  const serviceRate: TaxRate = lineTaxRate === 0 ? 0 : 10
  const feeLines = o.feeLines ?? []
  const feeLinesSum = feeLines.reduce((a, f) => a + (Number(f.amountJpy) || 0), 0)
  const optionPortion = Math.max(0, optionFees - feeLinesSum)
  const fees: SaleFeeItem[] = [
    ...feeLines.map(f => ({ name: f.name || '諸費用', quantity: 1, unit: '式', unitPrice: Number(f.amountJpy) || 0, taxRate: (f.taxRate ?? serviceRate) as TaxRate })),
    ...(optionPortion > 0 ? [{ name: '小分け加工費', quantity: 1, unit: '式', unitPrice: optionPortion, taxRate: serviceRate }] : []),
  ]
  const liveCost = items.reduce((a, it) => a + it.costAmount, 0)
  const costAmount = o.costAmountJpy ?? liveCost // snapshot for migrated, live for new
  const grossProfit = o.grossProfitJpy ?? subtotal - costAmount - paymentFee
  const first = items[0]
  const createdAt = new Date(o.createdAtMs ?? Date.now())

  return {
    id: o.id,
    status: mapStatus(o.status),
    paymentStatus: mapPaymentStatus(o),
    shippingStatus: mapShippingStatus(o.status),
    buyerName: o.memberCompanyName ?? '',
    items,
    productId: first?.productId ?? '',
    productSku: first?.productSku ?? '',
    productName: first?.productName ?? '',
    quantityKg: items.reduce((a, it) => a + it.quantityKg, 0),
    unitPrice: first?.unitPrice ?? 0,
    costPerKg: first?.costPerKg ?? 0,
    revenue: subtotal,
    costAmount,
    grossProfit,
    shippingFee,
    paymentFee,
    fees: fees.length > 0 ? fees : undefined,
    invoiceAmount: subtotal + shippingFee + optionFees,
    // Authoritative 税込 total = the order's stored totalJpy (= invoice = amount charged).
    taxIncludedTotal: o.totalJpy && o.totalJpy > 0 ? o.totalJpy : undefined,
    country: o.shippingCountry ?? '',
    orderDate: isoDate(o.createdAtMs),
    dueDate: o.dueDate || undefined,
    paymentMethod: o.paymentMethod,
    paymentDate: isoDate(o.paidAtMs),
    paymentConfirmedAt: o.paidAtMs ? new Date(o.paidAtMs).toISOString() : undefined,
    shippingAddress: o.shippingAddress,
    shippingPostalCode: o.shippingPostalCode,
    shippingMethod: o.shippingCarrierLabel,
    shippingDate: o.shippedAt,
    trackingNumber: o.trackingNumber,
    notes: o.notes,
    createdAt,
    updatedAt: createdAt,
  }
}
