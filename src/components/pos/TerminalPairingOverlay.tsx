'use client'

import { useState, useEffect, useCallback } from 'react'

interface TerminalPairingOverlayProps {
  onPaired: (config: TerminalConfig) => void
}

export interface TerminalConfig {
  id: string
  name: string
  category: string
  roleSkipRules: Record<string, string[]> | null
  forceAllPrints: boolean
  receiptPrinter: {
    id: string
    name: string
    ipAddress: string
  } | null
}

export function TerminalPairingOverlay({ onPaired }: TerminalPairingOverlayProps) {
  const [pairingCode, setPairingCode] = useState('')
  const [status, setStatus] = useState<'idle' | 'submitting' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [deviceIp, setDeviceIp] = useState<string>('Detecting...')

  // Try to detect device IP (for display purposes)
  useEffect(() => {
    // In production, this would come from a local network detection
    // For now, show a placeholder
    fetch('/api/hardware/terminals/heartbeat', { method: 'POST' })
      .then(() => setDeviceIp('Connected'))
      .catch(() => setDeviceIp('Unknown'))
  }, [])

  const handleCodeChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return // Only digits

    const newCode = pairingCode.split('')
    newCode[index] = value.slice(-1) // Take last character
    const joined = newCode.join('').slice(0, 6)
    setPairingCode(joined)

    // Auto-focus next input
    if (value && index < 5) {
      const nextInput = document.getElementById(`code-${index + 1}`)
      nextInput?.focus()
    }
  }

  const handleKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !pairingCode[index] && index > 0) {
      const prevInput = document.getElementById(`code-${index - 1}`)
      prevInput?.focus()
    }
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    setPairingCode(pasted)
    // Focus last filled or first empty
    const focusIndex = Math.min(pasted.length, 5)
    document.getElementById(`code-${focusIndex}`)?.focus()
  }

  const handleSubmit = useCallback(async () => {
    if (pairingCode.length !== 6) {
      setError('Please enter all 6 digits')
      return
    }

    setStatus('submitting')
    setError(null)

    try {
      const res = await fetch('/api/hardware/terminals/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pairingCode,
          deviceFingerprint: navigator.userAgent, // Simple fingerprint
          deviceInfo: {
            userAgent: navigator.userAgent,
            platform: navigator.platform,
            language: navigator.language,
            screenWidth: window.screen.width,
            screenHeight: window.screen.height,
          },
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Pairing failed')
        setStatus('error')
        return
      }

      // Success! The httpOnly cookie is already set by the server
      onPaired(data.terminal)
    } catch (err) {
      setError('Network error - please try again')
      setStatus('error')
    }
  }, [pairingCode, onPaired])

  // Auto-submit when 6 digits entered
  useEffect(() => {
    if (pairingCode.length === 6 && status === 'idle') {
      handleSubmit()
    }
  }, [pairingCode, status, handleSubmit])

  return (
    <div className="fixed inset-0 z-[999] flex flex-col items-center justify-center bg-slate-950 p-8 text-center">
      <div className="animate-fade-in">
        {/* Icon */}
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full border border-cyan-500/30 bg-cyan-500/10">
          <svg
            className="h-10 w-10 animate-pulse text-cyan-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071a10 10 0 0114.142 0M1.398 8.111a15 15 0 0121.204 0"
            />
          </svg>
        </div>

        {/* Title */}
        <h1 className="mb-2 text-3xl font-black tracking-tight text-white">PAIR TERMINAL</h1>
        <p className="mx-auto mb-8 max-w-xs text-slate-400">
          Enter the 6-digit code from the Terminal Manager to authorize this device.
        </p>

        {/* Code Input */}
        <div className="mb-6 rounded-3xl border-2 border-slate-800 bg-slate-900 p-8 shadow-2xl">
          <div className="flex justify-center gap-3" onPaste={handlePaste}>
            {[0, 1, 2, 3, 4, 5].map((index) => (
              <input
                key={index}
                id={`code-${index}`}
                type="text"
                inputMode="numeric"
                maxLength={1}
                value={pairingCode[index] || ''}
                onChange={(e) => handleCodeChange(index, e.target.value)}
                onKeyDown={(e) => handleKeyDown(index, e)}
                disabled={status === 'submitting'}
                className="h-16 w-12 rounded-xl border-2 border-slate-700 bg-slate-800 text-center text-3xl font-mono font-bold text-white transition-all focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 disabled:opacity-50"
                autoFocus={index === 0}
              />
            ))}
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 rounded-xl bg-red-500/10 px-4 py-3 text-red-400">
            <p className="text-sm font-medium">{error}</p>
          </div>
        )}

        {/* Status Indicator */}
        <div className="flex items-center justify-center gap-3 text-slate-500">
          {status === 'submitting' ? (
            <>
              <div className="h-2 w-2 animate-spin rounded-full border border-cyan-500 border-t-transparent" />
              <span className="text-xs font-bold uppercase tracking-widest">Pairing...</span>
            </>
          ) : (
            <>
              <div className="h-2 w-2 animate-ping rounded-full bg-cyan-500" />
              <span className="text-xs font-bold uppercase tracking-widest">
                Awaiting Code Entry...
              </span>
            </>
          )}
        </div>

        {/* Help Text */}
        <p className="mt-8 text-xs text-slate-600">
          Ask a manager to generate a pairing code from
          <br />
          Settings → Hardware → Terminals
        </p>
      </div>
    </div>
  )
}
