'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { OnScreenKeyboard } from '@/components/ui/on-screen-keyboard'

interface WaitlistEntry {
  id: string
  customerName: string
  phoneNumber: string | null
  partySize: number
  position: number | null
  waitMinutes: number
  waitTimeFormatted: string
  tabName?: string | null
  depositAmount?: number | null
}

interface OpenTab {
  id: string
  tabName: string
  orderNumber: number
  displayNumber?: string
  customerName?: string
  tableName?: string
}

interface AddToWaitlistModalProps {
  isOpen: boolean
  onClose: () => void
  locationId?: string
  employeeId?: string
  menuItemId: string
  menuItemName: string
  onSuccess?: () => void
}

export function AddToWaitlistModal({
  isOpen,
  onClose,
  locationId,
  employeeId,
  menuItemId,
  menuItemName,
  onSuccess,
}: AddToWaitlistModalProps) {
  // Form state
  const [customerName, setCustomerName] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [partySize, setPartySize] = useState(1)
  const [notes, setNotes] = useState('')

  // Tab options - default to existing
  const [tabOption, setTabOption] = useState<'existing' | 'new'>('existing')
  const [selectedTabId, setSelectedTabId] = useState('')
  const [newTabCardLast4, setNewTabCardLast4] = useState('')
  const [newTabPreAuthAmount, setNewTabPreAuthAmount] = useState('')

  // Deposit
  const [takeDeposit, setTakeDeposit] = useState(false)
  const [depositAmount, setDepositAmount] = useState('')
  const [depositMethod, setDepositMethod] = useState<'cash' | 'card'>('card')
  const [depositCardLast4, setDepositCardLast4] = useState('')
  const [cashDepositPIN, setCashDepositPIN] = useState('')

  // Data
  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([])
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [focusedField, setFocusedField] = useState<string | null>(null)

  // Fetch waitlist and open tabs when modal opens
  useEffect(() => {
    if (isOpen && locationId && menuItemId) {
      fetchData()
    }
  }, [isOpen, locationId, menuItemId])

  const fetchData = async () => {
    setIsLoading(true)
    try {
      // Fetch waitlist for this item
      const waitlistRes = await fetch(`/api/entertainment/waitlist?locationId=${locationId}&menuItemId=${menuItemId}&status=waiting`)
      if (waitlistRes.ok) {
        const raw = await waitlistRes.json()
        const data = raw.data ?? raw
        setWaitlist(data.waitlist || [])
      }

      // Fetch open tabs
      const tabsRes = await fetch(`/api/orders/open?locationId=${locationId}`)
      if (tabsRes.ok) {
        const raw = await tabsRes.json()
        const data = raw.data ?? raw
        setOpenTabs(data.orders?.map((o: {
          id: string
          tabName: string | null
          orderNumber: number
          displayNumber?: string
          customer?: { name: string } | null
          table?: { name: string; section?: string | null } | null
        }) => {
          // Build a display name: prefer tabName, then customer name, then order number
          let displayName = o.tabName
          if (!displayName && o.customer?.name) {
            displayName = o.customer.name
          }
          if (!displayName) {
            displayName = `Order #${o.displayNumber || o.orderNumber}`
          }

          return {
            id: o.id,
            tabName: displayName,
            orderNumber: o.orderNumber,
            displayNumber: o.displayNumber,
            customerName: o.customer?.name || null,
            tableName: o.table?.name || null,
          }
        }) || [])
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

    // Validate tab selection
    if (tabOption === 'existing' && !selectedTabId) {
      setError('Please select an existing tab')
      return
    }

    if (tabOption === 'new' && !newTabCardLast4) {
      setError('Please enter card last 4 digits for new tab')
      return
    }

    if (takeDeposit && !depositAmount) {
      setError('Please enter deposit amount')
      return
    }

    // For card deposits, use the new tab card if creating new tab, otherwise require separate entry
    if (takeDeposit && depositMethod === 'card' && tabOption !== 'new' && !depositCardLast4) {
      setError('Please enter card last 4 digits for deposit')
      return
    }

    // Cash deposits require PIN
    if (takeDeposit && depositMethod === 'cash' && !cashDepositPIN) {
      setError('Please enter employee PIN for cash deposit')
      return
    }

    setIsSubmitting(true)
    try {
      const response = await fetch('/api/entertainment/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          menuItemId,
          employeeId,
          customerName: customerName.trim(),
          phoneNumber: phoneNumber.trim() || undefined,
          partySize,
          notes: notes.trim() || undefined,
          // Tab options
          tabId: tabOption === 'existing' ? selectedTabId : undefined,
          createNewTab: tabOption === 'new',
          newTabCardLast4: tabOption === 'new' ? newTabCardLast4 : undefined,
          newTabPreAuthAmount: tabOption === 'new' && newTabPreAuthAmount ? parseFloat(newTabPreAuthAmount) : undefined,
          // Deposit
          depositAmount: takeDeposit ? parseFloat(depositAmount) : undefined,
          depositMethod: takeDeposit ? depositMethod : undefined,
          // For card deposits: use new tab card if creating new tab, otherwise use deposit card input
          depositCardLast4: takeDeposit && depositMethod === 'card'
            ? (tabOption === 'new' ? newTabCardLast4 : depositCardLast4)
            : undefined,
          // PIN required for cash deposits
          cashDepositPIN: takeDeposit && depositMethod === 'cash' ? cashDepositPIN : undefined,
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
      setTabOption('existing')
      setSelectedTabId('')
      setNewTabCardLast4('')
      setNewTabPreAuthAmount('')
      setTakeDeposit(false)
      setDepositAmount('')
      setDepositMethod('card')
      setDepositCardLast4('')
      setCashDepositPIN('')

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
                          {entry.tabName && <span className="ml-2 text-blue-700 font-semibold">Tab: {entry.tabName}</span>}
                          {entry.depositAmount && <span className="ml-2 text-green-700 font-semibold">${entry.depositAmount} deposit</span>}
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

            {/* Tab Options - Required */}
            <div className="border-2 border-blue-400 rounded-lg p-4 bg-blue-50">
              <label className="block text-sm font-bold text-blue-900 mb-3">
                Link to Tab <span className="text-red-600">*</span>
              </label>
              <div className="space-y-3">
                <label className={`flex items-center gap-3 cursor-pointer p-3 rounded-lg border-2 transition-all ${
                  tabOption === 'existing' ? 'border-blue-500 bg-blue-100' : 'border-transparent hover:bg-blue-100'
                }`}>
                  <input
                    type="radio"
                    name="tabOption"
                    checked={tabOption === 'existing'}
                    onChange={() => setTabOption('existing')}
                    className="text-blue-600 w-5 h-5"
                  />
                  <span className="font-bold text-gray-900">Use existing tab</span>
                </label>
                {tabOption === 'existing' && (
                  <select
                    value={selectedTabId}
                    onChange={(e) => setSelectedTabId(e.target.value)}
                    className="w-full px-3 py-3 border-2 border-blue-400 rounded-lg font-bold text-gray-900 bg-white ml-2"
                  >
                    <option value="">Select a tab...</option>
                    {openTabs.map((tab) => (
                      <option key={tab.id} value={tab.id}>
                        {tab.tabName}
                        {tab.tableName && ` @ ${tab.tableName}`}
                        {' '}(#{tab.displayNumber || tab.orderNumber})
                      </option>
                    ))}
                  </select>
                )}
                <label className={`flex items-center gap-3 cursor-pointer p-3 rounded-lg border-2 transition-all ${
                  tabOption === 'new' ? 'border-blue-500 bg-blue-100' : 'border-transparent hover:bg-blue-100'
                }`}>
                  <input
                    type="radio"
                    name="tabOption"
                    checked={tabOption === 'new'}
                    onChange={() => setTabOption('new')}
                    className="text-blue-600 w-5 h-5"
                  />
                  <span className="font-bold text-gray-900">Start new tab with card</span>
                </label>
                {tabOption === 'new' && (
                  <div className="ml-2 space-y-2">
                    <Input
                      type="text"
                      value={newTabCardLast4}
                      onChange={(e) => setNewTabCardLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
                      placeholder="Card last 4 digits *"
                      maxLength={4}
                      className="border-2 border-blue-400 font-bold text-lg"
                    />
                    <Input
                      type="number"
                      value={newTabPreAuthAmount}
                      onChange={(e) => setNewTabPreAuthAmount(e.target.value)}
                      placeholder="Pre-auth amount (optional)"
                      min="0"
                      step="0.01"
                      className="border-2 border-blue-300 font-medium"
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Deposit Option */}
            <div className="border-2 border-green-400 rounded-lg p-4 bg-green-50">
              <label className="flex items-center gap-3 cursor-pointer mb-3">
                <input
                  type="checkbox"
                  checked={takeDeposit}
                  onChange={(e) => setTakeDeposit(e.target.checked)}
                  className="text-green-600 rounded w-5 h-5"
                />
                <span className="font-bold text-green-900">Take deposit to hold position</span>
              </label>
              {takeDeposit && (
                <div className="space-y-3 ml-8">
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <label className="block text-xs font-bold text-green-800 mb-1">Amount</label>
                      <Input
                        type="number"
                        value={depositAmount}
                        onChange={(e) => setDepositAmount(e.target.value)}
                        placeholder="$0.00"
                        min="0"
                        step="0.01"
                        className="border-2 border-green-300 font-medium"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-green-800 mb-1">Method</label>
                      <select
                        value={depositMethod}
                        onChange={(e) => setDepositMethod(e.target.value as 'cash' | 'card')}
                        className="px-4 py-2 border-2 border-green-300 rounded-md font-medium bg-white h-10"
                      >
                        <option value="card">Card</option>
                        <option value="cash">Cash</option>
                      </select>
                    </div>
                  </div>
                  {/* Card deposit: only show card input if using existing tab (new tab uses same card) */}
                  {depositMethod === 'card' && tabOption === 'existing' && (
                    <Input
                      type="text"
                      value={depositCardLast4}
                      onChange={(e) => setDepositCardLast4(e.target.value.replace(/\D/g, '').slice(0, 4))}
                      placeholder="Card last 4 digits"
                      maxLength={4}
                      className="border-2 border-green-300 font-medium"
                    />
                  )}
                  {/* Card deposit with new tab: show note that same card is used */}
                  {depositMethod === 'card' && tabOption === 'new' && newTabCardLast4 && (
                    <div className="bg-blue-50 border-2 border-blue-300 rounded-lg p-2 text-sm text-blue-800 font-medium">
                      Using card ending in <span className="font-bold">{newTabCardLast4}</span> from new tab
                    </div>
                  )}
                  {/* Cash deposit: require employee PIN */}
                  {depositMethod === 'cash' && (
                    <div className="space-y-2">
                      <label className="block text-xs font-bold text-amber-800 mb-1">
                        Employee PIN Required *
                      </label>
                      <Input
                        type="password"
                        value={cashDepositPIN}
                        onChange={(e) => setCashDepositPIN(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="Enter your PIN"
                        maxLength={6}
                        className="border-2 border-amber-400 font-bold text-lg bg-amber-50"
                      />
                      <p className="text-xs text-amber-700">Cash deposits require manager approval</p>
                    </div>
                  )}
                </div>
              )}
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
