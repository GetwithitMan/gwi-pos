'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { Modal } from '@/components/ui/modal'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { useAdminCRUD } from '@/hooks/useAdminCRUD'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { toast } from '@/stores/toast-store'
import { getSharedSocket } from '@/lib/shared-socket'

interface Table {
  id: string
  name: string
  capacity: number
  section?: { id: string; name: string }
}

interface BottleServiceTier {
  id: string
  name: string
  color: string
  depositAmount: number
  minimumSpend: number
}

interface Reservation {
  id: string
  guestName: string
  guestPhone?: string
  guestEmail?: string
  partySize: number
  reservationDate: string
  reservationTime: string
  duration: number
  tableId?: string
  table?: Table
  status: string
  specialRequests?: string
  internalNotes?: string
  occasion?: string
  dietaryRestrictions?: string
  sectionPreference?: string
  source?: string
  tags?: string[]
  depositStatus?: string
  depositAmountCents?: number
  holdExpiresAt?: string
  customer?: {
    id: string
    firstName: string
    lastName: string
    phone?: string
    email?: string
    noShowCount?: number
    isBlacklisted?: boolean
  }
  bottleServiceTierId?: string
  bottleServiceTier?: BottleServiceTier
  seatedAt?: string
  createdAt: string
}

interface ReservationEvent {
  id: string
  eventType: string
  actor: string
  actorId?: string
  details: Record<string, any>
  createdAt: string
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-900 text-yellow-300',
  confirmed: 'bg-blue-900 text-blue-300',
  checked_in: 'bg-cyan-900 text-cyan-300',
  seated: 'bg-green-900 text-green-300',
  completed: 'bg-gray-700 text-gray-900',
  cancelled: 'bg-red-900 text-red-300',
  no_show: 'bg-orange-900 text-orange-300',
}

const DEPOSIT_BADGE: Record<string, { bg: string; label: string }> = {
  not_required: { bg: 'bg-gray-600 text-gray-300', label: 'No Deposit' },
  pending: { bg: 'bg-yellow-700 text-yellow-200', label: 'Deposit Pending' },
  hold_pending: { bg: 'bg-orange-700 text-orange-200', label: 'Hold Pending' },
  paid: { bg: 'bg-green-700 text-green-200', label: 'Deposit Paid' },
  refunded: { bg: 'bg-blue-700 text-blue-200', label: 'Refunded' },
  refund_pending: { bg: 'bg-blue-600 text-blue-200', label: 'Refund Pending' },
  forfeited: { bg: 'bg-red-700 text-red-200', label: 'Forfeited' },
}

const SOURCE_BADGE: Record<string, string> = {
  staff: 'bg-gray-600',
  online: 'bg-purple-700',
  waitlist: 'bg-teal-700',
  opentable: 'bg-red-800',
  resy: 'bg-indigo-800',
  google: 'bg-blue-800',
}

