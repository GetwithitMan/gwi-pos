'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'
import { useAuthStore } from '@/stores/auth-store'
import { formatCurrency } from '@/lib/utils'
import { toast } from '@/stores/toast-store'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useAdminCRUD } from '@/hooks/useAdminCRUD'

interface Role {
  id: string
  name: string
  permissions: string[]
}

interface Employee {
  id: string
  firstName: string
  lastName: string
  displayName: string
  email: string | null
  phone: string | null
  role: Role
  hourlyRate: number | null
  hireDate: string | null
  isActive: boolean
  color: string | null
  createdAt: string
}

export default function EmployeesPage() {
  const router = useRouter()
  const currentEmployee = useAuthStore(s => s.employee)
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const [roles, setRoles] = useState<Role[]>([])
  const [isPageLoading, setIsPageLoading] = useState(true)
  const [showInactive, setShowInactive] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')

  const crud = useAdminCRUD<Employee>({
    apiBase: '/api/employees',
    locationId: currentEmployee?.location?.id,
    resourceName: 'employee',
    parseResponse: (data) => data.employees || [],
  })

  const {
    showModal,
    editingItem: editingEmployee,
    isSaving,
    modalError,
    openAddModal: crudOpenAddModal,
    openEditModal: crudOpenEditModal,
    closeModal,
    handleSave: crudHandleSave,
    setItems: setEmployees,
    setModalError,
  } = crud

  // Multi-role state
  const [additionalRoleIds, setAdditionalRoleIds] = useState<string[]>([])

  // Form state
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    displayName: '',
    email: '',
    phone: '',
    pin: '',
    confirmPin: '',
    roleId: '',
    hourlyRate: '',
    hireDate: '',
    color: '#3B82F6',
  })

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login?redirect=/employees')
    }
  }, [isAuthenticated, router])

  // Custom loadData: employees need includeInactive param + parallel roles fetch
  const loadData = useCallback(async () => {
    if (!currentEmployee?.location?.id) return

    try {
      const [employeesRes, rolesRes] = await Promise.all([
        fetch(`/api/employees?locationId=${currentEmployee.location.id}&includeInactive=${showInactive}`),
        fetch(`/api/roles?locationId=${currentEmployee.location.id}`),
      ])

      if (employeesRes.ok) {
        const data = await employeesRes.json()
        setEmployees(data.employees)
      }

      if (rolesRes.ok) {
        const data = await rolesRes.json()
        setRoles(data.roles)
      }
    } catch (err) {
      console.error('Failed to load data:', err)
    } finally {
      setIsPageLoading(false)
    }
  }, [currentEmployee?.location?.id, showInactive, setEmployees])

  useEffect(() => {
    if (currentEmployee?.location?.id) {
      loadData()
    }
  }, [currentEmployee?.location?.id, showInactive, loadData])

  const openAddModal = () => {
    setFormData({
      firstName: '',
      lastName: '',
      displayName: '',
      email: '',
      phone: '',
      pin: '',
      confirmPin: '',
      roleId: roles[0]?.id || '',
      hourlyRate: '',
      hireDate: '',
      color: '#3B82F6',
    })
    setAdditionalRoleIds([])
    crudOpenAddModal()
  }

  const openEditModal = async (emp: Employee) => {
    setFormData({
      firstName: emp.firstName,
      lastName: emp.lastName,
      displayName: emp.displayName || '',
      email: emp.email || '',
      phone: emp.phone || '',
      pin: '',
      confirmPin: '',
      roleId: emp.role.id,
      hourlyRate: emp.hourlyRate?.toString() || '',
      hireDate: emp.hireDate ? emp.hireDate.split('T')[0] : '',
      color: emp.color || '#3B82F6',
    })
    setAdditionalRoleIds([])
    crudOpenEditModal(emp)

    // Fetch employee's additional roles
    try {
      const res = await fetch(`/api/employees/${emp.id}`)
      if (res.ok) {
        const data = await res.json()
        if (data.additionalRoles) {
          setAdditionalRoleIds(data.additionalRoles.map((r: { id: string }) => r.id))
        }
      }
    } catch {
      // Silently fail — additional roles are optional
    }
  }

  const handleSave = async () => {
    setModalError(null)

    // Validation
    if (!formData.firstName.trim() || !formData.lastName.trim()) {
      setModalError('First name and last name are required')
      return
    }

    if (!formData.roleId) {
      setModalError('Please select a role')
      return
    }

    if (!editingEmployee && !formData.pin) {
      setModalError('PIN is required for new employees')
      return
    }

    if (formData.pin && formData.pin !== formData.confirmPin) {
      setModalError('PINs do not match')
      return
    }

    if (formData.pin && !/^\d{4,6}$/.test(formData.pin)) {
      setModalError('PIN must be 4-6 digits')
      return
    }

    const payload: Record<string, unknown> = {
      firstName: formData.firstName.trim(),
      lastName: formData.lastName.trim(),
      displayName: formData.displayName.trim() || null,
      email: formData.email.trim() || null,
      phone: formData.phone.trim() || null,
      roleId: formData.roleId,
      hourlyRate: formData.hourlyRate ? parseFloat(formData.hourlyRate) : null,
      hireDate: formData.hireDate || null,
      color: formData.color,
    }

    if (formData.pin) {
      payload.pin = formData.pin
    }

    // Include additional roles when editing
    if (editingEmployee) {
      payload.additionalRoleIds = additionalRoleIds
    } else {
      payload.locationId = currentEmployee?.location?.id
    }

    const ok = await crudHandleSave(payload)
    if (ok) {
      // Reload with correct includeInactive param
      loadData()
    }
  }

  const [confirmAction, setConfirmAction] = useState<{ action: () => void; title: string; message: string } | null>(null)

  const handleToggleActive = async (emp: Employee) => {
    if (emp.isActive) {
      // Deactivate — show confirm dialog
      setConfirmAction({
        title: 'Deactivate Employee',
        message: `Are you sure you want to deactivate ${emp.displayName}?`,
        action: async () => {
          try {
            const response = await fetch(`/api/employees/${emp.id}`, {
              method: 'DELETE',
            })

            if (!response.ok) {
              const data = await response.json()
              toast.error(data.error || 'Failed to deactivate employee')
              return
            }

            loadData()
          } catch (err) {
            toast.error('Failed to deactivate employee')
          }
        },
      })
      return
    } else {
      // Reactivate
      try {
        const response = await fetch(`/api/employees/${emp.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isActive: true }),
        })

        if (!response.ok) {
          toast.error('Failed to reactivate employee')
          return
        }

        loadData()
      } catch (err) {
        toast.error('Failed to reactivate employee')
      }
    }
  }

  const employees = crud.items

  const filteredEmployees = employees.filter(emp => {
    const searchLower = searchTerm.toLowerCase()
    return (
      emp.firstName.toLowerCase().includes(searchLower) ||
      emp.lastName.toLowerCase().includes(searchLower) ||
      emp.displayName.toLowerCase().includes(searchLower) ||
      emp.role.name.toLowerCase().includes(searchLower)
    )
  })

  if (!isAuthenticated || !currentEmployee) {
    return null
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Employees"
        actions={
          <div className="flex items-center gap-3">
            <Button variant="ghost" onClick={() => router.push('/roles')}>
              Manage Roles
            </Button>
            <Button variant="primary" onClick={openAddModal}>
              + Add Employee
            </Button>
          </div>
        }
      />

      {/* Content */}
      <div className="mt-6">
        {/* Filters */}
        <div className="flex items-center gap-4 mb-6">
          <div className="flex-1 max-w-md">
            <Input
              placeholder="Search employees..."
              value={searchTerm}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchTerm(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="rounded"
            />
            Show Inactive
          </label>
        </div>

        {/* Employee List */}
        {isPageLoading ? (
          <div className="text-center py-12 text-gray-500">Loading employees...</div>
        ) : filteredEmployees.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            {searchTerm ? 'No employees match your search' : 'No employees found'}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredEmployees.map(emp => (
              <Card
                key={emp.id}
                className={`p-4 ${!emp.isActive ? 'opacity-60' : ''}`}
              >
                <div className="flex items-start gap-3">
                  {/* Avatar */}
                  <div
                    className="w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg"
                    style={{ backgroundColor: emp.color || '#3B82F6' }}
                  >
                    {emp.firstName.charAt(0)}{emp.lastName.charAt(0)}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold truncate">
                        {emp.displayName}
                      </h3>
                      {!emp.isActive && (
                        <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded">
                          Inactive
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500">
                      {emp.firstName} {emp.lastName}
                    </p>
                    <p className="text-sm text-blue-600 mt-1">{emp.role.name}</p>
                    {emp.hourlyRate && (
                      <p className="text-xs text-gray-400 mt-1">
                        {formatCurrency(emp.hourlyRate)}/hr
                      </p>
                    )}
                  </div>
                </div>

                {/* Contact Info */}
                {(emp.email || emp.phone) && (
                  <div className="mt-3 pt-3 border-t text-sm text-gray-500">
                    {emp.email && <p className="truncate">{emp.email}</p>}
                    {emp.phone && <p>{emp.phone}</p>}
                  </div>
                )}

                {/* Actions */}
                <div className="mt-3 pt-3 border-t flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex-1"
                    onClick={() => openEditModal(emp)}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => router.push(`/employees/${emp.id}/payment`)}
                    title="Payment & Tax Settings"
                  >
                    <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                    </svg>
                    Pay
                  </Button>
                  <Button
                    variant={emp.isActive ? 'danger' : 'outline'}
                    size="sm"
                    onClick={() => handleToggleActive(emp)}
                  >
                    {emp.isActive ? 'Deactivate' : 'Reactivate'}
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      <Modal
        isOpen={showModal}
        onClose={closeModal}
        title={editingEmployee ? 'Edit Employee' : 'Add Employee'}
        size="lg"
      >
        <div className="space-y-4">
          {modalError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
              {modalError}
            </div>
          )}

          {/* Name Fields */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="firstName">First Name *</Label>
              <Input
                id="firstName"
                value={formData.firstName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setFormData({ ...formData, firstName: e.target.value })
                }
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="lastName">Last Name *</Label>
              <Input
                id="lastName"
                value={formData.lastName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setFormData({ ...formData, lastName: e.target.value })
                }
                className="mt-1"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="displayName">Display Name</Label>
            <Input
              id="displayName"
              value={formData.displayName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setFormData({ ...formData, displayName: e.target.value })
              }
              placeholder="e.g., Mike S."
              className="mt-1"
            />
            <p className="text-xs text-gray-500 mt-1">
              Shown on orders. Leave blank to use first name + last initial.
            </p>
          </div>

          {/* Contact */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setFormData({ ...formData, email: e.target.value })
                }
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                value={formData.phone}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setFormData({ ...formData, phone: e.target.value })
                }
                className="mt-1"
              />
            </div>
          </div>

          {/* PIN */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="pin">
                PIN {!editingEmployee && '*'}
                {editingEmployee && <span className="text-gray-400 text-xs ml-1">(leave blank to keep)</span>}
              </Label>
              <Input
                id="pin"
                type="password"
                value={formData.pin}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setFormData({ ...formData, pin: e.target.value.replace(/\D/g, '').slice(0, 6) })
                }
                placeholder="4-6 digits"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="confirmPin">Confirm PIN</Label>
              <Input
                id="confirmPin"
                type="password"
                value={formData.confirmPin}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setFormData({ ...formData, confirmPin: e.target.value.replace(/\D/g, '').slice(0, 6) })
                }
                placeholder="4-6 digits"
                className="mt-1"
              />
            </div>
          </div>

          {/* Role */}
          <div>
            <Label htmlFor="role">Role *</Label>
            <select
              id="role"
              value={formData.roleId}
              onChange={(e) => {
                const newRoleId = e.target.value
                setFormData({ ...formData, roleId: newRoleId })
                setAdditionalRoleIds(prev => prev.filter(id => id !== newRoleId))
              }}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
            >
              <option value="">Select a role...</option>
              {roles.map(role => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
          </div>

          {/* Additional Roles (multi-role support, edit only) */}
          {editingEmployee && roles.length > 1 && (
            <div>
              <Label>Additional Roles</Label>
              <p className="text-xs text-gray-500 mb-2">
                Employee can work as these roles too (selected at clock-in)
              </p>
              <div className="space-y-1 p-2 border rounded-lg bg-gray-50">
                {roles
                  .filter(r => r.id !== formData.roleId)
                  .map(role => (
                    <label key={role.id} className="flex items-center gap-2 py-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={additionalRoleIds.includes(role.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setAdditionalRoleIds(prev => [...prev, role.id])
                          } else {
                            setAdditionalRoleIds(prev => prev.filter(id => id !== role.id))
                          }
                        }}
                        className="rounded border-gray-300"
                      />
                      <span className="text-sm">{role.name}</span>
                    </label>
                  ))}
                {roles.filter(r => r.id !== formData.roleId).length === 0 && (
                  <p className="text-xs text-gray-400 py-1">No other roles available</p>
                )}
              </div>
            </div>
          )}

          {/* Employment Details */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="hourlyRate">Hourly Rate</Label>
              <div className="relative mt-1">
                <span className="absolute left-3 top-2.5 text-gray-500">$</span>
                <Input
                  id="hourlyRate"
                  type="number"
                  value={formData.hourlyRate}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setFormData({ ...formData, hourlyRate: e.target.value })
                  }
                  className="pl-7"
                  step="0.01"
                  min="0"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="hireDate">Hire Date</Label>
              <Input
                id="hireDate"
                type="date"
                value={formData.hireDate}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setFormData({ ...formData, hireDate: e.target.value })
                }
                className="mt-1"
              />
            </div>
          </div>

          {/* Color */}
          <div>
            <Label htmlFor="color">Display Color</Label>
            <div className="flex items-center gap-3 mt-1">
              <input
                id="color"
                type="color"
                value={formData.color}
                onChange={(e) => setFormData({ ...formData, color: e.target.value })}
                className="w-10 h-10 rounded border cursor-pointer"
              />
              <span className="text-sm text-gray-500">
                Used for avatar and visual identification
              </span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-4 border-t">
            <Button
              variant="ghost"
              className="flex-1"
              onClick={closeModal}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving ? 'Saving...' : editingEmployee ? 'Save Changes' : 'Add Employee'}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!confirmAction}
        title={confirmAction?.title || 'Confirm'}
        description={confirmAction?.message}
        confirmLabel="Confirm"
        destructive
        onConfirm={() => { confirmAction?.action(); setConfirmAction(null) }}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  )
}
