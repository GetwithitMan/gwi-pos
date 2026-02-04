'use client'

import { useState } from 'react'
import { SpeakerWaveIcon, CheckCircleIcon } from '@heroicons/react/24/outline'
import type { PaymentReader } from '@/hooks/useDatacap'

interface SwapConfirmationModalProps {
  targetReader: PaymentReader
  onCancel: () => void
  onConfirm: () => void
  onBeep: () => Promise<void>
}

export function SwapConfirmationModal({
  targetReader,
  onCancel,
  onConfirm,
  onBeep,
}: SwapConfirmationModalProps) {
  const [isPinging, setIsPinging] = useState(false)
  const [beeped, setBeeped] = useState(false)

  const handleBeep = async () => {
    setIsPinging(true)
    try {
      await onBeep()
      setBeeped(true)
    } catch (err) {
      console.error('Failed to beep:', err)
    } finally {
      setIsPinging(false)
    }
  }

  // Show last 6 digits of serial number
  const serialDisplay = targetReader.serialNumber.length > 6
    ? `...${targetReader.serialNumber.slice(-6)}`
    : targetReader.serialNumber

  return (
    <div className="fixed inset-0 bg-black/95 flex items-center justify-center z-[300] p-6">
      <div className="bg-slate-900 border-2 border-amber-500 rounded-3xl p-8 w-full max-w-sm text-center shadow-2xl">
        {/* Header */}
        <h3 className="text-xl font-black text-white mb-2">VERIFY DEVICE</h3>
        <p className="text-slate-400 text-xs mb-6 uppercase tracking-widest">
          Match Serial Number on back of reader:
        </p>

        {/* Serial Number Display */}
        <div className="bg-slate-950 rounded-2xl p-6 mb-6 border border-slate-800">
          <span className="text-3xl font-mono font-bold text-cyan-400">
            SN: {serialDisplay}
          </span>
        </div>

        {/* Reader Info */}
        <div className="bg-slate-950/50 rounded-xl p-4 mb-6 text-left border border-slate-800">
          <div className="flex justify-between text-sm mb-2">
            <span className="text-slate-500">Reader Name:</span>
            <span className="text-white font-medium">{targetReader.name}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">IP Address:</span>
            <span className="text-slate-300 font-mono text-xs">
              {targetReader.ipAddress}:{targetReader.port}
            </span>
          </div>
        </div>

        {/* Ping/Beep Button */}
        <button
          onClick={handleBeep}
          disabled={isPinging}
          className={`w-full mb-3 py-3 rounded-xl font-bold text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 ${
            beeped
              ? 'border-2 border-emerald-500 text-emerald-500 bg-emerald-500/10'
              : 'border-2 border-cyan-500 text-cyan-500 hover:bg-cyan-500/10'
          } ${isPinging ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          {isPinging ? (
            <>
              <div className="w-4 h-4 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin" />
              PINGING...
            </>
          ) : beeped ? (
            <>
              <CheckCircleIcon className="w-5 h-5" />
              READER BEEPED
            </>
          ) : (
            <>
              <SpeakerWaveIcon className="w-5 h-5" />
              PING READER (BEEP)
            </>
          )}
        </button>

        {/* Confirm Button */}
        <button
          onClick={onConfirm}
          className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white font-black rounded-xl shadow-lg transition-all"
        >
          YES, I HAVE THIS READER
        </button>

        {/* Cancel Button */}
        <button
          onClick={onCancel}
          className="w-full mt-3 py-3 text-slate-400 hover:text-white text-sm font-bold transition-all"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
