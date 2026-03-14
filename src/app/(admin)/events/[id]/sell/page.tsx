'use client'

import { useState, useEffect, use } from 'react'
import Link from 'next/link'
import { toast } from '@/stores/toast-store'
import { formatCurrency } from '@/lib/utils'

interface Seat {
  id: string
  label: string
  seatNumber: number
  seatType: string
  relativeX: number
  relativeY: number
  status: 'available' | 'held' | 'sold'
  ticketId?: string
}

interface TableWithSeats {
  tableId: string
  tableName: string
  capacity: number
  sectionName?: string
  posX: number
  posY: number
  width: number
  height: number
  shape: string
  pricingTierId?: string
  seats: Seat[]
  seatCounts: {
    total: number
    available: number
    held: number
    sold: number
  }
}

interface PricingTier {
  id: string
  name: string
  price: number
  serviceFee: number
  color?: string
  remaining: number | null
  quantityAvailable?: number
  quantitySold?: number
}

interface EventInfo {
  id: string
  name: string
  eventDate: string
  doorsOpen: string
  startTime: string
  ticketingMode: string
  status: string
}

interface HeldTicket {
  id: string
  ticketNumber: string
  seatId?: string
  seatLabel?: string
  tableId?: string
  tableName?: string
  pricingTier: string
  totalPrice: number
}

interface Summary {
  totalCapacity: number
  availableSeats: number
  soldSeats: number
  heldSeats: number
}

const SEAT_STATUS_COLORS: Record<string, string> = {
  available: '#22c55e',
  held: '#eab308',
  sold: '#ef4444',
}

