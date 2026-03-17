'use client'

import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthGuard } from '@/hooks/useAuthGuard'
import { useSocket } from '@/hooks/useSocket'
import { hasPermission, PERMISSIONS } from '@/lib/auth-utils'
import { Modal } from '@/components/ui/modal'
import { toast } from '@/stores/toast-store'
import { getSharedSocket } from '@/lib/shared-socket'

// ---- Types ----------------------------------------------------------------

interface Reservation {
  id: string
  guestName: string
  guestPhone: string | null
  guestEmail: string | null
  partySize: number
  reservationDate: string
  reservationTime: string
  status: string
  tableId: string | null
  table: { id: string; name: string; capacity: number; section?: { id: string; name: string } | null } | null
  specialRequests: string | null
  internalNotes: string | null
  source: string | null
  occasion: string | null
  depositStatus: string | null
  depositAmountCents: number | null
  holdExpiresAt: string | null
  duration: number | null
  customer: {
    id: string
    firstName: string | null
    lastName: string | null
    phone: string | null
    email: string | null
    noShowCount?: number
    isBlacklisted?: boolean
  } | null
  bottleServiceTier: {
    id: string
    name: string
    color: string | null
    depositAmount: number | null
    minimumSpend: number | null
  } | null
}

type StatusFilter = 'all' | 'confirmed' | 'checked_in' | 'seated' | 'pending'

// ---- Status colors --------------------------------------------------------

const STATUS_BADGE: Record<string, { bg: string; text: string; label: string; pulse?: boolean }> = {
  pending:    { bg: 'bg-yellow-600/30', text: 'text-yellow-400', label: 'Pending' },
  confirmed:  { bg: 'bg-blue-600/30',   text: 'text-blue-400',   label: 'Confirmed' },
  checked_in: { bg: 'bg-green-600/30',  text: 'text-green-400',  label: 'Checked In', pulse: true },
  seated:     { bg: 'bg-green-700/40',  text: 'text-green-300',  label: 'Seated' },
  completed:  { bg: 'bg-gray-600/30',   text: 'text-gray-400',   label: 'Completed' },
  cancelled:  { bg: 'bg-red-600/30',    text: 'text-red-400',    label: 'Cancelled' },
  no_show:    { bg: 'bg-orange-600/30', text: 'text-orange-400', label: 'No Show' },
}

const SOURCE_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  online:   { bg: 'bg-blue-600/20',   text: 'text-blue-400',   label: 'Online' },
  staff:    { bg: 'bg-gray-600/20',   text: 'text-gray-400',   label: 'Staff' },
  waitlist: { bg: 'bg-purple-600/20', text: 'text-purple-400', label: 'Waitlist' },
}

const OCCASION_ICONS: Record<string, string> = {
  birthday:    '🎂',
  anniversary: '🥂',
  date:        '❤️',
  business:    '💼',
  celebration: '🎉',
  other:       '📌',
}

const MESSAGE_TEMPLATES: { key: string; label: string }[] = [
  { key: 'confirmation',   label: 'Confirmation' },
  { key: 'reminder2h',     label: 'Reminder (2h)' },
  { key: 'reminder24h',    label: 'Reminder (24h)' },
  { key: 'cancellation',   label: 'Cancellation' },
  { key: 'depositRequest', label: 'Deposit Request' },
  { key: 'thankYou',       label: 'Thank You' },
  { key: 'customManual',   label: 'Custom Message' },
]

// ---- Component ------------------------------------------------------------

