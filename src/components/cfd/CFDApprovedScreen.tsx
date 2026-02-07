'use client'

import { useState } from 'react'
import type { CFDApprovedEvent } from '@/types/multi-surface'

interface CFDApprovedScreenProps {
  data: CFDApprovedEvent | null
  onReceiptChoice: (method: 'email' | 'text' | 'print' | 'none', contact?: string) => void
}

export default function CFDApprovedScreen({ data, onReceiptChoice }: CFDApprovedScreenProps) {
  const [showReceipt, setShowReceipt] = useState(false)
  const [receiptMethod, setReceiptMethod] = useState<'email' | 'text' | null>(null)
  const [contact, setContact] = useState('')

  if (!data) return null

  if (showReceipt && receiptMethod) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gradient-to-br from-gray-900 via-black to-gray-900 p-8">
        <h2 className="text-2xl text-white/80 mb-8">
          {receiptMethod === 'email' ? 'Enter Email Address' : 'Enter Phone Number'}
        </h2>

        <input
          type={receiptMethod === 'email' ? 'email' : 'tel'}
          value={contact}
          onChange={e => setContact(e.target.value)}
          placeholder={receiptMethod === 'email' ? 'you@example.com' : '(555) 555-5555'}
          className="w-full max-w-md px-6 py-4 rounded-2xl bg-white/10 text-white text-xl text-center placeholder-white/30 outline-none focus:ring-2 focus:ring-blue-500"
          autoFocus
        />

        <div className="flex gap-4 mt-8">
          <button
            onClick={() => { setShowReceipt(false); setReceiptMethod(null) }}
            className="px-8 py-4 text-white/50 text-lg hover:text-white/70 transition-colors"
          >
            Back
          </button>
          <button
            onClick={() => onReceiptChoice(receiptMethod, contact)}
            disabled={!contact}
            className={`px-8 py-4 rounded-2xl text-lg font-medium transition-colors
              ${contact
                ? 'bg-blue-500 text-white hover:bg-blue-600'
                : 'bg-white/10 text-white/30 cursor-not-allowed'
              }`}
          >
            Send Receipt
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-gradient-to-br from-gray-900 via-black to-gray-900 p-8">
      {/* Success animation */}
      <div className="w-24 h-24 rounded-full bg-emerald-500/20 flex items-center justify-center mb-8 animate-fade-in">
        <svg className="w-12 h-12 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>

      <h2 className="text-3xl text-white/90 mb-2">Thank You!</h2>
      <p className="text-white/40 text-lg mb-8">Payment Approved</p>

      {/* Payment details */}
      <div className="bg-white/5 rounded-2xl p-6 max-w-sm w-full space-y-3 mb-8">
        <div className="flex justify-between text-white/60">
          <span>Card</span>
          <span>{data.cardType} ...{data.last4}</span>
        </div>
        {data.tipAmount > 0 && (
          <div className="flex justify-between text-white/60">
            <span>Tip</span>
            <span className="tabular-nums">${data.tipAmount.toFixed(2)}</span>
          </div>
        )}
        <div className="flex justify-between text-white text-xl font-bold pt-2 border-t border-white/10">
          <span>Total</span>
          <span className="tabular-nums">${data.total.toFixed(2)}</span>
        </div>
      </div>

      {/* Receipt options */}
      {!showReceipt ? (
        <div className="space-y-3 max-w-sm w-full">
          <p className="text-white/40 text-center mb-4">Would you like a receipt?</p>
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => { setShowReceipt(true); setReceiptMethod('email') }}
              className="py-4 rounded-xl bg-white/10 text-white/70 hover:bg-white/20 transition-colors"
            >
              Email
            </button>
            <button
              onClick={() => { setShowReceipt(true); setReceiptMethod('text') }}
              className="py-4 rounded-xl bg-white/10 text-white/70 hover:bg-white/20 transition-colors"
            >
              Text
            </button>
            <button
              onClick={() => onReceiptChoice('print')}
              className="py-4 rounded-xl bg-white/10 text-white/70 hover:bg-white/20 transition-colors"
            >
              Print
            </button>
            <button
              onClick={() => onReceiptChoice('none')}
              className="py-4 rounded-xl bg-white/5 text-white/40 hover:bg-white/10 transition-colors"
            >
              No Thanks
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
