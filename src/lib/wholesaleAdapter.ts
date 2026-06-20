// Adapter that presents wholesale_orders to the staff accounting screens
// (financials / receivables / shipping) in the existing SaleRecord shape, so the
// direct-sales aggregation/UI keeps working unchanged after the migration.
//
// Gross-profit / fee model is identical to the old direct sales:
//   粗利 = 税抜売上(subtotal+shipping+option fees) − 原価 − 支払手数料
//   原価 = Σ purchaseUnitPrice × kg  (snapshot for migrated orders, live for new ones)
import { getFirebaseAuthInstance } from '@/lib/firebase/config'
import { defaultTaxRateForCountry } from '@/lib/tax'
import type { SaleRecord, SaleLineItem, SaleStatus, PaymentStatus, ShippingStatus } from '@/types'

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
  totalJpy?: number
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
  // Not yet a committed sale: overseas quote flow + made-to-order approval.
  // These must NOT count as confirmed revenue in financials/receivables.
  if (s === 'pending_quote' || s === 'quoted' || s === 'pending_approval') return 'negotiating'
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
    invoiceAmount: subtotal + shippingFee + optionFees,
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
