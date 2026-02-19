'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { formatCurrency } from '@/lib/utils'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'

interface VoidLog {
  id: string
  orderId: string
  orderNumber: number
  orderType: string
  tabName: string | null
  voidType: string
  itemId: string | null
  itemName: string | null
  amount: number
  reason: string
  isComp: boolean
  employeeId: string
  employeeName: string
  approvedById: string | null
  approvedAt: string | null
  createdAt: string
}

interface Summary {
  totalVoids: number
  totalComps: number
  voidAmount: number
  compAmount: number
  byEmployee: { name: string; voids: number; comps: number; amount: number }[]
  byReason: { reason: string; count: number; amount: number }[]
}

interface Employee {
  id: string
  displayName?: string
  firstName: string
  lastName: string
}

export default function VoidReportsPage() {
  const router = useRouter()
  const employee = useAuthStore(s => s.employee)
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const [logs, setLogs] = useState<VoidLog[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [employees, setEmployees] = useState<Employee[]>([])

  // Filters
  const [startDate, setStartDate] = useState(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return today.toISOString().split('T')[0]
  })
  const [endDate, setEndDate] = useState(() => {
    return new Date().toISOString().split('T')[0]
  })
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>('')
  const [viewMode, setViewMode] = useState<'logs' | 'byEmployee' | 'byReason'>('logs')

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login?redirect=/reports/voids')
    }
  }, [isAuthenticated, router])

  useEffect(() => {
    if (employee?.location?.id) {
      loadEmployees()
    }
  }, [employee?.location?.id])

  useEffect(() => {
    if (employee?.location?.id) {
      loadReport()
    }
  }, [employee?.location?.id, startDate, endDate, selectedEmployeeId])

  const loadEmployees = async () => {
    if (!employee?.location?.id) return
    try {
      const params = new URLSearchParams({ locationId: employee.location.id })
      const response = await fetch(`/api/employees?${params}`)
      if (response.ok) {
        const data = await response.json()
        setEmployees(data.data.employees || [])
      }
    } catch (error) {
      console.error('Failed to load employees:', error)
    }
  }

  const loadReport = async () => {
    if (!employee?.location?.id) return

    setIsLoading(true)
    try {
      const params = new URLSearchParams({
        locationId: employee.location.id,
        startDate,
        endDate,
        requestingEmployeeId: employee.id,
      })

      if (selectedEmployeeId) {
        params.set('employeeId', selectedEmployeeId)
      }

      const response = await fetch(`/api/reports/voids?${params}`)
      if (response.ok) {
        const data = await response.json()
        setLogs(data.data.logs || [])
        setSummary(data.data.summary || null)
      }
    } catch (error) {
      console.error('Failed to load void report:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const formatDateTime = (dateString: string) => {
    return new Date(dateString).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Void / Comp Report"
        breadcrumbs={[{ label: 'Reports', href: '/reports' }]}
      />

      {/* Filters */}
      <div className="max-w-7xl mx-auto">
        <Card className="p-4">
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="px-3 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="px-3 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Employee</label>
              <select
                value={selectedEmployeeId}
                onChange={(e) => setSelectedEmployeeId(e.target.value)}
                className="px-3 py-2 border rounded-lg min-w-[200px]"
              >
                <option value="">All Employees</option>
                {employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.displayName || `${emp.firstName} ${emp.lastName}`}
                  </option>
                ))}
              </select>
            </div>
            <Button variant="outline" onClick={loadReport}>
              Refresh
            </Button>
          </div>
        </Card>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="max-w-7xl mx-auto px-4 pb-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="p-4 bg-red-50">
              <p className="text-sm text-red-600">Total Voids</p>
              <p className="text-2xl font-bold text-red-700">{summary.totalVoids}</p>
              <p className="text-sm text-red-600">{formatCurrency(summary.voidAmount)}</p>
            </Card>
            <Card className="p-4 bg-blue-50">
              <p className="text-sm text-blue-600">Total Comps</p>
              <p className="text-2xl font-bold text-blue-700">{summary.totalComps}</p>
              <p className="text-sm text-blue-600">{formatCurrency(summary.compAmount)}</p>
            </Card>
            <Card className="p-4 bg-gray-50">
              <p className="text-sm text-gray-600">Total Count</p>
              <p className="text-2xl font-bold">{summary.totalVoids + summary.totalComps}</p>
            </Card>
            <Card className="p-4 bg-gray-50">
              <p className="text-sm text-gray-600">Total Amount</p>
              <p className="text-2xl font-bold">
                {formatCurrency(summary.voidAmount + summary.compAmount)}
              </p>
            </Card>
          </div>
        </div>
      )}

      {/* View Toggle */}
      <div className="max-w-7xl mx-auto px-4 pb-4">
        <div className="flex gap-2">
          <Button
            variant={viewMode === 'logs' ? 'primary' : 'outline'}
            size="sm"
            onClick={() => setViewMode('logs')}
          >
            All Logs
          </Button>
          <Button
            variant={viewMode === 'byEmployee' ? 'primary' : 'outline'}
            size="sm"
            onClick={() => setViewMode('byEmployee')}
          >
            By Employee
          </Button>
          <Button
            variant={viewMode === 'byReason' ? 'primary' : 'outline'}
            size="sm"
            onClick={() => setViewMode('byReason')}
          >
            By Reason
          </Button>
        </div>
      </div>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 pb-8">
        {isLoading ? (
          <div className="text-center py-12 text-gray-500">Loading...</div>
        ) : viewMode === 'logs' ? (
          /* All Logs View */
          logs.length === 0 ? (
            <Card className="p-8 text-center">
              <p className="text-gray-500">No voids or comps found for this period.</p>
            </Card>
          ) : (
            <div className="space-y-2">
              {logs.map((log) => (
                <Card key={log.id} className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-2 py-0.5 text-xs font-medium rounded ${
                            log.isComp
                              ? 'bg-blue-100 text-blue-700'
                              : 'bg-red-100 text-red-700'
                          }`}
                        >
                          {log.isComp ? 'COMP' : 'VOID'}
                        </span>
                        <span className="font-medium">
                          Order #{log.orderNumber}
                          {log.tabName && <span className="text-gray-500"> ({log.tabName})</span>}
                        </span>
                      </div>
                      {log.itemName && (
                        <p className="text-sm text-gray-700 mt-1">Item: {log.itemName}</p>
                      )}
                      <p className="text-sm text-gray-600 mt-1">Reason: {log.reason}</p>
                      <p className="text-xs text-gray-500 mt-1">
                        By {log.employeeName} at {formatDateTime(log.createdAt)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className={`text-lg font-bold ${log.isComp ? 'text-blue-600' : 'text-red-600'}`}>
                        -{formatCurrency(log.amount)}
                      </p>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )
        ) : viewMode === 'byEmployee' ? (
          /* By Employee View */
          summary && summary.byEmployee.length > 0 ? (
            <div className="space-y-2">
              {summary.byEmployee
                .sort((a, b) => b.amount - a.amount)
                .map((emp, idx) => (
                  <Card key={idx} className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">{emp.name}</p>
                        <p className="text-sm text-gray-500">
                          {emp.voids} void(s), {emp.comps} comp(s)
                        </p>
                      </div>
                      <p className="text-lg font-bold text-gray-700">
                        {formatCurrency(emp.amount)}
                      </p>
                    </div>
                  </Card>
                ))}
            </div>
          ) : (
            <Card className="p-8 text-center">
              <p className="text-gray-500">No data available.</p>
            </Card>
          )
        ) : (
          /* By Reason View */
          summary && summary.byReason.length > 0 ? (
            <div className="space-y-2">
              {summary.byReason
                .sort((a, b) => b.amount - a.amount)
                .map((item, idx) => (
                  <Card key={idx} className="p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">{item.reason}</p>
                        <p className="text-sm text-gray-500">{item.count} occurrence(s)</p>
                      </div>
                      <p className="text-lg font-bold text-gray-700">
                        {formatCurrency(item.amount)}
                      </p>
                    </div>
                  </Card>
                ))}
            </div>
          ) : (
            <Card className="p-8 text-center">
              <p className="text-gray-500">No data available.</p>
            </Card>
          )
        )}
      </main>
    </div>
  )
}
