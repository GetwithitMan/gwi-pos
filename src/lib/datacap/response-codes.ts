/**
 * Datacap Response Code Mapping
 *
 * Comprehensive mapping of ALL Datacap DSIX return codes, CmdStatus values,
 * and processor decline reasons to human-readable messages.
 *
 * SECURITY NOTE: Some decline reasons have DIFFERENT messages for staff vs customer.
 * Staff sees the real reason (e.g., "Lost/Stolen Card") while the customer sees a
 * generic message (e.g., "Card cannot be processed."). This prevents tipping off
 * a bad actor that their card has been flagged.
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DeclineInfo {
  /** Full reason visible to staff/manager only */
  staffMessage: string
  /** Safe message to show on customer-facing display or receipt */
  customerMessage: string
  /** Whether the transaction can be retried (same card, same amount) */
  isRetryable: boolean
}

export interface ResponseCodeEntry {
  /** Short label (e.g., "Approved", "Declined") */
  label: string
  /** Longer description for logs/admin */
  description: string
  /** Staff-facing message */
  staffMessage: string
  /** Customer-safe message */
  customerMessage: string
  /** Whether a retry is reasonable */
  isRetryable: boolean
  /** Category for grouping: approval, decline, error, device, communication, config, batch */
  category: 'approval' | 'decline' | 'error' | 'device' | 'communication' | 'config' | 'batch'
}

// ─── DSIX Return Codes ──────────────────────────────────────────────────────
// From the Datacap dsiEMV / DSIX specification.
// Format: 6-digit string. Leading zeros matter.
//
// 000xxx = Approvals
// 001xxx = Issuer declines
// 002xxx = Processing errors
// 003xxx = Device/communication errors
// 004xxx = Configuration errors
// 005xxx = Batch errors

