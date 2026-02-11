'use client'

import { useState, useEffect, useRef, use } from 'react'
import Link from 'next/link'
import { toast } from '@/stores/toast-store'

interface Ticket {
  id: string
  ticketNumber: string
  barcode: string
  status: string
  customerName?: string
  customerEmail?: string
  seatLabel?: string
  tableName?: string
  pricingTier: {
    name: string
    color?: string
  }
  checkedInAt?: string
}

interface EventInfo {
  id: string
  name: string
  eventDate: string
  doorsOpen: string
  startTime: string
}

interface CheckInStats {
  checkedIn: number
  remaining: number
  total: number
  percentCheckedIn: number
}

interface CheckInResult {
  success: boolean
  checkInResult: string
  ticket?: {
    ticketNumber: string
    customerName?: string
    seatLabel?: string
    tableName?: string
    pricingTier: string
    tierColor?: string
  }
  stats?: CheckInStats
  error?: string
  checkedInAt?: string
}

export default function CheckInPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [event, setEvent] = useState<EventInfo | null>(null)
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [stats, setStats] = useState<CheckInStats>({ checkedIn: 0, remaining: 0, total: 0, percentCheckedIn: 0 })
  const [loading, setLoading] = useState(true)
  const [scanInput, setScanInput] = useState('')
  const [lastResult, setLastResult] = useState<CheckInResult | null>(null)
  const [filter, setFilter] = useState<'all' | 'checked_in' | 'not_checked_in'>('not_checked_in')
  const [search, setSearch] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetchData()
    // Keep focus on scan input
    inputRef.current?.focus()
  }, [id])

  async function fetchData() {
    try {
      // Fetch event
      const eventRes = await fetch(`/api/events/${id}`)
      const eventData = await eventRes.json()
      setEvent(eventData.event)

      // Fetch tickets
      const ticketsRes = await fetch(`/api/tickets?eventId=${id}`)
      const ticketsData = await ticketsRes.json()
      setTickets(ticketsData.tickets || [])

      // Calculate stats
      const sold = ticketsData.tickets?.filter((t: Ticket) =>
        ['sold', 'checked_in'].includes(t.status)
      ) || []
      const checkedIn = sold.filter((t: Ticket) => t.status === 'checked_in').length
      setStats({
        checkedIn,
        remaining: sold.length - checkedIn,
        total: sold.length,
        percentCheckedIn: sold.length > 0 ? Math.round((checkedIn / sold.length) * 100) : 0,
      })
    } catch (error) {
      console.error('Failed to fetch data:', error)
    } finally {
      setLoading(false)
    }
  }

  async function handleScan(e: React.FormEvent) {
    e.preventDefault()
    if (!scanInput.trim()) return

    try {
      const res = await fetch(`/api/tickets/${scanInput.trim()}/check-in`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'scan' }),
      })

      const data: CheckInResult = await res.json()
      setLastResult(data)

      if (data.stats) {
        setStats(data.stats)
      }

      // Refresh ticket list
      fetchData()

      // Play sound based on result
      if (data.success) {
        playSound('success')
      } else {
        playSound('error')
      }
    } catch (error) {
      console.error('Check-in failed:', error)
      setLastResult({
        success: false,
        checkInResult: 'error',
        error: 'Check-in failed',
      })
      playSound('error')
    }

    setScanInput('')
    inputRef.current?.focus()
  }

  async function manualCheckIn(ticketId: string) {
    try {
      const res = await fetch(`/api/tickets/${ticketId}/check-in`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'manual' }),
      })

      const data: CheckInResult = await res.json()

      if (data.success) {
        playSound('success')
        if (data.stats) {
          setStats(data.stats)
        }
      } else {
        toast.error(data.error || 'Check-in failed')
      }

      fetchData()
    } catch (error) {
      console.error('Check-in failed:', error)
    }
  }

  async function undoCheckIn(ticketId: string) {
    try {
      await fetch(`/api/tickets/${ticketId}/check-in`, {
        method: 'DELETE',
      })
      fetchData()
    } catch (error) {
      console.error('Undo failed:', error)
    }
  }

  function playSound(type: 'success' | 'error') {
    // Simple beep using Web Audio API
    try {
      const ctx = new AudioContext()
      const oscillator = ctx.createOscillator()
      const gain = ctx.createGain()

      oscillator.connect(gain)
      gain.connect(ctx.destination)

      oscillator.frequency.value = type === 'success' ? 800 : 300
      oscillator.type = 'sine'
      gain.gain.value = 0.3

      oscillator.start()
      setTimeout(() => {
        oscillator.stop()
        ctx.close()
      }, type === 'success' ? 150 : 300)
    } catch {
      // Audio not supported
    }
  }

  const filteredTickets = tickets
    .filter(t => {
      if (filter === 'checked_in') return t.status === 'checked_in'
      if (filter === 'not_checked_in') return t.status === 'sold'
      return ['sold', 'checked_in'].includes(t.status)
    })
    .filter(t => {
      if (!search) return true
      const s = search.toLowerCase()
      return (
        t.ticketNumber.toLowerCase().includes(s) ||
        t.customerName?.toLowerCase().includes(s) ||
        t.customerEmail?.toLowerCase().includes(s) ||
        t.seatLabel?.toLowerCase().includes(s) ||
        t.tableName?.toLowerCase().includes(s)
      )
    })

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-400">Loading...</div>
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

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <div className="bg-gray-800 p-4">
        <Link href={`/events/${id}`} className="text-gray-400 hover:text-white text-sm">
          &larr; Back to Event
        </Link>
        <div className="flex justify-between items-center mt-2">
          <div>
            <h1 className="text-xl font-bold">{event.name}</h1>
            <div className="text-sm text-gray-400">
              {new Date(event.eventDate).toLocaleDateString()} &bull; Check-In
            </div>
          </div>

          {/* Stats */}
          <div className="flex gap-6">
            <div className="text-center">
              <div className="text-3xl font-bold text-green-400">{stats.checkedIn}</div>
              <div className="text-sm text-gray-400">Checked In</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-yellow-400">{stats.remaining}</div>
              <div className="text-sm text-gray-400">Remaining</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold">{stats.total}</div>
              <div className="text-sm text-gray-400">Total</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-blue-400">{stats.percentCheckedIn}%</div>
              <div className="text-sm text-gray-400">Complete</div>
            </div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-4 h-2 bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-green-500 transition-all"
            style={{ width: `${stats.percentCheckedIn}%` }}
          />
        </div>
      </div>

      {/* Scan Input */}
      <div className="bg-gray-900 p-4 border-b border-gray-700">
        <form onSubmit={handleScan} className="flex gap-4 max-w-2xl mx-auto">
          <input
            ref={inputRef}
            type="text"
            value={scanInput}
            onChange={e => setScanInput(e.target.value)}
            placeholder="Scan barcode or enter ticket number..."
            className="flex-1 px-4 py-3 bg-gray-800 rounded-lg text-lg focus:ring-2 focus:ring-blue-500"
            autoFocus
          />
          <button
            type="submit"
            className="px-6 py-3 bg-blue-600 rounded-lg hover:bg-blue-700 font-medium"
          >
            Check In
          </button>
        </form>

        {/* Last scan result */}
        {lastResult && (
          <div
            className={`mt-4 p-4 rounded-lg max-w-2xl mx-auto ${
              lastResult.success
                ? 'bg-green-900/50 border border-green-600'
                : 'bg-red-900/50 border border-red-600'
            }`}
          >
            {lastResult.success ? (
              <div className="flex items-center gap-4">
                <div className="text-4xl">&#10003;</div>
                <div>
                  <div className="font-bold text-lg">{lastResult.ticket?.customerName || 'Guest'}</div>
                  <div className="text-sm">
                    {lastResult.ticket?.seatLabel && `Seat ${lastResult.ticket.seatLabel}`}
                    {lastResult.ticket?.tableName && ` - ${lastResult.ticket.tableName}`}
                    {' '}&bull; {lastResult.ticket?.pricingTier}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-4">
                <div className="text-4xl text-red-400">&#10007;</div>
                <div>
                  <div className="font-bold text-lg">
                    {lastResult.checkInResult === 'already_checked_in'
                      ? 'Already Checked In'
                      : lastResult.checkInResult === 'invalid'
                        ? 'Ticket Not Found'
                        : 'Check-In Failed'}
                  </div>
                  <div className="text-sm text-red-300">{lastResult.error}</div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Guest List */}
      <div className="flex-1 overflow-auto p-4">
        <div className="max-w-4xl mx-auto">
          {/* Filters */}
          <div className="flex gap-4 mb-4">
            <div className="flex gap-2">
              {(['not_checked_in', 'checked_in', 'all'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 rounded ${
                    filter === f ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'
                  }`}
                >
                  {f === 'not_checked_in' ? 'Not Checked In' :
                   f === 'checked_in' ? 'Checked In' : 'All'}
                </button>
              ))}
            </div>
            <input
              type="text"
              placeholder="Search by name, ticket #, seat..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="flex-1 px-3 py-1.5 bg-gray-700 rounded"
            />
          </div>

          {/* Ticket list */}
          <div className="space-y-2">
            {filteredTickets.length === 0 ? (
              <div className="text-center text-gray-400 py-8">
                No tickets found
              </div>
            ) : (
              filteredTickets.map(ticket => (
                <div
                  key={ticket.id}
                  className={`bg-gray-800 rounded-lg p-4 flex items-center gap-4 ${
                    ticket.status === 'checked_in' ? 'opacity-60' : ''
                  }`}
                >
                  <div
                    className={`w-3 h-3 rounded-full ${
                      ticket.status === 'checked_in' ? 'bg-green-500' : 'bg-yellow-500'
                    }`}
                  />

                  <div className="flex-1">
                    <div className="font-medium">{ticket.customerName || 'Guest'}</div>
                    <div className="text-sm text-gray-400">
                      {ticket.ticketNumber}
                      {ticket.seatLabel && ` - Seat ${ticket.seatLabel}`}
                      {ticket.tableName && ` (${ticket.tableName})`}
                    </div>
                  </div>

                  <div
                    className="px-2 py-1 rounded text-xs"
                    style={{ backgroundColor: ticket.pricingTier.color || '#4b5563' }}
                  >
                    {ticket.pricingTier.name}
                  </div>

                  {ticket.status === 'checked_in' ? (
                    <button
                      onClick={() => undoCheckIn(ticket.id)}
                      className="px-3 py-1.5 bg-gray-700 rounded text-sm hover:bg-gray-600"
                    >
                      Undo
                    </button>
                  ) : (
                    <button
                      onClick={() => manualCheckIn(ticket.id)}
                      className="px-3 py-1.5 bg-green-600 rounded text-sm hover:bg-green-700"
                    >
                      Check In
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
