'use client'

import { useState, useEffect, use } from 'react'
import Link from 'next/link'
import { toast } from '@/stores/toast-store'

interface PricingTier {
  id: string
  name: string
  description?: string
  color?: string
  price: number
  serviceFee: number
  quantityAvailable?: number
  quantitySold: number
  maxPerOrder?: number
}

interface TableConfig {
  id: string
  tableId: string
  tableName: string
  tableCapacity: number
  isIncluded: boolean
  bookingMode: string
  pricingTierId?: string
  pricingTierName?: string
}

interface Event {
  id: string
  locationId: string
  name: string
  description?: string
  imageUrl?: string
  eventType: string
  eventDate: string
  doorsOpen: string
  startTime: string
  endTime?: string
  ticketingMode: string
  allowOnlineSales: boolean
  allowPOSSales: boolean
  maxTicketsPerOrder?: number
  totalCapacity: number
  reservedCapacity: number
  status: string
  settings: Record<string, unknown>
  reservationConflictsHandled: boolean
  reservationConflictNotes?: string
  pricingTiers: PricingTier[]
  tableConfigurations: TableConfig[]
  ticketCounts: {
    total: number
    available: number
    held: number
    sold: number
    checkedIn: number
    cancelled: number
    refunded: number
  }
  createdAt: string
  updatedAt: string
}

interface Conflict {
  reservationId: string
  guestName: string
  guestPhone?: string
  guestEmail?: string
  partySize: number
  reservationTime: string
  tableName?: string
  overlapMinutes: number
}

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-700 text-gray-300',
  on_sale: 'bg-green-900 text-green-300',
  sold_out: 'bg-purple-900 text-purple-300',
  cancelled: 'bg-red-900 text-red-300',
  completed: 'bg-blue-900 text-blue-300',
}

