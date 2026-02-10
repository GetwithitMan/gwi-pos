'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from '@/stores/toast-store'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { AdminSubNav, settingsSubNav } from '@/components/admin/AdminSubNav'
import type { TipBankSettings, TipShareSettings } from '@/lib/settings'

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
  const router = useRouter()
  const { employee, isAuthenticated } = useAuthStore()
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

  // ──── Auth redirect ────
  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login')
    }
  }, [isAuthenticated, router])

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

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

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

  // ──── Loading state ────
  if (isLoading || !tipBank || !tipShares) {
    return (
      <div className="min-h-screen bg-gray-50 p-6">
        <AdminPageHeader
          title="Tip Settings"
          subtitle="Loading..."
          breadcrumbs={[{ label: 'Settings', href: '/settings' }]}
        />
        <AdminSubNav items={settingsSubNav} basePath="/settings" />
        <div className="flex items-center justify-center py-24">
          <div className="text-gray-400 text-lg">Loading tip settings...</div>
        </div>
      </div>
    )
  }

  // ──── Render ────
  return (
    <div className="min-h-screen bg-gray-50 p-6">
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
      <AdminSubNav items={settingsSubNav} basePath="/settings" />

      <div className="max-w-3xl mx-auto space-y-6 pb-16">

        {/* ═══════════════════════════════════════════
            Section 1: Tip Guide Settings
            ═══════════════════════════════════════════ */}
        <section className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl p-6">
          <h2 className="text-lg font-semibold text-white mb-1">Tip Guide</h2>
          <p className="text-sm text-white/50 mb-5">Control how suggested tip amounts are calculated on receipts and payment screens.</p>

          {/* Basis selector */}
          <label className="block text-sm font-medium text-white/70 mb-2">Calculation Basis</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
            {BASIS_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => updateTipGuide('basis', opt.value)}
                className={`text-left p-3 rounded-xl border transition-all ${
                  tipBank.tipGuide.basis === opt.value
                    ? 'border-indigo-500 bg-indigo-500/20 ring-1 ring-indigo-500/40'
                    : 'border-white/10 bg-white/5 hover:bg-white/10'
                }`}
              >
                <div className={`text-sm font-medium ${tipBank.tipGuide.basis === opt.value ? 'text-indigo-300' : 'text-white/80'}`}>
                  {opt.label}
                </div>
                <div className="text-xs text-white/40 mt-0.5">{opt.description}</div>
              </button>
            ))}
          </div>

          {/* Percentages */}
          <label className="block text-sm font-medium text-white/70 mb-2">Suggested Percentages</label>
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {tipBank.tipGuide.percentages.map(pct => (
              <span
                key={pct}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 text-sm font-medium"
              >
                {pct}%
                <button
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
                className="w-20 px-2 py-1.5 rounded-lg bg-white/5 border border-white/10 text-white text-sm placeholder-white/30 focus:outline-none focus:border-indigo-500"
                aria-label="New tip percentage"
              />
              <button
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
          <div className="flex items-center justify-between py-3 border-t border-white/5">
            <div>
              <div className="text-sm text-white/80">Show Basis Explanation on Receipt</div>
              <div className="text-xs text-white/40">Display text like &quot;(on $X pre-discount)&quot; next to tip suggestions</div>
            </div>
            <ToggleSwitch
              checked={tipBank.tipGuide.showBasisExplanation}
              onChange={v => updateTipGuide('showBasisExplanation', v)}
            />
          </div>

          {/* Round To selector */}
          <div className="pt-3 border-t border-white/5">
            <label className="block text-sm font-medium text-white/70 mb-2">Round Suggested Tips To</label>
            <div className="flex gap-2 flex-wrap">
              {ROUND_TO_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => updateTipGuide('roundTo', opt.value)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    tipBank.tipGuide.roundTo === opt.value
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'bg-white/5 border border-white/10 text-white/60 hover:bg-white/10'
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
        <section className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl p-6">
          <h2 className="text-lg font-semibold text-white mb-1">Tip Bank</h2>
          <p className="text-sm text-white/50 mb-5">Manage how credit card tips are banked and allocated to employees.</p>

          {/* Enabled toggle */}
          <div className="flex items-center justify-between py-3">
            <div>
              <div className="text-sm text-white/80">Enable Tip Bank</div>
              <div className="text-xs text-white/40">Track and bank credit card tips for payroll distribution</div>
            </div>
            <ToggleSwitch
              checked={tipBank.enabled}
              onChange={v => updateTipBank('enabled', v)}
            />
          </div>

          {/* Allocation Mode */}
          <div className="pt-3 border-t border-white/5">
            <label className="block text-sm font-medium text-white/70 mb-2">Allocation Mode</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {ALLOCATION_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => updateTipBank('allocationMode', opt.value)}
                  className={`text-left p-3 rounded-xl border transition-all ${
                    tipBank.allocationMode === opt.value
                      ? 'border-indigo-500 bg-indigo-500/20 ring-1 ring-indigo-500/40'
                      : 'border-white/10 bg-white/5 hover:bg-white/10'
                  }`}
                >
                  <div className={`text-sm font-medium ${tipBank.allocationMode === opt.value ? 'text-indigo-300' : 'text-white/80'}`}>
                    {opt.label}
                  </div>
                  <div className="text-xs text-white/40 mt-0.5">{opt.description}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Toggles */}
          <div className="space-y-0 mt-4 border-t border-white/5">
            <div className="flex items-center justify-between py-3 border-b border-white/5">
              <div>
                <div className="text-sm text-white/80">Pool Cash Tips</div>
                <div className="text-xs text-white/40">Include cash tips in the tip pool for redistribution</div>
              </div>
              <ToggleSwitch
                checked={tipBank.poolCashTips}
                onChange={v => updateTipBank('poolCashTips', v)}
              />
            </div>

            <div className="flex items-center justify-between py-3 border-b border-white/5">
              <div>
                <div className="text-sm text-white/80">Allow Manager in Pools</div>
                <div className="text-xs text-white/40">Allow managers and supervisors to participate in tip pools</div>
              </div>
              <ToggleSwitch
                checked={tipBank.allowManagerInPools}
                onChange={v => updateTipBank('allowManagerInPools', v)}
              />
            </div>

            <div className="flex items-center justify-between py-3">
              <div>
                <div className="text-sm text-white/80">Allow Negative Balances</div>
                <div className="text-xs text-white/40">Allow tip bank balances to go below zero (chargebacks may cause this)</div>
              </div>
              <ToggleSwitch
                checked={tipBank.allowNegativeBalances}
                onChange={v => updateTipBank('allowNegativeBalances', v)}
              />
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════
            Section 3: Chargeback Policy
            ═══════════════════════════════════════════ */}
        <section className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl p-6">
          <h2 className="text-lg font-semibold text-white mb-1">Chargeback Policy</h2>
          <p className="text-sm text-white/50 mb-5">Determine who bears the cost when a chargeback occurs on a tipped transaction.</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {CHARGEBACK_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => updateTipBank('chargebackPolicy', opt.value)}
                className={`text-left p-4 rounded-xl border transition-all ${
                  tipBank.chargebackPolicy === opt.value
                    ? 'border-indigo-500 bg-indigo-500/20 ring-1 ring-indigo-500/40'
                    : 'border-white/10 bg-white/5 hover:bg-white/10'
                }`}
              >
                <div className={`text-sm font-medium ${tipBank.chargebackPolicy === opt.value ? 'text-indigo-300' : 'text-white/80'}`}>
                  {opt.label}
                </div>
                <div className="text-xs text-white/40 mt-1">{opt.description}</div>
              </button>
            ))}
          </div>
        </section>

        {/* ═══════════════════════════════════════════
            Section 4: Tip Share Settings
            ═══════════════════════════════════════════ */}
        <section className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl p-6">
          <h2 className="text-lg font-semibold text-white mb-1">Tip Shares</h2>
          <p className="text-sm text-white/50 mb-5">Control how tip-outs are distributed and reported.</p>

          {/* Payout Method */}
          <label className="block text-sm font-medium text-white/70 mb-2">Payout Method</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            <button
              onClick={() => updateTipShares('payoutMethod', 'payroll')}
              className={`text-left p-3 rounded-xl border transition-all ${
                tipShares.payoutMethod === 'payroll'
                  ? 'border-indigo-500 bg-indigo-500/20 ring-1 ring-indigo-500/40'
                  : 'border-white/10 bg-white/5 hover:bg-white/10'
              }`}
            >
              <div className={`text-sm font-medium ${tipShares.payoutMethod === 'payroll' ? 'text-indigo-300' : 'text-white/80'}`}>
                Payroll
              </div>
              <div className="text-xs text-white/40 mt-0.5">Tip shares automatically added to payroll</div>
            </button>
            <button
              onClick={() => updateTipShares('payoutMethod', 'manual')}
              className={`text-left p-3 rounded-xl border transition-all ${
                tipShares.payoutMethod === 'manual'
                  ? 'border-indigo-500 bg-indigo-500/20 ring-1 ring-indigo-500/40'
                  : 'border-white/10 bg-white/5 hover:bg-white/10'
              }`}
            >
              <div className={`text-sm font-medium ${tipShares.payoutMethod === 'manual' ? 'text-indigo-300' : 'text-white/80'}`}>
                Manual
              </div>
              <div className="text-xs text-white/40 mt-0.5">Use the tip share report to mark paid manually</div>
            </button>
          </div>

          {/* Toggles */}
          <div className="space-y-0 border-t border-white/5">
            <div className="flex items-center justify-between py-3 border-b border-white/5">
              <div>
                <div className="text-sm text-white/80">Auto Tip-Out Enabled</div>
                <div className="text-xs text-white/40">Automatically calculate role-based tip-outs at shift closeout</div>
              </div>
              <ToggleSwitch
                checked={tipShares.autoTipOutEnabled}
                onChange={v => updateTipShares('autoTipOutEnabled', v)}
              />
            </div>

            <div className="flex items-center justify-between py-3 border-b border-white/5">
              <div>
                <div className="text-sm text-white/80">Require Tip-Out Acknowledgment</div>
                <div className="text-xs text-white/40">Server must review and acknowledge tip-out amounts before completing closeout</div>
              </div>
              <ToggleSwitch
                checked={tipShares.requireTipOutAcknowledgment}
                onChange={v => updateTipShares('requireTipOutAcknowledgment', v)}
              />
            </div>

            <div className="flex items-center justify-between py-3">
              <div>
                <div className="text-sm text-white/80">Show Tip Shares on Receipt</div>
                <div className="text-xs text-white/40">Include tip share breakdown on the shift closeout receipt</div>
              </div>
              <ToggleSwitch
                checked={tipShares.showTipSharesOnReceipt}
                onChange={v => updateTipShares('showTipSharesOnReceipt', v)}
              />
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════
            Section 5: CC Fee Deduction
            ═══════════════════════════════════════════ */}
        <section className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl p-6">
          <h2 className="text-lg font-semibold text-white mb-1">CC Fee Deduction</h2>
          <p className="text-sm text-white/50 mb-5">Optionally deduct credit card processing fees from tips paid by card before crediting the employee.</p>

          <div className="space-y-4">
            {/* Toggle */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-white/80">Deduct CC Fees from Tips</div>
                <div className="text-xs text-white/40">When enabled, CC tips are reduced by the processing fee before going into the employee&apos;s tip bank</div>
              </div>
              <ToggleSwitch
                checked={tipBank.deductCCFeeFromTips}
                onChange={v => updateTipBank('deductCCFeeFromTips', v)}
              />
            </div>

            {/* Fee percent (only when enabled) */}
            {tipBank.deductCCFeeFromTips && (
              <div>
                <label className="block text-sm font-medium text-white/70 mb-1">CC Processing Fee %</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="10"
                    value={tipBank.ccFeePercent}
                    onChange={e => updateTipBank('ccFeePercent', parseFloat(e.target.value) || 0)}
                    className="w-24 px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                  <span className="text-white/50 text-sm">%</span>
                </div>
                <p className="text-xs text-white/30 mt-1">
                  Example: A $10.00 CC tip at {tipBank.ccFeePercent}% fee = ${(10 * (1 - tipBank.ccFeePercent / 100)).toFixed(2)} credited to employee
                </p>
              </div>
            )}
          </div>
        </section>

        {/* ═══════════════════════════════════════════
            Section 6: EOD Tip Payout
            ═══════════════════════════════════════════ */}
        <section className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl p-6">
          <h2 className="text-lg font-semibold text-white mb-1">EOD Tip Payout</h2>
          <p className="text-sm text-white/50 mb-5">Control how employees receive their tips when they close their shift.</p>

          <div className="space-y-4">
            {/* Allow cash out at EOD */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-white/80">Allow Cash Out at Shift Close</div>
                <div className="text-xs text-white/40">Employees can cash out their available tip bank balance when closing their shift</div>
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
                  <div className="text-sm text-white/80">Require Manager Approval</div>
                  <div className="text-xs text-white/40">Manager must approve before cash is given to the employee</div>
                </div>
                <ToggleSwitch
                  checked={tipBank.requireManagerApprovalForCashOut}
                  onChange={v => updateTipBank('requireManagerApprovalForCashOut', v)}
                />
              </div>
            )}

            {/* Default payout method */}
            <div>
              <label className="block text-sm font-medium text-white/70 mb-2">Default Payout Method</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  onClick={() => updateTipBank('defaultPayoutMethod', 'cash')}
                  className={`text-left p-4 rounded-xl border transition-all ${
                    tipBank.defaultPayoutMethod === 'cash'
                      ? 'border-green-500 bg-green-500/20 ring-1 ring-green-500/40'
                      : 'border-white/10 bg-white/5 hover:bg-white/10'
                  }`}
                >
                  <div className={`text-sm font-medium ${tipBank.defaultPayoutMethod === 'cash' ? 'text-green-300' : 'text-white/80'}`}>
                    Cash (Recommended)
                  </div>
                  <div className="text-xs text-white/40 mt-1">Employee takes tips in cash at end of shift. Business doesn&apos;t hold onto tip money.</div>
                </button>
                <button
                  onClick={() => updateTipBank('defaultPayoutMethod', 'payroll')}
                  className={`text-left p-4 rounded-xl border transition-all ${
                    tipBank.defaultPayoutMethod === 'payroll'
                      ? 'border-indigo-500 bg-indigo-500/20 ring-1 ring-indigo-500/40'
                      : 'border-white/10 bg-white/5 hover:bg-white/10'
                  }`}
                >
                  <div className={`text-sm font-medium ${tipBank.defaultPayoutMethod === 'payroll' ? 'text-indigo-300' : 'text-white/80'}`}>
                    Payroll
                  </div>
                  <div className="text-xs text-white/40 mt-1">Tips accumulate in the tip bank and are paid out during the next payroll cycle.</div>
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════════
            Section 7: Tip Group Attribution Timing
            ═══════════════════════════════════════════ */}
        <section className="bg-black/40 backdrop-blur-xl border border-white/10 rounded-2xl p-6">
          <h2 className="text-lg font-semibold text-white mb-1">Tip Group Attribution</h2>
          <p className="text-sm text-white/50 mb-5">When a check is opened by one group and closed by another (e.g., shift handoff), which group gets credit for the tip?</p>

          <div className="grid grid-cols-1 gap-3">
            {ATTRIBUTION_TIMING_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => updateTipBank('tipAttributionTiming', opt.value)}
                className={`text-left p-4 rounded-xl border transition-all ${
                  tipBank.tipAttributionTiming === opt.value
                    ? 'border-indigo-500 bg-indigo-500/20 ring-1 ring-indigo-500/40'
                    : 'border-white/10 bg-white/5 hover:bg-white/10'
                }`}
              >
                <div className={`text-sm font-medium ${tipBank.tipAttributionTiming === opt.value ? 'text-indigo-300' : 'text-white/80'}`}>
                  {opt.label}
                </div>
                <div className="text-xs text-white/40 mt-1">{opt.description}</div>
              </button>
            ))}
          </div>

          <div className="mt-4 p-3 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
            <p className="text-xs text-indigo-300/80">
              <span className="font-semibold">Note:</span> When using hours-weighted group splits, attribution timing has minimal impact because all group tips are pooled and divided by hours worked at the end of the night.
            </p>
          </div>
        </section>

        {/* Bottom save bar (sticky for long pages) */}
        {isDirty && (
          <div className="sticky bottom-4 flex justify-end">
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="px-6 py-3 bg-indigo-600 text-white rounded-xl font-semibold shadow-lg hover:bg-indigo-700 transition-all disabled:opacity-50"
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ────────────────────────────────────────────
// Toggle Switch component (inline, dark glass)
// ────────────────────────────────────────────

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
        checked ? 'bg-indigo-600' : 'bg-white/20'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  )
}
