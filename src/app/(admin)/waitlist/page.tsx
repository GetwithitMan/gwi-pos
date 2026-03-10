'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh'

interface WaitlistEntry {
  id: string
  customerName: string
  partySize: number
  phone: string | null
  notes: string | null
  status: 'waiting' | 'notified' | 'seated' | 'no_show' | 'cancelled'
  position: number
  quotedWaitMinutes: number | null
  elapsedMinutes: number
  estimatedWaitMinutes: number
  notifiedAt: string | null
  seatedAt: string | null
  createdAt: string
}

export default function WaitlistPage() {
  const employee = useAuthStore(s => s.employee)
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/waitlist' })

  const [entries, setEntries] = useState<WaitlistEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [formName, setFormName] = useState('')
  const [formPartySize, setFormPartySize] = useState(2)
  const [formPhone, setFormPhone] = useState('')
  const [formNotes, setFormNotes] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [actionInProgress, setActionInProgress] = useState<string | null>(null)

  const loadEntries = useCallback(async () => {
    try {
      const res = await fetch('/api/waitlist')
      if (!res.ok) return
      const json = await res.json()
      setEntries(json.data || [])
    } catch (error) {
      console.error('Failed to load waitlist:', error)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (employee?.location?.id) {
      loadEntries()
    }
  }, [employee?.location?.id, loadEntries])

  // Auto-refresh via socket event
  useReportAutoRefresh({
    onRefresh: loadEntries,
    events: ['waitlist:changed'],
    debounceMs: 1000,
  })

  async function handleAdd() {
    if (!formName.trim()) return
    setIsSaving(true)
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: formName.trim(),
          partySize: formPartySize,
          phone: formPhone.trim() || undefined,
          notes: formNotes.trim() || undefined,
        }),
      })
      if (res.ok) {
        setShowAddModal(false)
        resetForm()
        loadEntries()
      } else {
        const json = await res.json()
        alert(json.error || 'Failed to add to waitlist')
      }
    } catch (error) {
      console.error('Failed to add:', error)
    } finally {
      setIsSaving(false)
    }
  }

  async function handleAction(id: string, status: string) {
    setActionInProgress(id)
    try {
      const res = await fetch(`/api/waitlist/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (res.ok) {
        loadEntries()
      }
    } catch (error) {
      console.error('Failed to update:', error)
    } finally {
      setActionInProgress(null)
    }
  }

  async function handleRemove(id: string) {
    setActionInProgress(id)
    try {
      await fetch(`/api/waitlist/${id}`, { method: 'DELETE' })
      loadEntries()
    } catch (error) {
      console.error('Failed to remove:', error)
    } finally {
      setActionInProgress(null)
    }
  }

  function resetForm() {
    setFormName('')
    setFormPartySize(2)
    setFormPhone('')
    setFormNotes('')
  }

  // Summary stats
  const totalWaiting = entries.filter(e => e.status === 'waiting').length
  const totalNotified = entries.filter(e => e.status === 'notified').length
  const avgWait = entries.length > 0
    ? Math.round(entries.reduce((sum, e) => sum + (e.elapsedMinutes || 0), 0) / entries.length)
    : 0
  const longestWait = entries.length > 0
    ? Math.max(...entries.map(e => e.elapsedMinutes || 0))
    : 0

  if (!hydrated) return null

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <AdminPageHeader
        title="Waitlist"
        subtitle="Manage guest waitlist"
      />

      {/* Summary Bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white dark:bg-zinc-800 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700">
          <div className="text-sm text-zinc-500">Waiting</div>
          <div className="text-2xl font-bold">{totalWaiting}</div>
        </div>
        <div className="bg-white dark:bg-zinc-800 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700">
          <div className="text-sm text-zinc-500">Notified</div>
          <div className="text-2xl font-bold text-amber-600">{totalNotified}</div>
        </div>
        <div className="bg-white dark:bg-zinc-800 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700">
          <div className="text-sm text-zinc-500">Avg Wait</div>
          <div className="text-2xl font-bold">{avgWait}m</div>
        </div>
        <div className="bg-white dark:bg-zinc-800 rounded-lg p-4 border border-zinc-200 dark:border-zinc-700">
          <div className="text-sm text-zinc-500">Longest Wait</div>
          <div className="text-2xl font-bold text-red-500">{longestWait}m</div>
        </div>
      </div>

      {/* Action Bar */}
      <div className="flex justify-between items-center mb-4">
        <div className="text-sm text-zinc-500">
          {entries.length} {entries.length === 1 ? 'party' : 'parties'} on the waitlist
        </div>
        <Button onClick={() => setShowAddModal(true)}>
          + Add to Waitlist
        </Button>
      </div>

      {/* Entries List */}
      {isLoading ? (
        <div className="text-center py-12 text-zinc-500">Loading waitlist...</div>
      ) : entries.length === 0 ? (
        <div className="text-center py-12 text-zinc-500">
          <p className="text-lg font-medium">No one on the waitlist</p>
          <p className="text-sm mt-1">Add guests when they arrive</p>
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className={`bg-white dark:bg-zinc-800 rounded-lg border p-4 flex items-center gap-4 ${
                entry.status === 'notified'
                  ? 'border-amber-400 bg-amber-50 dark:bg-amber-950/20'
                  : 'border-zinc-200 dark:border-zinc-700'
              }`}
            >
              {/* Position */}
              <div className="w-10 h-10 rounded-full bg-zinc-100 dark:bg-zinc-700 flex items-center justify-center text-lg font-bold shrink-0">
                {entry.position}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-lg truncate">{entry.customerName}</span>
                  <span className="text-sm text-zinc-500">
                    Party of {entry.partySize}
                  </span>
                  {entry.status === 'notified' && (
                    <span className="px-2 py-0.5 bg-amber-200 text-amber-800 text-xs font-medium rounded-full">
                      NOTIFIED
                    </span>
                  )}
                </div>
                <div className="text-sm text-zinc-500 flex gap-3 mt-0.5">
                  <span>Waiting: {entry.elapsedMinutes}m</span>
                  <span>Est: ~{entry.estimatedWaitMinutes}m</span>
                  {entry.phone && <span>Tel: {entry.phone}</span>}
                </div>
                {entry.notes && (
                  <div className="text-sm text-zinc-400 mt-0.5 truncate">
                    Note: {entry.notes}
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-2 shrink-0">
                {entry.status === 'waiting' && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={actionInProgress === entry.id}
                    onClick={() => handleAction(entry.id, 'notified')}
                    className="text-amber-600 border-amber-300 hover:bg-amber-50"
                  >
                    Notify
                  </Button>
                )}
                <Button
                  size="sm"
                  disabled={actionInProgress === entry.id}
                  onClick={() => handleAction(entry.id, 'seated')}
                  className="bg-green-600 hover:bg-green-700 text-white"
                >
                  Seat
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={actionInProgress === entry.id}
                  onClick={() => handleAction(entry.id, 'no_show')}
                  className="text-red-600 border-red-300 hover:bg-red-50"
                >
                  No-Show
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={actionInProgress === entry.id}
                  onClick={() => handleRemove(entry.id)}
                  className="text-zinc-400 hover:text-zinc-600"
                >
                  Cancel
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Modal */}
      <Modal
        isOpen={showAddModal}
        onClose={() => { setShowAddModal(false); resetForm() }}
        title="Add to Waitlist"
        size="sm"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Guest Name *</label>
            <input
              type="text"
              className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-md bg-white dark:bg-zinc-800"
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              placeholder="Name"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Party Size</label>
            <input
              type="number"
              min={1}
              max={20}
              className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-md bg-white dark:bg-zinc-800"
              value={formPartySize}
              onChange={(e) => setFormPartySize(Number(e.target.value) || 1)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Phone (for SMS notification)</label>
            <input
              type="tel"
              className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-md bg-white dark:bg-zinc-800"
              value={formPhone}
              onChange={(e) => setFormPhone(e.target.value)}
              placeholder="(555) 123-4567"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Notes</label>
            <input
              type="text"
              className="w-full px-3 py-2 border border-zinc-300 dark:border-zinc-600 rounded-md bg-white dark:bg-zinc-800"
              value={formNotes}
              onChange={(e) => setFormNotes(e.target.value)}
              placeholder="Highchair needed, birthday, etc."
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => { setShowAddModal(false); resetForm() }}>
              Cancel
            </Button>
            <Button onClick={handleAdd} disabled={isSaving || !formName.trim()}>
              {isSaving ? 'Adding...' : 'Add to Waitlist'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