export const DSIX_RETURN_CODES: Record<string, ResponseCodeEntry> = {
  // ── Approvals (000xxx) ──────────────────────────────────────────────────
  '000000': {
    label: 'Approved',
    description: 'Transaction approved by issuer',
    staffMessage: 'Approved',
    customerMessage: 'Approved',
    isRetryable: false,
    category: 'approval',
  },
  '000001': {
    label: 'Partial Approval',
    description: 'Approved for less than the requested amount — remaining balance must be collected via another payment method',
    staffMessage: 'Partial approval — collect remaining balance with another payment method',
    customerMessage: 'Card approved for partial amount. Please provide another payment method for the remaining balance.',
    isRetryable: false,
    category: 'approval',
  },
  '000002': {
    label: 'Approved (No Duplicate)',
    description: 'Approved with duplicate check passed',
    staffMessage: 'Approved — no duplicate detected',
    customerMessage: 'Approved',
    isRetryable: false,
    category: 'approval',
  },
  '000003': {
    label: 'Approved (VIP)',
    description: 'Approved with VIP status from issuer',
    staffMessage: 'Approved (VIP customer)',
    customerMessage: 'Approved',
    isRetryable: false,
    category: 'approval',
  },
  '000004': {
    label: 'Approved (ID Required)',
    description: 'Approved but issuer requests ID verification',
    staffMessage: 'Approved — verify customer ID',
    customerMessage: 'Approved',
    isRetryable: false,
    category: 'approval',
  },
  '000005': {
    label: 'Approved (Partial ID Match)',
    description: 'Approved with partial address verification match',
    staffMessage: 'Approved — partial AVS match',
    customerMessage: 'Approved',
    isRetryable: false,
    category: 'approval',
  },
  '000006': {
    label: 'Approved (Offline)',
    description: 'Approved offline by the terminal (SAF mode)',
    staffMessage: 'Approved offline — will upload when connectivity restored',
    customerMessage: 'Approved',
    isRetryable: false,
    category: 'approval',
  },
  '000010': {
    label: 'Approved (Level II)',
    description: 'Approved with Level II data accepted — lower interchange rate',
    staffMessage: 'Approved — Level II data accepted (lower interchange)',
    customerMessage: 'Approved',
    isRetryable: false,
    category: 'approval',
  },
  '000099': {
    label: 'Approved (Generic)',
    description: 'Generic approval — issuer did not provide a specific code',
    staffMessage: 'Approved',
    customerMessage: 'Approved',
    isRetryable: false,
    category: 'approval',
  },

  // ── Issuer Declines (001xxx) ────────────────────────────────────────────
  '001001': {
    label: 'Declined',
    description: 'Generic decline from issuer — no specific reason given',
    staffMessage: 'Declined by issuing bank — no specific reason',
    customerMessage: 'Card declined. Please try another payment method.',
    isRetryable: false,
    category: 'decline',
  },
  '001002': {
    label: 'Declined - Refer to Issuer',
    description: 'Issuer wants a voice authorization call',
    staffMessage: 'Declined — issuer requests voice auth. Customer should call bank.',
    customerMessage: 'Card declined. Please contact your card issuer.',
    isRetryable: false,
    category: 'decline',
  },
  '001003': {
    label: 'Invalid Merchant',
    description: 'Merchant ID not recognized by processor',
    staffMessage: 'Invalid merchant configuration — contact Datacap support',
    customerMessage: 'Unable to process payment. Please try again later.',
    isRetryable: false,
    category: 'decline',
  },
  '001004': {
    label: 'Pick Up Card',
    description: 'Issuer requests card be retained — possible fraud or reported stolen',
    staffMessage: 'PICK UP CARD — issuer flagged this card. Do NOT return it.',
    customerMessage: 'Card cannot be processed. Please use a different payment method.',
    isRetryable: false,
    category: 'decline',
  },
  '001005': {
    label: 'Do Not Honor',
    description: 'Issuer declined without giving a reason — common catch-all',
    staffMessage: 'Do Not Honor — issuer declined. Customer should call their bank.',
    customerMessage: 'Card declined by issuing bank. Please contact your bank or try another card.',
    isRetryable: false,
    category: 'decline',
  },
  '001006': {
    label: 'Error',
    description: 'Processing error at the issuer',
    staffMessage: 'Issuer processing error — retry may work',
    customerMessage: 'Unable to process payment. Please try again.',
    isRetryable: true,
    category: 'decline',
  },
  '001007': {
    label: 'Pick Up Card (Fraud)',
    description: 'Issuer flagged for fraud — card should be retained',
    staffMessage: 'FRAUD FLAG — issuer requests card pickup. Do NOT return card.',
    customerMessage: 'Card cannot be processed. Please use a different payment method.',
    isRetryable: false,
    category: 'decline',
  },
  '001010': {
    label: 'Partial Approval Only',
    description: 'Issuer will only approve a partial amount',
    staffMessage: 'Issuer only approves partial amount — remaining must be paid separately',
    customerMessage: 'Card can only be approved for a partial amount.',
    isRetryable: false,
    category: 'decline',
  },
  '001012': {
    label: 'Invalid Transaction',
    description: 'Transaction type not allowed for this card',
    staffMessage: 'Invalid transaction type for this card — try a different transaction method',
    customerMessage: 'This transaction type is not supported for your card. Please try another card.',
    isRetryable: false,
    category: 'decline',
  },
  '001013': {
    label: 'Invalid Amount',
    description: 'Amount exceeds allowed limits or is zero/negative',
    staffMessage: 'Invalid amount — check total and retry',
    customerMessage: 'Unable to process this amount. Please verify and try again.',
    isRetryable: true,
    category: 'decline',
  },
  '001014': {
    label: 'Invalid Card Number',
    description: 'Card number does not pass Luhn check or is unknown BIN',
    staffMessage: 'Invalid card number — re-enter or use different card',
    customerMessage: 'Card number is invalid. Please re-enter or use a different card.',
    isRetryable: true,
    category: 'decline',
  },
  '001015': {
    label: 'No Such Issuer',
    description: 'Card BIN not recognized — network routing failure',
    staffMessage: 'Card issuer not found — card may be unsupported',
    customerMessage: 'Card cannot be processed. Please use a different card.',
    isRetryable: false,
    category: 'decline',
  },
  '001019': {
    label: 'Re-Enter Transaction',
    description: 'Temporary issue — processor requests retry',
    staffMessage: 'Processor requests retry — try again',
    customerMessage: 'Please try again.',
    isRetryable: true,
    category: 'decline',
  },
  '001025': {
    label: 'Record Not Found',
    description: 'Record/token not found for void/capture operation',
    staffMessage: 'Record not found — original transaction may have already been voided or settled',
    customerMessage: 'Unable to process. Please contact staff.',
    isRetryable: false,
    category: 'decline',
  },
  '001028': {
    label: 'File Temporarily Unavailable',
    description: 'Processor file system temporarily down',
    staffMessage: 'Processor temporarily unavailable — retry in a few minutes',
    customerMessage: 'Payment system temporarily unavailable. Please try again in a moment.',
    isRetryable: true,
    category: 'decline',
  },
  '001041': {
    label: 'Lost Card',
    description: 'Card reported lost by cardholder',
    staffMessage: 'LOST CARD — card reported lost. Do NOT return card to customer.',
    customerMessage: 'Card cannot be processed. Please use a different payment method.',
    isRetryable: false,
    category: 'decline',
  },
  '001043': {
    label: 'Stolen Card',
    description: 'Card reported stolen',
    staffMessage: 'STOLEN CARD — card reported stolen. Do NOT return card to customer.',
    customerMessage: 'Card cannot be processed. Please use a different payment method.',
    isRetryable: false,
    category: 'decline',
  },
  '001051': {
    label: 'Insufficient Funds',
    description: 'Card does not have enough available balance',
    staffMessage: 'Insufficient funds — customer should try a smaller amount or different card',
    customerMessage: 'Card declined: insufficient funds. Please try another payment method.',
    isRetryable: false,
    category: 'decline',
  },
  '001054': {
    label: 'Expired Card',
    description: 'Card is past its expiration date',
    staffMessage: 'Card expired — customer needs a new card',
    customerMessage: 'Card is expired. Please use a different card.',
    isRetryable: false,
    category: 'decline',
  },
  '001055': {
    label: 'Invalid PIN',
    description: 'PIN entered incorrectly',
    staffMessage: 'Invalid PIN — customer can retry with correct PIN',
    customerMessage: 'Incorrect PIN. Please try again.',
    isRetryable: true,
    category: 'decline',
  },
  '001057': {
    label: 'Transaction Not Permitted',
    description: 'Transaction type not allowed for this cardholder',
    staffMessage: 'Transaction not permitted for this card — customer should call bank',
    customerMessage: 'This transaction is not permitted on your card. Please contact your bank.',
    isRetryable: false,
    category: 'decline',
  },
  '001058': {
    label: 'Transaction Not Permitted (Terminal)',
    description: 'Transaction not allowed at this terminal type',
    staffMessage: 'Transaction not permitted at this terminal — contact Datacap support',
    customerMessage: 'Unable to process payment at this terminal. Please try another terminal.',
    isRetryable: false,
    category: 'decline',
  },
  '001059': {
    label: 'Suspected Fraud',
    description: 'Issuer fraud detection triggered',
    staffMessage: 'SUSPECTED FRAUD — issuer flagged transaction. Customer should call bank.',
    customerMessage: 'Card declined. Please contact your card issuer.',
    isRetryable: false,
    category: 'decline',
  },
  '001061': {
    label: 'Exceeds Withdrawal Limit',
    description: 'Transaction exceeds daily withdrawal limit',
    staffMessage: 'Exceeds withdrawal limit — customer can try smaller amount or different card',
    customerMessage: 'Transaction exceeds your daily limit. Please try a smaller amount or different card.',
    isRetryable: false,
    category: 'decline',
  },
  '001062': {
    label: 'Restricted Card',
    description: 'Card restricted by issuer (geographic, merchant category, etc.)',
    staffMessage: 'Restricted card — issuer blocked this card type/merchant. Customer should call bank.',
    customerMessage: 'Card restricted by issuer. Please contact your bank or use a different card.',
    isRetryable: false,
    category: 'decline',
  },
  '001063': {
    label: 'Security Violation',
    description: 'Security violation detected by issuer',
    staffMessage: 'Security violation — possible tampered card. Customer should call bank.',
    customerMessage: 'Card declined. Please contact your card issuer.',
    isRetryable: false,
    category: 'decline',
  },
  '001065': {
    label: 'Over Limit',
    description: 'Card has exceeded its credit limit',
    staffMessage: 'Credit limit exceeded — customer should use a different card',
    customerMessage: 'Card declined: credit limit exceeded. Please use a different card.',
    isRetryable: false,
    category: 'decline',
  },
  '001075': {
    label: 'PIN Tries Exceeded',
    description: 'Too many incorrect PIN attempts — card locked',
    staffMessage: 'PIN tries exceeded — card is locked. Customer must call bank.',
    customerMessage: 'Too many incorrect PIN attempts. Please contact your bank.',
    isRetryable: false,
    category: 'decline',
  },
  '001076': {
    label: 'Unable to Locate Record',
    description: 'Original transaction not found for reversal/void',
    staffMessage: 'Original transaction not found — may have already been voided or expired',
    customerMessage: 'Unable to process. Please contact staff.',
    isRetryable: false,
    category: 'decline',
  },
  '001078': {
    label: 'Deactivated Card',
    description: 'Card has been deactivated or not yet activated',
    staffMessage: 'Card deactivated or not yet activated — customer should call bank',
    customerMessage: 'Card is not active. Please contact your card issuer or use a different card.',
    isRetryable: false,
    category: 'decline',
  },
  '001091': {
    label: 'Issuer Unavailable',
    description: 'Could not reach the card issuer for authorization',
    staffMessage: 'Issuer unavailable — retry in a minute, or try a different card',
    customerMessage: 'Unable to reach your card issuer. Please try again or use a different card.',
    isRetryable: true,
    category: 'decline',
  },
  '001096': {
    label: 'System Malfunction',
    description: 'Processing network system error',
    staffMessage: 'Network system malfunction — retry may work',
    customerMessage: 'Payment system error. Please try again.',
    isRetryable: true,
    category: 'decline',
  },
  '001099': {
    label: 'Duplicate Transaction',
    description: 'Same card, amount, and time detected — possible double-charge prevention',
    staffMessage: 'Duplicate transaction detected — verify it is intentional before overriding',
    customerMessage: 'This appears to be a duplicate transaction.',
    isRetryable: false,
    category: 'decline',
  },

  // ── Processing Errors (002xxx) ──────────────────────────────────────────
  '002001': {
    label: 'Processing Error',
    description: 'Generic processing error at Datacap or processor',
    staffMessage: 'Processing error — retry the transaction',
    customerMessage: 'Unable to process payment. Please try again.',
    isRetryable: true,
    category: 'error',
  },
  '002002': {
    label: 'Invalid Data',
    description: 'Request contained invalid or malformed data',
    staffMessage: 'Invalid transaction data — check amount and card info',
    customerMessage: 'Unable to process payment. Please try again.',
    isRetryable: true,
    category: 'error',
  },
  '002003': {
    label: 'Record Not Found',
    description: 'Referenced record/token does not exist',
    staffMessage: 'Transaction record not found — original may have been voided or batched',
    customerMessage: 'Unable to process. Please contact staff.',
    isRetryable: false,
    category: 'error',
  },
  '002004': {
    label: 'Duplicate Record',
    description: 'Attempting to create a record that already exists',
    staffMessage: 'Duplicate record — transaction may have already been processed',
    customerMessage: 'This transaction may have already been processed.',
    isRetryable: false,
    category: 'error',
  },
  '002005': {
    label: 'Format Error',
    description: 'XML/data format error in request',
    staffMessage: 'Data format error — POS software issue, contact support',
    customerMessage: 'Payment system error. Please try again.',
    isRetryable: false,
    category: 'error',
  },
  '002010': {
    label: 'Void Not Allowed',
    description: 'Transaction cannot be voided (already settled or captured)',
    staffMessage: 'Cannot void — transaction already settled. Use refund instead.',
    customerMessage: 'Unable to process void. Please contact staff.',
    isRetryable: false,
    category: 'error',
  },
  '002011': {
    label: 'Reversal Not Allowed',
    description: 'Reversal not supported for this transaction type',
    staffMessage: 'Reversal not allowed for this transaction type',
    customerMessage: 'Unable to process reversal. Please contact staff.',
    isRetryable: false,
    category: 'error',
  },
  '002020': {
    label: 'Amount Mismatch',
    description: 'Void/capture amount does not match original authorization',
    staffMessage: 'Amount mismatch with original authorization — verify amounts',
    customerMessage: 'Unable to process. Please contact staff.',
    isRetryable: false,
    category: 'error',
  },
  '002099': {
    label: 'Unknown Processing Error',
    description: 'Unclassified processing error',
    staffMessage: 'Unknown processing error — retry or contact Datacap support',
    customerMessage: 'Payment error. Please try again.',
    isRetryable: true,
    category: 'error',
  },

  // ── Device / Communication Errors (003xxx) ─────────────────────────────
  '003001': {
    label: 'Device Not Ready',
    description: 'Payment reader is not ready (booting, updating, etc.)',
    staffMessage: 'Reader not ready — wait a moment and retry',
    customerMessage: 'Payment terminal is starting up. Please wait a moment.',
    isRetryable: true,
    category: 'device',
  },
  '003002': {
    label: 'Device Busy',
    description: 'Reader is already processing another transaction',
    staffMessage: 'Reader busy with another transaction — wait for it to complete',
    customerMessage: 'Terminal is busy. Please wait.',
    isRetryable: true,
    category: 'device',
  },
  '003003': {
    label: 'Device Error',
    description: 'Hardware error on the payment reader',
    staffMessage: 'Reader hardware error — try pad reset, then reboot if needed',
    customerMessage: 'Terminal error. Please try again.',
    isRetryable: true,
    category: 'device',
  },
  '003004': {
    label: 'Device Not Found',
    description: 'Could not communicate with the payment reader at configured address',
    staffMessage: 'Reader not reachable — check network/USB connection and reader power',
    customerMessage: 'Payment terminal unavailable. Please try again.',
    isRetryable: true,
    category: 'device',
  },
  '003005': {
    label: 'Card Read Error',
    description: 'Could not read card data from chip, tap, or swipe',
    staffMessage: 'Card read error — have customer try inserting/tapping again, or swipe',
    customerMessage: 'Could not read card. Please try again.',
    isRetryable: true,
    category: 'device',
  },
  '003006': {
    label: 'Transaction Timeout',
    description: 'Transaction timed out waiting for card or processor response',
    staffMessage: 'Timeout — customer took too long or processor didn\'t respond. Retry.',
    customerMessage: 'Transaction timed out. Please try again.',
    isRetryable: true,
    category: 'device',
  },
  '003007': {
    label: 'Transaction Cancelled',
    description: 'Transaction cancelled by operator or customer pressing cancel',
    staffMessage: 'Transaction cancelled',
    customerMessage: 'Transaction cancelled.',
    isRetryable: false,
    category: 'device',
  },
  '003008': {
    label: 'Card Removed Early',
    description: 'Card was removed from reader before transaction completed',
    staffMessage: 'Card removed too early — have customer leave card until prompted',
    customerMessage: 'Please leave card inserted until the transaction is complete.',
    isRetryable: true,
    category: 'device',
  },
  '003009': {
    label: 'Chip Fallback Required',
    description: 'Chip read failed — terminal is requesting swipe fallback',
    staffMessage: 'Chip read failed — ask customer to swipe instead',
    customerMessage: 'Please try swiping your card instead.',
    isRetryable: true,
    category: 'device',
  },
  '003010': {
    label: 'Contactless Limit Exceeded',
    description: 'Tap amount exceeds contactless limit — insert chip instead',
    staffMessage: 'Contactless limit exceeded — customer must insert chip',
    customerMessage: 'Amount exceeds tap limit. Please insert your card.',
    isRetryable: true,
    category: 'device',
  },
  '003020': {
    label: 'Communication Error',
    description: 'Network communication failure between POS and reader',
    staffMessage: 'Communication error with reader — check network and retry',
    customerMessage: 'Terminal communication error. Please try again.',
    isRetryable: true,
    category: 'communication',
  },
  '003021': {
    label: 'Host Unreachable',
    description: 'Could not reach the Datacap cloud or processor host',
    staffMessage: 'Processor host unreachable — check internet connectivity',
    customerMessage: 'Payment system temporarily unavailable. Please try again.',
    isRetryable: true,
    category: 'communication',
  },
  '003022': {
    label: 'Connection Timeout',
    description: 'Connection to processor timed out',
    staffMessage: 'Processor connection timeout — check internet and retry',
    customerMessage: 'Connection timed out. Please try again.',
    isRetryable: true,
    category: 'communication',
  },
  '003023': {
    label: 'SSL/TLS Error',
    description: 'Secure connection failed to Datacap cloud',
    staffMessage: 'SSL/TLS error — verify system clock and certificates',
    customerMessage: 'Secure connection error. Please try again.',
    isRetryable: true,
    category: 'communication',
  },
  '003024': {
    label: 'DNS Resolution Failed',
    description: 'Could not resolve Datacap cloud hostname',
    staffMessage: 'DNS resolution failed — check internet connectivity and DNS settings',
    customerMessage: 'Network error. Please try again.',
    isRetryable: true,
    category: 'communication',
  },

  // ── Configuration Errors (004xxx) ───────────────────────────────────────
  '004001': {
    label: 'Invalid Merchant ID',
    description: 'Merchant ID not recognized by Datacap',
    staffMessage: 'Invalid merchant ID — check Datacap configuration in settings',
    customerMessage: 'Payment system configuration error. Please contact staff.',
    isRetryable: false,
    category: 'config',
  },
  '004002': {
    label: 'Invalid Terminal ID',
    description: 'Terminal ID not configured or recognized',
    staffMessage: 'Invalid terminal ID — reconfigure reader in settings',
    customerMessage: 'Terminal not configured. Please contact staff.',
    isRetryable: false,
    category: 'config',
  },
  '004003': {
    label: 'Param Download Required',
    description: 'Reader needs EMVParamDownload before processing transactions',
    staffMessage: 'Reader needs parameter download — run EMVParamDownload from settings',
    customerMessage: 'Terminal setup required. Please contact staff.',
    isRetryable: false,
    category: 'config',
  },
  '004004': {
    label: 'Invalid POS Package ID',
    description: 'POS software identifier not recognized by Datacap',
    staffMessage: 'Invalid POS package ID — contact Datacap support',
    customerMessage: 'Payment system error. Please contact staff.',
    isRetryable: false,
    category: 'config',
  },
  '004005': {
    label: 'Unsupported Operation',
    description: 'Transaction type not supported by this terminal or merchant configuration',
    staffMessage: 'Operation not supported — check terminal capabilities and merchant config',
    customerMessage: 'This operation is not supported. Please contact staff.',
    isRetryable: false,
    category: 'config',
  },

  // ── Batch Errors (005xxx) ──────────────────────────────────────────────
  '005001': {
    label: 'Batch Empty',
    description: 'No transactions in current batch to close',
    staffMessage: 'Batch is empty — no transactions to settle',
    customerMessage: 'No transactions to settle.',
    isRetryable: false,
    category: 'batch',
  },
  '005002': {
    label: 'Batch Close Error',
    description: 'Error occurred during batch settlement',
    staffMessage: 'Batch close error — retry or contact Datacap support',
    customerMessage: 'Settlement error. Please contact staff.',
    isRetryable: true,
    category: 'batch',
  },
  '005003': {
    label: 'Batch Already Closed',
    description: 'Batch has already been settled for this period',
    staffMessage: 'Batch already closed — no action needed',
    customerMessage: 'Settlement already completed.',
    isRetryable: false,
    category: 'batch',
  },
  '005004': {
    label: 'Batch Out of Balance',
    description: 'Batch totals do not match between POS and processor',
    staffMessage: 'Batch out of balance — processor totals differ from POS. Run reconciliation.',
    customerMessage: 'Settlement error. Please contact staff.',
    isRetryable: false,
    category: 'batch',
  },
}

