'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from '@/stores/toast-store'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { ToggleSwitch, ToggleRow, SettingsSaveBar } from '@/components/admin/settings'
import { useRequireAuth } from '@/hooks/useRequireAuth'
import { useUnsavedWarning } from '@/hooks/useUnsavedWarning'
import type { TipBankSettings, TipShareSettings } from '@/lib/settings'

// ────────────────────────────────────────────
// Template Types
// ────────────────────────────────────────────

interface TipGroupTemplate {
  id: string
  locationId: string
  name: string
  allowedRoleIds: string[]
  defaultSplitMode: 'equal' | 'hours_weighted' | 'role_weighted'
  active: boolean
}

interface RoleOption {
  id: string
  name: string
}

// ────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────

const BASIS_OPTIONS: { value: TipBankSettings['tipGuide']['basis']; label: string; description: string }[] = [
  { value: 'pre_discount', label: 'Pre-Discount', description: 'Tips calculated on subtotal before discounts/promos' },
  { value: 'gross_subtotal', label: 'Gross Subtotal', description: 'Tips calculated on subtotal after discounts' },
  { value: 'net_total', label: 'Net Total', description: 'Tips calculated on total including tax' },
  { value: 'custom', label: 'Custom', description: 'Tips calculated on custom rules (future)' },
]

const ROUND_TO_OPTIONS: { value: TipBankSettings['tipGuide']['roundTo']; label: string }[] = [
  { value: 'penny', label: 'Penny ($0.01)' },
  { value: 'nickel', label: 'Nickel ($0.05)' },
  { value: 'dime', label: 'Dime ($0.10)' },
  { value: 'quarter', label: 'Quarter ($0.25)' },
]

const ALLOCATION_OPTIONS: { value: TipBankSettings['allocationMode']; label: string; description: string }[] = [
  { value: 'ITEM_BASED', label: 'Item-Based', description: 'Tips allocated based on which employee rang in each item' },
  { value: 'CHECK_BASED', label: 'Check-Based', description: 'Tips allocated to the employee who owns the check' },
]

const ATTRIBUTION_TIMING_OPTIONS: { value: TipBankSettings['tipAttributionTiming']; label: string; description: string }[] = [
  { value: 'check_opened', label: 'When Check Opened', description: 'Credit goes to the group/employee active when the order was created' },
  { value: 'check_closed', label: 'When Check Closed', description: 'Credit goes to the group/employee active when payment is processed (recommended for bars)' },
  { value: 'check_both', label: 'Both (Proportional)', description: 'Split credit between the group at open-time and close-time (for late-night handoff scenarios)' },
]

const CHARGEBACK_OPTIONS: { value: TipBankSettings['chargebackPolicy']; label: string; description: string }[] = [
  { value: 'BUSINESS_ABSORBS', label: 'Business Absorbs', description: 'The business absorbs all chargeback costs -- tips already paid are not clawed back' },
  { value: 'EMPLOYEE_CHARGEBACK', label: 'Employee Chargeback', description: 'Chargeback amount is deducted from the employee\'s future tip bank balance' },
]

// ────────────────────────────────────────────
// Page Component
// ────────────────────────────────────────────

