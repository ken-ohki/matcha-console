import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { getAdminDb } from '@/lib/firebase/admin'
import { FieldValue } from 'firebase-admin/firestore'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type AnyRecord = Record<string, unknown>

interface ShopifyLineItem {
  sku?: string
  quantity?: number
  price?: string
  title?: string
}

interface ShopifyOrder {
  id?: number
  name?: string
  created_at?: string
  cancelled_at?: string | null
  line_items?: ShopifyLineItem[]
}

function verifyHmac(rawBody: string, hmacHeader: string | null, secret: string): boolean {
  if (!hmacHeader) return false
  const digest = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64')
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmacHeader))
  } catch {
    return false
  }
}

export async function POST(request: Request) {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'webhook_not_configured' }, { status: 500 })
  }

  // Read raw body for HMAC verification
  const rawBody = await request.text()
  const hmacHeader = request.headers.get('x-shopify-hmac-sha256')
  if (!verifyHmac(rawBody, hmacHeader, secret)) {
    return NextResponse.json({ error: 'invalid_hmac' }, { status: 401 })
  }

  const topic = request.headers.get('x-shopify-topic') ?? ''
  let order: ShopifyOrder
  try {
    order = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const shopifyOrderId = order.id != null ? String(order.id) : ''
  if (!shopifyOrderId) {
    return NextResponse.json({ ok: true, note: 'no order id' })
  }

  let db
  try {
    db = getAdminDb()
  } catch (err) {
    return NextResponse.json({ error: 'server_misconfigured', detail: err instanceof Error ? err.message : 'unknown' }, { status: 500 })
  }

  // Mark all existing records for this order as cancelled (kept as history).
  const markCancelled = async (note: string) => {
    const existing = await db.collection('ec_sales').where('shopifyOrderId', '==', shopifyOrderId).get()
    const nowIso = new Date().toISOString().slice(0, 10)
    const batch = db.batch()
    let marked = 0
    existing.docs.forEach(doc => {
      if (doc.data().status === 'cancelled') return
      batch.update(doc.ref, {
        status: 'cancelled',
        cancelledAt: nowIso,
        notes: note,
        updatedAt: FieldValue.serverTimestamp(),
      })
      marked++
    })
    if (marked > 0) await batch.commit()
    return marked
  }

  // CANCELLATION / DELETION / REFUND: keep the records as history but mark them
  // cancelled so they no longer deduct from inventory.
  if (topic === 'orders/cancelled' || topic === 'orders/delete' || topic.startsWith('refunds/')) {
    const marked = await markCancelled(topic === 'orders/delete' ? 'Shopifyで注文削除' : 'Shopifyでキャンセル')
    return NextResponse.json({ ok: true, action: topic, cancelled: marked })
  }

  // CREATION / UPDATE / EDIT: re-sync the order's ec_sales from current line items.
  const SYNC_TOPICS = ['orders/create', 'orders/updated', 'orders/edited', 'orders/paid', 'orders/fulfilled']
  if (!SYNC_TOPICS.includes(topic)) {
    return NextResponse.json({ ok: true, note: `ignored topic ${topic}` })
  }

  // If this order is already cancelled in Shopify, an orders/updated may still
  // arrive — treat it as a cancellation rather than recreating active records.
  if (order.cancelled_at) {
    const marked = await markCancelled('Shopifyでキャンセル')
    return NextResponse.json({ ok: true, action: 'cancelled_via_update', cancelled: marked })
  }

  // Load all active products → SKU map
  const productsSnap = await db.collection('products').get()
  const productBySku = new Map<string, { id: string; sku: string; name: string }>()
  productsSnap.docs.forEach(doc => {
    const data = doc.data() as AnyRecord
    if (data.isActive === false) return
    const sku = String(data.sku ?? '').trim()
    if (sku) productBySku.set(sku, { id: doc.id, sku, name: String(data.name ?? '') })
  })

  const soldOn = order.created_at ? order.created_at.slice(0, 10) : new Date().toISOString().slice(0, 10)
  const orderName = order.name || `#${shopifyOrderId}`

  // Compute desired records from current line items. Each line gets a
  // DETERMINISTIC document id (`shopify-<orderId>-<lineIndex>`) so concurrent
  // webhook deliveries (orders/create + orders/paid + orders/fulfilled often
  // arrive together) converge to the same documents instead of each appending
  // a fresh random-id copy — the race that caused duplicate EC sales.
  const desired: { id: string; record: AnyRecord }[] = []
  const skipped: string[] = []
  let lineIndex = -1
  for (const item of order.line_items ?? []) {
    lineIndex++
    const sku = (item.sku ?? '').trim()
    if (!sku) continue
    const product = productBySku.get(sku)
    if (!product) {
      skipped.push(sku)
      continue
    }
    // 1kg B2B: 1 unit = 1 kg
    const quantityKg = Number(item.quantity) || 0
    if (quantityKg <= 0) continue
    const unitPrice = item.price != null ? Number(item.price) : undefined
    const hasPrice = unitPrice != null && Number.isFinite(unitPrice)
    const record: AnyRecord = {
      productId: product.id,
      productSku: product.sku,
      productName: product.name,
      quantityKg,
      soldOn,
      orderNumber: orderName,
      channel: 'Shopify',
      shopifyOrderId,
      status: 'active',
      updatedAt: FieldValue.serverTimestamp(),
    }
    if (hasPrice) {
      record.unitPrice = unitPrice
      record.revenue = quantityKg * (unitPrice as number)
    }
    desired.push({ id: `shopify-${shopifyOrderId}-${lineIndex}`, record })
  }

  // Re-sync idempotently: overwrite the desired line docs by deterministic id,
  // and delete only the ACTIVE docs for this order NOT in the desired set
  // (preserves cancelled history and lines that no longer exist).
  const desiredIds = new Set(desired.map(d => d.id))
  const existingIds = new Set<string>()
  const existing = await db.collection('ec_sales').where('shopifyOrderId', '==', shopifyOrderId).get()
  const batch = db.batch()
  let removed = 0
  existing.docs.forEach(doc => {
    existingIds.add(doc.id)
    if (doc.data().status === 'cancelled') return
    if (desiredIds.has(doc.id)) return // overwritten below
    batch.delete(doc.ref)
    removed++
  })
  for (const { id, record } of desired) {
    // Set createdAt only when the doc is new; merge preserves it otherwise.
    if (!existingIds.has(id)) record.createdAt = FieldValue.serverTimestamp()
    batch.set(db.collection('ec_sales').doc(id), record, { merge: true })
  }
  await batch.commit()

  return NextResponse.json({
    ok: true,
    action: topic === 'orders/create' ? 'created' : 'resynced',
    items: desired.length,
    removed,
    skipped,
    order: orderName,
  })
}
