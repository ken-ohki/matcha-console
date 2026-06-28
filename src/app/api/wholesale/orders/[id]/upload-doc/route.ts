import { NextResponse } from 'next/server'
import { requireAdmin, AuthError } from '@/lib/firebase/admin-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const WHOLESALE_BASE_URL = process.env.WHOLESALE_BASE_URL || 'https://wholesale.sabo-matcha.jp'

async function guard(request: Request): Promise<NextResponse | null> {
  try {
    await requireAdmin(request)
    return null
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status })
    return NextResponse.json({ error: 'internal' }, { status: 500 })
  }
}

function target(id: string, request: Request): string {
  const qs = new URL(request.url).searchParams.toString()
  return `${WHOLESALE_BASE_URL}/api/wholesale/orders/${id}/upload-doc${qs ? `?${qs}` : ''}`
}

// Staff uploads a Commercial Invoice / Packing List PDF — forward multipart to wholesale.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await guard(request)
  if (denied) return denied
  const { id } = await context.params
  const auth = request.headers.get('authorization') ?? ''
  try {
    const form = await request.formData()
    const res = await fetch(target(id, request), { method: 'POST', headers: { authorization: auth }, body: form })
    const data = await res.json().catch(() => ({}))
    return NextResponse.json(data, { status: res.status })
  } catch (err) {
    return NextResponse.json({ error: 'wholesale_unreachable', detail: err instanceof Error ? err.message : 'unknown' }, { status: 502 })
  }
}

// Staff downloads an uploaded PDF.
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await guard(request)
  if (denied) return denied
  const { id } = await context.params
  const auth = request.headers.get('authorization') ?? ''
  try {
    const res = await fetch(target(id, request), { headers: { authorization: auth } })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      return NextResponse.json(data, { status: res.status })
    }
    const buffer = await res.arrayBuffer()
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': res.headers.get('content-disposition') ?? 'inline; filename="document.pdf"',
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    return NextResponse.json({ error: 'wholesale_unreachable', detail: err instanceof Error ? err.message : 'unknown' }, { status: 502 })
  }
}

// Staff deletes an uploaded PDF.
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await guard(request)
  if (denied) return denied
  const { id } = await context.params
  const auth = request.headers.get('authorization') ?? ''
  try {
    const res = await fetch(target(id, request), { method: 'DELETE', headers: { authorization: auth } })
    const data = await res.json().catch(() => ({}))
    return NextResponse.json(data, { status: res.status })
  } catch (err) {
    return NextResponse.json({ error: 'wholesale_unreachable', detail: err instanceof Error ? err.message : 'unknown' }, { status: 502 })
  }
}
