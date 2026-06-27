import { NextResponse } from 'next/server'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { getAdminApp } from '@/lib/firebase/admin'
import { requireAdmin, requireUser, AuthError } from '@/lib/firebase/admin-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function db() {
  const databaseId = process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_ID || 'matcha-console'
  return getFirestore(getAdminApp(), databaseId)
}

function handleAuthError(err: unknown) {
  if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status })
  return NextResponse.json({ error: 'internal', detail: err instanceof Error ? err.message : 'unknown' }, { status: 500 })
}

// Base URL of the wholesale storefront app (owns the Resend email transport).
const WHOLESALE_BASE_URL = process.env.WHOLESALE_BASE_URL || 'https://wholesale.sabo-matcha.jp'

interface ActionBody {
  action?: 'approve' | 'reject' | 'suspend' | 'set_rank' | 'update_profile' | 'set_admin_note'
  reason?: string
  rank?: string
  profile?: Record<string, string | undefined>
  note?: string
}

const RANKS = ['standard', 'premium', 'exclusive']

// Member profile fields an admin may edit from the console. (Status/rank are
// handled by their own actions; the Firebase Auth login email is separate.)
const EDITABLE_PROFILE_FIELDS = [
  'companyName', 'contactName', 'email', 'phone', 'country',
  'postalCode', 'address', 'website', 'socialMedia', 'taxId',
] as const

/** Member detail + purchase history for the customer page. */
export async function GET(request: Request, context: { params: Promise<{ uid: string }> }) {
  try {
    // 閲覧は任意の認証ユーザー（viewer/finance も会員詳細を閲覧可）。更新は POST=admin 限定。
    await requireUser(request)
  } catch (err) {
    return handleAuthError(err)
  }

  const { uid } = await context.params
  const database = db()

  const [snap, noteSnap] = await Promise.all([
    database.collection('wholesale_members').doc(uid).get(),
    // Admin memo lives in a server-only collection so it can never reach the member
    // (members can read their own wholesale_members doc directly via the client SDK).
    database.collection('member_admin_notes').doc(uid).get(),
  ])
  if (!snap.exists) return NextResponse.json({ error: 'member_not_found' }, { status: 404 })
  const data = snap.data() as Record<string, unknown>
  const { createdAt: _c, updatedAt: _u, approvedAt: _a, ...rest } = data
  const member = {
    uid,
    ...rest,
    createdAtMs: typeof data.createdAtMs === 'number' ? data.createdAtMs : 0,
    adminNote: noteSnap.exists ? String((noteSnap.data() as { note?: string }).note ?? '') : '',
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

  if (body.action === 'set_admin_note') {
    // Server-only collection — never returned to the member.
    await database.collection('member_admin_notes').doc(uid).set(
      { note: String(body.note ?? '').trim(), updatedBy: staff.uid, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    )
    return NextResponse.json({ ok: true })
  }

  if (body.action === 'update_profile') {
    const profile = body.profile ?? {}
    const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() }
    for (const k of EDITABLE_PROFILE_FIELDS) {
      if (k in profile) patch[k] = String(profile[k] ?? '').trim() || null
    }
    await memberRef.set(patch, { merge: true })
    return NextResponse.json({ ok: true })
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

    // Send the approval email via the wholesale app (it owns the Resend transport;
    // the legacy Trigger-Email `mail` collection has been retired). Best-effort.
    if (member.email) {
      try {
        await fetch(`${WHOLESALE_BASE_URL}/api/wholesale/admin/notify-member-approved`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: request.headers.get('authorization') ?? '' },
          body: JSON.stringify({ email: member.email, companyName: member.companyName ?? '' }),
        })
      } catch (err) {
        console.error('[member approve] approval email failed', err)
      }
    }

    return NextResponse.json({ ok: true, status: 'approved' })
  }

  return NextResponse.json({ error: 'invalid_action' }, { status: 400 })
}
