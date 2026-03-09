import { NextResponse } from 'next/server'
import { triggerImmediateDownstreamSync } from '@/lib/sync/downstream-sync-worker'

export async function POST(request: Request) {
  // C16: API key validation + localhost fallback for backward compatibility
  const apiKey = request.headers.get('x-api-key') || request.headers.get('authorization')?.replace('Bearer ', '')
  if (!apiKey || apiKey !== process.env.INTERNAL_API_SECRET) {
    // Still allow localhost for backward compatibility
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || ''
    const isLocal = ['127.0.0.1', '::1', 'localhost'].includes(ip)
    if (!isLocal) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
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
