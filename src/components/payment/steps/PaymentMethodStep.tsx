/**
 * Payment Method Selection Step
 *
 * Displays payment method buttons (Cash, Credit, Debit, Gift Card, House Account)
 * and handles method selection.
 */

import React from 'react'

interface PaymentMethodStepProps {
  remainingAmount: number
  selectedMethod: 'cash' | 'credit' | 'debit' | 'gift_card' | 'house_account' | null
  onSelectMethod: (method: 'cash' | 'credit' | 'debit' | 'gift_card' | 'house_account') => void
  enabledMethods?: {
    cash?: boolean
    credit?: boolean
    debit?: boolean
    giftCard?: boolean
    houseAccount?: boolean
  }
}

export function PaymentMethodStep({
  remainingAmount,
  selectedMethod,
  onSelectMethod,
  enabledMethods = {
    cash: true,
    credit: true,
    debit: true,
    giftCard: true,
    houseAccount: true,
  },
}: PaymentMethodStepProps) {
  const methods = [
    {
      id: 'cash' as const,
      label: 'Cash',
      description: 'Exact change or calculate change due',
      icon: '💵',
      enabled: enabledMethods.cash,
      color: 'bg-green-500 hover:bg-green-600',
    },
    {
      id: 'credit' as const,
      label: 'Credit Card',
      description: 'Process with card reader',
      icon: '💳',
      enabled: enabledMethods.credit,
      color: 'bg-blue-500 hover:bg-blue-600',
    },
    {
      id: 'debit' as const,
      label: 'Debit Card',
      description: 'Process with card reader',
      icon: '💳',
      enabled: enabledMethods.debit,
      color: 'bg-indigo-500 hover:bg-indigo-600',
    },
    {
      id: 'gift_card' as const,
      label: 'Gift Card',
      description: 'Enter gift card number',
      icon: '🎁',
      enabled: enabledMethods.giftCard,
      color: 'bg-purple-500 hover:bg-purple-600',
    },
    {
      id: 'house_account' as const,
      label: 'House Account',
      description: 'Charge to customer account',
      icon: '🏠',
      enabled: enabledMethods.houseAccount,
      color: 'bg-orange-500 hover:bg-orange-600',
    },
  ]

  return (
    <div className="space-y-3">
      {remainingAmount > 0 && (
        <div className="text-sm text-gray-600 mb-3 p-2 bg-green-50 rounded">
          Split Payment: Select payment method for remaining{' '}
          <span className="font-bold">${remainingAmount.toFixed(2)}</span>
        </div>
      )}

      {methods.filter(m => m.enabled).map((method) => (
        <button
          key={method.id}
          onClick={() => onSelectMethod(method.id)}
          className={`w-full p-4 rounded-lg text-white font-bold transition-all ${
            selectedMethod === method.id
              ? `${method.color} ring-4 ring-offset-2 ring-blue-300`
              : `${method.color}`
          }`}
        >
          <div className="text-left flex items-center gap-3">
            <span className="text-2xl">{method.icon}</span>
            <div className="flex-1">
              <div className="text-lg">{method.label}</div>
              <div className="text-sm opacity-90 font-normal">
                {method.description}
              </div>
            </div>
            {selectedMethod === method.id && (
              <span className="text-xl">✓</span>
            )}
          </div>
        </button>
      ))}
    </div>
  )
}
