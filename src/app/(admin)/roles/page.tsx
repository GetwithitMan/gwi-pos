'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'
import { useAuthStore } from '@/stores/auth-store'

interface Permission {
  key: string
  value: string
  category: string
}

interface Role {
  id: string
  name: string
  permissions: string[]
  employeeCount: number
  createdAt: string
}

// Permission categories for UI organization
const PERMISSION_CATEGORIES = {
  orders: 'Orders',
  payments: 'Payments',
  menu: 'Menu',
  employees: 'Employees',
  reports: 'Reports',
  settings: 'Settings',
}

// Friendly permission names
const PERMISSION_LABELS: Record<string, string> = {
  'orders.create': 'Create Orders',
  'orders.void_item': 'Void Items',
  'orders.void_order': 'Void Orders',
  'orders.apply_discount': 'Apply Discounts',
  'orders.transfer': 'Transfer Orders',
  'payments.process': 'Process Payments',
  'payments.refund': 'Issue Refunds',
  'payments.open_drawer': 'Open Cash Drawer',
  'menu.view': 'View Menu',
  'menu.edit': 'Edit Menu Items',
  'menu.edit_prices': 'Edit Prices',
  'employees.view': 'View Employees',
  'employees.edit': 'Manage Employees',
  'employees.clock_others': 'Clock In/Out Others',
  'reports.view': 'View Basic Reports',
  'reports.labor': 'View Labor Reports',
  'reports.sales': 'View Sales Reports',
  'reports.commission': 'View Commission Reports',
  'settings.edit': 'Edit Settings',
  'settings.dual_pricing': 'Manage Dual Pricing',
  'admin': 'Administrator',
  'super_admin': 'Super Administrator',
}

