import { NextResponse } from 'next/server'
import { triggerImmediateDownstreamSync } from '@/lib/sync/downstream-sync-worker'

export async function POST(request: Request) {
  // Only allow from localhost (sync-agent runs on the same machine)
  const forwarded = request.headers.get('x-forwarded-for')
  const ip = forwarded?.split(',')[0]?.trim()
  if (ip && ip !== '127.0.0.1' && ip !== '::1' && ip !== 'localhost') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const body = await request.json().catch(() => ({}))
    const domain = (body as Record<string, unknown>)?.domain as string | undefined

    await triggerImmediateDownstreamSync(domain)

    return NextResponse.json({ success: true, domain })
  } catch {
    return NextResponse.json({ error: 'Sync trigger failed' }, { status: 500 })
  }
}