export default function SellTicketsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [event, setEvent] = useState<EventInfo | null>(null)
  const [tables, setTables] = useState<TableWithSeats[]>([])
  const [pricingTiers, setPricingTiers] = useState<PricingTier[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedSeats, setSelectedSeats] = useState<string[]>([])
  const [selectedTier, setSelectedTier] = useState<string>('')
  const [heldTickets, setHeldTickets] = useState<HeldTicket[]>([])
  const [gaQuantity, setGaQuantity] = useState(1)
  const [customerForm, setCustomerForm] = useState({
    name: '',
    email: '',
    phone: '',
  })
  const [processing, setProcessing] = useState(false)
  const [sessionId] = useState(() => `pos-${Date.now()}`)

  useEffect(() => {
    fetchAvailability()
  }, [id])

  async function fetchAvailability() {
    try {
      const res = await fetch(`/api/events/${id}/availability`)
      const data = await res.json()
      setEvent(data.data.event)
      setTables(data.data.tables || [])
      setPricingTiers(data.data.pricingTiers || [])
      setSummary(data.data.summary || null)
      if (data.data.pricingTiers?.length > 0 && !selectedTier) {
        setSelectedTier(data.data.pricingTiers[0].id)
      }
    } catch (error) {
      console.error('Failed to fetch availability:', error)
    } finally {
      setLoading(false)
    }
  }

  function toggleSeatSelection(seatId: string, seat: Seat) {
    if (seat.status !== 'available') return

    if (selectedSeats.includes(seatId)) {
      setSelectedSeats(selectedSeats.filter(sid => sid !== seatId))
    } else {
      setSelectedSeats([...selectedSeats, seatId])
    }
  }

  async function holdSelectedSeats() {
    if (!selectedTier) return

    setProcessing(true)
    try {
      const body: Record<string, unknown> = {
        pricingTierId: selectedTier,
        sessionId,
        holdDurationMinutes: 10,
      }

      if (event?.ticketingMode === 'general_admission') {
        body.quantity = gaQuantity
      } else {
        if (selectedSeats.length === 0) return
        body.seatIds = selectedSeats
      }

      const res = await fetch(`/api/events/${id}/tickets/hold`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Failed to hold tickets')
        return
      }

      setHeldTickets(data.data.tickets || [])
      setSelectedSeats([])
      setGaQuantity(1)
      fetchAvailability()
    } catch (error) {
      console.error('Failed to hold tickets:', error)
    } finally {
      setProcessing(false)
    }
  }

  async function completePurchase() {
    if (heldTickets.length === 0 || !customerForm.name) {
      toast.warning('Please enter customer name')
      return
    }

    setProcessing(true)
    try {
      const res = await fetch(`/api/events/${id}/tickets/purchase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticketIds: heldTickets.map(t => t.id),
          customerName: customerForm.name,
          customerEmail: customerForm.email,
          customerPhone: customerForm.phone,
          purchaseChannel: 'pos',
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Failed to complete purchase')
        return
      }

      toast.success(`${data.data.tickets.length} ticket(s) sold to ${customerForm.name}`)

      setHeldTickets([])
      setCustomerForm({ name: '', email: '', phone: '' })
      fetchAvailability()
    } catch (error) {
      console.error('Failed to purchase:', error)
    } finally {
      setProcessing(false)
    }
  }

  async function releaseHeldTickets() {
    if (heldTickets.length === 0) return

    try {
      await fetch(`/api/events/${id}/tickets/release`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticketIds: heldTickets.map(t => t.id),
          sessionId,
        }),
      })

      setHeldTickets([])
      fetchAvailability()
    } catch (error) {
      console.error('Failed to release:', error)
    }
  }

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

  const selectedTierInfo = pricingTiers.find(t => t.id === selectedTier)
  const totalPrice = heldTickets.reduce((sum, t) => sum + t.totalPrice, 0)
  const isGA = event.ticketingMode === 'general_admission'

  // Calculate floor plan bounds for seat-based modes
  const minX = Math.min(...tables.map(t => t.posX), 0)
  const minY = Math.min(...tables.map(t => t.posY), 0)
  const maxX = Math.max(...tables.map(t => t.posX + t.width), 800)
  const maxY = Math.max(...tables.map(t => t.posY + t.height), 600)

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <div className="bg-white p-4 flex justify-between items-center border-b border-gray-200 shadow-sm">
        <div>
          <Link href={`/events/${id}`} className="text-blue-600 hover:text-blue-700 text-sm">
            &larr; Back to Event
          </Link>
          <h1 className="text-xl font-bold text-gray-900">{event.name}</h1>
          <div className="text-sm text-gray-500">
            {new Date(event.eventDate).toLocaleDateString()} -- {formatTime(event.doorsOpen)}
          </div>
        </div>

        {/* Pricing Tier Selector */}
        <div className="flex gap-2">
          {pricingTiers.map(tier => (
            <button
              key={tier.id}
              onClick={() => setSelectedTier(tier.id)}
              className={`px-4 py-2 rounded-lg text-white transition-all ${
                selectedTier === tier.id
                  ? 'ring-2 ring-offset-2 ring-blue-500'
                  : 'opacity-70 hover:opacity-100'
              }`}
              style={{ backgroundColor: tier.color || '#4b5563' }}
            >
              <div className="font-medium">{tier.name}</div>
              <div className="text-sm">{formatCurrency(tier.price)}</div>
              {tier.remaining !== null && (
                <div className="text-xs opacity-80">{tier.remaining} left</div>
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Main Area - Floor Plan or GA Selector */}
        <div className="flex-1 overflow-auto p-4">
          {isGA ? (
            /* General Admission Mode */
            <div className="max-w-lg mx-auto mt-8">
              <div className="bg-white rounded-xl p-8 border border-gray-200 shadow-sm text-center">
                <h2 className="text-xl font-semibold text-gray-900 mb-2">General Admission</h2>
                <p className="text-gray-500 mb-6">
                  {summary && `${summary.availableSeats} of ${summary.totalCapacity} tickets available`}
                </p>

                {selectedTierInfo && (
                  <div className="mb-6">
                    <div
                      className="inline-block px-4 py-2 rounded-lg text-white font-medium mb-2"
                      style={{ backgroundColor: selectedTierInfo.color || '#4b5563' }}
                    >
                      {selectedTierInfo.name} - {formatCurrency(selectedTierInfo.price)}
                    </div>
                  </div>
                )}

                {heldTickets.length === 0 && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Number of Tickets</label>
                      <div className="flex items-center justify-center gap-4">
                        <button
                          onClick={() => setGaQuantity(Math.max(1, gaQuantity - 1))}
                          className="w-12 h-12 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700 text-xl font-bold flex items-center justify-center transition-colors"
                        >
                          -
                        </button>
                        <input
                          type="number"
                          value={gaQuantity}
                          onChange={e => setGaQuantity(Math.max(1, Number(e.target.value)))}
                          className="w-20 text-center text-2xl font-bold border border-gray-300 rounded-lg py-2 text-gray-900"
                          min="1"
                          max={selectedTierInfo?.remaining ?? 999}
                        />
                        <button
                          onClick={() => setGaQuantity(gaQuantity + 1)}
                          className="w-12 h-12 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700 text-xl font-bold flex items-center justify-center transition-colors"
                        >
                          +
                        </button>
                      </div>
                    </div>

                    <div className="text-2xl font-bold text-gray-900">
                      {formatCurrency(gaQuantity * (selectedTierInfo?.price || 0))}
                    </div>

                    <button
                      onClick={holdSelectedSeats}
                      disabled={processing || gaQuantity < 1}
                      className="w-full py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium transition-colors"
                    >
                      {processing ? 'Processing...' : `Hold ${gaQuantity} Ticket${gaQuantity !== 1 ? 's' : ''}`}
                    </button>
                  </div>
                )}
              </div>

              {/* Available tiers summary */}
              <div className="mt-6 space-y-3">
                {pricingTiers.map(tier => (
                  <div
                    key={tier.id}
                    className="bg-white rounded-lg p-4 border border-gray-200 shadow-sm flex justify-between items-center"
                    style={{ borderLeftColor: tier.color || '#4b5563', borderLeftWidth: 4 }}
                  >
                    <div>
                      <div className="font-medium text-gray-900">{tier.name}</div>
                      <div className="text-sm text-gray-500">{formatCurrency(tier.price)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-medium text-gray-900">
                        {tier.remaining !== null ? tier.remaining : 'Unlimited'} available
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            /* Per Seat / Per Table Mode - Floor Plan */
            <div
              className="relative bg-white rounded-lg border border-gray-200 shadow-sm"
              style={{
                width: maxX - minX + 100,
                height: maxY - minY + 100,
                minWidth: '100%',
                minHeight: '100%',
              }}
            >
              {/* Legend */}
              <div className="absolute top-4 left-4 flex gap-4 bg-white/90 p-2 rounded shadow-sm border border-gray-200">
                {Object.entries(SEAT_STATUS_COLORS).map(([status, color]) => (
                  <div key={status} className="flex items-center gap-2 text-sm text-gray-700">
                    <div
                      className="w-4 h-4 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                    <span className="capitalize">{status}</span>
                  </div>
                ))}
              </div>

              {tables.map(table => (
                <div key={table.tableId}>
                  {/* Table */}
                  <div
                    className="absolute bg-gray-100 border border-gray-300 flex items-center justify-center text-xs text-gray-700 font-medium"
                    style={{
                      left: table.posX - minX + 50,
                      top: table.posY - minY + 50,
                      width: table.width,
                      height: table.height,
                      borderRadius: table.shape === 'circle' ? '50%' : 8,
                    }}
                  >
                    {table.tableName}
                  </div>

                  {/* Seats */}
                  {table.seats.map(seat => {
                    const tableCenterX = table.posX + table.width / 2 - minX + 50
                    const tableCenterY = table.posY + table.height / 2 - minY + 50
                    const isSelected = selectedSeats.includes(seat.id)

                    return (
                      <button
                        key={seat.id}
                        onClick={() => toggleSeatSelection(seat.id, seat)}
                        disabled={seat.status !== 'available'}
                        className={`absolute w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium text-white transition-transform ${
                          isSelected ? 'ring-2 ring-blue-500 ring-offset-2 scale-110' : ''
                        } ${seat.status === 'available' ? 'cursor-pointer hover:scale-110' : 'cursor-not-allowed opacity-75'}`}
                        style={{
                          left: tableCenterX + seat.relativeX - 16,
                          top: tableCenterY + seat.relativeY - 16,
                          backgroundColor: isSelected ? '#3b82f6' : SEAT_STATUS_COLORS[seat.status],
                        }}
                      >
                        {seat.label}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="w-80 bg-white border-l border-gray-200 p-4 flex flex-col shadow-sm">
          {/* Selection info (seat-based modes) */}
          {!isGA && selectedSeats.length > 0 && heldTickets.length === 0 && (
            <div className="mb-4">
              <h3 className="font-medium text-gray-900 mb-2">Selected Seats ({selectedSeats.length})</h3>
              <div className="text-sm text-gray-500 mb-3">
                {selectedTierInfo?.name} @ {formatCurrency(selectedTierInfo?.price || 0)} each
              </div>
              <div className="text-lg font-bold text-gray-900 mb-3">
                Total: {formatCurrency(selectedSeats.length * (selectedTierInfo?.price || 0))}
              </div>
              <button
                onClick={holdSelectedSeats}
                disabled={processing}
                className="w-full py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                {processing ? 'Processing...' : 'Hold Seats'}
              </button>
            </div>
          )}

          {/* Held tickets (both modes) */}
          {heldTickets.length > 0 && (
            <div className="flex-1 flex flex-col">
              <div className="flex justify-between items-center mb-3">
                <h3 className="font-semibold text-gray-900">Cart ({heldTickets.length})</h3>
                <button
                  onClick={releaseHeldTickets}
                  className="text-sm text-red-600 hover:text-red-700"
                >
                  Clear
                </button>
              </div>

              <div className="flex-1 overflow-y-auto mb-4 space-y-2">
                {heldTickets.map(ticket => (
                  <div
                    key={ticket.id}
                    className="bg-gray-50 rounded-lg p-3 text-sm border border-gray-200"
                  >
                    <div className="flex justify-between text-gray-900">
                      <span>{ticket.seatLabel || ticket.tableName || `Ticket ${ticket.ticketNumber}`}</span>
                      <span className="font-medium">{formatCurrency(ticket.totalPrice)}</span>
                    </div>
                    <div className="text-xs text-gray-500">{ticket.pricingTier}</div>
                  </div>
                ))}
              </div>

              <div className="border-t border-gray-200 pt-4 mb-4">
                <div className="flex justify-between text-lg font-bold text-gray-900">
                  <span>Total</span>
                  <span>{formatCurrency(totalPrice)}</span>
                </div>
              </div>

              {/* Customer info */}
              <div className="space-y-3 mb-4">
                <input
                  type="text"
                  placeholder="Customer Name *"
                  value={customerForm.name}
                  onChange={e => setCustomerForm({ ...customerForm, name: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <input
                  type="email"
                  placeholder="Email"
                  value={customerForm.email}
                  onChange={e => setCustomerForm({ ...customerForm, email: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                <input
                  type="tel"
                  placeholder="Phone"
                  value={customerForm.phone}
                  onChange={e => setCustomerForm({ ...customerForm, phone: e.target.value })}
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <button
                onClick={completePurchase}
                disabled={processing || !customerForm.name}
                className="w-full py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium transition-colors"
              >
                {processing ? 'Processing...' : `Complete Sale - ${formatCurrency(totalPrice)}`}
              </button>
            </div>
          )}

          {/* Empty state */}
          {(isGA ? heldTickets.length === 0 : selectedSeats.length === 0 && heldTickets.length === 0) && heldTickets.length === 0 && (
            <div className="text-center text-gray-500 py-8">
              {isGA
                ? 'Select tickets from the left to add to cart'
                : 'Click seats on the floor plan to select them'}
            </div>
          )}
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
