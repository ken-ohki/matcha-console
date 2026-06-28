import { NextResponse } from 'next/server'
import { requireAdmin, AuthError } from '@/lib/firebase/admin-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const WHOLESALE_BASE_URL = process.env.WHOLESALE_BASE_URL || 'https://wholesale.sabo-matcha.jp'

// Staff document live-preview — forward to the wholesale app (owns the PDF). No persistence.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status })
    return NextResponse.json({ error: 'internal' }, { status: 500 })
  }
  const { id } = await context.params
  const auth = request.headers.get('authorization') ?? ''
  const bodyText = await request.text()
  try {
    const res = await fetch(`${WHOLESALE_BASE_URL}/api/wholesale/orders/${id}/document-preview`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: auth },
      body: bodyText,
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      return NextResponse.json(data, { status: res.status })
    }
    const buffer = await res.arrayBuffer()
    return new NextResponse(buffer, {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="preview.pdf"', 'Cache-Control': 'no-store' },
    })
  } catch (err) {
    return NextResponse.json({ error: 'wholesale_unreachable', detail: err instanceof Error ? err.message : 'unknown' }, { status: 502 })
  }
}
