import { NextResponse } from 'next/server'
import { getFirestore } from 'firebase-admin/firestore'
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

const WHOLESALE_BASE_URL = process.env.WHOLESALE_BASE_URL || 'https://wholesale.sabo-matcha.jp'

// Quick-create a manual member — delegate to the wholesale app (owns the model).
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
    const res = await fetch(`${WHOLESALE_BASE_URL}/api/wholesale/admin/members`, {
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

export async function GET(request: Request) {
  try {
    // 閲覧は任意の認証ユーザー（viewer/finance も会員情報を閲覧可）。更新は POST=admin 限定。
    await requireUser(request)
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
