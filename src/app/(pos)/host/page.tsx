'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh'
import { getSharedSocket } from '@/lib/shared-socket'
import { toast } from '@/stores/toast-store'

// ─── Types ──────────────────────────────────────────────────────────────────

interface TableInfo {
  id: string
  name: string
  abbreviation: string | null
  capacity: number
  status: 'available' | 'occupied' | 'reserved' | 'dirty' | 'in_use'
  sectionId: string | null
  shape: string
  orderId: string | null
  orderNumber: number | null
  serverId: string | null
  serverName: string | null
  partySize: number | null
  seatedAt: string | null
  currentOrderTotal: number | null
  estimatedTurnMinutes: number | null
}

interface SectionGroup {
  section: { id: string; name: string; color: string | null }
  tables: TableInfo[]
}

interface ServerRotationInfo {
  employeeId: string
  name: string
  sectionId: string | null
  sectionName: string | null
  tableCount: number
  lastSeatedAt: string | null
  isOnFloor: boolean
  isNextUp: boolean
}

interface WaitlistEntry {
  id: string
  customerName: string
  partySize: number
  phone: string | null
  notes: string | null
  status: string
  position: number
  elapsedMinutes: number
  estimatedWaitMinutes: number
  createdAt: string
}

interface Reservation {
  id: string
  guestName: string
  guestPhone: string | null
  partySize: number
  reservationTime: string
  status: string
  tableId: string | null
  table: { name: string } | null
  specialRequests: string | null
  source: string | null
  occasion: string | null
  depositStatus: string | null
  depositAmountCents: number | null
  holdExpiresAt: string | null
  customer: {
    noShowCount?: number
    isBlacklisted?: boolean
    allergies?: string | null
    tags?: string[] | null
  } | null
}

interface TableSummary {
  totalTables: number
  available: number
  occupied: number
  reserved: number
  dirty: number
}

// ─── Color helpers ──────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  available: 'bg-green-100 border-green-400 text-green-800',
  occupied: 'bg-red-100 border-red-400 text-red-800',
  reserved: 'bg-blue-100 border-blue-400 text-blue-800',
  dirty: 'bg-yellow-100 border-yellow-400 text-yellow-800',
  in_use: 'bg-purple-100 border-purple-400 text-purple-800',
}

