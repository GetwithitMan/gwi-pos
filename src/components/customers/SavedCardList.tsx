'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { toast } from '@/stores/toast-store'
import { SaveCardForm } from './SaveCardForm'

interface SavedCard {
  id: string
  last4: string
  cardBrand: string
  nickname: string | null
  isDefault: boolean
  expiryMonth: number
  expiryYear: number
  savedAt: string
}

interface SavedCardListProps {
  customerId: string
  locationId: string
  employeeId: string
  onCardSaved?: () => void
}

const MAX_CARDS = 5

const BRAND_DISPLAY: Record<string, string> = {
  VISA: 'Visa',
  visa: 'Visa',
  Visa: 'Visa',
  'M/C': 'Mastercard',
  MC: 'Mastercard',
  MASTERCARD: 'Mastercard',
  mastercard: 'Mastercard',
  Mastercard: 'Mastercard',
  AMEX: 'Amex',
  amex: 'Amex',
  'American Express': 'Amex',
  DISCOVER: 'Discover',
  discover: 'Discover',
  Discover: 'Discover',
  DINERS: 'Diners',
  JCB: 'JCB',
  UNIONPAY: 'UnionPay',
}

function formatBrand(brand: string): string {
  return BRAND_DISPLAY[brand] || brand
}

function getBrandColor(brand: string): string {
  const normalized = formatBrand(brand)
  switch (normalized) {
    case 'Visa': return 'text-blue-700'
    case 'Mastercard': return 'text-orange-600'
    case 'Amex': return 'text-blue-500'
    case 'Discover': return 'text-orange-500'
    default: return 'text-gray-700'
  }
}

export function SavedCardList({ customerId, locationId, employeeId, onCardSaved }: SavedCardListProps) {
  const [cards, setCards] = useState<SavedCard[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const fetchCards = useCallback(async () => {
    setIsLoading(true)
    try {
      const params = new URLSearchParams({
        locationId,
        requestingEmployeeId: employeeId,
      })
      const res = await fetch(`/api/customers/${customerId}/saved-cards?${params}`)
      if (!res.ok) {
        throw new Error('Failed to fetch saved cards')
      }
      const raw = await res.json()
      const data = raw.data ?? raw
      // Handle both { cards: [...] } and direct array shapes
      const cardList: SavedCard[] = Array.isArray(data) ? data : (data.cards ?? [])
      setCards(cardList)
    } catch (err) {
      console.error('Failed to fetch saved cards:', err)
      toast.error('Failed to load saved cards')
    } finally {
      setIsLoading(false)
    }
  }, [customerId, locationId, employeeId])

  useEffect(() => {
    void fetchCards()
  }, [fetchCards])

  const handleSaveCard = async (token: string, last4: string, cardBrand: string, expiryMonth: number, expiryYear: number) => {
    setIsSaving(true)
    try {
      const res = await fetch(`/api/customers/${customerId}/saved-cards`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-employee-id': employeeId,
        },
        body: JSON.stringify({
          locationId,
          token,
          last4,
          cardBrand,
          expiryMonth,
          expiryYear,
          isDefault: true,
          requestingEmployeeId: employeeId,
        }),
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || 'Failed to save card')
      }

      toast.success('Card saved successfully')
      setShowAddForm(false)
      await fetchCards()
      onCardSaved?.()
    } catch (err) {
      console.error('Failed to save card:', err)
      toast.error(err instanceof Error ? err.message : 'Failed to save card')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeleteCard = async (cardId: string) => {
    setDeletingId(cardId)
    try {
      const params = new URLSearchParams({
        cardId,
        locationId,
        requestingEmployeeId: employeeId,
      })
      const res = await fetch(`/api/customers/${customerId}/saved-cards?${params}`, {
        method: 'DELETE',
      })

      if (!res.ok) {
        throw new Error('Failed to delete card')
      }

      toast.success('Card removed')
      await fetchCards()
      onCardSaved?.()
    } catch (err) {
      console.error('Failed to delete card:', err)
      toast.error('Failed to remove card')
    } finally {
      setDeletingId(null)
    }
  }

  if (isLoading) {
    return (
      <div className="py-4 text-center">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mx-auto" />
        <p className="text-xs text-gray-500 mt-2">Loading saved cards...</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-gray-700">Saved Cards</h4>
        {cards.length < MAX_CARDS && !showAddForm && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowAddForm(true)}
            className="text-blue-600 text-xs"
          >
            + Add Card
          </Button>
        )}
      </div>

      {cards.length === 0 && !showAddForm ? (
        <div className="py-3 text-center border border-dashed border-gray-300 rounded-lg">
          <p className="text-sm text-gray-500 mb-2">No cards on file</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAddForm(true)}
          >
            + Add Card
          </Button>
        </div>
      ) : (
        <div className="space-y-1.5">
          {cards.map((card) => (
            <div
              key={card.id}
              className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg border border-gray-200"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className={`text-sm font-semibold ${getBrandColor(card.cardBrand)}`}>
                  {formatBrand(card.cardBrand)}
                </span>
                <span className="text-sm text-gray-600">
                  ****{card.last4}
                </span>
                <span className="text-xs text-gray-400">
                  {String(card.expiryMonth).padStart(2, '0')}/{String(card.expiryYear).slice(-2)}
                </span>
                {card.isDefault && (
                  <span className="px-1.5 py-0.5 text-[10px] font-medium bg-blue-100 text-blue-700 rounded">
                    DEFAULT
                  </span>
                )}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-red-500 hover:text-red-700 hover:bg-red-50 text-xs px-2 py-1"
                onClick={() => void handleDeleteCard(card.id)}
                disabled={deletingId === card.id}
              >
                {deletingId === card.id ? 'Removing...' : 'Remove'}
              </Button>
            </div>
          ))}
        </div>
      )}

      {cards.length >= MAX_CARDS && (
        <p className="text-xs text-amber-600">
          Maximum of {MAX_CARDS} cards reached. Remove a card to add a new one.
        </p>
      )}

      {showAddForm && (
        <div className="mt-2 p-3 border border-blue-200 rounded-lg bg-blue-50/50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">Add New Card</span>
            <Button
              variant="ghost"
              size="sm"
              className="text-gray-500 text-xs px-2 py-1"
              onClick={() => setShowAddForm(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
          </div>
          <SaveCardForm
            onTokenized={(result) => void handleSaveCard(result.token, result.last4, result.cardBrand, Number(result.expiryMonth), Number(result.expiryYear))}
            onCancel={() => setShowAddForm(false)}
            loading={isSaving}
          />
        </div>
      )}
    </div>
  )
}
