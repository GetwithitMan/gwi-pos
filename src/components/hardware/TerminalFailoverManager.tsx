'use client'

import { useState } from 'react'

interface Terminal {
  id: string
  name: string
  category: string
  isOnline: boolean
  isPaired: boolean
  lastSeenAt: string | null
  backupTerminalId: string | null
  failoverEnabled: boolean
  failoverTimeout: number
}

interface TerminalFailoverManagerProps {
  terminals: Terminal[]
  onUpdate: () => void
}

// Staleness threshold
const STALE_THRESHOLD_MS = 60000

function getTerminalHealth(terminal: Terminal): 'healthy' | 'stale' | 'offline' {
  if (!terminal.isPaired || !terminal.isOnline) return 'offline'
  if (terminal.lastSeenAt) {
    const lastSeen = new Date(terminal.lastSeenAt).getTime()
    if (Date.now() - lastSeen > STALE_THRESHOLD_MS) return 'stale'
  }
  return 'healthy'
}

export function TerminalFailoverManager({ terminals, onUpdate }: TerminalFailoverManagerProps) {
  const [saving, setSaving] = useState<string | null>(null)

  const handleBackupChange = async (terminalId: string, backupTerminalId: string | null) => {
    setSaving(terminalId)
    try {
      await fetch(`/api/hardware/terminals/${terminalId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backupTerminalId }),
      })
      onUpdate()
    } catch (error) {
      console.error('Failed to update backup terminal:', error)
    } finally {
      setSaving(null)
    }
  }

  const handleFailoverToggle = async (terminal: Terminal) => {
    setSaving(terminal.id)
    try {
      await fetch(`/api/hardware/terminals/${terminal.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ failoverEnabled: !terminal.failoverEnabled }),
      })
      onUpdate()
    } catch (error) {
      console.error('Failed to toggle failover:', error)
    } finally {
      setSaving(null)
    }
  }

  // Only show terminals that are paired or have other terminals that could back them up
  const configurableTerminals = terminals.filter((t) => t.isPaired || terminals.length > 1)

  if (configurableTerminals.length === 0) {
    return null
  }

  return (
    <div className="mt-8 rounded-3xl border border-slate-800 bg-slate-900 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-800/30 p-6">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-bold text-white">
            <svg className="h-6 w-6 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
              />
            </svg>
            Hardware Failover Rules
          </h2>
          <p className="text-sm text-slate-400">
            Define backup destinations when hardware goes offline
          </p>
        </div>
      </div>

      {/* Failover Rules */}
      <div className="p-6">
        <div className="space-y-4">
          {configurableTerminals.map((terminal) => {
            const health = getTerminalHealth(terminal)
            const backupTerminal = terminals.find((t) => t.id === terminal.backupTerminalId)
            const availableBackups = terminals.filter((t) => t.id !== terminal.id)
            const isSaving = saving === terminal.id

            return (
              <div
                key={terminal.id}
                className="flex items-center gap-4 rounded-2xl border border-slate-800 bg-slate-950/50 p-4"
              >
                {/* Primary Station */}
                <div className="flex-1">
                  <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">
                    Primary Station
                  </span>
                  <div className="flex items-center gap-3">
                    <div
                      className={`h-2.5 w-2.5 rounded-full ${
                        health === 'healthy'
                          ? 'bg-green-500 animate-pulse'
                          : health === 'stale'
                            ? 'bg-yellow-500'
                            : 'bg-red-500'
                      }`}
                    />
                    <span className="font-bold text-white">{terminal.name}</span>
                    {health === 'offline' && (
                      <span className="rounded bg-red-900/30 px-2 py-0.5 text-[10px] font-bold text-red-400">
                        OFFLINE
                      </span>
                    )}
                  </div>
                </div>

                {/* Arrow */}
                <svg className="h-5 w-5 text-slate-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>

                {/* Backup Destination */}
                <div className="flex-1">
                  <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-cyan-500">
                    Backup Destination
                  </span>
                  <select
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-cyan-500 focus:outline-none disabled:opacity-50"
                    value={terminal.backupTerminalId || ''}
                    onChange={(e) => handleBackupChange(terminal.id, e.target.value || null)}
                    disabled={isSaving}
                  >
                    <option value="">No Backup (Stop Printing)</option>
                    {availableBackups.map((t) => {
                      const backupHealth = getTerminalHealth(t)
                      return (
                        <option key={t.id} value={t.id}>
                          {t.name} {backupHealth === 'offline' ? '(Offline)' : ''}
                        </option>
                      )
                    })}
                  </select>
                </div>

                {/* Failover Toggle */}
                <div className="flex flex-col items-end">
                  <span className="mb-1 block text-[10px] font-black uppercase tracking-widest text-slate-500">
                    Auto-Failover
                  </span>
                  <button
                    onClick={() => handleFailoverToggle(terminal)}
                    disabled={isSaving || !terminal.backupTerminalId}
                    className={`relative h-6 w-11 rounded-full transition-colors disabled:opacity-50 ${
                      terminal.failoverEnabled && terminal.backupTerminalId
                        ? 'bg-cyan-600'
                        : 'bg-slate-700'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                        terminal.failoverEnabled && terminal.backupTerminalId
                          ? 'translate-x-5'
                          : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {/* Info Box */}
        <div className="mt-6 flex items-start gap-3 rounded-xl border border-amber-900/30 bg-amber-900/10 p-4">
          <svg className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <div className="text-sm text-amber-200/80">
            <p className="font-medium">How Failover Works</p>
            <p className="mt-1 text-amber-200/60">
              When a station misses heartbeats for 45+ seconds, the system automatically redirects
              tickets to the backup destination. Staff will see a notification when failover occurs.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
