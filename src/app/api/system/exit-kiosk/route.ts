import { NextResponse } from 'next/server'
import { exec } from 'child_process'

/**
 * POST /api/system/exit-kiosk
 *
 * Stops the pulse-kiosk systemd service so the user can access the desktop.
 * Only works on the NUC (localhost). Requires sudoers rule for posuser.
 *
 * The installer adds: posuser ALL=(ALL) NOPASSWD: /usr/bin/systemctl stop pulse-kiosk
 */
export async function POST() {
  // Only allow from localhost (NUC itself)
  if (process.env.NODE_ENV === 'production') {
    // On the NUC, this runs as posuser with sudoers access
    return new Promise<Response>((resolve) => {
      exec('sudo systemctl stop pulse-kiosk', (error) => {
        if (error) {
          console.error('[exit-kiosk] Failed:', error.message)
          resolve(NextResponse.json({ error: 'Failed to exit kiosk' }, { status: 500 }))
        } else {
          resolve(NextResponse.json({ ok: true }))
        }
      })
    })
  }

  // In dev mode, just acknowledge
  return NextResponse.json({ ok: true, dev: true })
}
