import { NextRequest, NextResponse } from 'next/server'
import { processAllPending } from '@/lib/deduction-processor'
import { verifyCronSecret } from '@/lib/cron-auth'

export const maxDuration = 60

export async function GET(request: NextRequest) {
  const cronAuthError = verifyCronSecret(request.headers.get('authorization'))
  if (cronAuthError) return cronAuthError

  try {
    const result = await processAllPending()
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error('[cron/process-deductions] fatal error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