export default function ReservationsPage() {
  const router = useRouter()
  const { isReady, employee } = useAuthGuard()
  const { socket, isConnected } = useSocket()

  // Data state
  const [reservations, setReservations] = useState<Reservation[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // UI state
  const [selectedDate, setSelectedDate] = useState(() => todayStr())
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [expandedRequests, setExpandedRequests] = useState<Set<string>>(new Set())

  // Modal state
  const [cancelModal, setCancelModal] = useState<{ open: boolean; id: string | null }>({ open: false, id: null })
  const [cancelReason, setCancelReason] = useState('')
  const [isCancelling, setIsCancelling] = useState(false)

  const [editModal, setEditModal] = useState<{ open: boolean; reservation: Reservation | null }>({ open: false, reservation: null })
  const [editForm, setEditForm] = useState({ guestName: '', partySize: 2, reservationTime: '', specialRequests: '', tableId: '' })
  const [isSaving, setIsSaving] = useState(false)

  const [messageModal, setMessageModal] = useState<{ open: boolean; id: string | null }>({ open: false, id: null })
  const [selectedTemplate, setSelectedTemplate] = useState('confirmation')
  const [isSending, setIsSending] = useState(false)

  // Permission check
  const canManage = useMemo(() => {
    const perms = (employee as any)?.permissions ?? []
    const permArr = Array.isArray(perms) ? perms as string[] : []
    return hasPermission(permArr, PERMISSIONS.TABLES_RESERVATIONS)
  }, [employee])

  // ---- Data loading -------------------------------------------------------

  const loadReservations = useCallback(async () => {
    try {
      setError(null)
      const params = new URLSearchParams({ date: selectedDate })
      if (statusFilter !== 'all') params.set('status', statusFilter)
      const res = await fetch(`/api/reservations?${params}`)
      if (!res.ok) {
        throw new Error('Failed to load reservations')
      }
      const data = await res.json()
      setReservations(Array.isArray(data) ? data : data.data ?? [])
    } catch (err) {
      console.error('[ReservationsPage] Failed to load:', err)
      setError('Failed to load reservations')
    } finally {
      setIsLoading(false)
    }
  }, [selectedDate, statusFilter])

  // Initial load
  useEffect(() => {
    if (employee?.location?.id) {
      setIsLoading(true)
      loadReservations()
    }
  }, [employee?.location?.id, loadReservations])

  // Socket-driven refresh (300ms debounce)
  const debounceTimer = useRef<NodeJS.Timeout | null>(null)
  useEffect(() => {
    if (!socket || !isConnected) return
    const debouncedRefresh = () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
      debounceTimer.current = setTimeout(() => loadReservations(), 300)
    }
    socket.on('reservation:changed', debouncedRefresh)
    socket.on('orders:list-changed', debouncedRefresh)
    return () => {
      socket.off('reservation:changed', debouncedRefresh)
      socket.off('orders:list-changed', debouncedRefresh)
      if (debounceTimer.current) clearTimeout(debounceTimer.current)
    }
  }, [socket, isConnected, loadReservations])

  // Toast on new online reservation
  useEffect(() => {
    const s = getSharedSocket()
    const handleNewOnline = (data: { guestName?: string; reservationTime?: string; partySize?: number }) => {
      const time = data.reservationTime ? formatTimeShort(data.reservationTime) : ''
      toast.success(`New online reservation: ${data.guestName || 'Guest'}${time ? ` at ${time}` : ''}`)
      void loadReservations()
    }
    s.on('reservation:new_online', handleNewOnline)
    return () => { s.off('reservation:new_online', handleNewOnline) }
  }, [loadReservations])

  // Fallback polling when socket disconnected (20s)
  useEffect(() => {
    if (isConnected) return
    if (!employee?.location?.id) return
    const fallback = setInterval(loadReservations, 20000)
    return () => clearInterval(fallback)
  }, [isConnected, employee?.location?.id, loadReservations])

  // Visibility refresh
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && employee?.location?.id) {
        loadReservations()
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [employee?.location?.id, loadReservations])

  // ---- Actions ------------------------------------------------------------

  const handleCheckIn = async (id: string) => {
    try {
      const res = await fetch(`/api/reservations/${id}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: 'checked_in' }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error || 'Failed to check in')
        return
      }
      toast.success('Guest checked in')
      void loadReservations()
    } catch {
      toast.error('Failed to check in')
    }
  }

  const handleSeat = async (id: string) => {
    try {
      const res = await fetch(`/api/reservations/${id}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: 'seated' }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error || 'Failed to seat guest')
        return
      }
      toast.success('Guest seated')
      void loadReservations()
    } catch {
      toast.error('Failed to seat guest')
    }
  }

  const handleCancel = async () => {
    if (!cancelModal.id) return
    setIsCancelling(true)
    try {
      const res = await fetch(`/api/reservations/${cancelModal.id}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: 'cancelled', reason: cancelReason || undefined }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error || 'Failed to cancel')
        return
      }
      toast.success('Reservation cancelled')
      setCancelModal({ open: false, id: null })
      setCancelReason('')
      void loadReservations()
    } catch {
      toast.error('Failed to cancel')
    } finally {
      setIsCancelling(false)
    }
  }

  const openEditModal = (r: Reservation) => {
    setEditForm({
      guestName: r.guestName,
      partySize: r.partySize,
      reservationTime: r.reservationTime,
      specialRequests: r.specialRequests || '',
      tableId: r.tableId || '',
    })
    setEditModal({ open: true, reservation: r })
  }

  const handleSaveEdit = async () => {
    if (!editModal.reservation) return
    setIsSaving(true)
    try {
      const res = await fetch(`/api/reservations/${editModal.reservation.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guestName: editForm.guestName,
          partySize: editForm.partySize,
          reservationTime: editForm.reservationTime,
          specialRequests: editForm.specialRequests || null,
          tableId: editForm.tableId || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error || 'Failed to update')
        return
      }
      toast.success('Reservation updated')
      setEditModal({ open: false, reservation: null })
      void loadReservations()
    } catch {
      toast.error('Failed to update')
    } finally {
      setIsSaving(false)
    }
  }

  const handleSendMessage = async () => {
    if (!messageModal.id) return
    setIsSending(true)
    try {
      const res = await fetch(`/api/reservations/${messageModal.id}/send-message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateKey: selectedTemplate }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error || 'Failed to send message')
        return
      }
      toast.success('Message sent')
      setMessageModal({ open: false, id: null })
    } catch {
      toast.error('Failed to send message')
    } finally {
      setIsSending(false)
    }
  }

  // ---- Date navigation ----------------------------------------------------

  const goToday = () => setSelectedDate(todayStr())
  const goPrev = () => setSelectedDate(d => shiftDate(d, -1))
  const goNext = () => setSelectedDate(d => shiftDate(d, 1))

  const dateLabel = useMemo(() => {
    const d = new Date(selectedDate + 'T12:00:00')
    const today = todayStr()
    if (selectedDate === today) return 'Today'
    const tomorrow = shiftDate(today, 1)
    if (selectedDate === tomorrow) return 'Tomorrow'
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  }, [selectedDate])

  // ---- Sorted + filtered reservations -------------------------------------

  const sortedReservations = useMemo(() => {
    return [...reservations].sort((a, b) => {
      const statusOrder: Record<string, number> = { checked_in: 0, confirmed: 1, pending: 2, seated: 3, completed: 4, cancelled: 5, no_show: 6 }
      const sa = statusOrder[a.status] ?? 9
      const sb = statusOrder[b.status] ?? 9
      if (sa !== sb) return sa - sb
      return (a.reservationTime || '').localeCompare(b.reservationTime || '')
    })
  }, [reservations])

  // ---- Toggle expanded special requests -----------------------------------

  const toggleRequests = (id: string) => {
    setExpandedRequests(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // ---- Guard --------------------------------------------------------------

  if (!isReady) return null

  // ---- Render -------------------------------------------------------------

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-slate-900/80 backdrop-blur-xl border-b border-white/10">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button
                onClick={() => router.push('/orders')}
                className="flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-slate-300 hover:bg-white/10 transition-colors"
              >
                <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                Back
              </button>
              <div>
                <h1 className="text-xl font-bold text-white">Reservations</h1>
                <p className="text-sm text-slate-400">
                  {sortedReservations.length} reservation{sortedReservations.length !== 1 ? 's' : ''}
                  {!isConnected && <span className="ml-2 text-yellow-400">(offline)</span>}
                </p>
              </div>
            </div>

            {/* Date navigation */}
            <div className="flex items-center gap-2">
              <button
                onClick={goPrev}
                className="p-2 bg-white/5 border border-white/10 rounded-lg text-slate-300 hover:bg-white/10 transition-colors"
              >
                <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <button
                onClick={goToday}
                className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white font-medium hover:bg-white/10 transition-colors min-w-[120px] text-center"
              >
                {dateLabel}
              </button>
              <button
                onClick={goNext}
                className="p-2 bg-white/5 border border-white/10 rounded-lg text-slate-300 hover:bg-white/10 transition-colors"
              >
                <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>

          {/* Status filter pills */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {([
              { id: 'all', label: 'All' },
              { id: 'confirmed', label: 'Confirmed' },
              { id: 'checked_in', label: 'Checked In' },
              { id: 'seated', label: 'Seated' },
              { id: 'pending', label: 'Pending' },
            ] as const).map((opt) => (
              <button
                key={opt.id}
                onClick={() => setStatusFilter(opt.id)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  statusFilter === opt.id
                    ? 'bg-indigo-600/30 border border-indigo-500/50 text-indigo-300'
                    : 'bg-white/5 border border-white/10 text-slate-400 hover:bg-white/10'
                }`}
              >
                {opt.label}
              </button>
            ))}

            {!canManage && (
              <div className="ml-auto px-3 py-1.5 bg-yellow-600/10 border border-yellow-500/20 rounded-lg text-xs text-yellow-400">
                View only — contact a manager to modify reservations
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="p-6">
        {isLoading ? (
          /* Skeleton loading cards */
          <div className="space-y-3">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="bg-white/5 border border-white/10 rounded-xl p-4 animate-pulse">
                <div className="flex items-start gap-4">
                  <div className="w-20 h-10 bg-white/10 rounded" />
                  <div className="flex-1 space-y-2">
                    <div className="w-48 h-5 bg-white/10 rounded" />
                    <div className="w-32 h-4 bg-white/10 rounded" />
                  </div>
                  <div className="w-24 h-8 bg-white/10 rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          /* Error state */
          <div className="text-center py-20">
            <svg width="48" height="48" fill="none" stroke="currentColor" viewBox="0 0 24 24" className="mx-auto mb-4 text-red-400 opacity-60">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <p className="text-lg font-medium text-red-400">{error}</p>
            <button
              onClick={() => { setIsLoading(true); loadReservations() }}
              className="mt-4 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 rounded-lg text-white font-medium transition-colors"
            >
              Retry
            </button>
          </div>
        ) : sortedReservations.length === 0 ? (
          /* Empty state */
          <div className="text-center py-20 text-slate-400">
            <svg width="48" height="48" fill="none" stroke="currentColor" viewBox="0 0 24 24" className="mx-auto mb-4 opacity-50">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <p className="text-lg font-medium">No reservations for {dateLabel}</p>
            <p className="text-sm mt-1">
              {statusFilter !== 'all' ? 'Try removing the status filter' : 'Check another date or create a new reservation'}
            </p>
          </div>
        ) : (
          /* Reservation cards */
          <div className="space-y-3">
            {sortedReservations.map((r) => {
              const timeBorder = getTimeBorderColor(r.reservationTime, r.status)
              const statusBadge = STATUS_BADGE[r.status]
              const sourceBadge = r.source ? SOURCE_BADGE[r.source] : null
              const occasionIcon = r.occasion ? OCCASION_ICONS[r.occasion] || OCCASION_ICONS.other : null
              const isExpanded = expandedRequests.has(r.id)
              const depositRequired = (r.depositAmountCents ?? 0) > 0

              return (
                <div
                  key={r.id}
                  className={`bg-white/5 border-l-4 border rounded-xl p-4 hover:bg-white/[0.07] transition-colors ${timeBorder}`}
                >
                  <div className="flex items-start gap-4">
                    {/* Time column */}
                    <div className="flex-shrink-0 w-20 text-center">
                      <div className="text-xl font-bold text-white">
                        {formatTimeShort(r.reservationTime)}
                      </div>
                      {r.duration && (
                        <div className="text-xs text-slate-500">{r.duration}min</div>
                      )}
                    </div>

                    {/* Details column */}
                    <div className="flex-1 min-w-0">
                      {/* Row 1: Name + party size + badges */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-white truncate">
                          {r.guestName}
                        </span>
                        <span className="px-2 py-0.5 bg-slate-700 rounded text-xs text-slate-300 font-medium">
                          {r.partySize}
                        </span>
                        {r.table && (
                          <span className="px-2 py-0.5 bg-slate-700/60 rounded text-xs text-slate-400">
                            {r.table.name}
                          </span>
                        )}
                        {statusBadge && (
                          <span className={`text-xs px-1.5 py-0.5 rounded ${statusBadge.bg} ${statusBadge.text} ${statusBadge.pulse ? 'animate-pulse' : ''}`}>
                            {statusBadge.label}
                          </span>
                        )}
                        {sourceBadge && (
                          <span className={`text-xs px-1.5 py-0.5 rounded ${sourceBadge.bg} ${sourceBadge.text}`}>
                            {sourceBadge.label}
                          </span>
                        )}
                        {depositRequired && (
                          <span className={`text-xs px-1.5 py-0.5 rounded ${
                            r.depositStatus === 'paid'
                              ? 'bg-green-600/20 text-green-400'
                              : 'bg-yellow-600/20 text-yellow-400'
                          }`}>
                            ${((r.depositAmountCents ?? 0) / 100).toFixed(2)}
                            {r.depositStatus === 'paid' ? ' Paid' : ' Due'}
                          </span>
                        )}
                        {occasionIcon && (
                          <span className="text-xs px-1 py-0.5 bg-slate-700/40 rounded" title={r.occasion || ''}>
                            {occasionIcon} {r.occasion}
                          </span>
                        )}
                        {r.bottleServiceTier && (
                          <span
                            className="text-xs px-1.5 py-0.5 rounded font-medium"
                            style={{
                              backgroundColor: `${r.bottleServiceTier.color || '#6366f1'}20`,
                              color: r.bottleServiceTier.color || '#818cf8',
                            }}
                          >
                            {r.bottleServiceTier.name}
                          </span>
                        )}
                      </div>

                      {/* Row 2: Customer warnings */}
                      {r.customer && (
                        <div className="flex gap-1.5 mt-1 flex-wrap">
                          {r.customer.isBlacklisted && (
                            <span className="text-xs px-1.5 py-0.5 bg-red-800 text-red-200 rounded font-medium">
                              Blacklisted
                            </span>
                          )}
                          {(r.customer.noShowCount ?? 0) > 0 && (
                            <span className="text-xs px-1.5 py-0.5 bg-orange-800/60 text-orange-300 rounded">
                              {r.customer.noShowCount} no-show{(r.customer.noShowCount ?? 0) > 1 ? 's' : ''}
                            </span>
                          )}
                        </div>
                      )}

                      {/* Row 3: Special requests */}
                      {r.specialRequests && (
                        <button
                          onClick={() => toggleRequests(r.id)}
                          className="mt-1 text-xs text-slate-500 italic text-left hover:text-slate-400 transition-colors"
                        >
                          {isExpanded ? r.specialRequests : truncate(r.specialRequests, 80)}
                        </button>
                      )}

                      {/* Hold countdown for pending */}
                      {r.status === 'pending' && r.holdExpiresAt && (
                        <HoldCountdown expiresAt={r.holdExpiresAt} />
                      )}
                    </div>

                    {/* Action buttons (permission-gated) */}
                    {canManage && (
                      <div className="flex-shrink-0 flex flex-wrap gap-1.5 items-start">
                        {/* Check In — for confirmed */}
                        {r.status === 'confirmed' && (
                          <button
                            onClick={() => handleCheckIn(r.id)}
                            className="px-3 py-1.5 text-xs font-medium bg-green-600/20 border border-green-500/30 rounded-lg text-green-400 hover:bg-green-600/30 transition-colors"
                          >
                            Check In
                          </button>
                        )}
                        {/* Seat — for checked_in or confirmed */}
                        {(r.status === 'checked_in' || r.status === 'confirmed') && (
                          <button
                            onClick={() => handleSeat(r.id)}
                            className="px-3 py-1.5 text-xs font-medium bg-blue-600/20 border border-blue-500/30 rounded-lg text-blue-400 hover:bg-blue-600/30 transition-colors"
                          >
                            Seat
                          </button>
                        )}
                        {/* Edit — for pending, confirmed, checked_in */}
                        {['pending', 'confirmed', 'checked_in'].includes(r.status) && (
                          <button
                            onClick={() => openEditModal(r)}
                            className="px-3 py-1.5 text-xs font-medium bg-white/5 border border-white/10 rounded-lg text-slate-300 hover:bg-white/10 transition-colors"
                          >
                            Edit
                          </button>
                        )}
                        {/* Message — for pending, confirmed, checked_in */}
                        {['pending', 'confirmed', 'checked_in'].includes(r.status) && r.customer?.phone && (
                          <button
                            onClick={() => { setMessageModal({ open: true, id: r.id }); setSelectedTemplate('confirmation') }}
                            className="px-3 py-1.5 text-xs font-medium bg-white/5 border border-white/10 rounded-lg text-slate-300 hover:bg-white/10 transition-colors"
                          >
                            Message
                          </button>
                        )}
                        {/* Cancel — for pending, confirmed, checked_in */}
                        {['pending', 'confirmed', 'checked_in'].includes(r.status) && (
                          <button
                            onClick={() => { setCancelModal({ open: true, id: r.id }); setCancelReason('') }}
                            className="px-3 py-1.5 text-xs font-medium bg-red-600/10 border border-red-500/20 rounded-lg text-red-400 hover:bg-red-600/20 transition-colors"
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>

      {/* Cancel Reason Modal */}
      <Modal
        isOpen={cancelModal.open}
        onClose={() => setCancelModal({ open: false, id: null })}
        title="Cancel Reservation"
        size="sm"
      >
        <div className="p-4 space-y-4">
          <p className="text-sm text-gray-400">
            Are you sure you want to cancel this reservation? This action cannot be undone.
          </p>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Reason (optional)
            </label>
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Guest requested cancellation..."
              rows={3}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-red-500/50 focus:ring-1 focus:ring-red-500/50 resize-none"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setCancelModal({ open: false, id: null })}
              className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-slate-300 hover:bg-white/10 transition-colors"
            >
              Keep Reservation
            </button>
            <button
              onClick={handleCancel}
              disabled={isCancelling}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 rounded-lg text-white font-medium transition-colors"
            >
              {isCancelling ? 'Cancelling...' : 'Cancel Reservation'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Edit Reservation Modal */}
      <Modal
        isOpen={editModal.open}
        onClose={() => setEditModal({ open: false, reservation: null })}
        title="Edit Reservation"
        size="sm"
      >
        <div className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Guest Name</label>
            <input
              type="text"
              value={editForm.guestName}
              onChange={(e) => setEditForm(f => ({ ...f, guestName: e.target.value }))}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Time</label>
            <input
              type="time"
              value={editForm.reservationTime}
              onChange={(e) => setEditForm(f => ({ ...f, reservationTime: e.target.value }))}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Party Size</label>
            <div className="flex gap-2 flex-wrap">
              {[1, 2, 3, 4, 5, 6, 8, 10, 12].map(size => (
                <button
                  key={size}
                  onClick={() => setEditForm(f => ({ ...f, partySize: size }))}
                  className={`w-10 h-10 rounded-lg font-bold text-sm transition-colors ${
                    editForm.partySize === size
                      ? 'bg-indigo-600 text-white'
                      : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                  }`}
                >
                  {size}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">Special Requests</label>
            <textarea
              value={editForm.specialRequests}
              onChange={(e) => setEditForm(f => ({ ...f, specialRequests: e.target.value }))}
              placeholder="Dietary needs, seating preference..."
              rows={2}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/50 resize-none"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setEditModal({ open: false, reservation: null })}
              className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-slate-300 hover:bg-white/10 transition-colors"
            >
              Discard
            </button>
            <button
              onClick={handleSaveEdit}
              disabled={isSaving || !editForm.guestName.trim()}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-lg text-white font-medium transition-colors"
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Send Message Modal */}
      <Modal
        isOpen={messageModal.open}
        onClose={() => setMessageModal({ open: false, id: null })}
        title="Send Message"
        size="sm"
      >
        <div className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">Message Template</label>
            <div className="space-y-1.5">
              {MESSAGE_TEMPLATES.map(t => (
                <button
                  key={t.key}
                  onClick={() => setSelectedTemplate(t.key)}
                  className={`w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors ${
                    selectedTemplate === t.key
                      ? 'bg-indigo-600/30 border border-indigo-500/50 text-indigo-300'
                      : 'bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setMessageModal({ open: false, id: null })}
              className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-slate-300 hover:bg-white/10 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSendMessage}
              disabled={isSending}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-lg text-white font-medium transition-colors"
            >
              {isSending ? 'Sending...' : 'Send'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

// ---- Helper functions -----------------------------------------------------

function todayStr(): string {
  return new Date().toISOString().split('T')[0]
}

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

function formatTimeShort(time: string): string {
  if (!time || !time.includes(':')) return time
  const [h, m] = time.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

function getTimeBorderColor(reservationTime: string, status: string): string {
  if (status === 'seated' || status === 'completed') return 'border-gray-700'
  if (status === 'cancelled' || status === 'no_show') return 'border-gray-700'
  if (status === 'checked_in') return 'border-blue-500'

  if (!reservationTime?.includes(':')) return 'border-gray-700'
  const [h, m] = reservationTime.split(':').map(Number)
  const now = new Date()
  const rezMinutes = h * 60 + m
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const diff = rezMinutes - nowMinutes

  if (diff < 0) return 'border-red-500'
  if (diff <= 15) return 'border-orange-500'
  if (diff <= 30) return 'border-yellow-500'
  if (diff <= 60) return 'border-green-500'
  return 'border-gray-700'
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen) + '...'
}

// ---- HoldCountdown sub-component -----------------------------------------

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
    <div className={`text-xs mt-1 font-mono ${isExpired ? 'text-red-400' : 'text-yellow-400'}`}>
      Hold: {remaining}
    </div>
  )
}
