import { NextResponse } from 'next/server'
import { FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore'
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
      const { createdAt: _c, updatedAt: _u, paidAt: _p, cancelledAt: _x, ...rest } = data
      return { ...rest, id: d.id, createdAtMs: typeof data.createdAtMs === 'number' ? data.createdAtMs : 0 } as Record<string, unknown> & { id: string; createdAtMs: number }
    })
    .filter(o => (status ? o.status === status : true))
    .sort((a, b) => (b.createdAtMs as number) - (a.createdAtMs as number))

  return NextResponse.json({ orders }, { headers: { 'Cache-Control': 'no-store' } })
}

interface PatchBody {
  orderId?: string
  action?: 'confirm_payment' | 'cancel' | 'mark_shipped'
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

  const database = db()
  const ref = database.collection('wholesale_orders').doc(body.orderId)

  if (body.action === 'confirm_payment') {
    await ref.set(
      { status: 'paid', paymentStatus: 'paid', paidAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    )
    return NextResponse.json({ ok: true, status: 'paid' })
  }
  if (body.action === 'mark_shipped') {
    await ref.set({ status: 'shipped', updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    return NextResponse.json({ ok: true, status: 'shipped' })
  }
  if (body.action === 'cancel') {
    await cancelOrder(database, body.orderId)
    return NextResponse.json({ ok: true, status: 'cancelled' })
  }
  return NextResponse.json({ error: 'invalid_action' }, { status: 400 })
}
