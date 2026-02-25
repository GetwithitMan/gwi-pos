import { NextResponse } from 'next/server'
import { exec } from 'child_process'

/**
 * POST /api/system/exit-kiosk
 *
 * Exits Chromium kiosk/fullscreen mode on the NUC.
 *
 * 1. Stops the thepasspos-kiosk systemd service (auto-restart kiosk)
 * 2. Kills any Chromium processes running the POS (desktop launcher)
 *
 * The installer adds sudoers rules:
 *   posuser ALL=(ALL) NOPASSWD: /usr/bin/systemctl stop thepasspos-kiosk
 *   posuser ALL=(ALL) NOPASSWD: /usr/bin/pkill -f chromium.*localhost
 */
export async function POST() {
  if (process.env.NODE_ENV === 'production') {
    return new Promise<Response>((resolve) => {
      // Stop the kiosk service first (prevents auto-restart)
      exec('sudo systemctl stop thepasspos-kiosk 2>/dev/null; sudo pkill -f "chromium.*localhost" 2>/dev/null', (error) => {
        // Both commands may "fail" (service not running, no process to kill) — that's fine
        resolve(NextResponse.json({ data: { ok: true } }))
      })
    })
  }

  // In dev mode, just acknowledge
  return NextResponse.json({ data: { ok: true, dev: true } })
}
