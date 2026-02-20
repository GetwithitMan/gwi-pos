'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal } from '@/components/ui/modal'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { PERMISSION_GROUPS, DEFAULT_ROLES, hasPermission } from '@/lib/auth-utils'
import { toast } from '@/stores/toast-store'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { useAdminCRUD } from '@/hooks/useAdminCRUD'

interface Role {
  id: string
  name: string
  permissions: string[]
  isTipped: boolean
  cashHandlingMode: string
  trackLaborCost: boolean
  employeeCount: number
  createdAt: string
}

export default function RolesPage() {
  const currentEmployee = useAuthStore(s => s.employee)
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/roles' })

  const crud = useAdminCRUD<Role>({
    apiBase: '/api/roles',
    locationId: currentEmployee?.location?.id,
    resourceName: 'role',
    parseResponse: (data) => data.roles || [],
  })

  const { items: roles, isLoading, showModal, editingItem: editingRole, isSaving, modalError, loadItems, closeModal, handleSave: crudSave, handleDelete: crudDelete } = crud

  // Form state
  const [roleName, setRoleName] = useState('')
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([])
  const [cashHandlingMode, setCashHandlingMode] = useState<string>('drawer')
  const [trackLaborCost, setTrackLaborCost] = useState(true)
  const [isTipped, setIsTipped] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState<string[]>(Object.keys(PERMISSION_GROUPS))

  useEffect(() => {
    if (currentEmployee?.location?.id) {
      loadItems()
    }
  }, [currentEmployee?.location?.id, loadItems])

  const openAddModal = () => {
    setRoleName('')
    setSelectedPermissions([])
    setCashHandlingMode('drawer')
    setTrackLaborCost(true)
    setIsTipped(false)
    setExpandedGroups(Object.keys(PERMISSION_GROUPS))
    crud.openAddModal()
  }

  const openEditModal = (role: Role) => {
    setRoleName(role.name)
    setSelectedPermissions(role.permissions)
    setCashHandlingMode(role.cashHandlingMode || 'drawer')
    setTrackLaborCost(role.trackLaborCost !== false)
    setIsTipped(role.isTipped || false)
    setExpandedGroups(Object.keys(PERMISSION_GROUPS))
    crud.openEditModal(role)
  }

  const togglePermission = (permission: string) => {
    if (selectedPermissions.includes(permission)) {
      setSelectedPermissions(selectedPermissions.filter(p => p !== permission))
    } else {
      setSelectedPermissions([...selectedPermissions, permission])
    }
  }

  const toggleGroup = (groupName: string) => {
    if (expandedGroups.includes(groupName)) {
      setExpandedGroups(expandedGroups.filter(g => g !== groupName))
    } else {
      setExpandedGroups([...expandedGroups, groupName])
    }
  }

  const selectAllInGroup = (groupName: string) => {
    const group = PERMISSION_GROUPS[groupName as keyof typeof PERMISSION_GROUPS]
    if (!group) return

    const groupPerms = group.permissions.map(p => p.key)
    const allSelected = groupPerms.every(p => selectedPermissions.includes(p))

    if (allSelected) {
      setSelectedPermissions(selectedPermissions.filter(p => !groupPerms.includes(p)))
    } else {
      const newPerms = [...selectedPermissions]
      groupPerms.forEach(p => {
        if (!newPerms.includes(p)) newPerms.push(p)
      })
      setSelectedPermissions(newPerms)
    }
  }

  const applyRoleTemplate = (templateName: string) => {
    const template = DEFAULT_ROLES[templateName]
    if (template) {
      setSelectedPermissions([...template])
      if (!roleName) {
        setRoleName(templateName)
      }
    }
  }

  const handleSave = async () => {
    if (!roleName.trim()) {
      crud.setModalError('Role name is required')
      return
    }

    const payload: Record<string, unknown> = {
      name: roleName.trim(),
      permissions: selectedPermissions,
      cashHandlingMode,
      trackLaborCost,
      isTipped,
    }

    // Add locationId only for new roles
    if (!editingRole) {
      payload.locationId = currentEmployee?.location?.id
    }

    await crudSave(payload)
  }

  const handleDelete = async (role: Role) => {
    if (role.employeeCount > 0) {
      toast.warning(`Cannot delete "${role.name}" - ${role.employeeCount} employee(s) have this role. Reassign them first.`)
      return
    }
    await crudDelete(role.id, `Are you sure you want to delete the "${role.name}" role?`)
  }

  // Get permission count for a role
  const getPermissionSummary = (permissions: string[]): string => {
    if (permissions.includes('super_admin') || permissions.includes('*')) {
      return 'Super Admin - Full Access'
    }
    if (permissions.includes('admin')) {
      return 'Admin - Full Access'
    }

    // Count by category
    const counts: Record<string, number> = {}
    for (const perm of permissions) {
      const category = perm.split('.')[0]
      counts[category] = (counts[category] || 0) + 1
    }

    const summary = Object.entries(counts)
      .map(([cat, count]) => `${cat}: ${count}`)
      .slice(0, 3)
      .join(', ')

    return permissions.length > 0 ? `${permissions.length} permissions (${summary})` : 'No permissions'
  }

  if (!hydrated || !currentEmployee) {
    return null
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Roles & Permissions"
        subtitle="Manage employee access levels"
        actions={
          <Button variant="primary" onClick={openAddModal}>
            + Add Role
          </Button>
        }
      />

      {/* Content */}
      <div className="mt-6">
        {isLoading ? (
          <div className="text-center py-12 text-gray-500">Loading roles...</div>
        ) : roles.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-gray-400 mb-4">
              <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            </div>
            <p className="text-gray-500 mb-4">No roles found. Create your first role to get started.</p>
            <Button variant="primary" onClick={openAddModal}>Create First Role</Button>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {roles.map(role => (
              <Card key={role.id} className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-lg flex items-center gap-2">
                      {role.name}
                      {(role.permissions.includes('admin') || role.permissions.includes('super_admin')) && (
                        <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded text-xs">
                          {role.permissions.includes('super_admin') ? 'Super' : 'Admin'}
                        </span>
                      )}
                    </h3>
                    <p className="text-sm text-gray-500">
                      {role.employeeCount} employee{role.employeeCount !== 1 ? 's' : ''}
                    </p>
                    <div className="flex flex-wrap gap-1 mt-1">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                        role.cashHandlingMode === 'drawer' ? 'bg-green-100 text-green-700' :
                        role.cashHandlingMode === 'purse' ? 'bg-blue-100 text-blue-700' :
                        'bg-gray-100 text-gray-600'
                      }`}>
                        {role.cashHandlingMode === 'drawer' ? 'Drawer' : role.cashHandlingMode === 'purse' ? 'Purse' : 'No Cash'}
                      </span>
                      {role.isTipped && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">Tipped</span>
                      )}
                      {!role.trackLaborCost && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">No Labor Cost</span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => openEditModal(role)}
                      className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDelete(role)}
                      disabled={role.employeeCount > 0}
                      className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>

                <p className="text-sm text-gray-600 mb-3">
                  {getPermissionSummary(role.permissions)}
                </p>

                {/* Permission badges - show first few */}
                <div className="flex flex-wrap gap-1">
                  {role.permissions.slice(0, 4).map(perm => {
                    // Find the permission label
                    let label = perm
                    for (const group of Object.values(PERMISSION_GROUPS)) {
                      const found = group.permissions.find(p => p.key === perm)
                      if (found) {
                        label = found.label
                        break
                      }
                    }
                    return (
                      <span
                        key={perm}
                        className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs"
                      >
                        {label}
                      </span>
                    )
                  })}
                  {role.permissions.length > 4 && (
                    <span className="px-2 py-0.5 bg-gray-100 text-gray-500 rounded text-xs">
                      +{role.permissions.length - 4} more
                    </span>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}

        {/* Role Templates Info */}
        <div className="mt-8 p-4 bg-blue-50 rounded-lg">
          <h4 className="font-medium text-blue-900">Role Templates</h4>
          <p className="text-sm text-blue-700 mt-1">
            Quick templates available: <strong>Server</strong>, <strong>Bartender</strong>, <strong>Manager</strong>, <strong>Admin</strong>, <strong>Owner</strong>
          </p>
        </div>
      </div>

      {/* Add/Edit Modal */}
      <Modal
        isOpen={showModal}
        onClose={closeModal}
        title={editingRole ? 'Edit Role' : 'Create New Role'}
        size="lg"
      >
        <div className="space-y-4">
          {modalError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
              {modalError}
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

          {/* Role Templates */}
          <div>
            <Label>Apply Template</Label>
            <div className="flex flex-wrap gap-2 mt-1">
              {Object.keys(DEFAULT_ROLES).map(templateName => (
                <Button
                  key={templateName}
                  variant="outline"
                  size="sm"
                  onClick={() => applyRoleTemplate(templateName)}
                >
                  {templateName}
                </Button>
              ))}
            </div>
          </div>

          {/* Cash Handling & Labor Settings */}
          <div className="space-y-3 p-3 bg-gray-50 rounded-lg">
            <div>
              <Label>Cash Handling Mode</Label>
              <div className="flex gap-2 mt-1">
                {[
                  { value: 'drawer', label: 'Drawer', desc: 'Uses a physical cash drawer' },
                  { value: 'purse', label: 'Purse', desc: 'Carries cash on person' },
                  { value: 'none', label: 'None', desc: 'Does not handle cash' },
                ].map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setCashHandlingMode(opt.value)}
                    className={`flex-1 p-2 rounded-lg border-2 text-center text-sm transition-all ${
                      cashHandlingMode === opt.value
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="font-medium">{opt.label}</div>
                    <div className="text-xs text-gray-500">{opt.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isTipped}
                  onChange={(e) => setIsTipped(e.target.checked)}
                  className="rounded border-gray-300"
                />
                <div>
                  <span className="text-sm font-medium">Tipped Role</span>
                  <p className="text-xs text-gray-500">Eligible for tip-out rules</p>
                </div>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={trackLaborCost}
                  onChange={(e) => setTrackLaborCost(e.target.checked)}
                  className="rounded border-gray-300"
                />
                <div>
                  <span className="text-sm font-medium">Track Labor Cost</span>
                  <p className="text-xs text-gray-500">Include hours in labor reports</p>
                </div>
              </label>
            </div>
          </div>

          {/* Permissions by Group */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Permissions</Label>
              <span className="text-xs text-gray-500">
                {selectedPermissions.length} selected
              </span>
            </div>

            <div className="max-h-96 overflow-y-auto border rounded-lg divide-y">
              {Object.entries(PERMISSION_GROUPS).map(([groupName, group]) => {
                const groupPerms = group.permissions.map(p => p.key)
                const selectedCount = groupPerms.filter(p => selectedPermissions.includes(p)).length
                const allSelected = selectedCount === groupPerms.length
                const someSelected = selectedCount > 0 && selectedCount < groupPerms.length
                const isExpanded = expandedGroups.includes(groupName)

                return (
                  <div key={groupName}>
                    {/* Group Header */}
                    <div
                      className="px-3 py-2 bg-gray-50 flex items-center justify-between cursor-pointer hover:bg-gray-100"
                      onClick={() => toggleGroup(groupName)}
                    >
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            selectAllInGroup(groupName)
                          }}
                          className={`w-4 h-4 rounded border flex items-center justify-center ${
                            allSelected
                              ? 'bg-blue-600 border-blue-600'
                              : someSelected
                              ? 'bg-blue-600 border-blue-600'
                              : 'border-gray-300'
                          }`}
                        >
                          {allSelected && (
                            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                          {someSelected && !allSelected && (
                            <div className="w-2 h-0.5 bg-white" />
                          )}
                        </button>
                        <div>
                          <span className="font-medium text-sm">{groupName}</span>
                          <span className="ml-2 text-xs text-gray-500">
                            ({selectedCount}/{groupPerms.length})
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400">{group.description}</span>
                        <svg
                          className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </div>

                    {/* Group Permissions */}
                    {isExpanded && (
                      <div className="p-2 space-y-1 bg-white">
                        {group.permissions.map(perm => (
                          <label
                            key={perm.key}
                            className="flex items-start gap-3 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer group"
                          >
                            <input
                              type="checkbox"
                              checked={selectedPermissions.includes(perm.key)}
                              onChange={() => togglePermission(perm.key)}
                              className="mt-0.5 rounded border-gray-300"
                            />
                            <div className="flex-1 min-w-0">
                              <span className="text-sm font-medium block">{perm.label}</span>
                              <span className="text-xs text-gray-500">{perm.description}</span>
                            </div>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Admin Shortcut */}
          <div className="p-3 bg-purple-50 rounded-lg">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={selectedPermissions.includes('admin')}
                onChange={() => {
                  if (selectedPermissions.includes('admin')) {
                    setSelectedPermissions(selectedPermissions.filter(p => p !== 'admin'))
                  } else {
                    setSelectedPermissions(['admin'])
                  }
                }}
                className="rounded border-purple-300"
              />
              <div>
                <span className="font-medium text-purple-900">Administrator Access</span>
                <p className="text-xs text-purple-700">Grant full access to all features</p>
              </div>
            </label>
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
              {isSaving ? 'Saving...' : editingRole ? 'Save Changes' : 'Create Role'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