export default function ReservationsPage() {
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/reservations' })
  const employee = useAuthStore(s => s.employee)
  const locationId = employee?.location?.id

  // useAdminCRUD for modal state and list state management
  // Note: loadItems/handleSave/handleDelete not used because reservations
  // require date-based fetching that the hook doesn't support
  const crud = useAdminCRUD<Reservation>({
    apiBase: '/api/reservations',
    locationId,
    resourceName: 'reservation',
    parseResponse: (data) => Array.isArray(data) ? data : [],
  })

  const {
    items: reservations,
    isLoading,
    showModal,
    editingItem: editingReservation,
    openAddModal,
    openEditModal,
    closeModal,
    setItems: setReservations,
  } = crud

  const [tables, setTables] = useState<Table[]>([])
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0])
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [confirmAction, setConfirmAction] = useState<{ action: () => void; title: string; message: string } | null>(null)
  const [auditPanelId, setAuditPanelId] = useState<string | null>(null)
  const [auditEvents, setAuditEvents] = useState<ReservationEvent[]>([])
  const [auditLoading, setAuditLoading] = useState(false)
  const [sendMsgModal, setSendMsgModal] = useState<string | null>(null)
  const [sendMsgTemplate, setSendMsgTemplate] = useState('confirmation')
  const [sendMsgCustom, setSendMsgCustom] = useState('')
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Custom fetch with date param (hook's loadItems doesn't support extra query params)
  const fetchReservations = useCallback(async () => {
    if (!locationId) return
    try {
      const res = await fetch(
        `/api/reservations?locationId=${locationId}&date=${selectedDate}`
      )
      const data = await res.json()
      setReservations(Array.isArray(data) ? data : [])
    } catch (error) {
      console.error('Failed to fetch reservations:', error)
    }
  }, [locationId, selectedDate, setReservations])

  const fetchTables = useCallback(async () => {
    if (!locationId) return
    try {
      const res = await fetch(`/api/tables?locationId=${locationId}`)
      const data = await res.json()
      setTables(Array.isArray(data) ? data : [])
    } catch (error) {
      console.error('Failed to fetch tables:', error)
    }
  }, [locationId])

  useEffect(() => {
    fetchReservations()
    fetchTables()
  }, [fetchReservations, fetchTables])

  // Socket listener for real-time updates
  useEffect(() => {
    if (!locationId) return
    const socket = getSharedSocket()
    const handler = () => {
      // Debounce refresh
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
      refreshTimerRef.current = setTimeout(() => fetchReservations(), 500)
    }
    socket.on('reservation:changed', handler)
    socket.on('reservation:new_online', handler)
    return () => {
      socket.off('reservation:changed', handler)
      socket.off('reservation:new_online', handler)
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current)
    }
  }, [locationId, fetchReservations])

  // Audit panel loader
  useEffect(() => {
    if (!auditPanelId) return
    setAuditLoading(true)
    fetch(`/api/reservations/${auditPanelId}/events?limit=50`)
      .then(r => r.json())
      .then(data => setAuditEvents(data.data || []))
      .catch(() => toast.error('Failed to load events'))
      .finally(() => setAuditLoading(false))
  }, [auditPanelId])

  async function transitionStatus(reservationId: string, to: string, reason?: string) {
    try {
      const res = await fetch(`/api/reservations/${reservationId}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, reason }),
      })
      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error || 'Transition failed')
        return
      }
      toast.success(`Status changed to ${to}`)
      fetchReservations()
    } catch {
      toast.error('Failed to update status')
    }
  }

  async function sendTextToPay(reservationId: string) {
    try {
      const res = await fetch(`/api/reservations/${reservationId}/deposit/text-to-pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error || 'Failed to send')
        return
      }
      toast.success('Deposit link sent via SMS')
    } catch {
      toast.error('Failed to send deposit link')
    }
  }

  async function sendMessage(reservationId: string) {
    try {
      const res = await fetch(`/api/reservations/${reservationId}/send-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateKey: sendMsgTemplate,
          customMessage: sendMsgCustom || undefined,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error || 'Failed to send')
        return
      }
      toast.success('Message sent')
      setSendMsgModal(null)
      setSendMsgCustom('')
    } catch {
      toast.error('Failed to send message')
    }
  }

  function deleteReservation(id: string) {
    setConfirmAction({
      title: 'Delete Reservation',
      message: 'Are you sure you want to delete this reservation?',
      action: async () => {
        try {
          await fetch(`/api/reservations/${id}`, { method: 'DELETE' })
          fetchReservations()
          toast.success('Reservation deleted')
        } catch (error) {
          console.error('Failed to delete reservation:', error)
          toast.error('Failed to delete reservation')
        }
      },
    })
  }

  const filteredReservations = reservations.filter(r => {
    if (statusFilter === 'all') return true
    return r.status === statusFilter
  })

  // Group reservations by time slot
  const timeSlots: Record<string, Reservation[]> = {}
  filteredReservations.forEach(r => {
    const slot = r.reservationTime.substring(0, 5)
    if (!timeSlots[slot]) timeSlots[slot] = []
    timeSlots[slot].push(r)
  })

  const sortedSlots = Object.keys(timeSlots).sort()

  // Stats
  const stats = {
    total: reservations.length,
    confirmed: reservations.filter(r => r.status === 'confirmed').length,
    seated: reservations.filter(r => r.status === 'seated').length,
    totalCovers: reservations.reduce((sum, r) =>
      r.status !== 'cancelled' && r.status !== 'no_show' ? sum + r.partySize : sum, 0
    ),
  }

  if (!hydrated) return null

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <div className="max-w-7xl mx-auto space-y-3 mt-16">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 p-4 bg-white rounded-xl">
              <div className="skeleton-shimmer rounded-lg h-12 w-16" />
              <div className="flex-1 space-y-2">
                <div className="skeleton-shimmer rounded h-4 w-3/4" />
                <div className="skeleton-shimmer rounded h-3 w-1/2" />
              </div>
              <div className="skeleton-shimmer rounded-lg h-8 w-20" />
            </div>
          ))}
          <style>{`
            .skeleton-shimmer {
              background: linear-gradient(90deg, #e5e7eb 25%, #f3f4f6 50%, #e5e7eb 75%);
              background-size: 200% 100%;
              animation: shimmer 1.5s ease-in-out infinite;
            }
            @keyframes shimmer {
              0% { background-position: 200% 0; }
              100% { background-position: -200% 0; }
            }
          `}</style>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Reservations"
        actions={
          <Button variant="primary" onClick={openAddModal}>
            New Reservation
          </Button>
        }
      />

      {/* Main Content */}
      <main className="max-w-7xl mx-auto mt-6">
      {/* Date Picker & Filters */}
      <div className="flex gap-4 mb-6">
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const d = new Date(selectedDate)
              d.setDate(d.getDate() - 1)
              setSelectedDate(d.toISOString().split('T')[0])
            }}
            className="px-3 py-2 bg-gray-700 rounded hover:bg-gray-600"
          >
            &lt;
          </button>
          <input
            type="date"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            className="px-4 py-2 bg-gray-700 rounded"
          />
          <button
            onClick={() => {
              const d = new Date(selectedDate)
              d.setDate(d.getDate() + 1)
              setSelectedDate(d.toISOString().split('T')[0])
            }}
            className="px-3 py-2 bg-gray-700 rounded hover:bg-gray-600"
          >
            &gt;
          </button>
          <button
            onClick={() => setSelectedDate(new Date().toISOString().split('T')[0])}
            className="px-3 py-2 bg-gray-600 rounded hover:bg-gray-500"
          >
            Today
          </button>
        </div>

        <div className="flex gap-2 flex-wrap">
          {['all', 'pending', 'confirmed', 'checked_in', 'seated', 'completed', 'cancelled', 'no_show'].map(status => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`px-3 py-2 rounded capitalize text-sm ${
                statusFilter === status ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'
              }`}
            >
              {status.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-gray-800 rounded-lg p-4">
          <div className="text-gray-900 text-sm">Total Reservations</div>
          <div className="text-2xl font-bold">{stats.total}</div>
        </div>
        <div className="bg-gray-800 rounded-lg p-4">
          <div className="text-gray-900 text-sm">Confirmed</div>
          <div className="text-2xl font-bold text-blue-400">{stats.confirmed}</div>
        </div>
        <div className="bg-gray-800 rounded-lg p-4">
          <div className="text-gray-900 text-sm">Currently Seated</div>
          <div className="text-2xl font-bold text-green-400">{stats.seated}</div>
        </div>
        <div className="bg-gray-800 rounded-lg p-4">
          <div className="text-gray-900 text-sm">Total Covers</div>
          <div className="text-2xl font-bold">{stats.totalCovers}</div>
        </div>
      </div>

      {/* Timeline View */}
      <div className="bg-gray-800 rounded-lg p-4">
        {sortedSlots.length === 0 ? (
          <div className="text-center text-gray-900 py-8">
            No reservations for this date
          </div>
        ) : (
          <div className="space-y-4">
            {sortedSlots.map(slot => (
              <div key={slot} className="border-l-2 border-gray-600 pl-4">
                <div className="text-lg font-medium text-gray-900 mb-2">
                  {formatTime(slot)}
                </div>
                <div className="grid gap-3">
                  {timeSlots[slot].map(reservation => (
                    <ReservationCard
                      key={reservation.id}
                      reservation={reservation}
                      tables={tables}
                      onEdit={() => openEditModal(reservation)}
                      onSeat={() => transitionStatus(reservation.id, 'seated')}
                      onCheckIn={() => transitionStatus(reservation.id, 'checked_in')}
                      onComplete={() => transitionStatus(reservation.id, 'completed')}
                      onCancel={(reason) => transitionStatus(reservation.id, 'cancelled', reason)}
                      onNoShow={() => transitionStatus(reservation.id, 'no_show')}
                      onConfirm={() => transitionStatus(reservation.id, 'confirmed')}
                      onAssignTable={(tableId) => fetch(`/api/reservations/${reservation.id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ tableId }),
                      }).then(() => fetchReservations()).catch(() => toast.error('Failed to assign table'))}
                      onDelete={() => deleteReservation(reservation.id)}
                      onViewAudit={() => setAuditPanelId(reservation.id)}
                      onTextToPay={() => sendTextToPay(reservation.id)}
                      onSendMessage={() => setSendMsgModal(reservation.id)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      </main>

      {/* Create/Edit Modal */}
      {(showModal || editingReservation) && (
        <ReservationModal
          reservation={editingReservation}
          tables={tables}
          selectedDate={selectedDate}
          locationId={locationId || ''}
          onClose={() => {
            closeModal()
          }}
          onSave={() => {
            closeModal()
            fetchReservations()
          }}
        />
      )}

      <ConfirmDialog
        open={!!confirmAction}
        title={confirmAction?.title || 'Confirm'}
        description={confirmAction?.message}
        confirmLabel="Delete"
        destructive
        onConfirm={() => { confirmAction?.action(); setConfirmAction(null) }}
        onCancel={() => setConfirmAction(null)}
      />

      {/* Audit Timeline Panel */}
      {auditPanelId && (
        <Modal isOpen={true} onClose={() => setAuditPanelId(null)} title="Reservation Timeline" size="md">
          {auditLoading ? (
            <div className="py-8 text-center text-gray-500">Loading events...</div>
          ) : auditEvents.length === 0 ? (
            <div className="py-8 text-center text-gray-500">No events recorded</div>
          ) : (
            <div className="space-y-3 max-h-[60vh] overflow-y-auto">
              {auditEvents.map(evt => (
                <div key={evt.id} className="flex gap-3 text-sm">
                  <div className="w-1 bg-gray-300 rounded flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900">{evt.eventType.replace(/_/g, ' ')}</span>
                      <span className="text-xs text-gray-500">{evt.actor}</span>
                    </div>
                    <div className="text-xs text-gray-500">{new Date(evt.createdAt).toLocaleString()}</div>
                    {evt.details && Object.keys(evt.details).length > 0 && (
                      <div className="text-xs text-gray-600 mt-1">
                        {Object.entries(evt.details).map(([k, v]) => (
                          <span key={k} className="mr-3">{k}: {typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}

      {/* Send Message Modal */}
      {sendMsgModal && (
        <Modal isOpen={true} onClose={() => setSendMsgModal(null)} title="Send Message" size="sm">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Template</label>
              <select
                value={sendMsgTemplate}
                onChange={e => setSendMsgTemplate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              >
                <option value="confirmation">Confirmation</option>
                <option value="reminder24h">24h Reminder</option>
                <option value="reminder2h">2h Reminder</option>
                <option value="depositRequest">Deposit Request</option>
                <option value="cancellation">Cancellation</option>
                <option value="modification">Modification</option>
                <option value="thankYou">Thank You</option>
                <option value="customManual">Custom Message</option>
              </select>
            </div>
            {sendMsgTemplate === 'customManual' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Custom Message</label>
                <textarea
                  value={sendMsgCustom}
                  onChange={e => setSendMsgCustom(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => setSendMsgModal(null)} className="px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button onClick={() => sendMessage(sendMsgModal)} className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700">Send</button>
            </div>
          </div>
        </Modal>
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

function HoldCountdown({ expiresAt }: { expiresAt: string }) {
  const [remaining, setRemaining] = useState('')
  useEffect(() => {
    const update = () => {
      const diff = new Date(expiresAt).getTime() - Date.now()
      if (diff <= 0) { setRemaining('Expired'); return }
      const m = Math.floor(diff / 60000)
      const s = Math.floor((diff % 60000) / 1000)
      setRemaining(`${m}:${String(s).padStart(2, '0')}`)
    }
    update()
    const iv = setInterval(update, 1000)
    return () => clearInterval(iv)
  }, [expiresAt])
  return <span className="text-xs text-orange-400 font-mono">{remaining}</span>
}

function ReservationCard({
  reservation,
  tables,
  onEdit,
  onSeat,
  onCheckIn,
  onComplete,
  onCancel,
  onNoShow,
  onConfirm,
  onAssignTable,
  onDelete,
  onViewAudit,
  onTextToPay,
  onSendMessage,
}: {
  reservation: Reservation
  tables: Table[]
  onEdit: () => void
  onSeat: () => void
  onCheckIn: () => void
  onComplete: () => void
  onCancel: (reason: string) => void
  onNoShow: () => void
  onConfirm: () => void
  onAssignTable: (tableId: string) => void
  onDelete: () => void
  onViewAudit: () => void
  onTextToPay: () => void
  onSendMessage: () => void
}) {
  const [showActions, setShowActions] = useState(false)
  const depositBadge = DEPOSIT_BADGE[reservation.depositStatus || 'not_required']
  const sourceBg = SOURCE_BADGE[reservation.source || 'staff'] || 'bg-gray-600'

  return (
    <div className="bg-gray-700 rounded-lg p-4 relative">
      <div className="flex justify-between items-start">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-lg font-medium">{reservation.guestName}</span>
            <span className={`px-2 py-0.5 text-xs rounded ${STATUS_COLORS[reservation.status]}`}>
              {reservation.status.replace('_', ' ')}
            </span>
            {reservation.source && reservation.source !== 'staff' && (
              <span className={`px-2 py-0.5 text-xs rounded text-white ${sourceBg}`}>
                {reservation.source}
              </span>
            )}
            {depositBadge && reservation.depositStatus && reservation.depositStatus !== 'not_required' && (
              <span className={`px-2 py-0.5 text-xs rounded ${depositBadge.bg}`}>
                {depositBadge.label}
                {reservation.depositAmountCents ? ` ($${(reservation.depositAmountCents / 100).toFixed(2)})` : ''}
              </span>
            )}
            {reservation.bottleServiceTier && (
              <span
                className="px-2 py-0.5 text-xs rounded font-medium text-white"
                style={{ backgroundColor: reservation.bottleServiceTier.color }}
              >
                {reservation.bottleServiceTier.name}
              </span>
            )}
            {reservation.customer?.isBlacklisted && (
              <span className="px-2 py-0.5 text-xs rounded bg-red-800 text-red-200">Blacklisted</span>
            )}
          </div>
          <div className="text-sm text-gray-900 mt-1">
            Party of {reservation.partySize} &bull; {reservation.duration} min
            {reservation.status === 'pending' && reservation.holdExpiresAt && (
              <> &bull; Hold: <HoldCountdown expiresAt={reservation.holdExpiresAt} /></>
            )}
          </div>
          {reservation.table && (
            <div className="text-sm text-gray-900 mt-1">
              Table: {reservation.table.name}
              {reservation.table.section && ` (${reservation.table.section.name})`}
            </div>
          )}
          {reservation.guestPhone && (
            <div className="text-sm text-gray-900">{reservation.guestPhone}</div>
          )}
          {reservation.occasion && (
            <div className="text-sm text-purple-400 mt-1">{reservation.occasion}</div>
          )}
          {reservation.dietaryRestrictions && (
            <div className="text-sm text-amber-400 mt-1">Diet: {reservation.dietaryRestrictions}</div>
          )}
          {reservation.specialRequests && (
            <div className="text-sm text-yellow-400 mt-1">
              Note: {reservation.specialRequests}
            </div>
          )}
          {reservation.tags && reservation.tags.length > 0 && (
            <div className="flex gap-1 mt-1">
              {reservation.tags.map(tag => (
                <span key={tag} className="px-1.5 py-0.5 text-xs bg-gray-600 rounded">{tag}</span>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Quick table assign if not assigned */}
          {!reservation.tableId && (reservation.status === 'confirmed' || reservation.status === 'checked_in') && (
            <select
              className="px-2 py-1 bg-gray-600 rounded text-sm"
              onChange={e => {
                if (e.target.value) onAssignTable(e.target.value)
              }}
              defaultValue=""
            >
              <option value="">Assign Table</option>
              {tables
                .filter(t => t.capacity >= reservation.partySize)
                .map(t => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.capacity})
                  </option>
                ))}
            </select>
          )}

          {/* Text to Pay for unpaid deposits */}
          {reservation.depositStatus === 'pending' && (
            <button onClick={onTextToPay} className="px-3 py-1 bg-yellow-600 rounded text-sm hover:bg-yellow-700">
              Text to Pay
            </button>
          )}

          {/* Quick actions based on status */}
          {reservation.status === 'pending' && (
            <button onClick={onConfirm} className="px-3 py-1 bg-blue-600 rounded text-sm hover:bg-blue-700">
              Confirm
            </button>
          )}
          {reservation.status === 'confirmed' && (
            <>
              <button onClick={onCheckIn} className="px-3 py-1 bg-cyan-600 rounded text-sm hover:bg-cyan-700">
                Check In
              </button>
              <button onClick={onSeat} className="px-3 py-1 bg-green-600 rounded text-sm hover:bg-green-700">
                Seat
              </button>
            </>
          )}
          {reservation.status === 'checked_in' && (
            <button onClick={onSeat} className="px-3 py-1 bg-green-600 rounded text-sm hover:bg-green-700">
              Seat
            </button>
          )}
          {reservation.status === 'seated' && (
            <button onClick={onComplete} className="px-3 py-1 bg-blue-600 rounded text-sm hover:bg-blue-700">
              Complete
            </button>
          )}

          <button
            onClick={() => setShowActions(!showActions)}
            className="px-2 py-1 bg-gray-600 rounded hover:bg-gray-500"
          >
            ...
          </button>
        </div>
      </div>

      {/* Action dropdown */}
      {showActions && (
        <div className="absolute right-4 top-12 bg-gray-800 rounded-lg shadow-lg py-2 z-10 min-w-[180px]">
          <button onClick={() => { onEdit(); setShowActions(false) }} className="w-full px-4 py-2 text-left hover:bg-gray-700 text-sm">
            Edit
          </button>
          <button onClick={() => { onViewAudit(); setShowActions(false) }} className="w-full px-4 py-2 text-left hover:bg-gray-700 text-sm">
            View Timeline
          </button>
          <button onClick={() => { onSendMessage(); setShowActions(false) }} className="w-full px-4 py-2 text-left hover:bg-gray-700 text-sm">
            Send Message
          </button>
          {reservation.status === 'confirmed' && (
            <>
              <button onClick={() => { onNoShow(); setShowActions(false) }} className="w-full px-4 py-2 text-left hover:bg-gray-700 text-orange-400 text-sm">
                Mark No Show
              </button>
              <button
                onClick={() => {
                  const reason = prompt('Cancel reason:')
                  if (reason) { onCancel(reason); setShowActions(false) }
                }}
                className="w-full px-4 py-2 text-left hover:bg-gray-700 text-red-400 text-sm"
              >
                Cancel
              </button>
            </>
          )}
          {reservation.status === 'no_show' && (
            <button onClick={() => { onConfirm(); setShowActions(false) }} className="w-full px-4 py-2 text-left hover:bg-gray-700 text-green-400 text-sm">
              Reverse No-Show
            </button>
          )}
          {(reservation.status === 'cancelled' || reservation.status === 'no_show') && (
            <button onClick={() => { onDelete(); setShowActions(false) }} className="w-full px-4 py-2 text-left hover:bg-gray-700 text-red-400 text-sm">
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function ReservationModal({
  reservation,
  tables,
  selectedDate,
  locationId,
  onClose,
  onSave,
}: {
  reservation: Reservation | null
  tables: Table[]
  selectedDate: string
  locationId: string
  onClose: () => void
  onSave: () => void
}) {
  const [bottleServiceTiers, setBottleServiceTiers] = useState<Array<{ id: string; name: string; color: string; depositAmount: number; minimumSpend: number }>>([])
  const [form, setForm] = useState({
    guestName: reservation?.guestName || '',
    guestPhone: reservation?.guestPhone || '',
    guestEmail: reservation?.guestEmail || '',
    partySize: reservation?.partySize || 2,
    reservationDate: reservation?.reservationDate
      ? new Date(reservation.reservationDate).toISOString().split('T')[0]
      : selectedDate,
    reservationTime: reservation?.reservationTime || '18:00',
    duration: reservation?.duration || 90,
    tableId: reservation?.tableId || '',
    specialRequests: reservation?.specialRequests || '',
    internalNotes: reservation?.internalNotes || '',
    bottleServiceTierId: reservation?.bottleServiceTierId || '',
    occasion: reservation?.occasion || '',
    dietaryRestrictions: reservation?.dietaryRestrictions || '',
    sectionPreference: reservation?.sectionPreference || '',
    tags: (reservation?.tags || []).join(', '),
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!locationId) return
    fetch(`/api/bottle-service/tiers?locationId=${locationId}`)
      .then(r => r.json())
      .then(data => {
        const tiers = Array.isArray(data?.data) ? data.data : []
        setBottleServiceTiers(tiers.map((t: BottleServiceTier & { depositAmount: unknown; minimumSpend: unknown }) => ({
          ...t,
          depositAmount: Number(t.depositAmount),
          minimumSpend: Number(t.minimumSpend),
        })))
      })
      .catch(() => {})
   
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')

    try {
      const payload = {
        ...form,
        locationId,
        tableId: form.tableId || null,
        bottleServiceTierId: form.bottleServiceTierId || null,
        tags: form.tags ? form.tags.split(',').map(t => t.trim()).filter(Boolean) : [],
      }

      const res = await fetch(
        reservation ? `/api/reservations/${reservation.id}` : '/api/reservations',
        {
          method: reservation ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      )

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to save reservation')
      }

      onSave()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen={true} onClose={onClose} title={reservation ? 'Edit Reservation' : 'New Reservation'} size="lg">
        {error && (
          <div className="bg-red-900/50 text-red-300 p-3 rounded mb-4">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-900 mb-1">Guest Name *</label>
            <input
              type="text"
              value={form.guestName}
              onChange={e => setForm({ ...form, guestName: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 rounded"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-900 mb-1">Phone</label>
              <input
                type="tel"
                value={form.guestPhone}
                onChange={e => setForm({ ...form, guestPhone: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 rounded"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-900 mb-1">Email</label>
              <input
                type="email"
                value={form.guestEmail}
                onChange={e => setForm({ ...form, guestEmail: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 rounded"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm text-gray-900 mb-1">Party Size *</label>
              <input
                type="number"
                value={form.partySize}
                onChange={e => setForm({ ...form, partySize: Number(e.target.value) })}
                className="w-full px-3 py-2 bg-gray-700 rounded"
                min="1"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-gray-900 mb-1">Date *</label>
              <input
                type="date"
                value={form.reservationDate}
                onChange={e => setForm({ ...form, reservationDate: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 rounded"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-gray-900 mb-1">Time *</label>
              <input
                type="time"
                value={form.reservationTime}
                onChange={e => setForm({ ...form, reservationTime: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 rounded"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-900 mb-1">Duration (min)</label>
              <select
                value={form.duration}
                onChange={e => setForm({ ...form, duration: Number(e.target.value) })}
                className="w-full px-3 py-2 bg-gray-700 rounded"
              >
                <option value={60}>1 hour</option>
                <option value={90}>1.5 hours</option>
                <option value={120}>2 hours</option>
                <option value={150}>2.5 hours</option>
                <option value={180}>3 hours</option>
              </select>
            </div>
            <div>
              <label className="block text-sm text-gray-900 mb-1">Table</label>
              <select
                value={form.tableId}
                onChange={e => setForm({ ...form, tableId: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 rounded"
              >
                <option value="">No table assigned</option>
                {tables
                  .filter(t => t.capacity >= form.partySize)
                  .map(t => (
                    <option key={t.id} value={t.id}>
                      {t.name} (seats {t.capacity})
                    </option>
                  ))}
              </select>
              {form.partySize > 0 && tables.filter(t => t.capacity >= form.partySize).length === 0 && (
                <p className="text-xs text-yellow-400 mt-1">
                  No tables large enough for this party size
                </p>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-900 mb-1">Bottle Service Tier</label>
            <div className="flex items-center gap-2">
              <select
                value={form.bottleServiceTierId}
                onChange={e => setForm({ ...form, bottleServiceTierId: e.target.value })}
                className="flex-1 px-3 py-2 bg-gray-700 rounded"
              >
                <option value="">None</option>
                {bottleServiceTiers.map(tier => (
                  <option key={tier.id} value={tier.id}>
                    {tier.name}
                  </option>
                ))}
              </select>
              {form.bottleServiceTierId && (() => {
                const tier = bottleServiceTiers.find(t => t.id === form.bottleServiceTierId)
                if (!tier) return null
                return (
                  <span
                    className="px-3 py-1 rounded text-sm font-medium text-white whitespace-nowrap"
                    style={{ backgroundColor: tier.color }}
                  >
                    {tier.name}
                  </span>
                )
              })()}
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-900 mb-1">Special Requests</label>
            <textarea
              value={form.specialRequests}
              onChange={e => setForm({ ...form, specialRequests: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 rounded"
              rows={2}
              placeholder="Allergies, highchair, birthday, etc."
            />
          </div>

          <div>
            <label className="block text-sm text-gray-900 mb-1">Internal Notes</label>
            <textarea
              value={form.internalNotes}
              onChange={e => setForm({ ...form, internalNotes: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 rounded"
              rows={2}
              placeholder="Staff notes..."
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-900 mb-1">Occasion</label>
              <input
                type="text"
                value={form.occasion}
                onChange={e => setForm({ ...form, occasion: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 rounded"
                placeholder="Birthday, Anniversary..."
              />
            </div>
            <div>
              <label className="block text-sm text-gray-900 mb-1">Dietary Restrictions</label>
              <input
                type="text"
                value={form.dietaryRestrictions}
                onChange={e => setForm({ ...form, dietaryRestrictions: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 rounded"
                placeholder="Gluten-free, Vegan..."
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-gray-900 mb-1">Section Preference</label>
              <input
                type="text"
                value={form.sectionPreference}
                onChange={e => setForm({ ...form, sectionPreference: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 rounded"
                placeholder="Patio, Bar, Window..."
              />
            </div>
            <div>
              <label className="block text-sm text-gray-900 mb-1">Tags (comma-separated)</label>
              <input
                type="text"
                value={form.tags}
                onChange={e => setForm({ ...form, tags: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 rounded"
                placeholder="VIP, Regular, Press..."
              />
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 bg-gray-700 rounded hover:bg-gray-600"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2 bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? 'Saving...' : reservation ? 'Save Changes' : 'Create'}
            </button>
          </div>
        </form>
    </Modal>
  )
}
