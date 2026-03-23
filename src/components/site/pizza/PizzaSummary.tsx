'use client'

import { formatCurrency } from '@/lib/utils'
import { humanizeSections } from '@/lib/pizza-section-utils'
import { calculatePizzaPriceEstimate, type PizzaPriceInput } from '@/lib/pizza-price-utils'

interface PizzaSummaryProps {
  sizeName: string | null
  crustName: string | null
  sauceName: string | null
  cheeseName: string | null
  sauceAmount: 'none' | 'light' | 'regular' | 'extra'
  cheeseAmount: 'none' | 'light' | 'regular' | 'extra'
  toppings: Array<{
    name: string
    sections: number[]
    amount: 'regular' | 'extra'
  }>
  sectionMode: number
  priceInput: PizzaPriceInput | null
}

// DISPLAY ONLY — server quote is authoritative
export function PizzaSummary({
  sizeName,
  crustName,
  sauceName,
  cheeseName,
  sauceAmount,
  cheeseAmount,
  toppings,
  sectionMode,
  priceInput,
}: PizzaSummaryProps) {
  const estimate = priceInput ? calculatePizzaPriceEstimate(priceInput) : null

  return (
    <div
      className="rounded-xl border p-4 space-y-3"
      style={{ borderColor: 'var(--site-border)', backgroundColor: 'var(--site-bg-secondary)' }}
    >
      <h3 className="text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--site-text-muted)' }}>
        Your Pizza
      </h3>

      {/* Configuration summary */}
      <div className="space-y-1.5 text-sm" style={{ color: 'var(--site-text)' }}>
        {sizeName && (
          <SummaryRow
            label={sizeName}
            price={estimate?.sizePrice}
          />
        )}
        {crustName && (
          <SummaryRow
            label={crustName}
            price={estimate?.crustPrice}
            showPrice={estimate ? estimate.crustPrice > 0 : false}
          />
        )}
        {sauceName && sauceAmount !== 'none' && (
          <SummaryRow
            label={`${amountPrefix(sauceAmount)}${sauceName}`}
            price={estimate?.saucePrice}
            showPrice={estimate ? estimate.saucePrice > 0 : false}
          />
        )}
        {sauceAmount === 'none' && (
          <SummaryRow label="No Sauce" />
        )}
        {cheeseName && cheeseAmount !== 'none' && (
          <SummaryRow
            label={`${amountPrefix(cheeseAmount)}${cheeseName}`}
            price={estimate?.cheesePrice}
            showPrice={estimate ? estimate.cheesePrice > 0 : false}
          />
        )}
        {cheeseAmount === 'none' && (
          <SummaryRow label="No Cheese" />
        )}

        {/* Toppings */}
        {toppings.length > 0 && (
          <div className="pt-1 space-y-1">
            {toppings.map((t, i) => {
              const prefix = t.amount === 'extra' ? 'Extra ' : ''
              const placement = sectionMode > 1 ? ` (${humanizeSections(t.sections, sectionMode)})` : ''
              return (
                <div key={i} className="flex items-center justify-between text-xs">
                  <span>{prefix}{t.name}{placement}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Price breakdown */}
      {estimate && (
        <div
          className="border-t pt-3 space-y-1"
          style={{ borderColor: 'var(--site-border)' }}
        >
          {estimate.toppingsPrice > 0 && (
            <div className="flex justify-between text-xs" style={{ color: 'var(--site-text-muted)' }}>
              <span>Toppings ({toppings.length})</span>
              <span>+{formatCurrency(estimate.toppingsPrice)}</span>
            </div>
          )}
          {estimate.freeToppingsUsed > 0 && (
            <div className="flex justify-between text-xs" style={{ color: 'var(--site-brand)' }}>
              <span>{estimate.freeToppingsUsed} free topping{estimate.freeToppingsUsed > 1 ? 's' : ''} applied</span>
            </div>
          )}
          <div className="flex justify-between text-base font-bold" style={{ color: 'var(--site-text)' }}>
            <span>Estimated Total</span>
            <span style={{ color: 'var(--site-brand)' }}>{formatCurrency(estimate.totalPrice)}</span>
          </div>
          <p className="text-[10px]" style={{ color: 'var(--site-text-muted)' }}>
            Final price confirmed at checkout
          </p>
        </div>
      )}
    </div>
  )
}

function SummaryRow({ label, price, showPrice = true }: { label: string; price?: number; showPrice?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span>{label}</span>
      {showPrice && price != null && price > 0 && (
        <span className="text-xs" style={{ color: 'var(--site-text-muted)' }}>
          {formatCurrency(price)}
        </span>
      )}
    </div>
  )
}

function amountPrefix(amount: string): string {
  if (amount === 'light') return 'Light '
  if (amount === 'extra') return 'Extra '
  return ''
}
