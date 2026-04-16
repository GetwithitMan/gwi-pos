/**
 * Customer Receipt ESC/POS Builder
 *
 * Builds ESC/POS buffers for customer receipts (thermal printers).
 * Uses printer-level PrintTemplateSettings for tip lines, signature,
 * suggested tips, surcharge disclosure, and promo text.
 *
 * Called by POST /api/print/receipt to print customer receipts to
 * the location's receipt printer.
 */

import {
  ESCPOS,
  line,
  divider,
  twoColumnLine,
  buildDocument,
  buildDocumentNoCut,
  PAPER_WIDTH,
} from './commands'
import {
  type PrintTemplateSettings,
  mergePrintTemplateSettings,
} from '@/types/print'
import { formatCurrency } from '@/lib/utils'

// ── Data shapes ──

export interface ReceiptOrderData {
  orderNumber: number
  displayNumber?: string | null
  orderType: string
  tabName?: string | null
  tableName?: string | null
  guestCount?: number
  employeeName: string
  locationName: string
  locationAddress?: string | null
  locationPhone?: string | null
  createdAt: string
  paidAt?: string | null
  // Notification pager info
  pagerNumber?: string | null
  fulfillmentMode?: string | null
  // Reservation info (populated when order is linked to a reservation)
  reservation?: {
    guestName: string
    partySize: number
    confirmationId: string // Short ID for receipt display
  } | null
}

export interface ReceiptItem {
  name: string
  quantity: number
  price: number
  modifiers: { name: string; price: number; depth?: number; preModifier?: string | null; isCustomEntry?: boolean; isNoneSelection?: boolean; noneShowOnReceipt?: boolean; customEntryName?: string | null; swapTargetName?: string | null }[]
  // Combo Pick N of M — customer-chosen option snapshots (sorted by sortIndex asc).
  // Empty/undefined for classic combos and non-combo items.
  comboSelections?: Array<{
    optionName: string
    upchargeApplied: number
    sortIndex: number
    menuItemId?: string
  }>
  specialNotes?: string | null
}

export interface ReceiptPayment {
  method: string
  amount: number
  tipAmount: number
  totalAmount: number
  cardBrand?: string | null
  cardLast4?: string | null
  authCode?: string | null
  entryMethod?: string | null
  aid?: string | null
  changeGiven?: number | null
}

export interface ReceiptTotals {
  subtotal: number
  discount: number
  tax: number
  taxFromInclusive?: number   // Tax backed out of inclusive-priced items
  taxFromExclusive?: number   // Tax added on top of exclusive-priced items
  tipTotal: number
  donationAmount?: number
  total: number
  surchargeAmount?: number
  surchargePercent?: number
  surchargeDisclosure?: string | null
  tipExemptAmount?: number  // Sum of tip-exempt item totals — excluded from tip suggestion basis
  convenienceFee?: number
  convenienceFeeDisclosure?: string | null
  isTaxExempt?: boolean
  taxExemptReason?: string | null
  cashDiscountDisclosure?: string | null
  // Dual pricing fields — populated when location uses card/cash pricing
  cardSubtotal?: number | null
  cardTax?: number | null
  cardTotal?: number | null
  cashSubtotal?: number | null
  cashTax?: number | null
  cashTotal?: number | null
}

export interface CustomerReceiptData {
  order: ReceiptOrderData
  items: ReceiptItem[]
  payments: ReceiptPayment[]
  totals: ReceiptTotals
}

// ── Builder ──

