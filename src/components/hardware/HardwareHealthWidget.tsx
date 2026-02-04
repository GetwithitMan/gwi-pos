'use client'

import { useMemo } from 'react'
import Link from 'next/link'

interface Terminal {
  id: string
  name: string
  category: string
  isOnline: boolean
  isPaired: boolean
  lastSeenAt: string | null
  failoverEnabled: boolean
  backupTerminalId: string | null
}

interface Printer {
  id: string
  name: string
  printerRole: string
  isActive: boolean
  lastPingOk: boolean
  lastPingAt: string | null
}

interface KDSScreen {
  id: string
  name: string
  isOnline: boolean
  isPaired: boolean
  lastSeenAt: string | null
}

interface HardwareHealthWidgetProps {
  terminals: Terminal[]
  printers: Printer[]
  kdsScreens: KDSScreen[]
  compact?: boolean
}

// Staleness thresholds
const STALE_THRESHOLD_MS = 60000 // 60 seconds
const GHOST_THRESHOLD_MS = 2 * 60 * 60 * 1000 // 2 hours

function isDeviceHealthy(lastSeenAt: string | null, isOnline: boolean): boolean {
  if (!isOnline) return false
  if (!lastSeenAt) return false
  return Date.now() - new Date(lastSeenAt).getTime() < STALE_THRESHOLD_MS
}

function isDeviceGhost(lastSeenAt: string | null): boolean {
  if (!lastSeenAt) return false
  return Date.now() - new Date(lastSeenAt).getTime() > GHOST_THRESHOLD_MS
}

