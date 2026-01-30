// Payment Types
// Types for payment processing and simulated card reader

import type { CardType } from '@/lib/mock-cards'

/**
 * Result from simulated card reader (tap or chip)
 */
export interface SimulatedPaymentResult {
  success: boolean
  error?: string
  authCode?: string
  cardType?: CardType
  lastFour?: string
  customerName?: string  // Only available from chip card reads
}

/**
 * Props for the SimulatedCardReader component
 */
export interface SimulatedCardReaderProps {
  amount: number
  onResult: (result: SimulatedPaymentResult) => void
  disabled?: boolean
}

/**
 * Card read method type
 */
export type CardReadMethod = 'tap' | 'chip' | 'swipe'

/**
 * Processing state for card reader
 */
export type CardReaderState = 'idle' | 'processing' | 'success' | 'declined'
