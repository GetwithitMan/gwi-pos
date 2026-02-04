'use client'

import { useState } from 'react'
import { useOfflineSync } from '@/hooks/useOfflineSync'

interface OfflineSyncIndicatorProps {
  terminalId?: string
  terminalName?: string
  showDetails?: boolean
}

export function OfflineSyncIndicator({
  terminalId,
  terminalName,
  showDetails = false,
}: OfflineSyncIndicatorProps) {
  const { status, forceSync, hasPending, isOffline, isDegraded } = useOfflineSync(
    terminalId,
    terminalName
  )
  const [showPanel, setShowPanel] = useState(false)

  // Don't show anything if online with no pending items
  if (status.connectionStatus === 'online' && status.pending === 0 && !showDetails) {
    return null
  }

  const getStatusConfig = () => {
    if (isOffline) {
      return {
        bgColor: 'bg-red-600',
        textColor: 'text-white',
        icon: (
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3m8.293 8.293l1.414 1.414"
            />
          </svg>
        ),
        label: 'Offline',
        pulse: true,
      }
    }

    if (isDegraded) {
      return {
        bgColor: 'bg-amber-600',
        textColor: 'text-white',
        icon: (
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        ),
        label: 'Connection Issues',
        pulse: true,
      }
    }

    if (status.syncing) {
      return {
        bgColor: 'bg-blue-600',
        textColor: 'text-white',
        icon: (
          <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        ),
        label: 'Syncing...',
        pulse: false,
      }
    }

    if (hasPending) {
      return {
        bgColor: 'bg-amber-500',
        textColor: 'text-white',
        icon: (
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>
        ),
        label: `${status.pending} Pending`,
        pulse: false,
      }
    }

    return {
      bgColor: 'bg-green-600',
      textColor: 'text-white',
      icon: (
        <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M5 13l4 4L19 7"
          />
        </svg>
      ),
      label: 'Synced',
      pulse: false,
    }
  }

  const config = getStatusConfig()

  return (
    <div className="relative">
      <button
        onClick={() => setShowPanel(!showPanel)}
        className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${config.bgColor} ${config.textColor}`}
      >
        {config.pulse && (
          <span className="absolute -right-1 -top-1 flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75"></span>
            <span className="relative inline-flex h-3 w-3 rounded-full bg-white"></span>
          </span>
        )}
        {config.icon}
        <span>{config.label}</span>
      </button>

      {/* Expanded Panel */}
      {showPanel && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-xl">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-bold text-white">Sync Status</h3>
            <button
              onClick={() => setShowPanel(false)}
              className="text-slate-400 hover:text-white"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="space-y-3">
            {/* Connection Status */}
            <div className="flex items-center justify-between rounded-lg bg-slate-800 p-3">
              <span className="text-sm text-slate-400">Connection</span>
              <span
                className={`flex items-center gap-2 text-sm font-medium ${
                  isOffline ? 'text-red-400' : isDegraded ? 'text-amber-400' : 'text-green-400'
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    isOffline ? 'bg-red-500' : isDegraded ? 'bg-amber-500' : 'bg-green-500'
                  }`}
                />
                {isOffline ? 'Offline' : isDegraded ? 'Degraded' : 'Online'}
              </span>
            </div>

            {/* Pending Items */}
            <div className="flex items-center justify-between rounded-lg bg-slate-800 p-3">
              <span className="text-sm text-slate-400">Pending Sync</span>
              <span className="text-sm font-medium text-white">{status.pending} items</span>
            </div>

            {/* Sync Status */}
            <div className="flex items-center justify-between rounded-lg bg-slate-800 p-3">
              <span className="text-sm text-slate-400">Status</span>
              <span className="text-sm font-medium text-white">
                {status.syncing ? 'Syncing...' : 'Idle'}
              </span>
            </div>

            {/* Error Message */}
            {status.lastError && (
              <div className="rounded-lg bg-red-900/30 p-3">
                <p className="text-xs text-red-400">{status.lastError}</p>
              </div>
            )}

            {/* Force Sync Button */}
            <button
              onClick={forceSync}
              disabled={status.syncing || isOffline}
              className="w-full rounded-lg bg-cyan-600 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-50"
            >
              {status.syncing ? 'Syncing...' : 'Force Sync Now'}
            </button>
          </div>

          {/* Offline Mode Info */}
          {isOffline && (
            <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
              <p className="text-xs text-amber-200">
                Orders will be saved locally and synced when connection is restored.
                Printing may still work over local network.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Compact version for header bars
export function OfflineSyncBadge({ terminalId, terminalName }: { terminalId?: string; terminalName?: string }) {
  const { isOffline, isDegraded, hasPending, status } = useOfflineSync(terminalId, terminalName)

  // Only show if there's something to report
  if (!isOffline && !isDegraded && !hasPending) {
    return null
  }

  return (
    <div
      className={`flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-bold ${
        isOffline
          ? 'bg-red-600 text-white'
          : isDegraded
            ? 'bg-amber-600 text-white'
            : 'bg-amber-500 text-white'
      }`}
    >
      {isOffline ? (
        <>
          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072"
            />
          </svg>
          OFFLINE
        </>
      ) : (
        <>
          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>
          {status.pending}
        </>
      )}
    </div>
  )
}