export function HardwareHealthWidget({
  terminals,
  printers,
  kdsScreens,
  compact = false,
}: HardwareHealthWidgetProps) {
  const stats = useMemo(() => {
    // Terminal stats
    const pairedTerminals = terminals.filter((t) => t.isPaired)
    const onlineTerminals = pairedTerminals.filter((t) =>
      isDeviceHealthy(t.lastSeenAt, t.isOnline)
    )
    const ghostTerminals = pairedTerminals.filter((t) => isDeviceGhost(t.lastSeenAt))

    // Printer stats (based on last ping)
    const activePrinters = printers.filter((p) => p.isActive)
    const onlinePrinters = activePrinters.filter((p) => p.lastPingOk)

    // KDS stats
    const pairedKDS = kdsScreens.filter((k) => k.isPaired)
    const onlineKDS = pairedKDS.filter((k) => isDeviceHealthy(k.lastSeenAt, k.isOnline))

    // Overall health
    const totalDevices = pairedTerminals.length + activePrinters.length + pairedKDS.length
    const onlineDevices = onlineTerminals.length + onlinePrinters.length + onlineKDS.length
    const percentage = totalDevices > 0 ? Math.round((onlineDevices / totalDevices) * 100) : 100

    // Check for active failovers
    const activeFailovers = terminals.filter(
      (t) => t.failoverEnabled && t.backupTerminalId && !isDeviceHealthy(t.lastSeenAt, t.isOnline)
    )

    return {
      percentage,
      onlineDevices,
      totalDevices,
      terminals: {
        online: onlineTerminals.length,
        total: pairedTerminals.length,
        ghosts: ghostTerminals.length,
      },
      printers: {
        online: onlinePrinters.length,
        total: activePrinters.length,
      },
      kds: {
        online: onlineKDS.length,
        total: pairedKDS.length,
      },
      hasActiveFailover: activeFailovers.length > 0,
      activeFailoverCount: activeFailovers.length,
    }
  }, [terminals, printers, kdsScreens])

  // Health color based on percentage
  const getHealthColor = () => {
    if (stats.percentage >= 90) return 'text-green-500'
    if (stats.percentage >= 70) return 'text-yellow-500'
    return 'text-red-500'
  }

  const getHealthBgColor = () => {
    if (stats.percentage >= 90) return 'bg-green-500'
    if (stats.percentage >= 70) return 'bg-yellow-500'
    return 'bg-red-500'
  }

  // Calculate stroke dashoffset for circular gauge
  const circumference = 2 * Math.PI * 20 // r=20
  const strokeDashoffset = circumference - (circumference * stats.percentage) / 100

  if (compact) {
    return (
      <Link
        href="/settings/hardware"
        className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900 p-3 hover:border-slate-700 transition-colors"
      >
        <div className="relative flex h-10 w-10 items-center justify-center">
          <svg className="h-full w-full -rotate-90">
            <circle
              cx="20"
              cy="20"
              r="16"
              stroke="currentColor"
              strokeWidth="3"
              fill="transparent"
              className="text-slate-800"
            />
            <circle
              cx="20"
              cy="20"
              r="16"
              stroke="currentColor"
              strokeWidth="3"
              fill="transparent"
              className={getHealthColor()}
              strokeDasharray={2 * Math.PI * 16}
              strokeDashoffset={2 * Math.PI * 16 - (2 * Math.PI * 16 * stats.percentage) / 100}
              strokeLinecap="round"
            />
          </svg>
          <span className="absolute text-[9px] font-bold text-white">{stats.percentage}%</span>
        </div>
        <div>
          <p className="text-xs font-bold text-white">Hardware</p>
          <p className="text-[10px] text-slate-500">
            {stats.onlineDevices}/{stats.totalDevices} online
          </p>
        </div>
        {stats.hasActiveFailover && (
          <div className="ml-auto h-2 w-2 animate-pulse rounded-full bg-amber-500" />
        )}
      </Link>
    )
  }

  return (
    <div className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800 bg-slate-800/30 p-6">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-cyan-500/10 p-2">
            <svg className="h-6 w-6 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"
              />
            </svg>
          </div>
          <div>
            <h3 className="font-bold tracking-tight text-white">Hardware Health</h3>
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
              Live Infrastructure
            </p>
          </div>
        </div>

        {/* Circular Health Gauge */}
        <div className="relative flex h-14 w-14 items-center justify-center">
          <svg className="h-full w-full -rotate-90">
            <circle
              cx="28"
              cy="28"
              r="24"
              stroke="currentColor"
              strokeWidth="4"
              fill="transparent"
              className="text-slate-800"
            />
            <circle
              cx="28"
              cy="28"
              r="24"
              stroke="currentColor"
              strokeWidth="4"
              fill="transparent"
              className={getHealthColor()}
              strokeDasharray={2 * Math.PI * 24}
              strokeDashoffset={2 * Math.PI * 24 - (2 * Math.PI * 24 * stats.percentage) / 100}
              strokeLinecap="round"
              style={{ transition: 'stroke-dashoffset 0.5s ease-in-out' }}
            />
          </svg>
          <span className="absolute text-sm font-bold text-white">{stats.percentage}%</span>
        </div>
      </div>

      {/* Content */}
      <div className="space-y-4 p-6">
        {/* Active Failover Alert */}
        {stats.hasActiveFailover && (
          <div className="flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
            <svg
              className="h-5 w-5 animate-pulse text-amber-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0"
              />
            </svg>
            <span className="text-xs font-bold text-amber-200">
              Active Failover: {stats.activeFailoverCount} route{stats.activeFailoverCount > 1 ? 's' : ''} redirected
            </span>
          </div>
        )}

        {/* Ghost Device Alert */}
        {stats.terminals.ghosts > 0 && (
          <div className="flex items-center gap-3 rounded-xl border border-purple-500/30 bg-purple-500/10 p-3">
            <svg
              className="h-5 w-5 text-purple-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span className="text-xs font-bold text-purple-200">
              {stats.terminals.ghosts} ghost device{stats.terminals.ghosts > 1 ? 's' : ''} (no heartbeat 2+ hours)
            </span>
          </div>
        )}

        {/* Device Categories */}
        <div className="grid grid-cols-3 gap-3">
          <HealthCard
            icon={
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                />
              </svg>
            }
            label="Terminals"
            online={stats.terminals.online}
            total={stats.terminals.total}
          />
          <HealthCard
            icon={
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"
                />
              </svg>
            }
            label="Printers"
            online={stats.printers.online}
            total={stats.printers.total}
          />
          <HealthCard
            icon={
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                />
              </svg>
            }
            label="KDS"
            online={stats.kds.online}
            total={stats.kds.total}
          />
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-slate-800 p-4">
        <Link
          href="/settings/hardware"
          className="block w-full rounded-xl bg-slate-800 py-2 text-center text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 transition-colors hover:bg-slate-700 hover:text-white"
        >
          Open Hardware Dashboard
        </Link>
      </div>
    </div>
  )
}

function HealthCard({
  icon,
  label,
  online,
  total,
}: {
  icon: React.ReactNode
  label: string
  online: number
  total: number
}) {
  const isHealthy = total === 0 || online === total
  const hasIssues = total > 0 && online < total

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-3">
      <div className="mb-1 flex items-center gap-2 text-slate-500">
        {icon}
        <span className="text-[10px] font-bold uppercase">{label}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span
          className={`font-mono text-xl font-bold ${
            hasIssues ? 'text-amber-400' : 'text-white'
          }`}
        >
          {online}
        </span>
        <span className="font-mono text-sm text-slate-600">/{total}</span>
      </div>
      {total === 0 && (
        <p className="mt-1 text-[9px] text-slate-600">None configured</p>
      )}
    </div>
  )
}
