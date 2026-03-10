'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { useReportAutoRefresh } from '@/hooks/useReportAutoRefresh'
import { toast } from '@/stores/toast-store'

// ─── Types ──────────────────────────────────────────────────────────────────

interface DeliveryOrder {
  id: string
  customerName: string
  phone: string | null
  address: string | null
  addressLine2: string | null
  city: string | null
  state: string | null
  zipCode: string | null
  notes: string | null
  status: DeliveryStatus
  deliveryFee: number
  estimatedMinutes: number
  scheduledFor: string | null
  driverId: string | null
  driverName: string | null
  orderId: string | null
  orderNumber: number | null
  creatorName: string | null
  createdAt: string
  preparedAt: string | null
  readyAt: string | null
  dispatchedAt: string | null
  deliveredAt: string | null
  cancelledAt: string | null
  cancelReason: string | null
}

type DeliveryStatus = 'pending' | 'preparing' | 'ready_for_pickup' | 'out_for_delivery' | 'delivered' | 'cancelled'

interface Driver {
  id: string
  name: string
  phone: string | null
  role: string
  activeDeliveryCount: number
  status: 'available' | 'on_delivery'
  lastDeliveryAt: string | null
}

// ─── Status pipeline colors ─────────────────────────────────────────────────

const STATUS_CONFIG: Record<DeliveryStatus, { label: string; color: string; bg: string }> = {
  pending: { label: 'Pending', color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/30' },
  preparing: { label: 'Preparing', color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/30' },
  ready_for_pickup: { label: 'Ready', color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/30' },
  out_for_delivery: { label: 'Out', color: 'text-purple-400', bg: 'bg-purple-500/10 border-purple-500/30' },
  delivered: { label: 'Delivered', color: 'text-green-400', bg: 'bg-green-500/10 border-green-500/30' },
  cancelled: { label: 'Cancelled', color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/30' },
}

const NEXT_STATUS: Partial<Record<DeliveryStatus, DeliveryStatus>> = {
  pending: 'preparing',
  preparing: 'ready_for_pickup',
  ready_for_pickup: 'out_for_delivery',
  out_for_delivery: 'delivered',
}

const NEXT_ACTION_LABEL: Partial<Record<DeliveryStatus, string>> = {
  pending: 'Start Preparing',
  preparing: 'Mark Ready',
  ready_for_pickup: 'Dispatch',
  out_for_delivery: 'Mark Delivered',
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function DeliveryPage() {
  const employee = useAuthStore(s => s.employee)
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/delivery' })

  const [deliveries, setDeliveries] = useState<DeliveryOrder[]>([])
  const [drivers, setDrivers] = useState<Driver[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<DeliveryStatus | 'all'>('all')
  const [actionInProgress, setActionInProgress] = useState<string | null>(null)

  // Assign driver modal
  const [assignModal, setAssignModal] = useState<{ open: boolean; deliveryId: string | null }>({ open: false, deliveryId: null })
  const [selectedDriverId, setSelectedDriverId] = useState('')

  // Create delivery modal
  const [createModal, setCreateModal] = useState(false)
  const [newDelivery, setNewDelivery] = useState({
    customerName: '',
    phone: '',
    address: '',
    addressLine2: '',
    city: '',
    state: '',
    zipCode: '',
    notes: '',
  })
  const [isCreating, setIsCreating] = useState(false)

  // ─── Data fetching ──────────────────────────────────────────────────────

  const loadDeliveries = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (statusFilter !== 'all') params.set('status', statusFilter)
      const res = await fetch(`/api/delivery?${params.toString()}`)
      if (!res.ok) return
      const json = await res.json()
      setDeliveries(json.data ?? [])
    } catch (error) {
      console.error('Failed to load deliveries:', error)
    }
  }, [statusFilter])

  const loadDrivers = useCallback(async () => {
    try {
      const res = await fetch('/api/delivery/drivers')
      if (!res.ok) return
      const json = await res.json()
      setDrivers(json.data ?? [])
    } catch (error) {
      console.error('Failed to load drivers:', error)
    }
  }, [])

  const loadAll = useCallback(async () => {
    await Promise.all([loadDeliveries(), loadDrivers()])
    setIsLoading(false)
  }, [loadDeliveries, loadDrivers])

  useEffect(() => {
    if (employee?.location?.id) {
      loadAll()
    }
  }, [employee?.location?.id, loadAll])

  useReportAutoRefresh({
    onRefresh: loadAll,
    events: ['delivery:updated'],
    debounceMs: 1000,
  })

  // ─── Actions ────────────────────────────────────────────────────────────

  async function handleStatusChange(deliveryId: string, newStatus: DeliveryStatus) {
    setActionInProgress(deliveryId)
    try {
      const res = await fetch(`/api/delivery/${deliveryId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error || 'Failed to update status')
        return
      }
      toast.success(json.message || 'Status updated')
      void loadDeliveries()
    } catch (error) {
      toast.error('Failed to update status')
    } finally {
      setActionInProgress(null)
    }
  }

  async function handleCancel(deliveryId: string) {
    if (!confirm('Cancel this delivery?')) return
    setActionInProgress(deliveryId)
    try {
      const res = await fetch(`/api/delivery/${deliveryId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'cancelled', cancelReason: 'Cancelled by manager' }),
      })
      if (!res.ok) {
        toast.error('Failed to cancel delivery')
        return
      }
      toast.success('Delivery cancelled')
      void loadDeliveries()
    } catch (error) {
      toast.error('Failed to cancel delivery')
    } finally {
      setActionInProgress(null)
    }
  }

  async function handleAssignDriver() {
    if (!assignModal.deliveryId || !selectedDriverId) return
    try {
      const res = await fetch('/api/delivery/drivers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deliveryId: assignModal.deliveryId,
          driverId: selectedDriverId,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error || 'Failed to assign driver')
        return
      }
      toast.success(json.message || 'Driver assigned')
      setAssignModal({ open: false, deliveryId: null })
      setSelectedDriverId('')
      void loadAll()
    } catch (error) {
      toast.error('Failed to assign driver')
    }
  }

  async function handleCreateDelivery() {
    if (!newDelivery.customerName.trim()) {
      toast.error('Customer name is required')
      return
    }
    setIsCreating(true)
    try {
      const res = await fetch('/api/delivery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...newDelivery,
          employeeId: employee?.id,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error || 'Failed to create delivery')
        return
      }
      toast.success(json.message || 'Delivery created')
      setCreateModal(false)
      setNewDelivery({ customerName: '', phone: '', address: '', addressLine2: '', city: '', state: '', zipCode: '', notes: '' })
      void loadAll()
    } catch (error) {
      toast.error('Failed to create delivery')
    } finally {
      setIsCreating(false)
    }
  }

  // ─── Derived ────────────────────────────────────────────────────────────

  const activeDeliveries = deliveries.filter(d => !['delivered', 'cancelled'].includes(d.status))
  const completedToday = deliveries.filter(d => d.status === 'delivered')
  const pendingCount = deliveries.filter(d => d.status === 'pending').length

  // Calculate average delivery time today
  const avgDeliveryTime = (() => {
    const delivered = deliveries.filter(d => d.deliveredAt && d.createdAt)
    if (delivered.length === 0) return null
    const totalMinutes = delivered.reduce((sum, d) => {
      const created = new Date(d.createdAt).getTime()
      const finished = new Date(d.deliveredAt!).getTime()
      return sum + (finished - created) / 60000
    }, 0)
    return Math.round(totalMinutes / delivered.length)
  })()

  // ─── Render ─────────────────────────────────────────────────────────────

  if (!hydrated) return null

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="max-w-7xl mx-auto px-4 py-6">
        <AdminPageHeader
          title="Delivery Management"
          subtitle={`${activeDeliveries.length} active | ${completedToday.length} completed today${avgDeliveryTime ? ` | Avg: ${avgDeliveryTime}min` : ''}`}
          actions={
            <Button onClick={() => setCreateModal(true)} className="bg-blue-600 hover:bg-blue-700">
              New Delivery
            </Button>
          }
        />

        {/* Summary cards */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-white dark:bg-gray-900 rounded-lg p-4 border border-gray-200 dark:border-gray-800">
            <div className="text-2xl font-bold text-blue-600">{activeDeliveries.length}</div>
            <div className="text-sm text-gray-500">Active Deliveries</div>
          </div>
          <div className="bg-white dark:bg-gray-900 rounded-lg p-4 border border-gray-200 dark:border-gray-800">
            <div className="text-2xl font-bold text-yellow-600">{pendingCount}</div>
            <div className="text-sm text-gray-500">Pending</div>
          </div>
          <div className="bg-white dark:bg-gray-900 rounded-lg p-4 border border-gray-200 dark:border-gray-800">
            <div className="text-2xl font-bold text-green-600">{completedToday.length}</div>
            <div className="text-sm text-gray-500">Delivered Today</div>
          </div>
          <div className="bg-white dark:bg-gray-900 rounded-lg p-4 border border-gray-200 dark:border-gray-800">
            <div className="text-2xl font-bold">{avgDeliveryTime ?? '--'}</div>
            <div className="text-sm text-gray-500">Avg Delivery (min)</div>
          </div>
        </div>

        {/* Split view */}
        <div className="flex gap-6">
          {/* LEFT: Active deliveries list */}
          <div className="flex-1">
            {/* Status filter tabs */}
            <div className="flex gap-2 mb-4">
              {(['all', 'pending', 'preparing', 'ready_for_pickup', 'out_for_delivery', 'delivered', 'cancelled'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                    statusFilter === s
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-300 dark:hover:bg-gray-700'
                  }`}
                >
                  {s === 'all' ? 'All' : STATUS_CONFIG[s].label}
                </button>
              ))}
            </div>

            {isLoading ? (
              <div className="text-center py-10 text-gray-500">Loading...</div>
            ) : deliveries.length === 0 ? (
              <div className="text-center py-10 text-gray-500">No delivery orders found</div>
            ) : (
              <div className="space-y-3">
                {deliveries.map(d => {
                  const config = STATUS_CONFIG[d.status]
                  const nextStatus = NEXT_STATUS[d.status]
                  const nextLabel = NEXT_ACTION_LABEL[d.status]

                  return (
                    <div
                      key={d.id}
                      className={`bg-white dark:bg-gray-900 rounded-lg p-4 border ${config.bg}`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">{d.customerName}</span>
                            <span className={`text-xs font-medium ${config.color}`}>{config.label}</span>
                            {d.orderNumber && (
                              <span className="text-xs text-gray-500">#{d.orderNumber}</span>
                            )}
                          </div>
                          <div className="text-sm text-gray-500 mt-1">
                            {d.address && (
                              <div>
                                {d.address}
                                {d.addressLine2 && `, ${d.addressLine2}`}
                                {d.city && `, ${d.city}`}
                                {d.state && ` ${d.state}`}
                                {d.zipCode && ` ${d.zipCode}`}
                              </div>
                            )}
                            {d.phone && <div>{d.phone}</div>}
                          </div>
                          <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                            <span>ETA: {d.estimatedMinutes}min</span>
                            {d.driverName && <span>Driver: {d.driverName}</span>}
                            {d.deliveryFee > 0 && <span>Fee: ${d.deliveryFee.toFixed(2)}</span>}
                            <span>Created: {new Date(d.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                          </div>
                          {d.notes && (
                            <div className="text-xs text-gray-500 italic mt-1">{d.notes}</div>
                          )}
                        </div>

                        {/* Action buttons */}
                        <div className="flex flex-col gap-1 ml-3">
                          {!d.driverId && d.status !== 'delivered' && d.status !== 'cancelled' && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setAssignModal({ open: true, deliveryId: d.id })
                                setSelectedDriverId('')
                              }}
                              className="text-xs"
                            >
                              Assign Driver
                            </Button>
                          )}
                          {nextStatus && nextLabel && (
                            <Button
                              size="sm"
                              onClick={() => handleStatusChange(d.id, nextStatus)}
                              disabled={actionInProgress === d.id}
                              className="text-xs bg-blue-600 hover:bg-blue-700"
                            >
                              {nextLabel}
                            </Button>
                          )}
                          {d.status !== 'delivered' && d.status !== 'cancelled' && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleCancel(d.id)}
                              disabled={actionInProgress === d.id}
                              className="text-xs text-red-500 border-red-500/30 hover:bg-red-500/10"
                            >
                              Cancel
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* RIGHT: Driver panel */}
          <div className="w-72 flex-shrink-0">
            <h3 className="font-semibold mb-3 text-gray-700 dark:text-gray-300">Drivers</h3>
            {drivers.length === 0 ? (
              <div className="text-center py-6 text-gray-500 text-sm">No employees available</div>
            ) : (
              <div className="space-y-2">
                {drivers
                  .filter(d => d.status === 'on_delivery' || d.activeDeliveryCount > 0)
                  .concat(drivers.filter(d => d.status === 'available' && d.activeDeliveryCount === 0))
                  .slice(0, 20) // Limit display
                  .map(driver => (
                    <div
                      key={driver.id}
                      className={`bg-white dark:bg-gray-900 rounded-lg p-3 border ${
                        driver.status === 'on_delivery'
                          ? 'border-purple-500/30'
                          : 'border-gray-200 dark:border-gray-800'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="font-medium text-sm">{driver.name}</div>
                          <div className="text-xs text-gray-500">{driver.role}</div>
                        </div>
                        <div className="text-right">
                          <div className={`text-xs font-medium ${
                            driver.status === 'on_delivery' ? 'text-purple-400' : 'text-green-400'
                          }`}>
                            {driver.status === 'on_delivery' ? `${driver.activeDeliveryCount} out` : 'Available'}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Assign Driver Modal */}
      <Modal
        isOpen={assignModal.open}
        onClose={() => setAssignModal({ open: false, deliveryId: null })}
        title="Assign Driver"
        size="sm"
      >
        <div className="p-4 space-y-4">
          <select
            value={selectedDriverId}
            onChange={e => setSelectedDriverId(e.target.value)}
            className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg"
          >
            <option value="">Select a driver...</option>
            {drivers.map(d => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.status === 'on_delivery' ? `${d.activeDeliveryCount} out` : 'Available'})
              </option>
            ))}
          </select>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setAssignModal({ open: false, deliveryId: null })}>
              Cancel
            </Button>
            <Button
              onClick={handleAssignDriver}
              disabled={!selectedDriverId}
              className="bg-blue-600 hover:bg-blue-700"
            >
              Assign
            </Button>
          </div>
        </div>
      </Modal>

      {/* Create Delivery Modal */}
      <Modal
        isOpen={createModal}
        onClose={() => setCreateModal(false)}
        title="New Delivery Order"
        size="md"
      >
        <div className="p-4 space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Customer Name *</label>
            <input
              type="text"
              value={newDelivery.customerName}
              onChange={e => setNewDelivery(prev => ({ ...prev, customerName: e.target.value }))}
              className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg"
              placeholder="John Smith"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Phone</label>
            <input
              type="tel"
              value={newDelivery.phone}
              onChange={e => setNewDelivery(prev => ({ ...prev, phone: e.target.value }))}
              className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg"
              placeholder="(555) 123-4567"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Address</label>
            <input
              type="text"
              value={newDelivery.address}
              onChange={e => setNewDelivery(prev => ({ ...prev, address: e.target.value }))}
              className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg"
              placeholder="123 Main St"
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-sm font-medium mb-1">City</label>
              <input
                type="text"
                value={newDelivery.city}
                onChange={e => setNewDelivery(prev => ({ ...prev, city: e.target.value }))}
                className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">State</label>
              <input
                type="text"
                value={newDelivery.state}
                onChange={e => setNewDelivery(prev => ({ ...prev, state: e.target.value }))}
                className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">ZIP</label>
              <input
                type="text"
                value={newDelivery.zipCode}
                onChange={e => setNewDelivery(prev => ({ ...prev, zipCode: e.target.value }))}
                className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Notes</label>
            <textarea
              value={newDelivery.notes}
              onChange={e => setNewDelivery(prev => ({ ...prev, notes: e.target.value }))}
              className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-lg"
              rows={2}
              placeholder="Delivery instructions, gate code, etc."
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setCreateModal(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleCreateDelivery}
              disabled={isCreating || !newDelivery.customerName.trim()}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {isCreating ? 'Creating...' : 'Create Delivery'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