export default function RolesPage() {
  const router = useRouter()
  const { employee: currentEmployee, isAuthenticated } = useAuthStore()
  const [roles, setRoles] = useState<Role[]>([])
  const [availablePermissions, setAvailablePermissions] = useState<Permission[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // Modal state
  const [showModal, setShowModal] = useState(false)
  const [editingRole, setEditingRole] = useState<Role | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Form state
  const [roleName, setRoleName] = useState('')
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([])

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login')
    }
  }, [isAuthenticated, router])

  useEffect(() => {
    if (currentEmployee?.location?.id) {
      loadRoles()
    }
  }, [currentEmployee])

  const loadRoles = async () => {
    if (!currentEmployee?.location?.id) return

    try {
      const response = await fetch(`/api/roles?locationId=${currentEmployee.location.id}`)
      if (response.ok) {
        const data = await response.json()
        setRoles(data.roles)
        setAvailablePermissions(data.availablePermissions || [])
      }
    } catch (err) {
      console.error('Failed to load roles:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const openAddModal = () => {
    setEditingRole(null)
    setRoleName('')
    setSelectedPermissions([])
    setError(null)
    setShowModal(true)
  }

  const openEditModal = (role: Role) => {
    setEditingRole(role)
    setRoleName(role.name)
    setSelectedPermissions(role.permissions)
    setError(null)
    setShowModal(true)
  }

  const togglePermission = (permission: string) => {
    if (selectedPermissions.includes(permission)) {
      setSelectedPermissions(selectedPermissions.filter(p => p !== permission))
    } else {
      setSelectedPermissions([...selectedPermissions, permission])
    }
  }

  const selectAllInCategory = (category: string) => {
    const categoryPerms = availablePermissions
      .filter(p => p.category === category)
      .map(p => p.value)
    const allSelected = categoryPerms.every(p => selectedPermissions.includes(p))

    if (allSelected) {
      setSelectedPermissions(selectedPermissions.filter(p => !categoryPerms.includes(p)))
    } else {
      const newPerms = [...selectedPermissions]
      categoryPerms.forEach(p => {
        if (!newPerms.includes(p)) newPerms.push(p)
      })
      setSelectedPermissions(newPerms)
    }
  }

  const handleSave = async () => {
    setError(null)

    if (!roleName.trim()) {
      setError('Role name is required')
      return
    }

    setIsSaving(true)

    try {
      let response: Response

      if (editingRole) {
        response = await fetch(`/api/roles/${editingRole.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: roleName.trim(),
            permissions: selectedPermissions,
          }),
        })
      } else {
        response = await fetch('/api/roles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            locationId: currentEmployee?.location?.id,
            name: roleName.trim(),
            permissions: selectedPermissions,
          }),
        })
      }

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to save role')
      }

      setShowModal(false)
      loadRoles()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save role')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async (role: Role) => {
    if (role.employeeCount > 0) {
      alert(`Cannot delete "${role.name}" - ${role.employeeCount} employee(s) have this role. Reassign them first.`)
      return
    }

    if (!confirm(`Are you sure you want to delete the "${role.name}" role?`)) {
      return
    }

    try {
      const response = await fetch(`/api/roles/${role.id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        alert(data.error || 'Failed to delete role')
        return
      }

      loadRoles()
    } catch (err) {
      alert('Failed to delete role')
    }
  }

  // Group permissions by category
  const groupedPermissions = availablePermissions.reduce((acc, perm) => {
    if (!acc[perm.category]) {
      acc[perm.category] = []
    }
    acc[perm.category].push(perm)
    return acc
  }, {} as Record<string, Permission[]>)

  if (!isAuthenticated || !currentEmployee) {
    return null
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-white border-b px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push('/employees')}
              className="text-gray-500 hover:text-gray-700"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h1 className="text-2xl font-bold">Roles & Permissions</h1>
          </div>
          <Button variant="primary" onClick={openAddModal}>
            + Add Role
          </Button>
        </div>
      </header>

      {/* Content */}
      <div className="p-6">
        {isLoading ? (
          <div className="text-center py-12 text-gray-500">Loading roles...</div>
        ) : roles.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            No roles found. Create your first role to get started.
          </div>
        ) : (
          <div className="space-y-4">
            {roles.map(role => (
              <Card key={role.id} className="p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-semibold text-lg">{role.name}</h3>
                    <p className="text-sm text-gray-500">
                      {role.employeeCount} employee{role.employeeCount !== 1 ? 's' : ''} assigned
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {role.permissions.includes('admin') || role.permissions.includes('super_admin') ? (
                        <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-xs font-medium">
                          {role.permissions.includes('super_admin') ? 'Super Admin' : 'Admin'} - All Permissions
                        </span>
                      ) : (
                        role.permissions.slice(0, 5).map(perm => (
                          <span
                            key={perm}
                            className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs"
                          >
                            {PERMISSION_LABELS[perm] || perm}
                          </span>
                        ))
                      )}
                      {role.permissions.length > 5 && !role.permissions.includes('admin') && (
                        <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">
                          +{role.permissions.length - 5} more
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => openEditModal(role)}>
                      Edit
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => handleDelete(role)}
                      disabled={role.employeeCount > 0}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* Quick Setup Tip */}
        <div className="mt-8 p-4 bg-blue-50 rounded-lg">
          <h4 className="font-medium text-blue-900">Quick Setup</h4>
          <p className="text-sm text-blue-700 mt-1">
            Common roles: <strong>Admin</strong> (full access), <strong>Manager</strong> (reports + voids),
            <strong> Server</strong> (orders + payments), <strong>Bartender</strong> (orders + tabs).
          </p>
        </div>
      </div>

      {/* Add/Edit Modal */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editingRole ? 'Edit Role' : 'Add Role'}
        size="lg"
      >
        <div className="space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
              {error}
            </div>
          )}

          {/* Role Name */}
          <div>
            <Label htmlFor="roleName">Role Name *</Label>
            <Input
              id="roleName"
              value={roleName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRoleName(e.target.value)}
              placeholder="e.g., Server, Manager, Admin"
              className="mt-1"
            />
          </div>

          {/* Quick Presets */}
          <div>
            <Label>Quick Presets</Label>
            <div className="flex gap-2 mt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedPermissions(['admin'])}
              >
                Admin
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedPermissions([
                  'orders.create', 'orders.void_item', 'orders.apply_discount', 'orders.transfer',
                  'payments.process', 'payments.refund', 'payments.open_drawer',
                  'menu.view', 'employees.view', 'reports.view', 'reports.sales',
                ])}
              >
                Manager
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedPermissions([
                  'orders.create', 'payments.process', 'menu.view',
                ])}
              >
                Server
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSelectedPermissions([
                  'orders.create', 'payments.process', 'menu.view', 'payments.open_drawer',
                ])}
              >
                Bartender
              </Button>
            </div>
          </div>

          {/* Permissions */}
          <div>
            <Label>Permissions</Label>
            <p className="text-xs text-gray-500 mb-2">
              Selected: {selectedPermissions.length} permission{selectedPermissions.length !== 1 ? 's' : ''}
            </p>

            <div className="max-h-64 overflow-y-auto border rounded-lg">
              {Object.entries(groupedPermissions).map(([category, perms]) => {
                const categoryLabel = PERMISSION_CATEGORIES[category as keyof typeof PERMISSION_CATEGORIES] || category
                const allSelected = perms.every(p => selectedPermissions.includes(p.value))

                return (
                  <div key={category} className="border-b last:border-0">
                    <button
                      type="button"
                      className="w-full px-3 py-2 bg-gray-50 text-left font-medium text-sm flex items-center justify-between hover:bg-gray-100"
                      onClick={() => selectAllInCategory(category)}
                    >
                      <span>{categoryLabel}</span>
                      <span className={`text-xs ${allSelected ? 'text-green-600' : 'text-gray-400'}`}>
                        {allSelected ? 'All selected' : 'Click to select all'}
                      </span>
                    </button>
                    <div className="p-2 space-y-1">
                      {perms.map(perm => (
                        <label
                          key={perm.value}
                          className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-50 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={selectedPermissions.includes(perm.value)}
                            onChange={() => togglePermission(perm.value)}
                            className="rounded"
                          />
                          <span className="text-sm">
                            {PERMISSION_LABELS[perm.value] || perm.value}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-4 border-t">
            <Button
              variant="ghost"
              className="flex-1"
              onClick={() => setShowModal(false)}
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
              {isSaving ? 'Saving...' : editingRole ? 'Save Changes' : 'Create Role'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
