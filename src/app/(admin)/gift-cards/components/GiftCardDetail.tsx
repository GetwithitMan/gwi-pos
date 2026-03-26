'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { formatCurrency, formatDate } from '@/lib/utils'
import { toast } from '@/stores/toast-store'
import { GiftCardAdjustment } from './GiftCardAdjustment'

interface GiftCard {
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
  depleted: 'bg-gray-100 text-gray-600',
  expired: 'bg-red-100 text-red-700',
  frozen: 'bg-blue-100 text-blue-700',
  unactivated: 'bg-yellow-100 text-yellow-700',
}

const TRANSACTION_TYPE_LABELS: Record<string, string> = {
  purchase: 'Initial Purchase',
  activated: 'Activation',
  redemption: 'Redemption',
  reload: 'Reload',
  refund: 'Refund',
  adjustment_credit: 'Credit Adjustment',
  adjustment_debit: 'Debit Adjustment',
  frozen: 'Card Frozen',
  unfrozen: 'Card Unfrozen',
}

interface GiftCardDetailProps {
  card: GiftCard | null
  onClose: () => void
  onCardUpdated: () => void
}

export function GiftCardDetail({ card, onClose, onCardUpdated }: GiftCardDetailProps) {
  const [transactions, setTransactions] = useState<GiftCardTransaction[]>([])
  const [loadingTransactions, setLoadingTransactions] = useState(false)
  const [showAdjustment, setShowAdjustment] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)

  const loadTransactions = useCallback(async () => {
    if (!card) return
    setLoadingTransactions(true)
    try {
      const response = await fetch(`/api/gift-cards/${card.id}`)
      if (response.ok) {
        const data = await response.json()
        setTransactions(data.data?.transactions || [])
      }
    } catch (error) {
      console.error('Failed to load transactions:', error)
    } finally {
      setLoadingTransactions(false)
    }
  }, [card?.id])

  useEffect(() => {
    if (card) {
      loadTransactions()
      setShowAdjustment(false)
    }
  }, [card?.id, loadTransactions])

  async function handleAction(action: string, body: Record<string, unknown> = {}) {
    if (!card) return
    setActionLoading(true)
    try {
      const response = await fetch(`/api/gift-cards/${card.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...body }),
      })

      if (response.ok) {
        toast.success(`Card ${action}d successfully`)
        onCardUpdated()
        loadTransactions()
      } else {
        const data = await response.json()
        toast.error(data.error || `Failed to ${action} card`)
      }
    } catch (error) {
      toast.error(`Failed to ${action} card`)
    } finally {
      setActionLoading(false)
    }
  }

  async function handleFreeze() {
    const reason = prompt('Reason for freezing this card:')
    if (!reason) return
    await handleAction('freeze', { reason })
  }

  async function handleResendEmail() {
    if (!card?.recipientEmail) {
      toast.error('No recipient email on this card')
      return
    }
    toast.success('Resend email requested (fire-and-forget)')
  }

  if (!card) {
    return (
      <Card className="p-8 text-center text-gray-500">
        <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
        </svg>
        <p className="text-sm">Select a gift card to view details</p>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {/* Close button + card number header */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-gray-900">Card Details</h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-3">
          {/* Card Number */}
          <div>
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Card Number</label>
            <div className="font-mono text-lg font-semibold text-gray-900">{card.cardNumber}</div>
          </div>

          {/* Status */}
          <div>
            <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Status</label>
            <div className="mt-1">
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[card.status] || 'bg-gray-100'}`}>
                {card.status.toUpperCase()}
              </span>
            </div>
            {card.frozenReason && (
              <p className="text-xs text-blue-600 mt-1">Reason: {card.frozenReason}</p>
            )}
          </div>

          {/* Balances */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Initial Balance</label>
              <div className="text-sm font-medium text-gray-900">{formatCurrency(card.initialBalance)}</div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Current Balance</label>
              <div className="text-xl font-bold text-green-600">{formatCurrency(card.currentBalance)}</div>
            </div>
          </div>

          {/* Source */}
          {card.source && (
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Source</label>
              <div className="text-sm text-gray-900 capitalize">{card.source}</div>
            </div>
          )}

          {/* Recipient */}
          {(card.recipientName || card.recipientEmail || card.recipientPhone) && (
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Recipient</label>
              {card.recipientName && <div className="text-sm text-gray-900">{card.recipientName}</div>}
              {card.recipientEmail && <div className="text-xs text-gray-500">{card.recipientEmail}</div>}
              {card.recipientPhone && <div className="text-xs text-gray-500">{card.recipientPhone}</div>}
            </div>
          )}

          {/* Purchaser */}
          {card.purchaserName && (
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Purchased By</label>
              <div className="text-sm text-gray-900">{card.purchaserName}</div>
            </div>
          )}

          {/* Message */}
          {card.message && (
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Message</label>
              <div className="text-sm italic text-gray-600">&ldquo;{card.message}&rdquo;</div>
            </div>
          )}

          {/* Dates */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Created</label>
              <div className="text-xs text-gray-600">{formatDate(card.createdAt)}</div>
            </div>
            {card.activatedAt && (
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Activated</label>
                <div className="text-xs text-gray-600">{formatDate(card.activatedAt)}</div>
              </div>
            )}
            {card.expiresAt && (
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Expires</label>
                <div className="text-xs text-gray-600">{formatDate(card.expiresAt)}</div>
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="mt-4 pt-4 border-t border-gray-200 space-y-2">
          <div className="flex gap-2 flex-wrap">
            {card.status === 'active' && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAdjustment(!showAdjustment)}
                >
                  Adjust Balance
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const amt = prompt('Reload amount ($):')
                    if (amt) {
                      const amount = parseFloat(amt)
                      if (amount > 0) {
                        void handleAction('reload', { amount }).catch(console.error)
                      }
                    }
                  }}
                  disabled={actionLoading}
                >
                  Reload
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleFreeze}
                  disabled={actionLoading}
                >
                  Freeze
                </Button>
              </>
            )}
            {card.status === 'frozen' && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => handleAction('unfreeze')}
                disabled={actionLoading}
              >
                Unfreeze
              </Button>
            )}
            {card.recipientEmail && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleResendEmail}
                disabled={actionLoading}
              >
                Resend Email
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* Inline Adjustment Form */}
      {showAdjustment && card.status === 'active' && (
        <GiftCardAdjustment
          cardId={card.id}
          currentBalance={card.currentBalance}
          onSuccess={() => {
            setShowAdjustment(false)
            onCardUpdated()
            loadTransactions()
          }}
          onCancel={() => setShowAdjustment(false)}
        />
      )}

      {/* Transaction History */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Transaction History</h3>
        {loadingTransactions ? (
          <div className="text-sm text-gray-500 text-center py-4">Loading transactions...</div>
        ) : transactions.length === 0 ? (
          <div className="text-sm text-gray-500 text-center py-4">No transactions</div>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {transactions.map(txn => (
              <div key={txn.id} className="text-sm p-3 bg-gray-50 rounded-lg">
                <div className="flex justify-between items-center">
                  <span className="font-medium text-gray-900">
                    {TRANSACTION_TYPE_LABELS[txn.type] || txn.type}
                  </span>
                  <span className={`font-semibold ${txn.amount >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {txn.amount >= 0 ? '+' : ''}{formatCurrency(txn.amount)}
                  </span>
                </div>
                <div className="flex justify-between mt-1 text-xs text-gray-500">
                  <span>Balance: {formatCurrency(txn.balanceAfter)}</span>
                  <span>{formatDate(txn.createdAt)}</span>
                </div>
                {txn.notes && (
                  <p className="text-xs text-gray-400 mt-1">{txn.notes}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
