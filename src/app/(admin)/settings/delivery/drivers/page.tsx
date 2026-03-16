'use client'

import { useState, useEffect, useCallback } from 'react'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useDeliveryFeature } from '@/hooks/useDeliveryFeature'
import { useRequireAuth } from '@/hooks/useRequireAuth'
import { toast } from '@/stores/toast-store'

// ─── Types ──────────────────────────────────────────────────────────────────

interface Driver {
  id: string
  employeeId: string
  employeeName: string
  phone: string | null
  vehicleType: string | null
  vehicleMake: string | null
  vehicleModel: string | null
  vehicleColor: string | null
  licensePlate: string | null
  isSuspended: boolean
  isActive: boolean
  sessionStatus: 'offline' | 'available' | 'on_delivery' | 'returning'
  // Scorecard
  onTimePercent: number | null
  deliveriesPerHour: number | null
  cashVariance: number | null
  totalDeliveries: number
  // Documents
  documentsCount: number
  createdAt: string
}

interface Employee {
  id: string
  name: string
  role: string
}

interface DriverFormData {
  employeeId: string
  vehicleType: string
  vehicleMake: string
  vehicleModel: string
  vehicleColor: string
  licensePlate: string
}

const EMPTY_FORM: DriverFormData = {
  employeeId: '',
  vehicleType: 'car',
  vehicleMake: '',
  vehicleModel: '',
  vehicleColor: '',
  licensePlate: '',
}

const VEHICLE_TYPES = [
  { value: 'car', label: 'Car' },
  { value: 'suv', label: 'SUV' },
  { value: 'truck', label: 'Truck' },
  { value: 'van', label: 'Van' },
  { value: 'motorcycle', label: 'Motorcycle' },
  { value: 'bicycle', label: 'Bicycle' },
  { value: 'scooter', label: 'Scooter' },
  { value: 'other', label: 'Other' },
]

// ─── Component ──────────────────────────────────────────────────────────────

