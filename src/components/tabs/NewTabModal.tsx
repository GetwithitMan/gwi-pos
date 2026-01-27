'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'
import { formatCurrency } from '@/lib/utils'

interface NewTabModalProps {
  isOpen: boolean
  onClose: () => void
  onCreateTab: (data: {
    tabName?: string
    preAuth?: {
      cardBrand: string
      cardLast4: string
      amount?: number
    }
  }) => Promise<void>
  employeeId: string
  defaultPreAuthAmount?: number
}

const CARD_BRANDS = [
  { id: 'visa', name: 'Visa', icon: '💳' },
  { id: 'mastercard', name: 'Mastercard', icon: '💳' },
  { id: 'amex', name: 'Amex', icon: '💳' },
  { id: 'discover', name: 'Discover', icon: '💳' },
]

export function NewTabModal({
  isOpen,
  onClose,
  onCreateTab,
  employeeId,
  defaultPreAuthAmount = 50,
}: NewTabModalProps) {
  const [tabName, setTabName] = useState('')
  const [usePreAuth, setUsePreAuth] = useState(false)
  const [cardLast4, setCardLast4] = useState('')
  const [cardBrand, setCardBrand] = useState('visa')
  const [preAuthAmount, setPreAuthAmount] = useState(defaultPreAuthAmount)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const resetForm = () => {
    setTabName('')
    setUsePreAuth(false)
    setCardLast4('')
    setCardBrand('visa')
    setPreAuthAmount(defaultPreAuthAmount)
    setError(null)
  }

  const handleClose = () => {
    resetForm()
    onClose()
  }

  const handleSubmit = async () => {
    setError(null)

    // Validate pre-auth if enabled
    if (usePreAuth) {
      if (!cardLast4 || cardLast4.length !== 4) {
        setError('Please enter the last 4 digits of the card')
        return
      }
      if (!/^\d{4}$/.test(cardLast4)) {
        setError('Card digits must be numbers only')
        return
      }
    }

    setIsSubmitting(true)

    try {
      await onCreateTab({
        tabName: tabName.trim() || undefined,
        preAuth: usePreAuth
          ? {
              cardBrand,
              cardLast4,
              amount: preAuthAmount,
            }
          : undefined,
      })
      handleClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create tab')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="New Tab">
      <div className="space-y-4">
        {/* Tab Name */}
        <div>
          <Label htmlFor="tabName">Tab Name (optional)</Label>
          <Input
            id="tabName"
            value={tabName}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTabName(e.target.value)}
            placeholder="e.g., John's Table, VIP Booth"
            className="mt-1"
          />
          <p className="text-xs text-gray-500 mt-1">
            Leave blank to use "Tab #{'{'}number{'}'}"
          </p>
        </div>

        {/* Pre-Auth Toggle */}
        <div className="border rounded-lg p-4">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={usePreAuth}
              onChange={(e) => setUsePreAuth(e.target.checked)}
              className="w-5 h-5 rounded"
            />
            <div>
              <span className="font-medium">Hold a Card</span>
              <p className="text-sm text-gray-500">
                Pre-authorize a card to secure the tab
              </p>
            </div>
          </label>

          {usePreAuth && (
            <div className="mt-4 space-y-4 pt-4 border-t">
              {/* Card Brand Selection */}
              <div>
                <Label>Card Type</Label>
                <div className="grid grid-cols-4 gap-2 mt-1">
                  {CARD_BRANDS.map((brand) => (
                    <button
                      key={brand.id}
                      type="button"
                      onClick={() => setCardBrand(brand.id)}
                      className={`p-2 rounded border text-center text-sm ${
                        cardBrand === brand.id
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      <span className="block text-lg">{brand.icon}</span>
                      {brand.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Last 4 Digits */}
              <div>
                <Label htmlFor="cardLast4">Last 4 Digits</Label>
                <Input
                  id="cardLast4"
                  value={cardLast4}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                    const val = e.target.value.replace(/\D/g, '').slice(0, 4)
                    setCardLast4(val)
                  }}
                  placeholder="1234"
                  maxLength={4}
                  className="mt-1 text-center text-2xl tracking-widest font-mono"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Simulated pre-auth (no real charge)
                </p>
              </div>

              {/* Pre-Auth Amount */}
              <div>
                <Label htmlFor="preAuthAmount">Hold Amount</Label>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-lg">$</span>
                  <Input
                    id="preAuthAmount"
                    type="number"
                    value={preAuthAmount}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPreAuthAmount(Number(e.target.value))}
                    min={1}
                    step={10}
                    className="w-32"
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Amount to hold on the card
                </p>
              </div>

              {/* Quick Amounts */}
              <div className="flex gap-2">
                {[25, 50, 100, 200].map((amount) => (
                  <button
                    key={amount}
                    type="button"
                    onClick={() => setPreAuthAmount(amount)}
                    className={`flex-1 py-2 rounded border text-sm ${
                      preAuthAmount === amount
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    {formatCurrency(amount)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <Button
            variant="ghost"
            className="flex-1"
            onClick={handleClose}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            className="flex-1"
            onClick={handleSubmit}
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Creating...' : 'Start Tab'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
