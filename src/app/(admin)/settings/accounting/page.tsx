'use client'

import { useState, useEffect, useCallback } from 'react'
import { toast } from '@/stores/toast-store'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { ToggleRow } from '@/components/admin/settings'
import { useRequireAuth } from '@/hooks/useRequireAuth'
import { useUnsavedWarning } from '@/hooks/useUnsavedWarning'
import { loadSettings as loadSettingsApi, saveSettings as saveSettingsApi } from '@/lib/api/settings-client'
import type { AccountingSettings, AccountingGLMapping } from '@/lib/settings'
import { DEFAULT_ACCOUNTING_SETTINGS, DEFAULT_GL_MAPPING } from '@/lib/settings'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ExportHistoryItem {
  id: string
  date: string
  format: string
  exportedAt: string
  exportedBy: string
  entryCount: number
  totalDebits: number
  totalCredits: number
  isBalanced: boolean
}

interface JournalPreview {
  date: string
  entries: { date: string; accountCode: string; accountName: string; debit: number; credit: number; memo: string }[]
  totalDebits: number
  totalCredits: number
  isBalanced: boolean
  entryCount: number
  summary: Record<string, unknown>
}

// ─── GL Mapping Labels ───────────────────────────────────────────────────────

const GL_FIELDS: { key: keyof AccountingGLMapping; label: string; description: string }[] = [
  { key: 'salesRevenue', label: 'Sales Revenue', description: 'Income from food, drink, and retail sales' },
  { key: 'cashPayments', label: 'Cash Payments', description: 'Cash received from customers' },
  { key: 'cardPayments', label: 'Card Payments', description: 'Credit and debit card receivables' },
  { key: 'giftCardPayments', label: 'Gift Card Payments', description: 'Gift card redemptions' },
  { key: 'houseAccountPayments', label: 'House Account Payments', description: 'House account charges receivable' },
  { key: 'taxCollected', label: 'Tax Collected', description: 'Sales tax payable to government' },
  { key: 'tipsPayable', label: 'Tips Payable', description: 'Tips owed to employees' },
  { key: 'discounts', label: 'Discounts', description: 'Discounts and allowances (contra-revenue)' },
  { key: 'refunds', label: 'Refunds', description: 'Refunds issued to customers' },
  { key: 'comps', label: 'Comps', description: 'Comped items and write-offs' },
  { key: 'cogs', label: 'Cost of Goods Sold', description: 'Cost of ingredients and products sold' },
  { key: 'laborCost', label: 'Labor Cost', description: 'Employee wages and labor expense' },
]

// ─── Component ───────────────────────────────────────────────────────────────

