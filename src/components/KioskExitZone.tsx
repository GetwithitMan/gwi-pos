'use client'

import { useRef, useCallback } from 'react'

/**
 * Hidden 5-tap zone in the top-left corner to exit Chromium kiosk/fullscreen mode.
 * Rendered in root layout so it works on every page (login, orders, admin, etc.).
 *
 * Calls POST /api/system/exit-kiosk which:
 * 1. Stops the pulse-kiosk systemd service (if running)
 * 2. Kills any Chromium processes running the POS (desktop launcher)
 */
export function KioskExitZone() {
  const tapCount = useRef(0)
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleTap = useCallback(() => {
    tapCount.current++
    if (tapTimer.current) clearTimeout(tapTimer.current)

    if (tapCount.current >= 5) {
      tapCount.current = 0
      fetch('/api/system/exit-kiosk', { method: 'POST' }).catch(() => {})
      return
    }

    // Reset after 3 seconds of no taps
    tapTimer.current = setTimeout(() => { tapCount.current = 0 }, 3000)
  }, [])

  return (
    <div
      className="fixed top-0 left-0 w-16 h-16 z-50"
      onClick={handleTap}
      aria-hidden="true"
    />
  )
}
