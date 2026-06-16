import { NextResponse } from 'next/server'
import { getFirestore } from 'firebase-admin/firestore'
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

  const snap = await db().collection('wholesale_members').get()
  const members = snap.docs
    .map(d => {
      const data = d.data() as Record<string, unknown>
      const { createdAt: _c, updatedAt: _u, approvedAt: _a, ...rest } = data
      return { uid: d.id, ...rest, createdAtMs: typeof data.createdAtMs === 'number' ? data.createdAtMs : 0 } as Record<string, unknown> & { uid: string; createdAtMs: number }
    })
    .filter(m => (status ? m.status === status : true))
    .sort((a, b) => (b.createdAtMs as number) - (a.createdAtMs as number))

  return NextResponse.json({ members }, { headers: { 'Cache-Control': 'no-store' } })
}
