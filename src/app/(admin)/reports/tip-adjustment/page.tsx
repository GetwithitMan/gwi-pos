'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { formatCurrency } from '@/lib/utils'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { toast } from '@/stores/toast-store'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TipAdjustmentTransaction {
  paymentId: string
  orderId: string
  orderNumber: number
  tableId: string | null
  tableName: string | null
  employeeId: string | null
  employeeName: string
  subtotal: number
  tipAmount: number
  total: number
  paidAt: string
  paymentMethod: string
  cardBrand: string | null
  cardLast4: string | null
  entryMethod: string | null
  recordNo: string | null
  readerId: string | null
  purchaseAmount: number
}

interface ReportSummary {
  totalTransactions: number
  totalTips: number
  avgTipPct: number
}

interface TipAdjustmentReport {
  transactions: TipAdjustmentTransaction[]
  summary: ReportSummary
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function TipAdjustmentReportPage() {
  const hydrated = useAuthenticationGuard({
    redirectUrl: '/login?redirect=/reports/tip-adjustment',
  })
  const employee = useAuthStore((s) => s.employee)

  const todayStr = new Date().toISOString().split('T')[0]
  const [startDate, setStartDate] = useState(todayStr)
  const [endDate, setEndDate] = useState(todayStr)
  const [report, setReport] = useState<TipAdjustmentReport | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Per-row editing state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftTips, setDraftTips] = useState<Record<string, string>>({})
  const [savingId, setSavingId] = useState<string | null>(null)

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  const loadReport = useCallback(async () => {
    if (!employee?.location?.id) return
    setIsLoading(true)
    try {
      const params = new URLSearchParams({
        locationId: employee.location.id,
        requestingEmployeeId: employee.id,
        startDate,
        endDate,
      })
      const res = await fetch(`/api/reports/tip-adjustment?${params}`)
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to load report')
      }
      const json = await res.json()
      setReport(json.data)
    } catch (error) {
      console.error('[tip-adjustment] load error:', error)
      toast.error('Failed to load tip adjustment report')
    } finally {
      setIsLoading(false)
    }
  }, [employee?.location?.id, employee?.id, startDate, endDate])

  useEffect(() => {
    if (employee?.location?.id) {
      loadReport()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employee?.location?.id])

  // ---------------------------------------------------------------------------
  // Tip adjustment handler
  // ---------------------------------------------------------------------------

  const handleSave = async (tx: TipAdjustmentTransaction) => {
    const draftStr = draftTips[tx.paymentId]
    const newTip = parseFloat(draftStr)

    if (isNaN(newTip) || newTip < 0) {
      toast.error('Enter a valid tip amount (0 or greater)')
      return
    }

    if (Math.abs(newTip - tx.tipAmount) < 0.005) {
      // No actual change
      setEditingId(null)
      return
    }

    if (!tx.recordNo) {
      toast.error('No Datacap RecordNo for this payment — cannot adjust via processor')
      return
    }

    if (!tx.readerId) {
      toast.error('No reader ID for this payment — cannot adjust via processor')
      return
    }

    setSavingId(tx.paymentId)
    try {
      // Step 1: Adjust gratuity on the card processor via Datacap AdjustByRecordNo
      const adjustRes = await fetch('/api/datacap/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId: employee?.location?.id,
          readerId: tx.readerId,
          recordNo: tx.recordNo,
          purchaseAmount: tx.purchaseAmount,
          gratuityAmount: newTip,
          employeeId: employee?.id,
        }),
      })

      const adjustData = await adjustRes.json()

      if (!adjustRes.ok || !adjustData.data?.approved) {
        const errMsg =
          adjustData.data?.error?.message ||
          adjustData.error ||
          'Processor rejected tip adjustment'
        toast.error(errMsg)
        return
      }

      // Step 2: Persist updated tip amount in the database
      const batchRes = await fetch('/api/orders/batch-adjust-tips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adjustments: [
            {
              orderId: tx.orderId,
              paymentId: tx.paymentId,
              tipAmount: newTip,
            },
          ],
          employeeId: employee?.id,
        }),
      })

      if (!batchRes.ok) {
        const batchErr = await batchRes.json().catch(() => ({}))
        throw new Error(batchErr.error || 'Failed to save tip in database')
      }

      // Step 3: Optimistic update in local state
      setReport((prev) => {
        if (!prev) return prev
        const updated = prev.transactions.map((t) =>
          t.paymentId === tx.paymentId
            ? {
                ...t,
                tipAmount: newTip,
                total: t.purchaseAmount + newTip,
              }
            : t
        )
        const totalTips = updated.reduce((sum, t) => sum + t.tipAmount, 0)
        const totalSubtotal = updated.reduce((sum, t) => sum + t.subtotal, 0)
        const avgTipPct =
          totalSubtotal > 0
            ? Math.round((totalTips / totalSubtotal) * 10000) / 100
            : 0
        return {
          transactions: updated,
          summary: {
            ...prev.summary,
            totalTips: Math.round(totalTips * 100) / 100,
            avgTipPct,
          },
        }
      })

      toast.success(
        `Tip for order #${tx.orderNumber} adjusted to ${formatCurrency(newTip)}`
      )
      setEditingId(null)
    } catch (error) {
      console.error('[tip-adjustment] save error:', error)
      toast.error(
        error instanceof Error ? error.message : 'Tip adjustment failed'
      )
    } finally {
      setSavingId(null)
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })

  const startEdit = (tx: TipAdjustmentTransaction) => {
    setEditingId(tx.paymentId)
    setDraftTips((prev) => ({
      ...prev,
      [tx.paymentId]: tx.tipAmount.toFixed(2),
    }))
  }

  const cancelEdit = () => setEditingId(null)

  // ---------------------------------------------------------------------------
  // Guard
  // ---------------------------------------------------------------------------

  if (!hydrated) return null

  const transactions = report?.transactions ?? []
  const summary = report?.summary

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Tip Adjustment Report"
        subtitle={employee?.location?.name}
        breadcrumbs={[{ label: 'Reports', href: '/reports' }]}
      />

      <div className="max-w-7xl mx-auto">
        {/* ------------------------------------------------------------------ */}
        {/* Date filter bar                                                      */}
        {/* ------------------------------------------------------------------ */}
        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-4 items-end">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Start Date
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  End Date
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <Button
                variant="primary"
                onClick={loadReport}
                disabled={isLoading}
              >
                {isLoading ? 'Loading...' : 'Apply Filters'}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* ------------------------------------------------------------------ */}
        {/* Summary cards                                                        */}
        {/* ------------------------------------------------------------------ */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">Total Transactions</p>
                <p className="text-2xl font-bold text-blue-600">
                  {summary.totalTransactions}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">Total Tips</p>
                <p className="text-2xl font-bold text-green-600">
                  {formatCurrency(summary.totalTips)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4">
                <p className="text-xs text-gray-500">Avg Tip %</p>
                <p className="text-2xl font-bold text-orange-600">
                  {summary.avgTipPct.toFixed(1)}%
                </p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ------------------------------------------------------------------ */}
        {/* Transactions table                                                   */}
        {/* ------------------------------------------------------------------ */}
        <Card>
          <CardHeader>
            <CardTitle>Card Transactions</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 text-center">
                <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-3" />
                <p className="text-gray-500">Loading transactions...</p>
              </div>
            ) : transactions.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                No card transactions found for the selected date range.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">
                        Time
                      </th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">
                        Order #
                      </th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">
                        Table
                      </th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">
                        Server
                      </th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-500">
                        Card
                      </th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">
                        Subtotal
                      </th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">
                        Original Tip
                      </th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">
                        Adjusted Tip
                      </th>
                      <th className="px-4 py-3 text-right text-sm font-medium text-gray-500">
                        Total
                      </th>
                      <th className="px-4 py-3 text-center text-sm font-medium text-gray-500">
                        Action
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((tx) => {
                      const isEditing = editingId === tx.paymentId
                      const isSaving = savingId === tx.paymentId
                      const canAdjust = !!tx.recordNo && !!tx.readerId

                      return (
                        <tr
                          key={tx.paymentId}
                          className="border-t hover:bg-gray-50"
                        >
                          {/* Time */}
                          <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                            {formatTime(tx.paidAt)}
                          </td>

                          {/* Order # */}
                          <td className="px-4 py-3 font-medium">
                            #{tx.orderNumber}
                          </td>

                          {/* Table */}
                          <td className="px-4 py-3 text-sm text-gray-700">
                            {tx.tableName ?? (tx.tableId ? tx.tableId : '—')}
                          </td>

                          {/* Server */}
                          <td className="px-4 py-3 text-sm text-gray-700">
                            {tx.employeeName}
                          </td>

                          {/* Card brand + last4 */}
                          <td className="px-4 py-3 text-sm">
                            <span className="font-medium">
                              {tx.cardBrand || 'Card'}
                            </span>
                            {tx.cardLast4 && (
                              <span className="text-gray-400 ml-1">
                                ***{tx.cardLast4}
                              </span>
                            )}
                          </td>

                          {/* Subtotal */}
                          <td className="px-4 py-3 text-right font-mono text-sm">
                            {formatCurrency(tx.subtotal)}
                          </td>

                          {/* Original tip */}
                          <td className="px-4 py-3 text-right font-mono text-sm text-green-600">
                            {formatCurrency(tx.tipAmount)}
                          </td>

                          {/* Adjusted tip (editable) */}
                          <td className="px-4 py-3 text-right">
                            {isEditing ? (
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                value={
                                  draftTips[tx.paymentId] ??
                                  tx.tipAmount.toFixed(2)
                                }
                                onChange={(e) =>
                                  setDraftTips((prev) => ({
                                    ...prev,
                                    [tx.paymentId]: e.target.value,
                                  }))
                                }
                                className="w-24 px-2 py-1 border rounded text-right font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleSave(tx)
                                  if (e.key === 'Escape') cancelEdit()
                                }}
                              />
                            ) : (
                              <span className="text-gray-400 text-sm">—</span>
                            )}
                          </td>

                          {/* Total */}
                          <td className="px-4 py-3 text-right font-mono text-sm font-semibold">
                            {formatCurrency(tx.total)}
                          </td>

                          {/* Action */}
                          <td className="px-4 py-3 text-center">
                            {isEditing ? (
                              <div className="flex gap-1 justify-center">
                                <Button
                                  variant="primary"
                                  size="sm"
                                  onClick={() => handleSave(tx)}
                                  disabled={isSaving}
                                >
                                  {isSaving ? 'Saving...' : 'Save'}
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={cancelEdit}
                                  disabled={isSaving}
                                >
                                  Cancel
                                </Button>
                              </div>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => startEdit(tx)}
                                disabled={!canAdjust}
                                title={
                                  !canAdjust
                                    ? 'No Datacap RecordNo — adjustment unavailable'
                                    : 'Adjust tip'
                                }
                              >
                                Adjust
                              </Button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  {summary && transactions.length > 1 && (
                    <tfoot className="bg-gray-100 border-t">
                      <tr>
                        <td
                          colSpan={5}
                          className="px-4 py-3 font-bold text-sm"
                        >
                          TOTALS
                        </td>
                        <td className="px-4 py-3 text-right font-bold font-mono text-sm">
                          {formatCurrency(
                            transactions.reduce((s, t) => s + t.subtotal, 0)
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-bold font-mono text-sm text-green-600">
                          {formatCurrency(summary.totalTips)}
                        </td>
                        <td className="px-4 py-3" />
                        <td className="px-4 py-3 text-right font-bold font-mono text-sm">
                          {formatCurrency(
                            transactions.reduce((s, t) => s + t.total, 0)
                          )}
                        </td>
                        <td className="px-4 py-3" />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
