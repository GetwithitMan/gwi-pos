// Payment Types
// Types for payment processing and Datacap card reader integration

import type { CardType } from '@/lib/mock-cards'

/**
 * Result from simulated card reader (tap or chip)
 * Used by the simulated Datacap reader API routes
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
 * Card read method type
 */
export type CardReadMethod = 'tap' | 'chip' | 'swipe'

/**
 * Processing state for card reader
 */
export type CardReaderState = 'idle' | 'processing' | 'success' | 'declined'
