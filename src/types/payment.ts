// Payment Types
// Types for payment processing and Datacap card reader integration

/**
 * Card read method type
 */
export type CardReadMethod = 'tap' | 'chip' | 'swipe'

/**
 * Processing state for card reader
 */
export type CardReaderState = 'idle' | 'processing' | 'success' | 'declined'
