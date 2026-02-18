'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { formatCurrency } from '@/lib/utils'
import { hasPermission, PERMISSIONS } from '@/lib/auth-utils'
import { toast } from '@/stores/toast-store'
import { Modal } from '@/components/ui/modal'

interface ShiftSummary {
  totalSales: number
  cashSales: number
  cardSales: number
  totalTips: number
  totalCommission: number
  cashReceived: number
  changeGiven: number
  netCashReceived: number
  orderCount: number
  paymentCount: number
  voidCount: number
  compCount: number
  salesData?: {
    totalSales: number
    foodSales: number
    barSales: number
    netSales: number
  }
}

interface ShiftData {
  id: string
  startedAt: string
  startingCash: number
  employee: {
    id: string
    name: string
    roleId?: string
  }
  locationId?: string
}

interface TipOutRule {
  id: string
  fromRoleId: string
  toRoleId: string
  toRole: { id: string; name: string }
  percentage: number
  isActive: boolean
  basisType?: string       // 'tips_earned' | 'food_sales' | 'bar_sales' | 'total_sales' | 'net_sales'
  maxPercentage?: number | null
}

interface CalculatedTipOut {
  ruleId: string
  toRoleId: string
  toRoleName: string
  percentage: number
  amount: number
  toEmployeeId?: string
  toEmployeeName?: string
  basisType: string
  basisLabel: string       // Human-readable: "tips", "food sales", "bar sales", etc.
  basisAmount: number      // The dollar amount used as basis
  wasCapped: boolean       // True if maxPercentage cap was applied
  uncappedAmount?: number  // Original amount before cap (only if capped)
  maxPercentage?: number   // The cap percentage (only if capped)
}

interface CustomTipShare {
  toEmployeeId: string
  toEmployeeName: string
  amount: number
}

interface Employee {
  id: string
  firstName: string
  lastName: string
  role: { id: string; name: string }
}

interface ShiftCloseoutModalProps {
  isOpen: boolean
  onClose: () => void
  shift: ShiftData
  onCloseoutComplete: (result: {
    variance: number
    summary: ShiftSummary
  }) => void
  permissions?: string[]
  cashHandlingMode?: string
}

// Denomination structure for cash counting
const DENOMINATIONS = [
  { label: '$100', value: 100 },
  { label: '$50', value: 50 },
  { label: '$20', value: 20 },
  { label: '$10', value: 10 },
  { label: '$5', value: 5 },
  { label: '$1', value: 1 },
  { label: '25¢', value: 0.25 },
  { label: '10¢', value: 0.10 },
  { label: '5¢', value: 0.05 },
  { label: '1¢', value: 0.01 },
]

