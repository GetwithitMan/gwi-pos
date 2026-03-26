'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { formatCurrency, formatDate } from '@/lib/utils'
import { toast } from '@/stores/toast-store'

interface GiftCard {
  id: string
  cardNumber: string
  initialBalance: number
  currentBalance: number
  status: string
  recipientName?: string | null
  recipientEmail?: string | null
  purchaserName?: string | null
  source?: string | null
  createdAt: string
  _count?: { transactions: number }
}

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-100 text-green-700',
  depleted: 'bg-gray-100 text-gray-600',
  expired: 'bg-red-100 text-red-700',
  frozen: 'bg-blue-100 text-blue-700',
  unactivated: 'bg-yellow-100 text-yellow-700',
}

type SortField = 'cardNumber' | 'currentBalance' | 'status' | 'createdAt'
type SortDir = 'asc' | 'desc'

interface GiftCardListProps {
  locationId: string | undefined
  selectedCardId: string | null
  onSelectCard: (card: GiftCard) => void
  refreshKey: number
}

export function GiftCardList({ locationId, selectedCardId, onSelectCard, refreshKey }: GiftCardListProps) {
  const [cards, setCards] = useState<GiftCard[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [sortField, setSortField] = useState<SortField>('createdAt')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [cursor, setCursor] = useState<string | null>(null)
  const [prevCursors, setPrevCursors] = useState<string[]>([])
  const [hasMore, setHasMore] = useState(false)

  const PAGE_SIZE = 25

  const loadCards = useCallback(async (cursorId?: string | null, direction: 'next' | 'reset' = 'reset') => {
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
        let items: GiftCard[] = Array.isArray(data) ? data : data.giftCards || []

        // Client-side sort
        items = sortCards(items, sortField, sortDir)

        // Client-side cursor pagination
        if (direction === 'reset') {
          setCursor(null)
          setPrevCursors([])
          const page = items.slice(0, PAGE_SIZE)
          setCards(page)
          setHasMore(items.length > PAGE_SIZE)
        } else if (cursorId) {
          const idx = items.findIndex(c => c.id === cursorId)
          if (idx >= 0) {
            const page = items.slice(idx + 1, idx + 1 + PAGE_SIZE)
            setCards(page)
            setHasMore(idx + 1 + PAGE_SIZE < items.length)
          }
        }
      }
    } catch (error) {
      console.error('Failed to load gift cards:', error)
    } finally {
      setLoading(false)
    }
  }, [locationId, statusFilter, searchTerm, sortField, sortDir])

  // Reload when dependencies change
  useEffect(() => {
    loadCards(null, 'reset')
  }, [loadCards, refreshKey])

  function sortCards(items: GiftCard[], field: SortField, dir: SortDir): GiftCard[] {
    return [...items].sort((a, b) => {
      let cmp = 0
      switch (field) {
        case 'cardNumber':
          cmp = a.cardNumber.localeCompare(b.cardNumber)
          break
        case 'currentBalance':
          cmp = a.currentBalance - b.currentBalance
          break
        case 'status':
          cmp = a.status.localeCompare(b.status)
          break
        case 'createdAt':
          cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          break
      }
      return dir === 'asc' ? cmp : -cmp
    })
  }

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('desc')
    }
  }

  function handleNextPage() {
    if (cards.length === 0) return
    const lastCard = cards[cards.length - 1]
    setPrevCursors(prev => [...prev, cursor || 'START'])
    setCursor(lastCard.id)
    loadCards(lastCard.id, 'next')
  }

  function handlePrevPage() {
    if (prevCursors.length === 0) return
    const newPrev = [...prevCursors]
    newPrev.pop()
    setPrevCursors(newPrev)
    setCursor(null)
    loadCards(null, 'reset')
  }

  async function handleQuickActivate(card: GiftCard) {
    // Quick activate with $0 — user should use detail panel for full activation with amount
    toast.warning('Open the card detail panel to activate with a balance amount.')
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <span className="text-gray-300 ml-1">&#8597;</span>
    return <span className="ml-1">{sortDir === 'asc' ? '&#9650;' : '&#9660;'}</span>
  }

  return (
    <Card className="p-0 overflow-hidden">
      {/* Filters */}
      <div className="p-4 border-b border-gray-200 flex gap-3 items-center">
        <div className="flex-1">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && loadCards(null, 'reset')}
            placeholder="Search card number, name, email..."
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
        >
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="depleted">Depleted</option>
          <option value="expired">Expired</option>
          <option value="frozen">Frozen</option>
          <option value="unactivated">Unactivated</option>
        </select>
        <Button variant="outline" size="sm" onClick={() => loadCards(null, 'reset')}>
          Search
        </Button>
      </div>

      {/* Table header */}
      <div className="grid grid-cols-12 gap-2 px-4 py-2 bg-gray-50 border-b border-gray-200 text-xs font-medium text-gray-500 uppercase tracking-wider">
        <div
          className="col-span-3 cursor-pointer hover:text-gray-700 select-none"
          onClick={() => handleSort('cardNumber')}
        >
          Card Number <SortIcon field="cardNumber" />
        </div>
        <div className="col-span-2">Recipient</div>
        <div
          className="col-span-2 cursor-pointer hover:text-gray-700 select-none text-right"
          onClick={() => handleSort('currentBalance')}
        >
          Balance <SortIcon field="currentBalance" />
        </div>
        <div
          className="col-span-2 cursor-pointer hover:text-gray-700 select-none text-center"
          onClick={() => handleSort('status')}
        >
          Status <SortIcon field="status" />
        </div>
        <div
          className="col-span-2 cursor-pointer hover:text-gray-700 select-none text-right"
          onClick={() => handleSort('createdAt')}
        >
          Created <SortIcon field="createdAt" />
        </div>
        <div className="col-span-1" />
      </div>

      {/* Card rows */}
      {loading ? (
        <div className="text-center py-8 text-gray-500 text-sm">Loading...</div>
      ) : cards.length === 0 ? (
        <div className="text-center py-8 text-gray-500 text-sm">No gift cards found</div>
      ) : (
        <div className="divide-y divide-gray-100">
          {cards.map(card => (
            <div
              key={card.id}
              className={`grid grid-cols-12 gap-2 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors items-center ${
                selectedCardId === card.id ? 'bg-blue-50 hover:bg-blue-50' : ''
              }`}
              onClick={() => onSelectCard(card)}
            >
              <div className="col-span-3">
                <span className="font-mono text-sm font-medium text-gray-900">{card.cardNumber}</span>
              </div>
              <div className="col-span-2 text-sm text-gray-600 truncate">
                {card.recipientName || card.purchaserName || '-'}
              </div>
              <div className="col-span-2 text-sm text-right font-medium">
                {card.status === 'unactivated' ? (
                  <span className="text-gray-400">$0.00</span>
                ) : (
                  <span className={card.currentBalance > 0 ? 'text-green-600' : 'text-gray-500'}>
                    {formatCurrency(card.currentBalance)}
                  </span>
                )}
              </div>
              <div className="col-span-2 text-center">
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[card.status] || 'bg-gray-100 text-gray-600'}`}>
                  {card.status.toUpperCase()}
                </span>
              </div>
              <div className="col-span-2 text-xs text-gray-500 text-right">
                {formatDate(card.createdAt)}
              </div>
              <div className="col-span-1 text-right">
                {card.status === 'unactivated' && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs px-2 py-1 text-blue-600 hover:text-blue-800"
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelectCard(card)
                    }}
                  >
                    Activate
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {!loading && cards.length > 0 && (
        <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between">
          <span className="text-xs text-gray-500">
            Showing {cards.length} card{cards.length !== 1 ? 's' : ''}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={prevCursors.length === 0}
              onClick={handlePrevPage}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!hasMore}
              onClick={handleNextPage}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}
