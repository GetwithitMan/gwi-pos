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
  pricingTiers?: {
    id: string
    name: string
    price: number
    color?: string
  }[]
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
  const [showWalkIn, setShowWalkIn] = useState(false)
  const [walkInQuantity, setWalkInQuantity] = useState(1)
  const [walkInTier, setWalkInTier] = useState('')
  const [walkInName, setWalkInName] = useState('')
  const [walkInProcessing, setWalkInProcessing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetchData()
    inputRef.current?.focus()
  }, [id])

  async function fetchData() {
    try {
      const eventRes = await fetch(`/api/events/${id}`)
      const eventData = await eventRes.json()
      setEvent(eventData.data.event)

      const ticketsRes = await fetch(`/api/tickets?eventId=${id}`)
      const ticketsData = await ticketsRes.json()
      setTickets(ticketsData.data.tickets || [])

      const sold = ticketsData.data.tickets?.filter((t: Ticket) =>
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

      const raw = await res.json()
      const data: CheckInResult = raw.data
      setLastResult(data)

      if (data.stats) {
        setStats(data.stats)
      }

      fetchData()

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

      const raw2 = await res.json()
      const data: CheckInResult = raw2.data

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

  async function handleWalkIn() {
    if (!walkInTier || walkInQuantity < 1) {
      toast.error('Select a pricing tier and quantity')
      return
    }
    setWalkInProcessing(true)
    try {
      const res = await fetch(`/api/events/${id}/walk-in`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quantity: walkInQuantity,
          pricingTierId: walkInTier,
          customerName: walkInName || 'Walk-in',
          autoCheckIn: true,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Failed to add walk-in')
        return
      }
      toast.success(`${data.data.walkInCount} walk-in(s) added and checked in`)
      playSound('success')
      setWalkInQuantity(1)
      setWalkInName('')
      setShowWalkIn(false)
      fetchData()
    } catch (error) {
      console.error('Walk-in failed:', error)
      toast.error('Failed to add walk-in')
    } finally {
      setWalkInProcessing(false)
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
      <div className="flex items-center justify-center h-full bg-gray-50">
        <div className="text-gray-600">Loading...</div>
      </div>
    )
  }

  if (!event) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50">
        <div className="text-gray-600">Event not found</div>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <div className="bg-white p-4 border-b border-gray-200 shadow-sm">
        <Link href={`/events/${id}`} className="text-blue-600 hover:text-blue-700 text-sm">
          &larr; Back to Event
        </Link>
        <div className="flex justify-between items-center mt-2">
          <div>
            <h1 className="text-xl font-bold text-gray-900">{event.name}</h1>
            <div className="text-sm text-gray-500">
              {new Date(event.eventDate).toLocaleDateString()} -- Check-In
            </div>
          </div>

          {/* Stats + Walk-in */}
          <div className="flex items-center gap-6">
            <button
              onClick={() => {
                setShowWalkIn(!showWalkIn)
                if (!walkInTier && event?.pricingTiers?.length) {
                  setWalkInTier(event.pricingTiers[0].id)
                }
              }}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                showWalkIn
                  ? 'bg-orange-600 text-white'
                  : 'bg-orange-100 text-orange-700 hover:bg-orange-200'
              }`}
            >
              Walk-In / Cover
            </button>
            <div className="text-center">
              <div className="text-3xl font-bold text-green-600">{stats.checkedIn}</div>
              <div className="text-sm text-gray-500">Checked In</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-yellow-600">{stats.remaining}</div>
              <div className="text-sm text-gray-500">Remaining</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-gray-900">{stats.total}</div>
              <div className="text-sm text-gray-500">Total</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-blue-600">{stats.percentCheckedIn}%</div>
              <div className="text-sm text-gray-500">Complete</div>
            </div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-4 h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-green-500 transition-all rounded-full"
            style={{ width: `${stats.percentCheckedIn}%` }}
          />
        </div>
      </div>

      {/* Scan Input */}
      <div className="bg-white p-4 border-b border-gray-200">
        <form onSubmit={handleScan} className="flex gap-4 max-w-2xl mx-auto">
          <input
            ref={inputRef}
            type="text"
            value={scanInput}
            onChange={e => setScanInput(e.target.value)}
            placeholder="Scan barcode or enter ticket number..."
            className="flex-1 px-4 py-3 bg-gray-50 border border-gray-300 rounded-lg text-lg text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            autoFocus
          />
          <button
            type="submit"
            className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium transition-colors"
          >
            Check In
          </button>
        </form>

        {/* Last scan result */}
        {lastResult && (
          <div
            className={`mt-4 p-4 rounded-lg max-w-2xl mx-auto ${
              lastResult.success
                ? 'bg-green-50 border border-green-200'
                : 'bg-red-50 border border-red-200'
            }`}
          >
            {lastResult.success ? (
              <div className="flex items-center gap-4">
                <div className="text-4xl text-green-500">&#10003;</div>
                <div>
                  <div className="font-bold text-lg text-green-900">{lastResult.ticket?.customerName || 'Guest'}</div>
                  <div className="text-sm text-green-700">
                    {lastResult.ticket?.seatLabel && `Seat ${lastResult.ticket.seatLabel}`}
                    {lastResult.ticket?.tableName && ` - ${lastResult.ticket.tableName}`}
                    {' '} -- {lastResult.ticket?.pricingTier}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-4">
                <div className="text-4xl text-red-500">&#10007;</div>
                <div>
                  <div className="font-bold text-lg text-red-900">
                    {lastResult.checkInResult === 'already_checked_in'
                      ? 'Already Checked In'
                      : lastResult.checkInResult === 'invalid'
                        ? 'Ticket Not Found'
                        : 'Check-In Failed'}
                  </div>
                  <div className="text-sm text-red-700">{lastResult.error}</div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Walk-In Panel */}
      {showWalkIn && event?.pricingTiers && (
        <div className="bg-orange-50 border-b border-orange-200 p-4">
          <div className="max-w-2xl mx-auto">
            <h3 className="font-semibold text-orange-900 mb-3">Walk-In / Cover Charge</h3>
            <div className="flex gap-4 items-end">
              <div>
                <label className="block text-xs text-orange-800 mb-1">Name (optional)</label>
                <input
                  type="text"
                  value={walkInName}
                  onChange={e => setWalkInName(e.target.value)}
                  placeholder="Walk-in"
                  className="px-3 py-2 bg-white border border-orange-300 rounded-lg text-gray-900 text-sm"
                />
              </div>
              <div>
                <label className="block text-xs text-orange-800 mb-1">Tier</label>
                <select
                  value={walkInTier}
                  onChange={e => setWalkInTier(e.target.value)}
                  className="px-3 py-2 bg-white border border-orange-300 rounded-lg text-gray-900 text-sm"
                >
                  {event.pricingTiers.map(tier => (
                    <option key={tier.id} value={tier.id}>
                      {tier.name} - ${tier.price}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-orange-800 mb-1">Qty</label>
                <input
                  type="number"
                  value={walkInQuantity}
                  onChange={e => setWalkInQuantity(Math.max(1, Number(e.target.value)))}
                  min="1"
                  max="20"
                  className="w-16 px-3 py-2 bg-white border border-orange-300 rounded-lg text-gray-900 text-sm text-center"
                />
              </div>
              <button
                onClick={handleWalkIn}
                disabled={walkInProcessing}
                className="px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 disabled:opacity-50 text-sm font-medium transition-colors whitespace-nowrap"
              >
                {walkInProcessing ? 'Adding...' : `Add ${walkInQuantity} Walk-In${walkInQuantity !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        </div>
      )}

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
                  className={`px-3 py-1.5 rounded transition-colors ${
                    filter === f
                      ? 'bg-blue-600 text-white'
                      : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
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
              className="flex-1 px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {/* Ticket list */}
          <div className="space-y-2">
            {filteredTickets.length === 0 ? (
              <div className="text-center text-gray-500 py-8">
                No tickets found
              </div>
            ) : (
              filteredTickets.map(ticket => (
                <div
                  key={ticket.id}
                  className={`bg-white rounded-lg p-4 flex items-center gap-4 border border-gray-200 shadow-sm transition-opacity ${
                    ticket.status === 'checked_in' ? 'opacity-60' : ''
                  }`}
                >
                  <div
                    className={`w-3 h-3 rounded-full flex-shrink-0 ${
                      ticket.status === 'checked_in' ? 'bg-green-500' : 'bg-yellow-500'
                    }`}
                  />

                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-gray-900">{ticket.customerName || 'Guest'}</div>
                    <div className="text-sm text-gray-500 truncate">
                      {ticket.ticketNumber}
                      {ticket.seatLabel && ` - Seat ${ticket.seatLabel}`}
                      {ticket.tableName && ` (${ticket.tableName})`}
                    </div>
                  </div>

                  <div
                    className="px-2 py-1 rounded text-xs text-white flex-shrink-0"
                    style={{ backgroundColor: ticket.pricingTier.color || '#4b5563' }}
                  >
                    {ticket.pricingTier.name}
                  </div>

                  {ticket.status === 'checked_in' ? (
                    <button
                      onClick={() => undoCheckIn(ticket.id)}
                      className="px-3 py-1.5 bg-gray-100 border border-gray-300 rounded text-sm text-gray-700 hover:bg-gray-200 transition-colors flex-shrink-0"
                    >
                      Undo
                    </button>
                  ) : (
                    <button
                      onClick={() => manualCheckIn(ticket.id)}
                      className="px-3 py-1.5 bg-green-600 rounded text-sm text-white hover:bg-green-700 transition-colors flex-shrink-0"
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
