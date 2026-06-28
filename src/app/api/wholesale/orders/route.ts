import { NextResponse } from 'next/server'
import { FieldValue, Timestamp, getFirestore, type Firestore } from 'firebase-admin/firestore'
import { getAdminApp } from '@/lib/firebase/admin'
import { requireAdmin, requireUser, requireRole, AuthError, type AuthedUser } from '@/lib/firebase/admin-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function db(): Firestore {
  const databaseId = process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID || 'matcha-console'
  return getFirestore(getAdminApp(), databaseId)
}

function handleAuthError(err: unknown) {
  if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status })
  return NextResponse.json({ error: 'internal', detail: err instanceof Error ? err.message : 'unknown' }, { status: 500 })
}

export async function GET(request: Request) {
  try {
    // Read access for any authenticated console user (viewer/finance can view 入金管理 etc.).
    await requireUser(request)
  } catch (err) {
    return handleAuthError(err)
  }
  const url = new URL(request.url)
  const status = url.searchParams.get('status')

  const database = db()
  const snap = await database.collection('wholesale_orders').get()

  // Expire stale quotes: a 'pending_acceptance' order past its acceptance deadline
  // releases its stock and is cancelled. Best-effort, idempotent — runs when staff
  // view the orders list (no separate cron).
  const now = Date.now()
  const expiredIds = snap.docs
    .filter(d => {
      const x = d.data() as { status?: string; acceptanceExpiresAtMs?: number }
      return x.status === 'pending_acceptance' && typeof x.acceptanceExpiresAtMs === 'number' && x.acceptanceExpiresAtMs < now
    })
    .map(d => d.id)
  // Cancel expired quotes concurrently (each is an idempotent transaction).
  await Promise.all(expiredIds.map(oid => cancelOrder(database, oid).catch(() => {})))
  const expired = new Set(expiredIds)

  const orders = snap.docs
    .map(d => {
      const data = d.data() as Record<string, unknown>
      const { createdAt: _c, updatedAt: _u, paidAt, cancelledAt: _x, ...rest } = data
      const paidAtMs = paidAt && typeof (paidAt as { toMillis?: () => number }).toMillis === 'function'
        ? (paidAt as { toMillis: () => number }).toMillis()
        : undefined
      // Reflect the just-applied expiry cancellation in the response.
      const liveStatus = expired.has(d.id) ? 'cancelled' : data.status
      return { ...rest, status: liveStatus, id: d.id, createdAtMs: typeof data.createdAtMs === 'number' ? data.createdAtMs : 0, paidAtMs } as Record<string, unknown> & { id: string; createdAtMs: number }
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

/** Trigger an order notification email via the wholesale app (it owns Resend). Best-effort. */
async function sendOrderEmail(orderId: string, kind: 'cancelled' | 'paid', request: Request): Promise<void> {
  const auth = request.headers.get('authorization') ?? ''
  try {
    await fetch(`${WHOLESALE_BASE_URL}/api/wholesale/admin/order-email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: auth },
      body: JSON.stringify({ orderId, kind }),
    })
  } catch (err) {
    console.error('[orders] order-email failed', orderId, kind, err)
  }
}

/** Mark an order paid and firm any 'reserved' stock holds (overseas quoted bank). */
async function confirmOrderPaid(database: Firestore, orderId: string): Promise<void> {
  const orderRef = database.collection('wholesale_orders').doc(orderId)
  await database.runTransaction(async txn => {
    const snap = await txn.get(orderRef)
    if (!snap.exists) return
    const data = snap.data() as { ecSaleIds?: string[]; status?: string }
    // Never resurrect a closed order — confirming a cancelled order would re-fire
    // its (released) holds, and confirming paid/shipped is a no-op at best.
    if (data.status === 'cancelled' || data.status === 'paid' || data.status === 'shipped') return
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
  action?: 'confirm_payment' | 'unconfirm_payment' | 'cancel' | 'mark_shipped' | 'quote' | 'approve' | 'resend_payment_link' | 'fetch_fee' | 'accept_quote' | 'notify_shipped' | 'set_billing' | 'set_fulfillment' | 'set_memos' | 'set_doc_fields' | 'update_direct_order' | 'delete_order' | 'request_shipment' | 'cancel_shipment_request'
  shippingFeeJpy?: number
  overseasCarrier?: 'ems' | 'epacket' | 'dhl' | 'designated'
  trackingNumber?: string
  shippingCarrierLabel?: string
  shipped?: boolean // set_fulfillment: explicitly set/unset shipped status
  fields?: Record<string, string | number> // set_doc_fields: editable (non-calc) document fields (宛名/有効期限)
  // set_billing fields (入金管理 inline edits)
  paymentStatus?: 'paid' | 'invoiced' | 'uninvoiced' | 'unpaid'
  paymentDate?: string // YYYY-MM-DD
  dueDate?: string // YYYY-MM-DD
  paymentMethod?: string
  // update_direct_order fields (直販 content edit)
  items?: { productId: string; quantityKg: number; unitPriceJpy: number; taxRate?: number }[]
  feeLines?: { name: string; quantity?: number; unitPriceJpy?: number; taxRate?: number }[]
  shippingCountry?: string
  shippingAddress?: string
  shippingPostalCode?: string
  contactName?: string
  phone?: string
  shippingEmail?: string
  notes?: string
  paymentFeeJpy?: number
  // set_memos fields (staff-only internal memos)
  adminMemo?: string
  shippingMemo?: string
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
  let staff: AuthedUser
  try {
    staff = await requireRole(request, ['admin', 'finance'])
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

  // finance ロールは入金（経理）系アクションのみ許可。それ以外（見積/承認/発送/取消/直販編集等）は admin 限定。
  const FINANCE_ACTIONS = new Set(['confirm_payment', 'unconfirm_payment', 'set_billing'])
  if (staff.role !== 'admin' && !FINANCE_ACTIONS.has(body.action ?? '')) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

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

  // Made-to-order approval: delegate to the wholesale app (Stripe link / bank email).
  if (body.action === 'approve') {
    const auth = request.headers.get('authorization') ?? ''
    try {
      const res = await fetch(`${WHOLESALE_BASE_URL}/api/wholesale/admin/approve`, {
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

  // Backfill the Stripe fee/net for a paid card order — delegate to the wholesale app.
  if (body.action === 'fetch_fee') {
    const auth = request.headers.get('authorization') ?? ''
    try {
      const res = await fetch(`${WHOLESALE_BASE_URL}/api/wholesale/admin/orders/${encodeURIComponent(body.orderId)}/fetch-fee`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: auth },
      })
      const data = await res.json().catch(() => ({}))
      return NextResponse.json(data, { status: res.status })
    } catch (err) {
      return NextResponse.json({ error: 'wholesale_unreachable', detail: err instanceof Error ? err.message : 'unknown' }, { status: 502 })
    }
  }

  // Resend card payment link: delegate to the wholesale app (issues a fresh Stripe
  // session and emails it to the customer). For unpaid card orders stuck awaiting payment.
  if (body.action === 'resend_payment_link') {
    const auth = request.headers.get('authorization') ?? ''
    try {
      const res = await fetch(`${WHOLESALE_BASE_URL}/api/wholesale/admin/resend-payment-link`, {
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
    const cur = snap.data() as { status?: string; paymentStatus?: string } | undefined
    const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() }
    if (body.dueDate !== undefined) patch.dueDate = body.dueDate || FieldValue.delete()
    if (body.paymentMethod !== undefined) patch.paymentMethod = body.paymentMethod || FieldValue.delete()
    if (body.paymentStatus !== undefined) {
      const paid = body.paymentStatus === 'paid'
      if (paid) {
        patch.paymentStatus = 'paid'
        const ms = body.paymentDate ? Date.parse(body.paymentDate) : NaN
        patch.paidAt = Number.isFinite(ms) ? Timestamp.fromMillis(ms) : FieldValue.serverTimestamp()
        if (cur?.status === 'pending_payment' || cur?.status === 'quoted') patch.status = 'paid'
      } else {
        // Preserve the 未請求/請求済 distinction (invoiced / uninvoiced) rather than
        // collapsing to 'unpaid' — otherwise it reverts on reload.
        patch.paymentStatus = body.paymentStatus === 'invoiced' || body.paymentStatus === 'uninvoiced' ? body.paymentStatus : 'unpaid'
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
    // Notify the buyer when a manual confirmation first transitions the order to paid
    // (e.g. bank-transfer reconciliation) — the card webhook path already emails.
    if (patch.paymentStatus === 'paid' && cur?.paymentStatus !== 'paid') {
      await sendOrderEmail(body.orderId, 'paid', request)
    }
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
  // Staff-only internal memos: order memo + shipping memo (shown on 発送管理).
  if (body.action === 'set_memos') {
    const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() }
    if (body.adminMemo !== undefined) patch.adminMemo = body.adminMemo.trim() || FieldValue.delete()
    if (body.shippingMemo !== undefined) patch.shippingMemo = body.shippingMemo.trim() || FieldValue.delete()
    await ref.set(patch, { merge: true })
    return NextResponse.json({ ok: true })
  }
  // 書類の宛名/有効期限など、計算に影響しない編集可能フィールドの保存。
  if (body.action === 'set_doc_fields') {
    const STRING_KEYS = ['receiptAtena', 'receiptProviso', 'proformaValidUntil']
    const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() }
    const fields = (body.fields ?? {}) as Record<string, unknown>
    for (const k of STRING_KEYS) {
      if (fields[k] !== undefined) patch[k] = String(fields[k]).trim() || FieldValue.delete()
    }
    await ref.set(patch, { merge: true })
    return NextResponse.json({ ok: true })
  }
  // 発送指示: flag the order for shipment so it surfaces to shipping staff in 発送管理
  // even while awaiting payment (掛け取引 / 月末締め). In-app only — no email.
  if (body.action === 'request_shipment') {
    const cur = (await ref.get()).data() as { status?: string } | undefined
    if (!cur) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    if (cur.status === 'cancelled' || cur.status === 'shipped') return NextResponse.json({ error: 'not_requestable' }, { status: 400 })
    await ref.set({
      shipRequestedAt: new Date().toISOString(),
      shipRequestedBy: staff.email || staff.uid,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    return NextResponse.json({ ok: true })
  }
  if (body.action === 'cancel_shipment_request') {
    await ref.set({
      shipRequestedAt: FieldValue.delete(),
      shipRequestedBy: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    return NextResponse.json({ ok: true })
  }
  if (body.action === 'mark_shipped') {
    const cur = (await ref.get()).data() as { status?: string; shipRequestedAt?: string } | undefined
    if (!cur) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    // A paid order can ship; an unpaid order can ship only once 発送指示 (掛け取引) is set.
    // Never ship a cancelled / already-shipped order.
    if (cur.status === 'cancelled' || cur.status === 'shipped') return NextResponse.json({ error: 'not_shippable' }, { status: 400 })
    if (cur.status !== 'paid' && !cur.shipRequestedAt) return NextResponse.json({ error: 'not_paid' }, { status: 400 })
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
    // Editable: staff-entered/migrated (直販) orders, or any order awaiting approval (受注生産).
    if (cur.origin !== 'direct' && cur.status !== 'pending_approval') return NextResponse.json({ error: 'ec_order_not_editable' }, { status: 400 })
    // Never edit a settled order — recomputing would rewrite an already-paid total.
    if (cur.status === 'paid' || cur.status === 'shipped') return NextResponse.json({ error: 'order_settled_not_editable' }, { status: 400 })
    if (!Array.isArray(body.items) || body.items.length === 0) return NextResponse.json({ error: 'no_items' }, { status: 400 })

    const prodSnap = await database.collection('products').get()
    const products = new Map(prodSnap.docs.map(d => [d.id, d.data() as Record<string, unknown>]))

    // Goods tax follows the destination (matcha 8% domestic / 免税 0% export) —
    // derived server-side, not trusted from the client.
    const domestic = ['jp', 'japan', '日本'].includes(String(body.shippingCountry ?? cur.shippingCountry ?? '').trim().toLowerCase())
    const goodsTaxRate = domestic ? 8 : 0
    // Preserve any chosen repackage option from the original order (the edit form
    // does not expose options, so we must not silently drop their fees).
    const curItems = (Array.isArray(cur.items) ? cur.items : []) as Record<string, unknown>[]
    const usedOrig = new Set<number>()

    const items = body.items.map(it => {
      const p = products.get(it.productId)
      const qty = Number(it.quantityKg) || 0
      const unit = Number(it.unitPriceJpy) || 0
      const oi = curItems.findIndex((ci, j) => !usedOrig.has(j) && String(ci.productId) === it.productId)
      let option: Record<string, unknown> | undefined
      if (oi >= 0) {
        usedOrig.add(oi)
        const o = curItems[oi].option
        if (o && typeof o === 'object') option = o as Record<string, unknown>
      }
      return {
        kind: 'wholesale' as const,
        productId: it.productId,
        productSku: String(p?.sku ?? ''),
        productName: String(p?.name ?? ''),
        quantityKg: qty,
        unitPriceJpy: unit,
        lineTotalJpy: qty * unit,
        ...(option ? { option } : {}),
        _taxRate: goodsTaxRate,
        _costPerKg: Number(p?.purchaseUnitPrice ?? 0),
        _madeToOrder: p?.madeToOrder === true,
      }
    })
    const subtotalJpy = items.reduce((s, i) => s + i.lineTotalJpy, 0)
    // 小分けオプション (per-item repackage) fee = bags × price/bag, bags = round(qty ÷ portion).
    // Taxed at the standard 10% (domestic) like shipping.
    const optionFromItems = items.reduce((s, i) => {
      const o = (i as { option?: Record<string, unknown> }).option
      if (!o) return s
      const portionKg = Number(o.portionKg) || 0
      const pricePerBag = Number(o.pricePerBagJpy) || 0
      const bags = portionKg > 0 ? Math.round(i.quantityKg / portionKg) : 0
      return s + bags * pricePerBag
    }, 0)
    // Named option/misc fee lines (諸費用) — each with its own qty・単価・税率.
    const feeLines = (Array.isArray(body.feeLines) ? body.feeLines : [])
      .filter(f => String(f.name ?? '').trim())
      .map(f => {
        const quantity = Number(f.quantity) || 0
        const unitPriceJpy = Number(f.unitPriceJpy) || 0
        // Export orders are 免税 regardless of the entered rate.
        const taxRate = !domestic ? 0 : f.taxRate === 0 || f.taxRate === 10 ? f.taxRate : 8
        return { name: String(f.name).trim(), quantity, unitPriceJpy, amountJpy: Math.round(quantity * unitPriceJpy), taxRate }
      })
    const feeLinesTotal = feeLines.reduce((s, f) => s + f.amountJpy, 0)
    const optionFeesJpy = optionFromItems + feeLinesTotal
    const shippingFeeJpy = body.shippingFeeJpy != null ? Number(body.shippingFeeJpy) : Number(cur.shippingFeeJpy ?? 0)
    const paymentFeeJpy = body.paymentFeeJpy != null ? Number(body.paymentFeeJpy) : Number(cur.paymentFeeJpy ?? 0)
    // Goods + fee lines are bucketed by their own rate; shipping + 小分けオプション
    // are standard 10% (domestic) / 0 (export).
    const taxableLines = [
      ...items.map(i => ({ revenue: i.lineTotalJpy, taxRate: i._taxRate })),
      ...feeLines.map(f => ({ revenue: f.amountJpy, taxRate: f.taxRate })),
    ]
    const { taxBreakdown, taxJpy } = recomputeTax(taxableLines, domestic ? shippingFeeJpy + optionFromItems : 0)
    const totalJpy = subtotalJpy + shippingFeeJpy + optionFeesJpy + taxJpy
    const costAmountJpy = items.reduce((s, i) => s + i._costPerKg * i.quantityKg, 0)
    const grossProfitJpy = subtotalJpy - costAmountJpy - paymentFeeJpy

    // Rebuild ec_sales reservations (delete old, create fresh) unless cancelled.
    // Preserve the HOLD KIND of the order's current state so editing an unaccepted
    // quote doesn't firm its stock: pending_acceptance / quoted keep a 'reserved'
    // hold with the same expiry; pending_quote (overseas, not yet quoted) has no
    // hold; everything else is a firm 'active' reservation.
    const curStatus = String(cur.status ?? '')
    const ecStatus = curStatus === 'pending_acceptance' || curStatus === 'quoted' ? 'reserved' : 'active'
    const ecExpiresAtMs =
      curStatus === 'pending_acceptance' ? Number(cur.acceptanceExpiresAtMs) || undefined
        : curStatus === 'quoted' ? Number(cur.holdExpiresAtMs) || undefined
          : undefined
    const reserveOnEdit = curStatus !== 'cancelled' && curStatus !== 'pending_quote'
    const batch = database.batch()
    for (const ecId of (Array.isArray(cur.ecSaleIds) ? cur.ecSaleIds : []) as string[]) {
      batch.delete(database.collection('ec_sales').doc(ecId))
    }
    const ecSaleIds: string[] = []
    if (reserveOnEdit) {
      items.forEach((it, i) => {
        if (!it.productId) return
        if (it._madeToOrder) return // made-to-order lines don't reserve stock
        const ecId = `${body.orderId}:e${i}`
        ecSaleIds.push(ecId)
        batch.set(database.collection('ec_sales').doc(ecId), {
          productId: it.productId, productSku: it.productSku, productName: it.productName, quantityKg: it.quantityKg,
          channel: 'Wholesale', status: ecStatus, ...(ecExpiresAtMs ? { expiresAtMs: ecExpiresAtMs } : {}),
          wholesaleOrderId: body.orderId, orderNumber: cur.orderNumber ?? '',
          soldOn: new Date().toISOString().slice(0, 10), unitPrice: it.unitPriceJpy, revenue: it.lineTotalJpy,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true })
      })
    }
    batch.set(ref, {
      items: items.map(({ _taxRate, _costPerKg, _madeToOrder, ...rest }) => { void _taxRate; void _costPerKg; void _madeToOrder; return rest }),
      subtotalJpy, taxBreakdown, taxJpy, totalJpy, displayTotal: totalJpy,
      shippingFeeJpy, optionFeesJpy, paymentFeeJpy, costAmountJpy, grossProfitJpy,
      feeLines,
      isDomestic: domestic,
      ...(body.shippingCountry !== undefined ? { shippingCountry: body.shippingCountry } : {}),
      ...(body.shippingAddress !== undefined ? { shippingAddress: body.shippingAddress || null } : {}),
      ...(body.shippingPostalCode !== undefined ? { shippingPostalCode: body.shippingPostalCode || null } : {}),
      ...(body.contactName !== undefined ? { contactName: body.contactName || null } : {}),
      ...(body.phone !== undefined ? { phone: body.phone || null } : {}),
      ...(body.shippingEmail !== undefined ? { shippingEmail: body.shippingEmail || null } : {}),
      ...(body.notes !== undefined ? { notes: body.notes || null } : {}),
      ...(body.dueDate !== undefined ? { dueDate: body.dueDate || FieldValue.delete() } : {}),
      ecSaleIds,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true })
    await batch.commit()
    return NextResponse.json({ ok: true })
  }
  if (body.action === 'cancel') {
    const before = (await ref.get()).data() as { status?: string } | undefined
    await cancelOrder(database, body.orderId)
    // Tell the buyer their order was cancelled (only on a real transition).
    if (before && before.status !== 'cancelled') await sendOrderEmail(body.orderId, 'cancelled', request)
    return NextResponse.json({ ok: true, status: 'cancelled' })
  }
  // Permanently delete an order (test-data cleanup). Hard-deletes the order doc AND
  // its linked ec_sales reservations (releasing stock). Staff-only, irreversible —
  // the UI requires typing the order number to confirm.
  if (body.action === 'delete_order') {
    const snap = await ref.get()
    const cur = snap.data() as { ecSaleIds?: string[] } | undefined
    if (!cur) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    const batch = database.batch()
    for (const ecId of cur.ecSaleIds ?? []) batch.delete(database.collection('ec_sales').doc(ecId))
    batch.delete(ref)
    await batch.commit()
    return NextResponse.json({ ok: true, deleted: true })
  }
  // Customer accepted the quoted amount → confirm the direct order. The 14-day
  // 'reserved' stock holds are firmed to 'active' (no more expiry) and the order
  // moves to pending_payment.
  if (body.action === 'accept_quote') {
    const snap = await ref.get()
    const cur = snap.data() as { status?: string; ecSaleIds?: string[]; acceptanceExpiresAtMs?: number } | undefined
    if (!cur) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    if (cur.status !== 'pending_acceptance') return NextResponse.json({ error: 'not_pending_acceptance' }, { status: 400 })
    // Reject an expired quote — its reserved holds no longer consume stock and the
    // stock may have been resold, so firming them blindly could oversell.
    if (typeof cur.acceptanceExpiresAtMs === 'number' && cur.acceptanceExpiresAtMs < Date.now()) {
      return NextResponse.json({ error: 'quote_expired' }, { status: 409 })
    }
    const batch = database.batch()
    for (const ecId of cur.ecSaleIds ?? []) {
      batch.set(
        database.collection('ec_sales').doc(ecId),
        { status: 'active', expiresAtMs: FieldValue.delete(), updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      )
    }
    batch.set(ref, { status: 'pending_payment', acceptedAt: new Date().toISOString(), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    await batch.commit()
    return NextResponse.json({ ok: true, status: 'pending_payment' })
  }
  return NextResponse.json({ error: 'invalid_action' }, { status: 400 })
}