// ─── CmdStatus Values ───────────────────────────────────────────────────────

export const CMD_STATUS_MAP: Record<string, { label: string; description: string }> = {
  'Approved': {
    label: 'Approved',
    description: 'Transaction approved by issuer / processor',
  },
  'Declined': {
    label: 'Declined',
    description: 'Transaction declined by issuer — check dsixReturnCode for reason',
  },
  'Error': {
    label: 'Error',
    description: 'Processing error — check dsixReturnCode and textResponse for details',
  },
  'Success': {
    label: 'Success',
    description: 'Administrative command completed successfully (batch close, SAF forward, pad reset, etc.)',
  },
}

// ─── Processor Decline Reason Mapping ───────────────────────────────────────
// Maps textResponse strings from the processor to staff/customer messages.
// These are the free-text reasons returned in DatacapResponse.textResponse.
// The staff message is the full truth; the customer message is sanitized.

const PROCESSOR_DECLINE_MAP: Record<string, DeclineInfo> = {
  // Common declines
  'INSUFFICIENT FUNDS': {
    staffMessage: 'Insufficient funds',
    customerMessage: 'Card declined: insufficient funds. Please try another payment method.',
    isRetryable: false,
  },
  'INSUFF FUNDS': {
    staffMessage: 'Insufficient funds',
    customerMessage: 'Card declined: insufficient funds. Please try another payment method.',
    isRetryable: false,
  },
  'DO NOT HONOR': {
    staffMessage: 'Do Not Honor — issuer declined without specific reason',
    customerMessage: 'Card declined by issuing bank. Please contact your bank or try another card.',
    isRetryable: false,
  },
  'DECLINED': {
    staffMessage: 'Declined — generic issuer decline',
    customerMessage: 'Card declined. Please try another payment method.',
    isRetryable: false,
  },
  'DECLINE': {
    staffMessage: 'Declined — generic issuer decline',
    customerMessage: 'Card declined. Please try another payment method.',
    isRetryable: false,
  },

  // Card status declines
  'EXPIRED CARD': {
    staffMessage: 'Card expired',
    customerMessage: 'Card is expired. Please use a different card.',
    isRetryable: false,
  },
  'INVALID CARD': {
    staffMessage: 'Invalid card number',
    customerMessage: 'Card number is invalid. Please re-enter or use a different card.',
    isRetryable: true,
  },
  'INVALID CARD NUMBER': {
    staffMessage: 'Invalid card number',
    customerMessage: 'Card number is invalid. Please re-enter or use a different card.',
    isRetryable: true,
  },
  'INVALID ACCT': {
    staffMessage: 'Invalid account number',
    customerMessage: 'Card number is invalid. Please use a different card.',
    isRetryable: false,
  },

  // Security-sensitive declines (staff sees truth, customer gets generic)
  'SUSPECTED FRAUD': {
    staffMessage: 'SUSPECTED FRAUD — issuer fraud detection triggered',
    customerMessage: 'Card declined. Please contact your card issuer.',
    isRetryable: false,
  },
  'FRAUD': {
    staffMessage: 'FRAUD — issuer flagged transaction as fraudulent',
    customerMessage: 'Card declined. Please contact your card issuer.',
    isRetryable: false,
  },
  'RESTRICTED CARD': {
    staffMessage: 'Restricted card — issuer blocked this card',
    customerMessage: 'Card restricted by issuer. Please contact your bank or use a different card.',
    isRetryable: false,
  },
  'LOST CARD': {
    staffMessage: 'LOST CARD — card reported lost by cardholder',
    customerMessage: 'Card cannot be processed. Please use a different payment method.',
    isRetryable: false,
  },
  'LOST/STOLEN CARD': {
    staffMessage: 'LOST/STOLEN CARD — card reported lost or stolen',
    customerMessage: 'Card cannot be processed. Please use a different payment method.',
    isRetryable: false,
  },
  'STOLEN CARD': {
    staffMessage: 'STOLEN CARD — card reported stolen',
    customerMessage: 'Card cannot be processed. Please use a different payment method.',
    isRetryable: false,
  },
  'PICK UP CARD': {
    staffMessage: 'PICK UP CARD — issuer requests card retention',
    customerMessage: 'Card cannot be processed. Please use a different payment method.',
    isRetryable: false,
  },
  'PICKUP CARD': {
    staffMessage: 'PICKUP CARD — issuer requests card retention',
    customerMessage: 'Card cannot be processed. Please use a different payment method.',
    isRetryable: false,
  },
  'SECURITY VIOLATION': {
    staffMessage: 'Security violation — possible tampered card',
    customerMessage: 'Card declined. Please contact your card issuer.',
    isRetryable: false,
  },

  // Limit declines
  'OVER LIMIT': {
    staffMessage: 'Credit limit exceeded',
    customerMessage: 'Card declined: credit limit exceeded. Please use a different card.',
    isRetryable: false,
  },
  'EXCEEDS LIMIT': {
    staffMessage: 'Transaction exceeds card limit',
    customerMessage: 'Card declined: limit exceeded. Please try a smaller amount or different card.',
    isRetryable: false,
  },
  'EXCEEDS WITHDRAWAL LIMIT': {
    staffMessage: 'Exceeds daily withdrawal limit',
    customerMessage: 'Transaction exceeds daily limit. Please try a smaller amount or different card.',
    isRetryable: false,
  },

  // PIN declines
  'INVALID PIN': {
    staffMessage: 'Invalid PIN entered',
    customerMessage: 'Incorrect PIN. Please try again.',
    isRetryable: true,
  },
  'PIN TRIES EXCEEDED': {
    staffMessage: 'Too many incorrect PIN attempts — card locked',
    customerMessage: 'Too many incorrect PIN attempts. Please contact your bank.',
    isRetryable: false,
  },
  'ALLOWABLE PIN TRIES EXCEEDED': {
    staffMessage: 'PIN tries exceeded — card locked by issuer',
    customerMessage: 'Too many incorrect PIN attempts. Please contact your bank.',
    isRetryable: false,
  },

  // Transaction not allowed
  'TRANSACTION NOT PERMITTED': {
    staffMessage: 'Transaction not permitted for this card/terminal',
    customerMessage: 'This transaction is not permitted on your card. Please try another card.',
    isRetryable: false,
  },
  'TRANSACTION NOT ALLOWED': {
    staffMessage: 'Transaction not allowed — card or terminal restriction',
    customerMessage: 'This transaction is not allowed. Please try another card.',
    isRetryable: false,
  },
  'INVALID TRANSACTION': {
    staffMessage: 'Invalid transaction type for this card',
    customerMessage: 'This transaction type is not supported. Please try another card.',
    isRetryable: false,
  },
  'NO SUCH ISSUER': {
    staffMessage: 'Card issuer not found — unsupported card network',
    customerMessage: 'Card cannot be processed. Please use a different card.',
    isRetryable: false,
  },

  // Duplicate
  'DUPLICATE TRANSACTION': {
    staffMessage: 'Duplicate transaction detected — same card/amount/time',
    customerMessage: 'This appears to be a duplicate transaction.',
    isRetryable: false,
  },
  'DUPLICATE': {
    staffMessage: 'Duplicate transaction — may need override',
    customerMessage: 'This transaction may have already been processed.',
    isRetryable: false,
  },

  // Issuer contact required
  'REFER TO ISSUER': {
    staffMessage: 'Issuer requests voice authorization',
    customerMessage: 'Please contact your card issuer.',
    isRetryable: false,
  },
  'CALL ISSUER': {
    staffMessage: 'Issuer requests phone call for authorization',
    customerMessage: 'Please contact your card issuer.',
    isRetryable: false,
  },
  'ISSUER UNAVAILABLE': {
    staffMessage: 'Card issuer unreachable — network issue',
    customerMessage: 'Unable to reach your card issuer. Please try again.',
    isRetryable: true,
  },

  // Card not activated/deactivated
  'CARD NOT ACTIVATED': {
    staffMessage: 'Card not yet activated',
    customerMessage: 'Card is not active. Please activate your card or use a different one.',
    isRetryable: false,
  },
  'DEACTIVATED CARD': {
    staffMessage: 'Card has been deactivated',
    customerMessage: 'Card is not active. Please use a different card.',
    isRetryable: false,
  },

  // Retry-eligible
  'RE-ENTER TRANSACTION': {
    staffMessage: 'Processor requests re-entry — retry the transaction',
    customerMessage: 'Please try again.',
    isRetryable: true,
  },
  'SYSTEM ERROR': {
    staffMessage: 'System error at processor — retry',
    customerMessage: 'Payment system error. Please try again.',
    isRetryable: true,
  },
  'SYSTEM MALFUNCTION': {
    staffMessage: 'Processor system malfunction — retry',
    customerMessage: 'Payment system error. Please try again.',
    isRetryable: true,
  },
  'HOST UNAVAILABLE': {
    staffMessage: 'Processor host unavailable — retry in a moment',
    customerMessage: 'Payment system temporarily unavailable. Please try again.',
    isRetryable: true,
  },

  // AVS declines
  'AVS MISMATCH': {
    staffMessage: 'Address verification failed — ZIP code mismatch',
    customerMessage: 'Address verification failed. Please verify your billing ZIP code.',
    isRetryable: true,
  },
  'CVV MISMATCH': {
    staffMessage: 'CVV verification failed — wrong security code',
    customerMessage: 'Security code is incorrect. Please re-enter.',
    isRetryable: true,
  },

  // Batch-related
  'BATCH EMPTY': {
    staffMessage: 'No transactions in batch to settle',
    customerMessage: 'No transactions to settle.',
    isRetryable: false,
  },
  'BATCH CLOSE ERROR': {
    staffMessage: 'Error closing batch — retry or contact support',
    customerMessage: 'Settlement error. Please try again.',
    isRetryable: true,
  },

  // Approval variants in textResponse
  'APPROVED': {
    staffMessage: 'Approved',
    customerMessage: 'Approved',
    isRetryable: false,
  },
  'APPROVAL': {
    staffMessage: 'Approved',
    customerMessage: 'Approved',
    isRetryable: false,
  },
  'PARTIAL APPROVAL': {
    staffMessage: 'Partial approval — collect remaining balance separately',
    customerMessage: 'Card approved for partial amount. Please provide another payment method for the rest.',
    isRetryable: false,
  },
}

