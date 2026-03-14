import { NextRequest, NextResponse } from 'next/server'
import { processAllPending } from '@/lib/deduction-processor'

export const maxDuration = 60

export async function GET(request: NextRequest) {
  const cronSecret = request.headers.get('authorization')
  if (cronSecret !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await processAllPending()
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    console.error('[cron/process-deductions] fatal error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
