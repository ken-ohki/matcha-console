import { NextResponse } from 'next/server'
import { FieldValue, Timestamp, getFirestore, type Firestore } from 'firebase-admin/firestore'
import { getAdminApp } from '@/lib/firebase/admin'
import { requireAdmin, AuthError } from '@/lib/firebase/admin-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function db(): Firestore {
  const databaseId = process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID || 'chaflow'
  return getFirestore(getAdminApp(), databaseId)
}

function handleAuthError(err: unknown) {
  if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status })
  return NextResponse.json({ error: 'internal', detail: err instanceof Error ? err.message : 'unknown' }, { status: 500 })
}

export async function GET(request: Request) {
  try {
    await requireAdmin(request)
  } catch (err) {
    return handleAuthError(err)
  }
  const url = new URL(request.url)
  const status = url.searchParams.get('status')

  const snap = await db().collection('wholesale_orders').get()
  const orders = snap.docs
    .map(d => {
      const data = d.data() as Record<string, unknown>
      const { createdAt: _c, updatedAt: _u, paidAt, cancelledAt: _x, ...rest } = data
      const paidAtMs = paidAt && typeof (paidAt as { toMillis?: () => number }).toMillis === 'function'
        ? (paidAt as { toMillis: () => number }).toMillis()
        : undefined
      return { ...rest, id: d.id, createdAtMs: typeof data.createdAtMs === 'number' ? data.createdAtMs : 0, paidAtMs } as Record<string, unknown> & { id: string; createdAtMs: number }
    })
    .filter(o => (status ? o.status === status : true))
    .sort((a, b) => (b.createdAtMs as number) - (a.createdAtMs as number))

  return NextResponse.json({ orders }, { headers: { 'Cache-Control': 'no-store' } })
}


