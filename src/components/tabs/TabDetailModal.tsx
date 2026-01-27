'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/modal'
import { formatCurrency } from '@/lib/utils'
import { formatCardDisplay } from '@/lib/payment'

interface TabItem {
  id: string
  name: string
  price: number
  quantity: number
  modifiers: {
    id: string
    name: string
    price: number
    preModifier?: string
  }[]
  itemTotal: number
  createdAt: string
}

interface TabPayment {
  id: string
  method: string
  amount: number
  tipAmount: number
  totalAmount: number
  cardBrand?: string
  cardLast4?: string
  status: string
  processedAt: string
}

interface TabDetail {
  id: string
  tabName: string
  orderNumber: number
  status: string
  employee: {
    id: string
    name: string
  }
  items: TabItem[]
  subtotal: number
  discountTotal: number
  taxTotal: number
  tipTotal: number
  total: number
  hasPreAuth: boolean
  preAuth: {
    id: string
    cardBrand: string
    last4: string
    amount: number | null
    expiresAt?: string
    isExpired?: boolean
  } | null
  paidAmount: number
  remainingBalance: number
  isFullyPaid: boolean
  payments: TabPayment[]
  openedAt: string
  paidAt: string | null
}

interface TabDetailModalProps {
  isOpen: boolean
  onClose: () => void
  tabId: string | null
  onAddItems: (tabId: string) => void
  onPayTab: (tabId: string) => void
  onTransferTab?: (tabId: string) => void
  onReleasePreAuth?: (tabId: string) => void
}

