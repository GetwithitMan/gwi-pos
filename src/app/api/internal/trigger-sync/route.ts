import { triggerImmediateDownstreamSync } from '@/lib/sync/downstream-sync-worker'
import { err, ok, unauthorized } from '@/lib/api-response'
import { timingSafeCompare } from '@/lib/timing-safe-compare'

export async function POST(request: Request) {
  // Always require INTERNAL_API_SECRET Bearer token — no localhost bypass
  const authHeader = request.headers.get('authorization')
  const apiKey = request.headers.get('x-api-key') || authHeader?.replace('Bearer ', '')
  const isAuthed = !!apiKey && !!process.env.INTERNAL_API_SECRET && timingSafeCompare(apiKey, process.env.INTERNAL_API_SECRET)
  if (!isAuthed) {
    return unauthorized('Unauthorized')
  }

  try {
    const body = await request.json().catch(() => ({}))
    const parsed = body as Record<string, unknown>
    const domain = parsed?.domain as string | undefined
    // Model-specific sync: sync-agent can pass specific model names for targeted sync
    const models = Array.isArray(parsed?.models) ? (parsed.models as string[]) : undefined

    await triggerImmediateDownstreamSync(domain, models)

    return ok({ success: true })
  } catch {
    return err('Sync trigger failed', 500)
  }
}