export default function TipSettingsPage() {
  const { employee } = useRequireAuth()
  const locationId = employee?.location?.id

  // Loading / dirty state
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isDirty, setIsDirty] = useState(false)

  // Settings state
  const [tipBank, setTipBank] = useState<TipBankSettings | null>(null)
  const [tipShares, setTipShares] = useState<TipShareSettings | null>(null)

  // New percentage input
  const [newPercent, setNewPercent] = useState('')

  // Template management state
  const [templates, setTemplates] = useState<TipGroupTemplate[]>([])
  const [roles, setRoles] = useState<RoleOption[]>([])
  const [templatesLoading, setTemplatesLoading] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<TipGroupTemplate | null>(null)
  const [showTemplateForm, setShowTemplateForm] = useState(false)
  const [templateForm, setTemplateForm] = useState<{
    name: string
    allowedRoleIds: string[]
    defaultSplitMode: 'equal' | 'hours_weighted' | 'role_weighted'
    active: boolean
  }>({ name: '', allowedRoleIds: [], defaultSplitMode: 'equal', active: true })
  const [templateSaving, setTemplateSaving] = useState(false)

  useUnsavedWarning(isDirty)

  // ──── Load settings ────
  const loadSettings = useCallback(async () => {
    if (!locationId) return
    try {
      setIsLoading(true)
      const res = await fetch(`/api/settings/tips?locationId=${locationId}&employeeId=${employee?.id ?? ''}`)
      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error || 'Failed to load tip settings')
        return
      }
      const data = await res.json()
      setTipBank(data.tipBank)
      setTipShares(data.tipShares)
    } catch {
      toast.error('Failed to load tip settings')
    } finally {
      setIsLoading(false)
    }
  }, [locationId, employee?.id])

  // ──── Load templates + roles ────
  const loadTemplates = useCallback(async () => {
    if (!locationId || !employee?.id) return
    setTemplatesLoading(true)
    try {
      const headers: Record<string, string> = { 'x-employee-id': employee.id }
      const [templatesRes, rolesRes] = await Promise.all([
        fetch(`/api/tips/group-templates?locationId=${locationId}&includeInactive=true`, { headers }),
        fetch(`/api/roles?locationId=${locationId}`, { headers }),
      ])
      if (templatesRes.ok) {
        const json = await templatesRes.json()
        setTemplates(json.data || [])
      }
      if (rolesRes.ok) {
        const json = await rolesRes.json()
        setRoles(json.roles || json.data || json || [])
      }
    } catch {
      // Silently fail — templates section just shows empty
    } finally {
      setTemplatesLoading(false)
    }
  }, [locationId, employee?.id])

  useEffect(() => {
    loadSettings()
    loadTemplates()
  }, [loadSettings, loadTemplates])

  // ──── Save settings ────
  const handleSave = async () => {
    if (!locationId || !tipBank || !tipShares) return
    try {
      setIsSaving(true)
      const res = await fetch('/api/settings/tips', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          employeeId: employee?.id,
          tipBank,
          tipShares,
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error || 'Failed to save tip settings')
        return
      }
      const data = await res.json()
      setTipBank(data.tipBank)
      setTipShares(data.tipShares)
      setIsDirty(false)
      toast.success('Tip settings saved')
    } catch {
      toast.error('Failed to save tip settings')
    } finally {
      setIsSaving(false)
    }
  }

  // ──── Updater helpers ────
  const updateTipBank = <K extends keyof TipBankSettings>(key: K, value: TipBankSettings[K]) => {
    setTipBank(prev => prev ? { ...prev, [key]: value } : prev)
    setIsDirty(true)
  }

  const updateTipGuide = <K extends keyof TipBankSettings['tipGuide']>(key: K, value: TipBankSettings['tipGuide'][K]) => {
    setTipBank(prev => prev ? { ...prev, tipGuide: { ...prev.tipGuide, [key]: value } } : prev)
    setIsDirty(true)
  }

  const updateTipShares = <K extends keyof TipShareSettings>(key: K, value: TipShareSettings[K]) => {
    setTipShares(prev => prev ? { ...prev, [key]: value } : prev)
    setIsDirty(true)
  }

  // ──── Percentage pill helpers ────
  const addPercentage = () => {
    const pct = parseFloat(newPercent)
    if (isNaN(pct) || pct <= 0 || pct > 100) {
      toast.warning('Enter a valid percentage between 1 and 100')
      return
    }
    if (tipBank?.tipGuide.percentages.includes(pct)) {
      toast.warning('This percentage already exists')
      return
    }
    const updated = [...(tipBank?.tipGuide.percentages ?? []), pct].sort((a, b) => a - b)
    updateTipGuide('percentages', updated)
    setNewPercent('')
  }

  const removePercentage = (pct: number) => {
    const updated = (tipBank?.tipGuide.percentages ?? []).filter(p => p !== pct)
    if (updated.length === 0) {
      toast.warning('At least one tip percentage is required')
      return
    }
    updateTipGuide('percentages', updated)
  }

  // ──── Template CRUD helpers ────
  const openNewTemplate = () => {
    setEditingTemplate(null)
    setTemplateForm({ name: '', allowedRoleIds: [], defaultSplitMode: 'equal', active: true })
    setShowTemplateForm(true)
  }

  const openEditTemplate = (t: TipGroupTemplate) => {
    setEditingTemplate(t)
    setTemplateForm({
      name: t.name,
      allowedRoleIds: [...t.allowedRoleIds],
      defaultSplitMode: t.defaultSplitMode,
      active: t.active,
    })
    setShowTemplateForm(true)
  }

  const handleSaveTemplate = async () => {
    if (!locationId) return
    if (!templateForm.name.trim()) {
      toast.warning('Template name is required')
      return
    }
    setTemplateSaving(true)
    try {
      const url = editingTemplate
        ? `/api/tips/group-templates/${editingTemplate.id}`
        : '/api/tips/group-templates'
      const method = editingTemplate ? 'PUT' : 'POST'
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locationId, ...templateForm }),
      })
      if (res.ok) {
        toast.success(editingTemplate ? 'Team updated' : 'Team created')
        setShowTemplateForm(false)
        setEditingTemplate(null)
        await loadTemplates()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to save team')
      }
    } catch {
      toast.error('Failed to save team')
    } finally {
      setTemplateSaving(false)
    }
  }

  const handleDeleteTemplate = async (id: string) => {
    if (!confirm('Delete this team template?')) return
    try {
      const res = await fetch(`/api/tips/group-templates/${id}`, { method: 'DELETE' })
      if (res.ok) {
        toast.success('Team deleted')
        await loadTemplates()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to delete team')
      }
    } catch {
      toast.error('Failed to delete team')
    }
  }

  const toggleTemplateRole = (roleId: string) => {
    setTemplateForm(prev => ({
      ...prev,
      allowedRoleIds: prev.allowedRoleIds.includes(roleId)
        ? prev.allowedRoleIds.filter(r => r !== roleId)
        : [...prev.allowedRoleIds, roleId],
    }))
  }

  const getRoleName = (roleId: string) => roles.find(r => r.id === roleId)?.name ?? roleId

  const SPLIT_MODE_OPTIONS: { value: TipGroupTemplate['defaultSplitMode']; label: string }[] = [
    { value: 'equal', label: 'Equal' },
    { value: 'hours_weighted', label: 'Hours Weighted' },
    { value: 'role_weighted', label: 'Role Weighted' },
  ]

  // ──── Loading state ────
  if (isLoading || !tipBank || !tipShares) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <AdminPageHeader
          title="Tip Settings"
          subtitle="Loading..."
          breadcrumbs={[{ label: 'Settings', href: '/settings' }]}
        />
        <div className="flex items-center justify-center py-20">
          <div className="text-gray-400 text-lg">Loading tip settings...</div>
        </div>
      </div>
    )
  }

  // ──── Render ────
  return (
    <div className="p-6 max-w-5xl mx-auto">
      <AdminPageHeader
        title="Tip Settings"
        subtitle="Configure tip calculations, tip bank, and tip share rules"
        breadcrumbs={[{ label: 'Settings', href: '/settings' }]}
        actions={
          <div className="flex items-center gap-3">
            {isDirty && (
              <span className="text-sm text-amber-600 font-medium">Unsaved changes</span>
            )}
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving || !isDirty}
              className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all ${
                isDirty
                  ? 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        }
      />

      <div className="max-w-3xl mx-auto space-y-6 pb-16">

        {/* ═══════════════════════════════════════════
            Section 1: Tip Guide Settings
            ═══════════════════════════════════════════ */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Tip Guide</h2>
          <p className="text-sm text-gray-500 mb-5">Control how suggested tip amounts are calculated on receipts and payment screens.</p>

          {/* Basis selector */}
          <label className="block text-sm font-medium text-gray-600 mb-2">Calculation Basis</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
            {BASIS_OPTIONS.map(opt => (
              <button
                type="button"
                key={opt.value}
                onClick={() => updateTipGuide('basis', opt.value)}
                className={`text-left p-3 rounded-xl border transition-all ${
                  tipBank.tipGuide.basis === opt.value
                    ? 'border-indigo-500 bg-indigo-500/20 ring-1 ring-indigo-500/40'
                    : 'border-gray-200 bg-gray-50 hover:bg-gray-100'
                }`}
              >
                <div className={`text-sm font-medium ${tipBank.tipGuide.basis === opt.value ? 'text-indigo-600' : 'text-gray-700'}`}>
                  {opt.label}
                </div>
                <div className="text-xs text-gray-400 mt-0.5">{opt.description}</div>
              </button>
            ))}
          </div>

          {/* Percentages */}
          <label className="block text-sm font-medium text-gray-600 mb-2">Suggested Percentages</label>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {tipBank.tipGuide.percentages.map(pct => (
              <span
                key={pct}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-indigo-500/20 border border-indigo-500/30 text-indigo-600 text-sm font-medium"
              >
                {pct}%
                <button
                  type="button"
                  onClick={() => removePercentage(pct)}
                  className="hover:text-red-400 transition-colors"
                  aria-label={`Remove ${pct}%`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </span>
            ))}

            {/* Add new percentage inline */}
            <div className="inline-flex items-center gap-1">
              <input
                type="number"
                min="1"
                max="100"
                step="1"
                value={newPercent}
                onChange={e => setNewPercent(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addPercentage()}
                placeholder="Add %"
                className="w-20 px-2 py-1.5 rounded-lg bg-gray-50 border border-gray-200 text-gray-900 text-sm placeholder-gray-400 focus:outline-none focus:border-indigo-500"
                aria-label="New tip percentage"
              />
              <button
                type="button"
                onClick={addPercentage}
                className="p-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white transition-colors"
                aria-label="Add percentage"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </button>
            </div>
          </div>

          {/* Show Basis Explanation toggle */}
          <div className="flex items-center justify-between py-3 border-t border-gray-100">
            <div>
              <div className="text-sm text-gray-700">Show Basis Explanation on Receipt</div>
              <div className="text-xs text-gray-400">Display text like &quot;(on $X pre-discount)&quot; next to tip suggestions</div>
            </div>
            <ToggleSwitch
              checked={tipBank.tipGuide.showBasisExplanation}
              onChange={v => updateTipGuide('showBasisExplanation', v)}
            />
          </div>

          {/* Round To selector */}
          <div className="pt-3 border-t border-gray-100">
            <label className="block text-sm font-medium text-gray-600 mb-2">Round Suggested Tips To</label>
            <div className="flex gap-2 flex-wrap">
              {ROUND_TO_OPTIONS.map(opt => (
                <button
                  type="button"
                  key={opt.value}
                  onClick={() => updateTipGuide('roundTo', opt.value)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    tipBank.tipGuide.roundTo === opt.value
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'bg-gray-50 border border-gray-200 text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════
            Section 2: Tip Bank Settings
            ═══════════════════════════════════════════ */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Tip Bank</h2>
          <p className="text-sm text-gray-500 mb-5">Manage how credit card tips are banked and allocated to employees.</p>

          {/* Enabled toggle */}
          <div className="flex items-center justify-between py-3">
            <div>
              <div className="text-sm text-gray-700">Enable Tip Bank</div>
              <div className="text-xs text-gray-400">Track and bank credit card tips for payroll distribution</div>
            </div>
            <ToggleSwitch
              checked={tipBank.enabled}
              onChange={v => updateTipBank('enabled', v)}
            />
          </div>

          {/* Allocation Mode */}
          <div className="pt-3 border-t border-gray-100">
            <label className="block text-sm font-medium text-gray-600 mb-2">Allocation Mode</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {ALLOCATION_OPTIONS.map(opt => (
                <button
                  type="button"
                  key={opt.value}
                  onClick={() => updateTipBank('allocationMode', opt.value)}
                  className={`text-left p-3 rounded-xl border transition-all ${
                    tipBank.allocationMode === opt.value
                      ? 'border-indigo-500 bg-indigo-500/20 ring-1 ring-indigo-500/40'
                      : 'border-gray-200 bg-gray-50 hover:bg-gray-100'
                  }`}
                >
                  <div className={`text-sm font-medium ${tipBank.allocationMode === opt.value ? 'text-indigo-600' : 'text-gray-700'}`}>
                    {opt.label}
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">{opt.description}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Toggles */}
          <div className="space-y-0 mt-4 border-t border-gray-100">
            <ToggleRow
              label="Pool Cash Tips"
              description="Include cash tips in the tip pool for redistribution"
              checked={tipBank.poolCashTips}
              onChange={v => updateTipBank('poolCashTips', v)}
            />
            <ToggleRow
              label="Allow Manager in Pools"
              description="Allow managers and supervisors to participate in tip pools"
              checked={tipBank.allowManagerInPools}
              onChange={v => updateTipBank('allowManagerInPools', v)}
              border
            />
            <ToggleRow
              label="Allow Negative Balances"
              description="Allow tip bank balances to go below zero (chargebacks may cause this)"
              checked={tipBank.allowNegativeBalances}
              onChange={v => updateTipBank('allowNegativeBalances', v)}
              border
            />
          </div>

          {/* Table Tip Ownership Mode */}
          <div className="pt-4 mt-4 border-t border-gray-100">
            <label className="block text-sm font-medium text-gray-600 mb-2">Table Tip Ownership</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => updateTipBank('tableTipOwnershipMode', 'ITEM_BASED')}
                className={`text-left p-3 rounded-xl border transition-all ${
                  tipBank.tableTipOwnershipMode === 'ITEM_BASED'
                    ? 'border-indigo-500 bg-indigo-500/20 ring-1 ring-indigo-500/40'
                    : 'border-gray-200 bg-gray-50 hover:bg-gray-100'
                }`}
              >
                <div className={`text-sm font-medium ${tipBank.tableTipOwnershipMode === 'ITEM_BASED' ? 'text-indigo-600' : 'text-gray-700'}`}>
                  Item-Based
                </div>
                <div className="text-xs text-gray-400 mt-0.5">Helpers earn per-item credit on server tables</div>
              </button>
              <button
                type="button"
                onClick={() => updateTipBank('tableTipOwnershipMode', 'PRIMARY_SERVER_OWNS_ALL')}
                className={`text-left p-3 rounded-xl border transition-all ${
                  tipBank.tableTipOwnershipMode === 'PRIMARY_SERVER_OWNS_ALL'
                    ? 'border-indigo-500 bg-indigo-500/20 ring-1 ring-indigo-500/40'
                    : 'border-gray-200 bg-gray-50 hover:bg-gray-100'
                }`}
              >
                <div className={`text-sm font-medium ${tipBank.tableTipOwnershipMode === 'PRIMARY_SERVER_OWNS_ALL' ? 'text-indigo-600' : 'text-gray-700'}`}>
                  Primary Server Owns All
                </div>
                <div className="text-xs text-gray-400 mt-0.5">100% of tip goes to primary server; helpers paid via tip-outs only</div>
              </button>
            </div>
          </div>

          {/* Standalone + Employee Groups toggles */}
          <div className="space-y-0 mt-4 border-t border-gray-100">
            <ToggleRow
              label="Allow Stand-Alone Servers"
              description="Employees can opt out of team pools at clock-in and keep their own tips"
              checked={tipBank.allowStandaloneServers}
              onChange={v => updateTipBank('allowStandaloneServers', v)}
            />
            <ToggleRow
              label="Allow Employee-Created Groups"
              description="Employees can create ad-hoc tip groups outside of admin-defined teams"
              checked={tipBank.allowEmployeeCreatedGroups}
              onChange={v => updateTipBank('allowEmployeeCreatedGroups', v)}
              border
            />
          </div>
        </section>

        {/* ═══════════════════════════════════════════
            Section 3: Chargeback Policy
            ═══════════════════════════════════════════ */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Chargeback Policy</h2>
          <p className="text-sm text-gray-500 mb-5">Determine who bears the cost when a chargeback occurs on a tipped transaction.</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {CHARGEBACK_OPTIONS.map(opt => (
              <button
                type="button"
                key={opt.value}
                onClick={() => updateTipBank('chargebackPolicy', opt.value)}
                className={`text-left p-4 rounded-xl border transition-all ${
                  tipBank.chargebackPolicy === opt.value
                    ? 'border-indigo-500 bg-indigo-500/20 ring-1 ring-indigo-500/40'
                    : 'border-gray-200 bg-gray-50 hover:bg-gray-100'
                }`}
              >
                <div className={`text-sm font-medium ${tipBank.chargebackPolicy === opt.value ? 'text-indigo-600' : 'text-gray-700'}`}>
                  {opt.label}
                </div>
                <div className="text-xs text-gray-400 mt-1">{opt.description}</div>
              </button>
            ))}
          </div>
        </section>

        {/* ═══════════════════════════════════════════
            Section 4: Tip Share Settings
            ═══════════════════════════════════════════ */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Tip Shares</h2>
          <p className="text-sm text-gray-500 mb-5">Control how tip-outs are distributed and reported.</p>

          {/* Payout Method */}
          <label className="block text-sm font-medium text-gray-600 mb-2">Payout Method</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            <button
              type="button"
              onClick={() => updateTipShares('payoutMethod', 'payroll')}
              className={`text-left p-3 rounded-xl border transition-all ${
                tipShares.payoutMethod === 'payroll'
                  ? 'border-indigo-500 bg-indigo-500/20 ring-1 ring-indigo-500/40'
                  : 'border-gray-200 bg-gray-50 hover:bg-gray-100'
              }`}
            >
              <div className={`text-sm font-medium ${tipShares.payoutMethod === 'payroll' ? 'text-indigo-600' : 'text-gray-700'}`}>
                Payroll
              </div>
              <div className="text-xs text-gray-400 mt-0.5">Tip shares automatically added to payroll</div>
            </button>
            <button
              type="button"
              onClick={() => updateTipShares('payoutMethod', 'manual')}
              className={`text-left p-3 rounded-xl border transition-all ${
                tipShares.payoutMethod === 'manual'
                  ? 'border-indigo-500 bg-indigo-500/20 ring-1 ring-indigo-500/40'
                  : 'border-gray-200 bg-gray-50 hover:bg-gray-100'
              }`}
            >
              <div className={`text-sm font-medium ${tipShares.payoutMethod === 'manual' ? 'text-indigo-600' : 'text-gray-700'}`}>
                Manual
              </div>
              <div className="text-xs text-gray-400 mt-0.5">Use the tip share report to mark paid manually</div>
            </button>
          </div>

          {/* Toggles */}
          <div className="space-y-0 border-t border-gray-100">
            <ToggleRow
              label="Auto Tip-Out Enabled"
              description="Automatically calculate role-based tip-outs at shift closeout"
              checked={tipShares.autoTipOutEnabled}
              onChange={v => updateTipShares('autoTipOutEnabled', v)}
            />
            <ToggleRow
              label="Require Tip-Out Acknowledgment"
              description="Server must review and acknowledge tip-out amounts before completing closeout"
              checked={tipShares.requireTipOutAcknowledgment}
              onChange={v => updateTipShares('requireTipOutAcknowledgment', v)}
              border
            />
            <ToggleRow
              label="Show Tip Shares on Receipt"
              description="Include tip share breakdown on the shift closeout receipt"
              checked={tipShares.showTipSharesOnReceipt}
              onChange={v => updateTipShares('showTipSharesOnReceipt', v)}
              border
            />
          </div>
        </section>

        {/* ═══════════════════════════════════════════
            Section 5: CC Fee Deduction
            ═══════════════════════════════════════════ */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">CC Fee Deduction</h2>
          <p className="text-sm text-gray-500 mb-5">Optionally deduct credit card processing fees from tips paid by card before crediting the employee.</p>

          <div className="space-y-4">
            {/* Toggle */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-gray-700">Deduct CC Fees from Tips</div>
                <div className="text-xs text-gray-400">When enabled, CC tips are reduced by the processing fee before going into the employee&apos;s tip bank</div>
              </div>
              <ToggleSwitch
                checked={tipBank.deductCCFeeFromTips}
                onChange={v => updateTipBank('deductCCFeeFromTips', v)}
              />
            </div>

            {/* Fee percent (only when enabled) */}
            {tipBank.deductCCFeeFromTips && (
              <div>
                <label className="block text-sm font-medium text-gray-600 mb-1">CC Processing Fee %</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="10"
                    value={tipBank.ccFeePercent}
                    onChange={e => updateTipBank('ccFeePercent', parseFloat(e.target.value) || 0)}
                    className="w-24 px-3 py-2 bg-gray-100 border border-gray-300 rounded-lg text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                  <span className="text-gray-500 text-sm">%</span>
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  Example: A $10.00 CC tip at {tipBank.ccFeePercent}% fee = ${(10 * (1 - tipBank.ccFeePercent / 100)).toFixed(2)} credited to employee
                </p>
              </div>
            )}
          </div>
        </section>

        {/* ═══════════════════════════════════════════
            Section 6: EOD Tip Payout
            ═══════════════════════════════════════════ */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">EOD Tip Payout</h2>
          <p className="text-sm text-gray-500 mb-5">Control how employees receive their tips when they close their shift.</p>

          <div className="space-y-4">
            {/* Allow cash out at EOD */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-gray-700">Allow Cash Out at Shift Close</div>
                <div className="text-xs text-gray-400">Employees can cash out their available tip bank balance when closing their shift</div>
              </div>
              <ToggleSwitch
                checked={tipBank.allowEODCashOut}
                onChange={v => updateTipBank('allowEODCashOut', v)}
              />
            </div>

            {/* Require manager approval */}
            {tipBank.allowEODCashOut && (
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-gray-700">Require Manager Approval</div>
                  <div className="text-xs text-gray-400">Manager must approve before cash is given to the employee</div>
                </div>
                <ToggleSwitch
                  checked={tipBank.requireManagerApprovalForCashOut}
                  onChange={v => updateTipBank('requireManagerApprovalForCashOut', v)}
                />
              </div>
            )}

            {/* Default payout method */}
            <div>
              <label className="block text-sm font-medium text-gray-600 mb-2">Default Payout Method</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => updateTipBank('defaultPayoutMethod', 'cash')}
                  className={`text-left p-4 rounded-xl border transition-all ${
                    tipBank.defaultPayoutMethod === 'cash'
                      ? 'border-green-500 bg-green-500/20 ring-1 ring-green-500/40'
                      : 'border-gray-200 bg-gray-50 hover:bg-gray-100'
                  }`}
                >
                  <div className={`text-sm font-medium ${tipBank.defaultPayoutMethod === 'cash' ? 'text-green-600' : 'text-gray-700'}`}>
                    Cash (Recommended)
                  </div>
                  <div className="text-xs text-gray-400 mt-1">Employee takes tips in cash at end of shift. Business doesn&apos;t hold onto tip money.</div>
                </button>
                <button
                  type="button"
                  onClick={() => updateTipBank('defaultPayoutMethod', 'payroll')}
                  className={`text-left p-4 rounded-xl border transition-all ${
                    tipBank.defaultPayoutMethod === 'payroll'
                      ? 'border-indigo-500 bg-indigo-500/20 ring-1 ring-indigo-500/40'
                      : 'border-gray-200 bg-gray-50 hover:bg-gray-100'
                  }`}
                >
                  <div className={`text-sm font-medium ${tipBank.defaultPayoutMethod === 'payroll' ? 'text-indigo-600' : 'text-gray-700'}`}>
                    Payroll
                  </div>
                  <div className="text-xs text-gray-400 mt-1">Tips accumulate in the tip bank and are paid out during the next payroll cycle.</div>
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════
            Section 7: Tip Group Attribution Timing
            ═══════════════════════════════════════════ */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Tip Group Attribution</h2>
          <p className="text-sm text-gray-500 mb-5">When a check is opened by one group and closed by another (e.g., shift handoff), which group gets credit for the tip?</p>

          <div className="grid grid-cols-1 gap-3">
            {ATTRIBUTION_TIMING_OPTIONS.map(opt => (
              <button
                type="button"
                key={opt.value}
                onClick={() => updateTipBank('tipAttributionTiming', opt.value)}
                className={`text-left p-4 rounded-xl border transition-all ${
                  tipBank.tipAttributionTiming === opt.value
                    ? 'border-indigo-500 bg-indigo-500/20 ring-1 ring-indigo-500/40'
                    : 'border-gray-200 bg-gray-50 hover:bg-gray-100'
                }`}
              >
                <div className={`text-sm font-medium ${tipBank.tipAttributionTiming === opt.value ? 'text-indigo-600' : 'text-gray-700'}`}>
                  {opt.label}
                </div>
                <div className="text-xs text-gray-400 mt-1">{opt.description}</div>
              </button>
            ))}
          </div>

          <div className="mt-4 p-3 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
            <p className="text-xs text-indigo-600/80">
              <span className="font-semibold">Note:</span> When using hours-weighted group splits, attribution timing has minimal impact because all group tips are pooled and divided by hours worked at the end of the night.
            </p>
          </div>
        </section>

        {/* ═══════════════════════════════════════════
            Section 8: Tip Group Teams (Templates)
            ═══════════════════════════════════════════ */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-lg font-semibold text-gray-900">Tip Group Teams</h2>
            <button
              type="button"
              onClick={openNewTemplate}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold transition-all"
            >
              Add Team
            </button>
          </div>
          <p className="text-sm text-gray-500 mb-5">Define team pools for tip sharing (e.g., Upstairs, Downstairs, Bar). Employees choose their team at clock-in.</p>

          {templatesLoading ? (
            <div className="text-gray-400 text-sm py-4 text-center">Loading teams...</div>
          ) : templates.length === 0 ? (
            <div className="text-gray-400 text-sm py-6 text-center border border-dashed border-gray-200 rounded-xl">
              No teams defined yet. Click &quot;Add Team&quot; to create one.
            </div>
          ) : (
            <div className="space-y-3">
              {templates.map(t => (
                <div
                  key={t.id}
                  className={`flex items-center justify-between p-4 rounded-xl border transition-all ${
                    t.active ? 'bg-white border-gray-200' : 'bg-gray-50 border-gray-100 opacity-60'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-semibold text-gray-900">{t.name}</span>
                      {!t.active && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-200 text-gray-500">Inactive</span>
                      )}
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-100 text-indigo-600">
                        {t.defaultSplitMode === 'equal' ? 'Equal' : t.defaultSplitMode === 'hours_weighted' ? 'Hours' : 'Role'}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {t.allowedRoleIds.length === 0 ? (
                        <span className="text-xs text-gray-400">All roles</span>
                      ) : (
                        t.allowedRoleIds.map(rid => (
                          <span key={rid} className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-blue-50 text-blue-600 border border-blue-100">
                            {getRoleName(rid)}
                          </span>
                        ))
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 ml-3 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => openEditTemplate(t)}
                      className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                      aria-label={`Edit ${t.name}`}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteTemplate(t.id)}
                      className="p-2 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                      aria-label={`Delete ${t.name}`}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Template Form Modal ────────────────────────────────────────── */}
        {showTemplateForm && (
          <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl border border-gray-200 p-6 max-w-md w-full max-h-[85vh] overflow-y-auto">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                {editingTemplate ? 'Edit Team' : 'New Team'}
              </h3>

              {/* Name */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-600 mb-1">Team Name</label>
                <input
                  type="text"
                  value={templateForm.name}
                  onChange={e => setTemplateForm(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="e.g., Upstairs, Bar Team"
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-900 text-sm placeholder-gray-400 focus:outline-none focus:border-indigo-500"
                  aria-label="Team name"
                />
              </div>

              {/* Split Mode */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-600 mb-2">Default Split Mode</label>
                <div className="flex gap-2">
                  {SPLIT_MODE_OPTIONS.map(opt => (
                    <button
                      type="button"
                      key={opt.value}
                      onClick={() => setTemplateForm(prev => ({ ...prev, defaultSplitMode: opt.value }))}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
                        templateForm.defaultSplitMode === opt.value
                          ? 'bg-indigo-600 text-white shadow-sm'
                          : 'bg-gray-50 border border-gray-200 text-gray-600 hover:bg-gray-100'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Allowed Roles */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-600 mb-2">
                  Allowed Roles
                  <span className="text-xs text-gray-400 font-normal ml-1">(leave empty for all roles)</span>
                </label>
                <div className="flex flex-wrap gap-2">
                  {roles.map(role => {
                    const selected = templateForm.allowedRoleIds.includes(role.id)
                    return (
                      <button
                        type="button"
                        key={role.id}
                        onClick={() => toggleTemplateRole(role.id)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${
                          selected
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                        }`}
                      >
                        {role.name}
                      </button>
                    )
                  })}
                  {roles.length === 0 && (
                    <span className="text-xs text-gray-400">Loading roles...</span>
                  )}
                </div>
              </div>

              {/* Active toggle */}
              <div className="flex items-center justify-between py-3 mb-4 border-t border-gray-100">
                <div>
                  <div className="text-sm text-gray-700">Active</div>
                  <div className="text-xs text-gray-400">Show this team as an option at clock-in</div>
                </div>
                <ToggleSwitch
                  checked={templateForm.active}
                  onChange={v => setTemplateForm(prev => ({ ...prev, active: v }))}
                />
              </div>

              {/* Actions */}
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => { setShowTemplateForm(false); setEditingTemplate(null) }}
                  className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-sm font-semibold transition-all"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveTemplate}
                  disabled={templateSaving}
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold transition-all disabled:opacity-50"
                >
                  {templateSaving ? 'Saving...' : editingTemplate ? 'Update Team' : 'Create Team'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Bottom save bar (sticky for long pages) */}
        <SettingsSaveBar isDirty={isDirty} isSaving={isSaving} onSave={handleSave} />
      </div>
    </div>
  )
}
