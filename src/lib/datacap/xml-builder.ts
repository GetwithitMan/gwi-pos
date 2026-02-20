// Datacap Direct API — XML Request Builder
// Builds TStream XML requests for Datacap devices and cloud

import type { DatacapRequestFields, DatacapAmountFields, DatacapGratuityFields } from './types'

// ─── Type Guards ─────────────────────────────────────────────────────────────

/**
 * Type guard to ensure required fields are present before building XML
 * Throws a descriptive error if validation fails
 */
export function validateRequiredFields(
  fields: DatacapRequestFields
): asserts fields is DatacapRequestFields & {
  merchantId: string
  operatorId: string
  tranCode: string
} {
  if (!fields.merchantId) {
    throw new Error('DatacapRequestFields validation failed: merchantId is required')
  }
  if (!fields.operatorId) {
    throw new Error('DatacapRequestFields validation failed: operatorId is required')
  }
  if (!fields.tranCode) {
    throw new Error('DatacapRequestFields validation failed: tranCode is required')
  }
}

/**
 * Validate amount fields to ensure they're valid numbers
 * Throws if any amount is NaN or negative
 */
export function validateAmounts(amounts: DatacapAmountFields): void {
  const amountNames: (keyof DatacapAmountFields)[] = ['purchase', 'gratuity', 'tax', 'cashBack']

  for (const name of amountNames) {
    const value = amounts[name]
    if (value !== undefined) {
      if (isNaN(value)) {
        throw new Error(`Invalid amount: ${name} is NaN`)
      }
      if (value < 0) {
        throw new Error(`Invalid amount: ${name} cannot be negative (${value})`)
      }
    }
  }
}

// ─── XML Helpers ─────────────────────────────────────────────────────────────

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function formatAmount(amount: number): string {
  return amount.toFixed(2)
}

function tag(name: string, value: string | number | boolean | undefined | null): string {
  if (value === undefined || value === null) return ''
  const strValue = typeof value === 'number' ? formatAmount(value) : String(value)
  return `<${name}>${escapeXml(strValue)}</${name}>`
}

// ─── Amount Block ────────────────────────────────────────────────────────────

/**
 * Build XML amount block with validation
 *
 * @param amounts - Amount fields (purchase, gratuity, tax, cashBack)
 * @returns XML string with Amount block
 * @throws Error if any amount is NaN or negative
 */
export function buildAmountBlock(amounts: DatacapAmountFields): string {
  // Validate amounts before building XML
  validateAmounts(amounts)

  const parts: string[] = []
  if (amounts.purchase !== undefined) parts.push(`<Purchase>${formatAmount(amounts.purchase)}</Purchase>`)
  if (amounts.gratuity !== undefined) parts.push(`<Gratuity>${formatAmount(amounts.gratuity)}</Gratuity>`)
  if (amounts.tax !== undefined) parts.push(`<Tax>${formatAmount(amounts.tax)}</Tax>`)
  if (amounts.cashBack !== undefined) parts.push(`<CashBack>${formatAmount(amounts.cashBack)}</CashBack>`)
  if (parts.length === 0) return ''
  return `<Amount>${parts.join('')}</Amount>`
}

// ─── Gratuity Block ──────────────────────────────────────────────────────────

export function buildGratuityBlock(gratuity: DatacapGratuityFields): string {
  const parts: string[] = []

  if (gratuity.mode === 'SuggestivePrompt') {
    parts.push('<Gratuity>SuggestivePrompt</Gratuity>')
    if (gratuity.suggestions && gratuity.suggestions.length > 0) {
      parts.push(`<GratuitySuggestions>${gratuity.suggestions.join(',')}</GratuitySuggestions>`)
    }
    if (gratuity.showTotal) {
      parts.push('<GratuityShowTotal>Yes</GratuityShowTotal>')
    }
  } else if (gratuity.mode === 'Prompt') {
    parts.push('<Gratuity>Prompt</Gratuity>')
  } else if (gratuity.mode === 'PrintBlankLine') {
    parts.push('<Gratuity>PrintBlankLine</Gratuity>')
  }

  return parts.join('')
}

// ─── Account Block ───────────────────────────────────────────────────────────

