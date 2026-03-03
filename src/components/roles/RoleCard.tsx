'use client'
import { Card } from '@/components/ui/card'
import { getPermissionMeta } from '@/lib/permission-registry'
import type { RoleType, AccessLevel } from '@/lib/auth-utils'

interface RoleCardRole {
  id: string
  name: string
  permissions: string[]
  isTipped: boolean
  cashHandlingMode: string
  trackLaborCost: boolean
  employeeCount: number
  roleType?: string    // FOH | BOH | ADMIN (may be absent on old roles)
  accessLevel?: string // STAFF | MANAGER | OWNER_ADMIN
}

interface RoleCardProps {
  role: RoleCardRole
  onEdit: () => void
  onDelete: () => void
}

function RoleTypeBadge({ type }: { type?: string }) {
  if (!type) return null
  const config = {
    FOH:   { label: 'FOH',   className: 'bg-blue-100 text-blue-700' },
    BOH:   { label: 'BOH',   className: 'bg-green-100 text-green-700' },
    ADMIN: { label: 'Admin', className: 'bg-purple-100 text-purple-700' },
  }
  const c = config[type as keyof typeof config]
  if (!c) return null
  return <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${c.className}`}>{c.label}</span>
}

function AccessLevelBadge({ level }: { level?: string }) {
  if (!level) return null
  const config = {
    STAFF:        { label: 'Staff',       className: 'bg-gray-100 text-gray-600' },
    MANAGER:      { label: 'Manager',     className: 'bg-amber-100 text-amber-700' },
    OWNER_ADMIN:  { label: 'Owner/Admin', className: 'bg-red-100 text-red-700' },
  }
  const c = config[level as keyof typeof config]
  if (!c) return null
  return <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${c.className}`}>{c.label}</span>
}

export function RoleCard({ role, onEdit, onDelete }: RoleCardProps) {
  const isAdmin = role.permissions.includes('admin') || role.permissions.includes('super_admin')

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0">
          {/* Name row */}
          <div className="flex items-center gap-1.5 flex-wrap mb-1">
            <h3 className="font-semibold text-base">{role.name}</h3>
            <RoleTypeBadge type={role.roleType} />
            <AccessLevelBadge level={role.accessLevel} />
            {isAdmin && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">
                {role.permissions.includes('super_admin') ? 'Super Admin' : 'Admin'}
              </span>
            )}
          </div>
          {/* Meta row */}
          <p className="text-sm text-gray-500 mb-1">
            {role.employeeCount} employee{role.employeeCount !== 1 ? 's' : ''}
          </p>
          {/* Badges row */}
          <div className="flex flex-wrap gap-1">
            <span className={`text-xs px-1.5 py-0.5 rounded ${
              role.cashHandlingMode === 'drawer' ? 'bg-green-100 text-green-700' :
              role.cashHandlingMode === 'purse'  ? 'bg-blue-100 text-blue-700' :
                                                    'bg-gray-100 text-gray-600'
            }`}>
              {role.cashHandlingMode === 'drawer' ? 'Drawer' : role.cashHandlingMode === 'purse' ? 'Purse' : 'No Cash'}
            </span>
            {role.isTipped && <span className="text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">Tipped</span>}
            {!role.trackLaborCost && <span className="text-xs px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">No Labor Cost</span>}
          </div>
        </div>
        {/* Action buttons */}
        <div className="flex gap-1 ml-2 flex-shrink-0">
          <button onClick={onEdit} className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          </button>
          <button
            onClick={onDelete}
            disabled={role.employeeCount > 0}
            className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded disabled:opacity-50 disabled:cursor-not-allowed"
            title={role.employeeCount > 0 ? `${role.employeeCount} employee(s) assigned — reassign first` : 'Delete role'}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>

      {/* Permission preview */}
      <div className="flex flex-wrap gap-1 mt-2">
        {role.permissions.slice(0, 4).map(perm => {
          const meta = getPermissionMeta(perm)
          return (
            <span key={perm} className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">
              {meta.label}
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
  )
}
