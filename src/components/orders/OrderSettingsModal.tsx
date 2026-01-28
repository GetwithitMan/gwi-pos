'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatCurrency } from '@/lib/utils'

interface OrderSettingsModalProps {
  isOpen: boolean
  onClose: () => void
  orderId: string
  currentTabName?: string
  currentGuestCount?: number
  currentTipTotal?: number
  currentSeparateChecks?: boolean
  orderTotal?: number
  onSave: (settings: {
    tabName?: string
    guestCount?: number
    tipTotal?: number
    separateChecks?: boolean
  }) => Promise<void>
}

const QUICK_TIP_PERCENTAGES = [15, 18, 20, 25]

export function OrderSettingsModal({
  isOpen,
  onClose,
  orderId,
  currentTabName = '',
  currentGuestCount = 1,
  currentTipTotal = 0,
  currentSeparateChecks = false,
  orderTotal = 0,
  onSave,
}: OrderSettingsModalProps) {
  const [tabName, setTabName] = useState(currentTabName)
  const [guestCount, setGuestCount] = useState(currentGuestCount)
  const [tipAmount, setTipAmount] = useState(currentTipTotal.toString())
  const [separateChecks, setSeparateChecks] = useState(currentSeparateChecks)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeSection, setActiveSection] = useState<'name' | 'guests' | 'tip' | null>(null)

  // Reset state when modal opens with new values
  useEffect(() => {
    if (isOpen) {
      setTabName(currentTabName)
      setGuestCount(currentGuestCount)
      setTipAmount(currentTipTotal.toString())
      setSeparateChecks(currentSeparateChecks)
      setError(null)
      setActiveSection(null)
    }
  }, [isOpen, currentTabName, currentGuestCount, currentTipTotal, currentSeparateChecks])

  if (!isOpen) return null

  const handleQuickTip = (percentage: number) => {
    const tip = Math.round(orderTotal * (percentage / 100) * 100) / 100
    setTipAmount(tip.toString())
  }

  const handleSave = async () => {
    setError(null)
    setIsSubmitting(true)

    try {
      await onSave({
        tabName: tabName.trim() || undefined,
        guestCount,
        tipTotal: tipAmount ? parseFloat(tipAmount) : 0,
        separateChecks,
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setIsSubmitting(false)
    }
  }

  const hasChanges =
    tabName !== currentTabName ||
    guestCount !== currentGuestCount ||
    parseFloat(tipAmount || '0') !== currentTipTotal ||
    separateChecks !== currentSeparateChecks

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="px-4 py-4 border-b-2 border-blue-400 bg-blue-500">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-white">Order Settings</h2>
              <p className="text-blue-100 font-medium text-sm">
                Order #{orderId.slice(-6).toUpperCase()}
              </p>
            </div>
            <button onClick={onClose} className="text-white hover:text-blue-200">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {error && (
            <div className="p-3 bg-red-100 border-2 border-red-400 rounded-lg text-red-800 font-medium">
              {error}
            </div>
          )}

          {/* Tab Name Section */}
          <div
            className={`border-2 rounded-lg p-4 cursor-pointer transition-all ${
              activeSection === 'name' ? 'border-blue-500 bg-blue-50' : 'border-gray-300 hover:border-blue-400'
            }`}
            onClick={() => setActiveSection(activeSection === 'name' ? null : 'name')}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                  <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" />
                  </svg>
                </div>
                <div>
                  <p className="font-bold text-gray-900">Tab Name</p>
                  <p className="text-sm text-gray-600">{tabName || 'Not set'}</p>
                </div>
              </div>
              <svg className={`w-5 h-5 text-gray-400 transition-transform ${activeSection === 'name' ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
            {activeSection === 'name' && (
              <div className="mt-4" onClick={(e) => e.stopPropagation()}>
                <Input
                  type="text"
                  value={tabName}
                  onChange={(e) => setTabName(e.target.value)}
                  placeholder="Enter tab name (e.g., John's Party)"
                  className="border-2 border-blue-400 font-medium text-lg"
                  autoFocus
                />
              </div>
            )}
          </div>

          {/* Guest Count / Separate Checks Section */}
          <div
            className={`border-2 rounded-lg p-4 cursor-pointer transition-all ${
              activeSection === 'guests' ? 'border-purple-500 bg-purple-50' : 'border-gray-300 hover:border-purple-400'
            }`}
            onClick={() => setActiveSection(activeSection === 'guests' ? null : 'guests')}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center">
                  <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                </div>
                <div>
                  <p className="font-bold text-gray-900">Guests & Seating</p>
                  <p className="text-sm text-gray-600">
                    {guestCount} guest{guestCount !== 1 ? 's' : ''}
                    {separateChecks && ' • Separate checks'}
                  </p>
                </div>
              </div>
              <svg className={`w-5 h-5 text-gray-400 transition-transform ${activeSection === 'guests' ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
            {activeSection === 'guests' && (
              <div className="mt-4 space-y-4" onClick={(e) => e.stopPropagation()}>
                {/* Guest Count */}
                <div>
                  <label className="block text-sm font-bold text-purple-800 mb-2">Number of Guests</label>
                  <div className="flex items-center gap-3 bg-purple-100 border-2 border-purple-400 rounded-lg p-3">
                    <button
                      type="button"
                      className="w-12 h-12 flex items-center justify-center bg-purple-500 text-white rounded-lg hover:bg-purple-600 font-bold text-2xl"
                      onClick={() => setGuestCount(Math.max(1, guestCount - 1))}
                    >
                      -
                    </button>
                    <span className="flex-1 text-center text-3xl font-bold text-purple-900">{guestCount}</span>
                    <button
                      type="button"
                      className="w-12 h-12 flex items-center justify-center bg-purple-500 text-white rounded-lg hover:bg-purple-600 font-bold text-2xl"
                      onClick={() => setGuestCount(guestCount + 1)}
                    >
                      +
                    </button>
                  </div>
                </div>

                {/* Separate Checks Toggle */}
                <label className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-all ${
                  separateChecks ? 'border-purple-500 bg-purple-100' : 'border-gray-300 hover:border-purple-400'
                }`}>
                  <input
                    type="checkbox"
                    checked={separateChecks}
                    onChange={(e) => setSeparateChecks(e.target.checked)}
                    className="w-5 h-5 text-purple-600 rounded"
                  />
                  <div>
                    <span className="font-bold text-gray-900">Separate Checks</span>
                    <p className="text-sm text-gray-600">Each guest pays individually</p>
                  </div>
                </label>
              </div>
            )}
          </div>

          {/* Gratuity Section */}
          <div
            className={`border-2 rounded-lg p-4 cursor-pointer transition-all ${
              activeSection === 'tip' ? 'border-green-500 bg-green-50' : 'border-gray-300 hover:border-green-400'
            }`}
            onClick={() => setActiveSection(activeSection === 'tip' ? null : 'tip')}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
                  <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <p className="font-bold text-gray-900">Gratuity</p>
                  <p className="text-sm text-gray-600">
                    {parseFloat(tipAmount || '0') > 0 ? formatCurrency(parseFloat(tipAmount)) : 'Not set'}
                  </p>
                </div>
              </div>
              <svg className={`w-5 h-5 text-gray-400 transition-transform ${activeSection === 'tip' ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
            {activeSection === 'tip' && (
              <div className="mt-4 space-y-4" onClick={(e) => e.stopPropagation()}>
                {/* Quick tip percentages */}
                {orderTotal > 0 && (
                  <div>
                    <label className="block text-sm font-bold text-green-800 mb-2">Quick Select</label>
                    <div className="grid grid-cols-4 gap-2">
                      {QUICK_TIP_PERCENTAGES.map((pct) => {
                        const tipValue = Math.round(orderTotal * (pct / 100) * 100) / 100
                        const isSelected = parseFloat(tipAmount || '0') === tipValue
                        return (
                          <button
                            key={pct}
                            type="button"
                            className={`p-2 rounded-lg font-bold text-sm transition-colors ${
                              isSelected
                                ? 'bg-green-500 text-white'
                                : 'bg-green-100 text-green-800 hover:bg-green-200'
                            }`}
                            onClick={() => handleQuickTip(pct)}
                          >
                            <div>{pct}%</div>
                            <div className="text-xs">{formatCurrency(tipValue)}</div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Custom amount */}
                <div>
                  <label className="block text-sm font-bold text-green-800 mb-2">Custom Amount</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-bold">$</span>
                    <Input
                      type="number"
                      value={tipAmount}
                      onChange={(e) => setTipAmount(e.target.value)}
                      placeholder="0.00"
                      min="0"
                      step="0.01"
                      className="pl-7 border-2 border-green-400 font-bold text-lg"
                    />
                  </div>
                </div>

                {/* Clear tip button */}
                {parseFloat(tipAmount || '0') > 0 && (
                  <button
                    type="button"
                    className="w-full p-2 text-red-600 hover:bg-red-50 rounded font-medium text-sm"
                    onClick={() => setTipAmount('0')}
                  >
                    Remove Gratuity
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="p-4 border-t-2 border-gray-300 bg-gray-100 flex gap-3">
          <Button
            type="button"
            variant="outline"
            className="flex-1 border-2 font-semibold"
            onClick={onClose}
          >
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            className="flex-1 bg-blue-500 hover:bg-blue-600 text-white font-bold"
            disabled={isSubmitting || !hasChanges}
          >
            {isSubmitting ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </div>
    </div>
  )
}
