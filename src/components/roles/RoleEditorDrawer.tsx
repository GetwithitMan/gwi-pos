'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SegmentedControl } from './SegmentedControl'
import { PermissionSection } from './PermissionSection'
import { TemplatePicker } from './TemplatePicker'
import { getVisiblePermissionKeys, getKeysByTab, PermissionTab } from '@/lib/permission-registry'
import { PERMISSION_GROUPS, RoleType, AccessLevel } from '@/lib/auth-utils'

export interface RoleEditorRole {
  id: string
  name: string
  permissions: string[]
  isTipped: boolean
  cashHandlingMode: string
  trackLaborCost: boolean
  employeeCount: number
  roleType?: string
  accessLevel?: string
}

interface RoleEditorDrawerProps {
  isOpen: boolean
  onClose: () => void
  editingRole: RoleEditorRole | null
  onSave: (payload: Record<string, unknown>) => Promise<boolean>
  isSaving: boolean
  modalError: string | null
  locationId?: string
}

// All permission keys from PERMISSION_GROUPS (stable across renders)
const allPermissionKeys = Object.values(PERMISSION_GROUPS)
  .flatMap(g => g.permissions.map((p: { key: string }) => p.key))

export function RoleEditorDrawer({
  isOpen,
  onClose,
  editingRole,
  onSave,
  isSaving,
  modalError,
  locationId,
}: RoleEditorDrawerProps) {
  const [roleName, setRoleName] = useState('')
  const [roleType, setRoleType] = useState<RoleType>('FOH')
  const [accessLevel, setAccessLevel] = useState<AccessLevel>('STAFF')
  const [selectedPermissions, setSelectedPermissions] = useState<string[]>([])
  const [cashHandlingMode, setCashHandlingMode] = useState('drawer')
  const [isTipped, setIsTipped] = useState(false)
  const [trackLaborCost, setTrackLaborCost] = useState(true)
  const [activeTab, setActiveTab] = useState<PermissionTab>('SHIFT_SERVICE')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  // Reset form state when drawer opens/closes or editing role changes
  useEffect(() => {
    if (!isOpen) return
    if (editingRole) {
      setRoleName(editingRole.name)
      setRoleType((editingRole.roleType as RoleType) ?? 'FOH')
      setAccessLevel((editingRole.accessLevel as AccessLevel) ?? 'STAFF')
      setSelectedPermissions(editingRole.permissions)
      setCashHandlingMode(editingRole.cashHandlingMode ?? 'drawer')
      setIsTipped(editingRole.isTipped ?? false)
      setTrackLaborCost(editingRole.trackLaborCost !== false)
      setShowAdvanced(editingRole.roleType === 'ADMIN' || editingRole.accessLevel === 'OWNER_ADMIN')
    } else {
      setRoleName('')
      setRoleType('FOH')
      setAccessLevel('STAFF')
      setSelectedPermissions([])
      setCashHandlingMode('drawer')
      setIsTipped(false)
      setTrackLaborCost(true)
      setShowAdvanced(false)
    }
    setActiveTab('SHIFT_SERVICE')
    setLocalError(null)
  }, [isOpen, editingRole])

  // Filtering
  const visibleKeys = getVisiblePermissionKeys(roleType, accessLevel, showAdvanced, allPermissionKeys)

  const hiddenSelectedCount = selectedPermissions.filter(
    p => !visibleKeys.includes(p) && p !== 'admin' && p !== 'super_admin'
  ).length

  // Handlers
  const handleToggle = (key: string) => {
    setSelectedPermissions(prev =>
      prev.includes(key) ? prev.filter(p => p !== key) : [...prev, key]
    )
  }

  const handleToggleGroup = (keys: string[]) => {
    const allSelected = keys.every(k => selectedPermissions.includes(k))
    if (allSelected) {
      setSelectedPermissions(prev => prev.filter(p => !keys.includes(p)))
    } else {
      setSelectedPermissions(prev => {
        const next = [...prev]
        keys.forEach(k => { if (!next.includes(k)) next.push(k) })
        return next
      })
    }
  }

  const handleApplyTemplate = (
    _name: string,
    permissions: string[],
    newRoleType: RoleType,
    newAccessLevel: AccessLevel,
  ) => {
    setSelectedPermissions(permissions)
    setRoleType(newRoleType)
    setAccessLevel(newAccessLevel)
    setShowAdvanced(newAccessLevel === 'OWNER_ADMIN')
  }

  const handleSave = async () => {
    if (!roleName.trim()) {
      setLocalError('Role name is required')
      return
    }
    setLocalError(null)

    const payload: Record<string, unknown> = {
      name: roleName.trim(),
      permissions: selectedPermissions,
      cashHandlingMode,
      trackLaborCost,
      isTipped,
      roleType,
      accessLevel,
    }

    if (!editingRole) {
      payload.locationId = locationId
    }

    await onSave(payload)
  }

  const tabs = [
    { key: 'SHIFT_SERVICE' as const, label: 'Shift & Service', color: 'blue' },
    { key: 'TEAM_TIME' as const, label: 'Team & Time', color: 'green' },
    { key: 'REPORTING' as const, label: 'Reporting', color: 'purple' },
    { key: 'BUSINESS_SETUP' as const, label: '\u26A0\uFE0F Business Setup', color: 'red' },
  ]

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Drawer panel */}
          <motion.div
            key="drawer"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed right-0 top-0 h-full w-full max-w-3xl bg-white shadow-2xl z-50 flex flex-col"
          >
            {/* Fixed Header */}
            <div className="flex-shrink-0 border-b border-gray-200 bg-white px-6 pt-5 pb-4">
              {/* Close + title row */}
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-gray-900">
                  {editingRole ? 'Edit Role' : 'Create New Role'}
                </h2>
                <button onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Error banner */}
              {(localError || modalError) && (
                <div className="mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                  {localError || modalError}
                </div>
              )}

              {/* Role Name */}
              <div className="mb-4">
                <label className="text-sm font-medium text-gray-700 block mb-1">Role Name *</label>
                <Input
                  value={roleName}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setRoleName(e.target.value); setLocalError(null) }}
                  placeholder="e.g., Server, Bartender, Host"
                />
              </div>

              {/* Role Type + Access Level — 2-column */}
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="text-xs font-medium text-gray-600 uppercase tracking-wide block mb-1">Role Type</label>
                  <SegmentedControl<RoleType>
                    options={[
                      { value: 'FOH', label: 'Front of House', color: 'blue' },
                      { value: 'BOH', label: 'Back of House', color: 'green' },
                      { value: 'ADMIN', label: 'Admin', color: 'purple' },
                    ]}
                    value={roleType}
                    onChange={(v) => {
                      setRoleType(v)
                      if (v === 'ADMIN') setShowAdvanced(true)
                    }}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 uppercase tracking-wide block mb-1">Access Level</label>
                  <SegmentedControl<AccessLevel>
                    options={[
                      { value: 'STAFF', label: 'Staff' },
                      { value: 'MANAGER', label: 'Manager' },
                      { value: 'OWNER_ADMIN', label: 'Owner/Admin' },
                    ]}
                    value={accessLevel}
                    onChange={(v) => {
                      setAccessLevel(v)
                      if (v === 'OWNER_ADMIN') setShowAdvanced(true)
                    }}
                  />
                </div>
              </div>

              {/* Template picker */}
              <TemplatePicker
                currentPermissions={selectedPermissions}
                currentRoleType={roleType}
                currentAccessLevel={accessLevel}
                onApply={handleApplyTemplate}
              />
            </div>

            {/* Tab navigation */}
            <div className="flex-shrink-0 border-b border-gray-200 bg-white">
              <div className="flex">
                {tabs.map(tab => {
                  const tabKeys = getKeysByTab(tab.key, visibleKeys)
                  const selectedInTab = tabKeys.filter(k => selectedPermissions.includes(k)).length
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setActiveTab(tab.key)}
                      className={`flex-1 py-3 px-2 text-sm font-medium border-b-2 transition-colors ${
                        activeTab === tab.key
                          ? tab.color === 'red'
                            ? 'border-red-500 text-red-600'
                            : tab.color === 'purple'
                            ? 'border-purple-500 text-purple-600'
                            : tab.color === 'green'
                            ? 'border-green-500 text-green-600'
                            : 'border-blue-500 text-blue-600'
                          : 'border-transparent text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      <span>{tab.label}</span>
                      {selectedInTab > 0 && (
                        <span className="ml-1 text-xs bg-gray-100 text-gray-600 rounded-full px-1.5">{selectedInTab}</span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Scrollable permission body */}
            <div className="flex-1 overflow-y-auto">
              {/* Hidden permissions banner */}
              {hiddenSelectedCount > 0 && (
                <div className="mx-4 mt-3 p-2.5 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700 flex items-center gap-2">
                  <span>{'\u2139\uFE0F'}</span>
                  {hiddenSelectedCount} selected permission{hiddenSelectedCount !== 1 ? 's are' : ' is'} outside the current filter and will still be saved. Toggle &quot;Show all&quot; to view them.
                </div>
              )}

              <PermissionSection
                tab={activeTab}
                visiblePermissionKeys={visibleKeys}
                selectedPermissions={selectedPermissions}
                onToggle={handleToggle}
                onToggleGroup={handleToggleGroup}
              />
            </div>

            {/* Fixed Footer */}
            <div className="flex-shrink-0 border-t border-gray-200 bg-white px-6 py-4">
              {/* Advanced toggle */}
              <div className="flex items-center justify-between mb-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showAdvanced}
                    onChange={(e) => setShowAdvanced(e.target.checked)}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm text-gray-600">
                    {accessLevel === 'OWNER_ADMIN'
                      ? 'Show all permissions'
                      : accessLevel === 'MANAGER'
                      ? 'Show advanced permissions'
                      : 'Show advanced permissions (not recommended for this access level)'}
                  </span>
                </label>
              </div>

              {/* Cash handling */}
              <div className="mb-4">
                <label className="text-xs font-medium text-gray-600 uppercase tracking-wide block mb-1.5">Cash Handling</label>
                <div className="flex gap-2">
                  {[
                    { value: 'drawer', label: 'Drawer', desc: 'Uses cash drawer' },
                    { value: 'purse', label: 'Purse', desc: 'Carries cash on person' },
                    { value: 'none', label: 'None', desc: 'No cash handling' },
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
                      <div className="font-medium text-sm">{opt.label}</div>
                      <div className="text-xs text-gray-500">{opt.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Tipped + Track Labor checkboxes */}
              <div className="flex items-center gap-6 mb-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={isTipped} onChange={e => setIsTipped(e.target.checked)} className="rounded border-gray-300" />
                  <div>
                    <span className="text-sm font-medium">Tipped Role</span>
                    <p className="text-xs text-gray-500">Eligible for tip-out rules</p>
                  </div>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={trackLaborCost} onChange={e => setTrackLaborCost(e.target.checked)} className="rounded border-gray-300" />
                  <div>
                    <span className="text-sm font-medium">Track Labor Cost</span>
                    <p className="text-xs text-gray-500">Include hours in labor reports</p>
                  </div>
                </label>
              </div>

              {/* Save / Cancel */}
              <div className="flex gap-3">
                <Button variant="ghost" className="flex-1" onClick={onClose} disabled={isSaving}>Cancel</Button>
                <Button variant="primary" className="flex-1" onClick={handleSave} disabled={isSaving}>
                  {isSaving ? 'Saving...' : editingRole ? 'Save Changes' : 'Create Role'}
                </Button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