// ─── Exported Functions ─────────────────────────────────────────────────────

/**
 * Get decline reason details for a given DSIX return code.
 *
 * Returns staff-facing and customer-safe messages, plus retry guidance.
 * Falls back to a generic decline message if the code is not recognized.
 *
 * @param returnCode - 6-digit DSIX return code string (e.g., "001051")
 * @returns DeclineInfo with staffMessage, customerMessage, and isRetryable
 */
export function getDeclineReason(returnCode: string): DeclineInfo {
  const entry = DSIX_RETURN_CODES[returnCode]
  if (entry) {
    return {
      staffMessage: entry.staffMessage,
      customerMessage: entry.customerMessage,
      isRetryable: entry.isRetryable,
    }
  }

  // Try to classify by code range
  if (returnCode.startsWith('000')) {
    return {
      staffMessage: `Approved (code: ${returnCode})`,
      customerMessage: 'Approved',
      isRetryable: false,
    }
  }
  if (returnCode.startsWith('001')) {
    return {
      staffMessage: `Declined by issuer (code: ${returnCode})`,
      customerMessage: 'Card declined. Please try another payment method.',
      isRetryable: false,
    }
  }
  if (returnCode.startsWith('002')) {
    return {
      staffMessage: `Processing error (code: ${returnCode})`,
      customerMessage: 'Unable to process payment. Please try again.',
      isRetryable: true,
    }
  }
  if (returnCode.startsWith('003')) {
    return {
      staffMessage: `Device/communication error (code: ${returnCode})`,
      customerMessage: 'Terminal error. Please try again.',
      isRetryable: true,
    }
  }
  if (returnCode.startsWith('004')) {
    return {
      staffMessage: `Configuration error (code: ${returnCode}) — contact support`,
      customerMessage: 'Payment system error. Please contact staff.',
      isRetryable: false,
    }
  }
  if (returnCode.startsWith('005')) {
    return {
      staffMessage: `Batch error (code: ${returnCode})`,
      customerMessage: 'Settlement error. Please contact staff.',
      isRetryable: false,
    }
  }

  return {
    staffMessage: `Unknown decline (code: ${returnCode})`,
    customerMessage: 'Card declined. Please try another payment method.',
    isRetryable: false,
  }
}

