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
    <div className="py-4">
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
          Your Pizza
        </h3>

        {/* Configuration summary */}
        <div className="space-y-1.5 text-sm text-gray-900">
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
                  <div key={i} className="flex items-center justify-between text-xs text-gray-700">
                    <span>{prefix}{t.name}{placement}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Price breakdown */}
        {estimate && (
          <div className="border-t border-gray-200 pt-3 space-y-1">
            {estimate.toppingsPrice > 0 && (
              <div className="flex justify-between text-xs text-gray-400">
                <span>Toppings ({toppings.length})</span>
                <span>+{formatCurrency(estimate.toppingsPrice)}</span>
              </div>
            )}
            {estimate.freeToppingsUsed > 0 && (
              <div className="flex justify-between text-xs text-blue-500">
                <span>{estimate.freeToppingsUsed} free topping{estimate.freeToppingsUsed > 1 ? 's' : ''} applied</span>
              </div>
            )}
            <div className="flex justify-between text-base font-bold text-gray-900">
              <span>Estimated Total</span>
              <span className="text-blue-600">{formatCurrency(estimate.totalPrice)}</span>
            </div>
            <p className="text-[10px] text-gray-400">
              Final price confirmed at checkout
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function SummaryRow({ label, price, showPrice = true }: { label: string; price?: number; showPrice?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span>{label}</span>
      {showPrice && price != null && price > 0 && (
        <span className="text-xs text-gray-400">
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
