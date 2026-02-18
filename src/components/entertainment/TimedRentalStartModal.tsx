'use client'

import { useState } from 'react'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/utils'
import type { MenuItem } from '@/types'

type RateType = 'per15Min' | 'per30Min' | 'perHour'

interface TimedRentalStartModalProps {
  isOpen: boolean
  item: MenuItem | null
  onStart: (rateType: RateType) => void
  onClose: () => void
  loading?: boolean
}

export function TimedRentalStartModal({ isOpen, item, onStart, onClose, loading }: TimedRentalStartModalProps) {
  const [selectedRateType, setSelectedRateType] = useState<RateType>('perHour')

  if (!item) return null

  const pricing = item.timedPricing

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={item.name} size="md" variant="default">
      <p className="text-sm text-purple-600 -mt-3 mb-4">Start a timed session</p>
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Select Rate
        </label>
        <div className="space-y-2">
          {pricing?.per15Min ? (
            <button
              onClick={() => setSelectedRateType('per15Min')}
              className={`w-full p-3 rounded-lg border-2 text-left flex justify-between items-center ${
                selectedRateType === 'per15Min'
                  ? 'border-purple-500 bg-purple-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <span>Per 15 minutes</span>
              <span className="font-bold">{formatCurrency(pricing.per15Min)}</span>
            </button>
          ) : null}
          {pricing?.per30Min ? (
            <button
              onClick={() => setSelectedRateType('per30Min')}
              className={`w-full p-3 rounded-lg border-2 text-left flex justify-between items-center ${
                selectedRateType === 'per30Min'
                  ? 'border-purple-500 bg-purple-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <span>Per 30 minutes</span>
              <span className="font-bold">{formatCurrency(pricing.per30Min)}</span>
            </button>
          ) : null}
          {pricing?.perHour ? (
            <button
              onClick={() => setSelectedRateType('perHour')}
              className={`w-full p-3 rounded-lg border-2 text-left flex justify-between items-center ${
                selectedRateType === 'perHour'
                  ? 'border-purple-500 bg-purple-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <span>Per hour</span>
              <span className="font-bold">{formatCurrency(pricing.perHour)}</span>
            </button>
          ) : null}
          {!pricing?.per15Min &&
           !pricing?.per30Min &&
           !pricing?.perHour && (
            <button
              onClick={() => setSelectedRateType('perHour')}
              className="w-full p-3 rounded-lg border-2 text-left flex justify-between items-center border-purple-500 bg-purple-50"
            >
              <span>Per hour (base rate)</span>
              <span className="font-bold">{formatCurrency(item.price)}</span>
            </button>
          )}
        </div>
      </div>
      {pricing?.minimum && (
        <p className="text-sm text-gray-500 mb-4">
          Minimum: {pricing.minimum} minutes
        </p>
      )}
      <div className="flex gap-3 mt-4">
        <Button
          variant="outline"
          onClick={onClose}
          className="flex-1"
        >
          Cancel
        </Button>
        <Button
          onClick={() => onStart(selectedRateType)}
          disabled={loading}
          className="flex-1 bg-purple-500 hover:bg-purple-600"
        >
          {loading ? 'Starting...' : 'Start Timer'}
        </Button>
      </div>
    </Modal>
  )
}
