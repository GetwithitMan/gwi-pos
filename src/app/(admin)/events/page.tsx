'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from '@/stores/toast-store'

interface PricingTier {
  id: string
  name: string
  price: number
  color?: string
}

interface Event {
  id: string
  name: string
  description?: string
  imageUrl?: string
  eventType: string
  eventDate: string
  doorsOpen: string
  startTime: string
  endTime?: string
  ticketingMode: string
  totalCapacity: number
  reservedCapacity: number
  status: string
  soldCount: number
  availableCount: number
  pricingTiers: PricingTier[]
  createdAt: string
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
  comedy_night: 'Comedy Night',
  karaoke: 'Karaoke Night',
}

export default function EventsPage() {
  const router = useRouter()
  const { employee, isAuthenticated } = useAuthStore()
  const locationId = employee?.location?.id

  const [events, setEvents] = useState<Event[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('upcoming')

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login?redirect=/events')
    }
  }, [isAuthenticated, router])

  useEffect(() => {
    if (locationId) {
      fetchEvents()
    }
  }, [filter, locationId])

  async function fetchEvents() {
    if (!locationId) return
    try {
      const params = new URLSearchParams({ locationId })
      if (filter === 'upcoming') {
        params.set('upcoming', 'true')
      } else if (filter !== 'all') {
        params.set('status', filter)
      }

      const res = await fetch(`/api/events?${params}`)
      const data = await res.json()
      setEvents(data.events || [])
    } catch (error) {
      console.error('Failed to fetch events:', error)
    } finally {
      setLoading(false)
    }
  }

  const stats = {
    total: events.length,
    onSale: events.filter(e => e.status === 'on_sale').length,
    draft: events.filter(e => e.status === 'draft').length,
    totalTickets: events.reduce((sum, e) => sum + e.soldCount, 0),
    totalCapacity: events.reduce((sum, e) => sum + e.totalCapacity, 0),
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-400">Loading events...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Events"
        actions={
          <Link href="/events/new">
            <Button variant="primary">Create Event</Button>
          </Link>
        }
      />

      {/* Main Content */}
      <main className="max-w-7xl mx-auto mt-6">
      {/* Filters */}
      <div className="flex gap-2 mb-6">
        {['upcoming', 'all', 'draft', 'on_sale', 'sold_out', 'completed', 'cancelled'].map(status => (
          <button
            key={status}
            onClick={() => setFilter(status)}
            className={`px-3 py-2 rounded capitalize ${
              filter === status ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
            }`}
          >
            {status === 'on_sale' ? 'On Sale' : status.replace('_', ' ')}
          </button>
        ))}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-5 gap-4 mb-6">
        <div className="bg-white rounded-lg p-4 border border-gray-200 shadow">
          <div className="text-gray-600 text-sm">Total Events</div>
          <div className="text-2xl font-bold text-gray-900">{stats.total}</div>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-200 shadow">
          <div className="text-gray-600 text-sm">On Sale</div>
          <div className="text-2xl font-bold text-green-600">{stats.onSale}</div>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-200 shadow">
          <div className="text-gray-600 text-sm">Drafts</div>
          <div className="text-2xl font-bold text-gray-600">{stats.draft}</div>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-200 shadow">
          <div className="text-gray-600 text-sm">Tickets Sold</div>
          <div className="text-2xl font-bold text-blue-600">{stats.totalTickets}</div>
        </div>
        <div className="bg-white rounded-lg p-4 border border-gray-200 shadow">
          <div className="text-gray-600 text-sm">Total Capacity</div>
          <div className="text-2xl font-bold text-gray-900">{stats.totalCapacity}</div>
        </div>
      </div>

      {/* Event List */}
      <div className="space-y-4">
        {events.length === 0 ? (
          <div className="bg-white rounded-lg p-8 text-center text-gray-600 border border-gray-200 shadow">
            No events found. Create your first event to get started.
          </div>
        ) : (
          events.map(event => (
            <EventCard key={event.id} event={event} onRefresh={fetchEvents} />
          ))
        )}
      </div>
      </main>
    </div>
  )
}