export function ShiftCloseoutModal({
  isOpen,
  onClose,
  shift,
  onCloseoutComplete,
  permissions = [],
  cashHandlingMode,
}: ShiftCloseoutModalProps) {
  const router = useRouter()

  // Check if user has permission to see expected cash before counting (non-blind mode)
  const canSeeExpectedFirst = hasPermission(permissions, PERMISSIONS.MGR_CASH_DRAWER_FULL)
  const mode = cashHandlingMode || 'drawer'

  // Start at 'count' for blind mode (default), or 'summary' if manager with full access
  const [step, setStep] = useState<'count' | 'summary' | 'reveal' | 'tips' | 'payout' | 'complete'>('count')
  const [isLoading, setIsLoading] = useState(false)
  const [summary, setSummary] = useState<ShiftSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Track if user chose to view summary first (manager override)
  const [viewedSummaryFirst, setViewedSummaryFirst] = useState(false)

  // Cash count state
  const [counts, setCounts] = useState<Record<number, number>>({})
  const [manualTotal, setManualTotal] = useState<string>('')
  const [useManual, setUseManual] = useState(false)
  const [tipsDeclared, setTipsDeclared] = useState<string>('')
  const [notes, setNotes] = useState('')

  // Open orders block state
  const [openOrderBlock, setOpenOrderBlock] = useState<{ count: number } | null>(null)

  // Closeout result
  const [closeoutResult, setCloseoutResult] = useState<{
    variance: number
    expectedCash: number
    actualCash: number
    message: string
  } | null>(null)

  // Tip sharing state
  const [tipOutRules, setTipOutRules] = useState<TipOutRule[]>([])
  const [calculatedTipOuts, setCalculatedTipOuts] = useState<CalculatedTipOut[]>([])
  const [customTipShares, setCustomTipShares] = useState<CustomTipShare[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [newShareEmployeeId, setNewShareEmployeeId] = useState('')
  const [newShareAmount, setNewShareAmount] = useState('')

  // Tip payout state
  const [tipBankBalance, setTipBankBalance] = useState<number>(0) // cents
  const [payoutChoice, setPayoutChoice] = useState<'cash' | 'payroll'>('cash')
  const [payoutProcessing, setPayoutProcessing] = useState(false)
  const [payoutResult, setPayoutResult] = useState<{ amountDollars: number; newBalanceDollars: number } | null>(null)
  const [tipBankSettings, setTipBankSettings] = useState<{
    allowEODCashOut: boolean
    requireManagerApprovalForCashOut: boolean
    defaultPayoutMethod: 'cash' | 'payroll'
  } | null>(null)

  // Calculate total from denomination counts
  const countedTotal = Object.entries(counts).reduce(
    (sum, [denom, count]) => sum + parseFloat(denom) * count,
    0
  )

  const actualCash = useManual ? parseFloat(manualTotal) || 0 : countedTotal
  // Only calculate expected if summary is loaded (after reveal)
  const expectedCash = (shift?.startingCash || 0) + (summary?.netCashReceived || 0)
  const variance = summary ? actualCash - expectedCash : 0

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      // 'none' mode skips cash count entirely — go straight to tips
      setStep(mode === 'none' ? 'tips' : 'count')
      setSummary(null)
      setCounts({})
      setManualTotal('')
      setTipsDeclared('')
      setNotes('')
      setCloseoutResult(null)
      setOpenOrderBlock(null)
      setViewedSummaryFirst(false)
      setError(null)
      // Reset tip sharing state
      setTipOutRules([])
      setCalculatedTipOuts([])
      setCustomTipShares([])
      setEmployees([])
      setNewShareEmployeeId('')
      setNewShareAmount('')
      // Reset payout state
      setTipBankBalance(0)
      setPayoutChoice('cash')
      setPayoutProcessing(false)
      setPayoutResult(null)
      setTipBankSettings(null)
      // Mode-specific initialization
      setUseManual(mode === 'purse') // Purse mode forces manual total entry
      if (mode === 'none') {
        // Auto-fetch summary and tip data — no cash count needed
        fetchShiftSummary(false)
        fetchTipData()
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  // Fetch shift summary - called after cash is declared (for reveal step) or by manager preview
  const fetchShiftSummary = async (forReveal = false) => {
    setIsLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/shifts/${shift.id}`)
      if (!response.ok) throw new Error('Failed to fetch shift summary')
      const raw = await response.json()
      const data = raw.data ?? raw
      setSummary(data.summary)
      if (!tipsDeclared) {
        setTipsDeclared(data.summary.totalTips.toFixed(2))
      }
      if (forReveal) {
        setStep('reveal')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load shift data')
    } finally {
      setIsLoading(false)
    }
  }

  // Fetch tip-out rules and employees for tip distribution
  const fetchTipData = async () => {
    if (!shift.locationId || !shift.employee.roleId) return

    try {
      // Fetch tip-out rules and employees in parallel
      const [rulesRes, employeesRes] = await Promise.all([
        fetch(`/api/tip-out-rules?locationId=${shift.locationId}`),
        fetch(`/api/employees?locationId=${shift.locationId}`)
      ])

      if (rulesRes.ok) {
        const rulesData = await rulesRes.json()
        // Filter to rules that apply to this employee's role
        const applicableRules = (rulesData.data || []).filter(
          (rule: TipOutRule) => rule.fromRoleId === shift.employee.roleId && rule.isActive
        )
        setTipOutRules(applicableRules)
      }

      if (employeesRes.ok) {
        const empRaw = await employeesRes.json()
        const empData = empRaw.data ?? empRaw
        // Filter out the current employee
        const otherEmployees = (empData.employees || []).filter(
          (emp: Employee) => emp.id !== shift.employee.id
        )
        setEmployees(otherEmployees)
      }
    } catch (err) {
      console.error('Failed to fetch tip data:', err)
    }
  }

  // Fetch tip bank balance and settings for payout step
  const fetchTipBankInfo = async () => {
    if (!shift.locationId || !shift.employee.id) return
    try {
      const [balanceRes, settingsRes] = await Promise.all([
        fetch(`/api/tips/ledger?locationId=${shift.locationId}&employeeId=${shift.employee.id}`, {
          headers: { 'x-employee-id': shift.employee.id }
        }),
        fetch(`/api/settings/tips?locationId=${shift.locationId}&employeeId=${shift.employee.id}`)
      ])
      if (balanceRes.ok) {
        const balanceRaw = await balanceRes.json()
        const balanceData = balanceRaw.data ?? balanceRaw
        setTipBankBalance(balanceData.currentBalanceCents ?? 0)
      }
      if (settingsRes.ok) {
        const settingsRaw = await settingsRes.json()
        const settingsData = settingsRaw.data ?? settingsRaw
        const tb = settingsData.tipBank
        if (tb) {
          setTipBankSettings({
            allowEODCashOut: tb.allowEODCashOut ?? false,
            requireManagerApprovalForCashOut: tb.requireManagerApprovalForCashOut ?? false,
            defaultPayoutMethod: tb.defaultPayoutMethod ?? 'cash',
          })
          setPayoutChoice(tb.defaultPayoutMethod ?? 'cash')
        }
      }
    } catch (err) {
      console.error('Failed to fetch tip bank info:', err)
    }
  }

  // Calculate tip-outs when tips are declared and rules are loaded
  const calculateTipOuts = () => {
    const grossTips = parseFloat(tipsDeclared) || 0
    if (grossTips === 0 || tipOutRules.length === 0) {
      setCalculatedTipOuts([])
      return
    }

    const sd = summary?.salesData

    const calculated = tipOutRules.map(rule => {
      const basisType = rule.basisType || 'tips_earned'

      // Determine basis amount and label based on rule's basisType
      let basisAmount = grossTips
      let basisLabel = 'tips'

      if (sd) {
        switch (basisType) {
          case 'food_sales':
            basisAmount = sd.foodSales
            basisLabel = 'food sales'
            break
          case 'bar_sales':
            basisAmount = sd.barSales
            basisLabel = 'bar sales'
            break
          case 'total_sales':
            basisAmount = sd.totalSales
            basisLabel = 'total sales'
            break
          case 'net_sales':
            basisAmount = sd.netSales
            basisLabel = 'net sales'
            break
          default:
            basisAmount = grossTips
            basisLabel = 'tips'
        }
      }

      let amount = Math.round(basisAmount * (rule.percentage / 100) * 100) / 100
      let wasCapped = false
      let uncappedAmount: number | undefined

      // Apply maxPercentage cap if set (caps at % of tips, not sales)
      if (rule.maxPercentage != null && rule.maxPercentage > 0) {
        const maxAmount = Math.round(grossTips * (rule.maxPercentage / 100) * 100) / 100
        if (amount > maxAmount) {
          uncappedAmount = amount
          amount = maxAmount
          wasCapped = true
        }
      }

      return {
        ruleId: rule.id,
        toRoleId: rule.toRoleId,
        toRoleName: rule.toRole.name,
        percentage: rule.percentage,
        amount,
        basisType,
        basisLabel,
        basisAmount,
        wasCapped,
        uncappedAmount,
        maxPercentage: wasCapped ? (rule.maxPercentage ?? undefined) : undefined,
      }
    })

    setCalculatedTipOuts(calculated)
  }

  // Update tip-outs when tips declared changes or summary (with salesData) loads
  useEffect(() => {
    calculateTipOuts()
  }, [tipsDeclared, tipOutRules, summary])

  // Calculate net tips (after tip-outs and custom shares)
  const totalTipOuts = calculatedTipOuts.reduce((sum, t) => sum + t.amount, 0)
  const totalCustomShares = customTipShares.reduce((sum, t) => sum + t.amount, 0)
  const grossTips = parseFloat(tipsDeclared) || 0
  const netTips = grossTips - totalTipOuts - totalCustomShares

  // Add custom tip share
  const addCustomShare = () => {
    if (!newShareEmployeeId || !newShareAmount) {
      setError('Please select an employee and enter an amount')
      return
    }

    const amount = parseFloat(newShareAmount)
    if (isNaN(amount) || amount <= 0) {
      setError('Please enter a valid amount')
      return
    }

    if (amount > netTips + amount) { // Check if this would make net negative
      setError('Cannot share more than available tips')
      return
    }

    const employee = employees.find(e => e.id === newShareEmployeeId)
    if (!employee) return

    setCustomTipShares([
      ...customTipShares,
      {
        toEmployeeId: employee.id,
        toEmployeeName: `${employee.firstName} ${employee.lastName}`,
        amount
      }
    ])
    setNewShareEmployeeId('')
    setNewShareAmount('')
    setError(null)
  }

  // Remove custom tip share
  const removeCustomShare = (index: number) => {
    setCustomTipShares(customTipShares.filter((_, i) => i !== index))
  }

  // Handler to proceed to tip distribution step
  const handleProceedToTips = async () => {
    await fetchTipData()
    setStep('tips')
  }

  // Handler for submitting blind count - fetches summary to reveal variance
  const handleSubmitBlindCount = async () => {
    if (actualCash === 0) {
      setError('Please count your drawer first')
      return
    }
    await fetchShiftSummary(true)
  }

  // Handler for manager to preview summary before counting
  const handleViewSummaryFirst = async () => {
    setViewedSummaryFirst(true)
    await fetchShiftSummary(false)
    setStep('summary')
  }

  const handleCountChange = (denom: number, value: string) => {
    const count = parseInt(value) || 0
    setCounts(prev => ({ ...prev, [denom]: count }))
  }

  const handleCloseShift = async () => {
    setIsLoading(true)
    setError(null)
    try {
      // For 'none' mode, no cash was handled
      const cashToSubmit = mode === 'none' ? 0 : actualCash

      // Prepare tip distribution data
      const tipDistribution = {
        grossTips: parseFloat(tipsDeclared) || 0,
        tipOutTotal: totalTipOuts + totalCustomShares,
        netTips,
        roleTipOuts: calculatedTipOuts.map(t => ({
          ruleId: t.ruleId,
          toRoleId: t.toRoleId,
          amount: t.amount
        })),
        customShares: customTipShares.map(s => ({
          toEmployeeId: s.toEmployeeId,
          amount: s.amount
        }))
      }

      const response = await fetch(`/api/shifts/${shift.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'close',
          employeeId: shift.employee.id,
          actualCash: cashToSubmit,
          cashHandlingMode: mode,
          tipsDeclared: parseFloat(tipsDeclared) || 0,
          notes,
          blindMode: !viewedSummaryFirst,
          tipDistribution,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        if (response.status === 409 && data.requiresManagerOverride) {
          setOpenOrderBlock({ count: data.openOrderCount })
          return
        }
        throw new Error(data.error || 'Failed to close shift')
      }

      const raw = await response.json()
      const data = raw.data ?? raw
      setCloseoutResult({
        variance: data.shift.variance,
        expectedCash: data.shift.expectedCash,
        actualCash: data.shift.actualCash,
        message: data.message,
      })
      setStep('complete')
      onCloseoutComplete({
        variance: data.shift.variance,
        summary: data.summary,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to close shift')
    } finally {
      setIsLoading(false)
    }
  }

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  const formatDuration = (startTime: string) => {
    const start = new Date(startTime)
    const now = new Date()
    const diff = now.getTime() - start.getTime()
    const hours = Math.floor(diff / (1000 * 60 * 60))
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
    return `${hours}h ${minutes}m`
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Close Out Shift" size="2xl" variant="default">
        <p className="text-sm text-gray-500 -mt-3 mb-4">
          {shift.employee.name} • Started {formatTime(shift.startedAt)} ({formatDuration(shift.startedAt)})
        </p>
        <div>
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
              {error}
            </div>
          )}

          {isLoading ? (
            <div className="text-center py-8 text-gray-500">
              <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-2" />
              Loading...
            </div>
          ) : (
            <>
              {/* Step 1: Blind Cash Count (default for all employees) */}
              {step === 'count' && (
                <div className="space-y-4">
                  {/* Blind Mode Indicator */}
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center gap-2">
                    <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                    <div className="flex-1">
                      <span className="text-sm font-medium text-blue-800">Blind Count Mode</span>
                      <p className="text-xs text-blue-600">Count your {mode === 'purse' ? 'purse' : 'drawer'} before seeing the expected amount</p>
                    </div>
                    {canSeeExpectedFirst && !viewedSummaryFirst && (
                      <button
                        onClick={handleViewSummaryFirst}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        Manager: View Summary First
                      </button>
                    )}
                  </div>

                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-lg">{mode === 'purse' ? 'Count Your Purse' : 'Count Your Drawer'}</h3>
                    {mode !== 'purse' && (
                      <button
                        className="text-sm text-blue-600 hover:underline"
                        onClick={() => setUseManual(!useManual)}
                      >
                        {useManual ? 'Count by denomination' : 'Enter total manually'}
                      </button>
                    )}
                  </div>

                  {useManual ? (
                    <div>
                      <label className="block text-sm text-gray-600 mb-2">
                        Enter total cash in {mode === 'purse' ? 'purse' : 'drawer'}
                      </label>
                      <div className="relative">
                        <span className="absolute left-3 top-3 text-gray-500 text-xl">$</span>
                        <input
                          type="number"
                          value={manualTotal}
                          onChange={(e) => setManualTotal(e.target.value)}
                          className="w-full pl-8 pr-4 py-3 text-2xl border rounded-lg"
                          placeholder="0.00"
                          step="0.01"
                          min="0"
                          autoFocus
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      {DENOMINATIONS.map(({ label, value }) => (
                        <div key={value} className="flex items-center gap-2">
                          <span className="w-12 text-right font-medium">{label}</span>
                          <span className="text-gray-400">×</span>
                          <input
                            type="number"
                            min="0"
                            value={counts[value] || ''}
                            onChange={(e) => handleCountChange(value, e.target.value)}
                            className="w-20 px-2 py-1 border rounded text-center"
                            placeholder="0"
                          />
                          <span className="text-gray-500 text-sm">
                            = {formatCurrency((counts[value] || 0) * value)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Running total - blind mode doesn't show expected */}
                  <Card className="p-4 bg-gray-50">
                    <div className="text-center">
                      <div className="text-sm text-gray-500">Total Counted</div>
                      <div className="text-3xl font-bold">{formatCurrency(actualCash)}</div>
                    </div>
                  </Card>

                  <div>
                    <label className="block text-sm text-gray-600 mb-2">
                      Tips to Declare
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-2 text-gray-500">$</span>
                      <input
                        type="number"
                        value={tipsDeclared}
                        onChange={(e) => setTipsDeclared(e.target.value)}
                        className="w-full pl-8 pr-4 py-2 border rounded-lg"
                        placeholder="0.00"
                        step="0.01"
                        min="0"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm text-gray-600 mb-2">
                      Notes (optional)
                    </label>
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg"
                      rows={2}
                      placeholder="Any notes about the shift..."
                    />
                  </div>

                  <Button
                    variant="primary"
                    className="w-full"
                    onClick={handleSubmitBlindCount}
                    disabled={actualCash === 0 || isLoading}
                  >
                    {isLoading ? 'Processing...' : 'Submit Count & Reveal →'}
                  </Button>
                </div>
              )}

              {/* Manager View Summary First (optional step for managers) */}
              {step === 'summary' && summary && (
                <div className="space-y-4">
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 flex items-center gap-2">
                    <svg className="w-5 h-5 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                    <span className="text-sm font-medium text-yellow-800">Manager Override - Non-Blind Mode</span>
                  </div>

                  <h3 className="font-semibold text-lg">Shift Summary</h3>

                  <div className="grid grid-cols-2 gap-4">
                    <Card className="p-4">
                      <div className="text-sm text-gray-500">Total Sales</div>
                      <div className="text-2xl font-bold">{formatCurrency(summary.totalSales)}</div>
                    </Card>
                    <Card className="p-4">
                      <div className="text-sm text-gray-500">Orders</div>
                      <div className="text-2xl font-bold">{summary.orderCount}</div>
                    </Card>
                  </div>

                  <Card className="p-4">
                    <div className="text-sm font-medium mb-2">Payment Breakdown</div>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-gray-600">Cash Sales</span>
                        <span className="font-medium">{formatCurrency(summary.cashSales)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Card Sales</span>
                        <span className="font-medium">{formatCurrency(summary.cardSales)}</span>
                      </div>
                      <div className="flex justify-between border-t pt-2">
                        <span className="text-gray-600">Tips Collected</span>
                        <span className="font-medium">{formatCurrency(summary.totalTips)}</span>
                      </div>
                    </div>
                  </Card>

                  <Card className="p-4 bg-blue-50">
                    <div className="text-sm font-medium mb-2">Cash Drawer</div>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-gray-600">Starting Cash</span>
                        <span className="font-medium">{formatCurrency(shift.startingCash)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Cash Received</span>
                        <span className="font-medium text-green-600">+{formatCurrency(summary.cashReceived)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Change Given</span>
                        <span className="font-medium text-red-600">-{formatCurrency(summary.changeGiven)}</span>
                      </div>
                      <div className="flex justify-between border-t pt-2 font-bold">
                        <span>Expected in Drawer</span>
                        <span>{formatCurrency(expectedCash)}</span>
                      </div>
                    </div>
                  </Card>

                  {(summary.voidCount > 0 || summary.compCount > 0) && (
                    <Card className="p-4 bg-yellow-50">
                      <div className="text-sm font-medium mb-2">Adjustments</div>
                      <div className="space-y-1">
                        {summary.voidCount > 0 && (
                          <div className="flex justify-between text-sm">
                            <span>Voids</span>
                            <span>{summary.voidCount}</span>
                          </div>
                        )}
                        {summary.compCount > 0 && (
                          <div className="flex justify-between text-sm">
                            <span>Comps</span>
                            <span>{summary.compCount}</span>
                          </div>
                        )}
                      </div>
                    </Card>
                  )}

                  <Button
                    variant="primary"
                    className="w-full"
                    onClick={() => setStep('count')}
                  >
                    Count Drawer →
                  </Button>
                </div>
              )}

              {/* Step 2: Reveal (after blind count submission) */}
              {step === 'reveal' && summary && (
                <div className="space-y-4">
                  <h3 className="font-semibold text-lg">{mode === 'purse' ? 'Purse Count Results' : 'Drawer Count Results'}</h3>

                  <Card className={`p-4 ${variance === 0 ? 'bg-green-50 border-green-200' : variance > 0 ? 'bg-yellow-50 border-yellow-200' : 'bg-red-50 border-red-200'}`}>
                    <div className="text-center mb-4">
                      {variance === 0 ? (
                        <div className="text-green-600">
                          <svg className="w-12 h-12 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <p className="font-bold text-lg">{mode === 'purse' ? 'Purse' : 'Drawer'} is Balanced!</p>
                        </div>
                      ) : variance > 0 ? (
                        <div className="text-yellow-600">
                          <svg className="w-12 h-12 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                          </svg>
                          <p className="font-bold text-lg">{mode === 'purse' ? 'Purse' : 'Drawer'} is OVER by {formatCurrency(variance)}</p>
                        </div>
                      ) : (
                        <div className="text-red-600">
                          <svg className="w-12 h-12 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <p className="font-bold text-lg">{mode === 'purse' ? 'Purse' : 'Drawer'} is SHORT by {formatCurrency(Math.abs(variance))}</p>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-3 gap-4 text-center py-2">
                      <div>
                        <div className="text-sm text-gray-500">Expected</div>
                        <div className="text-lg font-bold">{formatCurrency(expectedCash)}</div>
                      </div>
                      <div>
                        <div className="text-sm text-gray-500">Your Count</div>
                        <div className="text-lg font-bold">{formatCurrency(actualCash)}</div>
                      </div>
                      <div>
                        <div className="text-sm text-gray-500">Variance</div>
                        <div className={`text-lg font-bold ${variance === 0 ? 'text-green-600' : variance > 0 ? 'text-yellow-600' : 'text-red-600'}`}>
                          {variance >= 0 ? '+' : ''}{formatCurrency(variance)}
                        </div>
                      </div>
                    </div>
                  </Card>

                  {/* Shift Summary - now visible */}
                  <Card className="p-4">
                    <div className="text-sm font-medium mb-2">Shift Summary</div>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-600">Total Sales</span>
                        <span className="font-medium">{formatCurrency(summary.totalSales)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Cash Sales</span>
                        <span className="font-medium">{formatCurrency(summary.cashSales)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Card Sales</span>
                        <span className="font-medium">{formatCurrency(summary.cardSales)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Orders Completed</span>
                        <span className="font-medium">{summary.orderCount}</span>
                      </div>
                      <div className="flex justify-between border-t pt-2">
                        <span className="text-gray-600">Tips Declared</span>
                        <span className="font-medium">{formatCurrency(parseFloat(tipsDeclared) || 0)}</span>
                      </div>
                      {summary.totalCommission > 0 && (
                        <div className="flex justify-between">
                          <span className="text-gray-600">Commission Earned</span>
                          <span className="font-medium text-purple-600">{formatCurrency(summary.totalCommission)}</span>
                        </div>
                      )}
                    </div>
                  </Card>

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => {
                        setSummary(null)
                        setStep('count')
                      }}
                    >
                      ← Recount
                    </Button>
                    <Button
                      variant="primary"
                      className="flex-1"
                      onClick={handleProceedToTips}
                      disabled={isLoading}
                    >
                      {isLoading ? 'Loading...' : 'Continue to Tips →'}
                    </Button>
                  </div>
                </div>
              )}

              {/* Step 3: Tip Distribution */}
              {step === 'tips' && (
                <div className="space-y-4">
                  <h3 className="font-semibold text-lg">Tip Distribution</h3>

                  {/* Commission Earned (if any) */}
                  {summary && summary.totalCommission > 0 && (
                    <Card className="p-4 bg-purple-50">
                      <div className="flex justify-between items-center">
                        <div>
                          <span className="text-gray-700">Commission Earned</span>
                          <p className="text-xs text-gray-500">Added to payroll</p>
                        </div>
                        <span className="text-2xl font-bold text-purple-600">
                          {formatCurrency(summary.totalCommission)}
                        </span>
                      </div>
                    </Card>
                  )}

                  {/* Gross Tips */}
                  <Card className="p-4 bg-green-50">
                    <div className="flex justify-between items-center">
                      <span className="text-gray-700">Gross Tips Collected</span>
                      <span className="text-2xl font-bold text-green-600">
                        {formatCurrency(grossTips)}
                      </span>
                    </div>
                  </Card>

                  {/* Automatic Tip-Outs */}
                  {calculatedTipOuts.length > 0 && (
                    <Card className="p-4">
                      <h4 className="font-medium text-gray-900 mb-3">
                        Automatic Tip-Outs (from rules)
                      </h4>
                      <div className="space-y-2">
                        {calculatedTipOuts.map((tipOut, index) => (
                          <div key={index} className="py-2 border-b last:border-0">
                            <div className="flex justify-between items-center">
                              <div>
                                <span className="font-medium">{tipOut.toRoleName}</span>
                                {tipOut.basisType === 'tips_earned' ? (
                                  <span className="text-sm text-gray-500 ml-2">({tipOut.percentage}%)</span>
                                ) : (
                                  <span className="text-sm text-gray-500 ml-2">
                                    ({tipOut.percentage}% of {formatCurrency(tipOut.basisAmount)} {tipOut.basisLabel})
                                  </span>
                                )}
                              </div>
                              <span className="text-red-600 font-medium">-{formatCurrency(tipOut.amount)}</span>
                            </div>
                            {tipOut.wasCapped && tipOut.uncappedAmount != null && (
                              <div className="text-xs text-amber-600 mt-1 ml-1">
                                Capped at {tipOut.maxPercentage}% of tips (was {formatCurrency(tipOut.uncappedAmount)})
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </Card>
                  )}

                  {calculatedTipOuts.length === 0 && (
                    <div className="text-sm text-gray-500 text-center py-2">
                      No automatic tip-out rules configured for your role.
                    </div>
                  )}

                  {/* Custom Tip Shares */}
                  <Card className="p-4">
                    <h4 className="font-medium text-gray-900 mb-3">
                      Custom Tip Shares
                    </h4>

                    {/* Existing custom shares */}
                    {customTipShares.length > 0 && (
                      <div className="space-y-2 mb-4">
                        {customTipShares.map((share, index) => (
                          <div key={index} className="flex justify-between items-center py-2 border-b">
                            <span className="font-medium">{share.toEmployeeName}</span>
                            <div className="flex items-center gap-2">
                              <span className="text-red-600 font-medium">-{formatCurrency(share.amount)}</span>
                              <button
                                onClick={() => removeCustomShare(index)}
                                className="text-gray-400 hover:text-red-600"
                              >
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Add new custom share */}
                    <div className="flex gap-2 items-end">
                      <div className="flex-1">
                        <label className="block text-xs text-gray-500 mb-1">Employee</label>
                        <select
                          value={newShareEmployeeId}
                          onChange={(e) => setNewShareEmployeeId(e.target.value)}
                          className="w-full px-3 py-2 border rounded-lg text-sm"
                        >
                          <option value="">Select employee...</option>
                          {employees.map(emp => (
                            <option key={emp.id} value={emp.id}>
                              {emp.firstName} {emp.lastName} ({emp.role.name})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="w-28">
                        <label className="block text-xs text-gray-500 mb-1">Amount</label>
                        <div className="relative">
                          <span className="absolute left-2 top-2 text-gray-500">$</span>
                          <input
                            type="number"
                            value={newShareAmount}
                            onChange={(e) => setNewShareAmount(e.target.value)}
                            className="w-full pl-6 pr-2 py-2 border rounded-lg text-sm"
                            placeholder="0.00"
                            step="0.01"
                            min="0"
                          />
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        onClick={addCustomShare}
                        className="px-3"
                      >
                        Add
                      </Button>
                    </div>
                  </Card>

                  {/* Net Tips Summary */}
                  <Card className={`p-4 ${netTips >= 0 ? 'bg-blue-50' : 'bg-red-50'}`}>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Gross Tips</span>
                        <span>{formatCurrency(grossTips)}</span>
                      </div>
                      {totalTipOuts > 0 && (
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-600">Role Tip-Outs</span>
                          <span className="text-red-600">-{formatCurrency(totalTipOuts)}</span>
                        </div>
                      )}
                      {totalCustomShares > 0 && (
                        <div className="flex justify-between text-sm">
                          <span className="text-gray-600">Custom Shares</span>
                          <span className="text-red-600">-{formatCurrency(totalCustomShares)}</span>
                        </div>
                      )}
                      <div className="flex justify-between border-t pt-2">
                        <span className="font-medium">Your Net Tips</span>
                        <span className={`text-xl font-bold ${netTips >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
                          {formatCurrency(netTips)}
                        </span>
                      </div>
                    </div>
                  </Card>

                  <p className="text-sm text-gray-500 text-center">
                    Tip shares will be distributed to recipients. If a recipient is not on shift, their share will be banked.
                  </p>

                  <div className="flex gap-2">
                    {mode !== 'none' && (
                      <Button
                        variant="outline"
                        className="flex-1"
                        onClick={() => setStep('reveal')}
                      >
                        ← Back
                      </Button>
                    )}
                    <Button
                      variant="primary"
                      className="flex-1"
                      onClick={async () => {
                        await fetchTipBankInfo()
                        setStep('payout')
                      }}
                      disabled={isLoading || netTips < 0}
                    >
                      {isLoading ? 'Loading...' : 'Continue to Payout \u2192'}
                    </Button>
                  </div>
                </div>
              )}

              {/* Step: Tip Payout Choice */}
              {step === 'payout' && (
                <div className="space-y-4">
                  <h3 className="font-semibold text-lg">Tip Payout</h3>

                  {/* Current Tip Bank Balance */}
                  <Card className="p-4 bg-green-50">
                    <div className="flex justify-between items-center">
                      <div>
                        <span className="text-gray-700 font-medium">Your Tip Bank Balance</span>
                        <p className="text-xs text-gray-500">Available for payout (includes tonight&apos;s tips after shift close)</p>
                      </div>
                      <span className="text-2xl font-bold text-green-600">
                        {formatCurrency(tipBankBalance / 100)}
                      </span>
                    </div>
                  </Card>

                  {/* Net Tips from this Shift */}
                  <Card className="p-4 bg-blue-50">
                    <div className="flex justify-between items-center">
                      <span className="text-gray-700">Net Tips This Shift</span>
                      <span className="text-xl font-bold text-blue-600">
                        {formatCurrency(netTips)}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      This amount will be added to your tip bank when the shift closes.
                    </p>
                  </Card>

                  {/* Payout Choice */}
                  {tipBankSettings?.allowEODCashOut ? (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">How would you like your tips?</label>
                      <div className="grid grid-cols-2 gap-3">
                        <button
                          onClick={() => setPayoutChoice('cash')}
                          className={`p-4 rounded-xl border-2 transition-all text-left ${
                            payoutChoice === 'cash'
                              ? 'border-green-500 bg-green-50 ring-1 ring-green-200'
                              : 'border-gray-200 bg-white hover:bg-gray-50'
                          }`}
                        >
                          <div className={`text-lg font-semibold ${payoutChoice === 'cash' ? 'text-green-700' : 'text-gray-700'}`}>
                            Cash Out
                          </div>
                          <p className="text-xs text-gray-500 mt-1">
                            Take your tips in cash now. Balance goes to $0.
                          </p>
                          {tipBankSettings.requireManagerApprovalForCashOut && (
                            <p className="text-xs text-amber-600 mt-1">Requires manager approval</p>
                          )}
                        </button>
                        <button
                          onClick={() => setPayoutChoice('payroll')}
                          className={`p-4 rounded-xl border-2 transition-all text-left ${
                            payoutChoice === 'payroll'
                              ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-200'
                              : 'border-gray-200 bg-white hover:bg-gray-50'
                          }`}
                        >
                          <div className={`text-lg font-semibold ${payoutChoice === 'payroll' ? 'text-indigo-700' : 'text-gray-700'}`}>
                            Add to Payroll
                          </div>
                          <p className="text-xs text-gray-500 mt-1">
                            Tips stay in your bank and are paid on your next paycheck.
                          </p>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <Card className="p-4 bg-indigo-50">
                      <div className="text-sm text-indigo-700">
                        <span className="font-medium">Tips will be added to payroll.</span>
                        <p className="text-xs text-indigo-500 mt-1">Cash out at shift close is not enabled for this location.</p>
                      </div>
                    </Card>
                  )}

                  {/* Payout result (shown after processing) */}
                  {payoutResult && (
                    <Card className="p-4 bg-green-50 border-green-200">
                      <div className="text-center">
                        <svg className="w-8 h-8 text-green-600 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <p className="font-medium text-green-700">
                          {formatCurrency(payoutResult.amountDollars)} paid out in cash
                        </p>
                        <p className="text-xs text-green-600 mt-1">
                          Remaining balance: {formatCurrency(payoutResult.newBalanceDollars)}
                        </p>
                      </div>
                    </Card>
                  )}

                  {openOrderBlock && (
                    <div className="bg-amber-50 border border-amber-300 rounded-lg p-4">
                      <h3 className="text-amber-800 font-bold text-sm mb-1">Open Orders Must Be Closed</h3>
                      <p className="text-amber-700 text-xs mb-3">
                        You have {openOrderBlock.count} open order{openOrderBlock.count !== 1 ? 's' : ''}. Close or transfer them before ending your shift.
                      </p>
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            onClose()
                            router.push('/orders')
                          }}
                          className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium rounded transition-colors"
                        >
                          Go to Open Orders
                        </button>
                        <button
                          onClick={async () => {
                            setOpenOrderBlock(null)
                            setIsLoading(true)
                            setError(null)
                            try {
                              const cashToSubmit = mode === 'none' ? 0 : actualCash
                              const tipDistribution = {
                                grossTips: parseFloat(tipsDeclared) || 0,
                                tipOutTotal: totalTipOuts + totalCustomShares,
                                netTips,
                                roleTipOuts: calculatedTipOuts.map(t => ({
                                  ruleId: t.ruleId,
                                  toRoleId: t.toRoleId,
                                  amount: t.amount
                                })),
                                customShares: customTipShares.map(s => ({
                                  toEmployeeId: s.toEmployeeId,
                                  amount: s.amount
                                }))
                              }
                              const overrideRes = await fetch(`/api/shifts/${shift.id}`, {
                                method: 'PUT',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  action: 'close',
                                  employeeId: shift.employee.id,
                                  actualCash: cashToSubmit,
                                  cashHandlingMode: mode,
                                  tipsDeclared: parseFloat(tipsDeclared) || 0,
                                  notes,
                                  blindMode: !viewedSummaryFirst,
                                  tipDistribution,
                                  forceClose: true,
                                }),
                              })
                              if (overrideRes.ok) {
                                const raw = await overrideRes.json()
                                const data = raw.data ?? raw
                                toast.success('Shift closed. Open orders transferred to you.')
                                setCloseoutResult({
                                  variance: data.shift.variance,
                                  expectedCash: data.shift.expectedCash,
                                  actualCash: data.shift.actualCash,
                                  message: data.message,
                                })
                                setStep('complete')
                                onCloseoutComplete({
                                  variance: data.shift.variance,
                                  summary: data.summary,
                                })
                              } else {
                                const err = await overrideRes.json()
                                toast.error(err.error || 'Failed to override')
                                setOpenOrderBlock({ count: openOrderBlock.count })
                              }
                            } catch {
                              toast.error('Failed to close shift')
                              setOpenOrderBlock({ count: openOrderBlock.count })
                            } finally {
                              setIsLoading(false)
                            }
                          }}
                          className="px-3 py-1.5 bg-gray-600 hover:bg-gray-500 text-white text-xs font-medium rounded transition-colors"
                        >
                          Manager Override
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => setStep('tips')}
                      disabled={payoutProcessing}
                    >
                      &larr; Back
                    </Button>
                    <Button
                      variant="primary"
                      className="flex-1"
                      onClick={async () => {
                        // If they chose cash and EOD cash out is enabled, process payout first
                        if (payoutChoice === 'cash' && tipBankSettings?.allowEODCashOut && tipBankBalance > 0 && !payoutResult) {
                          setPayoutProcessing(true)
                          try {
                            const res = await fetch('/api/tips/payouts', {
                              method: 'POST',
                              headers: {
                                'Content-Type': 'application/json',
                                'x-employee-id': shift.employee.id,
                              },
                              body: JSON.stringify({
                                locationId: shift.locationId,
                                employeeId: shift.employee.id,
                                shiftId: shift.id,
                                memo: 'EOD cash out',
                              }),
                            })
                            if (res.ok) {
                              const raw = await res.json()
                              const data = raw.data ?? raw
                              setPayoutResult({
                                amountDollars: data.payout?.amountDollars ?? 0,
                                newBalanceDollars: data.payout?.newBalanceDollars ?? 0,
                              })
                            }
                          } catch (err) {
                            console.error('Failed to cash out tips:', err)
                            setError('Failed to process tip cash out')
                          } finally {
                            setPayoutProcessing(false)
                          }
                        }
                        // Now close the shift
                        await handleCloseShift()
                      }}
                      disabled={isLoading || payoutProcessing}
                    >
                      {payoutProcessing ? 'Processing Payout...' : isLoading ? 'Closing...' : 'Close Shift'}
                    </Button>
                  </div>
                </div>
              )}

              {/* Step 4: Complete */}
              {step === 'complete' && closeoutResult && (
                <div className="space-y-4 text-center py-8">
                  <div className={`${closeoutResult.variance === 0 ? 'text-green-600' : closeoutResult.variance > 0 ? 'text-yellow-600' : 'text-red-600'}`}>
                    <svg className="w-16 h-16 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>

                  <h3 className="text-2xl font-bold">Shift Closed</h3>
                  <p className="text-gray-600">{closeoutResult.message}</p>

                  <Card className="p-4 text-left">
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-gray-600">Expected Cash</span>
                        <span className="font-medium">{formatCurrency(closeoutResult.expectedCash)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Actual Cash</span>
                        <span className="font-medium">{formatCurrency(closeoutResult.actualCash)}</span>
                      </div>
                      <div className="flex justify-between border-t pt-2">
                        <span className="font-medium">Variance</span>
                        <span className={`font-bold ${closeoutResult.variance === 0 ? 'text-green-600' : closeoutResult.variance > 0 ? 'text-yellow-600' : 'text-red-600'}`}>
                          {closeoutResult.variance >= 0 ? '+' : ''}{formatCurrency(closeoutResult.variance)}
                        </span>
                      </div>
                    </div>
                  </Card>

                  <Button
                    variant="secondary"
                    className="w-full"
                    onClick={async () => {
                      try {
                        const res = await fetch('/api/print/shift-closeout', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            shiftId: shift.id,
                            locationId: shift.locationId,
                          }),
                        })
                        if (!res.ok) {
                          const err = await res.json()
                          toast.error(err.error || 'Failed to print receipt')
                        } else {
                          toast.success('Closeout receipt sent to printer')
                        }
                      } catch {
                        toast.error('Failed to print receipt')
                      }
                    }}
                  >
                    Print Closeout Receipt
                  </Button>

                  <Button
                    variant="primary"
                    className="w-full"
                    onClick={onClose}
                  >
                    Done
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
    </Modal>
  )
}
