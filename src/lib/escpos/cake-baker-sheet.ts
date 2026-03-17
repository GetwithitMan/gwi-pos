/**
 * Cake Baker Sheet ESC/POS Builder
 *
 * Prints a production sheet for the baker with full cake order details:
 * tiers, flavors, fillings, frostings, decorations, message, allergies, notes.
 */

import {
  ESCPOS,
  line,
  divider,
  buildDocument,
  largeLine,
  boldLine,
  centeredLine,
} from './commands'

export interface CakeBakerSheetTier {
  name: string
  flavor: string | null
  filling: string | null
  frosting: string | null
  dietary: string | null
}

export interface CakeBakerSheetData {
  orderNumber: number | string
  eventDate: string
  eventTime: string | null
  customerName: string
  customerAllergies: string | null
  eventType: string | null
  guestCount: number | null
  tiers: CakeBakerSheetTier[]
  decorations: string[]
  messageText: string | null
  messagePlacement: string | null
  deliveryType: string | null
  deliveryAddress: string | null
  notes: string | null
}

export function buildCakeBakerSheet(data: CakeBakerSheetData): Buffer {
  const parts: Buffer[] = []

  // ── Header ────────────────────────────────────────────────────────
  parts.push(ESCPOS.ALIGN_CENTER)
  parts.push(ESCPOS.BOLD_ON)
  parts.push(largeLine('BAKER SHEET'))
  parts.push(largeLine('CAKE ORDER'))
  parts.push(ESCPOS.BOLD_OFF)
  parts.push(ESCPOS.ALIGN_LEFT)

  // Order number (bold, large)
  parts.push(boldLine(`#CK-${data.orderNumber}`))
  parts.push(divider())

  // ── Event details ─────────────────────────────────────────────────
  const eventLine = data.eventTime
    ? `Event: ${data.eventDate} @ ${data.eventTime}`
    : `Event: ${data.eventDate}`
  parts.push(line(eventLine))
  parts.push(line(`Customer: ${data.customerName}`))

  const typeParts: string[] = []
  if (data.eventType) typeParts.push(`Type: ${data.eventType}`)
  if (data.guestCount != null && data.guestCount > 0) typeParts.push(`Guests: ${data.guestCount}`)
  if (typeParts.length > 0) {
    parts.push(line(typeParts.join(' | ')))
  }

  // ── Allergies (bold warning) ──────────────────────────────────────
  if (data.customerAllergies && data.customerAllergies.trim().length > 0) {
    parts.push(line(''))
    parts.push(ESCPOS.BOLD_ON)
    parts.push(ESCPOS.DOUBLE_HEIGHT)
    parts.push(line(`!! ALLERGIES: ${data.customerAllergies.trim()}`))
    parts.push(ESCPOS.NORMAL_SIZE)
    parts.push(ESCPOS.BOLD_OFF)
  }

  parts.push(divider())

  // ── Tiers ─────────────────────────────────────────────────────────
  if (data.tiers.length > 0) {
    for (let i = 0; i < data.tiers.length; i++) {
      const tier = data.tiers[i]
      parts.push(boldLine(`TIER ${i + 1} -- ${tier.name}`))
      if (tier.flavor) parts.push(line(`  Flavor:   ${tier.flavor}`))
      if (tier.filling) parts.push(line(`  Filling:  ${tier.filling}`))
      if (tier.frosting) parts.push(line(`  Frosting: ${tier.frosting}`))
      if (tier.dietary) parts.push(line(`  Dietary:  ${tier.dietary}`))
      parts.push(line(''))
    }
    parts.push(divider())
  }

  // ── Decorations ───────────────────────────────────────────────────
  if (data.decorations.length > 0) {
    parts.push(boldLine('DECORATIONS'))
    for (const dec of data.decorations) {
      parts.push(line(`  * ${dec}`))
    }
    parts.push(divider())
  }

  // ── Message ───────────────────────────────────────────────────────
  if (data.messageText) {
    parts.push(boldLine('MESSAGE'))
    parts.push(line(`  "${data.messageText}"`))
    if (data.messagePlacement) {
      parts.push(line(`  Placement: ${data.messagePlacement}`))
    }
    parts.push(divider())
  }

  // ── Delivery ──────────────────────────────────────────────────────
  if (data.deliveryType) {
    const label = data.deliveryType.replace(/_/g, ' ').toUpperCase()
    parts.push(line(`Delivery: ${label}`))
    if (data.deliveryAddress) {
      parts.push(line(`  ${data.deliveryAddress}`))
    }
    parts.push(line(''))
  }

  // ── Notes ─────────────────────────────────────────────────────────
  if (data.notes && data.notes.trim().length > 0) {
    parts.push(boldLine('NOTES'))
    // Word-wrap notes at ~46 chars (leaving 2 char indent)
    const wrapped = wrapText(data.notes.trim(), 46)
    for (const wl of wrapped) {
      parts.push(line(`  ${wl}`))
    }
    parts.push(divider())
  }

  // ── Footer ────────────────────────────────────────────────────────
  parts.push(centeredLine(`Printed: ${new Date().toLocaleString('en-US', { dateStyle: 'short', timeStyle: 'short' })}`))

  return buildDocument(...parts)
}

/**
 * Simple word-wrap utility for thermal printer (no hyphenation).
 */
function wrapText(text: string, maxWidth: number): string[] {
  const lines: string[] = []
  const words = text.split(/\s+/)
  let current = ''

  for (const word of words) {
    if (current.length === 0) {
      current = word
    } else if (current.length + 1 + word.length <= maxWidth) {
      current += ' ' + word
    } else {
      lines.push(current)
      current = word
    }
  }
  if (current.length > 0) lines.push(current)
  return lines.length > 0 ? lines : ['']
}
