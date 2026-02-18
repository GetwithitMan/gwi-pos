'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { OnScreenKeyboard } from '@/components/ui/on-screen-keyboard'
import { formatCurrency } from '@/lib/utils'
import { Modal } from '@/components/ui/modal'

interface Customer {
  id: string
  name: string
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  loyaltyPoints: number
  totalSpent: number
  totalOrders: number
  tags: string[]
  notes: string | null
}

interface CustomerLookupModalProps {
  isOpen: boolean
  onClose: () => void
  locationId: string
  currentCustomerId?: string | null
  onSelectCustomer: (customer: Customer | null) => void
  loyaltyEnabled?: boolean
}

const TAG_COLORS: Record<string, string> = {
  VIP: 'bg-yellow-100 text-yellow-800',
  Regular: 'bg-green-100 text-green-800',
  'First-Timer': 'bg-blue-100 text-blue-800',
  Staff: 'bg-purple-100 text-purple-800',
  Family: 'bg-pink-100 text-pink-800',
  Business: 'bg-gray-100 text-gray-800',
  'Birthday Club': 'bg-red-100 text-red-800',
}

export function CustomerLookupModal({
  isOpen,
  onClose,
  locationId,
  currentCustomerId,
  onSelectCustomer,
  loyaltyEnabled,
}: CustomerLookupModalProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [customers, setCustomers] = useState<Customer[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [showQuickAdd, setShowQuickAdd] = useState(false)
  const [quickAddData, setQuickAddData] = useState({
    firstName: '',
    lastName: '',
    phone: '',
  })
  const [isAdding, setIsAdding] = useState(false)
  const [focusedField, setFocusedField] = useState<string | null>('search')

  useEffect(() => {
    if (isOpen && searchTerm.length >= 2) {
      searchCustomers()
    }
  }, [isOpen, searchTerm])

  useEffect(() => {
    if (!isOpen) {
      setSearchTerm('')
      setCustomers([])
      setShowQuickAdd(false)
    }
  }, [isOpen])

  const searchCustomers = async () => {
    if (!locationId || searchTerm.length < 2) return

    setIsLoading(true)
    try {
      const params = new URLSearchParams({
        locationId,
        search: searchTerm,
        limit: '10',
      })

      const response = await fetch(`/api/customers?${params}`)
      if (response.ok) {
        const data = await response.json()
        setCustomers(data.customers)
      }
    } catch (err) {
      console.error('Failed to search customers:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSelect = (customer: Customer) => {
    onSelectCustomer(customer)
    onClose()
  }

  const handleRemove = () => {
    onSelectCustomer(null)
    onClose()
  }

  const handleQuickAdd = async () => {
    if (!quickAddData.firstName.trim() || !quickAddData.lastName.trim()) {
      return
    }

    setIsAdding(true)
    try {
      const response = await fetch('/api/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          firstName: quickAddData.firstName.trim(),
          lastName: quickAddData.lastName.trim(),
          phone: quickAddData.phone.trim() || null,
          tags: ['First-Timer'],
        }),
      })

      if (response.ok) {
        const customer = await response.json()
        onSelectCustomer(customer)
        onClose()
      }
    } catch (err) {
      console.error('Failed to add customer:', err)
    } finally {
      setIsAdding(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Customer Lookup" size="lg" variant="default">
        {loyaltyEnabled && (
          <p className="text-sm text-blue-600 -mt-3 mb-3">Loyalty Points Program Active</p>
        )}

        {/* Search */}
        <div className="p-4 border-b">
          <div
            onClick={() => setFocusedField('search')}
            className={`w-full px-3 py-2 rounded-lg border transition-colors cursor-pointer min-h-[44px] ${
              focusedField === 'search' ? 'border-blue-500 ring-1 ring-blue-500 bg-white' : 'border-gray-300 bg-white'
            }`}
          >
            {searchTerm || <span className="text-gray-400">Search by name, phone, or email...</span>}
          </div>
          {focusedField === 'search' && (
            <OnScreenKeyboard
              value={searchTerm}
              onChange={setSearchTerm}
              onSubmit={() => setFocusedField(null)}
              theme="light"
              className="mt-2"
            />
          )}
          <p className="text-xs text-gray-500 mt-1">
            Type at least 2 characters to search
          </p>
        </div>

        {/* Results */}
        <div className="flex-1 overflow-y-auto p-2">
          {isLoading ? (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
            </div>
          ) : customers.length > 0 ? (
            <div className="space-y-2">
              {customers.map(customer => (
                <button
                  key={customer.id}
                  onClick={() => handleSelect(customer)}
                  className={`w-full text-left p-3 rounded-lg border transition-colors ${
                    customer.id === currentCustomerId
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-medium">{customer.name}</div>
                      {customer.phone && (
                        <div className="text-sm text-gray-500">{customer.phone}</div>
                      )}
                      {customer.email && (
                        <div className="text-sm text-gray-500">{customer.email}</div>
                      )}
                    </div>
                    {loyaltyEnabled && (
                      <div className="text-right">
                        <div className="text-lg font-bold text-blue-600">
                          {customer.loyaltyPoints} pts
                        </div>
                        <div className="text-xs text-gray-500">
                          {customer.totalOrders} orders
                        </div>
                      </div>
                    )}
                  </div>

                  {customer.tags.length > 0 && (
                    <div className="flex gap-1 mt-2 flex-wrap">
                      {customer.tags.map(tag => (
                        <span
                          key={tag}
                          className={`px-2 py-0.5 rounded-full text-xs font-medium ${TAG_COLORS[tag] || 'bg-gray-100 text-gray-700'}`}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  {customer.notes && (
                    <div className="mt-2 text-xs text-orange-600 bg-orange-50 p-2 rounded">
                      Note: {customer.notes}
                    </div>
                  )}
                </button>
              ))}
            </div>
          ) : searchTerm.length >= 2 ? (
            <div className="text-center py-8">
              <p className="text-gray-500 mb-4">No customers found</p>
              <Button
                variant="outline"
                onClick={() => setShowQuickAdd(true)}
              >
                + Add New Customer
              </Button>
            </div>
          ) : (
            <div className="text-center py-8 text-gray-500">
              <p>Enter a name, phone, or email to search</p>
            </div>
          )}

          {/* Quick Add Form */}
          {showQuickAdd && (
            <div className="mt-4 p-4 border rounded-lg bg-gray-50">
              <h3 className="font-medium mb-3">Quick Add Customer</h3>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div
                      onClick={() => setFocusedField('firstName')}
                      className={`w-full px-3 py-2 rounded-lg border transition-colors cursor-pointer min-h-[44px] ${
                        focusedField === 'firstName' ? 'border-blue-500 ring-1 ring-blue-500 bg-white' : 'border-gray-300 bg-white'
                      }`}
                    >
                      {quickAddData.firstName || <span className="text-gray-400">First Name *</span>}
                    </div>
                  </div>
                  <div>
                    <div
                      onClick={() => setFocusedField('lastName')}
                      className={`w-full px-3 py-2 rounded-lg border transition-colors cursor-pointer min-h-[44px] ${
                        focusedField === 'lastName' ? 'border-blue-500 ring-1 ring-blue-500 bg-white' : 'border-gray-300 bg-white'
                      }`}
                    >
                      {quickAddData.lastName || <span className="text-gray-400">Last Name *</span>}
                    </div>
                  </div>
                </div>
                {(focusedField === 'firstName' || focusedField === 'lastName') && (
                  <OnScreenKeyboard
                    value={focusedField === 'firstName' ? quickAddData.firstName : quickAddData.lastName}
                    onChange={(v) => setQuickAddData({ ...quickAddData, [focusedField]: v })}
                    onSubmit={() => {
                      if (focusedField === 'firstName') setFocusedField('lastName')
                      else setFocusedField('phone')
                    }}
                    theme="light"
                    submitLabel="Next"
                  />
                )}
                <div>
                  <div
                    onClick={() => setFocusedField('phone')}
                    className={`w-full px-3 py-2 rounded-lg border transition-colors cursor-pointer min-h-[44px] ${
                      focusedField === 'phone' ? 'border-blue-500 ring-1 ring-blue-500 bg-white' : 'border-gray-300 bg-white'
                    }`}
                  >
                    {quickAddData.phone || <span className="text-gray-400">Phone (optional)</span>}
                  </div>
                  {focusedField === 'phone' && (
                    <OnScreenKeyboard
                      value={quickAddData.phone}
                      onChange={(v) => setQuickAddData({ ...quickAddData, phone: v })}
                      onSubmit={() => setFocusedField(null)}
                      mode="phone"
                      theme="light"
                      className="mt-2"
                    />
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => setShowQuickAdd(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    className="flex-1"
                    onClick={handleQuickAdd}
                    disabled={isAdding || !quickAddData.firstName.trim() || !quickAddData.lastName.trim()}
                  >
                    {isAdding ? 'Adding...' : 'Add & Select'}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t bg-gray-50 flex gap-2">
          {currentCustomerId && (
            <Button
              variant="outline"
              className="flex-1 text-red-600 hover:bg-red-50"
              onClick={handleRemove}
            >
              Remove Customer
            </Button>
          )}
          <Button variant="outline" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
        </div>
    </Modal>
  )
}
