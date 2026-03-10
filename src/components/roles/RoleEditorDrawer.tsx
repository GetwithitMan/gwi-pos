'use client'

import { useState, useEffect, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SegmentedControl } from './SegmentedControl'
import { PermissionSection } from './PermissionSection'
import { TemplatePicker } from './TemplatePicker'
import { EffectiveAccessPreview } from './EffectiveAccessPreview'
import { getVisiblePermissionKeys, getKeysByTab, PermissionTab, logRegistryCoverage } from '@/lib/permission-registry'
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
  onBack: () => void
  onSave: (payload: Record<string, unknown>) => Promise<boolean>
  roleToEdit: RoleEditorRole | null
  isCreating: boolean
  isSaving: boolean
  modalError: string | null
  locationId?: string
}

// All permission keys from PERMISSION_GROUPS (stable across renders)
const allPermissionKeys = Object.values(PERMISSION_GROUPS)
  .flatMap(g => g.permissions.map((p: { key: string }) => p.key))

export function RoleEditorDrawer({
  onBack,
  onSave,
  roleToEdit,
  isCreating,
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

  // Fast Refresh fix: run coverage check on mount only
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      logRegistryCoverage(allPermissionKeys)
    }
  }, [])

  // Reset form state when the role being edited changes
  useEffect(() => {
    if (roleToEdit) {
      setRoleName(roleToEdit.name)
      setRoleType((roleToEdit.roleType as RoleType) ?? 'FOH')
      setAccessLevel((roleToEdit.accessLevel as AccessLevel) ?? 'STAFF')
      setSelectedPermissions(roleToEdit.permissions)
      setCashHandlingMode(roleToEdit.cashHandlingMode ?? 'drawer')
      setIsTipped(roleToEdit.isTipped ?? false)
      setTrackLaborCost(roleToEdit.trackLaborCost !== false)
      setShowAdvanced(roleToEdit.roleType === 'ADMIN' || roleToEdit.accessLevel === 'OWNER_ADMIN')
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
  }, [roleToEdit])

  // Filtering
  const visibleKeys = useMemo(
    () => getVisiblePermissionKeys(roleType, accessLevel, showAdvanced, allPermissionKeys),
    [roleType, accessLevel, showAdvanced]
  )

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

    if (isCreating) {
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
    <div className="min-h-screen bg-white flex flex-col">
      {/* Sticky top bar */}
      <div className="sticky top-0 z-10 h-14 border-b border-gray-200 bg-white flex items-center justify-between px-6 flex-shrink-0">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 font-medium"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          All Roles
        </button>
        <span className="text-sm font-medium text-gray-900">
          {isCreating ? 'New Role' : `Editing: ${roleName || 'Edit Role'}`}
        </span>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onBack} disabled={isSaving}>Cancel</Button>
          <Button variant="primary" onClick={handleSave} disabled={isSaving}>
            {isSaving ? 'Saving...' : isCreating ? 'Create Role' : 'Save Changes'}
          </Button>
        </div>
      </div>

      {/* Error banner */}
      {(localError || modalError) && (
        <div className="px-6 py-2 bg-red-50 border-b border-red-200 text-sm text-red-700">
          {localError || modalError}
        </div>
      )}

      {/* 2-column body */}
      <div className="flex flex-1">
        {/* LEFT SIDEBAR */}
        <div
          className="w-80 flex-shrink-0 border-r border-gray-200 overflow-y-auto"
          style={{ position: 'sticky', top: '3.5rem', maxHeight: 'calc(100vh - 3.5rem)', alignSelf: 'flex-start' }}
        >
          <div className="p-5 space-y-4">
            {/* Role Name */}
            <div>
              <label className="text-sm font-medium text-gray-900 block mb-1">Role Name *</label>
              <Input
                value={roleName}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setRoleName(e.target.value); setLocalError(null) }}
                placeholder="e.g., Server, Bartender, Host"
              />
            </div>

            {/* Role Type */}
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

            {/* Access Level */}
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

            {/* Template picker */}
            <TemplatePicker
              currentPermissions={selectedPermissions}
              currentRoleType={roleType}
              currentAccessLevel={accessLevel}
              onApply={handleApplyTemplate}
            />

            <hr className="border-gray-200" />

            {/* Cash Handling */}
            <div>
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
                    <div className="text-xs text-gray-900">{opt.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Tipped + Track Labor */}
            <div className="space-y-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={isTipped} onChange={e => setIsTipped(e.target.checked)} className="rounded border-gray-300" />
                <div>
                  <span className="text-sm font-medium">Tipped Role</span>
                  <p className="text-xs text-gray-900">Eligible for tip-out rules</p>
                </div>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={trackLaborCost} onChange={e => setTrackLaborCost(e.target.checked)} className="rounded border-gray-300" />
                <div>
                  <span className="text-sm font-medium">Track Labor Cost</span>
                  <p className="text-xs text-gray-900">Include hours in labor reports</p>
                </div>
              </label>
            </div>

            <hr className="border-gray-200" />

            {/* Effective Access Preview */}
            <EffectiveAccessPreview permissions={selectedPermissions} />

            {roleToEdit && roleToEdit.employeeCount > 0 && (
              <p className="text-xs text-gray-900 text-center">
                {roleToEdit.employeeCount} employee{roleToEdit.employeeCount !== 1 ? 's' : ''} use this role
              </p>
            )}
          </div>
        </div>

        {/* RIGHT MAIN */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-6">
            {/* Advanced toggle */}
            <div className="flex items-center mb-4">
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

            {/* Hidden permissions banner */}
            {hiddenSelectedCount > 0 && (
              <div className="mb-4 p-2.5 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700 flex items-center gap-2">
                <span>{'\u2139\uFE0F'}</span>
                {hiddenSelectedCount} selected permission{hiddenSelectedCount !== 1 ? 's are' : ' is'} outside the current filter and will still be saved. Toggle &quot;Show all&quot; to view them.
              </div>
            )}

            {/* Tab bar */}
            <div className="border-b border-gray-200 mb-6">
              <div className="flex">
                {tabs.map(tab => {
                  const tabKeys = getKeysByTab(tab.key, visibleKeys)
                  const selectedInTab = tabKeys.filter(k => selectedPermissions.includes(k)).length
                  return (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setActiveTab(tab.key)}
                      className={`py-3 px-4 text-sm font-medium border-b-2 transition-colors ${
                        activeTab === tab.key
                          ? tab.color === 'red'
                            ? 'border-red-500 text-red-600'
                            : tab.color === 'purple'
                            ? 'border-purple-500 text-purple-600'
                            : tab.color === 'green'
                            ? 'border-green-500 text-green-600'
                            : 'border-blue-500 text-blue-600'
                          : 'border-transparent text-gray-900 hover:text-gray-900'
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

            {/* Permission section — full width, no cramping */}
            <PermissionSection
              tab={activeTab}
              visiblePermissionKeys={visibleKeys}
              selectedPermissions={selectedPermissions}
              onToggle={handleToggle}
              onToggleGroup={handleToggleGroup}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
