'use client'

import { useState, useEffect, useCallback } from 'react'
import { isHappyHourActive, getHappyHourEndTime, DEFAULT_SETTINGS } from '@/lib/settings'
import type { HappyHourSettings } from '@/lib/settings'

/**
 * Compact banner shown at the top of the POS when happy hour is active.
 * Self-contained: fetches happy hour settings from /api/settings on mount.
 * Displays the happy hour name and a countdown to when it ends.
 * Updates every minute. Only renders when happy hour is currently active.
 */
export function HappyHourBanner() {
  const [settings, setSettings] = useState<HappyHourSettings | null>(null)
  const [active, setActive] = useState(false)
  const [remainingMinutes, setRemainingMinutes] = useState(0)

  // Fetch happy hour settings on mount
  useEffect(() => {
    let cancelled = false
    fetch('/api/settings')
      .then(res => res.json())
      .then(raw => {
        if (cancelled) return
        const data = raw.data ?? raw
        const s = data.settings || data
        const hh: HappyHourSettings = s.happyHour || DEFAULT_SETTINGS.happyHour
        setSettings(hh)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const update = useCallback(() => {
    if (!settings) return
    const isActive = isHappyHourActive(settings)
    setActive(isActive)

    if (isActive) {
      const endTime = getHappyHourEndTime(settings)
      if (endTime) {
        const diffMs = endTime.getTime() - Date.now()
        setRemainingMinutes(Math.max(0, Math.ceil(diffMs / 60000)))
      } else {
        setRemainingMinutes(0)
      }
    }
  }, [settings])

  // Check active state immediately when settings load, then every 60s
  useEffect(() => {
    update()
    const interval = setInterval(update, 60000)
    return () => clearInterval(interval)
  }, [update])

  if (!active || !settings) return null

  // Color transitions: green when > 15 min, amber when <= 15 min
  const isClosing = remainingMinutes <= 15
  const bgClass = isClosing
    ? 'bg-amber-600/90'
    : 'bg-emerald-600/90'

  const formatRemaining = () => {
    if (remainingMinutes <= 0) return 'ending now'
    if (remainingMinutes >= 60) {
      const hours = Math.floor(remainingMinutes / 60)
      const mins = remainingMinutes % 60
      return mins > 0 ? `${hours}h ${mins}m left` : `${hours}h left`
    }
    return `${remainingMinutes}m left`
  }

  return (
    <div className={`${bgClass} text-white text-center py-1.5 px-4 text-sm font-medium flex items-center justify-center gap-2 shrink-0`}>
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <span>{settings.name || 'Happy Hour'}</span>
      <span className="opacity-75">-</span>
      <span className="opacity-90">{formatRemaining()}</span>
    </div>
  )
}
