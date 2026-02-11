'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { formatCurrency } from '@/lib/utils'
import { toast } from '@/stores/toast-store'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'

interface PayrollPeriod {
  id: string
  periodStart: string
  periodEnd: string
  periodType: string
  status: 'open' | 'processing' | 'closed' | 'paid'
  closedAt: string | null
  paidAt: string | null
  totals: {
    regularHours: number
    overtimeHours: number
    wages: number
    tips: number
    commissions: number
    bankedTips: number
    grandTotal: number
  }
  employeeCount: number
  notes: string | null
}

interface PayStub {
  id: string
  employee: {
    id: string
    name: string
    role: string
  }
  regularHours: number
  overtimeHours: number
  hourlyRate: number
  regularPay: number
  overtimePay: number
  declaredTips: number
  tipSharesGiven: number
  tipSharesReceived: number
  bankedTipsCollected: number
  netTips: number
  commissionTotal: number
  grossPay: number
  deductions: Record<string, number> | null
  netPay: number
  status: string
  paymentMethod: string | null
  paidAt: string | null
}

export default function PayrollPage() {
  const router = useRouter()
  const { isAuthenticated, employee } = useAuthStore()
  const [periods, setPeriods] = useState<PayrollPeriod[]>([])
  const [selectedPeriod, setSelectedPeriod] = useState<PayrollPeriod | null>(null)
  const [payStubs, setPayStubs] = useState<PayStub[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isProcessing, setIsProcessing] = useState(false)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [newPeriodStart, setNewPeriodStart] = useState('')
  const [newPeriodEnd, setNewPeriodEnd] = useState('')

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login?redirect=/payroll')
      return
    }
    if (employee?.location?.id) {
      loadPeriods()
    }
  }, [isAuthenticated, router, employee?.location?.id])

  const loadPeriods = async () => {
    if (!employee?.location?.id) return

    setIsLoading(true)
    try {
      const response = await fetch(`/api/payroll/periods?locationId=${employee.location.id}`)
      if (response.ok) {
        const data = await response.json()
        setPeriods(data.periods)
      }
    } catch (error) {
      console.error('Failed to load payroll periods:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const loadPeriodDetails = async (periodId: string) => {
    try {
      const response = await fetch(`/api/payroll/periods/${periodId}`)
      if (response.ok) {
        const data = await response.json()
        setSelectedPeriod(data.period)
        setPayStubs(data.payStubs)
      }
    } catch (error) {
      console.error('Failed to load period details:', error)
    }
  }

  const createPeriod = async () => {
    if (!employee?.location?.id || !newPeriodStart || !newPeriodEnd) return

    try {
      const response = await fetch('/api/payroll/periods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId: employee.location.id,
          periodStart: newPeriodStart,
          periodEnd: newPeriodEnd,
          periodType: 'biweekly',
        }),
      })

      if (response.ok) {
        setShowCreateModal(false)
        setNewPeriodStart('')
        setNewPeriodEnd('')
        loadPeriods()
      } else {
        const error = await response.json()
        toast.error(error.error || 'Failed to create period')
      }
    } catch (error) {
      console.error('Failed to create period:', error)
    }
  }

  const processPeriod = async (periodId: string) => {
    setIsProcessing(true)
    try {
      const response = await fetch(`/api/payroll/periods/${periodId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'process' }),
      })

      if (response.ok) {
        loadPeriods()
        loadPeriodDetails(periodId)
      } else {
        const error = await response.json()
        toast.error(error.error || 'Failed to process payroll')
      }
    } catch (error) {
      console.error('Failed to process payroll:', error)
    } finally {
      setIsProcessing(false)
    }
  }

  const closePeriod = async (periodId: string) => {
    try {
      const response = await fetch(`/api/payroll/periods/${periodId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'close', closedBy: employee?.id }),
      })

      if (response.ok) {
        loadPeriods()
        loadPeriodDetails(periodId)
      }
    } catch (error) {
      console.error('Failed to close period:', error)
    }
  }

  const markAsPaid = async (periodId: string) => {
    try {
      const response = await fetch(`/api/payroll/periods/${periodId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pay' }),
      })

      if (response.ok) {
        loadPeriods()
        loadPeriodDetails(periodId)
      }
    } catch (error) {
      console.error('Failed to mark as paid:', error)
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      open: 'bg-yellow-100 text-yellow-800',
      processing: 'bg-blue-100 text-blue-800',
      closed: 'bg-purple-100 text-purple-800',
      paid: 'bg-green-100 text-green-800',
    }
    return (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status] || 'bg-gray-100'}`}>
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    )
  }

  if (!isAuthenticated) return null

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Payroll Management"
        actions={
          <Button variant="primary" onClick={() => setShowCreateModal(true)}>
            + New Pay Period
          </Button>
        }
      />

      <div className="max-w-7xl mx-auto mt-6">
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Periods List */}
          <div className="lg:col-span-1">
            <Card>
              <CardHeader>
                <CardTitle>Pay Periods</CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="text-center py-4 text-gray-500">Loading...</div>
                ) : periods.length === 0 ? (
                  <div className="text-center py-4 text-gray-500">
                    No payroll periods yet.
                    <br />
                    Create one to get started.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {periods.map(period => (
                      <button
                        key={period.id}
                        className={`w-full text-left p-3 rounded-lg border transition-colors ${
                          selectedPeriod?.id === period.id
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-gray-200 hover:bg-gray-50'
                        }`}
                        onClick={() => loadPeriodDetails(period.id)}
                      >
                        <div className="flex justify-between items-start mb-1">
                          <span className="font-medium text-sm">
                            {formatDate(period.periodStart)} - {formatDate(period.periodEnd)}
                          </span>
                          {getStatusBadge(period.status)}
                        </div>
                        <div className="text-xs text-gray-500">
                          {period.employeeCount} employees
                          {period.totals.grandTotal > 0 && (
                            <span className="ml-2">• {formatCurrency(period.totals.grandTotal)}</span>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Period Details */}
          <div className="lg:col-span-2">
            {selectedPeriod ? (
              <div className="space-y-4">
                {/* Period Summary */}
                <Card>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                      <CardTitle>
                        {formatDate(selectedPeriod.periodStart)} - {formatDate(selectedPeriod.periodEnd)}
                      </CardTitle>
                      <p className="text-sm text-gray-500 mt-1">
                        {selectedPeriod.periodType} pay period
                      </p>
                    </div>
                    {getStatusBadge(selectedPeriod.status)}
                  </CardHeader>
                  <CardContent>
                    {/* Summary Cards */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                      <div className="bg-gray-50 p-3 rounded-lg">
                        <p className="text-xs text-gray-500">Total Hours</p>
                        <p className="text-lg font-bold">
                          {(selectedPeriod.totals.regularHours + selectedPeriod.totals.overtimeHours).toFixed(1)}
                        </p>
                        {selectedPeriod.totals.overtimeHours > 0 && (
                          <p className="text-xs text-orange-600">
                            {selectedPeriod.totals.overtimeHours.toFixed(1)} OT
                          </p>
                        )}
                      </div>
                      <div className="bg-blue-50 p-3 rounded-lg">
                        <p className="text-xs text-gray-500">Wages</p>
                        <p className="text-lg font-bold text-blue-600">
                          {formatCurrency(selectedPeriod.totals.wages)}
                        </p>
                      </div>
                      <div className="bg-green-50 p-3 rounded-lg">
                        <p className="text-xs text-gray-500">Tips</p>
                        <p className="text-lg font-bold text-green-600">
                          {formatCurrency(selectedPeriod.totals.tips)}
                        </p>
                      </div>
                      <div className="bg-purple-50 p-3 rounded-lg">
                        <p className="text-xs text-gray-500">Grand Total</p>
                        <p className="text-lg font-bold text-purple-600">
                          {formatCurrency(selectedPeriod.totals.grandTotal)}
                        </p>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2 flex-wrap">
                      {selectedPeriod.status === 'open' && (
                        <Button
                          variant="primary"
                          onClick={() => processPeriod(selectedPeriod.id)}
                          disabled={isProcessing}
                        >
                          {isProcessing ? 'Processing...' : 'Process Payroll'}
                        </Button>
                      )}
                      {selectedPeriod.status === 'processing' && (
                        <>
                          <Button
                            variant="primary"
                            onClick={() => processPeriod(selectedPeriod.id)}
                            disabled={isProcessing}
                          >
                            {isProcessing ? 'Processing...' : 'Recalculate'}
                          </Button>
                          <Button variant="outline" onClick={() => closePeriod(selectedPeriod.id)}>
                            Close Period
                          </Button>
                        </>
                      )}
                      {selectedPeriod.status === 'closed' && (
                        <Button variant="primary" onClick={() => markAsPaid(selectedPeriod.id)}>
                          Mark as Paid
                        </Button>
                      )}
                      {selectedPeriod.status === 'paid' && (
                        <span className="text-green-600 font-medium">
                          Paid on {formatDate(selectedPeriod.paidAt!)}
                        </span>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* Pay Stubs */}
                {payStubs.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Pay Stubs</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        {payStubs.map(stub => (
                          <div key={stub.id} className="border rounded-lg p-4">
                            <div className="flex justify-between items-start mb-4">
                              <div>
                                <h4 className="font-semibold">{stub.employee.name}</h4>
                                <p className="text-sm text-gray-500">{stub.employee.role}</p>
                              </div>
                              <div className="text-right flex items-start gap-3">
                                <div>
                                  <p className="text-2xl font-bold">{formatCurrency(stub.netPay)}</p>
                                  <p className="text-xs text-gray-500">Net Pay</p>
                                </div>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    // Download PDF
                                    window.open(`/api/payroll/pay-stubs/${stub.id}/pdf`, '_blank')
                                  }}
                                  title="Download PDF"
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                  </svg>
                                </Button>
                              </div>
                            </div>

                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                              <div>
                                <p className="text-gray-500">Hours</p>
                                <p className="font-medium">
                                  {stub.regularHours.toFixed(1)} reg
                                  {stub.overtimeHours > 0 && ` + ${stub.overtimeHours.toFixed(1)} OT`}
                                </p>
                              </div>
                              <div>
                                <p className="text-gray-500">Wages</p>
                                <p className="font-medium">
                                  {formatCurrency(stub.regularPay + stub.overtimePay)}
                                </p>
                              </div>
                              <div>
                                <p className="text-gray-500">Tips</p>
                                <p className="font-medium text-green-600">
                                  {formatCurrency(stub.netTips)}
                                </p>
                              </div>
                              <div>
                                <p className="text-gray-500">Gross Pay</p>
                                <p className="font-medium">{formatCurrency(stub.grossPay)}</p>
                              </div>
                            </div>

                            {stub.deductions && Object.keys(stub.deductions).length > 0 && (
                              <div className="mt-3 pt-3 border-t">
                                <p className="text-xs text-gray-500 mb-2">Deductions</p>
                                <div className="flex flex-wrap gap-3 text-xs">
                                  {stub.deductions.federalTax > 0 && (
                                    <span>Federal: -{formatCurrency(stub.deductions.federalTax)}</span>
                                  )}
                                  {stub.deductions.stateTax > 0 && (
                                    <span>State: -{formatCurrency(stub.deductions.stateTax)}</span>
                                  )}
                                  {stub.deductions.socialSecurity > 0 && (
                                    <span>SS: -{formatCurrency(stub.deductions.socialSecurity)}</span>
                                  )}
                                  {stub.deductions.medicare > 0 && (
                                    <span>Medicare: -{formatCurrency(stub.deductions.medicare)}</span>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            ) : (
              <Card>
                <CardContent className="py-12 text-center text-gray-500">
                  Select a pay period to view details
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>

      {/* Create Period Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-full max-w-md mx-4">
            <CardHeader>
              <CardTitle>Create Pay Period</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Period Start
                </label>
                <input
                  type="date"
                  value={newPeriodStart}
                  onChange={(e) => {
                    setNewPeriodStart(e.target.value)
                    // Auto-set end date to 13 days later (2 week period)
                    if (e.target.value) {
                      const start = new Date(e.target.value)
                      start.setDate(start.getDate() + 13)
                      setNewPeriodEnd(start.toISOString().split('T')[0])
                    }
                  }}
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Period End
                </label>
                <input
                  type="date"
                  value={newPeriodEnd}
                  onChange={(e) => setNewPeriodEnd(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg"
                />
              </div>
              <div className="flex gap-2 justify-end pt-4">
                <Button variant="outline" onClick={() => setShowCreateModal(false)}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={createPeriod}
                  disabled={!newPeriodStart || !newPeriodEnd}
                >
                  Create Period
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
