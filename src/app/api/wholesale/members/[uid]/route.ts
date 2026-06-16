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

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

interface ActionBody {
  action?: 'approve' | 'reject' | 'suspend'
  reason?: string
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
    // Auto-create a buyers doc (販売先マスタ) and link it, if not already linked.
    let buyerId = (member.buyerId as string | undefined) ?? undefined
    if (!buyerId) {
      const companyName = String(member.companyName ?? '').trim() || String(member.email ?? '')
      const buyerRef = database.collection('buyers').doc()
      await buyerRef.set({
        name: companyName,
        billingName: companyName,
        normalizedName: normalizeName(companyName),
        country: member.country ?? null,
        email: member.email ?? null,
        phone: member.phone ?? null,
        contactPersonName: member.contactName ?? null,
        website: member.website ?? null,
        shippingAddress: member.address ?? null,
        shippingPostalCode: member.postalCode ?? null,
        notes: 'wholesale.sabo-matcha.jp 会員より自動作成',
        saleCount: 0,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      })
      buyerId = buyerRef.id
    }

    await memberRef.set(
      {
        status: 'approved',
        approvedAt: FieldValue.serverTimestamp(),
        approvedBy: staff.uid,
        buyerId,
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
          html: `<p>${member.companyName ?? ''} 様</p><p>SABO 卸売サイトのご登録が承認されました。下記よりログインしてご利用ください。<br/>Your SABO wholesale account has been approved. Please log in:</p><p><a href="https://wholesale.sabo-matcha.jp/login">https://wholesale.sabo-matcha.jp/login</a></p>`,
        },
      })
    }

    return NextResponse.json({ ok: true, status: 'approved', buyerId })
  }

  return NextResponse.json({ error: 'invalid_action' }, { status: 400 })
}
