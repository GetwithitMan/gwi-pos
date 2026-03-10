'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from '@/stores/toast-store'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { ToggleRow, SettingsSaveBar } from '@/components/admin/settings'
import { useRequireAuth } from '@/hooks/useRequireAuth'
import { useUnsavedWarning } from '@/hooks/useUnsavedWarning'
import { loadSettings as loadSettingsApi, saveSettings as saveSettingsApi } from '@/lib/api/settings-client'
import type { PayrollExportSettings } from '@/lib/settings'
import { DEFAULT_PAYROLL_EXPORT } from '@/lib/settings'
import { useAuthStore } from '@/stores/auth-store'

interface PayrollPreview {
  startDate: string
  endDate: string
  records: Array<{
    employeeId: string
    employeeName: string
    role: string
    regularHours: number
    overtimeHours: number
    totalTipCompensation: number
    commissionEarned: number
    grossPay: number
  }>
  totals: {
    employeeCount: number
    totalRegularHours: number
    totalOvertimeHours: number
    totalTips: number
    totalGrossPay: number
  }
}

export default function PayrollExportSettingsPage() {
  const { employee } = useRequireAuth()
  const locationId = useAuthStore(s => s.locationId)

  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isDirty, setIsDirty] = useState(false)

  const [payroll, setPayroll] = useState<PayrollExportSettings>(DEFAULT_PAYROLL_EXPORT)

  // Preview state
  const [preview, setPreview] = useState<PayrollPreview | null>(null)
  const [isPreviewLoading, setIsPreviewLoading] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [previewStartDate, setPreviewStartDate] = useState('')
  const [previewEndDate, setPreviewEndDate] = useState('')

  useUnsavedWarning(isDirty)

  // Set default date range to current pay period
  useEffect(() => {
    const now = new Date()
    const twoWeeksAgo = new Date(now)
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14)
    setPreviewStartDate(twoWeeksAgo.toISOString().split('T')[0])
    setPreviewEndDate(now.toISOString().split('T')[0])
  }, [])

  const loadSettings = useCallback(() => {
    const controller = new AbortController()
    ;(async () => {
      try {
        setIsLoading(true)
        const data = await loadSettingsApi(controller.signal)
        setPayroll(data.settings.payrollExport ?? DEFAULT_PAYROLL_EXPORT)
      } catch (err) {
        if ((err as DOMException).name !== 'AbortError') {
          toast.error('Failed to load settings')
        }
      } finally {
        setIsLoading(false)
      }
    })()
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const cleanup = loadSettings()
    return cleanup
  }, [loadSettings])

  const handleSave = async () => {
    try {
      setIsSaving(true)
      const data = await saveSettingsApi({ payrollExport: payroll }, employee?.id)
      setPayroll(data.settings.payrollExport ?? DEFAULT_PAYROLL_EXPORT)
      setIsDirty(false)
      toast.success('Payroll export settings saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setIsSaving(false)
    }
  }

  const update = <K extends keyof PayrollExportSettings>(key: K, value: PayrollExportSettings[K]) => {
    setPayroll(prev => ({ ...prev, [key]: value }))
    setIsDirty(true)
  }

  const handlePreview = async () => {
    if (!locationId || !previewStartDate || !previewEndDate) {
      toast.error('Please select a date range')
      return
    }
    try {
      setIsPreviewLoading(true)
      const res = await fetch(
        `/api/payroll/export?locationId=${locationId}&startDate=${previewStartDate}&endDate=${previewEndDate}&employeeId=${employee?.id}`,
      )
      if (!res.ok) throw new Error('Failed to load preview')
      const json = await res.json()
      setPreview(json.data)
    } catch {
      toast.error('Failed to generate payroll preview')
    } finally {
      setIsPreviewLoading(false)
    }
  }

  const handleExport = async () => {
    if (!locationId || !previewStartDate || !previewEndDate) {
      toast.error('Please select a date range')
      return
    }
    try {
      setIsExporting(true)
      const format = payroll.provider === 'none' ? 'csv' : payroll.provider
      const res = await fetch('/api/payroll/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          startDate: previewStartDate,
          endDate: previewEndDate,
          format,
          employeeId: employee?.id,
        }),
      })
      if (!res.ok) throw new Error('Failed to generate export')
      const json = await res.json()
      const { fileContent, fileName } = json.data

      // Trigger download
      const blob = new Blob([fileContent], { type: 'text/csv' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      toast.success(`Payroll export downloaded (${json.data.employeeCount} employees)`)
    } catch {
      toast.error('Failed to export payroll')
    } finally {
      setIsExporting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <AdminPageHeader
          title="Payroll Export"
          subtitle="Loading..."
          breadcrumbs={[{ label: 'Settings', href: '/settings' }]}
        />
      </div>
    )
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      <AdminPageHeader
        title="Payroll Export"
        subtitle="Export time clock, tips, and commission data for payroll processing"
        breadcrumbs={[{ label: 'Settings', href: '/settings' }]}
      />

      {/* Configuration */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Export Configuration</h2>

        <ToggleRow
          label="Enable Payroll Export"
          description="Allow generating payroll export files from the POS"
          checked={payroll.enabled}
          onChange={v => update('enabled', v)}
        />

        {payroll.enabled && (
          <>
            <div className="flex items-center justify-between py-3 border-t border-gray-100">
              <div>
                <div className="text-sm text-gray-900">Payroll Provider</div>
                <div className="text-xs text-gray-600">Format the export for your payroll provider</div>
              </div>
              <select
                value={payroll.provider}
                onChange={e => update('provider', e.target.value as PayrollExportSettings['provider'])}
                className="px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="none">Generic CSV</option>
                <option value="adp">ADP</option>
                <option value="gusto">Gusto</option>
                <option value="paychex">Paychex</option>
                <option value="csv">Standard CSV</option>
              </select>
            </div>

            <div className="flex items-center justify-between py-3 border-t border-gray-100">
              <div>
                <div className="text-sm text-gray-900">Pay Period</div>
                <div className="text-xs text-gray-600">How often do you run payroll?</div>
              </div>
              <select
                value={payroll.payPeriod}
                onChange={e => update('payPeriod', e.target.value as PayrollExportSettings['payPeriod'])}
                className="px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                <option value="weekly">Weekly</option>
                <option value="biweekly">Bi-Weekly</option>
                <option value="semimonthly">Semi-Monthly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>

            <ToggleRow
              label="Include Time Clock Data"
              description="Include regular hours, overtime, and break data"
              checked={payroll.includeTimeClock}
              onChange={v => update('includeTimeClock', v)}
              border
            />

            <ToggleRow
              label="Include Tips"
              description="Include cash tips, card tips, tip-outs, and tip bank data"
              checked={payroll.includeTips}
              onChange={v => update('includeTips', v)}
              border
            />

            <ToggleRow
              label="Include Breaks"
              description="Include paid and unpaid break hours"
              checked={payroll.includeBreaks}
              onChange={v => update('includeBreaks', v)}
              border
            />
          </>
        )}
      </div>

      {/* Export Tools */}
      {payroll.enabled && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
          <h2 className="text-lg font-semibold text-gray-900">Generate Export</h2>

          <div className="flex flex-wrap items-end gap-4">
            <div>
              <label className="block text-sm text-gray-900 mb-1">Start Date</label>
              <input
                type="date"
                value={previewStartDate}
                onChange={e => setPreviewStartDate(e.target.value)}
                className="px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-900 mb-1">End Date</label>
              <input
                type="date"
                value={previewEndDate}
                onChange={e => setPreviewEndDate(e.target.value)}
                className="px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </div>
            <button
              onClick={handlePreview}
              disabled={isPreviewLoading}
              className="px-4 py-2 bg-gray-100 text-gray-900 rounded-lg text-sm font-medium hover:bg-gray-200 disabled:opacity-50"
            >
              {isPreviewLoading ? 'Loading...' : 'Preview'}
            </button>
            <button
              onClick={handleExport}
              disabled={isExporting}
              className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              {isExporting ? 'Exporting...' : 'Export Payroll'}
            </button>
          </div>

          {/* Preview Table */}
          {preview && (
            <div className="mt-4">
              <div className="flex items-center gap-4 mb-3">
                <span className="text-sm text-gray-600">
                  {preview.totals.employeeCount} employees | {preview.startDate} to {preview.endDate}
                </span>
              </div>

              {/* Summary cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                <div className="bg-blue-50 rounded-lg p-3">
                  <div className="text-xs text-blue-600 font-medium">Regular Hours</div>
                  <div className="text-lg font-bold text-blue-900">{preview.totals.totalRegularHours.toFixed(1)}</div>
                </div>
                <div className="bg-amber-50 rounded-lg p-3">
                  <div className="text-xs text-amber-600 font-medium">OT Hours</div>
                  <div className="text-lg font-bold text-amber-900">{preview.totals.totalOvertimeHours.toFixed(1)}</div>
                </div>
                <div className="bg-green-50 rounded-lg p-3">
                  <div className="text-xs text-green-600 font-medium">Total Tips</div>
                  <div className="text-lg font-bold text-green-900">${preview.totals.totalTips.toFixed(2)}</div>
                </div>
                <div className="bg-indigo-50 rounded-lg p-3">
                  <div className="text-xs text-indigo-600 font-medium">Gross Pay</div>
                  <div className="text-lg font-bold text-indigo-900">${preview.totals.totalGrossPay.toFixed(2)}</div>
                </div>
              </div>

              {/* Employee table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-900 border-b border-gray-200">
                      <th className="pb-2 pr-4">Employee</th>
                      <th className="pb-2 pr-4">Role</th>
                      <th className="pb-2 pr-4 text-right">Reg Hrs</th>
                      <th className="pb-2 pr-4 text-right">OT Hrs</th>
                      <th className="pb-2 pr-4 text-right">Tips</th>
                      <th className="pb-2 pr-4 text-right">Commission</th>
                      <th className="pb-2 text-right">Gross Pay</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.records.map(r => (
                      <tr key={r.employeeId} className="border-b border-gray-100">
                        <td className="py-2 pr-4 text-gray-900">{r.employeeName}</td>
                        <td className="py-2 pr-4 text-gray-600">{r.role}</td>
                        <td className="py-2 pr-4 text-right">{r.regularHours.toFixed(1)}</td>
                        <td className="py-2 pr-4 text-right">{r.overtimeHours > 0 ? r.overtimeHours.toFixed(1) : '-'}</td>
                        <td className="py-2 pr-4 text-right">${r.totalTipCompensation.toFixed(2)}</td>
                        <td className="py-2 pr-4 text-right">{r.commissionEarned > 0 ? `$${r.commissionEarned.toFixed(2)}` : '-'}</td>
                        <td className="py-2 text-right font-medium">${r.grossPay.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      <SettingsSaveBar isDirty={isDirty} isSaving={isSaving} onSave={handleSave} />
    </div>
  )
}