export default function DriverManagementPage() {
  const { employee } = useRequireAuth()
  const deliveryEnabled = useDeliveryFeature()
  const documentsProvisioned = useDeliveryFeature('driverDocumentsProvisioned')

  const [drivers, setDrivers] = useState<Driver[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // Modal state
  const [editModal, setEditModal] = useState(false)
  const [editingDriverId, setEditingDriverId] = useState<string | null>(null)
  const [form, setForm] = useState<DriverFormData>(EMPTY_FORM)
  const [isSaving, setIsSaving] = useState(false)

  // Detail view
  const [detailDriver, setDetailDriver] = useState<Driver | null>(null)
  const [detailTab, setDetailTab] = useState<'info' | 'scorecard' | 'documents'>('info')

  // Suspend confirmation
  const [suspendConfirm, setSuspendConfirm] = useState<{ open: boolean; driver: Driver | null }>({ open: false, driver: null })

  // ─── Load ──────────────────────────────────────────────────────────

  const loadDrivers = useCallback(async () => {
    try {
      const res = await fetch('/api/delivery/drivers')
      if (!res.ok) return
      const json = await res.json()
      setDrivers(json.data ?? [])
    } catch (error) {
      console.error('Failed to load drivers:', error)
      toast.error('Failed to load drivers')
    }
  }, [])

  const loadEmployees = useCallback(async () => {
    try {
      const res = await fetch('/api/employees?active=true')
      if (!res.ok) return
      const json = await res.json()
      setEmployees(json.data ?? [])
    } catch (error) {
      console.error('Failed to load employees:', error)
    }
  }, [])

  useEffect(() => {
    if (deliveryEnabled) {
      void Promise.all([loadDrivers(), loadEmployees()]).finally(() => setIsLoading(false))
    } else {
      setIsLoading(false)
    }
  }, [deliveryEnabled, loadDrivers, loadEmployees])

  // ─── Open Edit/Create ─────────────────────────────────────────────

  function openCreate() {
    setEditingDriverId(null)
    setForm(EMPTY_FORM)
    setEditModal(true)
  }

  function openEdit(driver: Driver) {
    setEditingDriverId(driver.id)
    setForm({
      employeeId: driver.employeeId,
      vehicleType: driver.vehicleType ?? 'car',
      vehicleMake: driver.vehicleMake ?? '',
      vehicleModel: driver.vehicleModel ?? '',
      vehicleColor: driver.vehicleColor ?? '',
      licensePlate: driver.licensePlate ?? '',
    })
    setEditModal(true)
  }

  // ─── Save ──────────────────────────────────────────────────────────

  async function handleSave() {
    if (!form.employeeId && !editingDriverId) {
      toast.error('Please select an employee')
      return
    }

    setIsSaving(true)
    try {
      const body = {
        employeeId: form.employeeId,
        vehicleType: form.vehicleType || null,
        vehicleMake: form.vehicleMake.trim() || null,
        vehicleModel: form.vehicleModel.trim() || null,
        vehicleColor: form.vehicleColor.trim() || null,
        licensePlate: form.licensePlate.trim() || null,
      }

      const url = editingDriverId
        ? `/api/delivery/drivers/${editingDriverId}`
        : '/api/delivery/drivers'
      const method = editingDriverId ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error || 'Failed to save driver')
        return
      }

      toast.success(editingDriverId ? 'Driver updated' : 'Driver added')
      setEditModal(false)
      void loadDrivers()
    } catch (error) {
      toast.error('Failed to save driver')
    } finally {
      setIsSaving(false)
    }
  }

  // ─── Suspend/Unsuspend ────────────────────────────────────────────

  async function handleSuspendToggle() {
    if (!suspendConfirm.driver) return
    const driver = suspendConfirm.driver
    try {
      const res = await fetch(`/api/delivery/drivers/${driver.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isSuspended: !driver.isSuspended }),
      })
      if (!res.ok) {
        toast.error('Failed to update driver status')
        return
      }
      toast.success(driver.isSuspended ? 'Driver unsuspended' : 'Driver suspended')
      setSuspendConfirm({ open: false, driver: null })
      void loadDrivers()
    } catch {
      toast.error('Failed to update driver status')
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  function getSessionBadge(status: Driver['sessionStatus']) {
    switch (status) {
      case 'available':
        return { label: 'Available', color: 'bg-green-100 text-green-700' }
      case 'on_delivery':
        return { label: 'On Delivery', color: 'bg-purple-100 text-purple-700' }
      case 'returning':
        return { label: 'Returning', color: 'bg-yellow-100 text-yellow-700' }
      default:
        return { label: 'Offline', color: 'bg-gray-100 text-gray-500' }
    }
  }

  // Filter employees not yet assigned as drivers
  const availableEmployees = employees.filter(
    emp => !drivers.some(d => d.employeeId === emp.id)
  )

  // ─── Render guards ────────────────────────────────────────────────

  if (!deliveryEnabled) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-md">
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Delivery Module Not Enabled</h2>
          <p className="text-gray-600 text-sm">
            Enable the delivery module from Mission Control to manage drivers.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Driver Management"
        subtitle={`${drivers.filter(d => d.isActive && !d.isSuspended).length} active driver${drivers.filter(d => d.isActive && !d.isSuspended).length !== 1 ? 's' : ''}`}
        breadcrumbs={[
          { label: 'Settings', href: '/settings' },
          { label: 'Delivery', href: '/settings/delivery' },
        ]}
        actions={
          <Button onClick={openCreate} className="bg-blue-600 hover:bg-blue-700">
            Add Driver
          </Button>
        }
      />

      <div className="max-w-5xl mx-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent"></div>
          </div>
        ) : drivers.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-4xl mb-3">🚗</div>
            <h3 className="text-lg font-semibold text-gray-900 mb-1">No Drivers</h3>
            <p className="text-gray-500 text-sm mb-4">
              Add employees as delivery drivers to start dispatching orders.
            </p>
            <Button onClick={openCreate} className="bg-blue-600 hover:bg-blue-700">
              Add First Driver
            </Button>
          </div>
        ) : (
          <div className="rounded-xl bg-white shadow-sm border border-gray-200 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">Driver</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">Vehicle</th>
                  <th className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">Status</th>
                  <th className="text-center text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">On-Time</th>
                  <th className="text-center text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">Del/Hr</th>
                  <th className="text-center text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">Total</th>
                  <th className="text-right text-xs font-semibold text-gray-500 uppercase tracking-wider px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {drivers.map(driver => {
                  const session = getSessionBadge(driver.sessionStatus)
                  return (
                    <tr key={driver.id} className={`hover:bg-gray-50 transition-colors ${driver.isSuspended ? 'opacity-50' : ''}`}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center text-sm font-bold text-gray-600">
                            {driver.employeeName.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-medium text-sm text-gray-900">{driver.employeeName}</div>
                            {driver.phone && (
                              <div className="text-xs text-gray-500">{driver.phone}</div>
                            )}
                            {driver.isSuspended && (
                              <span className="text-[10px] text-red-600 font-medium">SUSPENDED</span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="text-sm text-gray-700">
                          {driver.vehicleType ? (
                            <>
                              <span className="capitalize">{driver.vehicleType}</span>
                              {driver.vehicleMake && ` - ${driver.vehicleMake}`}
                              {driver.vehicleModel && ` ${driver.vehicleModel}`}
                            </>
                          ) : (
                            <span className="text-gray-400">Not set</span>
                          )}
                        </div>
                        {driver.vehicleColor && (
                          <div className="text-xs text-gray-500">{driver.vehicleColor}{driver.licensePlate && ` | ${driver.licensePlate}`}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex text-xs px-2 py-0.5 rounded-full font-medium ${session.color}`}>
                          {session.label}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {driver.onTimePercent != null ? (
                          <span className={`text-sm font-medium ${
                            driver.onTimePercent >= 90 ? 'text-green-600'
                              : driver.onTimePercent >= 75 ? 'text-yellow-600'
                              : 'text-red-600'
                          }`}>
                            {driver.onTimePercent}%
                          </span>
                        ) : (
                          <span className="text-gray-400 text-sm">--</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {driver.deliveriesPerHour != null ? (
                          <span className="text-sm text-gray-700">{driver.deliveriesPerHour.toFixed(1)}</span>
                        ) : (
                          <span className="text-gray-400 text-sm">--</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="text-sm text-gray-700">{driver.totalDeliveries}</span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => { setDetailDriver(driver); setDetailTab('info') }}
                            className="text-xs px-2 py-1 text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                          >
                            View
                          </button>
                          <button
                            onClick={() => openEdit(driver)}
                            className="text-xs px-2 py-1 text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => setSuspendConfirm({ open: true, driver })}
                            className={`text-xs px-2 py-1 rounded-md transition-colors ${
                              driver.isSuspended
                                ? 'text-green-600 hover:bg-green-50'
                                : 'text-red-600 hover:bg-red-50'
                            }`}
                          >
                            {driver.isSuspended ? 'Unsuspend' : 'Suspend'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ─── Add/Edit Driver Modal ─────────────────────────────────────── */}
      <Modal
        isOpen={editModal}
        onClose={() => setEditModal(false)}
        title={editingDriverId ? 'Edit Driver' : 'Add Driver'}
        size="md"
      >
        <div className="space-y-4">
          {/* Employee Selection (only for new) */}
          {!editingDriverId && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Employee *</label>
              <select
                value={form.employeeId}
                onChange={e => setForm(prev => ({ ...prev, employeeId: e.target.value }))}
                className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">Select employee...</option>
                {availableEmployees.map(emp => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name} ({emp.role})
                  </option>
                ))}
              </select>
              {availableEmployees.length === 0 && (
                <p className="text-xs text-amber-600 mt-1">All employees are already assigned as drivers.</p>
              )}
            </div>
          )}

          {/* Vehicle Details */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Vehicle Type</label>
            <select
              value={form.vehicleType}
              onChange={e => setForm(prev => ({ ...prev, vehicleType: e.target.value }))}
              className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {VEHICLE_TYPES.map(vt => (
                <option key={vt.value} value={vt.value}>{vt.label}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Make</label>
              <input
                type="text"
                value={form.vehicleMake}
                onChange={e => setForm(prev => ({ ...prev, vehicleMake: e.target.value }))}
                className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="Toyota"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Model</label>
              <input
                type="text"
                value={form.vehicleModel}
                onChange={e => setForm(prev => ({ ...prev, vehicleModel: e.target.value }))}
                className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="Corolla"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Color</label>
              <input
                type="text"
                value={form.vehicleColor}
                onChange={e => setForm(prev => ({ ...prev, vehicleColor: e.target.value }))}
                className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="Silver"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">License Plate</label>
              <input
                type="text"
                value={form.licensePlate}
                onChange={e => setForm(prev => ({ ...prev, licensePlate: e.target.value }))}
                className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="ABC-1234"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2 border-t border-gray-200">
            <Button variant="outline" onClick={() => setEditModal(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSaving}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {isSaving ? 'Saving...' : editingDriverId ? 'Update Driver' : 'Add Driver'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ─── Driver Detail Modal ───────────────────────────────────────── */}
      <Modal
        isOpen={!!detailDriver}
        onClose={() => setDetailDriver(null)}
        title={detailDriver?.employeeName ?? 'Driver Details'}
        size="lg"
      >
        {detailDriver && (
          <div>
            {/* Tabs */}
            <div className="flex border-b border-gray-200 mb-4">
              {([
                { key: 'info' as const, label: 'Info' },
                { key: 'scorecard' as const, label: 'Scorecard' },
                ...(documentsProvisioned ? [{ key: 'documents' as const, label: 'Documents' }] : []),
              ]).map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setDetailTab(tab.key)}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${
                    detailTab === tab.key
                      ? 'text-blue-600 border-b-2 border-blue-600'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {detailTab === 'info' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-xs text-gray-500 block">Phone</span>
                    <span className="text-sm text-gray-900">{detailDriver.phone || '--'}</span>
                  </div>
                  <div>
                    <span className="text-xs text-gray-500 block">Status</span>
                    <span className={`text-sm font-medium ${getSessionBadge(detailDriver.sessionStatus).color} px-2 py-0.5 rounded-full inline-block`}>
                      {getSessionBadge(detailDriver.sessionStatus).label}
                    </span>
                  </div>
                  <div>
                    <span className="text-xs text-gray-500 block">Vehicle</span>
                    <span className="text-sm text-gray-900">
                      {detailDriver.vehicleType
                        ? `${detailDriver.vehicleMake || ''} ${detailDriver.vehicleModel || ''} (${detailDriver.vehicleColor || ''})`.trim()
                        : '--'}
                    </span>
                  </div>
                  <div>
                    <span className="text-xs text-gray-500 block">License Plate</span>
                    <span className="text-sm text-gray-900">{detailDriver.licensePlate || '--'}</span>
                  </div>
                  <div>
                    <span className="text-xs text-gray-500 block">Added</span>
                    <span className="text-sm text-gray-900">
                      {new Date(detailDriver.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <div>
                    <span className="text-xs text-gray-500 block">Suspended</span>
                    <span className={`text-sm font-medium ${detailDriver.isSuspended ? 'text-red-600' : 'text-green-600'}`}>
                      {detailDriver.isSuspended ? 'Yes' : 'No'}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {detailTab === 'scorecard' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-lg bg-gray-50 p-4 text-center">
                    <div className={`text-2xl font-bold ${
                      (detailDriver.onTimePercent ?? 0) >= 90 ? 'text-green-600'
                        : (detailDriver.onTimePercent ?? 0) >= 75 ? 'text-yellow-600'
                        : 'text-red-600'
                    }`}>
                      {detailDriver.onTimePercent != null ? `${detailDriver.onTimePercent}%` : '--'}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">On-Time Rate</div>
                  </div>
                  <div className="rounded-lg bg-gray-50 p-4 text-center">
                    <div className="text-2xl font-bold text-gray-900">
                      {detailDriver.deliveriesPerHour != null ? detailDriver.deliveriesPerHour.toFixed(1) : '--'}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">Deliveries / Hour</div>
                  </div>
                  <div className="rounded-lg bg-gray-50 p-4 text-center">
                    <div className="text-2xl font-bold text-gray-900">
                      {detailDriver.totalDeliveries}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">Total Deliveries</div>
                  </div>
                  <div className="rounded-lg bg-gray-50 p-4 text-center">
                    <div className={`text-2xl font-bold ${
                      (detailDriver.cashVariance ?? 0) === 0 ? 'text-green-600'
                        : (detailDriver.cashVariance ?? 0) > 0 ? 'text-yellow-600'
                        : 'text-red-600'
                    }`}>
                      {detailDriver.cashVariance != null ? `$${Math.abs(detailDriver.cashVariance).toFixed(2)}` : '--'}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">Cash Variance</div>
                  </div>
                </div>
              </div>
            )}

            {detailTab === 'documents' && documentsProvisioned && (
              <div className="space-y-3">
                {detailDriver.documentsCount === 0 ? (
                  <div className="text-center py-8 text-gray-500 text-sm">
                    No compliance documents uploaded
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500 text-sm">
                    {detailDriver.documentsCount} document{detailDriver.documentsCount !== 1 ? 's' : ''} on file.
                    <br />
                    <span className="text-xs text-gray-400">Document viewing available in the full driver portal.</span>
                  </div>
                )}
                <div className="text-center">
                  <Button variant="outline" size="sm">
                    Upload Document
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* ─── Suspend/Unsuspend Confirmation ────────────────────────────── */}
      <ConfirmDialog
        open={suspendConfirm.open}
        title={suspendConfirm.driver?.isSuspended ? 'Unsuspend Driver' : 'Suspend Driver'}
        description={
          suspendConfirm.driver?.isSuspended
            ? `Are you sure you want to unsuspend ${suspendConfirm.driver.employeeName}? They will be able to receive deliveries again.`
            : `Are you sure you want to suspend ${suspendConfirm.driver?.employeeName}? They will not be able to receive new deliveries until unsuspended.`
        }
        confirmLabel={suspendConfirm.driver?.isSuspended ? 'Unsuspend' : 'Suspend'}
        destructive={!suspendConfirm.driver?.isSuspended}
        onConfirm={handleSuspendToggle}
        onCancel={() => setSuspendConfirm({ open: false, driver: null })}
      />
    </div>
  )
}
