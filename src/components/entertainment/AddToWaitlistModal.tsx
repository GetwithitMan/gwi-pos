'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { OnScreenKeyboard } from '@/components/ui/on-screen-keyboard'

interface WaitlistEntry {
  id: string
  customerName: string
  phone: string | null
  partySize: number
  position: number | null
  waitMinutes: number
  waitTimeFormatted: string
}

interface AddToWaitlistModalProps {
  isOpen: boolean
  onClose: () => void
  locationId?: string
  employeeId?: string
  /** @deprecated Use elementId instead */
  menuItemId?: string
  /** FloorPlanElement ID for the entertainment item */
  elementId?: string
  menuItemName: string
  onSuccess?: () => void
}

export function AddToWaitlistModal({
  isOpen,
  onClose,
  locationId,
  employeeId,
  menuItemId: menuItemIdProp,
  elementId: elementIdProp,
  menuItemName,
  onSuccess,
}: AddToWaitlistModalProps) {
  // Prefer elementId prop; fall back to menuItemId for backward compat
  const elementId = elementIdProp || menuItemIdProp || ''
  // Form state
  const [customerName, setCustomerName] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [partySize, setPartySize] = useState(1)
  const [notes, setNotes] = useState('')

  // Data
  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [focusedField, setFocusedField] = useState<string | null>(null)

  // Fetch waitlist when modal opens
  useEffect(() => {
    if (isOpen && locationId && elementId) {
      fetchData()
    }
  }, [isOpen, locationId, elementId])

  const fetchData = async () => {
    setIsLoading(true)
    try {
      // Fetch waitlist for this item
      const waitlistRes = await fetch(`/api/entertainment/waitlist?locationId=${locationId}&elementId=${elementId}&status=waiting`)
      if (waitlistRes.ok) {
        const raw = await waitlistRes.json()
        const data = raw.data ?? raw
        setWaitlist(data.waitlist || [])
      }
    } catch (err) {
      console.error('Failed to fetch data:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!customerName.trim()) {
      setError('Please enter a name')
      return
    }

    setIsSubmitting(true)
    try {
      const response = await fetch('/api/entertainment/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          elementId,
          employeeId,
          customerName: customerName.trim(),
          phone: phoneNumber.trim() || undefined,
          partySize,
          notes: notes.trim() || undefined,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to add to waitlist')
      }

      // Reset form
      setCustomerName('')
      setPhoneNumber('')
      setPartySize(1)
      setNotes('')

      // Refresh waitlist
      await fetchData()
      onSuccess?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add to waitlist')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-4 border-b-2 border-amber-400 bg-amber-500">
          <div>
            <h2 className="text-xl font-bold text-white">{menuItemName}</h2>
            <p className="text-sm text-amber-100 font-medium">Add to Waitlist</p>
          </div>
          <button onClick={onClose} className="text-white hover:text-amber-200" aria-label="Close modal">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto flex-1">
          {/* Current Waitlist */}
          <div className="p-4 border-b-2 border-amber-200 bg-amber-50">
            <h3 className="font-bold text-amber-800 mb-2 flex items-center gap-2">
              <span className="bg-amber-500 text-white text-sm px-2 py-0.5 rounded-full">{waitlist.length}</span>
              Currently Waiting
            </h3>
            {isLoading ? (
              <p className="text-sm text-gray-600 font-medium" aria-busy="true">Loading...</p>
            ) : waitlist.length === 0 ? (
              <p className="text-sm text-gray-600 font-medium">No one waiting - they&apos;ll be first!</p>
            ) : (
              <div className="space-y-2">
                {waitlist.map((entry, idx) => (
                  <div key={entry.id} className="flex items-center justify-between bg-white p-3 rounded-lg border-2 border-amber-200 shadow-sm">
                    <div className="flex items-center gap-3">
                      <span className="w-8 h-8 rounded-full bg-amber-500 text-white text-sm font-bold flex items-center justify-center">
                        {idx + 1}
                      </span>
                      <div>
                        <p className="font-bold text-gray-900">{entry.customerName.split(' ')[0]} ({entry.partySize})</p>
                        <p className="text-sm text-gray-600 font-medium">
                          {entry.waitTimeFormatted}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Add to Waitlist Form */}
          <form onSubmit={handleSubmit} className="p-4 space-y-4">
            <h3 className="font-bold text-gray-900 text-lg border-b pb-2">New Customer</h3>

            {error && (
              <div role="alert" className="p-3 bg-red-100 border-2 border-red-400 rounded-lg text-red-800 font-medium">
                {error}
              </div>
            )}

            {/* Customer name */}
            <div>
              <label className="block text-sm font-bold text-gray-800 mb-1">Name *</label>
              <div
                onClick={() => setFocusedField('name')}
                className={`w-full px-3 py-2 rounded-lg border-2 transition-colors cursor-pointer min-h-[44px] font-medium ${
                  focusedField === 'name' ? 'border-blue-500 ring-1 ring-blue-500 bg-white' : 'border-gray-300 bg-white'
                }`}
              >
                {customerName || <span className="text-gray-400">Customer name</span>}
              </div>
              {focusedField === 'name' && (
                <OnScreenKeyboard
                  value={customerName}
                  onChange={setCustomerName}
                  onSubmit={() => setFocusedField('phone')}
                  theme="light"
                  submitLabel="Next"
                  className="mt-2"
                />
              )}
            </div>

            {/* Phone and Party Size in row */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-bold text-gray-800 mb-1">Phone</label>
                <div
                  onClick={() => setFocusedField('phone')}
                  className={`w-full px-3 py-2 rounded-lg border-2 transition-colors cursor-pointer min-h-[44px] ${
                    focusedField === 'phone' ? 'border-blue-500 ring-1 ring-blue-500 bg-white' : 'border-gray-300 bg-white'
                  }`}
                >
                  {phoneNumber || <span className="text-gray-400">555-123-4567</span>}
                </div>
                {focusedField === 'phone' && (
                  <OnScreenKeyboard
                    value={phoneNumber}
                    onChange={setPhoneNumber}
                    onSubmit={() => setFocusedField(null)}
                    mode="phone"
                    theme="light"
                    className="mt-2"
                  />
                )}
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-800 mb-1">Party Size</label>
                <div className="flex items-center gap-2 bg-purple-100 border-2 border-purple-400 rounded-lg p-2">
                  <button
                    type="button"
                    aria-label="Decrease party size"
                    className="w-10 h-10 flex items-center justify-center bg-purple-500 text-white rounded-md hover:bg-purple-600 font-bold text-xl"
                    onClick={() => setPartySize(Math.max(1, partySize - 1))}
                  >
                    -
                  </button>
                  <span className="w-12 text-center text-2xl font-bold text-purple-900" aria-live="polite">{partySize}</span>
                  <button
                    type="button"
                    aria-label="Increase party size"
                    className="w-10 h-10 flex items-center justify-center bg-purple-500 text-white rounded-md hover:bg-purple-600 font-bold text-xl"
                    onClick={() => setPartySize(partySize + 1)}
                  >
                    +
                  </button>
                </div>
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-bold text-gray-800 mb-1">Notes</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-2 border-2 border-gray-300 rounded-md font-medium"
                rows={2}
                placeholder="Any special requests..."
              />
            </div>
          </form>
        </div>

        {/* Actions */}
        <div className="p-4 border-t-2 border-gray-300 bg-gray-100 flex gap-3">
          <Button type="button" variant="outline" className="flex-1 border-2 font-semibold" onClick={onClose}>
            Close
          </Button>
          <Button
            onClick={handleSubmit}
            className="flex-1 bg-amber-500 hover:bg-amber-600 text-white font-bold text-lg py-3"
            disabled={isSubmitting || !customerName.trim()}
          >
            {isSubmitting ? 'Adding...' : 'Add to Waitlist'}
          </Button>
        </div>
      </div>
    </div>
  )
}
