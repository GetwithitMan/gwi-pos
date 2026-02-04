'use client'

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import { TerminalPairingOverlay, TerminalConfig } from '@/components/pos/TerminalPairingOverlay'

interface TerminalContextValue {
  terminal: TerminalConfig | null
  isLoading: boolean
  isPaired: boolean
  forceAllPrints: boolean
  // Check if a ticket type should be skipped for the current role
  shouldSkipPrint: (ticketType: string, roleId: string) => boolean
  // Force refresh terminal config
  refreshConfig: () => Promise<void>
}

const TerminalContext = createContext<TerminalContextValue | null>(null)

const HEARTBEAT_INTERVAL = 30000 // 30 seconds

interface TerminalProviderProps {
  children: ReactNode
  // Set to true to require terminal pairing (for POS routes)
  requirePairing?: boolean
}

export function TerminalProvider({ children, requirePairing = false }: TerminalProviderProps) {
  const [terminal, setTerminal] = useState<TerminalConfig | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [showPairing, setShowPairing] = useState(false)

  const checkTerminalAuth = useCallback(async () => {
    try {
      const res = await fetch('/api/hardware/terminals/heartbeat', {
        method: 'POST',
        credentials: 'include', // Important for httpOnly cookies
      })

      if (res.ok) {
        const data = await res.json()
        setTerminal(data.terminal)
        setShowPairing(false)
        return true
      }

      // Check for IP mismatch (fixed station moved)
      if (res.status === 403) {
        const data = await res.json()
        if (data.code === 'IP_MISMATCH') {
          console.warn('Terminal IP mismatch - re-pairing required:', data)
        }
      }

      // Not authenticated or token invalid
      setTerminal(null)
      if (requirePairing) {
        setShowPairing(true)
      }
      return false
    } catch (error) {
      console.error('Terminal auth check failed:', error)
      setTerminal(null)
      if (requirePairing) {
        setShowPairing(true)
      }
      return false
    } finally {
      setIsLoading(false)
    }
  }, [requirePairing])

  // Initial auth check
  useEffect(() => {
    checkTerminalAuth()
  }, [checkTerminalAuth])

  // Heartbeat interval
  useEffect(() => {
    if (!terminal) return

    const interval = setInterval(async () => {
      const stillValid = await checkTerminalAuth()
      if (!stillValid) {
        console.warn('Terminal session invalidated')
      }
    }, HEARTBEAT_INTERVAL)

    return () => clearInterval(interval)
  }, [terminal, checkTerminalAuth])

  const handlePaired = useCallback((config: TerminalConfig) => {
    setTerminal(config)
    setShowPairing(false)
  }, [])

  const shouldSkipPrint = useCallback(
    (ticketType: string, roleId: string): boolean => {
      // If force all prints is on, never skip
      if (terminal?.forceAllPrints) {
        return false
      }

      // No skip rules or no terminal = don't skip
      if (!terminal?.roleSkipRules) {
        return false
      }

      // Check if this role should skip this ticket type at this terminal
      const skipRules = terminal.roleSkipRules as Record<string, string[]>
      const roleSkips = skipRules[roleId]

      if (!roleSkips || !Array.isArray(roleSkips)) {
        return false
      }

      return roleSkips.includes(ticketType)
    },
    [terminal]
  )

  const refreshConfig = useCallback(async () => {
    await checkTerminalAuth()
  }, [checkTerminalAuth])

  const value: TerminalContextValue = {
    terminal,
    isLoading,
    isPaired: !!terminal,
    forceAllPrints: terminal?.forceAllPrints ?? false,
    shouldSkipPrint,
    refreshConfig,
  }

  // Show pairing overlay if required and not paired
  if (showPairing && requirePairing) {
    return <TerminalPairingOverlay onPaired={handlePaired} />
  }

  // Show loading state
  if (isLoading && requirePairing) {
    return (
      <div className="fixed inset-0 z-[999] flex items-center justify-center bg-slate-950">
        <div className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-4 border-cyan-500 border-t-transparent" />
          <p className="text-slate-400">Checking terminal authorization...</p>
        </div>
      </div>
    )
  }

  return <TerminalContext.Provider value={value}>{children}</TerminalContext.Provider>
}

export function useTerminal() {
  const context = useContext(TerminalContext)
  if (!context) {
    throw new Error('useTerminal must be used within a TerminalProvider')
  }
  return context
}

// Optional hook that doesn't throw if outside provider
export function useTerminalOptional() {
  return useContext(TerminalContext)
}
