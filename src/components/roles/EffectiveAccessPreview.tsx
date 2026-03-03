'use client'

interface EffectiveAccessPreviewProps {
  permissions: string[]
}

function deriveShiftService(perms: string[]): { label: string; positive: boolean } {
  if (perms.includes('admin') || perms.includes('super_admin')) return { label: 'Full access', positive: true }
  if (perms.includes('pos.access') && perms.includes('pos.table_service')) return { label: 'Can take orders', positive: true }
  if (perms.includes('pos.access')) return { label: 'POS access (limited)', positive: true }
  if (perms.includes('pos.kds')) return { label: 'Kitchen display only', positive: true }
  return { label: 'No POS access', positive: false }
}

function deriveTeamTime(perms: string[]): { label: string; positive: boolean } {
  if (perms.includes('admin') || perms.includes('super_admin')) return { label: 'Full team control', positive: true }
  if (perms.includes('staff.manage_roles')) return { label: 'Manages staff and roles', positive: true }
  if (perms.includes('manager.edit_time_entries') || perms.includes('manager.force_clock_out')) return { label: 'Can manage time punches', positive: true }
  if (perms.includes('staff.clock_others')) return { label: 'Can clock others in/out', positive: true }
  if (perms.includes('staff.view')) return { label: 'View employees only', positive: false }
  return { label: 'No team access', positive: false }
}

function deriveReporting(perms: string[]): { label: string; positive: boolean } {
  if (perms.includes('admin') || perms.includes('super_admin') || perms.includes('reports.sales') || perms.includes('reports.labor')) return { label: 'Business reports', positive: true }
  if (perms.includes('manager.shift_review') || perms.includes('reports.view')) return { label: 'Shift reports', positive: true }
  if (perms.includes('tips.view_own') || perms.includes('reports.commission')) return { label: 'My tips only', positive: true }
  return { label: 'No report access', positive: false }
}

function deriveBusinessSetup(perms: string[]): { label: string; positive: boolean } {
  const hasSettings = perms.some(p => p.startsWith('settings.')) ||
                      perms.includes('admin') ||
                      perms.includes('super_admin')
  return hasSettings
    ? { label: 'Has access (Danger Zone)', positive: true }
    : { label: 'No access', positive: false }
}

function derivePayments(perms: string[]): { label: string; positive: boolean } {
  if (perms.includes('admin') || perms.includes('super_admin')) return { label: 'Full payment access', positive: true }
  const canCash = perms.includes('pos.accept_cash')
  const canCard = perms.includes('pos.accept_card')
  if (canCash && canCard) return { label: 'Cash & card', positive: true }
  if (canCard) return { label: 'Card only', positive: true }
  if (canCash) return { label: 'Cash only', positive: true }
  return { label: 'No payment access', positive: false }
}

function deriveOverrides(perms: string[]): { label: string; positive: boolean } {
  if (perms.includes('admin') || perms.includes('super_admin')) return { label: 'All overrides', positive: true }
  const canDiscount = perms.includes('manager.discounts')
  const canVoid = perms.includes('manager.void_items') || perms.includes('manager.void_payments')
  if (canDiscount && canVoid) return { label: 'Discounts & voids', positive: true }
  if (canDiscount) return { label: 'Discounts only', positive: true }
  if (canVoid) return { label: 'Voids only', positive: true }
  return { label: 'No override access', positive: false }
}

export function EffectiveAccessPreview({ permissions }: EffectiveAccessPreviewProps) {
  const rows = [
    { icon: '🍽️', label: 'Shift & Service', result: deriveShiftService(permissions) },
    { icon: '👥', label: 'Team & Time',      result: deriveTeamTime(permissions) },
    { icon: '📊', label: 'Reporting',        result: deriveReporting(permissions) },
    { icon: '⚙️', label: 'Business Setup',   result: deriveBusinessSetup(permissions) },
    { icon: '💳', label: 'Payments',       result: derivePayments(permissions) },
    { icon: '🔓', label: 'Overrides',      result: deriveOverrides(permissions) },
  ]

  return (
    <div className="mt-2 p-3 bg-gray-50 rounded-lg border border-gray-100">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">What this role can access</p>
      <div className="space-y-1.5">
        {rows.map(({ icon, label, result }) => (
          <div key={label} className="flex items-center justify-between text-sm">
            <span className="text-gray-600 flex items-center gap-1.5">
              <span>{icon}</span>
              {label}
            </span>
            <span className={`text-xs font-medium ${result.positive ? 'text-green-600' : 'text-gray-400'}`}>
              {result.positive ? '✓' : '✗'} {result.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
