import { NextRequest, NextResponse } from 'next/server'
import { exec } from 'child_process'
import { getActorFromRequest } from '@/lib/api-auth'

/**
 * POST /api/system/exit-kiosk
 *
 * Exits Chromium kiosk/fullscreen mode on the NUC.
 *
 * 1. Stops the thepasspos-kiosk systemd service (auto-restart kiosk)
 * 2. Kills any Chromium processes running the POS (desktop launcher)
 *
 * The installer creates /opt/gwi-pos/kiosk-control.sh (sudoers-allowed)
 * which stops the kiosk service and kills only our Chromium processes.
 */
export async function POST(request: NextRequest) {
  // Auth check: require INTERNAL_API_SECRET or a valid session
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.INTERNAL_API_SECRET}`) {
    const session = await getActorFromRequest(request)
    if (!session?.employeeId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }
  if (process.env.NODE_ENV === 'production') {
    return new Promise<Response>((resolve) => {
      // Use the dedicated kiosk control script (falls back to direct systemctl if script missing)
      exec('sudo /opt/gwi-pos/kiosk-control.sh 2>/dev/null || sudo systemctl stop thepasspos-kiosk 2>/dev/null', (error) => {
        resolve(NextResponse.json({ data: { ok: true } }))
      })
    })
  }

  // In dev mode, just acknowledge
  return NextResponse.json({ data: { ok: true, dev: true } })
}
