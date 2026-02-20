// Multi-Surface Socket Event Types
// Defines the communication protocol between POS terminal, CFD, iPad, and Phone

// ============================================
// CUSTOMER-FACING DISPLAY (Phase 11)
// ============================================

/** POS → CFD: Show current order items */
export interface CFDShowOrderEvent {
  items: Array<{
    name: string
    quantity: number
    price: number
    modifiers?: string[]
  }>
  subtotal: number
  tax: number
  total: number
  discountTotal?: number
}

/** POS → CFD: Payment initiated, show payment screen */
export interface CFDPaymentStartedEvent {
  amount: number
  tipMode: 'device' | 'screen' | 'none'
}

/** POS → CFD: Show tip prompt on CFD screen */
export interface CFDTipPromptEvent {
  suggestions: number[] // dollar amounts or percentages
  isPercent: boolean
  orderTotal: number
  isUnderThreshold: boolean
}

/** POS → CFD: Request signature on CFD screen */
export interface CFDSignatureRequestEvent {
  amount: number
  cardLast4: string
}

/** POS → CFD: Payment processing */
export interface CFDProcessingEvent {}

/** POS → CFD: Payment approved */
export interface CFDApprovedEvent {
  last4: string
  cardType: string
  tipAmount: number
  total: number
}

/** POS → CFD: Payment declined */
export interface CFDDeclinedEvent {
  reason: string
}

/** POS → CFD: Return to idle */
export interface CFDIdleEvent {}

/** CFD → POS: Customer selected tip */
export interface CFDTipSelectedEvent {
  amount: number
  isPercent: boolean
}

/** CFD → POS: Signature completed */
export interface CFDSignatureDoneEvent {
  signatureData: string // base64 PNG
}

/** CFD → POS: Receipt delivery choice */
export interface CFDReceiptChoiceEvent {
  method: 'email' | 'text' | 'print' | 'none'
  contact?: string // email or phone
}

// Socket event name constants
export const CFD_EVENTS = {
  // POS → CFD
  SHOW_ORDER: 'cfd:show-order',
  PAYMENT_STARTED: 'cfd:payment-started',
  TIP_PROMPT: 'cfd:tip-prompt',
  SIGNATURE_REQUEST: 'cfd:signature-request',
  PROCESSING: 'cfd:processing',
  APPROVED: 'cfd:approved',
  DECLINED: 'cfd:declined',
  IDLE: 'cfd:idle',
  RECEIPT_SENT: 'cfd:receipt-sent',
  // CFD → POS
  TIP_SELECTED: 'cfd:tip-selected',
  SIGNATURE_DONE: 'cfd:signature-done',
  RECEIPT_CHOICE: 'cfd:receipt-choice',
} as const

// CFD screen states
export type CFDScreenState = 'idle' | 'order' | 'payment' | 'tip' | 'signature' | 'processing' | 'approved' | 'declined'

// ============================================
// PAY-AT-TABLE (Phase 12)
// ============================================

/** Server iPad → POS: Request to close tab tableside */
export interface PayAtTableRequestEvent {
  orderId: string
  readerId: string // iPad's bound reader
  tipMode: 'device' | 'screen'
  employeeId: string
}

/** POS → iPad: Payment result */
export interface PayAtTableResultEvent {
  orderId: string
  success: boolean
  amount: number
  tipAmount?: number
  cardLast4?: string
  error?: string
}

export const PAT_EVENTS = {
  PAY_REQUEST: 'pat:pay-request',
  PAY_RESULT: 'pat:pay-result',
  SPLIT_REQUEST: 'pat:split-request',
  SPLIT_RESULT: 'pat:split-result',
} as const

// ============================================
// BARTENDER MOBILE (Phase 13)
// ============================================

/** Phone → Terminal: Request to close tab */
export interface TabCloseRequestEvent {
  orderId: string
  tipMode: 'device' | 'receipt'
  employeeId: string
}

/** Terminal → Phone: Tab closed result */
export interface TabClosedEvent {
  orderId: string
  success: boolean
  amount: number
  tipAmount?: number
  error?: string
}

/** Terminal → Phone: Tab status update */
export interface TabStatusUpdateEvent {
  orderId: string
  status: string // pending_auth | open | no_card | closed
  tabName?: string
  total?: number
}

export const MOBILE_EVENTS = {
  TAB_CLOSE_REQUEST: 'tab:close-request',
  TAB_CLOSED: 'tab:closed',
  TAB_STATUS_UPDATE: 'tab:status-update',
  TAB_TRANSFER_REQUEST: 'tab:transfer-request',
  TAB_ALERT_MANAGER: 'tab:alert-manager',
} as const
