'use client'

import type { PricingProgram, ConvenienceFeeSettings } from '@/lib/settings/types'
import { formatCurrency } from '@/lib/utils'

interface PaymentPricingReadOnlyProps {
  pricingProgram: PricingProgram | undefined
  convenienceFees: ConvenienceFeeSettings | undefined
  settingsUpdatedAt: string | null  // ISO timestamp
}

const MODEL_LABELS: Record<string, string> = {
  standard: 'Standard',
  dual_price: 'Dual Price (Cash / Card)',
  dual_price_pan_debit: 'Dual Price + PAN Debit',
  surcharge: 'Surcharge',
}

function formatPercent(value: number | undefined): string {
  if (value == null) return '0%'
  return `${value}%`
}

function StaleWarning({ updatedAt }: { updatedAt: string | null }) {
  if (!updatedAt) return null

  const lastSync = new Date(updatedAt)
  const now = new Date()
  const hoursSinceSync = (now.getTime() - lastSync.getTime()) / (1000 * 60 * 60)

  if (hoursSinceSync < 24) return null

  const daysAgo = Math.floor(hoursSinceSync / 24)
  const timeLabel = daysAgo === 1 ? '1 day ago' : `${daysAgo} days ago`

  return (
    <div className="flex items-start gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg mb-4">
      <svg className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
      </svg>
      <p className="text-xs text-amber-700">
        Pricing settings may be out of date. Last successful sync: <span className="font-medium">{timeLabel}</span> ({lastSync.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })})
      </p>
    </div>
  )
}

