import { NextResponse } from 'next/server'
import { triggerImmediateDownstreamSync } from '@/lib/sync/downstream-sync-worker'

export async function POST(request: Request) {
  // C16: API key validation + localhost fallback for backward compatibility
  const authHeader = request.headers.get('authorization')
  const apiKey = request.headers.get('x-api-key') || authHeader?.replace('Bearer ', '')
  const isAuthed = !!apiKey && apiKey === process.env.INTERNAL_API_SECRET
  // Localhost check: only trust when no x-forwarded-for header (direct local connection)
  const forwardedFor = request.headers.get('x-forwarded-for')
  const ip = forwardedFor?.split(',')[0]?.trim() || ''
  const isLocal = !forwardedFor || ['127.0.0.1', '::1'].includes(ip)
  if (!isAuthed && !isLocal) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
