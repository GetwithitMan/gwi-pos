'use client'

import { useState, useEffect } from 'react'

type AuthState = 'pending_auth' | 'open' | 'no_card' | 'auth_failed' | 'closed' | null | undefined

interface AuthStatusBadgeProps {
  tabStatus: AuthState
  /** Compact: dot only. Default: dot + text */
  compact?: boolean
  /** Dark mode (for OpenOrdersPanel expanded view) */
  dark?: boolean
  /** Brief orange flash on incremental auth */
  flash?: boolean
}

/**
 * Auth status badge for bar tabs.
 *
 * Visual states:
 * - Orange dot + "Auth Pending" — pre-auth in progress
 * - Green dot + "Authorized" — card authorized
 * - Red dot + "Auth Failed" — gateway declined
 * - Gray dot + "No Card" — cash tab / no card on file
 * - null/closed — renders nothing
 */
export function AuthStatusBadge({ tabStatus, compact = false, dark = false, flash = false }: AuthStatusBadgeProps) {
  const [isFlashing, setIsFlashing] = useState(false)

  // Brief orange flash for incremental auth
  useEffect(() => {
    if (flash) {
      setIsFlashing(true)
      const timer = setTimeout(() => setIsFlashing(false), 1500)
      return () => clearTimeout(timer)
    }
  }, [flash])

  if (!tabStatus || tabStatus === 'closed') return null

  const config = getConfig(isFlashing ? 'pending_auth' : tabStatus, dark)
  if (!config) return null

  return (
    <span
      className={`inline-flex items-center gap-1 ${config.containerClass} ${
        tabStatus === 'pending_auth' || isFlashing ? 'animate-pulse' : ''
      }`}
    >
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${config.dotClass}`} />
      {!compact && (
        <span className={`text-[10px] font-semibold leading-none ${config.textClass}`}>
          {config.label}
        </span>
      )}
    </span>
  )
}

function getConfig(status: AuthState, dark: boolean) {
  switch (status) {
    case 'pending_auth':
      return {
        label: 'Auth Pending',
        dotClass: 'bg-amber-500',
        textClass: dark ? 'text-amber-300' : 'text-amber-600',
        containerClass: dark
          ? 'bg-amber-600/20 border border-amber-500/30 rounded px-1.5 py-0.5'
          : 'bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5',
      }
    case 'open':
      return {
        label: 'Authorized',
        dotClass: 'bg-green-500',
        textClass: dark ? 'text-green-300' : 'text-green-600',
        containerClass: dark
          ? 'bg-green-600/20 border border-green-500/30 rounded px-1.5 py-0.5'
          : 'bg-green-50 border border-green-200 rounded px-1.5 py-0.5',
      }
    case 'auth_failed':
      return {
        label: 'Auth Failed',
        dotClass: 'bg-red-500',
        textClass: dark ? 'text-red-300' : 'text-red-600',
        containerClass: dark
          ? 'bg-red-600/20 border border-red-500/30 rounded px-1.5 py-0.5'
          : 'bg-red-50 border border-red-200 rounded px-1.5 py-0.5',
      }
    case 'no_card':
      return {
        label: 'No Card',
        dotClass: 'bg-gray-400',
        textClass: dark ? 'text-slate-400' : 'text-gray-500',
        containerClass: dark
          ? 'bg-white/5 border border-white/10 rounded px-1.5 py-0.5'
          : 'bg-gray-50 border border-gray-200 rounded px-1.5 py-0.5',
      }
    default:
      return null
  }
}
