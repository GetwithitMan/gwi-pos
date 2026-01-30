'use client'

import { useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { useDevStore } from '@/stores/dev-store'
import { getRandomCard, delay, randomBetween, generateAuthCode } from '@/lib/mock-cards'
import type { SimulatedPaymentResult, SimulatedCardReaderProps, CardReaderState } from '@/types/payment'

// Contactless/Tap icon
function ContactlessIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 9a9 9 0 0 1 6 3 9 9 0 0 1 6-3" />
      <path d="M6 5a13 13 0 0 1 6 3 13 13 0 0 1 6-3" />
      <path d="M6 13a5 5 0 0 1 6 3 5 5 0 0 1 6-3" />
      <line x1="12" y1="19" x2="12" y2="19.01" />
    </svg>
  )
}

// Chip card icon
function ChipIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <rect x="6" y="8" width="4" height="8" />
      <line x1="10" y1="10" x2="14" y2="10" />
      <line x1="10" y1="12" x2="18" y2="12" />
      <line x1="10" y1="14" x2="16" y2="14" />
    </svg>
  )
}

// Loading spinner
function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={`animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  )
}

export function SimulatedCardReader({
  amount,
  onResult,
  disabled = false
}: SimulatedCardReaderProps) {
  const [state, setState] = useState<CardReaderState>('idle')
  const [statusMessage, setStatusMessage] = useState<string>('')

  // Get dev access state from store
  const { hasDevAccess, isDevMode } = useDevStore()

  // Show for Super Admin (hasDevAccess) OR in development environment
  const canShowDevFeatures = hasDevAccess || isDevMode

  // Handler for tap card (contactless - fast, no name)
  const handleTapCard = useCallback(async () => {
    if (disabled || state === 'processing') return

    setState('processing')
    setStatusMessage('Reading card...')

    // Tap is quick: 500-1500ms
    await delay(randomBetween(500, 1500))

    const card = getRandomCard()

    if (card.shouldDecline) {
      setState('declined')
      setStatusMessage('Card declined')
      onResult({
        success: false,
        error: 'Card declined'
      })

      // Reset after showing declined state
      setTimeout(() => {
        setState('idle')
        setStatusMessage('')
      }, 2000)
    } else {
      setState('success')
      setStatusMessage('Approved')
      onResult({
        success: true,
        authCode: generateAuthCode(),
        cardType: card.cardType,
        lastFour: card.lastFour,
        // Tap does NOT return customer name
      })

      // Reset after showing success state
      setTimeout(() => {
        setState('idle')
        setStatusMessage('')
      }, 1500)
    }
  }, [disabled, state, onResult])

  // Handler for chip card (slower, includes customer name)
  const handleChipCard = useCallback(async () => {
    if (disabled || state === 'processing') return

    setState('processing')
    setStatusMessage('Reading chip...')

    // Chip is slower: 1500-3000ms
    await delay(randomBetween(1500, 3000))

    const card = getRandomCard()

    if (card.shouldDecline) {
      setState('declined')
      setStatusMessage('Card declined')
      onResult({
        success: false,
        error: 'Card declined'
      })

      // Reset after showing declined state
      setTimeout(() => {
        setState('idle')
        setStatusMessage('')
      }, 2000)
    } else {
      setState('success')
      setStatusMessage('Approved')
      onResult({
        success: true,
        authCode: generateAuthCode(),
        cardType: card.cardType,
        lastFour: card.lastFour,
        customerName: `${card.firstName} ${card.lastName}`, // Chip returns name
      })

      // Reset after showing success state
      setTimeout(() => {
        setState('idle')
        setStatusMessage('')
      }, 1500)
    }
  }, [disabled, state, onResult])

  // Only render for Super Admin or in development mode
  if (!canShowDevFeatures) return null

  // State-based styling
  const getStateStyles = () => {
    switch (state) {
      case 'processing':
        return 'border-blue-500/50 bg-blue-500/5'
      case 'success':
        return 'border-green-500/50 bg-green-500/10 animate-pulse'
      case 'declined':
        return 'border-red-500/50 bg-red-500/10 animate-pulse'
      default:
        return 'border-amber-500/30 bg-amber-500/5'
    }
  }

  return (
    <div
      className={`
        relative rounded-lg border-2 border-dashed p-4
        backdrop-blur-sm transition-all duration-300
        ${getStateStyles()}
      `}
    >
      {/* DEV badge */}
      <div className="absolute -top-2 -right-2 px-2 py-0.5 bg-amber-500 text-amber-950 text-[10px] font-bold rounded-full uppercase tracking-wider">
        DEV
      </div>

      {/* Header */}
      <div className="text-center mb-3">
        <p className="text-xs font-medium text-amber-600/80 uppercase tracking-wider">
          Simulated Card Reader
        </p>
        {amount > 0 && (
          <p className="text-sm text-white/60 mt-1">
            Amount: ${amount.toFixed(2)}
          </p>
        )}
      </div>

      {/* Processing state */}
      {state === 'processing' && (
        <div className="flex items-center justify-center gap-2 mb-3 text-blue-400">
          <Spinner className="w-4 h-4" />
          <span className="text-sm">{statusMessage}</span>
        </div>
      )}

      {/* Success state */}
      {state === 'success' && (
        <div className="flex items-center justify-center gap-2 mb-3 text-green-400">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <span className="text-sm font-medium">{statusMessage}</span>
        </div>
      )}

      {/* Declined state */}
      {state === 'declined' && (
        <div className="flex items-center justify-center gap-2 mb-3 text-red-400">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
          <span className="text-sm font-medium">{statusMessage}</span>
        </div>
      )}

      {/* Buttons */}
      <div className="flex gap-3">
        <Button
          onClick={handleTapCard}
          disabled={disabled || state === 'processing'}
          variant="outline"
          className={`
            flex-1 h-14 flex flex-col items-center justify-center gap-1
            border-white/20 bg-white/5 hover:bg-white/10
            disabled:opacity-50 disabled:cursor-not-allowed
            transition-all duration-200
          `}
        >
          <ContactlessIcon className="w-5 h-5" />
          <span className="text-xs">Tap Card</span>
        </Button>

        <Button
          onClick={handleChipCard}
          disabled={disabled || state === 'processing'}
          variant="outline"
          className={`
            flex-1 h-14 flex flex-col items-center justify-center gap-1
            border-white/20 bg-white/5 hover:bg-white/10
            disabled:opacity-50 disabled:cursor-not-allowed
            transition-all duration-200
          `}
        >
          <ChipIcon className="w-5 h-5" />
          <span className="text-xs">Chip Card</span>
        </Button>
      </div>

      {/* Hint */}
      <p className="text-[10px] text-white/40 text-center mt-2">
        ~5% random decline rate for testing
      </p>
    </div>
  )
}

export default SimulatedCardReader
