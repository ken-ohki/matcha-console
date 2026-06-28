import { NextResponse } from 'next/server'
import { requireAdmin, AuthError } from '@/lib/firebase/admin-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const WHOLESALE_BASE_URL = process.env.WHOLESALE_BASE_URL || 'https://wholesale.sabo-matcha.jp'

// Staff issues a Proforma Invoice — forward to the wholesale app (owns the PDF).
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(request)
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status })
    return NextResponse.json({ error: 'internal' }, { status: 500 })
  }
  const { id } = await context.params
  const auth = request.headers.get('authorization') ?? ''
  const qs = new URL(request.url).searchParams.toString()
  try {
    const res = await fetch(`${WHOLESALE_BASE_URL}/api/wholesale/orders/${id}/proforma-invoice${qs ? `?${qs}` : ''}`, {
      headers: { authorization: auth },
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      return NextResponse.json(data, { status: res.status })
    }
    const buffer = await res.arrayBuffer()
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': res.headers.get('content-disposition') ?? 'inline; filename="proforma-invoice.pdf"',
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    return NextResponse.json({ error: 'wholesale_unreachable', detail: err instanceof Error ? err.message : 'unknown' }, { status: 502 })
  }
}
