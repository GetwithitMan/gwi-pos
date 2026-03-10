'use client'
import { useState } from 'react'
import { getPermissionMeta, PermissionTab, PermissionMeta } from '@/lib/permission-registry'
import { PERMISSION_GROUPS } from '@/lib/auth-utils'
import { PermissionInfoPanel } from './PermissionInfoPanel'

interface PermissionSectionProps {
  tab: PermissionTab
  visiblePermissionKeys: string[]   // Keys to show (already filtered by role type + access level + advanced)
  selectedPermissions: string[]
  onToggle: (key: string) => void
  onToggleGroup: (keys: string[]) => void
  // Called when an advanced toggle causes hidden perms to become selected:
  hiddenSelectedCount?: number
}

const TAB_LABELS: Record<PermissionTab, string> = {
  SHIFT_SERVICE: 'Shift & Service',
  TEAM_TIME: 'Team & Time',
  REPORTING: 'Reporting',
  BUSINESS_SETUP: 'Business Setup',
}

type GroupEntry = {
  name: string
  description: string
  permissions: { key: string; label: string; description: string }[]
}

export function PermissionSection({
  tab,
  visiblePermissionKeys,
  selectedPermissions,
  onToggle,
  onToggleGroup,
  hiddenSelectedCount,
}: PermissionSectionProps) {
  const [expandedInfoKey, setExpandedInfoKey] = useState<string | null>(null)
  const [criticalConfirmKey, setCriticalConfirmKey] = useState<string | null>(null)
  const [criticalUnderstood, setCriticalUnderstood] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState<string[]>([]) // all collapsed by default

  // Build groups by mapping visiblePermissionKeys through PERMISSION_GROUPS
  const groups: GroupEntry[] = []
  for (const [groupName, group] of Object.entries(PERMISSION_GROUPS)) {
    const visiblePerms = group.permissions.filter(p => visiblePermissionKeys.includes(p.key))
    if (visiblePerms.length > 0) {
      // Only include groups that have permissions belonging to this tab
      const tabPerms = visiblePerms.filter(p => getPermissionMeta(p.key).tab === tab)
      if (tabPerms.length > 0) {
        groups.push({
          name: groupName,
          description: group.description,
          permissions: tabPerms,
        })
      }
    }
  }

  const toggleGroupExpand = (groupName: string) => {
    setExpandedGroups(prev =>
      prev.includes(groupName)
        ? prev.filter(g => g !== groupName)
        : [...prev, groupName]
    )
  }

  const handleToggle = (key: string, meta: PermissionMeta) => {
    const isChecked = selectedPermissions.includes(key)

    if (isChecked) {
      // Unchecking — always immediate, no confirm needed
      setCriticalConfirmKey(null)
      setCriticalUnderstood(false)
      onToggle(key)
    } else {
      // Enabling
      if (meta.risk === 'CRITICAL') {
        // Intercept — show confirm instead
        setCriticalConfirmKey(key)
        setCriticalUnderstood(false)
      } else {
        onToggle(key)
      }
    }
  }

  const confirmCritical = (key: string) => {
    onToggle(key)
    setCriticalConfirmKey(null)
    setCriticalUnderstood(false)
  }

  const handleInfoToggle = (key: string) => {
    setExpandedInfoKey(prev => prev === key ? null : key)
    // Clear critical confirm if clicking elsewhere
    if (criticalConfirmKey && criticalConfirmKey !== key) {
      setCriticalConfirmKey(null)
      setCriticalUnderstood(false)
    }
  }

  if (groups.length === 0) {
    return (
      <div className="p-6 text-center text-gray-900 text-sm">
        No permissions available for this tab.
      </div>
    )
  }

  return (
    <div>
      {/* Danger zone warning for BUSINESS_SETUP */}
      {tab === 'BUSINESS_SETUP' && (
        <div className="mx-4 mt-3 p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
          <span className="text-red-500 text-lg">&#9888;&#65039;</span>
          <div>
            <p className="text-sm font-medium text-red-800">Danger Zone — Business Setup</p>
            <p className="text-xs text-red-600">These permissions affect business-wide configuration. Changes apply to all locations and all employees.</p>
          </div>
        </div>
      )}

      {/* Hidden selected count banner */}
      {hiddenSelectedCount != null && hiddenSelectedCount > 0 && (
        <div className="mx-4 mt-3 p-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
          {hiddenSelectedCount} selected permission{hiddenSelectedCount !== 1 ? 's are' : ' is'} hidden by current filters.
          They remain active — toggle &quot;Show Advanced&quot; to see them.
        </div>
      )}

      {/* Groups */}
      <div className="mt-2">
        {groups.map((group) => {
          const isExpanded = expandedGroups.includes(group.name)
          const groupKeys = group.permissions.map(p => p.key)
          const selectedCount = groupKeys.filter(k => selectedPermissions.includes(k)).length
          const totalCount = groupKeys.length
          const allSelected = selectedCount === totalCount
          const someSelected = selectedCount > 0 && selectedCount < totalCount

          return (
            <div key={group.name} className="border-b border-gray-100 last:border-b-0">
              {/* Group header */}
              <div
                className="px-3 py-2 bg-gray-50 flex items-center justify-between cursor-pointer hover:bg-gray-100 select-none"
                onClick={() => toggleGroupExpand(group.name)}
              >
                <div className="flex items-center gap-3">
                  {/* Select-all checkbox (indeterminate style) */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      const nonCriticalKeys = groupKeys.filter(k => getPermissionMeta(k).risk !== 'CRITICAL')
                      onToggleGroup(nonCriticalKeys)
                    }}
                    className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                      allSelected
                        ? 'bg-blue-600 border-blue-600'
                        : someSelected
                          ? 'bg-blue-600 border-blue-600'
                          : 'border-gray-300 bg-white'
                    }`}
                  >
                    {allSelected && (
                      <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                    {someSelected && (
                      <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 12h14" />
                      </svg>
                    )}
                  </button>
                  <div>
                    <span className="font-medium text-sm">{group.name}</span>
                    <span className="ml-2 text-xs text-gray-900">({selectedCount}/{totalCount})</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-900 hidden sm:block">{group.description}</span>
                  <svg
                    className={`w-4 h-4 text-gray-900 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </div>

              {/* Expanded permissions */}
              {isExpanded && (
                <div className="py-1">
                  {group.permissions
                    .filter(p => visiblePermissionKeys.includes(p.key))
                    .map(perm => {
                      const meta = getPermissionMeta(perm.key)
                      const isChecked = selectedPermissions.includes(perm.key)
                      const isInfoOpen = expandedInfoKey === perm.key
                      const isCriticalPending = criticalConfirmKey === perm.key

                      return (
                        <div key={perm.key}>
                          {/* Main row */}
                          <label className="flex items-center gap-3 px-3 py-2 rounded hover:bg-gray-50 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => handleToggle(perm.key, meta)}
                              className="rounded border-gray-300 text-blue-600"
                            />
                            <span className="flex-1 text-sm font-medium text-gray-800">{meta.label}</span>
                            {/* (i) button */}
                            <button
                              type="button"
                              onClick={(e) => { e.preventDefault(); handleInfoToggle(perm.key) }}
                              className={`p-1 rounded transition-colors ${isInfoOpen ? 'text-blue-500 bg-blue-50' : 'text-gray-900 hover:text-gray-600 hover:bg-gray-100'}`}
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                            </button>
                          </label>

                          {/* HIGH warning — shown when CHECKED + HIGH risk */}
                          {meta.risk === 'HIGH' && isChecked && (
                            <div className="mx-3 mb-1 px-3 py-1.5 bg-orange-50 border border-orange-200 rounded text-xs text-orange-700 flex items-center gap-1.5">
                              <span>&#9888;&#65039;</span>
                              Elevated access — only assign to trusted employees
                            </div>
                          )}

                          {/* CRITICAL confirm block — shown when trying to enable */}
                          {isCriticalPending && (
                            <div className="mx-3 mb-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                              <p className="text-sm font-medium text-red-800 mb-1">This grants business-wide access</p>
                              <p className="text-xs text-red-600 mb-2">{meta.description}</p>
                              <label className="flex items-center gap-2 text-sm text-red-700 mb-3 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={criticalUnderstood}
                                  onChange={(e) => setCriticalUnderstood(e.target.checked)}
                                  className="rounded border-red-300"
                                />
                                I understand this changes business-wide configuration
                              </label>
                              <div className="flex gap-2">
                                <button
                                  type="button"
                                  disabled={!criticalUnderstood}
                                  onClick={() => confirmCritical(perm.key)}
                                  className="px-3 py-1.5 bg-red-600 text-white text-xs rounded disabled:opacity-40 hover:bg-red-700 disabled:cursor-not-allowed"
                                >
                                  Grant Access
                                </button>
                                <button
                                  type="button"
                                  onClick={() => { setCriticalConfirmKey(null); setCriticalUnderstood(false) }}
                                  className="px-3 py-1.5 text-gray-600 text-xs rounded hover:bg-gray-100"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Info panel */}
                          <PermissionInfoPanel meta={meta} isOpen={isInfoOpen} />
                        </div>
                      )
                    })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
