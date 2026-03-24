'use client'

/**
 * CartSummary — Order totals breakdown for checkout.
 *
 * Shows subtotal, coupon discount, gift card applied, tax estimate,
 * tip, surcharge, and final total.
 */

import { formatCurrency } from '@/lib/utils'

interface CartSummaryProps {
  subtotal: number
  couponDiscount: number
  giftCardApplied: number
  taxEstimate: number | null // null = "Calculated at payment"
  tipAmount: number
  surchargeType: string | null // 'flat' | 'percent' | null
  surchargeAmount: number
  surchargeName: string
  deliveryFee?: number
}

function computeSurcharge(
  subtotal: number,
  type: string | null,
  amount: number
): number {
  if (!type || amount <= 0) return 0
  if (type === 'percent') return Math.round(subtotal * (amount / 100) * 100) / 100
  return amount // flat
}

export function CartSummary({
  subtotal,
  couponDiscount,
  giftCardApplied,
  taxEstimate,
  tipAmount,
  surchargeType,
  surchargeAmount,
  surchargeName,
  deliveryFee = 0,
}: CartSummaryProps) {
  const surcharge = computeSurcharge(subtotal, surchargeType, surchargeAmount)
  const afterDiscount = Math.max(0, subtotal - couponDiscount)
  const taxDisplay = taxEstimate ?? 0
  const beforeGiftCard = afterDiscount + taxDisplay + tipAmount + surcharge + deliveryFee
  const total = Math.max(0, beforeGiftCard - giftCardApplied)

  const rows: Array<{ label: string; value: number; negative?: boolean; muted?: boolean; pending?: boolean }> = [
    { label: 'Subtotal', value: subtotal },
  ]

  if (couponDiscount > 0) {
    rows.push({ label: 'Coupon discount', value: couponDiscount, negative: true })
  }

  if (deliveryFee > 0) {
    rows.push({ label: 'Delivery fee', value: deliveryFee })
  }

  if (taxEstimate !== null) {
    rows.push({ label: 'Tax', value: taxEstimate })
  } else {
    rows.push({ label: 'Tax', value: 0, pending: true })
  }

  if (surcharge > 0) {
    rows.push({
      label: surchargeName || 'Service fee',
      value: surcharge,
    })
  }

  if (tipAmount > 0) {
    rows.push({ label: 'Tip', value: tipAmount })
  }

  if (giftCardApplied > 0) {
    rows.push({ label: 'Gift card', value: giftCardApplied, negative: true })
  }

  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.label} className="flex items-center justify-between text-sm">
          <span style={{ color: 'var(--site-text-muted)' }}>{row.label}</span>
          <span style={{ color: row.negative ? 'var(--site-success, #16a34a)' : 'var(--site-text)' }}>
            {row.pending
              ? 'Calculated at payment'
              : `${row.negative ? '-' : ''}${formatCurrency(row.value)}`}
          </span>
        </div>
      ))}

      {/* Divider */}
      <div className="border-t pt-2 mt-2" style={{ borderColor: 'var(--site-border)' }}>
        <div className="flex items-center justify-between">
          <span className="text-base font-bold" style={{ color: 'var(--site-text)' }}>
            Total
          </span>
          <span className="text-base font-bold" style={{ color: 'var(--site-text)' }}>
            {formatCurrency(total)}
          </span>
        </div>
      </div>
    </div>
  )
}