/**
 * Get a human-readable description combining CmdStatus and return code.
 *
 * Useful for log messages, admin panels, and debugging.
 *
 * @param cmdStatus - "Approved", "Declined", "Error", or "Success"
 * @param returnCode - 6-digit DSIX return code string
 * @returns Combined description string
 */
export function getResponseDescription(cmdStatus: string, returnCode: string): string {
  const statusInfo = CMD_STATUS_MAP[cmdStatus]
  const codeEntry = DSIX_RETURN_CODES[returnCode]

  if (codeEntry) {
    return `${statusInfo?.label || cmdStatus}: ${codeEntry.label} — ${codeEntry.description}`
  }

  if (statusInfo) {
    return `${statusInfo.label}: Return code ${returnCode}`
  }

  return `${cmdStatus}: Return code ${returnCode}`
}

/**
 * Look up a processor decline reason by textResponse string.
 *
 * Datacap returns free-text decline reasons in the textResponse field
 * (e.g., "INSUFFICIENT FUNDS", "DO NOT HONOR"). This function maps
 * those strings to structured staff/customer messages.
 *
 * SECURITY: Some reasons (Lost Card, Stolen Card, Pick Up Card) return
 * generic customer messages to avoid tipping off bad actors.
 *
 * @param textResponse - Free-text response from processor (case-insensitive lookup)
 * @returns DeclineInfo or null if no match found
 */
