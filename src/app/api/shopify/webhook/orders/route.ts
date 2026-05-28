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

  // CANCELLATION / DELETION / REFUND: keep the records as history but mark them
  // cancelled so they no longer deduct from inventory.
  if (topic === 'orders/cancelled' || topic === 'orders/delete' || topic.startsWith('refunds/')) {
    const existing = await db.collection('ec_sales').where('shopifyOrderId', '==', shopifyOrderId).get()
    const nowIso = new Date().toISOString().slice(0, 10)
    const batch = db.batch()
    let marked = 0
    existing.docs.forEach(doc => {
      if (doc.data().status === 'cancelled') return
      batch.update(doc.ref, {
        status: 'cancelled',
        cancelledAt: nowIso,
        notes: topic === 'orders/delete' ? 'Shopifyで注文削除' : 'Shopifyでキャンセル',
        updatedAt: FieldValue.serverTimestamp(),
      })
      marked++
    })
    if (marked > 0) await batch.commit()
    return NextResponse.json({ ok: true, action: topic, cancelled: marked })
  }

  // CREATION / UPDATE / EDIT: re-sync the order's ec_sales from current line items.
  // We delete the existing records for this order and recreate them, so edits
  // (quantity changes, added/removed items) are always reflected.
  const SYNC_TOPICS = ['orders/create', 'orders/updated', 'orders/edited', 'orders/paid', 'orders/fulfilled']
  if (!SYNC_TOPICS.includes(topic)) {
    return NextResponse.json({ ok: true, note: `ignored topic ${topic}` })
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

  // Compute desired records from current line items
  const desired = []
  const skipped: string[] = []
  for (const item of order.line_items ?? []) {
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
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }
    if (hasPrice) {
      record.unitPrice = unitPrice
      record.revenue = quantityKg * (unitPrice as number)
    }
    desired.push(record)
  }

  // Re-sync: delete only the ACTIVE records for this order (preserve cancelled
  // history), then recreate the active set from the current line items.
  const existing = await db.collection('ec_sales').where('shopifyOrderId', '==', shopifyOrderId).get()
  const batch = db.batch()
  let removed = 0
  existing.docs.forEach(doc => {
    if (doc.data().status === 'cancelled') return
    batch.delete(doc.ref)
    removed++
  })
  for (const record of desired) {
    batch.set(db.collection('ec_sales').doc(), record)
  }
  await batch.commit()

  return NextResponse.json({
    ok: true,
    action: topic === 'orders/create' ? 'created' : 'resynced',
    items: desired.length,
    removed: existing.size,
    skipped,
    order: orderName,
  })
}