/** Release an order's stock reservation by cancelling its linked ec_sales docs. */
async function cancelOrder(database: Firestore, orderId: string): Promise<void> {
  const orderRef = database.collection('wholesale_orders').doc(orderId)
  await database.runTransaction(async txn => {
    const snap = await txn.get(orderRef)
    if (!snap.exists) return
    const data = snap.data() as { status?: string; ecSaleIds?: string[] }
    if (data.status === 'cancelled') return
    for (const ecId of data.ecSaleIds ?? []) {
      txn.update(database.collection('ec_sales').doc(ecId), {
        status: 'cancelled',
        cancelledAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
    }
    txn.update(orderRef, { status: 'cancelled', cancelledAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
  })
}

/** Mark an order paid and firm any 'reserved' stock holds (overseas quoted bank). */
async function confirmOrderPaid(database: Firestore, orderId: string): Promise<void> {
  const orderRef = database.collection('wholesale_orders').doc(orderId)
  await database.runTransaction(async txn => {
    const snap = await txn.get(orderRef)
    if (!snap.exists) return
    const data = snap.data() as { ecSaleIds?: string[] }
    const ecRefs = (data.ecSaleIds ?? []).map(id => database.collection('ec_sales').doc(id))
    const ecSnaps = await Promise.all(ecRefs.map(r => txn.get(r)))
    ecSnaps.forEach((ecSnap, i) => {
      if (ecSnap.exists && (ecSnap.data() as { status?: string }).status === 'reserved') {
        txn.update(ecRefs[i], { status: 'active', expiresAtMs: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() })
      }
    })
    txn.update(orderRef, { status: 'paid', paymentStatus: 'paid', paidAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
  })
}

interface PatchBody {
  orderId?: string
  action?: 'confirm_payment' | 'unconfirm_payment' | 'cancel' | 'mark_shipped' | 'quote' | 'notify_shipped' | 'set_billing' | 'set_fulfillment' | 'update_direct_order'
  shippingFeeJpy?: number
  overseasCarrier?: 'ems' | 'dhl' | 'designated'
  trackingNumber?: string
  shippingCarrierLabel?: string
  shipped?: boolean // set_fulfillment: explicitly set/unset shipped status
  // set_billing fields (入金管理 inline edits)
  paymentStatus?: 'paid' | 'invoiced' | 'uninvoiced' | 'unpaid'
  paymentDate?: string // YYYY-MM-DD
  dueDate?: string // YYYY-MM-DD
  paymentMethod?: string
  // update_direct_order fields (直販 content edit)
  items?: { productId: string; quantityKg: number; unitPriceJpy: number; taxRate?: number }[]
  shippingCountry?: string
  shippingAddress?: string
  shippingPostalCode?: string
  contactName?: string
  phone?: string
  notes?: string
  paymentFeeJpy?: number
}

// Tax: 0=exempt, 8=reduced(matcha), 10=standard. Fees always 10%. Floor per bucket.
function recomputeTax(lines: { revenue: number; taxRate: number }[], feesTotal: number) {
  let exempt = 0, reduced = 0, standard = feesTotal
  for (const l of lines) {
    if (l.taxRate === 0) exempt += l.revenue
    else if (l.taxRate === 8) reduced += l.revenue
    else standard += l.revenue
  }
  const reducedTax = Math.floor(reduced * 0.08)
  const standardTax = Math.floor(standard * 0.1)
  const taxBreakdown: { rate: number; taxableJpy: number; taxJpy: number }[] = []
  if (exempt) taxBreakdown.push({ rate: 0, taxableJpy: exempt, taxJpy: 0 })
  if (reduced) taxBreakdown.push({ rate: 8, taxableJpy: reduced, taxJpy: reducedTax })
  if (standard) taxBreakdown.push({ rate: 10, taxableJpy: standard, taxJpy: standardTax })
  return { taxBreakdown, taxJpy: reducedTax + standardTax }
}

// Base URL of the wholesale storefront app (owns Stripe + order/stock logic).
const WHOLESALE_BASE_URL = process.env.WHOLESALE_BASE_URL || 'https://wholesale.sabo-matcha.jp'

// Direct order entry — delegate to the wholesale app (it owns placeOrder + stock).
export async function POST(request: Request) {
  try {
    await requireAdmin(request)
  } catch (err) {
    return handleAuthError(err)
  }
  const auth = request.headers.get('authorization') ?? ''
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }
  try {
    const res = await fetch(`${WHOLESALE_BASE_URL}/api/wholesale/admin/orders`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: auth },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    return NextResponse.json(data, { status: res.status })
  } catch (err) {
    return NextResponse.json({ error: 'wholesale_unreachable', detail: err instanceof Error ? err.message : 'unknown' }, { status: 502 })
  }
}

export async function PATCH(request: Request) {
  try {
    await requireAdmin(request)
  } catch (err) {
    return handleAuthError(err)
  }
  let body: PatchBody
  try {
    body = (await request.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }
  if (!body.orderId) return NextResponse.json({ error: 'missing_order_id' }, { status: 400 })

  // Overseas quote: delegate to the wholesale app (it owns Stripe + stock holds).
  // Forward the staff token; the wholesale endpoint re-verifies it.
  if (body.action === 'quote') {
    const auth = request.headers.get('authorization') ?? ''
    try {
      const res = await fetch(`${WHOLESALE_BASE_URL}/api/wholesale/admin/quote`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: auth },
        body: JSON.stringify({
          orderId: body.orderId,
          shippingFeeJpy: body.shippingFeeJpy,
          overseasCarrier: body.overseasCarrier,
        }),
      })
      const data = await res.json().catch(() => ({}))
      return NextResponse.json(data, { status: res.status })
    } catch (err) {
      return NextResponse.json(
        { error: 'wholesale_unreachable', detail: err instanceof Error ? err.message : 'unknown' },
        { status: 502 },
      )
    }
  }

  const database = db()
  const ref = database.collection('wholesale_orders').doc(body.orderId)

  if (body.action === 'confirm_payment') {
    await confirmOrderPaid(database, body.orderId)
    return NextResponse.json({ ok: true, status: 'paid' })
  }
  if (body.action === 'unconfirm_payment') {
    const snap = await ref.get()
    const cur = snap.data() as { status?: string } | undefined
    await ref.set(
      {
        paymentStatus: 'unpaid',
        paidAt: FieldValue.delete(),
        ...(cur?.status === 'paid' ? { status: 'pending_payment' } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
    return NextResponse.json({ ok: true })
  }
  // Inline billing edits from 入金管理 (due date / paid state / method).
  if (body.action === 'set_billing') {
    const snap = await ref.get()
    const cur = snap.data() as { status?: string } | undefined
    const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() }
    if (body.dueDate !== undefined) patch.dueDate = body.dueDate || FieldValue.delete()
    if (body.paymentMethod !== undefined) patch.paymentMethod = body.paymentMethod || FieldValue.delete()
    if (body.paymentStatus !== undefined) {
      const paid = body.paymentStatus === 'paid'
      patch.paymentStatus = paid ? 'paid' : 'unpaid'
      if (paid) {
        const ms = body.paymentDate ? Date.parse(body.paymentDate) : NaN
        patch.paidAt = Number.isFinite(ms) ? Timestamp.fromMillis(ms) : FieldValue.serverTimestamp()
        if (cur?.status === 'pending_payment' || cur?.status === 'quoted') patch.status = 'paid'
      } else {
        patch.paidAt = FieldValue.delete()
        if (cur?.status === 'paid') patch.status = 'pending_payment'
      }
    } else if (body.paymentDate !== undefined) {
      // Date set without an explicit status change → couple it (date present = paid).
      const ms = body.paymentDate ? Date.parse(body.paymentDate) : NaN
      if (Number.isFinite(ms)) {
        patch.paidAt = Timestamp.fromMillis(ms)
        patch.paymentStatus = 'paid'
        if (cur?.status === 'pending_payment' || cur?.status === 'quoted') patch.status = 'paid'
      } else {
        patch.paidAt = FieldValue.delete()
        patch.paymentStatus = 'unpaid'
        if (cur?.status === 'paid') patch.status = 'pending_payment'
      }
    }
    await ref.set(patch, { merge: true })
    return NextResponse.json({ ok: true })
  }
  // Edit tracking / shipping status on an already-shipped (or paid) order.
  if (body.action === 'set_fulfillment') {
    const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() }
    if (body.trackingNumber !== undefined) patch.trackingNumber = body.trackingNumber.trim() || FieldValue.delete()
    if (body.shippingCarrierLabel !== undefined) patch.shippingCarrierLabel = body.shippingCarrierLabel.trim() || FieldValue.delete()
    if (body.shipped === true) { patch.status = 'shipped'; patch.shippedAt = new Date().toISOString() }
    if (body.shipped === false) { patch.status = 'paid'; patch.shippedAt = FieldValue.delete() }
    await ref.set(patch, { merge: true })
    return NextResponse.json({ ok: true })
  }
  if (body.action === 'mark_shipped') {
    const now = new Date().toISOString()
    await ref.set(
      {
        status: 'shipped',
        shippedAt: now,
        ...(body.trackingNumber?.trim() ? { trackingNumber: body.trackingNumber.trim() } : {}),
        ...(body.shippingCarrierLabel?.trim() ? { shippingCarrierLabel: body.shippingCarrierLabel.trim() } : {}),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
    return NextResponse.json({ ok: true, status: 'shipped' })
  }
  // Send the shipment notification email — delegate to the wholesale app (Resend).
  if (body.action === 'notify_shipped') {
    const auth = request.headers.get('authorization') ?? ''
    try {
      const res = await fetch(`${WHOLESALE_BASE_URL}/api/wholesale/admin/orders/notify-shipped`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: auth },
        body: JSON.stringify({ orderId: body.orderId }),
      })
      const data = await res.json().catch(() => ({}))
      return NextResponse.json(data, { status: res.status })
    } catch (err) {
      return NextResponse.json({ error: 'wholesale_unreachable', detail: err instanceof Error ? err.message : 'unknown' }, { status: 502 })
    }
  }
  // Edit a 直販 (staff-entered / migrated) order's content: items, shipping, fees,
  // notes. Recomputes totals/tax/cost and rebuilds the ec_sales stock reservation.
  if (body.action === 'update_direct_order') {
    const snap = await ref.get()
    const cur = snap.data() as Record<string, unknown> | undefined
    if (!cur) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    if (cur.origin !== 'direct') return NextResponse.json({ error: 'ec_order_not_editable' }, { status: 400 })
    if (!Array.isArray(body.items) || body.items.length === 0) return NextResponse.json({ error: 'no_items' }, { status: 400 })

    const prodSnap = await database.collection('products').get()
    const products = new Map(prodSnap.docs.map(d => [d.id, d.data() as Record<string, unknown>]))

    const items = body.items.map(it => {
      const p = products.get(it.productId)
      const qty = Number(it.quantityKg) || 0
      const unit = Number(it.unitPriceJpy) || 0
      const taxRate = it.taxRate === 0 || it.taxRate === 10 ? it.taxRate : 8
      return {
        kind: 'wholesale' as const,
        productId: it.productId,
        productSku: String(p?.sku ?? ''),
        productName: String(p?.name ?? ''),
        quantityKg: qty,
        unitPriceJpy: unit,
        lineTotalJpy: qty * unit,
        _taxRate: taxRate,
        _costPerKg: Number(p?.purchaseUnitPrice ?? 0),
      }
    })
    const subtotalJpy = items.reduce((s, i) => s + i.lineTotalJpy, 0)
    const shippingFeeJpy = body.shippingFeeJpy != null ? Number(body.shippingFeeJpy) : Number(cur.shippingFeeJpy ?? 0)
    const paymentFeeJpy = body.paymentFeeJpy != null ? Number(body.paymentFeeJpy) : Number(cur.paymentFeeJpy ?? 0)
    const domestic = ['jp', 'japan', '日本'].includes(String(body.shippingCountry ?? cur.shippingCountry ?? '').trim().toLowerCase())
    const { taxBreakdown, taxJpy } = recomputeTax(items.map(i => ({ revenue: i.lineTotalJpy, taxRate: i._taxRate })), domestic ? shippingFeeJpy : 0)
    const totalJpy = subtotalJpy + shippingFeeJpy + taxJpy
    const costAmountJpy = items.reduce((s, i) => s + i._costPerKg * i.quantityKg, 0)
    const grossProfitJpy = subtotalJpy - costAmountJpy - paymentFeeJpy

    // Rebuild ec_sales reservations (delete old, create fresh) unless cancelled.
    const batch = database.batch()
    for (const ecId of (Array.isArray(cur.ecSaleIds) ? cur.ecSaleIds : []) as string[]) {
      batch.delete(database.collection('ec_sales').doc(ecId))
    }
    const ecSaleIds: string[] = []
    if (cur.status !== 'cancelled') {
      items.forEach((it, i) => {
        if (!it.productId) return
        const ecId = `${body.orderId}:e${i}`
        ecSaleIds.push(ecId)
        batch.set(database.collection('ec_sales').doc(ecId), {
          productId: it.productId, productSku: it.productSku, productName: it.productName, quantityKg: it.quantityKg,
          channel: 'Wholesale', status: 'active', wholesaleOrderId: body.orderId, orderNumber: cur.orderNumber ?? '',
          soldOn: new Date().toISOString().slice(0, 10), unitPrice: it.unitPriceJpy, revenue: it.lineTotalJpy,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true })
      })
    }
    batch.set(ref, {
      items: items.map(({ _taxRate, _costPerKg, ...rest }) => { void _taxRate; void _costPerKg; return rest }),
      subtotalJpy, taxBreakdown, taxJpy, totalJpy, displayTotal: totalJpy,
      shippingFeeJpy, paymentFeeJpy, costAmountJpy, grossProfitJpy,
      isDomestic: domestic,
      ...(body.shippingCountry !== undefined ? { shippingCountry: body.shippingCountry } : {}),
      ...(body.shippingAddress !== undefined ? { shippingAddress: body.shippingAddress || null } : {}),
      ...(body.shippingPostalCode !== undefined ? { shippingPostalCode: body.shippingPostalCode || null } : {}),
      ...(body.contactName !== undefined ? { contactName: body.contactName || null } : {}),
      ...(body.phone !== undefined ? { phone: body.phone || null } : {}),
      ...(body.notes !== undefined ? { notes: body.notes || null } : {}),
      ...(body.dueDate !== undefined ? { dueDate: body.dueDate || FieldValue.delete() } : {}),
      ecSaleIds,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    await batch.commit()
    return NextResponse.json({ ok: true })
  }
  if (body.action === 'cancel') {
    await cancelOrder(database, body.orderId)
    return NextResponse.json({ ok: true, status: 'cancelled' })
  }
  return NextResponse.json({ error: 'invalid_action' }, { status: 400 })
}
