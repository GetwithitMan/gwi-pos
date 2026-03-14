'use client'

import { useState, useEffect, use } from 'react'
import Link from 'next/link'
import { toast } from '@/stores/toast-store'
import { Modal } from '@/components/ui/modal'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/utils'

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
  draft: 'bg-gray-100 text-gray-700',
  on_sale: 'bg-green-50 text-green-700',
  sold_out: 'bg-purple-50 text-purple-700',
  cancelled: 'bg-red-50 text-red-700',
  completed: 'bg-blue-50 text-blue-700',
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  dinner_show: 'Dinner Show',
  concert: 'Concert',
  private_event: 'Private Event',
  special_occasion: 'Special Occasion',
  comedy_night: 'Comedy Night',
  karaoke: 'Karaoke Night',
}

export default function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [event, setEvent] = useState<Event | null>(null)
  const [conflicts, setConflicts] = useState<Conflict[]>([])
  const [loading, setLoading] = useState(true)
  const [showConflictModal, setShowConflictModal] = useState(false)
  const [showEditModal, setShowEditModal] = useState(false)

  useEffect(() => {
    fetchEvent()
  }, [id])

  async function fetchEvent() {
    try {
      const res = await fetch(`/api/events/${id}`)
      const data = await res.json()
      setEvent(data.data.event)

      if (!data.data.event.reservationConflictsHandled) {
        const conflictRes = await fetch(`/api/events/${id}/conflicts`)
        const conflictData = await conflictRes.json()
        setConflicts(conflictData.data.conflicts || [])
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
      toast.success('Event published')
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
        <div className="text-gray-600">Loading event...</div>
      </div>
    )
  }

  if (!event) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-600">Event not found</div>
      </div>
    )
  }

  const ticketsSold = event.ticketCounts.sold + event.ticketCounts.checkedIn
  const soldPercent = event.totalCapacity > 0
    ? Math.round((ticketsSold / event.totalCapacity) * 100)
    : 0

  // Revenue calculation
  const totalRevenue = event.pricingTiers.reduce((sum, tier) => {
    return sum + (tier.quantitySold * tier.price)
  }, 0)
  const totalServiceFees = event.pricingTiers.reduce((sum, tier) => {
    return sum + (tier.quantitySold * tier.serviceFee)
  }, 0)

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <AdminPageHeader
          title={event.name}
          backHref="/events"
          breadcrumbs={[{ label: 'Events', href: '/events' }]}
          subtitle={
            <div className="flex items-center gap-3 mt-1">
              <span className={`px-2 py-0.5 text-xs font-medium rounded ${STATUS_COLORS[event.status]}`}>
                {event.status.replace('_', ' ')}
              </span>
              <span className="text-gray-500">
                {new Date(event.eventDate).toLocaleDateString('en-US', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
                {' -- '}
                Doors {formatTime(event.doorsOpen)} / Show {formatTime(event.startTime)}
                {event.endTime && ` - ${formatTime(event.endTime)}`}
              </span>
            </div>
          }
          actions={
            <div className="flex gap-2">
              {event.status === 'draft' && (
                <>
                  {!event.reservationConflictsHandled && conflicts.length > 0 && (
                    <Button
                      onClick={() => setShowConflictModal(true)}
                      variant="secondary"
                    >
                      Resolve Conflicts ({conflicts.length})
                    </Button>
                  )}
                  <Button onClick={() => setShowEditModal(true)} variant="secondary">
                    Edit
                  </Button>
                  <Button
                    onClick={publishEvent}
                    disabled={!event.reservationConflictsHandled}
                    variant="primary"
                  >
                    Publish Event
                  </Button>
                </>
              )}
              {event.status === 'on_sale' && (
                <>
                  <Button onClick={() => setShowEditModal(true)} variant="secondary">
                    Edit
                  </Button>
                  <Link href={`/events/${id}/sell`}>
                    <Button variant="primary">Sell Tickets</Button>
                  </Link>
                  <Link href={`/events/${id}/check-in`}>
                    <Button variant="secondary">Check-In</Button>
                  </Link>
                </>
              )}
              {event.status === 'sold_out' && (
                <Link href={`/events/${id}/check-in`}>
                  <Button variant="primary">Check-In</Button>
                </Link>
              )}
            </div>
          }
        />

        {/* Conflict Warning */}
        {!event.reservationConflictsHandled && conflicts.length > 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6">
            <div className="flex items-center gap-2 text-yellow-800 font-medium">
              {conflicts.length} reservation(s) conflict with this event
            </div>
            <p className="text-yellow-700 text-sm mt-1">
              You must resolve these conflicts before publishing the event.
            </p>
            <button
              onClick={() => setShowConflictModal(true)}
              className="mt-2 text-sm text-yellow-800 underline hover:text-yellow-900"
            >
              View and resolve conflicts
            </button>
          </div>
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-5 gap-4 mb-6">
          <div className="bg-white rounded-lg p-4 border border-gray-200 shadow-sm">
            <div className="text-gray-500 text-sm">Tickets Sold</div>
            <div className="text-2xl font-bold text-green-600">{ticketsSold}</div>
            <div className="text-xs text-gray-500">of {event.totalCapacity} total</div>
          </div>
          <div className="bg-white rounded-lg p-4 border border-gray-200 shadow-sm">
            <div className="text-gray-500 text-sm">Checked In</div>
            <div className="text-2xl font-bold text-purple-600">{event.ticketCounts.checkedIn}</div>
            <div className="text-xs text-gray-500">of {ticketsSold} sold</div>
          </div>
          <div className="bg-white rounded-lg p-4 border border-gray-200 shadow-sm">
            <div className="text-gray-500 text-sm">Held</div>
            <div className="text-2xl font-bold text-yellow-600">{event.ticketCounts.held}</div>
            <div className="text-xs text-gray-500">pending purchase</div>
          </div>
          <div className="bg-white rounded-lg p-4 border border-gray-200 shadow-sm">
            <div className="text-gray-500 text-sm">Available</div>
            <div className="text-2xl font-bold text-gray-900">
              {event.totalCapacity - ticketsSold - event.ticketCounts.held}
            </div>
            <div className="text-xs text-gray-500">remaining</div>
          </div>
          <div className="bg-white rounded-lg p-4 border border-gray-200 shadow-sm">
            <div className="text-gray-500 text-sm">Revenue</div>
            <div className="text-2xl font-bold text-blue-600">{formatCurrency(totalRevenue)}</div>
            {totalServiceFees > 0 && (
              <div className="text-xs text-gray-500">+{formatCurrency(totalServiceFees)} fees</div>
            )}
          </div>
        </div>

        {/* Capacity Bar */}
        <div className="bg-white rounded-lg p-4 mb-6 border border-gray-200 shadow-sm">
          <div className="flex justify-between mb-2">
            <span className="text-sm text-gray-600">Capacity</span>
            <span className="text-sm font-medium text-gray-900">{soldPercent}% sold</span>
          </div>
          <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                soldPercent >= 90 ? 'bg-purple-500' :
                soldPercent >= 50 ? 'bg-green-500' :
                'bg-blue-500'
              }`}
              style={{ width: `${soldPercent}%` }}
            />
          </div>
        </div>

        {/* Pricing Tiers */}
        <div className="bg-white rounded-lg p-6 mb-6 border border-gray-200 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Pricing Tiers</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {event.pricingTiers.map(tier => (
              <div
                key={tier.id}
                className="border border-gray-200 rounded-lg p-4"
                style={{ borderLeftColor: tier.color || '#4b5563', borderLeftWidth: 4 }}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-medium text-gray-900">{tier.name}</div>
                    {tier.description && (
                      <div className="text-sm text-gray-500 mt-1">{tier.description}</div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold text-gray-900">{formatCurrency(tier.price)}</div>
                    {tier.serviceFee > 0 && (
                      <div className="text-xs text-gray-500">+{formatCurrency(tier.serviceFee)} fee</div>
                    )}
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-gray-100 text-sm flex justify-between">
                  <span className="text-green-600 font-medium">{tier.quantitySold} sold</span>
                  {tier.quantityAvailable && (
                    <span className="text-gray-500">{tier.quantityAvailable - tier.quantitySold} remaining</span>
                  )}
                  <span className="text-gray-500">{formatCurrency(tier.quantitySold * tier.price)} revenue</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Event Details */}
        <div className="grid grid-cols-2 gap-6">
          <div className="bg-white rounded-lg p-6 border border-gray-200 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Event Details</h2>
            <dl className="space-y-3">
              <div className="flex justify-between">
                <dt className="text-gray-500">Event Type</dt>
                <dd className="text-gray-900 font-medium">
                  {EVENT_TYPE_LABELS[event.eventType] || event.eventType.replace('_', ' ')}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Ticketing Mode</dt>
                <dd className="text-gray-900 font-medium capitalize">{event.ticketingMode.replace('_', ' ')}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Online Sales</dt>
                <dd className={event.allowOnlineSales ? 'text-green-600 font-medium' : 'text-gray-400'}>
                  {event.allowOnlineSales ? 'Enabled' : 'Disabled'}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">POS Sales</dt>
                <dd className={event.allowPOSSales ? 'text-green-600 font-medium' : 'text-gray-400'}>
                  {event.allowPOSSales ? 'Enabled' : 'Disabled'}
                </dd>
              </div>
              {event.maxTicketsPerOrder && (
                <div className="flex justify-between">
                  <dt className="text-gray-500">Max Per Order</dt>
                  <dd className="text-gray-900 font-medium">{event.maxTicketsPerOrder}</dd>
                </div>
              )}
            </dl>
          </div>

          <div className="bg-white rounded-lg p-6 border border-gray-200 shadow-sm">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Schedule</h2>
            <dl className="space-y-3">
              <div className="flex justify-between">
                <dt className="text-gray-500">Event Date</dt>
                <dd className="text-gray-900 font-medium">{new Date(event.eventDate).toLocaleDateString()}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Doors Open</dt>
                <dd className="text-gray-900 font-medium">{formatTime(event.doorsOpen)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Show Time</dt>
                <dd className="text-gray-900 font-medium">{formatTime(event.startTime)}</dd>
              </div>
              {event.endTime && (
                <div className="flex justify-between">
                  <dt className="text-gray-500">End Time</dt>
                  <dd className="text-gray-900 font-medium">{formatTime(event.endTime)}</dd>
                </div>
              )}
            </dl>

            {/* Ticket Status Breakdown */}
            <div className="mt-6 pt-4 border-t border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Ticket Breakdown</h3>
              <div className="grid grid-cols-3 gap-2 text-sm">
                {event.ticketCounts.cancelled > 0 && (
                  <div className="text-center p-2 bg-red-50 rounded">
                    <div className="font-bold text-red-600">{event.ticketCounts.cancelled}</div>
                    <div className="text-red-500 text-xs">Cancelled</div>
                  </div>
                )}
                {event.ticketCounts.refunded > 0 && (
                  <div className="text-center p-2 bg-orange-50 rounded">
                    <div className="font-bold text-orange-600">{event.ticketCounts.refunded}</div>
                    <div className="text-orange-500 text-xs">Refunded</div>
                  </div>
                )}
              </div>
            </div>
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

        {/* Edit Event Modal */}
        {showEditModal && event && (
          <EditEventModal
            event={event}
            onSaved={() => { setShowEditModal(false); fetchEvent() }}
            onClose={() => setShowEditModal(false)}
          />
        )}
      </div>
    </div>
  )
}

function EditEventModal({
  event,
  onSaved,
  onClose,
}: {
  event: Event
  onSaved: () => void
  onClose: () => void
}) {
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    name: event.name,
    description: event.description || '',
    eventType: event.eventType,
    eventDate: event.eventDate,
    doorsOpen: event.doorsOpen,
    startTime: event.startTime,
    endTime: event.endTime || '',
    totalCapacity: event.totalCapacity,
    reservedCapacity: event.reservedCapacity,
    allowOnlineSales: event.allowOnlineSales,
    allowPOSSales: event.allowPOSSales,
    maxTicketsPerOrder: event.maxTicketsPerOrder || 10,
  })

  const hasSoldTickets = event.ticketCounts.sold > 0 || event.ticketCounts.checkedIn > 0

  async function handleSave() {
    setSaving(true)
    try {
      // Build update payload -- only send fields that are allowed
      const payload: Record<string, unknown> = {}

      // Always allowed
      if (form.description !== event.description) payload.description = form.description
      if (form.endTime !== (event.endTime || '')) payload.endTime = form.endTime || null
      if (form.reservedCapacity !== event.reservedCapacity) payload.reservedCapacity = form.reservedCapacity

      // Only allowed if no sold tickets
      if (!hasSoldTickets) {
        if (form.name !== event.name) payload.name = form.name
        if (form.eventType !== event.eventType) payload.eventType = form.eventType
        if (form.eventDate !== event.eventDate) payload.eventDate = form.eventDate
        if (form.doorsOpen !== event.doorsOpen) payload.doorsOpen = form.doorsOpen
        if (form.startTime !== event.startTime) payload.startTime = form.startTime
        if (form.totalCapacity !== event.totalCapacity) payload.totalCapacity = form.totalCapacity
        if (form.allowOnlineSales !== event.allowOnlineSales) payload.allowOnlineSales = form.allowOnlineSales
        if (form.allowPOSSales !== event.allowPOSSales) payload.allowPOSSales = form.allowPOSSales
        if (form.maxTicketsPerOrder !== event.maxTicketsPerOrder) payload.maxTicketsPerOrder = form.maxTicketsPerOrder
      }

      if (Object.keys(payload).length === 0) {
        onClose()
        return
      }

      const res = await fetch(`/api/events/${event.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error || 'Failed to update event')
        return
      }

      toast.success('Event updated')
      onSaved()
    } catch (error) {
      console.error('Failed to update event:', error)
      toast.error('Failed to update event')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen={true} onClose={onClose} title="Edit Event" size="2xl">
      {hasSoldTickets && (
        <div className="bg-yellow-50 border border-yellow-200 rounded p-3 mb-4 text-sm text-yellow-800">
          Some fields are locked because tickets have been sold. You can still edit description, end time, and reserved capacity.
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Event Name</label>
          <input
            type="text"
            value={form.name}
            onChange={e => setForm({ ...form, name: e.target.value })}
            disabled={hasSoldTickets}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 disabled:bg-gray-100 disabled:text-gray-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
          <textarea
            value={form.description}
            onChange={e => setForm({ ...form, description: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
            rows={3}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Event Date</label>
            <input
              type="date"
              value={form.eventDate}
              onChange={e => setForm({ ...form, eventDate: e.target.value })}
              disabled={hasSoldTickets}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 disabled:bg-gray-100 disabled:text-gray-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Total Capacity</label>
            <input
              type="number"
              value={form.totalCapacity}
              onChange={e => setForm({ ...form, totalCapacity: Number(e.target.value) })}
              disabled={hasSoldTickets}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 disabled:bg-gray-100 disabled:text-gray-500"
              min="1"
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Doors Open</label>
            <input
              type="time"
              value={form.doorsOpen}
              onChange={e => setForm({ ...form, doorsOpen: e.target.value })}
              disabled={hasSoldTickets}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 disabled:bg-gray-100 disabled:text-gray-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Show Start</label>
            <input
              type="time"
              value={form.startTime}
              onChange={e => setForm({ ...form, startTime: e.target.value })}
              disabled={hasSoldTickets}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 disabled:bg-gray-100 disabled:text-gray-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">End Time</label>
            <input
              type="time"
              value={form.endTime}
              onChange={e => setForm({ ...form, endTime: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Reserved Capacity (VIP/walk-in holds)</label>
            <input
              type="number"
              value={form.reservedCapacity}
              onChange={e => setForm({ ...form, reservedCapacity: Number(e.target.value) })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900"
              min="0"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Max Per Order</label>
            <input
              type="number"
              value={form.maxTicketsPerOrder}
              onChange={e => setForm({ ...form, maxTicketsPerOrder: Number(e.target.value) })}
              disabled={hasSoldTickets}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-gray-900 disabled:bg-gray-100 disabled:text-gray-500"
              min="1"
            />
          </div>
        </div>
      </div>

      <div className="flex gap-3 mt-6">
        <button
          onClick={onClose}
          className="flex-1 px-4 py-2 bg-gray-100 rounded-lg hover:bg-gray-200 text-gray-700 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex-1 px-4 py-2 bg-blue-600 rounded-lg hover:bg-blue-700 text-white disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>
    </Modal>
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
    <Modal
      isOpen={true}
      onClose={onClose}
      title="Resolve Reservation Conflicts"
      size="2xl"
    >
      <p className="text-gray-600 mb-4">
        The following reservations overlap with this event. Choose how to handle them:
      </p>

      <div className="space-y-3 mb-6 max-h-64 overflow-y-auto">
        {conflicts.map(conflict => (
          <label
            key={conflict.reservationId}
            className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 border border-gray-200"
          >
            <input
              type="checkbox"
              checked={selectedIds.includes(conflict.reservationId)}
              onChange={e => {
                if (e.target.checked) {
                  setSelectedIds([...selectedIds, conflict.reservationId])
                } else {
                  setSelectedIds(selectedIds.filter(cid => cid !== conflict.reservationId))
                }
              }}
              className="w-4 h-4 rounded border-gray-300 text-blue-600"
            />
            <div className="flex-1">
              <div className="font-medium text-gray-900">{conflict.guestName}</div>
              <div className="text-sm text-gray-600">
                Party of {conflict.partySize} at {formatTime(conflict.reservationTime)}
                {conflict.tableName && ` - ${conflict.tableName}`}
              </div>
              <div className="text-xs text-yellow-700">
                {conflict.overlapMinutes} min overlap
              </div>
            </div>
          </label>
        ))}
      </div>

      <div className="flex gap-3">
        <button
          onClick={onClose}
          className="flex-1 px-4 py-2 bg-gray-100 rounded hover:bg-gray-200 text-gray-700"
        >
          Cancel
        </button>
        <button
          onClick={() => onResolve('ignore')}
          className="flex-1 px-4 py-2 bg-yellow-500 rounded hover:bg-yellow-600 text-white"
        >
          Keep All
        </button>
        <button
          onClick={() => onResolve('cancel_selected', selectedIds)}
          disabled={selectedIds.length === 0}
          className="flex-1 px-4 py-2 bg-orange-600 rounded hover:bg-orange-700 text-white disabled:opacity-50"
        >
          Cancel Selected ({selectedIds.length})
        </button>
        <button
          onClick={() => onResolve('cancel_all')}
          className="flex-1 px-4 py-2 bg-red-600 rounded hover:bg-red-700 text-white"
        >
          Cancel All ({conflicts.length})
        </button>
      </div>
    </Modal>
  )
}

function formatTime(time: string) {
  const [hours, minutes] = time.split(':')
  const h = parseInt(hours)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hour = h > 12 ? h - 12 : h === 0 ? 12 : h
  return `${hour}:${minutes} ${ampm}`
}
