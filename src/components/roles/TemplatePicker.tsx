'use client'
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { DEFAULT_ROLES, ROLE_TEMPLATE_META } from '@/lib/auth-utils'
import type { RoleType, AccessLevel } from '@/lib/auth-utils'

interface TemplateDiff {
  templateName: string
  willAdd: string[]
  willRemove: string[]
  roleTypeChange: RoleType | null
  accessLevelChange: AccessLevel | null
}

interface TemplatePickerProps {
  currentPermissions: string[]
  currentRoleType: RoleType
  currentAccessLevel: AccessLevel
  onApply: (templateName: string, permissions: string[], roleType: RoleType, accessLevel: AccessLevel) => void
}

export function TemplatePicker({ currentPermissions, currentRoleType, currentAccessLevel, onApply }: TemplatePickerProps) {
  const [pendingDiff, setPendingDiff] = useState<TemplateDiff | null>(null)

  const handleSelect = (templateName: string) => {
    if (!templateName) return
    const template = DEFAULT_ROLES[templateName]
    const meta = ROLE_TEMPLATE_META[templateName]
    if (!template || !meta) return

    const willAdd = template.filter(p => !currentPermissions.includes(p))
    const willRemove = currentPermissions.filter(p => !template.includes(p))
    const roleTypeChange = meta.roleType !== currentRoleType ? meta.roleType : null
    const accessLevelChange = meta.accessLevel !== currentAccessLevel ? meta.accessLevel : null

    if (willAdd.length === 0 && willRemove.length === 0 && !roleTypeChange && !accessLevelChange) {
      // No diff — nothing to apply
      setPendingDiff(null)
      return
    }

    setPendingDiff({ templateName, willAdd, willRemove, roleTypeChange, accessLevelChange })
  }

  const handleApply = () => {
    if (!pendingDiff) return
    const template = DEFAULT_ROLES[pendingDiff.templateName]
    const meta = ROLE_TEMPLATE_META[pendingDiff.templateName]
    if (!template || !meta) return
    onApply(pendingDiff.templateName, template, meta.roleType, meta.accessLevel)
    setPendingDiff(null)
  }

  return (
    <div>
      <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">Apply Template</label>
      <select
        className="mt-1 w-full text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        defaultValue=""
        onChange={(e) => handleSelect(e.target.value)}
      >
        <option value="" disabled>Choose a template...</option>
        {Object.keys(DEFAULT_ROLES).map(name => (
          <option key={name} value={name}>{name}</option>
        ))}
      </select>

      {/* Diff preview banner */}
      <AnimatePresence>
        {pendingDiff && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            style={{ overflow: 'hidden' }}
          >
            <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm">
              <p className="font-medium text-blue-900 mb-1">Applying &ldquo;{pendingDiff.templateName}&rdquo; will:</p>
              <ul className="text-xs text-blue-700 space-y-0.5 mb-2">
                {pendingDiff.willAdd.length > 0 && <li>+ Add {pendingDiff.willAdd.length} permission{pendingDiff.willAdd.length !== 1 ? 's' : ''}</li>}
                {pendingDiff.willRemove.length > 0 && <li>− Remove {pendingDiff.willRemove.length} permission{pendingDiff.willRemove.length !== 1 ? 's' : ''}</li>}
                {pendingDiff.roleTypeChange && <li>→ Set Role Type to {pendingDiff.roleTypeChange}</li>}
                {pendingDiff.accessLevelChange && <li>→ Set Access Level to {pendingDiff.accessLevelChange.replace('_', ' ')}</li>}
              </ul>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleApply}
                  className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded hover:bg-blue-700"
                >
                  Apply Changes
                </button>
                <button
                  type="button"
                  onClick={() => setPendingDiff(null)}
                  className="px-3 py-1.5 text-gray-600 text-xs rounded hover:bg-gray-100"
                >
                  Cancel
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
