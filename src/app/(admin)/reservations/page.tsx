'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { Modal } from '@/components/ui/modal'
import { useAuthStore } from '@/stores/auth-store'
import { useAdminCRUD } from '@/hooks/useAdminCRUD'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { toast } from '@/stores/toast-store'

interface Table {
  id: string
  name: string
  capacity: number
  section?: { id: string; name: string }
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
  customer?: {
    id: string
    firstName: string
    lastName: string
  }
  seatedAt?: string
  createdAt: string
}

const STATUS_COLORS: Record<string, string> = {
  confirmed: 'bg-blue-900 text-blue-300',
  seated: 'bg-green-900 text-green-300',
  completed: 'bg-gray-700 text-gray-300',
  cancelled: 'bg-red-900 text-red-300',
  no_show: 'bg-orange-900 text-orange-300',
}

export default function ReservationsPage() {
  const router = useRouter()
  const employee = useAuthStore(s => s.employee)
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
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

  // Auth guard
  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login?redirect=/reservations')
    }
  }, [isAuthenticated, router])

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

  async function updateStatus(reservationId: string, action: string, data?: Record<string, unknown>) {
    try {
      await fetch(`/api/reservations/${reservationId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...data }),
      })
      fetchReservations()
    } catch (error) {
      console.error('Failed to update reservation:', error)
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-400">Loading reservations...</div>
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

        <div className="flex gap-2">
          {['all', 'confirmed', 'seated', 'completed', 'cancelled'].map(status => (
            <button
              key={status}
              onClick={() => setStatusFilter(status)}
              className={`px-3 py-2 rounded capitalize ${
                statusFilter === status ? 'bg-blue-600' : 'bg-gray-700 hover:bg-gray-600'
              }`}
            >
              {status}
            </button>
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-gray-800 rounded-lg p-4">
          <div className="text-gray-400 text-sm">Total Reservations</div>
          <div className="text-2xl font-bold">{stats.total}</div>
        </div>
        <div className="bg-gray-800 rounded-lg p-4">
          <div className="text-gray-400 text-sm">Confirmed</div>
          <div className="text-2xl font-bold text-blue-400">{stats.confirmed}</div>
        </div>
        <div className="bg-gray-800 rounded-lg p-4">
          <div className="text-gray-400 text-sm">Currently Seated</div>
          <div className="text-2xl font-bold text-green-400">{stats.seated}</div>
        </div>
        <div className="bg-gray-800 rounded-lg p-4">
          <div className="text-gray-400 text-sm">Total Covers</div>
          <div className="text-2xl font-bold">{stats.totalCovers}</div>
        </div>
      </div>

      {/* Timeline View */}
      <div className="bg-gray-800 rounded-lg p-4">
        {sortedSlots.length === 0 ? (
          <div className="text-center text-gray-400 py-8">
            No reservations for this date
          </div>
        ) : (
          <div className="space-y-4">
            {sortedSlots.map(slot => (
              <div key={slot} className="border-l-2 border-gray-600 pl-4">
                <div className="text-lg font-medium text-gray-400 mb-2">
                  {formatTime(slot)}
                </div>
                <div className="grid gap-3">
                  {timeSlots[slot].map(reservation => (
                    <ReservationCard
                      key={reservation.id}
                      reservation={reservation}
                      tables={tables}
                      onEdit={() => openEditModal(reservation)}
                      onSeat={() => updateStatus(reservation.id, 'seat')}
                      onComplete={() => updateStatus(reservation.id, 'complete')}
                      onCancel={(reason) => updateStatus(reservation.id, 'cancel', { reason })}
                      onNoShow={() => updateStatus(reservation.id, 'no_show')}
                      onAssignTable={(tableId) => updateStatus(reservation.id, 'assign_table', { tableId })}
                      onDelete={() => deleteReservation(reservation.id)}
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

function ReservationCard({
  reservation,
  tables,
  onEdit,
  onSeat,
  onComplete,
  onCancel,
  onNoShow,
  onAssignTable,
  onDelete,
}: {
  reservation: Reservation
  tables: Table[]
  onEdit: () => void
  onSeat: () => void
  onComplete: () => void
  onCancel: (reason: string) => void
  onNoShow: () => void
  onAssignTable: (tableId: string) => void
  onDelete: () => void
}) {
  const [showActions, setShowActions] = useState(false)

  return (
    <div className="bg-gray-700 rounded-lg p-4 relative">
      <div className="flex justify-between items-start">
        <div>
          <div className="flex items-center gap-3">
            <span className="text-lg font-medium">{reservation.guestName}</span>
            <span className={`px-2 py-0.5 text-xs rounded ${STATUS_COLORS[reservation.status]}`}>
              {reservation.status}
            </span>
          </div>
          <div className="text-sm text-gray-400 mt-1">
            Party of {reservation.partySize} &bull; {reservation.duration} min
          </div>
          {reservation.table && (
            <div className="text-sm text-gray-300 mt-1">
              Table: {reservation.table.name}
              {reservation.table.section && ` (${reservation.table.section.name})`}
            </div>
          )}
          {reservation.guestPhone && (
            <div className="text-sm text-gray-400">{reservation.guestPhone}</div>
          )}
          {reservation.specialRequests && (
            <div className="text-sm text-yellow-400 mt-2">
              Note: {reservation.specialRequests}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Quick table assign if not assigned */}
          {!reservation.tableId && reservation.status === 'confirmed' && (
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

          {/* Quick actions based on status */}
          {reservation.status === 'confirmed' && (
            <button
              onClick={onSeat}
              className="px-3 py-1 bg-green-600 rounded text-sm hover:bg-green-700"
            >
              Seat
            </button>
          )}
          {reservation.status === 'seated' && (
            <button
              onClick={onComplete}
              className="px-3 py-1 bg-blue-600 rounded text-sm hover:bg-blue-700"
            >
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
        <div className="absolute right-4 top-12 bg-gray-800 rounded-lg shadow-lg py-2 z-10 min-w-[150px]">
          <button
            onClick={() => { onEdit(); setShowActions(false) }}
            className="w-full px-4 py-2 text-left hover:bg-gray-700"
          >
            Edit
          </button>
          {reservation.status === 'confirmed' && (
            <>
              <button
                onClick={() => { onNoShow(); setShowActions(false) }}
                className="w-full px-4 py-2 text-left hover:bg-gray-700 text-orange-400"
              >
                Mark No Show
              </button>
              <button
                onClick={() => {
                  const reason = prompt('Cancel reason:')
                  if (reason) { onCancel(reason); setShowActions(false) }
                }}
                className="w-full px-4 py-2 text-left hover:bg-gray-700 text-red-400"
              >
                Cancel
              </button>
            </>
          )}
          {(reservation.status === 'cancelled' || reservation.status === 'no_show') && (
            <button
              onClick={() => { onDelete(); setShowActions(false) }}
              className="w-full px-4 py-2 text-left hover:bg-gray-700 text-red-400"
            >
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
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')

    try {
      const payload = {
        ...form,
        locationId,
        tableId: form.tableId || null,
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
            <label className="block text-sm text-gray-400 mb-1">Guest Name *</label>
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
              <label className="block text-sm text-gray-400 mb-1">Phone</label>
              <input
                type="tel"
                value={form.guestPhone}
                onChange={e => setForm({ ...form, guestPhone: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 rounded"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Email</label>
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
              <label className="block text-sm text-gray-400 mb-1">Party Size *</label>
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
              <label className="block text-sm text-gray-400 mb-1">Date *</label>
              <input
                type="date"
                value={form.reservationDate}
                onChange={e => setForm({ ...form, reservationDate: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 rounded"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-gray-400 mb-1">Time *</label>
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
              <label className="block text-sm text-gray-400 mb-1">Duration (min)</label>
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
              <label className="block text-sm text-gray-400 mb-1">Table</label>
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
            <label className="block text-sm text-gray-400 mb-1">Special Requests</label>
            <textarea
              value={form.specialRequests}
              onChange={e => setForm({ ...form, specialRequests: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 rounded"
              rows={2}
              placeholder="Allergies, highchair, birthday, etc."
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Internal Notes</label>
            <textarea
              value={form.internalNotes}
              onChange={e => setForm({ ...form, internalNotes: e.target.value })}
              className="w-full px-3 py-2 bg-gray-700 rounded"
              rows={2}
              placeholder="Staff notes..."
            />
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