export function buildCustomerReceipt(
  data: CustomerReceiptData,
  settings: Partial<PrintTemplateSettings> | null | undefined,
  paperWidth: number | null,
  printerType: 'thermal' | 'impact' | null
): Buffer {
  const s = mergePrintTemplateSettings(settings)
  const width = paperWidth === 58
    ? PAPER_WIDTH['58mm']
    : paperWidth === 40
      ? PAPER_WIDTH['40mm']
      : PAPER_WIDTH['80mm']
  const isImpact = printerType === 'impact'

  const content: Buffer[] = []
  const NORMAL = isImpact ? ESCPOS.IMPACT_NORMAL : ESCPOS.NORMAL_SIZE
  const TALL = isImpact ? ESCPOS.IMPACT_DOUBLE_HEIGHT : ESCPOS.DOUBLE_HEIGHT

  const { order, items, payments, totals } = data

  // ── Header: location name, address, phone ──
  content.push(ESCPOS.ALIGN_CENTER)
  content.push(ESCPOS.BOLD_ON)
  content.push(TALL)
  content.push(line(order.locationName))
  content.push(NORMAL)
  content.push(ESCPOS.BOLD_OFF)

  if (order.locationAddress) {
    content.push(line(order.locationAddress))
  }
  if (order.locationPhone) {
    content.push(line(order.locationPhone))
  }
  content.push(ESCPOS.ALIGN_LEFT)
  content.push(divider(width))

  // ── Order info ──
  content.push(
    twoColumnLine(
      `Order #${order.displayNumber || order.orderNumber}`,
      order.orderType.replace('_', ' ').toUpperCase(),
      width
    )
  )
  if (order.tableName) {
    content.push(line(`Table: ${order.tableName}`))
  }
  if (order.tabName) {
    content.push(line(`Tab: ${order.tabName}`))
  }
  content.push(line(`Server: ${order.employeeName}`))

  const dateStr = order.paidAt
    ? new Date(order.paidAt).toLocaleString()
    : new Date(order.createdAt).toLocaleString()
  content.push(line(dateStr))
  if (order.guestCount && order.guestCount > 0) {
    content.push(line(`Guests: ${order.guestCount}`))
  }

  // ── Pager / fulfillment mode ──
  if (order.pagerNumber) {
    content.push(line(`Pager: #${order.pagerNumber}`))
  }
  if (order.fulfillmentMode) {
    const modeLabel = order.fulfillmentMode.toUpperCase().replace('_', ' ')
    content.push(line(modeLabel))
  }

  // ── Reservation info ──
  if (order.reservation) {
    content.push(divider(width, '-'))
    content.push(ESCPOS.ALIGN_CENTER)
    content.push(line('Reservation'))
    content.push(ESCPOS.ALIGN_LEFT)
    content.push(line(`Guest: ${order.reservation.guestName}`))
    content.push(line(`Party: ${order.reservation.partySize} | Conf: ${order.reservation.confirmationId}`))
  }

  content.push(divider(width))

  // Shared indented-line helper — used for both modifiers and combo selections so
  // the receipt aesthetic stays consistent. Matches the existing modifier convention
  // (2-space indent at depth 0, extra indent per depth level).
  const indentFor = (depth: number) => (depth && depth > 0 ? '  '.repeat(depth + 1) : '  ')
  const emitIndentedReceiptLine = (label: string, amount: number | undefined, depth: number) => {
    const indent = indentFor(depth)
    if (amount != null && amount > 0) {
      content.push(twoColumnLine(`${indent}${label}`, `$${amount.toFixed(2)}`, width))
    } else {
      content.push(line(`${indent}${label}`))
    }
  }

  // ── Items ──
  for (const item of items) {
    const qty = item.quantity > 1 ? `${item.quantity}x ` : ''
    const itemText = `${qty}${item.name}`
    const priceText = `$${item.price.toFixed(2)}`
    content.push(twoColumnLine(itemText, priceText, width))

    for (const mod of item.modifiers) {
      // Skip "None" selections unless the group has noneShowOnReceipt enabled
      if (mod.isNoneSelection && !mod.noneShowOnReceipt) continue
      // Build display name with pre-modifier labels, custom entry/swap prefixes
      let modDisplayName = mod.name
      // Pre-modifier labels: "No Onions", "Lite Ranch", "Extra Cheese", "Side Sauce"
      if (mod.preModifier && !mod.isCustomEntry && !mod.swapTargetName) {
        const tokens = mod.preModifier.split(',').map(t => t.trim()).filter(Boolean)
        const label = tokens.map(t => t.charAt(0).toUpperCase() + t.slice(1)).join(' ')
        if (label) modDisplayName = `${label} ${mod.name}`
      }
      if (mod.isCustomEntry) {
        modDisplayName = `CUSTOM: ${mod.customEntryName || mod.name}`
      }
      if (mod.swapTargetName) {
        modDisplayName = `${mod.name} → ${mod.swapTargetName}`
      }
      emitIndentedReceiptLine(modDisplayName, mod.price > 0 ? mod.price : undefined, mod.depth ?? 0)
    }

    // Combo Pick N of M — render each customer-picked option as an indented child line
    // using the same formatter as modifiers. Selections are already sorted by sortIndex asc.
    // Upcharge renders as `(+$X.XX)` inline when > 0; zero-upcharge picks print name only.
    // Classic combos (no comboSelections) render unchanged.
    if (item.comboSelections && item.comboSelections.length > 0) {
      for (const sel of item.comboSelections) {
        const rawName = (sel.optionName ?? '').toString().trim()
        if (!rawName) continue
        const upcharge = Number(sel.upchargeApplied ?? 0)
        const label = upcharge > 0
          ? `${rawName} (+${formatCurrency(upcharge)})`
          : rawName
        emitIndentedReceiptLine(label, undefined, 0)
      }
    }

    if (item.specialNotes) {
      content.push(line(`  Note: ${item.specialNotes}`))
    }
  }

  content.push(divider(width, '-'))

  // ── Totals ──
  content.push(twoColumnLine('Subtotal:', `$${totals.subtotal.toFixed(2)}`, width))
  if (totals.discount > 0) {
    content.push(twoColumnLine('Discount:', `-$${totals.discount.toFixed(2)}`, width))
  }
  if (totals.surchargeAmount && totals.surchargeAmount > 0) {
    const surchargePctLabel = totals.surchargePercent ? ` (${totals.surchargePercent}%)` : ''
    content.push(twoColumnLine(`CC Surcharge${surchargePctLabel}:`, `$${totals.surchargeAmount.toFixed(2)}`, width))
  }
  if (totals.convenienceFee && totals.convenienceFee > 0) {
    content.push(twoColumnLine('Convenience Fee:', `$${totals.convenienceFee.toFixed(2)}`, width))
  }
  // Tax exempt badge — render before tax line when order is tax exempt
  if (totals.isTaxExempt) {
    content.push(ESCPOS.ALIGN_CENTER)
    content.push(ESCPOS.BOLD_ON)
    content.push(line('*** TAX EXEMPT ***'))
    content.push(ESCPOS.BOLD_OFF)
    if (totals.taxExemptReason) {
      content.push(line(totals.taxExemptReason))
    }
    content.push(ESCPOS.ALIGN_LEFT)
  }

  // Tax line(s) — show breakdown if enabled and both inclusive/exclusive present
  const showBreakdown = s.receipt?.totals?.showTaxBreakdown ?? false
  const inclTax = totals.taxFromInclusive ?? 0
  const exclTax = totals.taxFromExclusive ?? 0
  const allInclusive = inclTax > 0 && exclTax === 0
  const hasBoth = inclTax > 0 && exclTax > 0

  if (showBreakdown && hasBoth) {
    content.push(twoColumnLine('Tax (included):', `$${inclTax.toFixed(2)}`, width))
    content.push(twoColumnLine('Tax (added):', `$${exclTax.toFixed(2)}`, width))
  } else {
    const taxLabel = totals.isTaxExempt
      ? 'Tax (exempt):'
      : allInclusive ? 'Tax (included):' : 'Tax:'
    content.push(twoColumnLine(taxLabel, `$${totals.tax.toFixed(2)}`, width))
  }
  // Donation line — between tip and total
  if (totals.donationAmount && totals.donationAmount > 0) {
    content.push(twoColumnLine('Donation:', `$${totals.donationAmount.toFixed(2)}`, width))
  }
  content.push(TALL)
  content.push(ESCPOS.BOLD_ON)
  content.push(twoColumnLine('TOTAL:', `$${totals.total.toFixed(2)}`, width))
  content.push(ESCPOS.BOLD_OFF)
  content.push(NORMAL)

  // ── Dual Pricing Breakdown (card vs cash comparison) ──
  const hasDualPricing =
    totals.cardTotal != null &&
    totals.cashTotal != null &&
    totals.cardTotal !== totals.cashTotal
  if (hasDualPricing) {
    const cardSub = totals.cardSubtotal ?? totals.subtotal
    const cardTx = totals.cardTax ?? totals.tax
    const cardTot = totals.cardTotal!
    const cashTot = totals.cashTotal!
    const savings = Math.round((cardTot - cashTot) * 100) / 100

    content.push(line(''))
    content.push(ESCPOS.ALIGN_CENTER)
    content.push(ESCPOS.BOLD_ON)
    content.push(line('\u2500\u2500\u2500\u2500 CARD PRICE \u2500\u2500\u2500\u2500'))
    content.push(ESCPOS.BOLD_OFF)
    content.push(ESCPOS.ALIGN_LEFT)
    content.push(twoColumnLine('Subtotal:', `$${cardSub.toFixed(2)}`, width))
    content.push(twoColumnLine('Tax:', `$${cardTx.toFixed(2)}`, width))
    content.push(ESCPOS.BOLD_ON)
    content.push(twoColumnLine('Total:', `$${cardTot.toFixed(2)}`, width))
    content.push(ESCPOS.BOLD_OFF)
    content.push(line(''))
    content.push(ESCPOS.ALIGN_CENTER)
    content.push(twoColumnLine('Cash Price:', `$${cashTot.toFixed(2)}`, width))
    if (savings > 0) {
      content.push(ESCPOS.BOLD_ON)
      content.push(line(`You save $${savings.toFixed(2)} by paying cash!`))
      content.push(ESCPOS.BOLD_OFF)
    }
    content.push(line('\u2500'.repeat(Math.min(width, 20))))
    content.push(ESCPOS.ALIGN_LEFT)
  }

  // ── Payments ──
  if (payments.length > 0) {
    content.push(line(''))
    for (const pmt of payments) {
      const entryLabel = pmt.entryMethod ? ` (${pmt.entryMethod})` : ''
      const label =
        pmt.method === 'cash'
          ? 'Cash'
          : pmt.method === 'house_account'
            ? `House Acct${pmt.authCode ? ': ' + pmt.authCode : ''}`
            : pmt.method === 'gift_card'
              ? `Gift Card ****${pmt.cardLast4 || '????'}`
              : pmt.method === 'loyalty_points'
                ? 'Loyalty Points'
                : pmt.method === 'room_charge'
                  ? `Room Charge${pmt.authCode ? ' ' + pmt.authCode : ''}`
                  : pmt.cardBrand
                    ? `${pmt.cardBrand} ****${pmt.cardLast4 || '????'}${entryLabel}`
                    : `Card ****${pmt.cardLast4 || '????'}${entryLabel}`
      content.push(twoColumnLine(label, `$${pmt.totalAmount.toFixed(2)}`, width))

      if (pmt.method !== 'cash' && pmt.authCode) {
        content.push(line(`  Auth: ${pmt.authCode}`))
      }
      if (pmt.method !== 'cash' && pmt.aid) {
        content.push(line(`  AID: ${pmt.aid}`))
      }
      if (pmt.tipAmount > 0) {
        content.push(twoColumnLine('  Tip:', `$${pmt.tipAmount.toFixed(2)}`, width))
      }
      if (pmt.changeGiven && pmt.changeGiven > 0) {
        content.push(twoColumnLine('  Change:', `$${pmt.changeGiven.toFixed(2)}`, width))
      }
    }
  }

  // ── Tip section (from printer settings) ──
  if (s.receipt.tipLine) {
    content.push(line(''))
    content.push(divider(width, '-'))

    // Suggested tips
    if (s.receipt.suggestedTips.length > 0) {
      const rawTipBase =
        s.receipt.tipCalculation === 'pre-tax' ? totals.subtotal : totals.total
      const tipBase = totals.tipExemptAmount ? Math.max(0, rawTipBase - totals.tipExemptAmount) : rawTipBase
      content.push(line(''))
      content.push(ESCPOS.ALIGN_CENTER)
      content.push(line('Suggested Gratuity'))
      content.push(ESCPOS.ALIGN_LEFT)

      for (const pct of s.receipt.suggestedTips) {
        const tipAmount = (tipBase * pct) / 100
        const tipTotal = totals.total + tipAmount
        content.push(
          twoColumnLine(
            `${pct}% = $${tipAmount.toFixed(2)}`,
            `Total: $${tipTotal.toFixed(2)}`,
            width
          )
        )
      }
    }

    content.push(line(''))
    content.push(twoColumnLine('Tip:', '_____________', width))
    content.push(line(''))
    content.push(twoColumnLine('Total:', '_____________', width))
  }

  // ── Signature ──
  const sig = s.receipt.signature
  if (sig?.enabled && (sig.copies || 1) > 0) {
    content.push(line(''))
    content.push(line(''))

    const sigLineChar = sig.lineStyle === 'dotted' ? '.' : '_'
    const sigPrefix = sig.lineStyle === 'x-line' ? 'x' : ''
    content.push(line(sigPrefix + sigLineChar.repeat(width - sigPrefix.length)))

    content.push(ESCPOS.ALIGN_CENTER)
    content.push(line('Signature'))

    if (sig.showCopyLabel) {
      content.push(line(''))
      content.push(ESCPOS.BOLD_ON)
      content.push(line(sig.customerCopyLabel || 'CUSTOMER COPY'))
      content.push(ESCPOS.BOLD_OFF)
    }
    content.push(ESCPOS.ALIGN_LEFT)
  }

  // ── Surcharge disclosure ──
  if (totals.surchargeAmount && totals.surchargeAmount > 0) {
    content.push(line(''))
    content.push(ESCPOS.ALIGN_CENTER)
    content.push(line(totals.surchargeDisclosure || '*Credit card surcharge applied per Visa/MC guidelines'))
    content.push(ESCPOS.ALIGN_LEFT)
  }

  // ── Cash discount / dual pricing disclosure ──
  if (totals.cashDiscountDisclosure) {
    content.push(line(''))
    content.push(ESCPOS.ALIGN_CENTER)
    content.push(line(totals.cashDiscountDisclosure))
    content.push(ESCPOS.ALIGN_LEFT)
  }

  // ── Convenience fee disclosure ──
  if (totals.convenienceFee && totals.convenienceFee > 0 && totals.convenienceFeeDisclosure) {
    content.push(line(''))
    content.push(ESCPOS.ALIGN_CENTER)
    content.push(line(totals.convenienceFeeDisclosure))
    content.push(ESCPOS.ALIGN_LEFT)
  }

  // ── Terms text ──
  if (s.receipt.termsText) {
    content.push(line(''))
    content.push(ESCPOS.ALIGN_CENTER)
    content.push(line(s.receipt.termsText))
    content.push(ESCPOS.ALIGN_LEFT)
  }

  // ── Promo text ──
  if (s.receipt.promoText) {
    content.push(line(''))
    content.push(ESCPOS.ALIGN_CENTER)
    content.push(ESCPOS.BOLD_ON)
    content.push(line(s.receipt.promoText))
    content.push(ESCPOS.BOLD_OFF)
    content.push(ESCPOS.ALIGN_LEFT)
  }

  return isImpact ? buildDocumentNoCut(...content) : buildDocument(...content)
}
