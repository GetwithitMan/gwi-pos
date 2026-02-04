'use client'

import type { PaymentReader, DatacapProcessingStatus } from '@/hooks/useDatacap'

interface ReaderStatusIndicatorProps {
  reader: PaymentReader | null
  isOnline: boolean
  processingStatus: DatacapProcessingStatus
  onSwapClick: () => void
  canSwap: boolean
}

export function ReaderStatusIndicator({
  reader,
  isOnline,
  processingStatus,
  onSwapClick,
  canSwap,
}: ReaderStatusIndicatorProps) {
  if (!reader) {
    return (
      <div className="flex items-center justify-between p-4 bg-red-900/20 rounded-2xl border border-red-800">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-red-500" />
          <div>
            <p className="text-xs font-bold text-red-400 uppercase tracking-tight">
              No Reader Configured
            </p>
            <p className="text-[10px] text-red-500">
              Go to Settings → Hardware → Terminals to bind a reader
            </p>
          </div>
        </div>
      </div>
    )
  }

  const isActive = processingStatus === 'waiting_card' || processingStatus === 'authorizing'

  return (
    <div className="flex items-center justify-between p-4 bg-slate-900/50 rounded-2xl border border-slate-800">
      <div className="flex items-center gap-3">
        {/* Status Indicator */}
        <div
          className={`w-2 h-2 rounded-full ${
            isActive
              ? 'bg-amber-500 animate-ping'
              : isOnline
              ? 'bg-emerald-500'
              : 'bg-red-500'
          }`}
        />
        <div>
          <p className="text-xs font-bold text-white uppercase tracking-tight">
            {reader.name}
          </p>
          <p className="text-[10px] font-mono text-slate-500">
            {reader.ipAddress}:{reader.port}
          </p>
        </div>
      </div>

      {/* Status Badge */}
      <div className="flex items-center gap-3">
        {!isOnline && (
          <span className="px-2 py-1 text-[10px] font-bold uppercase bg-red-500/20 text-red-400 rounded">
            Offline
          </span>
        )}
        {isOnline && !isActive && (
          <span className="px-2 py-1 text-[10px] font-bold uppercase bg-emerald-500/20 text-emerald-400 rounded">
            Ready
          </span>
        )}
        {isActive && (
          <span className="px-2 py-1 text-[10px] font-bold uppercase bg-amber-500/20 text-amber-400 rounded animate-pulse">
            Active
          </span>
        )}

        {/* Swap Button */}
        {canSwap && (
          <button
            onClick={onSwapClick}
            className="text-[10px] font-black text-cyan-500 uppercase tracking-widest hover:text-cyan-400 transition-colors"
          >
            Swap
          </button>
        )}
      </div>
    </div>
  )
}