export function getDeclineReasonFromText(textResponse: string): DeclineInfo | null {
  if (!textResponse) return null
  const normalized = textResponse.toUpperCase().trim()
  return PROCESSOR_DECLINE_MAP[normalized] || null
}

/**
 * Format a partial approval message for display.
 *
 * When a card is approved for less than the requested amount (partial approval),
 * the remaining balance must be collected via another payment method.
 *
 * @param requestedAmount - Original amount requested (e.g., 50.00)
 * @param approvedAmount - Amount actually approved by issuer (e.g., 35.00)
 * @returns Formatted message string
 */
export function formatPartialApproval(requestedAmount: number, approvedAmount: number): string {
  const remaining = requestedAmount - approvedAmount
  const fmt = (n: number) => `$${n.toFixed(2)}`
  return (
    `Partial approval: ${fmt(approvedAmount)} of ${fmt(requestedAmount)} approved. ` +
    `Remaining balance of ${fmt(remaining)} must be collected with another payment method.`
  )
}

/**
 * Get comprehensive decline info by checking both return code and text response.
 *
 * This is the recommended entry point for UI code — it checks the return code
 * first (more specific), then falls back to text response matching.
 *
 * @param cmdStatus - "Approved", "Declined", "Error", or "Success"
 * @param returnCode - 6-digit DSIX return code
 * @param textResponse - Free-text response from processor
 * @returns DeclineInfo with the most specific match available
 */
export function getDeclineInfo(
  cmdStatus: string,
  returnCode: string,
  textResponse?: string
): DeclineInfo {
  // If approved, short-circuit
  if (cmdStatus === 'Approved' || cmdStatus === 'Success') {
    return {
      staffMessage: 'Approved',
      customerMessage: 'Approved',
      isRetryable: false,
    }
  }

  // Try DSIX return code first (most specific)
  const codeEntry = DSIX_RETURN_CODES[returnCode]
  if (codeEntry) {
    return {
      staffMessage: codeEntry.staffMessage,
      customerMessage: codeEntry.customerMessage,
      isRetryable: codeEntry.isRetryable,
    }
  }

  // Try text response matching
  if (textResponse) {
    const textMatch = getDeclineReasonFromText(textResponse)
    if (textMatch) return textMatch
  }

  // Fall back to return code range classification
  return getDeclineReason(returnCode)
}
