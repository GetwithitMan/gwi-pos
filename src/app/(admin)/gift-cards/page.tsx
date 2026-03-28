'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { toast } from '@/stores/toast-store'
import { GiftCardDashboard } from './components/GiftCardDashboard'
import { GiftCardList } from './components/GiftCardList'
import { GiftCardDetail } from './components/GiftCardDetail'
import { GiftCardImport } from './components/GiftCardImport'
import { GiftCardPoolStatus } from './components/GiftCardPoolStatus'
import { GiftCardExport } from './components/GiftCardExport'

type Tab = 'cards' | 'import' | 'reports'

const TAB_CONFIG: { key: Tab; label: string }[] = [
  { key: 'cards', label: 'Cards' },
  { key: 'import', label: 'Import' },
  { key: 'reports', label: 'Reports' },
]

interface SelectedCard {
  id: string
  cardNumber: string
  initialBalance: number
  currentBalance: number
  status: string
  source?: string | null
  recipientName?: string | null
  recipientEmail?: string | null
  recipientPhone?: string | null
  purchaserName?: string | null
  message?: string | null
  expiresAt?: string | null
  activatedAt?: string | null
  frozenAt?: string | null
  frozenReason?: string | null
  createdAt: string
}

export default function GiftCardsPage() {
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/gift-cards' })
  const employee = useAuthStore(s => s.employee)
  const locationId = employee?.location?.id

  const [activeTab, setActiveTab] = useState<Tab>('cards')
  const [selectedCard, setSelectedCard] = useState<SelectedCard | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  // Create modal state
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [newAmount, setNewAmount] = useState('')
  const [recipientName, setRecipientName] = useState('')
  const [recipientEmail, setRecipientEmail] = useState('')
  const [purchaserName, setPurchaserName] = useState('')
  const [message, setMessage] = useState('')

  function triggerRefresh() {
    setRefreshKey(k => k + 1)
  }

  function handleSelectCard(card: SelectedCard) {
    setSelectedCard(card)
  }

  function handleCloseDetail() {
    setSelectedCard(null)
  }

  function handleCardUpdated() {
    triggerRefresh()
    // Re-fetch selected card detail
    if (selectedCard) {
      void loadSelectedCardDetail(selectedCard.id).catch(console.error)
    }
  }

  async function loadSelectedCardDetail(cardId: string) {
    try {
      const response = await fetch(`/api/gift-cards/${cardId}`)
      if (response.ok) {
        const data = await response.json()
        const card = data.data
        setSelectedCard({
          ...card,
          initialBalance: Number(card.initialBalance),
          currentBalance: Number(card.currentBalance),
        })
      }
    } catch (error) {
      console.error('Failed to reload card detail:', error)
    }
  }

  function resetCreateForm() {
    setNewAmount('')
    setRecipientName('')
    setRecipientEmail('')
    setPurchaserName('')
    setMessage('')
    setCreateError(null)
  }

  async function handleCreateGiftCard(e: React.FormEvent) {
    e.preventDefault()
    if (!locationId) return

    const amount = parseFloat(newAmount)
    if (!amount || amount <= 0) {
      setCreateError('Enter a valid positive amount')
      return
    }

    setCreating(true)
    setCreateError(null)

    try {
      const payload = {
        locationId,
        amount,
        recipientName: recipientName || null,
        recipientEmail: recipientEmail || null,
        purchaserName: purchaserName || null,
        message: message || null,
        skipPaymentCheck: true,
      }

      const response = await fetch('/api/gift-cards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (response.ok) {
        toast.success('Gift card created')
        setShowCreateModal(false)
        resetCreateForm()
        triggerRefresh()
      } else {
        const data = await response.json()
        setCreateError(data.error || 'Failed to create gift card')
      }
    } catch (error) {
      setCreateError('Failed to create gift card')
    } finally {
      setCreating(false)
    }
  }

  if (!hydrated) return null

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Gift Cards"
        actions={
          <Button variant="primary" onClick={() => setShowCreateModal(true)}>
            + Create Gift Card
          </Button>
        }
      />

      {/* Tabs */}
      <div className="max-w-7xl mx-auto mt-4">
        <div className="border-b border-gray-200 mb-6">
          <nav className="flex gap-0" aria-label="Gift card tabs">
            {TAB_CONFIG.map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                  activeTab === tab.key
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* ── Cards Tab ──────────────────────────────────────────────── */}
        {activeTab === 'cards' && (
          <>
            <GiftCardDashboard locationId={locationId} />

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Card list (2/3 width or full when no selection) */}
              <div className={selectedCard ? 'lg:col-span-2' : 'lg:col-span-3'}>
                <GiftCardList
                  locationId={locationId}
                  selectedCardId={selectedCard?.id || null}
                  onSelectCard={handleSelectCard}
                  refreshKey={refreshKey}
                />
              </div>

              {/* Detail panel (1/3 width, slide-over) */}
              {selectedCard && (
                <div className="lg:col-span-1">
                  <GiftCardDetail
                    card={selectedCard}
                    onClose={handleCloseDetail}
                    onCardUpdated={handleCardUpdated}
                  />
                </div>
              )}
            </div>
          </>
        )}

        {/* ── Import Tab ─────────────────────────────────────────────── */}
        {activeTab === 'import' && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <GiftCardImport
              locationId={locationId}
              onImportComplete={triggerRefresh}
            />
            <GiftCardPoolStatus
              locationId={locationId}
              refreshKey={refreshKey}
            />
          </div>
        )}

        {/* ── Reports Tab ────────────────────────────────────────────── */}
        {activeTab === 'reports' && (
          <div className="space-y-6">
            <GiftCardDashboard locationId={locationId} expanded />
            <GiftCardExport locationId={locationId} />
          </div>
        )}
      </div>

      {/* ── Create Gift Card Modal ─────────────────────────────────────── */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => { setShowCreateModal(false); resetCreateForm() }}
        title="Create Gift Card"
        size="md"
      >
        {createError && (
          <div className="p-3 mb-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {createError}
          </div>
        )}
        <form onSubmit={handleCreateGiftCard} className="space-y-4">
          <div>
            <label className="text-sm font-medium block mb-1">Amount *</label>
            <div className="relative">
              <span className="absolute left-3 top-2 text-gray-400">$</span>
              <input
                type="number"
                value={newAmount}
                onChange={(e) => setNewAmount(e.target.value)}
                className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
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
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              placeholder="John Doe"
            />
          </div>

          <div>
            <label className="text-sm font-medium block mb-1">Recipient Email</label>
            <input
              type="email"
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              placeholder="john@example.com"
            />
          </div>

          <div>
            <label className="text-sm font-medium block mb-1">Purchaser Name</label>
            <input
              type="text"
              value={purchaserName}
              onChange={(e) => setPurchaserName(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              placeholder="Jane Doe"
            />
          </div>

          <div>
            <label className="text-sm font-medium block mb-1">Gift Message</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
              placeholder="Happy Birthday!"
              rows={2}
            />
          </div>

          <div className="flex gap-2 pt-4">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => { setShowCreateModal(false); resetCreateForm() }}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" className="flex-1" disabled={creating}>
              {creating ? 'Creating...' : 'Create Gift Card'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
