'use client'

import { useState, useEffect, use } from 'react'
import Link from 'next/link'
import { toast } from '@/stores/toast-store'

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
  const [loading, setLoading] = useState(true)
  const [selectedSeats, setSelectedSeats] = useState<string[]>([])
  const [selectedTier, setSelectedTier] = useState<string>('')
  const [heldTickets, setHeldTickets] = useState<HeldTicket[]>([])
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
      setSelectedSeats(selectedSeats.filter(id => id !== seatId))
    } else {
      setSelectedSeats([...selectedSeats, seatId])
    }
  }

  async function holdSelectedSeats() {
    if (selectedSeats.length === 0 || !selectedTier) return

    setProcessing(true)
    try {
      const res = await fetch(`/api/events/${id}/tickets/hold`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seatIds: selectedSeats,
          pricingTierId: selectedTier,
          sessionId,
          holdDurationMinutes: 10,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || 'Failed to hold seats')
        return
      }

      setHeldTickets(data.tickets)
      setSelectedSeats([])
      fetchAvailability()
    } catch (error) {
      console.error('Failed to hold seats:', error)
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

      toast.success(`${data.tickets.length} ticket(s) sold to ${customerForm.name}`)

      // Reset
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

  const selectedTierInfo = pricingTiers.find(t => t.id === selectedTier)
  const totalPrice = heldTickets.reduce((sum, t) => sum + t.totalPrice, 0)

  // Calculate floor plan bounds
  const minX = Math.min(...tables.map(t => t.posX), 0)
  const minY = Math.min(...tables.map(t => t.posY), 0)
  const maxX = Math.max(...tables.map(t => t.posX + t.width), 800)
  const maxY = Math.max(...tables.map(t => t.posY + t.height), 600)

  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <div className="bg-gray-800 p-4 flex justify-between items-center">
        <div>
          <Link href={`/events/${id}`} className="text-gray-400 hover:text-white text-sm">
            &larr; Back to Event
          </Link>
          <h1 className="text-xl font-bold">{event.name}</h1>
          <div className="text-sm text-gray-400">
            {new Date(event.eventDate).toLocaleDateString()} &bull;{' '}
            {formatTime(event.doorsOpen)}
          </div>
        </div>

        {/* Pricing Tier Selector */}
        <div className="flex gap-2">
          {pricingTiers.map(tier => (
            <button
              key={tier.id}
              onClick={() => setSelectedTier(tier.id)}
              className={`px-4 py-2 rounded-lg ${
                selectedTier === tier.id
                  ? 'ring-2 ring-white'
                  : 'opacity-70 hover:opacity-100'
              }`}
              style={{ backgroundColor: tier.color || '#4b5563' }}
            >
              <div className="font-medium">{tier.name}</div>
              <div className="text-sm">${tier.price}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 flex">
        {/* Floor Plan */}
        <div className="flex-1 bg-gray-900 overflow-auto p-4">
          <div
            className="relative bg-gray-800 rounded-lg"
            style={{
              width: maxX - minX + 100,
              height: maxY - minY + 100,
              minWidth: '100%',
              minHeight: '100%',
            }}
          >
            {/* Legend */}
            <div className="absolute top-4 left-4 flex gap-4 bg-gray-900/80 p-2 rounded">
              {Object.entries(SEAT_STATUS_COLORS).map(([status, color]) => (
                <div key={status} className="flex items-center gap-2 text-sm">
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
                  className="absolute bg-gray-700 flex items-center justify-center text-xs"
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
                      className={`absolute w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium transition-transform ${
                        isSelected ? 'ring-2 ring-white scale-110' : ''
                      } ${seat.status === 'available' ? 'cursor-pointer hover:scale-110' : 'cursor-not-allowed'}`}
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
        </div>

        {/* Sidebar */}
        <div className="w-80 bg-gray-800 p-4 flex flex-col">
          {/* Selection info */}
          {selectedSeats.length > 0 && heldTickets.length === 0 && (
            <div className="mb-4">
              <h3 className="font-medium mb-2">Selected Seats ({selectedSeats.length})</h3>
              <div className="text-sm text-gray-400 mb-3">
                {selectedTierInfo?.name} @ ${selectedTierInfo?.price} each
              </div>
              <div className="text-lg font-bold mb-3">
                Total: ${(selectedSeats.length * (selectedTierInfo?.price || 0)).toFixed(2)}
              </div>
              <button
                onClick={holdSelectedSeats}
                disabled={processing}
                className="w-full py-2 bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {processing ? 'Processing...' : 'Hold Seats'}
              </button>
            </div>
          )}

          {/* Held tickets */}
          {heldTickets.length > 0 && (
            <div className="flex-1 flex flex-col">
              <div className="flex justify-between items-center mb-3">
                <h3 className="font-medium">Cart ({heldTickets.length})</h3>
                <button
                  onClick={releaseHeldTickets}
                  className="text-sm text-red-400 hover:text-red-300"
                >
                  Clear
                </button>
              </div>

              <div className="flex-1 overflow-y-auto mb-4 space-y-2">
                {heldTickets.map(ticket => (
                  <div
                    key={ticket.id}
                    className="bg-gray-700 rounded p-2 text-sm"
                  >
                    <div className="flex justify-between">
                      <span>{ticket.seatLabel || ticket.tableName}</span>
                      <span>${ticket.totalPrice.toFixed(2)}</span>
                    </div>
                    <div className="text-xs text-gray-400">{ticket.pricingTier}</div>
                  </div>
                ))}
              </div>

              <div className="border-t border-gray-700 pt-4 mb-4">
                <div className="flex justify-between text-lg font-bold">
                  <span>Total</span>
                  <span>${totalPrice.toFixed(2)}</span>
                </div>
              </div>

              {/* Customer info */}
              <div className="space-y-3 mb-4">
                <input
                  type="text"
                  placeholder="Customer Name *"
                  value={customerForm.name}
                  onChange={e => setCustomerForm({ ...customerForm, name: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-700 rounded"
                />
                <input
                  type="email"
                  placeholder="Email"
                  value={customerForm.email}
                  onChange={e => setCustomerForm({ ...customerForm, email: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-700 rounded"
                />
                <input
                  type="tel"
                  placeholder="Phone"
                  value={customerForm.phone}
                  onChange={e => setCustomerForm({ ...customerForm, phone: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-700 rounded"
                />
              </div>

              <button
                onClick={completePurchase}
                disabled={processing || !customerForm.name}
                className="w-full py-3 bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50 font-medium"
              >
                {processing ? 'Processing...' : `Complete Sale - $${totalPrice.toFixed(2)}`}
              </button>
            </div>
          )}

          {/* Empty state */}
          {selectedSeats.length === 0 && heldTickets.length === 0 && (
            <div className="text-center text-gray-400 py-8">
              Click seats on the floor plan to select them
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
