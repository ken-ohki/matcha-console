import { NextResponse } from 'next/server'
import { requireAdmin, AuthError } from '@/lib/firebase/admin-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const WHOLESALE_BASE_URL = process.env.WHOLESALE_BASE_URL || 'https://wholesale.sabo-matcha.jp'

function handleAuthError(err: unknown) {
  if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status })
  return NextResponse.json({ error: 'internal' }, { status: 500 })
}

// Forward member login-info / password-reset requests to the wholesale app
// (it owns Firebase Auth for members + the email transport).
export async function GET(request: Request, context: { params: Promise<{ uid: string }> }) {
  try { await requireAdmin(request) } catch (err) { return handleAuthError(err) }
  const { uid } = await context.params
  const auth = request.headers.get('authorization') ?? ''
  try {
    const res = await fetch(`${WHOLESALE_BASE_URL}/api/wholesale/admin/member-login?uid=${encodeURIComponent(uid)}`, {
      headers: { authorization: auth },
      cache: 'no-store',
    })
    return NextResponse.json(await res.json().catch(() => ({})), { status: res.status })
  } catch (err) {
    return NextResponse.json({ error: 'wholesale_unreachable', detail: err instanceof Error ? err.message : 'unknown' }, { status: 502 })
  }
}

export async function POST(request: Request, context: { params: Promise<{ uid: string }> }) {
  try { await requireAdmin(request) } catch (err) { return handleAuthError(err) }
  const { uid } = await context.params
  const auth = request.headers.get('authorization') ?? ''
  try {
    const res = await fetch(`${WHOLESALE_BASE_URL}/api/wholesale/admin/member-login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: auth },
      body: JSON.stringify({ uid }),
    })
    return NextResponse.json(await res.json().catch(() => ({})), { status: res.status })
  } catch (err) {
    return NextResponse.json({ error: 'wholesale_unreachable', detail: err instanceof Error ? err.message : 'unknown' }, { status: 502 })
  }
}