export default function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [event, setEvent] = useState<Event | null>(null)
  const [conflicts, setConflicts] = useState<Conflict[]>([])
  const [loading, setLoading] = useState(true)
  const [showConflictModal, setShowConflictModal] = useState(false)

  useEffect(() => {
    fetchEvent()
  }, [id])

  async function fetchEvent() {
    try {
      const res = await fetch(`/api/events/${id}`)
      const data = await res.json()
      setEvent(data.event)

      // Fetch conflicts if not handled
      if (!data.event.reservationConflictsHandled) {
        const conflictRes = await fetch(`/api/events/${id}/conflicts`)
        const conflictData = await conflictRes.json()
        setConflicts(conflictData.conflicts || [])
      }
    } catch (error) {
      console.error('Failed to fetch event:', error)
    } finally {
      setLoading(false)
    }
  }

  async function publishEvent() {
    if (!confirm('Publish this event and start ticket sales?')) return

    try {
      const res = await fetch(`/api/events/${id}/publish`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json()
        toast.error(data.errors?.join(', ') || data.error || 'Failed to publish')
        return
      }
      fetchEvent()
    } catch (error) {
      console.error('Failed to publish:', error)
    }
  }

  async function resolveConflicts(action: string, reservationIds: string[] = []) {
    try {
      const res = await fetch(`/api/events/${id}/resolve-conflicts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          reservationIds,
          notifyGuests: true,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error || 'Failed to resolve conflicts')
        return
      }

      setShowConflictModal(false)
      fetchEvent()
    } catch (error) {
      console.error('Failed to resolve conflicts:', error)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-400">Loading event...</div>
      </div>
    )
  }

  if (!event) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-400">Event not found</div>
      </div>
    )
  }

  const ticketsSold = event.ticketCounts.sold + event.ticketCounts.checkedIn
  const soldPercent = event.totalCapacity > 0
    ? Math.round((ticketsSold / event.totalCapacity) * 100)
    : 0

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex justify-between items-start mb-6">
        <div>
          <Link href="/events" className="text-gray-400 hover:text-white text-sm mb-2 inline-block">
            &larr; Back to Events
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{event.name}</h1>
            <span className={`px-2 py-1 text-sm rounded ${STATUS_COLORS[event.status]}`}>
              {event.status.replace('_', ' ')}
            </span>
          </div>
          <div className="text-gray-400 mt-1">
            {new Date(event.eventDate).toLocaleDateString('en-US', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
            {' '}&bull;{' '}
            Doors {formatTime(event.doorsOpen)} &bull; Show {formatTime(event.startTime)}
          </div>
        </div>

        <div className="flex gap-2">
          {event.status === 'draft' && (
            <>
              {!event.reservationConflictsHandled && conflicts.length > 0 && (
                <button
                  onClick={() => setShowConflictModal(true)}
                  className="px-4 py-2 bg-yellow-600 rounded-lg hover:bg-yellow-700"
                >
                  Resolve Conflicts ({conflicts.length})
                </button>
              )}
              <button
                onClick={publishEvent}
                disabled={!event.reservationConflictsHandled}
                className="px-4 py-2 bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Publish Event
              </button>
            </>
          )}
          {event.status === 'on_sale' && (
            <>
              <Link
                href={`/events/${id}/sell`}
                className="px-4 py-2 bg-green-600 rounded-lg hover:bg-green-700"
              >
                Sell Tickets
              </Link>
              <Link
                href={`/events/${id}/check-in`}
                className="px-4 py-2 bg-purple-600 rounded-lg hover:bg-purple-700"
              >
                Check-In
              </Link>
            </>
          )}
        </div>
      </div>

      {/* Conflict Warning */}
      {!event.reservationConflictsHandled && conflicts.length > 0 && (
        <div className="bg-yellow-900/30 border border-yellow-600 rounded-lg p-4 mb-6">
          <div className="flex items-center gap-2 text-yellow-400 font-medium">
            <span>Warning:</span>
            {conflicts.length} reservation(s) conflict with this event
          </div>
          <p className="text-yellow-200 text-sm mt-1">
            You must resolve these conflicts before publishing the event.
          </p>
          <button
            onClick={() => setShowConflictModal(true)}
            className="mt-2 text-sm text-yellow-400 underline hover:text-yellow-300"
          >
            View and resolve conflicts
          </button>
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-gray-800 rounded-lg p-4">
          <div className="text-gray-400 text-sm">Tickets Sold</div>
          <div className="text-2xl font-bold text-green-400">{ticketsSold}</div>
          <div className="text-xs text-gray-500">of {event.totalCapacity} total</div>
        </div>
        <div className="bg-gray-800 rounded-lg p-4">
          <div className="text-gray-400 text-sm">Checked In</div>
          <div className="text-2xl font-bold text-purple-400">{event.ticketCounts.checkedIn}</div>
          <div className="text-xs text-gray-500">of {ticketsSold} sold</div>
        </div>
        <div className="bg-gray-800 rounded-lg p-4">
          <div className="text-gray-400 text-sm">Held</div>
          <div className="text-2xl font-bold text-yellow-400">{event.ticketCounts.held}</div>
          <div className="text-xs text-gray-500">pending purchase</div>
        </div>
        <div className="bg-gray-800 rounded-lg p-4">
          <div className="text-gray-400 text-sm">Available</div>
          <div className="text-2xl font-bold">
            {event.totalCapacity - ticketsSold - event.ticketCounts.held}
          </div>
          <div className="text-xs text-gray-500">remaining</div>
        </div>
      </div>

      {/* Capacity Bar */}
      <div className="bg-gray-800 rounded-lg p-4 mb-6">
        <div className="flex justify-between mb-2">
          <span className="text-sm text-gray-400">Capacity</span>
          <span className="text-sm">{soldPercent}% sold</span>
        </div>
        <div className="h-4 bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-green-500"
            style={{ width: `${soldPercent}%` }}
          />
        </div>
      </div>

      {/* Pricing Tiers */}
      <div className="bg-gray-800 rounded-lg p-4 mb-6">
        <h2 className="text-lg font-medium mb-4">Pricing Tiers</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {event.pricingTiers.map(tier => (
            <div
              key={tier.id}
              className="border border-gray-700 rounded-lg p-4"
              style={{ borderLeftColor: tier.color || '#4b5563', borderLeftWidth: 4 }}
            >
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-medium">{tier.name}</div>
                  {tier.description && (
                    <div className="text-sm text-gray-400 mt-1">{tier.description}</div>
                  )}
                </div>
                <div className="text-right">
                  <div className="text-lg font-bold">${tier.price}</div>
                  {tier.serviceFee > 0 && (
                    <div className="text-xs text-gray-500">+${tier.serviceFee} fee</div>
                  )}
                </div>
              </div>
              <div className="mt-3 pt-3 border-t border-gray-700 text-sm">
                <span className="text-green-400">{tier.quantitySold} sold</span>
                {tier.quantityAvailable && (
                  <span className="text-gray-400"> / {tier.quantityAvailable} available</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Event Details */}
      <div className="grid grid-cols-2 gap-6">
        <div className="bg-gray-800 rounded-lg p-4">
          <h2 className="text-lg font-medium mb-4">Event Details</h2>
          <dl className="space-y-3">
            <div className="flex justify-between">
              <dt className="text-gray-400">Event Type</dt>
              <dd className="capitalize">{event.eventType.replace('_', ' ')}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-400">Ticketing Mode</dt>
              <dd className="capitalize">{event.ticketingMode.replace('_', ' ')}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-400">Online Sales</dt>
              <dd>{event.allowOnlineSales ? 'Enabled' : 'Disabled'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-400">POS Sales</dt>
              <dd>{event.allowPOSSales ? 'Enabled' : 'Disabled'}</dd>
            </div>
            {event.maxTicketsPerOrder && (
              <div className="flex justify-between">
                <dt className="text-gray-400">Max Per Order</dt>
                <dd>{event.maxTicketsPerOrder}</dd>
              </div>
            )}
          </dl>
        </div>

        <div className="bg-gray-800 rounded-lg p-4">
          <h2 className="text-lg font-medium mb-4">Schedule</h2>
          <dl className="space-y-3">
            <div className="flex justify-between">
              <dt className="text-gray-400">Event Date</dt>
              <dd>{new Date(event.eventDate).toLocaleDateString()}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-400">Doors Open</dt>
              <dd>{formatTime(event.doorsOpen)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-gray-400">Show Time</dt>
              <dd>{formatTime(event.startTime)}</dd>
            </div>
            {event.endTime && (
              <div className="flex justify-between">
                <dt className="text-gray-400">End Time</dt>
                <dd>{formatTime(event.endTime)}</dd>
              </div>
            )}
          </dl>
        </div>
      </div>

      {/* Conflict Resolution Modal */}
      {showConflictModal && (
        <ConflictModal
          conflicts={conflicts}
          onResolve={resolveConflicts}
          onClose={() => setShowConflictModal(false)}
        />
      )}
    </div>
  )
}

function ConflictModal({
  conflicts,
  onResolve,
  onClose,
}: {
  conflicts: Conflict[]
  onResolve: (action: string, ids?: string[]) => void
  onClose: () => void
}) {
  const [selectedIds, setSelectedIds] = useState<string[]>([])

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-bold mb-4">Resolve Reservation Conflicts</h2>

        <p className="text-gray-400 mb-4">
          The following reservations overlap with this event. Choose how to handle them:
        </p>

        <div className="space-y-3 mb-6 max-h-64 overflow-y-auto">
          {conflicts.map(conflict => (
            <label
              key={conflict.reservationId}
              className="flex items-center gap-3 p-3 bg-gray-700 rounded-lg cursor-pointer hover:bg-gray-600"
            >
              <input
                type="checkbox"
                checked={selectedIds.includes(conflict.reservationId)}
                onChange={e => {
                  if (e.target.checked) {
                    setSelectedIds([...selectedIds, conflict.reservationId])
                  } else {
                    setSelectedIds(selectedIds.filter(id => id !== conflict.reservationId))
                  }
                }}
                className="w-4 h-4"
              />
              <div className="flex-1">
                <div className="font-medium">{conflict.guestName}</div>
                <div className="text-sm text-gray-400">
                  Party of {conflict.partySize} at {formatTime(conflict.reservationTime)}
                  {conflict.tableName && ` - ${conflict.tableName}`}
                </div>
                <div className="text-xs text-yellow-400">
                  {conflict.overlapMinutes} min overlap
                </div>
              </div>
            </label>
          ))}
        </div>

        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-gray-700 rounded hover:bg-gray-600"
          >
            Cancel
          </button>
          <button
            onClick={() => onResolve('ignore')}
            className="flex-1 px-4 py-2 bg-yellow-600 rounded hover:bg-yellow-700"
          >
            Keep All
          </button>
          <button
            onClick={() => onResolve('cancel_selected', selectedIds)}
            disabled={selectedIds.length === 0}
            className="flex-1 px-4 py-2 bg-orange-600 rounded hover:bg-orange-700 disabled:opacity-50"
          >
            Cancel Selected ({selectedIds.length})
          </button>
          <button
            onClick={() => onResolve('cancel_all')}
            className="flex-1 px-4 py-2 bg-red-600 rounded hover:bg-red-700"
          >
            Cancel All ({conflicts.length})
          </button>
        </div>
      </div>
    </div>
  )
}

function formatTime(time: string) {
  const [hours, minutes] = time.split(':')
  const h = parseInt(hours)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hour = h > 12 ? h - 12 : h === 0 ? 12 : h
  return `${hour}:${minutes} ${ampm}`
}