function buildAccountBlock(acctNo: string): string {
  return `<Account><AcctNo>${escapeXml(acctNo)}</AcctNo></Account>`
}

// ─── Main Request Builder ────────────────────────────────────────────────────

/**
 * Build a TStream XML request for Datacap transactions
 *
 * @param fields - Request fields (merchantId, operatorId, tranCode are required)
 * @returns XML string ready to send to Datacap
 * @throws Error if required fields are missing
 */
export function buildRequest(fields: DatacapRequestFields): string {
  // Validate required fields at runtime (provides compile-time type narrowing)
  validateRequiredFields(fields)

  const parts: string[] = []

  // Required fields (now guaranteed by type guard)
  parts.push(tag('MerchantID', fields.merchantId))
  parts.push(tag('OperatorID', fields.operatorId))
  parts.push(tag('TranCode', fields.tranCode))

  // Transaction identifiers
  if (fields.invoiceNo) parts.push(tag('InvoiceNo', fields.invoiceNo))
  if (fields.refNo) parts.push(tag('RefNo', fields.refNo))
  if (fields.sequenceNo) parts.push(tag('SequenceNo', fields.sequenceNo))

  // Device
  if (fields.tranDeviceId !== undefined) parts.push(tag('TranDeviceID', String(fields.tranDeviceId)))
  if (fields.posPackageId) parts.push(tag('POSPackageID', fields.posPackageId))

  // Account — almost always 'SecureDevice' for EMV
  if (fields.acctNo) {
    parts.push(buildAccountBlock(fields.acctNo))
  }

  // Amounts
  if (fields.amounts) {
    parts.push(buildAmountBlock(fields.amounts))
  }

  // Partial auth
  if (fields.partialAuth) parts.push(tag('PartialAuth', fields.partialAuth))

  // Record number (for voids, captures, adjustments)
  if (fields.recordNo) {
    parts.push(tag('RecordNo', fields.recordNo))
  } else if (fields.recordNumberRequested) {
    parts.push('<RecordNo>RecordNumberRequested</RecordNo>')
    if (fields.frequency) parts.push(tag('Frequency', fields.frequency))
  }

  // CardholderID for card recognition
  if (fields.cardHolderId) parts.push(tag('CardHolderID', fields.cardHolderId))

  // Gratuity block
  if (fields.gratuity) {
    parts.push(buildGratuityBlock(fields.gratuity))
  }

  // Gratuity suggestions (shorthand — alternative to full gratuity block)
  if (fields.gratuitySuggestions) {
    parts.push(tag('GratuitySuggestions', fields.gratuitySuggestions))
  }

  // Device prompts
  if (fields.promptText) parts.push(tag('PromptText', fields.promptText))
  if (fields.buttonLabels && fields.buttonLabels.length > 0) {
    fields.buttonLabels.forEach((label, i) => {
      parts.push(tag(`Button${i + 1}`, label))
    })
  }

  // Duplicate override
  if (fields.duplicate) parts.push(tag('Duplicate', fields.duplicate))

  // Simulator scenario tag (dev only — read back by send() for simulator routing)
  if (fields.simScenario) parts.push(`<SimScenario>${fields.simScenario}</SimScenario>`)

  // Filter out empty strings
  const content = parts.filter(Boolean).join('')

  return `<TStream><Transaction>${content}</Transaction></TStream>`
}

// ─── Admin Request Builder (Batch operations) ────────────────────────────────

/**
 * Build a TStream XML admin request (batch operations)
 *
 * @param fields - Request fields (merchantId, operatorId, tranCode are required)
 * @returns XML string ready to send to Datacap
 * @throws Error if required fields are missing
 */
export function buildAdminRequest(fields: DatacapRequestFields): string {
  // Validate required fields
  validateRequiredFields(fields)

  const parts: string[] = []

  parts.push(tag('MerchantID', fields.merchantId))
  parts.push(tag('OperatorID', fields.operatorId))
  parts.push(tag('TranCode', fields.tranCode))

  if (fields.sequenceNo) parts.push(tag('SequenceNo', fields.sequenceNo))
  if (fields.posPackageId) parts.push(tag('POSPackageID', fields.posPackageId))

  const content = parts.filter(Boolean).join('')

  return `<TStream><Admin>${content}</Admin></TStream>`
}
