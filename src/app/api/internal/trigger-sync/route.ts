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
    const parsed = body as Record<string, unknown>
    const domain = parsed?.domain as string | undefined
    // Model-specific sync: sync-agent can pass specific model names for targeted sync
    const models = Array.isArray(parsed?.models) ? (parsed.models as string[]) : undefined

    await triggerImmediateDownstreamSync(domain, models)

    return NextResponse.json({ success: true, domain, models })
  } catch {
    return NextResponse.json({ error: 'Sync trigger failed' }, { status: 500 })
  }
}