export default function AccountingSettingsPage() {
  const { employee } = useRequireAuth()

  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [locationId, setLocationId] = useState<string>('')

  const [accounting, setAccounting] = useState<AccountingSettings>({ ...DEFAULT_ACCOUNTING_SETTINGS })

  // Preview & export state
  const [previewDate, setPreviewDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 1) // Default to yesterday
    return d.toISOString().split('T')[0]
  })
  const [preview, setPreview] = useState<JournalPreview | null>(null)
  const [isLoadingPreview, setIsLoadingPreview] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [exportFormat, setExportFormat] = useState<string>('csv')

  // Export history
  const [history, setHistory] = useState<ExportHistoryItem[]>([])
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)

  useUnsavedWarning(isDirty)

  // ─── Load Settings ──────────────────────────────────────────────────
  const loadSettings = useCallback(() => {
    const controller = new AbortController()
    ;(async () => {
      try {
        setIsLoading(true)
        const data = await loadSettingsApi(controller.signal)
        setLocationId(data.locationId || '')
        const acct = data.settings.accounting ?? { ...DEFAULT_ACCOUNTING_SETTINGS }
        setAccounting({
          ...DEFAULT_ACCOUNTING_SETTINGS,
          ...acct,
          glMapping: { ...DEFAULT_GL_MAPPING, ...acct.glMapping },
        })
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

  // ─── Load Export History ────────────────────────────────────────────
  const loadHistory = useCallback(async () => {
    if (!locationId) return
    try {
      setIsLoadingHistory(true)
      const res = await fetch(`/api/accounting/history?locationId=${locationId}&limit=20`)
      if (res.ok) {
        const data = await res.json()
        setHistory(data.data?.history || [])
      }
    } catch {
      // Silently fail — history is not critical
    } finally {
      setIsLoadingHistory(false)
    }
  }, [locationId])

  useEffect(() => {
    if (locationId) {
      void loadHistory()
    }
  }, [locationId, loadHistory])

  // ─── Save Settings ─────────────────────────────────────────────────
  const handleSave = async () => {
    try {
      setIsSaving(true)
      const data = await saveSettingsApi({ accounting }, employee?.id)
      const savedAcct = data.settings.accounting ?? { ...DEFAULT_ACCOUNTING_SETTINGS }
      setAccounting({
        ...DEFAULT_ACCOUNTING_SETTINGS,
        ...savedAcct,
        glMapping: { ...DEFAULT_GL_MAPPING, ...savedAcct.glMapping },
      })
      setIsDirty(false)
      toast.success('Accounting settings saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setIsSaving(false)
    }
  }

  // ─── Preview Journal ───────────────────────────────────────────────
  const handlePreview = async () => {
    if (!locationId || !previewDate) return
    try {
      setIsLoadingPreview(true)
      setPreview(null)
      const res = await fetch(`/api/accounting/export?date=${previewDate}&locationId=${locationId}`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Preview failed' }))
        toast.error(data.error || 'Failed to generate preview')
        return
      }
      const data = await res.json()
      setPreview(data.data)
    } catch {
      toast.error('Failed to generate journal preview')
    } finally {
      setIsLoadingPreview(false)
    }
  }

  // ─── Export Journal ────────────────────────────────────────────────
  const handleExport = async () => {
    if (!locationId || !previewDate) return
    try {
      setIsExporting(true)
      const res = await fetch('/api/accounting/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: previewDate,
          format: exportFormat,
          locationId,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Export failed' }))
        toast.error(data.error || 'Failed to export journal')
        return
      }

      // Trigger file download
      const blob = await res.blob()
      const disposition = res.headers.get('Content-Disposition') || ''
      const filenameMatch = disposition.match(/filename="?([^"]+)"?/)
      const filename = filenameMatch ? filenameMatch[1] : `journal-${previewDate}.${exportFormat === 'quickbooks_iif' ? 'iif' : 'csv'}`

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)

      toast.success(`Journal exported as ${exportFormat.toUpperCase()}`)

      // Refresh history
      void loadHistory()
    } catch {
      toast.error('Failed to export journal')
    } finally {
      setIsExporting(false)
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  const updateAccounting = <K extends keyof AccountingSettings>(key: K, value: AccountingSettings[K]) => {
    setAccounting(prev => ({ ...prev, [key]: value }))
    setIsDirty(true)
  }

  const updateGLMapping = (key: keyof AccountingGLMapping, value: string) => {
    setAccounting(prev => ({
      ...prev,
      glMapping: { ...prev.glMapping, [key]: value },
    }))
    setIsDirty(true)
  }

  // ─── Loading State ─────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <AdminPageHeader
          title="Accounting Integration"
          subtitle="Loading..."
          breadcrumbs={[{ label: 'Settings', href: '/settings' }]}
        />
        <div className="flex items-center justify-center py-20">
          <div className="text-gray-900 text-lg">Loading accounting settings...</div>
        </div>
      </div>
    )
  }

  // ─── Render ────────────────────────────────────────────────────────

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <AdminPageHeader
        title="Accounting Integration"
        subtitle="Export daily sales journals to QuickBooks, Xero, or CSV. Map GL accounts to match your chart of accounts."
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
                  : 'bg-gray-200 text-gray-900 cursor-not-allowed'
              }`}
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        }
      />

      <div className="max-w-3xl mx-auto space-y-6 pb-16">

        {/* ═══════════════════════════════════════════
            Card 1: Provider & Auto-Export
            ═══════════════════════════════════════════ */}
        <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">Provider & Auto-Export</h2>
          <p className="text-sm text-gray-600 mb-5">Choose your accounting software and configure automatic daily exports.</p>

          <div className="space-y-4">
            <ToggleRow
              label="Enable Accounting Integration"
              description="Turn on daily sales journal generation and export capabilities"
              checked={accounting.enabled}
              onChange={v => updateAccounting('enabled', v)}
            />

            {accounting.enabled && (
              <>
                {/* Provider Selector */}
                <div className="py-3 border-t border-gray-100">
                  <label className="block text-sm font-medium text-gray-900 mb-1">Accounting Provider</label>
                  <p className="text-xs text-gray-900 mb-2">Select your accounting software for format-specific exports</p>
                  <select
                    value={accounting.provider}
                    onChange={e => updateAccounting('provider', e.target.value as AccountingSettings['provider'])}
                    className="w-full max-w-xs px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="none">None (CSV Only)</option>
                    <option value="quickbooks">QuickBooks</option>
                    <option value="xero">Xero</option>
                    <option value="csv">CSV (Universal)</option>
                  </select>
                </div>

                {/* Auto-Export Toggle */}
                <ToggleRow
                  label="Auto-Export Daily"
                  description="Automatically generate and save yesterday's journal at the configured time"
                  checked={accounting.autoExportDaily}
                  onChange={v => updateAccounting('autoExportDaily', v)}
                  border
                />

                {/* Export Time */}
                {accounting.autoExportDaily && (
                  <div className="py-3 border-t border-gray-100 pl-4">
                    <label className="block text-sm font-medium text-gray-900 mb-1">Export Time</label>
                    <p className="text-xs text-gray-900 mb-2">When to run the daily auto-export (24-hour format)</p>
                    <input
                      type="time"
                      value={accounting.exportTime}
                      onChange={e => updateAccounting('exportTime', e.target.value)}
                      className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        {/* ═══════════════════════════════════════════
            Card 2: GL Account Mapping
            ═══════════════════════════════════════════ */}
        {accounting.enabled && (
          <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">GL Account Mapping</h2>
            <p className="text-sm text-gray-600 mb-5">
              Map each line item to your chart of accounts. Use account codes that match your accounting software.
            </p>

            <div className="space-y-3">
              {GL_FIELDS.map(field => (
                <div key={field.key} className="flex items-start gap-4 py-2 border-b border-gray-50 last:border-0">
                  <div className="flex-1 min-w-0">
                    <label className="block text-sm font-medium text-gray-900">{field.label}</label>
                    <p className="text-xs text-gray-900">{field.description}</p>
                  </div>
                  <input
                    type="text"
                    value={accounting.glMapping[field.key]}
                    onChange={e => updateGLMapping(field.key, e.target.value)}
                    placeholder={DEFAULT_GL_MAPPING[field.key]}
                    className="w-28 px-3 py-1.5 border border-gray-300 rounded-lg text-sm text-right font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
              ))}
            </div>

            <div className="mt-4 pt-3 border-t border-gray-100">
              <button
                type="button"
                onClick={() => {
                  setAccounting(prev => ({ ...prev, glMapping: { ...DEFAULT_GL_MAPPING } }))
                  setIsDirty(true)
                }}
                className="text-sm text-gray-900 hover:text-gray-900 underline"
              >
                Reset to defaults
              </button>
            </div>
          </section>
        )}

        {/* ═══════════════════════════════════════════
            Card 3: Preview & Export
            ═══════════════════════════════════════════ */}
        {accounting.enabled && (
          <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Preview & Export</h2>
            <p className="text-sm text-gray-600 mb-5">Generate and download daily sales journals.</p>

            <div className="flex flex-wrap items-end gap-3 mb-4">
              <div>
                <label className="block text-xs font-medium text-gray-900 mb-1">Business Date</label>
                <input
                  type="date"
                  value={previewDate}
                  onChange={e => setPreviewDate(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <button
                type="button"
                onClick={handlePreview}
                disabled={isLoadingPreview}
                className="px-4 py-2 bg-gray-100 text-gray-900 rounded-lg text-sm font-medium hover:bg-gray-200 disabled:opacity-50 transition-all"
              >
                {isLoadingPreview ? 'Loading...' : 'Preview Journal'}
              </button>

              <div>
                <label className="block text-xs font-medium text-gray-900 mb-1">Format</label>
                <select
                  value={exportFormat}
                  onChange={e => setExportFormat(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="csv">CSV (Universal)</option>
                  <option value="quickbooks_iif">QuickBooks IIF</option>
                  <option value="xero_csv">Xero CSV</option>
                  <option value="json">JSON</option>
                </select>
              </div>

              <button
                type="button"
                onClick={handleExport}
                disabled={isExporting}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50 shadow-sm transition-all"
              >
                {isExporting ? 'Exporting...' : 'Export Now'}
              </button>
            </div>

            {/* Preview Table */}
            {preview && (
              <div className="mt-4">
                {/* Balance Badge */}
                <div className="flex items-center gap-3 mb-3">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    preview.isBalanced
                      ? 'bg-green-100 text-green-800'
                      : 'bg-red-100 text-red-800'
                  }`}>
                    {preview.isBalanced ? 'Balanced' : 'UNBALANCED'}
                  </span>
                  <span className="text-sm text-gray-600">
                    {preview.entryCount} entries | Debits: ${preview.totalDebits.toFixed(2)} | Credits: ${preview.totalCredits.toFixed(2)}
                  </span>
                </div>

                {/* Entries Table */}
                <div className="overflow-x-auto border border-gray-200 rounded-lg">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-900 uppercase">Account</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-900 uppercase">Name</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-900 uppercase">Debit</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-900 uppercase">Credit</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-900 uppercase">Memo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {preview.entries.map((entry, i) => (
                        <tr key={i} className="hover:bg-gray-50">
                          <td className="px-3 py-2 font-mono text-gray-900">{entry.accountCode}</td>
                          <td className="px-3 py-2 text-gray-900">{entry.accountName}</td>
                          <td className="px-3 py-2 text-right text-gray-900">{entry.debit > 0 ? `$${entry.debit.toFixed(2)}` : ''}</td>
                          <td className="px-3 py-2 text-right text-gray-900">{entry.credit > 0 ? `$${entry.credit.toFixed(2)}` : ''}</td>
                          <td className="px-3 py-2 text-gray-900 text-xs">{entry.memo}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-gray-50 font-semibold">
                      <tr>
                        <td className="px-3 py-2" colSpan={2}>Totals</td>
                        <td className="px-3 py-2 text-right">${preview.totalDebits.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right">${preview.totalCredits.toFixed(2)}</td>
                        <td className="px-3 py-2"></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}
          </section>
        )}

        {/* ═══════════════════════════════════════════
            Card 4: Export History
            ═══════════════════════════════════════════ */}
        {accounting.enabled && (
          <section className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-1">Export History</h2>
            <p className="text-sm text-gray-600 mb-4">Past journal exports.</p>

            {isLoadingHistory ? (
              <div className="text-sm text-gray-900 py-4">Loading history...</div>
            ) : history.length === 0 ? (
              <div className="text-sm text-gray-900 py-4">No exports yet. Use the Preview & Export section above to generate your first journal.</div>
            ) : (
              <div className="overflow-x-auto border border-gray-200 rounded-lg">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-900 uppercase">Date</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-900 uppercase">Format</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-900 uppercase">Exported At</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-900 uppercase">By</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-gray-900 uppercase">Entries</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-gray-900 uppercase">Debits</th>
                      <th className="px-3 py-2 text-center text-xs font-medium text-gray-900 uppercase">Balanced</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {history.map(item => (
                      <tr key={item.id} className="hover:bg-gray-50">
                        <td className="px-3 py-2 text-gray-900 font-medium">{item.date}</td>
                        <td className="px-3 py-2 text-gray-900 uppercase text-xs">{item.format}</td>
                        <td className="px-3 py-2 text-gray-600 text-xs">
                          {new Date(item.exportedAt).toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-gray-600">{item.exportedBy}</td>
                        <td className="px-3 py-2 text-right text-gray-900">{item.entryCount}</td>
                        <td className="px-3 py-2 text-right text-gray-900 font-mono">${item.totalDebits.toFixed(2)}</td>
                        <td className="px-3 py-2 text-center">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                            item.isBalanced
                              ? 'bg-green-100 text-green-800'
                              : 'bg-red-100 text-red-800'
                          }`}>
                            {item.isBalanced ? 'Yes' : 'No'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

      </div>
    </div>
  )
}