export function PaymentPricingReadOnly({ pricingProgram, convenienceFees, settingsUpdatedAt }: PaymentPricingReadOnlyProps) {
  const pp = pricingProgram
  const model = pp?.model || 'standard'
  const modelLabel = MODEL_LABELS[model] || model
  const isEnabled = pp?.enabled ?? false
  const isDualPrice = model === 'dual_price' || model === 'dual_price_pan_debit'
  const isSurcharge = model === 'surcharge'
  const hasPanDebit = model === 'dual_price_pan_debit'
  const fees = convenienceFees

  return (
    <section className="bg-gray-50 border border-gray-200 rounded-2xl p-6">
      <div className="flex items-center gap-2 mb-1">
        <h2 className="text-lg font-semibold text-gray-900">Payment & Pricing Configuration</h2>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-200 text-gray-600">View only</span>
      </div>
      <p className="text-sm text-gray-600 mb-4">Managed in Mission Control. Changes must be made centrally and will sync to this POS.</p>

      <StaleWarning updatedAt={settingsUpdatedAt} />

      {/* Pricing Model */}
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="bg-white rounded-xl p-3 border border-gray-100">
          <div className="text-xs text-gray-600 mb-0.5">Pricing Model</div>
          <div className="font-medium text-gray-900">{isEnabled ? modelLabel : 'Standard'}</div>
          <div className="text-xs text-gray-500 mt-1">
            {!isEnabled || model === 'standard'
              ? 'No additional fees. All customers pay the same price.'
              : model === 'dual_price'
              ? 'Card customers pay a small markup. Cash customers get the base price.'
              : model === 'dual_price_pan_debit'
              ? 'Credit cards pay a markup. Debit cards pay a lower rate or cash price. Detected automatically.'
              : model === 'surcharge'
              ? 'A fee is added on top of the base price for card payments.'
              : null}
          </div>
        </div>

        {isEnabled && isDualPrice && (
          <div className="bg-white rounded-xl p-3 border border-gray-100">
            <div className="text-xs text-gray-600 mb-0.5">Credit Markup</div>
            <div className="font-medium text-gray-900">{formatPercent(pp?.creditMarkupPercent)}</div>
          </div>
        )}

        {isEnabled && hasPanDebit && (
          <div className="bg-white rounded-xl p-3 border border-gray-100">
            <div className="text-xs text-gray-600 mb-0.5">Debit Markup</div>
            <div className="font-medium text-gray-900">
              {(pp?.debitMarkupPercent ?? 0) === 0 ? 'Same as cash' : formatPercent(pp?.debitMarkupPercent)}
            </div>
          </div>
        )}

        {isEnabled && isSurcharge && (
          <>
            <div className="bg-white rounded-xl p-3 border border-gray-100">
              <div className="text-xs text-gray-600 mb-0.5">Surcharge</div>
              <div className="font-medium text-gray-900">{formatPercent(pp?.surchargePercent)}</div>
            </div>
            {pp?.surchargeDisclosure && (
              <div className="bg-white rounded-xl p-3 border border-gray-100 col-span-2">
                <div className="text-xs text-gray-600 mb-0.5">Surcharge Disclosure</div>
                <div className="font-medium text-gray-900 text-xs">{pp.surchargeDisclosure}</div>
              </div>
            )}
          </>
        )}

        {!isEnabled && (
          <div className="bg-white rounded-xl p-3 border border-gray-100">
            <div className="text-xs text-gray-600 mb-0.5">Status</div>
            <div className="font-medium text-gray-900">No pricing program active</div>
          </div>
        )}
      </div>

      {/* Convenience Fees */}
      {fees?.enabled && (
        <div className="mt-4 pt-4 border-t border-gray-100">
          <h3 className="text-sm font-semibold text-gray-900 mb-2">Convenience Fees</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
            {fees.fees.online > 0 && (
              <div className="bg-white rounded-xl p-3 border border-gray-100">
                <div className="text-xs text-gray-600 mb-0.5">Online</div>
                <div className="font-medium text-gray-900">{formatCurrency(fees.fees.online)}</div>
              </div>
            )}
            {fees.fees.phone > 0 && (
              <div className="bg-white rounded-xl p-3 border border-gray-100">
                <div className="text-xs text-gray-600 mb-0.5">Phone</div>
                <div className="font-medium text-gray-900">{formatCurrency(fees.fees.phone)}</div>
              </div>
            )}
            {fees.fees.delivery > 0 && (
              <div className="bg-white rounded-xl p-3 border border-gray-100">
                <div className="text-xs text-gray-600 mb-0.5">Delivery</div>
                <div className="font-medium text-gray-900">{formatCurrency(fees.fees.delivery)}</div>
              </div>
            )}
            {fees.fees.kiosk > 0 && (
              <div className="bg-white rounded-xl p-3 border border-gray-100">
                <div className="text-xs text-gray-600 mb-0.5">Kiosk</div>
                <div className="font-medium text-gray-900">{formatCurrency(fees.fees.kiosk)}</div>
              </div>
            )}
            {fees.fees.pos > 0 && (
              <div className="bg-white rounded-xl p-3 border border-gray-100">
                <div className="text-xs text-gray-600 mb-0.5">POS</div>
                <div className="font-medium text-gray-900">{formatCurrency(fees.fees.pos)}</div>
              </div>
            )}
            {Object.values(fees.fees).every(f => f === 0) && (
              <div className="bg-white rounded-xl p-3 border border-gray-100 col-span-2">
                <div className="text-xs text-gray-600 mb-0.5">All Channels</div>
                <div className="font-medium text-gray-900">No fees configured</div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm mt-3">
            <div className="bg-white rounded-xl p-3 border border-gray-100">
              <div className="text-xs text-gray-600 mb-0.5">Fee Display</div>
              <div className="font-medium text-gray-900">
                {fees.showFeeAsLineItem ? 'Shown as line item' : 'Shown at checkout only'}
              </div>
            </div>
            {fees.disclosureText && (
              <div className="bg-white rounded-xl p-3 border border-gray-100">
                <div className="text-xs text-gray-600 mb-0.5">Disclosure</div>
                <div className="font-medium text-gray-900 text-xs">{fees.disclosureText}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Last Updated */}
      {settingsUpdatedAt && (
        <div className="mt-4 pt-3 border-t border-gray-100">
          <p className="text-xs text-gray-500">
            Last updated: {new Date(settingsUpdatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
          </p>
        </div>
      )}
    </section>
  )
}
