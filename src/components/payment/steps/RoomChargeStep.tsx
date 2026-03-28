'use client'

import React, { useState } from 'react'
import { formatCurrency } from '@/lib/utils'
import { usePaymentContext } from '../PaymentContext'
import type { PendingPayment } from '../PaymentContext'
import {
  sectionLabelClasses,
  inputClasses,
  backButtonClasses,
  primaryButtonClasses,
  infoPanelBase,
  infoPanelTeal,
} from '../payment-styles'

interface RoomGuest {
  reservationId: string
  roomNumber: string
  guestName: string
  checkInDate: string
  checkOutDate: string
  selectionId: string
}

/**
 * RoomChargeStep — hotel PMS room lookup and bill-to-room payment.
 */
export function RoomChargeStep() {
  const {
    totalWithTip,
    currentTotal,
    tipAmount,
    employeeId,
    isProcessing,
    pendingPayments,
    processPayments,
    setStep,
  } = usePaymentContext()

  // Local room charge state
  const [roomChargeInput, setRoomChargeInput] = useState('')
  const [roomChargeSearchType, setRoomChargeSearchType] = useState<'room' | 'name'>('room')
  const [roomChargeResults, setRoomChargeResults] = useState<RoomGuest[]>([])
  const [selectedRoomGuest, setSelectedRoomGuest] = useState<RoomGuest | null>(null)
  const [roomChargeLookupLoading, setRoomChargeLookupLoading] = useState(false)
  const [roomChargeLookupError, setRoomChargeLookupError] = useState<string | null>(null)

  const handleRoomChargeLookup = async () => {
    if (!roomChargeInput.trim()) return
    setRoomChargeLookupLoading(true)
    setRoomChargeLookupError(null)
    setRoomChargeResults([])
    setSelectedRoomGuest(null)
    try {
      const params = new URLSearchParams({
        q: roomChargeInput.trim(),
        type: roomChargeSearchType,
        ...(employeeId ? { employeeId } : {}),
      })
      const res = await fetch(`/api/integrations/oracle-pms/room-lookup?${params}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Lookup failed')
      const guests = data.data?.guests ?? []
      if (guests.length === 0) {
        setRoomChargeLookupError(
          roomChargeSearchType === 'room'
            ? `No in-house guest found in room ${roomChargeInput}. Verify the room number.`
            : `No in-house guest found with last name "${roomChargeInput}".`
        )
      } else if (guests.length === 1) {
        setSelectedRoomGuest(guests[0])
      }
      setRoomChargeResults(guests)
    } catch (err) {
      setRoomChargeLookupError(err instanceof Error ? err.message : 'Lookup failed')
    } finally {
      setRoomChargeLookupLoading(false)
    }
  }

  const handleRoomChargePayment = () => {
    if (!selectedRoomGuest) return

    const payment: PendingPayment = {
      method: 'room_charge',
      amount: currentTotal,
      tipAmount,
      selectionId: selectedRoomGuest.selectionId,
      roomNumber: selectedRoomGuest.roomNumber,
      guestName: selectedRoomGuest.guestName,
      pmsReservationId: selectedRoomGuest.reservationId,
    }
    processPayments([...pendingPayments, payment], pendingPayments)
  }

  return (
    <div className="flex flex-col gap-3">
      <h3 className={sectionLabelClasses}>Bill to Room</h3>

      <div className={`${infoPanelBase} ${infoPanelTeal}`}>
        <div className="flex justify-between font-bold text-lg font-mono">
          <span className="text-slate-400">Amount to Charge</span>
          <span className="text-teal-400">{formatCurrency(totalWithTip)}</span>
        </div>
      </div>

      {/* Search type toggle */}
      <div className="flex gap-2">
        {(['room', 'name'] as const).map(type => (
          <button
            key={type}
            onClick={() => { setRoomChargeSearchType(type); setRoomChargeInput(''); setRoomChargeResults([]); setSelectedRoomGuest(null); setRoomChargeLookupError(null) }}
            className={`flex-1 py-2 rounded-lg text-[13px] font-semibold cursor-pointer transition-colors ${
              roomChargeSearchType === type
                ? 'border-2 border-teal-400 bg-teal-500/[0.12] text-teal-400'
                : 'border border-slate-600/30 bg-transparent text-slate-400'
            }`}
          >
            {type === 'room' ? 'Room Number' : 'Last Name'}
          </button>
        ))}
      </div>

      {/* Search input */}
      <div className="flex gap-2">
        <input
          type={roomChargeSearchType === 'room' ? 'tel' : 'text'}
          value={roomChargeInput}
          onChange={e => { setRoomChargeInput(e.target.value); setRoomChargeResults([]); setSelectedRoomGuest(null); setRoomChargeLookupError(null) }}
          onKeyDown={e => e.key === 'Enter' && void handleRoomChargeLookup()}
          placeholder={roomChargeSearchType === 'room' ? 'Enter room number...' : 'Enter guest last name...'}
          className={`${inputClasses} flex-1`}
          autoFocus
        />
        <button
          onClick={() => void handleRoomChargeLookup()}
          disabled={!roomChargeInput.trim() || roomChargeLookupLoading}
          className={`px-4 rounded-lg bg-teal-500/15 border border-teal-500/40 text-teal-400 font-semibold text-sm ${(!roomChargeInput.trim() || roomChargeLookupLoading) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-teal-500/25'}`}
        >
          {roomChargeLookupLoading ? '...' : 'Look Up'}
        </button>
      </div>

      {/* Error */}
      {roomChargeLookupError && (
        <div className="py-2.5 px-3.5 bg-red-500/10 border border-red-500/25 rounded-lg text-red-300 text-[13px]">
          {roomChargeLookupError}
        </div>
      )}

      {/* Multiple results */}
      {roomChargeResults.length > 1 && !selectedRoomGuest && (
        <div className="max-h-48 overflow-y-auto rounded-[10px] border border-teal-500/20">
          {roomChargeResults.map(guest => (
            <button
              key={guest.reservationId}
              onClick={() => setSelectedRoomGuest(guest)}
              className="w-full p-3 text-left bg-transparent border-b border-slate-600/10 cursor-pointer hover:bg-white/[0.03]"
            >
              <div className="text-slate-100 font-medium">{guest.guestName}</div>
              <div className="text-[13px] text-slate-400 mt-0.5">
                Room {guest.roomNumber} · Checking out {guest.checkOutDate}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Confirmed guest */}
      {selectedRoomGuest && (
        <div className="p-3.5 bg-teal-500/10 border border-teal-500/25 rounded-[10px]">
          <div className="text-teal-400 text-xs font-semibold uppercase tracking-wide mb-1">
            Guest Confirmed
          </div>
          <div className="text-slate-100 font-semibold text-base">{selectedRoomGuest.guestName}</div>
          <div className="text-[13px] text-slate-400 mt-0.5">Room {selectedRoomGuest.roomNumber}</div>
          <button
            onClick={() => setSelectedRoomGuest(null)}
            className="mt-2 text-xs text-slate-500 bg-transparent border-none cursor-pointer p-0 hover:text-slate-300"
          >
            Wrong guest? Search again
          </button>
        </div>
      )}

      <div className="flex gap-2 mt-1">
        <button
          onClick={() => setStep('method')}
          disabled={isProcessing}
          className={`${backButtonClasses} ${isProcessing ? 'opacity-50' : ''}`}
        >
          Back
        </button>
        <button
          onClick={handleRoomChargePayment}
          disabled={isProcessing || !selectedRoomGuest}
          className={`${primaryButtonClasses} ${selectedRoomGuest ? '!bg-gradient-to-br !from-teal-600 !to-teal-500' : ''} ${(isProcessing || !selectedRoomGuest) ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          {isProcessing ? 'Processing...' : `Charge Room ${selectedRoomGuest?.roomNumber ?? ''}`}
        </button>
      </div>
    </div>
  )
}
