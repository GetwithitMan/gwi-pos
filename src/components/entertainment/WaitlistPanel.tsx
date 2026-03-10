'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { formatWaitTime, type WaitlistEntry } from '@/lib/entertainment'

interface WaitlistPanelProps {
  waitlist: WaitlistEntry[]
  locationId?: string
  onNotify?: (entryId: string) => void
  onSeat?: (entryId: string) => void
  onRemove?: (entryId: string) => void
  onAddNew?: () => void
  onRefresh?: () => void
}

function DepositBadge({ entry }: { entry: WaitlistEntry }) {
  if (!entry.depositStatus) return null

  const amount = Number(entry.depositAmount || 0)

  switch (entry.depositStatus) {
    case 'collected': {
      const label = entry.depositMethod === 'card'
        ? `$${amount.toFixed(0)} (${entry.depositCardBrand || 'Card'} ••${entry.depositCardLast4 || '****'})`
        : `$${amount.toFixed(0)} (Cash)`
      return (
        <span className="inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full bg-green-100 text-green-700 border border-green-300">
          {label}
        </span>
      )
    }
    case 'applied':
      return (
        <span className="inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-300">
          Applied to order
        </span>
      )
    case 'refunded':
      return (
        <span className="inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 border border-gray-300">
          Refunded
        </span>
      )
    case 'forfeited':
      return (
        <span className="inline-flex items-center text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700 border border-red-300">
          Forfeited
        </span>
      )
    default:
      return null
  }
}

export function WaitlistPanel({
  waitlist,
  locationId,
  onNotify,
  onSeat,
  onRemove,
  onAddNew,
  onRefresh,
}: WaitlistPanelProps) {
  const waitingEntries = waitlist.filter(e => e.status === 'waiting' || !e.status)
  const [refundingId, setRefundingId] = useState<string | null>(null)

  const handleRefundDeposit = async (entryId: string) => {
    setRefundingId(entryId)
    try {
      const params = locationId ? `?locationId=${locationId}` : ''
      const response = await fetch(`/api/entertainment/waitlist/${entryId}/deposit${params}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        console.error('Failed to refund deposit:', data.error || 'Unknown error')
      }

      // Refresh the panel data
      onRefresh?.()
    } catch (err) {
      console.error('Failed to refund deposit:', err)
    } finally {
      setRefundingId(null)
    }
  }

  return (
    <div className="bg-white rounded-lg border-2 border-amber-400 shadow-lg">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b-2 border-amber-400 bg-amber-500 rounded-t-lg">
        <h3 className="font-bold text-lg flex items-center gap-2 text-white">
          WAITLIST
          <span className="bg-white text-amber-600 text-sm font-bold px-2.5 py-0.5 rounded-full">
            {waitingEntries.length}
          </span>
        </h3>
        {onAddNew && (
          <Button variant="outline" size="sm" onClick={onAddNew} className="bg-white text-amber-700 border-white hover:bg-amber-50">
            + Add
          </Button>
        )}
      </div>

      {/* Waitlist entries */}
      <div className="max-h-64 overflow-y-auto bg-amber-50">
        {waitingEntries.length === 0 ? (
          <div className="p-4 text-center text-gray-600 font-medium">
            No one waiting
          </div>
        ) : (
          <div className="divide-y divide-amber-200" role="list" aria-label="Waitlist entries">
            {waitingEntries.map((entry, index) => (
              <div
                key={entry.id}
                role="listitem"
                className="flex items-center justify-between px-4 py-3 hover:bg-amber-100"
              >
                <div className="flex items-center gap-3">
                  {/* Position number */}
                  <span className="w-8 h-8 flex items-center justify-center bg-amber-500 text-white rounded-full text-sm font-bold">
                    {index + 1}
                  </span>

                  {/* Customer info */}
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-gray-900 text-lg">{entry.customerName.split(' ')[0]}</span>
                      {entry.partySize > 1 && (
                        <span className="text-amber-700 font-semibold">
                          ({entry.partySize})
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-gray-700 font-medium">
                      {entry.menuItem && (
                        <span className="text-blue-700">{entry.menuItem.name}</span>
                      )}
                      <span>•</span>
                      <span className="text-amber-700 font-semibold">{formatWaitTime(entry.waitMinutes)}</span>
                    </div>
                    {/* Deposit badge */}
                    {entry.depositStatus && (
                      <div className="mt-1">
                        <DepositBadge entry={entry} />
                      </div>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2">
                  {/* Refund deposit button */}
                  {entry.depositStatus === 'collected' && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-amber-700 border-amber-400 hover:bg-amber-100 font-semibold text-xs"
                      onClick={() => handleRefundDeposit(entry.id)}
                      disabled={refundingId === entry.id}
                    >
                      {refundingId === entry.id ? 'Refunding...' : 'Refund Deposit'}
                    </Button>
                  )}
                  {onNotify && (
                    <Button
                      size="sm"
                      className="bg-blue-600 text-white hover:bg-blue-700 font-semibold"
                      onClick={() => onNotify(entry.id)}
                    >
                      Notify
                    </Button>
                  )}
                  {onSeat && (
                    <Button
                      size="sm"
                      className="bg-green-600 text-white hover:bg-green-700 font-semibold"
                      onClick={() => onSeat(entry.id)}
                    >
                      Seat
                    </Button>
                  )}
                  {onRemove && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-red-600 border-red-400 hover:bg-red-100 font-semibold"
                      onClick={() => onRemove(entry.id)}
                      aria-label={`Remove ${entry.customerName} from waitlist`}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