export function TabDetailModal({
  isOpen,
  onClose,
  tabId,
  onAddItems,
  onPayTab,
  onTransferTab,
  onReleasePreAuth,
}: TabDetailModalProps) {
  const [tab, setTab] = useState<TabDetail | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isEditingName, setIsEditingName] = useState(false)
  const [newName, setNewName] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (isOpen && tabId) {
      loadTab()
    } else {
      setTab(null)
      setError(null)
    }
  }, [isOpen, tabId])

  const loadTab = async () => {
    if (!tabId) return
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/tabs/${tabId}`)
      if (!response.ok) {
        throw new Error('Failed to load tab')
      }
      const data = await response.json()
      setTab(data)
      setNewName(data.tabName)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load tab')
    } finally {
      setIsLoading(false)
    }
  }

  const handleSaveName = async () => {
    if (!tab || !tabId) return
    setIsSaving(true)

    try {
      const response = await fetch(`/api/tabs/${tabId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tabName: newName.trim() }),
      })

      if (!response.ok) {
        throw new Error('Failed to update tab name')
      }

      const updated = await response.json()
      setTab((prev) => (prev ? { ...prev, tabName: updated.tabName } : null))
      setIsEditingName(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update')
    } finally {
      setIsSaving(false)
    }
  }

  const handleReleasePreAuth = async () => {
    if (!tabId || !onReleasePreAuth) return

    try {
      const response = await fetch(`/api/tabs/${tabId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ releasePreAuth: true }),
      })

      if (!response.ok) {
        throw new Error('Failed to release pre-auth')
      }

      await loadTab()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to release')
    }
  }

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  if (!tabId) return null

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isLoading ? 'Loading...' : tab?.tabName || 'Tab Details'}
      size="lg"
    >
      {isLoading ? (
        <div className="py-8 text-center text-gray-500">Loading tab...</div>
      ) : error ? (
        <div className="py-8 text-center text-red-600">{error}</div>
      ) : tab ? (
        <div className="space-y-4">
          {/* Header Info */}
          <div className="flex items-start justify-between pb-3 border-b">
            <div>
              {isEditingName ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={newName}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewName(e.target.value)}
                    className="w-48"
                    autoFocus
                  />
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={handleSaveName}
                    disabled={isSaving}
                  >
                    Save
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setIsEditingName(false)
                      setNewName(tab.tabName)
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-semibold">{tab.tabName}</h3>
                  <button
                    onClick={() => setIsEditingName(true)}
                    className="text-gray-400 hover:text-gray-600"
                    title="Edit name"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                      />
                    </svg>
                  </button>
                </div>
              )}
              <p className="text-sm text-gray-500">
                Opened by {tab.employee.name} at {formatTime(tab.openedAt)}
              </p>
            </div>
            <div className="text-right">
              <span
                className={`px-2 py-1 rounded text-xs font-medium ${
                  tab.status === 'open'
                    ? 'bg-green-100 text-green-700'
                    : tab.status === 'paid'
                    ? 'bg-blue-100 text-blue-700'
                    : 'bg-gray-100 text-gray-700'
                }`}
              >
                {tab.status.toUpperCase()}
              </span>
            </div>
          </div>

          {/* Pre-Auth Info */}
          {tab.hasPreAuth && tab.preAuth && (
            <div
              className={`p-3 rounded-lg ${
                tab.preAuth.isExpired
                  ? 'bg-red-50 border border-red-200'
                  : 'bg-blue-50 border border-blue-200'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <svg
                    className="w-5 h-5 text-blue-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z"
                    />
                  </svg>
                  <div>
                    <span className="font-medium">
                      {formatCardDisplay(tab.preAuth.cardBrand, tab.preAuth.last4)}
                    </span>
                    {tab.preAuth.amount && (
                      <span className="ml-2 text-gray-600">
                        (Hold: {formatCurrency(tab.preAuth.amount)})
                      </span>
                    )}
                  </div>
                </div>
                {tab.preAuth.isExpired ? (
                  <span className="text-red-600 text-sm font-medium">
                    EXPIRED
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleReleasePreAuth}
                  >
                    Release Hold
                  </Button>
                )}
              </div>
              {tab.preAuth.expiresAt && !tab.preAuth.isExpired && (
                <p className="text-xs text-gray-500 mt-1">
                  Expires: {formatDate(tab.preAuth.expiresAt)}
                </p>
              )}
            </div>
          )}

          {/* Items List */}
          <div className="max-h-64 overflow-y-auto">
            {tab.items.length === 0 ? (
              <div className="py-6 text-center text-gray-500">
                No items on this tab yet
              </div>
            ) : (
              <div className="space-y-2">
                {tab.items.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-start justify-between py-2 border-b last:border-0"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-500">
                          {item.quantity}x
                        </span>
                        <span className="font-medium">{item.name}</span>
                      </div>
                      {item.modifiers.length > 0 && (
                        <div className="ml-6 text-sm text-gray-500">
                          {item.modifiers.map((mod) => (
                            <div key={mod.id}>
                              {mod.preModifier && `${mod.preModifier} `}
                              {mod.name}
                              {mod.price > 0 && ` (+${formatCurrency(mod.price)})`}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <span className="font-medium">
                      {formatCurrency(item.itemTotal)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Totals */}
          <div className="border-t pt-3 space-y-1">
            <div className="flex justify-between text-sm">
              <span>Subtotal</span>
              <span>{formatCurrency(tab.subtotal)}</span>
            </div>
            {tab.discountTotal > 0 && (
              <div className="flex justify-between text-sm text-green-600">
                <span>Discounts</span>
                <span>-{formatCurrency(tab.discountTotal)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span>Tax</span>
              <span>{formatCurrency(tab.taxTotal)}</span>
            </div>
            {tab.tipTotal > 0 && (
              <div className="flex justify-between text-sm">
                <span>Tip</span>
                <span>{formatCurrency(tab.tipTotal)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-lg pt-2 border-t">
              <span>Total</span>
              <span>{formatCurrency(tab.total)}</span>
            </div>
            {tab.paidAmount > 0 && (
              <>
                <div className="flex justify-between text-sm text-green-600">
                  <span>Paid</span>
                  <span>-{formatCurrency(tab.paidAmount)}</span>
                </div>
                <div className="flex justify-between font-bold">
                  <span>Remaining</span>
                  <span>{formatCurrency(tab.remainingBalance)}</span>
                </div>
              </>
            )}
          </div>

          {/* Previous Payments */}
          {tab.payments.length > 0 && (
            <div className="border-t pt-3">
              <h4 className="text-sm font-medium text-gray-500 mb-2">
                Payments
              </h4>
              <div className="space-y-2">
                {tab.payments.map((payment) => (
                  <div
                    key={payment.id}
                    className="flex items-center justify-between text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <span className="capitalize">{payment.method}</span>
                      {payment.cardLast4 && (
                        <span className="text-gray-500">
                          ****{payment.cardLast4}
                        </span>
                      )}
                    </div>
                    <span>{formatCurrency(payment.totalAmount)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 pt-3 border-t">
            {tab.status === 'open' && (
              <>
                <Button
                  variant="ghost"
                  className="flex-1"
                  onClick={() => {
                    onClose()
                    onAddItems(tab.id)
                  }}
                >
                  Add Items
                </Button>
                {onTransferTab && (
                  <Button
                    variant="ghost"
                    className="flex-1"
                    onClick={() => {
                      onClose()
                      onTransferTab(tab.id)
                    }}
                  >
                    Transfer
                  </Button>
                )}
                <Button
                  variant="primary"
                  className="flex-1"
                  onClick={() => {
                    onClose()
                    onPayTab(tab.id)
                  }}
                >
                  {tab.paidAmount > 0 ? 'Pay Remaining' : 'Close & Pay'}
                </Button>
              </>
            )}
            {tab.status !== 'open' && (
              <Button variant="ghost" className="flex-1" onClick={onClose}>
                Close
              </Button>
            )}
          </div>
        </div>
      ) : null}
    </Modal>
  )
}