function EventCard({ event, onRefresh }: { event: Event; onRefresh: () => void }) {
  const [showActions, setShowActions] = useState(false)
  const soldPercent = event.totalCapacity > 0
    ? Math.round((event.soldCount / event.totalCapacity) * 100)
    : 0

  async function publishEvent() {
    if (!confirm('Publish this event and start ticket sales?')) return

    try {
      const res = await fetch(`/api/events/${event.id}/publish`, {
        method: 'POST',
      })
      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error || 'Failed to publish event')
        return
      }
      onRefresh()
    } catch (error) {
      console.error('Failed to publish:', error)
    }
  }

  async function cancelEvent() {
    if (!confirm('Are you sure you want to cancel this event?')) return

    try {
      await fetch(`/api/events/${event.id}`, { method: 'DELETE' })
      onRefresh()
    } catch (error) {
      console.error('Failed to cancel:', error)
    }
  }

  return (
    <div className="bg-white rounded-lg p-4 relative border border-gray-200 shadow">
      <div className="flex gap-4">
        {/* Date column */}
        <div className="flex-shrink-0 w-20 text-center">
          <div className="text-3xl font-bold text-gray-900">{new Date(event.eventDate).getDate()}</div>
          <div className="text-sm text-gray-600 uppercase">
            {new Date(event.eventDate).toLocaleDateString('en-US', { month: 'short' })}
          </div>
          <div className="text-xs text-gray-500">
            {new Date(event.eventDate).toLocaleDateString('en-US', { weekday: 'short' })}
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-3">
                <Link href={`/events/${event.id}`} className="text-lg font-medium text-gray-900 hover:underline">
                  {event.name}
                </Link>
                <span className={`px-2 py-0.5 text-xs rounded ${STATUS_COLORS[event.status]}`}>
                  {event.status.replace('_', ' ')}
                </span>
              </div>
              <div className="text-sm text-gray-600 mt-1">
                {EVENT_TYPE_LABELS[event.eventType] || event.eventType} &bull;{' '}
                Doors {formatTime(event.doorsOpen)} &bull;{' '}
                Show {formatTime(event.startTime)}
                {event.endTime && ` - ${formatTime(event.endTime)}`}
              </div>
              {event.pricingTiers.length > 0 && (
                <div className="flex gap-2 mt-2">
                  {event.pricingTiers.map(tier => (
                    <span
                      key={tier.id}
                      className="px-2 py-1 text-xs rounded"
                      style={{ backgroundColor: tier.color || '#374151' }}
                    >
                      {tier.name}: ${tier.price}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2">
              {/* Capacity indicator */}
              <div className="text-right mr-4">
                <div className="text-lg font-medium text-gray-900">
                  {event.soldCount} / {event.totalCapacity}
                </div>
                <div className="text-xs text-gray-600">tickets sold</div>
                <div className="w-32 h-2 bg-gray-200 rounded-full mt-1">
                  <div
                    className={`h-full rounded-full ${
                      soldPercent >= 90 ? 'bg-purple-500' :
                      soldPercent >= 50 ? 'bg-green-500' :
                      'bg-blue-500'
                    }`}
                    style={{ width: `${soldPercent}%` }}
                  />
                </div>
              </div>

              {/* Quick actions */}
              {event.status === 'on_sale' && (
                <Link
                  href={`/events/${event.id}/sell`}
                  className="px-3 py-1.5 bg-green-600 rounded text-sm text-white hover:bg-green-700"
                >
                  Sell Tickets
                </Link>
              )}
              {event.status === 'draft' && (
                <button
                  onClick={publishEvent}
                  className="px-3 py-1.5 bg-blue-600 rounded text-sm text-white hover:bg-blue-700"
                >
                  Publish
                </button>
              )}
              {(event.status === 'on_sale' || event.status === 'sold_out') && (
                <Link
                  href={`/events/${event.id}/check-in`}
                  className="px-3 py-1.5 bg-purple-600 rounded text-sm text-white hover:bg-purple-700"
                >
                  Check-In
                </Link>
              )}

              <button
                onClick={() => setShowActions(!showActions)}
                className="px-2 py-1.5 bg-gray-200 rounded text-gray-700 hover:bg-gray-300"
              >
                ...
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Action dropdown */}
      {showActions && (
        <div className="absolute right-4 top-16 bg-white rounded-lg shadow-xl border border-gray-200 py-2 z-10 min-w-[150px]">
          <Link
            href={`/events/${event.id}`}
            className="block px-4 py-2 text-gray-700 hover:bg-gray-50"
            onClick={() => setShowActions(false)}
          >
            View Details
          </Link>
          <Link
            href={`/events/${event.id}/sell`}
            className="block px-4 py-2 text-gray-700 hover:bg-gray-50"
            onClick={() => setShowActions(false)}
          >
            Sell Tickets
          </Link>
          <Link
            href={`/events/${event.id}/check-in`}
            className="block px-4 py-2 text-gray-700 hover:bg-gray-50"
            onClick={() => setShowActions(false)}
          >
            Check-In
          </Link>
          {event.status === 'draft' && (
            <button
              onClick={() => { publishEvent(); setShowActions(false) }}
              className="w-full px-4 py-2 text-left hover:bg-gray-50 text-green-600"
            >
              Publish Event
            </button>
          )}
          {event.status !== 'cancelled' && event.status !== 'completed' && (
            <button
              onClick={() => { cancelEvent(); setShowActions(false) }}
              className="w-full px-4 py-2 text-left hover:bg-gray-50 text-red-600"
            >
              Cancel Event
            </button>
          )}
        </div>
      )}
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
