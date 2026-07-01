import { NextResponse } from 'next/server'
import { requireAdmin, AuthError } from '@/lib/firebase/admin-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const WHOLESALE_BASE_URL = process.env.WHOLESALE_BASE_URL || 'https://wholesale.sabo-matcha.jp'

// Staff generates a Commercial Invoice — forward the form draft to the wholesale app
// (owns react-pdf rendering + Storage). It saves to the shared `commercial` upload slot.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status })
    return NextResponse.json({ error: 'internal' }, { status: 500 })
  }
  const { id } = await context.params
  const auth = request.headers.get('authorization') ?? ''
  try {
    const body = await request.text()
    const res = await fetch(`${WHOLESALE_BASE_URL}/api/wholesale/orders/${id}/commercial-invoice`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: auth },
      body,
    })
    const data = await res.json().catch(() => ({}))
    return NextResponse.json(data, { status: res.status })
  } catch (err) {
    return NextResponse.json({ error: 'wholesale_unreachable', detail: err instanceof Error ? err.message : 'unknown' }, { status: 502 })
  }
}
