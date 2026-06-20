import { NextResponse } from 'next/server'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { getAdminApp } from '@/lib/firebase/admin'
import { requireAdmin, AuthError } from '@/lib/firebase/admin-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function db() {
  const databaseId = process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID || 'chaflow'
  return getFirestore(getAdminApp(), databaseId)
}

function handleAuthError(err: unknown) {
  if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status })
  return NextResponse.json({ error: 'internal', detail: err instanceof Error ? err.message : 'unknown' }, { status: 500 })
}

/** Escape member-supplied text before interpolating into email HTML. */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

interface ActionBody {
  action?: 'approve' | 'reject' | 'suspend' | 'set_rank'
  reason?: string
  rank?: string
}

const RANKS = ['standard', 'premium', 'exclusive']

/** Member detail + purchase history for the customer page. */
export async function GET(request: Request, context: { params: Promise<{ uid: string }> }) {
  try {
    await requireAdmin(request)
  } catch (err) {
    return handleAuthError(err)
  }

  const { uid } = await context.params
  const database = db()

  const snap = await database.collection('wholesale_members').doc(uid).get()
  if (!snap.exists) return NextResponse.json({ error: 'member_not_found' }, { status: 404 })
  const data = snap.data() as Record<string, unknown>
  const { createdAt: _c, updatedAt: _u, approvedAt: _a, ...rest } = data
  const member = {
    uid,
    ...rest,
    createdAtMs: typeof data.createdAtMs === 'number' ? data.createdAtMs : 0,
  }

  const ordersSnap = await database.collection('wholesale_orders').where('memberUid', '==', uid).get()
  const orders = ordersSnap.docs
    .map(d => {
      const o = d.data() as Record<string, unknown>
      const { createdAt: _oc, updatedAt: _ou, paidAt: _op, cancelledAt: _ox, ...orest } = o
      return { ...orest, id: d.id, createdAtMs: typeof o.createdAtMs === 'number' ? o.createdAtMs : 0 } as Record<string, unknown> & { id: string; createdAtMs: number }
    })
    .sort((a, b) => b.createdAtMs - a.createdAtMs)

  return NextResponse.json({ member, orders }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request, context: { params: Promise<{ uid: string }> }) {
  let staff
  try {
    staff = await requireAdmin(request)
  } catch (err) {
    return handleAuthError(err)
  }

  const { uid } = await context.params
  let body: ActionBody
  try {
    body = (await request.json()) as ActionBody
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }

  const database = db()
  const memberRef = database.collection('wholesale_members').doc(uid)
  const snap = await memberRef.get()
  if (!snap.exists) return NextResponse.json({ error: 'member_not_found' }, { status: 404 })
  const member = snap.data() as Record<string, unknown>

  // uid-collision guard: never approve a uid that is also a staff account.
  const staffSnap = await database.collection('users').doc(uid).get()
  if (staffSnap.exists && body.action === 'approve') {
    return NextResponse.json({ error: 'staff_account_conflict' }, { status: 409 })
  }

  if (body.action === 'set_rank') {
    const rank = String(body.rank ?? '')
    if (!RANKS.includes(rank)) return NextResponse.json({ error: 'invalid_rank' }, { status: 400 })
    await memberRef.set({ rank, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    return NextResponse.json({ ok: true, rank })
  }

  if (body.action === 'reject') {
    await memberRef.set(
      { status: 'rejected', rejectedReason: body.reason ?? null, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    )
    return NextResponse.json({ ok: true, status: 'rejected' })
  }

  if (body.action === 'suspend') {
    await memberRef.set({ status: 'suspended', updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    return NextResponse.json({ ok: true, status: 'suspended' })
  }

  if (body.action === 'approve') {
    // The legacy 販売先マスタ (buyers) has been retired; the member doc itself is
    // now the single customer record. No buyer doc is created on approval.
    await memberRef.set(
      {
        status: 'approved',
        approvedAt: FieldValue.serverTimestamp(),
        approvedBy: staff.uid,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )

    // Queue an approval email via the Trigger-Email extension (mail collection).
    if (member.email) {
      await database.collection('mail').add({
        to: member.email,
        message: {
          subject: 'SABO Wholesale — お申し込みが承認されました / Your account is approved',
          html: `<p>${escapeHtml(String(member.companyName ?? ''))} 様</p><p>SABO 卸売サイトのご登録が承認されました。下記よりログインしてご利用ください。<br/>Your SABO wholesale account has been approved. Please log in:</p><p><a href="https://wholesale.sabo-matcha.jp/login">https://wholesale.sabo-matcha.jp/login</a></p>`,
        },
      })
    }

    return NextResponse.json({ ok: true, status: 'approved' })
  }

  return NextResponse.json({ error: 'invalid_action' }, { status: 400 })
}
