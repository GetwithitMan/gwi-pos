'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { formatCurrency, formatDate } from '@/lib/utils'
import { Modal } from '@/components/ui/modal'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { useAuthStore } from '@/stores/auth-store'
import { useAdminCRUD } from '@/hooks/useAdminCRUD'

interface GiftCard {
  id: string
  cardNumber: string
  initialBalance: number
  currentBalance: number
  status: string
  recipientName?: string | null
  recipientEmail?: string | null
  purchaserName?: string | null
  message?: string | null
  expiresAt?: string | null
  createdAt: string
  _count?: { transactions: number }
}

interface GiftCardTransaction {
  id: string
  type: string
  amount: number
  balanceBefore: number
  balanceAfter: number
  notes?: string | null
  createdAt: string
}

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  depleted: 'bg-gray-100 text-gray-700',
  expired: 'bg-red-100 text-red-700',
  frozen: 'bg-blue-100 text-blue-700',
}

const TRANSACTION_TYPE_LABELS: Record<string, string> = {
  purchase: 'Initial Purchase',
  redemption: 'Redemption',
  reload: 'Reload',
  refund: 'Refund',
  adjustment: 'Adjustment',
}

export default function GiftCardsPage() {
  const router = useRouter()
  const employee = useAuthStore(s => s.employee)
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const locationId = employee?.location?.id

  const crud = useAdminCRUD<GiftCard>({
    apiBase: '/api/gift-cards',
    locationId,
    resourceName: 'gift card',
    parseResponse: (data) => Array.isArray(data) ? data : data.giftCards || [],
  })

  const {
    items: giftCards,
    showModal: showCreateModal,
    isSaving,
    modalError,
    openAddModal,
    closeModal,
    handleSave,
    setItems: setGiftCards,
  } = crud

  // Custom state — filters, detail panel, reload modal
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [selectedCard, setSelectedCard] = useState<GiftCard | null>(null)
  const [cardTransactions, setCardTransactions] = useState<GiftCardTransaction[]>([])
  const [showReloadModal, setShowReloadModal] = useState(false)

  // Create form
  const [newAmount, setNewAmount] = useState('')
  const [recipientName, setRecipientName] = useState('')
  const [recipientEmail, setRecipientEmail] = useState('')
  const [purchaserName, setPurchaserName] = useState('')
  const [message, setMessage] = useState('')

  // Reload form
  const [reloadAmount, setReloadAmount] = useState('')

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login?redirect=/gift-cards')
    }
  }, [isAuthenticated, router])

  // Custom load — useAdminCRUD's loadItems doesn't support status/search filters
  const loadGiftCards = useCallback(async () => {
    if (!locationId) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ locationId })
      if (statusFilter !== 'all') {
        params.append('status', statusFilter)
      }
      if (searchTerm) {
        params.append('search', searchTerm)
      }
      const response = await fetch(`/api/gift-cards?${params}`)
      if (response.ok) {
        const data = await response.json()
        setGiftCards(Array.isArray(data) ? data : data.giftCards || [])
      }
    } catch (error) {
      console.error('Failed to load gift cards:', error)
    } finally {
      setLoading(false)
    }
  }, [locationId, statusFilter, searchTerm, setGiftCards])

  useEffect(() => {
    if (locationId) {
      loadGiftCards()
    }
  }, [locationId, statusFilter, loadGiftCards])

  async function loadCardDetails(card: GiftCard) {
    setSelectedCard(card)
    try {
      const response = await fetch(`/api/gift-cards/${card.id}`)
      if (response.ok) {
        const data = await response.json()
        setCardTransactions(data.data.transactions || [])
      }
    } catch (error) {
      console.error('Failed to load card details:', error)
    }
  }

  async function handleCreateGiftCard(e: React.FormEvent) {
    e.preventDefault()
    if (!locationId) return

    const payload = {
      locationId,
      amount: parseFloat(newAmount),
      recipientName: recipientName || null,
      recipientEmail: recipientEmail || null,
      purchaserName: purchaserName || null,
      message: message || null,
    }

    const ok = await handleSave(payload)
    if (ok) {
      resetCreateForm()
      loadGiftCards()
    }
  }

  async function handleReload(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedCard) return

    try {
      const response = await fetch(`/api/gift-cards/${selectedCard.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reload',
          amount: parseFloat(reloadAmount),
        }),
      })

      if (response.ok) {
        setShowReloadModal(false)
        setReloadAmount('')
        loadGiftCards()
        loadCardDetails(selectedCard)
      }
    } catch (error) {
      console.error('Failed to reload gift card:', error)
    }
  }

  async function handleToggleFreeze(card: GiftCard) {
    const action = card.status === 'frozen' ? 'unfreeze' : 'freeze'
    try {
      const response = await fetch(`/api/gift-cards/${card.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })

      if (response.ok) {
        loadGiftCards()
        if (selectedCard?.id === card.id) {
          const data = await response.json()
          setSelectedCard(data.data)
        }
      }
    } catch (error) {
      console.error('Failed to toggle freeze:', error)
    }
  }

  function resetCreateForm() {
    setNewAmount('')
    setRecipientName('')
    setRecipientEmail('')
    setPurchaserName('')
    setMessage('')
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Gift Cards"
        actions={
          <Button variant="primary" onClick={openAddModal}>
            Create Gift Card
          </Button>
        }
      />

      {/* Filters */}
      <div className="max-w-7xl mx-auto mt-6">
      <div className="flex gap-4 mb-6">
        <div className="flex-1">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && loadGiftCards()}
            placeholder="Search by card number, name, or email..."
            className="w-full px-3 py-2 border rounded-lg"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border rounded-lg"
        >
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="depleted">Depleted</option>
          <option value="expired">Expired</option>
          <option value="frozen">Frozen</option>
        </select>
        <Button variant="outline" onClick={loadGiftCards}>
          Search
        </Button>
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Gift Cards List */}
        <div className="lg:col-span-2">
          <Card className="p-4">
            {loading ? (
              <div className="text-center py-8 text-gray-500">Loading...</div>
            ) : giftCards.length === 0 ? (
              <div className="text-center py-8 text-gray-500">No gift cards found</div>
            ) : (
              <div className="divide-y">
                {giftCards.map((card) => (
                  <div
                    key={card.id}
                    className={`p-4 cursor-pointer hover:bg-gray-50 ${
                      selectedCard?.id === card.id ? 'bg-blue-50' : ''
                    }`}
                    onClick={() => loadCardDetails(card)}
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="font-mono font-medium">{card.cardNumber}</div>
                        {card.recipientName && (
                          <div className="text-sm text-gray-500">To: {card.recipientName}</div>
                        )}
                      </div>
                      <div className="text-right">
                        <span className={`px-2 py-1 rounded text-xs ${STATUS_COLORS[card.status] || 'bg-gray-100'}`}>
                          {card.status.toUpperCase()}
                        </span>
                      </div>
                    </div>
                    <div className="flex justify-between mt-2 text-sm">
                      <span className="text-gray-500">
                        Initial: {formatCurrency(card.initialBalance)}
                      </span>
                      <span className="font-medium text-green-600">
                        Balance: {formatCurrency(card.currentBalance)}
                      </span>
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      Created: {formatDate(card.createdAt)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Card Details */}
        <div>
          {selectedCard ? (
            <Card className="p-4">
              <h2 className="text-lg font-bold mb-4">Card Details</h2>

              <div className="space-y-3">
                <div>
                  <label className="text-xs text-gray-500">Card Number</label>
                  <div className="font-mono">{selectedCard.cardNumber}</div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs text-gray-500">Initial</label>
                    <div>{formatCurrency(selectedCard.initialBalance)}</div>
                  </div>
                  <div>
                    <label className="text-xs text-gray-500">Current</label>
                    <div className="text-xl font-bold text-green-600">
                      {formatCurrency(selectedCard.currentBalance)}
                    </div>
                  </div>
                </div>

                <div>
                  <label className="text-xs text-gray-500">Status</label>
                  <div>
                    <span className={`px-2 py-1 rounded text-xs ${STATUS_COLORS[selectedCard.status]}`}>
                      {selectedCard.status.toUpperCase()}
                    </span>
                  </div>
                </div>

                {selectedCard.recipientName && (
                  <div>
                    <label className="text-xs text-gray-500">Recipient</label>
                    <div>{selectedCard.recipientName}</div>
                    {selectedCard.recipientEmail && (
                      <div className="text-sm text-gray-500">{selectedCard.recipientEmail}</div>
                    )}
                  </div>
                )}

                {selectedCard.purchaserName && (
                  <div>
                    <label className="text-xs text-gray-500">Purchased By</label>
                    <div>{selectedCard.purchaserName}</div>
                  </div>
                )}

                {selectedCard.message && (
                  <div>
                    <label className="text-xs text-gray-500">Message</label>
                    <div className="text-sm italic">&ldquo;{selectedCard.message}&rdquo;</div>
                  </div>
                )}

                {selectedCard.expiresAt && (
                  <div>
                    <label className="text-xs text-gray-500">Expires</label>
                    <div>{formatDate(selectedCard.expiresAt)}</div>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="mt-4 pt-4 border-t flex gap-2">
                {selectedCard.status === 'active' && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowReloadModal(true)}
                  >
                    Reload
                  </Button>
                )}
                <Button
                  variant={selectedCard.status === 'frozen' ? 'primary' : 'outline'}
                  size="sm"
                  onClick={() => handleToggleFreeze(selectedCard)}
                >
                  {selectedCard.status === 'frozen' ? 'Unfreeze' : 'Freeze'}
                </Button>
              </div>

              {/* Transaction History */}
              <div className="mt-4 pt-4 border-t">
                <h3 className="font-medium mb-2">Transaction History</h3>
                {cardTransactions.length === 0 ? (
                  <div className="text-sm text-gray-500">No transactions</div>
                ) : (
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {cardTransactions.map((txn) => (
                      <div key={txn.id} className="text-sm p-2 bg-gray-50 rounded">
                        <div className="flex justify-between">
                          <span>{TRANSACTION_TYPE_LABELS[txn.type] || txn.type}</span>
                          <span className={txn.amount >= 0 ? 'text-green-600' : 'text-red-600'}>
                            {txn.amount >= 0 ? '+' : ''}{formatCurrency(txn.amount)}
                          </span>
                        </div>
                        <div className="text-xs text-gray-500">
                          Balance: {formatCurrency(txn.balanceAfter)}
                        </div>
                        <div className="text-xs text-gray-400">
                          {formatDate(txn.createdAt)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          ) : (
            <Card className="p-8 text-center text-gray-500">
              Select a gift card to view details
            </Card>
          )}
        </div>
      </div>
      </div>

      {/* Create Modal */}
      <Modal isOpen={showCreateModal} onClose={() => { closeModal(); resetCreateForm() }} title="Create Gift Card" size="md">
        {modalError && (
          <div className="p-3 mb-4 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
            {modalError}
          </div>
        )}
        <form onSubmit={handleCreateGiftCard} className="space-y-4">
          <div>
            <label className="text-sm font-medium block mb-1">Amount *</label>
            <div className="relative">
              <span className="absolute left-3 top-2 text-gray-500">$</span>
              <input
                type="number"
                value={newAmount}
                onChange={(e) => setNewAmount(e.target.value)}
                className="w-full pl-7 pr-3 py-2 border rounded-lg"
                placeholder="0.00"
                step="0.01"
                min="1"
                required
              />
            </div>
          </div>

          <div>
            <label className="text-sm font-medium block mb-1">Recipient Name</label>
            <input
              type="text"
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg"
              placeholder="John Doe"
            />
          </div>

          <div>
            <label className="text-sm font-medium block mb-1">Recipient Email</label>
            <input
              type="email"
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg"
              placeholder="john@example.com"
            />
          </div>

          <div>
            <label className="text-sm font-medium block mb-1">Purchaser Name</label>
            <input
              type="text"
              value={purchaserName}
              onChange={(e) => setPurchaserName(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg"
              placeholder="Jane Doe"
            />
          </div>

          <div>
            <label className="text-sm font-medium block mb-1">Gift Message</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg"
              placeholder="Happy Birthday!"
              rows={2}
            />
          </div>

          <div className="flex gap-2 pt-4">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => {
                closeModal()
                resetCreateForm()
              }}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" className="flex-1" disabled={isSaving}>
              {isSaving ? 'Creating...' : 'Create Gift Card'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Reload Modal */}
      <Modal isOpen={showReloadModal && !!selectedCard} onClose={() => { setShowReloadModal(false); setReloadAmount('') }} title="Reload Gift Card" size="sm">
        {selectedCard && (
          <>
            <div className="mb-4 text-sm text-gray-500">
              {selectedCard.cardNumber}
              <br />
              Current Balance: {formatCurrency(selectedCard.currentBalance)}
            </div>
            <form onSubmit={handleReload} className="space-y-4">
              <div>
                <label className="text-sm font-medium block mb-1">Reload Amount *</label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-gray-500">$</span>
                  <input
                    type="number"
                    value={reloadAmount}
                    onChange={(e) => setReloadAmount(e.target.value)}
                    className="w-full pl-7 pr-3 py-2 border rounded-lg"
                    placeholder="0.00"
                    step="0.01"
                    min="1"
                    required
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={() => {
                    setShowReloadModal(false)
                    setReloadAmount('')
                  }}
                >
                  Cancel
                </Button>
                <Button type="submit" variant="primary" className="flex-1">
                  Reload
                </Button>
              </div>
            </form>
          </>
        )}
      </Modal>
    </div>
  )
}
