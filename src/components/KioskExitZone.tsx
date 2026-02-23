'use client'

import { useRef, useCallback } from 'react'

/**
 * Hidden 5-tap zone in the top-left corner to exit Chromium kiosk/fullscreen mode.
 * Rendered in root layout so it works on every page (login, orders, admin, etc.).
 *
 * Fires exit requests to:
 * 1. POST /api/system/exit-kiosk — works on server stations (POS runs locally)
 * 2. POST http://localhost:3006/exit — works on terminal stations (local micro-service)
 *
 * Both are tried; whichever applies will work.
 */
export function KioskExitZone() {
  const tapCount = useRef(0)
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleTap = useCallback(() => {
    tapCount.current++
    if (tapTimer.current) clearTimeout(tapTimer.current)

    if (tapCount.current >= 5) {
      tapCount.current = 0
      // Server station: POS API handles it
      fetch('/api/system/exit-kiosk', { method: 'POST' }).catch(() => {})
      // Terminal station: local micro-service handles it
      fetch('http://localhost:3006/exit', { method: 'POST', mode: 'no-cors' }).catch(() => {})
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
