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

export async function GET(request: Request) {
  try {
    await requireAdmin(request)
  } catch (err) {
    return handleAuthError(err)
  }
  const url = new URL(request.url)
  const status = url.searchParams.get('status')

  const snap = await db().collection('wholesale_inquiries').get()
  const inquiries = snap.docs
    .map(d => {
      const data = d.data() as Record<string, unknown>
      const { createdAt: _c, updatedAt: _u, ...rest } = data
      return { ...rest, id: d.id, createdAtMs: typeof data.createdAtMs === 'number' ? data.createdAtMs : 0 } as Record<string, unknown> & { id: string; createdAtMs: number }
    })
    .filter(i => (status ? i.status === status : true))
    .sort((a, b) => (b.createdAtMs as number) - (a.createdAtMs as number))

  return NextResponse.json({ inquiries }, { headers: { 'Cache-Control': 'no-store' } })
}

interface PatchBody {
  id?: string
  status?: 'open' | 'in_progress' | 'quoted' | 'closed' | 'cancelled'
  staffNote?: string
  linkedSaleId?: string
}

export async function PATCH(request: Request) {
  let staff
  try {
    staff = await requireAdmin(request)
  } catch (err) {
    return handleAuthError(err)
  }
  let body: PatchBody
  try {
    body = (await request.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }
  if (!body.id) return NextResponse.json({ error: 'missing_id' }, { status: 400 })

  const update: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp(), handledBy: staff.uid }
  if (body.status) update.status = body.status
  if (body.staffNote !== undefined) update.staffNote = body.staffNote
  if (body.linkedSaleId !== undefined) update.linkedSaleId = body.linkedSaleId

  await db().collection('wholesale_inquiries').doc(body.id).set(update, { merge: true })
  return NextResponse.json({ ok: true })
}