const STATUS_DOT: Record<string, string> = {
  available: 'bg-green-500',
  occupied: 'bg-red-500',
  reserved: 'bg-blue-500',
  dirty: 'bg-yellow-500',
  in_use: 'bg-purple-500',
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function HostPage() {
  const employee = useAuthStore(s => s.employee)
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/host' })

  // Data state
  const [sections, setSections] = useState<SectionGroup[]>([])
  const [serverRotation, setServerRotation] = useState<ServerRotationInfo[]>([])
  const [summary, setSummary] = useState<TableSummary>({ totalTables: 0, available: 0, occupied: 0, reserved: 0, dirty: 0 })
  const [avgTurnMinutes, setAvgTurnMinutes] = useState(45)
  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([])
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // UI state
  const [activePanel, setActivePanel] = useState<'waitlist' | 'reservations' | 'servers'>('waitlist')
  const [seatModal, setSeatModal] = useState<{
    open: boolean
    tableId: string | null
    tableName: string
    waitlistEntryId?: string
    reservationId?: string
    guestName?: string
    partySize?: number
  }>({ open: false, tableId: null, tableName: '' })
  const [seatPartySize, setSeatPartySize] = useState(2)
  const [seatServerId, setSeatServerId] = useState<string>('')
  const [seatGuestName, setSeatGuestName] = useState('')
  const [isSeating, setIsSeating] = useState(false)

  // ─── Data fetching ──────────────────────────────────────────────────────

  const loadTables = useCallback(async () => {
    try {
      const res = await fetch('/api/host/tables')
      if (!res.ok) return
      const json = await res.json()
      setSections(json.data?.sections ?? [])
      setServerRotation(json.data?.serverRotation ?? [])
      setSummary(json.data?.summary ?? { totalTables: 0, available: 0, occupied: 0, reserved: 0, dirty: 0 })
      setAvgTurnMinutes(json.data?.avgTurnMinutes ?? 45)
    } catch (error) {
      console.error('Failed to load tables:', error)
    }
  }, [])

  const loadWaitlist = useCallback(async () => {
    try {
      const res = await fetch('/api/waitlist')
      if (!res.ok) return
      const json = await res.json()
      setWaitlist(json.data ?? [])
    } catch (error) {
      console.error('Failed to load waitlist:', error)
    }
  }, [])

  const loadReservations = useCallback(async () => {
    if (!employee?.location?.id) return
    try {
      const today = new Date().toISOString().split('T')[0]
      const res = await fetch(`/api/reservations?locationId=${employee.location.id}&date=${today}&status=pending,confirmed,checked_in,seated`)
      if (!res.ok) return
      const json = await res.json()
      setReservations(Array.isArray(json) ? json : json.data ?? [])
    } catch (error) {
      console.error('Failed to load reservations:', error)
    }
  }, [employee?.location?.id])

  const loadAll = useCallback(async () => {
    await Promise.all([loadTables(), loadWaitlist(), loadReservations()])
    setIsLoading(false)
  }, [loadTables, loadWaitlist, loadReservations])

  useEffect(() => {
    if (employee?.location?.id) {
      loadAll()
    }
  }, [employee?.location?.id, loadAll])

  // Auto-refresh via socket events (including reservation events)
  useReportAutoRefresh({
    onRefresh: loadAll,
    events: [
      'floor-plan:updated',
      'waitlist:changed',
      'table:status-changed',
      'orders:list-changed',
      'reservation:changed',
    ],
    debounceMs: 1000,
  })

  // Direct socket listener for new online reservations (toast notification)
  useEffect(() => {
    const socket = getSharedSocket()
    if (!socket) return

    const handleNewOnline = (data: any) => {
      toast.success(`New online reservation: ${data.guestName} (party of ${data.partySize})`)
      void loadReservations()
    }

    socket.on('reservation:new_online', handleNewOnline)
    return () => { socket.off('reservation:new_online', handleNewOnline) }
  }, [loadReservations])

  // ─── Actions ────────────────────────────────────────────────────────────

  function openSeatModal(table: TableInfo, source?: { waitlistEntryId?: string; reservationId?: string; guestName?: string; partySize?: number }) {
    setSeatModal({
      open: true,
      tableId: table.id,
      tableName: table.name,
      waitlistEntryId: source?.waitlistEntryId,
      reservationId: source?.reservationId,
      guestName: source?.guestName,
      partySize: source?.partySize,
    })
    setSeatPartySize(source?.partySize ?? 2)
    setSeatGuestName(source?.guestName ?? '')
    setSeatServerId('')
  }

  async function handleSeat() {
    if (!seatModal.tableId) return
    setIsSeating(true)
    try {
      const res = await fetch('/api/host/seat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tableId: seatModal.tableId,
          partySize: seatPartySize,
          waitlistEntryId: seatModal.waitlistEntryId || undefined,
          reservationId: seatModal.reservationId || undefined,
          serverId: seatServerId || undefined,
          guestName: seatGuestName || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error || 'Failed to seat party')
        return
      }
      toast.success(json.message || 'Party seated')
      setSeatModal({ open: false, tableId: null, tableName: '' })
      void loadAll()
    } catch (error) {
      toast.error('Failed to seat party')
    } finally {
      setIsSeating(false)
    }
  }

  async function handleTableStatusChange(tableId: string, newStatus: string) {
    try {
      const res = await fetch('/api/host/tables', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tableId, status: newStatus }),
      })
      if (!res.ok) {
        const json = await res.json()
        toast.error(json.error || 'Failed to update table')
        return
      }
      void loadTables()
    } catch (error) {
      toast.error('Failed to update table')
    }
  }

  async function handleNotifyWaitlist(entryId: string) {
    try {
      const res = await fetch(`/api/waitlist/${entryId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'notified' }),
      })
      if (!res.ok) {
        toast.error('Failed to notify guest')
        return
      }
      toast.success('Guest notified')
      void loadWaitlist()
    } catch (error) {
      toast.error('Failed to notify guest')
    }
  }

  async function handleCheckIn(reservationId: string) {
    try {
      const res = await fetch(`/api/reservations/${reservationId}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: 'checked_in' }),
      })
      if (!res.ok) {
        const json = await res.json()
        toast.error(json.error || 'Failed to check in')
        return
      }
      toast.success('Guest checked in')
      void loadReservations()
    } catch (error) {
      toast.error('Failed to check in')
    }
  }

  async function handleConfirmReservation(reservationId: string) {
    try {
      const res = await fetch(`/api/reservations/${reservationId}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: 'confirmed' }),
      })
      if (!res.ok) {
        const json = await res.json()
        toast.error(json.error || 'Failed to confirm')
        return
      }
      toast.success('Reservation confirmed')
      void loadReservations()
    } catch (error) {
      toast.error('Failed to confirm')
    }
  }

  // ─── Derived data ──────────────────────────────────────────────────────

  const allTables = useMemo(() => {
    return sections.flatMap(s => s.tables)
  }, [sections])

  const availableTables = useMemo(() => {
    return allTables.filter(t => t.status === 'available')
  }, [allTables])

  // ─── Sorted reservations (approaching first) ───────────────────────────

  const sortedReservations = useMemo(() => {
    return [...reservations].sort((a, b) => {
      // Active statuses first: checked_in > confirmed > pending > seated
      const statusOrder: Record<string, number> = {
        checked_in: 0, confirmed: 1, pending: 2, seated: 3,
      }
      const sa = statusOrder[a.status] ?? 9
      const sb = statusOrder[b.status] ?? 9
      if (sa !== sb) return sa - sb
      return (a.reservationTime || '').localeCompare(b.reservationTime || '')
    })
  }, [reservations])

  // ─── Render ─────────────────────────────────────────────────────────────

  if (!hydrated) return null

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-950 text-white">
        <div className="text-lg">Loading host view...</div>
      </div>
    )
  }

  return (
    <div className="h-screen bg-gray-950 text-white flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-800">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold">Host Station</h1>
          <div className="flex gap-3 text-sm">
            <span className="flex items-center gap-1">
              <span className={`w-2.5 h-2.5 rounded-full ${STATUS_DOT.available}`} />
              {summary.available} Open
            </span>
            <span className="flex items-center gap-1">
              <span className={`w-2.5 h-2.5 rounded-full ${STATUS_DOT.occupied}`} />
              {summary.occupied} Occupied
            </span>
            <span className="flex items-center gap-1">
              <span className={`w-2.5 h-2.5 rounded-full ${STATUS_DOT.reserved}`} />
              {summary.reserved} Reserved
            </span>
            <span className="flex items-center gap-1">
              <span className={`w-2.5 h-2.5 rounded-full ${STATUS_DOT.dirty}`} />
              {summary.dirty} Dirty
            </span>
          </div>
        </div>
        <div className="text-sm text-gray-400">
          Avg turn: {avgTurnMinutes} min | {waitlist.length} waiting
        </div>
      </div>

      {/* Main content — split layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* LEFT: Floor plan mini-view */}
        <div className="flex-1 overflow-auto p-4">
          {sections.map(sg => (
            <div key={sg.section.id} className="mb-6">
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-2">
                {sg.section.name}
              </h2>
              <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 gap-2">
                {sg.tables.map(table => (
                  <button
                    key={table.id}
                    onClick={() => {
                      if (table.status === 'available') {
                        openSeatModal(table)
                      } else if (table.status === 'dirty') {
                        handleTableStatusChange(table.id, 'available')
                      }
                    }}
                    className={`
                      relative p-2 rounded-lg border-2 text-center transition-all
                      ${STATUS_COLORS[table.status] ?? 'bg-gray-800 border-gray-600 text-gray-300'}
                      ${table.status === 'available' ? 'hover:ring-2 hover:ring-green-400 cursor-pointer' : ''}
                      ${table.status === 'dirty' ? 'hover:ring-2 hover:ring-yellow-400 cursor-pointer' : ''}
                    `}
                  >
                    <div className="font-bold text-sm">{table.abbreviation || table.name}</div>
                    <div className="text-xs opacity-75">{table.capacity} seats</div>
                    {table.status === 'occupied' && (
                      <>
                        <div className="text-xs mt-0.5 font-medium">{table.serverName?.split(' ')[0] ?? '?'}</div>
                        {table.partySize && (
                          <div className="text-xs opacity-75">Party: {table.partySize}</div>
                        )}
                        {table.estimatedTurnMinutes !== null && table.estimatedTurnMinutes > 0 && (
                          <div className="text-xs opacity-60">~{table.estimatedTurnMinutes}m left</div>
                        )}
                      </>
                    )}
                    {table.status === 'dirty' && (
                      <div className="text-xs mt-0.5 italic">Tap to clear</div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}

          {sections.length === 0 && (
            <div className="text-center text-gray-500 mt-20">
              No sections or tables configured. Set up your floor plan first.
            </div>
          )}
        </div>

        {/* RIGHT: Panels */}
        <div className="w-96 border-l border-gray-800 flex flex-col bg-gray-900">
          {/* Panel tabs */}
          <div className="flex border-b border-gray-700">
            {(['waitlist', 'reservations', 'servers'] as const).map(panel => (
              <button
                key={panel}
                onClick={() => setActivePanel(panel)}
                className={`flex-1 py-2 text-sm font-medium capitalize transition-colors ${
                  activePanel === panel
                    ? 'text-white border-b-2 border-blue-500'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                {panel}
                {panel === 'waitlist' && waitlist.length > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 text-xs bg-blue-600 rounded-full">{waitlist.length}</span>
                )}
                {panel === 'reservations' && reservations.length > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 text-xs bg-blue-600 rounded-full">{reservations.length}</span>
                )}
              </button>
            ))}
          </div>

          {/* Panel content */}
          <div className="flex-1 overflow-auto p-3">
            {/* Waitlist Panel */}
            {activePanel === 'waitlist' && (
              <div className="space-y-2">
                {waitlist.length === 0 && (
                  <div className="text-center text-gray-500 py-8">No guests waiting</div>
                )}
                {waitlist.map(entry => (
                  <div key={entry.id} className="bg-gray-800 rounded-lg p-3 border border-gray-700">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium text-sm">{entry.customerName}</div>
                        <div className="text-xs text-gray-400">
                          Party of {entry.partySize} | {entry.elapsedMinutes}m waiting
                          {entry.estimatedWaitMinutes > 0 && ` | ~${entry.estimatedWaitMinutes}m est`}
                        </div>
                        {entry.phone && <div className="text-xs text-gray-500">{entry.phone}</div>}
                        {entry.notes && <div className="text-xs text-gray-500 italic mt-1">{entry.notes}</div>}
                      </div>
                      <div className="flex flex-col gap-1">
                        {entry.status === 'waiting' && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleNotifyWaitlist(entry.id)}
                            className="text-xs"
                          >
                            Notify
                          </Button>
                        )}
                        {(entry.status === 'waiting' || entry.status === 'notified') && availableTables.length > 0 && (
                          <Button
                            size="sm"
                            onClick={() => openSeatModal(availableTables[0], {
                              waitlistEntryId: entry.id,
                              guestName: entry.customerName,
                              partySize: entry.partySize,
                            })}
                            className="text-xs bg-green-600 hover:bg-green-700"
                          >
                            Seat
                          </Button>
                        )}
                      </div>
                    </div>
                    {entry.status === 'notified' && (
                      <div className="mt-1 text-xs text-blue-400 font-medium">Notified - Awaiting arrival</div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Reservations Panel */}
            {activePanel === 'reservations' && (
              <div className="space-y-2">
                {sortedReservations.length === 0 && (
                  <div className="text-center text-gray-500 py-8">No reservations today</div>
                )}
                {sortedReservations.map(res => {
                  const resTimeBorder = getTimeBorderColor(res.reservationTime, res.status)
                  const isPending = res.status === 'pending'
                  const depositBlocked = isPending && res.depositStatus !== 'paid' && (res.depositAmountCents ?? 0) > 0

                  return (
                    <div key={res.id} className={`bg-gray-800 rounded-lg p-3 border ${resTimeBorder}`}>
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm truncate">{res.guestName}</span>
                            {/* Status badge */}
                            {isPending && (
                              <span className="text-xs px-1.5 py-0.5 bg-yellow-600/30 text-yellow-400 rounded">Pending</span>
                            )}
                            {res.status === 'checked_in' && (
                              <span className="text-xs px-1.5 py-0.5 bg-blue-600/30 text-blue-400 rounded">Checked In</span>
                            )}
                            {res.status === 'confirmed' && (
                              <span className="text-xs px-1.5 py-0.5 bg-green-600/30 text-green-400 rounded">Confirmed</span>
                            )}
                            {/* Source badge */}
                            {res.source === 'online' && (
                              <span className="text-xs px-1 py-0.5 bg-purple-600/20 text-purple-400 rounded">Online</span>
                            )}
                            {res.source === 'waitlist' && (
                              <span className="text-xs px-1 py-0.5 bg-cyan-600/20 text-cyan-400 rounded">Waitlist</span>
                            )}
                          </div>
                          <div className="text-xs text-gray-400 mt-0.5">
                            Party of {res.partySize} | {formatTimeShort(res.reservationTime)}
                            {res.table && ` | ${res.table.name}`}
                          </div>
                          {/* Deposit status */}
                          {(res.depositAmountCents ?? 0) > 0 && (
                            <div className={`text-xs mt-0.5 ${
                              res.depositStatus === 'paid' ? 'text-green-400'
                                : res.depositStatus === 'pending' ? 'text-yellow-400'
                                : 'text-gray-500'
                            }`}>
                              Deposit: ${((res.depositAmountCents ?? 0) / 100).toFixed(2)}
                              {res.depositStatus === 'paid' ? ' (Paid)' : res.depositStatus === 'pending' ? ' (Unpaid)' : ` (${res.depositStatus})`}
                            </div>
                          )}
                          {/* Hold countdown for pending */}
                          {isPending && res.holdExpiresAt && (
                            <HoldCountdown expiresAt={res.holdExpiresAt} />
                          )}
                          {/* Customer info badges */}
                          {res.customer && (
                            <div className="flex gap-1 mt-1 flex-wrap">
                              {res.customer.isBlacklisted && (
                                <span className="text-xs px-1 bg-red-800 text-red-200 rounded">Blacklisted</span>
                              )}
                              {(res.customer.noShowCount ?? 0) > 0 && (
                                <span className="text-xs px-1 bg-orange-800 text-orange-200 rounded">
                                  {res.customer.noShowCount} no-show{(res.customer.noShowCount ?? 0) > 1 ? 's' : ''}
                                </span>
                              )}
                              {res.customer.allergies && (
                                <span className="text-xs px-1 bg-yellow-800 text-yellow-200 rounded">Allergies</span>
                              )}
                            </div>
                          )}
                          {res.specialRequests && (
                            <div className="text-xs text-gray-500 italic mt-1 truncate">{res.specialRequests}</div>
                          )}
                        </div>
                        <div className="flex flex-col gap-1 ml-2">
                          {/* Pending: confirm or override */}
                          {isPending && !depositBlocked && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleConfirmReservation(res.id)}
                              className="text-xs"
                            >
                              Confirm
                            </Button>
                          )}
                          {depositBlocked && (
                            <span className="text-xs text-yellow-400 text-right">Awaiting<br/>deposit</span>
                          )}
                          {/* Confirmed: check in or seat */}
                          {res.status === 'confirmed' && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleCheckIn(res.id)}
                                className="text-xs"
                              >
                                Check In
                              </Button>
                              {availableTables.length > 0 && (
                                <Button
                                  size="sm"
                                  onClick={() => openSeatModal(
                                    res.tableId
                                      ? allTables.find(t => t.id === res.tableId && t.status === 'available') ?? availableTables[0]
                                      : availableTables[0],
                                    {
                                      reservationId: res.id,
                                      guestName: res.guestName,
                                      partySize: res.partySize,
                                    }
                                  )}
                                  className="text-xs bg-green-600 hover:bg-green-700"
                                >
                                  Seat
                                </Button>
                              )}
                            </>
                          )}
                          {/* Checked in: seat */}
                          {res.status === 'checked_in' && availableTables.length > 0 && (
                            <Button
                              size="sm"
                              onClick={() => openSeatModal(
                                res.tableId
                                  ? allTables.find(t => t.id === res.tableId && t.status === 'available') ?? availableTables[0]
                                  : availableTables[0],
                                {
                                  reservationId: res.id,
                                  guestName: res.guestName,
                                  partySize: res.partySize,
                                }
                              )}
                              className="text-xs bg-green-600 hover:bg-green-700"
                            >
                              Seat
                            </Button>
                          )}
                          {res.status === 'seated' && (
                            <span className="text-xs text-green-400 font-medium">Seated</span>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Server Rotation Panel */}
            {activePanel === 'servers' && (
              <div className="space-y-2">
                {serverRotation.length === 0 && (
                  <div className="text-center text-gray-500 py-8">
                    No servers on floor. Clock in servers to enable rotation.
                  </div>
                )}
                {serverRotation.map((sr, idx) => (
                  <div
                    key={sr.employeeId}
                    className={`bg-gray-800 rounded-lg p-3 border ${
                      idx === 0 ? 'border-green-500 ring-1 ring-green-500/30' : 'border-gray-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="font-medium text-sm flex items-center gap-2">
                          {sr.name}
                          {idx === 0 && (
                            <span className="text-xs bg-green-600 text-white px-1.5 py-0.5 rounded">NEXT UP</span>
                          )}
                        </div>
                        <div className="text-xs text-gray-400">
                          {sr.sectionName || 'No section'} | {sr.tableCount} tables
                        </div>
                        {sr.lastSeatedAt && (
                          <div className="text-xs text-gray-500">
                            Last seated: {new Date(sr.lastSeatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                          </div>
                        )}
                      </div>
                      <div className="text-2xl font-bold text-gray-600">{sr.tableCount}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Seat Modal */}
      <Modal
        isOpen={seatModal.open}
        onClose={() => setSeatModal({ open: false, tableId: null, tableName: '' })}
        title={`Seat at ${seatModal.tableName}`}
        size="sm"
      >
        <div className="space-y-4 p-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Guest Name</label>
            <input
              type="text"
              value={seatGuestName}
              onChange={e => setSeatGuestName(e.target.value)}
              placeholder="Optional"
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Party Size</label>
            <div className="flex gap-2">
              {[1, 2, 3, 4, 5, 6, 8, 10].map(size => (
                <button
                  key={size}
                  onClick={() => setSeatPartySize(size)}
                  className={`w-10 h-10 rounded-lg font-bold text-sm transition-colors ${
                    seatPartySize === size
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  {size}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Assign Server (Optional)</label>
            <select
              value={seatServerId}
              onChange={e => setSeatServerId(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white"
            >
              <option value="">Auto (rotation engine)</option>
              {serverRotation.map(sr => (
                <option key={sr.employeeId} value={sr.employeeId}>
                  {sr.name} ({sr.tableCount} tables)
                </option>
              ))}
            </select>
          </div>

          {/* Available tables picker — if coming from waitlist/reservation, let them change */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Table</label>
            <select
              value={seatModal.tableId ?? ''}
              onChange={e => setSeatModal(prev => ({ ...prev, tableId: e.target.value }))}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white"
            >
              {availableTables.map(t => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.capacity} seats)
                </option>
              ))}
            </select>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => setSeatModal({ open: false, tableId: null, tableName: '' })}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSeat}
              disabled={isSeating || !seatModal.tableId}
              className="bg-green-600 hover:bg-green-700"
            >
              {isSeating ? 'Seating...' : 'Seat Party'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

// ─── Helper functions ────────────────────────────────────────────────────────

function formatTimeShort(time: string): string {
  if (!time || !time.includes(':')) return time
  const [h, m] = time.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

function getTimeBorderColor(reservationTime: string, status: string): string {
  if (status === 'seated' || status === 'completed') return 'border-gray-700'
  if (status === 'checked_in') return 'border-blue-500'
  if (status === 'pending') return 'border-yellow-500'

  // For confirmed: color based on how close the reservation is
  if (!reservationTime?.includes(':')) return 'border-gray-700'
  const [h, m] = reservationTime.split(':').map(Number)
  const now = new Date()
  const rezMinutes = h * 60 + m
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const diff = rezMinutes - nowMinutes

  if (diff < 0) return 'border-red-500'        // past due
  if (diff <= 15) return 'border-orange-500'    // within 15 min
  if (diff <= 30) return 'border-yellow-500'    // within 30 min
  if (diff <= 60) return 'border-green-500'     // within 1 hour
  return 'border-gray-700'                      // more than 1 hour
}

// ─── Hold Countdown Component ────────────────────────────────────────────────

function HoldCountdown({ expiresAt }: { expiresAt: string }) {
  const [remaining, setRemaining] = useState('')

  useEffect(() => {
    const update = () => {
      const ms = new Date(expiresAt).getTime() - Date.now()
      if (ms <= 0) {
        setRemaining('Expired')
        return
      }
      const min = Math.floor(ms / 60_000)
      const sec = Math.floor((ms % 60_000) / 1000)
      setRemaining(`${min}:${String(sec).padStart(2, '0')}`)
    }
    update()
    const interval = setInterval(update, 1000)
    return () => clearInterval(interval)
  }, [expiresAt])

  const isExpired = remaining === 'Expired'

  return (
    <div className={`text-xs mt-0.5 font-mono ${isExpired ? 'text-red-400' : 'text-yellow-400'}`}>
      Hold: {remaining}
    </div>
  )
}
