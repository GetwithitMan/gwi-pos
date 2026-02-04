'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { toast } from '@/stores/toast-store'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { AdminSubNav, inventorySubNav } from '@/components/admin/AdminSubNav'

interface TrayConfig {
  id: string
  name: string
  capacity: number
  description?: string | null
}

interface PrepItem {
  id: string
  name: string
  outputUnit: string
  batchYield: number
  costPerUnit: number | null
  currentPrepStock: number
  trayConfigs: TrayConfig[]
  countPrecision: 'whole' | 'decimal'
}

interface CountItem {
  id: string
  prepItemId: string
  totalCounted: number
  trayBreakdown: Record<string, number> | null
  expectedQuantity: number | null
  variance: number | null
  variancePercent: number | null
  prepItem: {
    id: string
    name: string
    outputUnit: string
  }
}

interface DailyPrepCount {
  id: string
  countDate: string
  shiftType: string
  status: string
  notes: string | null
  createdBy: { id: string; firstName: string; lastName: string } | null
  submittedBy: { id: string; firstName: string; lastName: string } | null
  approvedBy: { id: string; firstName: string; lastName: string } | null
  submittedAt: string | null
  approvedAt: string | null
  countItems: CountItem[]
}

const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  draft: { bg: 'bg-gray-100', text: 'text-gray-700', label: 'Draft' },
  submitted: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'Pending Approval' },
  approved: { bg: 'bg-green-100', text: 'text-green-700', label: 'Approved' },
  rejected: { bg: 'bg-red-100', text: 'text-red-700', label: 'Rejected' },
}

export default function DailyPrepCountsPage() {
  const router = useRouter()
  const { employee, isAuthenticated } = useAuthStore()
  const [prepItems, setPrepItems] = useState<PrepItem[]>([])
  const [counts, setCounts] = useState<DailyPrepCount[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // Active count state
  const [activeCount, setActiveCount] = useState<DailyPrepCount | null>(null)
  const [trayEntries, setTrayEntries] = useState<Record<string, Record<string, number>>>({})
  const [manualEntries, setManualEntries] = useState<Record<string, number>>({})
  const [isSaving, setIsSaving] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // View mode
  const [viewMode, setViewMode] = useState<'list' | 'count'>('list')

  // Approval state
  const [isApproving, setIsApproving] = useState(false)
  const [isRejecting, setIsRejecting] = useState(false)
  const [showRejectModal, setShowRejectModal] = useState(false)
  const [rejectionReason, setRejectionReason] = useState('')

  const locationId = employee?.location?.id

  const loadData = useCallback(async () => {
    if (!locationId) return

    try {
      setIsLoading(true)
      const [prepRes, countsRes] = await Promise.all([
        fetch(`/api/inventory/prep-tray-configs?locationId=${locationId}`),
        fetch(`/api/inventory/daily-counts?locationId=${locationId}&limit=20`),
      ])

      if (prepRes.ok) {
        const data = await prepRes.json()
        // Only show items configured for daily counting
        const dailyCountItems = (data.data || []).filter((item: PrepItem & { isDailyCountItem: boolean }) => item.isDailyCountItem)
        setPrepItems(dailyCountItems)
      }

      if (countsRes.ok) {
        const data = await countsRes.json()
        setCounts(data.data || [])
      }
    } catch (error) {
      console.error('Failed to load data:', error)
      toast.error('Failed to load data')
    } finally {
      setIsLoading(false)
    }
  }, [locationId])

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login?redirect=/inventory/daily-prep-counts')
      return
    }
    loadData()
  }, [isAuthenticated, router, loadData])

  // Initialize entries when active count changes
  useEffect(() => {
    if (activeCount) {
      const trayData: Record<string, Record<string, number>> = {}
      const manualData: Record<string, number> = {}

      // Guard against undefined countItems (new counts don't have items yet)
      if (activeCount.countItems && Array.isArray(activeCount.countItems)) {
        for (const item of activeCount.countItems) {
          if (item.trayBreakdown) {
            trayData[item.prepItemId] = item.trayBreakdown
          }
          manualData[item.prepItemId] = item.totalCounted
        }
      }

      setTrayEntries(trayData)
      setManualEntries(manualData)
    }
  }, [activeCount])

  // Calculate total for a prep item from tray entries
  const calculateTotal = useCallback((prepItemId: string): number => {
    const item = prepItems.find(p => p.id === prepItemId)
    if (!item) return 0

    if (item.trayConfigs.length > 0) {
      const entries = trayEntries[prepItemId] || {}
      let total = 0
      for (const tray of item.trayConfigs) {
        const count = entries[tray.id] || 0
        total += count * tray.capacity
      }
      return total
    }

    return manualEntries[prepItemId] || 0
  }, [prepItems, trayEntries, manualEntries])

  // Grand total of all items
  const grandTotal = useMemo(() => {
    return prepItems.reduce((sum, item) => sum + calculateTotal(item.id), 0)
  }, [prepItems, calculateTotal])

  const handleStartNewCount = async () => {
    if (!locationId || !employee?.id) return

    if (prepItems.length === 0) {
      toast.error('No items configured for daily counting. Go to Settings > Daily Counts to configure.')
      return
    }

    try {
      const response = await fetch('/api/inventory/daily-counts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          createdById: employee.id,
          shiftType: 'morning',
          prepItemIds: prepItems.map(p => p.id),
        }),
      })

      if (response.ok) {
        const data = await response.json()
        setActiveCount(data.data)
        setViewMode('count')
        toast.success('Count started')
      } else {
        const errorData = await response.json()
        toast.error(errorData.error || 'Failed to start count')
      }
    } catch (error) {
      console.error('Failed to start count:', error)
      toast.error('Failed to start count')
    }
  }

  const handleTrayChange = (prepItemId: string, trayId: string, value: number) => {
    setTrayEntries(prev => ({
      ...prev,
      [prepItemId]: {
        ...(prev[prepItemId] || {}),
        [trayId]: Math.max(0, value),
      },
    }))
  }

  const handleManualChange = (prepItemId: string, value: number, precision: 'whole' | 'decimal' = 'whole') => {
    const finalValue = precision === 'decimal'
      ? Math.max(0, Math.round(value * 100) / 100) // Round to 2 decimal places
      : Math.max(0, Math.round(value)) // Round to whole number
    setManualEntries(prev => ({
      ...prev,
      [prepItemId]: finalValue,
    }))
  }

  const handleSaveProgress = async () => {
    if (!activeCount) return

    setIsSaving(true)
    try {
      // Build count items data
      const countItems = prepItems.map(item => {
        const total = calculateTotal(item.id)
        const trayBreakdown = item.trayConfigs.length > 0 ? (trayEntries[item.id] || {}) : null

        return {
          prepItemId: item.id,
          totalCounted: total,
          trayBreakdown,
        }
      })

      const response = await fetch(`/api/inventory/daily-counts/${activeCount.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ countItems }),
      })

      if (response.ok) {
        const data = await response.json()
        setActiveCount(data.data)
        toast.success('Progress saved')
      } else {
        toast.error('Failed to save progress')
      }
    } catch (error) {
      console.error('Failed to save progress:', error)
      toast.error('Failed to save progress')
    } finally {
      setIsSaving(false)
    }
  }

  const handleSubmitForApproval = async () => {
    if (!activeCount || !employee?.id) return

    // First save current entries
    await handleSaveProgress()

    setIsSubmitting(true)
    try {
      const response = await fetch(`/api/inventory/daily-counts/${activeCount.id}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submittedById: employee.id }),
      })

      if (response.ok) {
        toast.success('Count submitted for approval')
        setActiveCount(null)
        setViewMode('list')
        loadData()
      } else {
        const errorData = await response.json()
        toast.error(errorData.error || 'Failed to submit count')
      }
    } catch (error) {
      console.error('Failed to submit count:', error)
      toast.error('Failed to submit count')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleViewCount = async (count: DailyPrepCount) => {
    try {
      const response = await fetch(`/api/inventory/daily-counts/${count.id}`)
      if (response.ok) {
        const data = await response.json()
        setActiveCount(data.data)
        setViewMode('count')
      } else {
        toast.error('Failed to load count')
      }
    } catch (error) {
      console.error('Failed to load count:', error)
      toast.error('Failed to load count')
    }
  }

  const handleApprove = async () => {
    if (!activeCount || !employee?.id) return

    setIsApproving(true)
    try {
      const response = await fetch(`/api/inventory/daily-counts/${activeCount.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approvedById: employee.id }),
      })

      if (response.ok) {
        const data = await response.json()
        toast.success('Count approved - inventory updated')
        setActiveCount(data.data)
        loadData()
      } else {
        const errorData = await response.json()
        toast.error(errorData.error || 'Failed to approve count')
      }
    } catch (error) {
      console.error('Failed to approve count:', error)
      toast.error('Failed to approve count')
    } finally {
      setIsApproving(false)
    }
  }

  const handleReject = async () => {
    if (!activeCount || !employee?.id) return

    setIsRejecting(true)
    try {
      const response = await fetch(`/api/inventory/daily-counts/${activeCount.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approvedById: employee.id,
          reject: true,
          rejectionReason: rejectionReason || 'Rejected by manager',
        }),
      })

      if (response.ok) {
        const data = await response.json()
        toast.success('Count rejected')
        setActiveCount(data.data)
        setShowRejectModal(false)
        setRejectionReason('')
        loadData()
      } else {
        const errorData = await response.json()
        toast.error(errorData.error || 'Failed to reject count')
      }
    } catch (error) {
      console.error('Failed to reject count:', error)
      toast.error('Failed to reject count')
    } finally {
      setIsRejecting(false)
    }
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString([], {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    })
  }

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  if (!isAuthenticated) return null

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">Loading...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Daily Prep Counts"
        subtitle="Morning count of prepared items"
        breadcrumbs={[{ label: 'Inventory', href: '/inventory' }]}
        actions={
          viewMode === 'list' && (
            <Button onClick={handleStartNewCount}>
              + Start Morning Count
            </Button>
          )
        }
      />
      <AdminSubNav items={inventorySubNav} basePath="/inventory" />

      {viewMode === 'list' ? (
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Info Banner */}
          {prepItems.length === 0 && (
            <Card className="p-4 bg-yellow-50 border-yellow-200">
              <div className="flex gap-3">
                <span className="text-2xl">⚠️</span>
                <div className="text-sm text-yellow-800">
                  <p className="font-medium mb-1">No Items Configured</p>
                  <p>
                    No prep items are set up for daily counting.
                    <button
                      onClick={() => router.push('/settings/daily-counts')}
                      className="ml-1 underline font-medium"
                    >
                      Go to Settings
                    </button>
                    {' '}to configure daily count items.
                  </p>
                </div>
              </div>
            </Card>
          )}

          {/* Today's Status */}
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">Today&apos;s Count</h3>
            {(() => {
              const today = new Date().toISOString().split('T')[0]
              const todayCount = counts.find(c => c.countDate.startsWith(today))

              if (todayCount) {
                const status = STATUS_COLORS[todayCount.status] || STATUS_COLORS.draft
                return (
                  <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                    <div>
                      <span className={`px-2 py-1 rounded text-sm font-medium ${status.bg} ${status.text}`}>
                        {status.label}
                      </span>
                      <p className="mt-2 text-sm text-gray-600">
                        Started by {todayCount.createdBy?.firstName || 'Unknown'}{' '}
                        at {formatTime(todayCount.countDate)}
                      </p>
                      {todayCount.submittedBy && (
                        <p className="text-sm text-gray-500">
                          Submitted by {todayCount.submittedBy.firstName}
                        </p>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      onClick={() => handleViewCount(todayCount)}
                    >
                      {todayCount.status === 'draft' ? 'Continue Count' : 'View Details'}
                    </Button>
                  </div>
                )
              }

              return (
                <div className="text-center py-8">
                  <span className="text-4xl mb-3 block">📋</span>
                  <p className="text-gray-600 mb-4">No count started for today</p>
                  <Button onClick={handleStartNewCount} disabled={prepItems.length === 0}>
                    Start Morning Count
                  </Button>
                </div>
              )
            })()}
          </Card>

          {/* Recent Counts */}
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">Recent Counts</h3>
            {counts.length === 0 ? (
              <p className="text-gray-500 text-center py-4">No counts yet</p>
            ) : (
              <div className="space-y-2">
                {counts.map(count => {
                  const status = STATUS_COLORS[count.status] || STATUS_COLORS.draft
                  return (
                    <button
                      key={count.id}
                      onClick={() => handleViewCount(count)}
                      className="w-full text-left p-4 rounded-lg border hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="font-medium">{formatDate(count.countDate)}</span>
                          <span className="text-gray-500 text-sm ml-2">
                            {count.shiftType} shift
                          </span>
                        </div>
                        <span className={`px-2 py-1 rounded text-xs font-medium ${status.bg} ${status.text}`}>
                          {status.label}
                        </span>
                      </div>
                      <div className="text-sm text-gray-500 mt-1">
                        {count.countItems?.length || 0} items counted
                        {count.createdBy && ` • by ${count.createdBy.firstName}`}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </Card>
        </div>
      ) : (
        // Count Entry View
        <div className="max-w-4xl mx-auto">
          {/* Count Header */}
          <Card className="p-4 mb-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold">
                  {activeCount?.countDate && formatDate(activeCount.countDate)} - {activeCount?.shiftType} shift
                </h3>
                <p className="text-sm text-gray-500">
                  {activeCount?.status === 'draft' ? 'In progress' : STATUS_COLORS[activeCount?.status || 'draft'].label}
                </p>
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  setActiveCount(null)
                  setViewMode('list')
                }}
              >
                Back to List
              </Button>
            </div>
          </Card>

          {/* Count Entry Form */}
          {activeCount?.status === 'draft' ? (
            <>
              <div className="space-y-4 mb-6">
                {prepItems.map(item => (
                  <Card key={item.id} className="p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h4 className="font-semibold">{item.name}</h4>
                        <p className="text-sm text-gray-500">
                          Previous stock: {item.currentPrepStock} {item.outputUnit}
                        </p>
                      </div>
                      <div className="text-right">
                        <div className="text-2xl font-bold text-blue-600">
                          {calculateTotal(item.id)}
                        </div>
                        <div className="text-sm text-gray-500">{item.outputUnit}</div>
                      </div>
                    </div>

                    {item.trayConfigs.length > 0 ? (
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        {item.trayConfigs.map(tray => (
                          <div key={tray.id} className="bg-gray-50 rounded-lg p-3">
                            <div className="text-sm font-medium mb-2">
                              {tray.name}
                              <span className="text-gray-400 ml-1">
                                (×{tray.capacity})
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => {
                                  const current = trayEntries[item.id]?.[tray.id] || 0
                                  handleTrayChange(item.id, tray.id, current - 1)
                                }}
                                className="w-10 h-10 bg-white border rounded-lg text-xl font-bold hover:bg-gray-100 active:bg-gray-200"
                              >
                                −
                              </button>
                              <input
                                type="number"
                                inputMode="numeric"
                                min="0"
                                value={trayEntries[item.id]?.[tray.id] || 0}
                                onChange={(e) => handleTrayChange(item.id, tray.id, parseInt(e.target.value) || 0)}
                                className="w-16 h-10 text-center border rounded-lg text-lg font-bold"
                              />
                              <button
                                onClick={() => {
                                  const current = trayEntries[item.id]?.[tray.id] || 0
                                  handleTrayChange(item.id, tray.id, current + 1)
                                }}
                                className="w-10 h-10 bg-white border rounded-lg text-xl font-bold hover:bg-gray-100 active:bg-gray-200"
                              >
                                +
                              </button>
                            </div>
                            <div className="text-xs text-gray-500 mt-1 text-center">
                              = {(trayEntries[item.id]?.[tray.id] || 0) * tray.capacity} {item.outputUnit}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="flex items-center gap-3 bg-gray-50 rounded-lg p-3">
                        <span className="text-sm text-gray-600">
                          {item.countPrecision === 'decimal' ? 'Enter amount:' : 'Manual count:'}
                        </span>
                        <button
                          onClick={() => handleManualChange(
                            item.id,
                            (manualEntries[item.id] || 0) - (item.countPrecision === 'decimal' ? 0.5 : 1),
                            item.countPrecision
                          )}
                          className="w-10 h-10 bg-white border rounded-lg text-xl font-bold hover:bg-gray-100"
                        >
                          −
                        </button>
                        <input
                          type="number"
                          inputMode={item.countPrecision === 'decimal' ? 'decimal' : 'numeric'}
                          min="0"
                          step={item.countPrecision === 'decimal' ? '0.1' : '1'}
                          value={manualEntries[item.id] || 0}
                          onChange={(e) => handleManualChange(
                            item.id,
                            parseFloat(e.target.value) || 0,
                            item.countPrecision
                          )}
                          className="w-24 h-10 text-center border rounded-lg text-lg font-bold"
                        />
                        <button
                          onClick={() => handleManualChange(
                            item.id,
                            (manualEntries[item.id] || 0) + (item.countPrecision === 'decimal' ? 0.5 : 1),
                            item.countPrecision
                          )}
                          className="w-10 h-10 bg-white border rounded-lg text-xl font-bold hover:bg-gray-100"
                        >
                          +
                        </button>
                        <span className="text-sm text-gray-500">{item.outputUnit}</span>
                      </div>
                    )}
                  </Card>
                ))}
              </div>

              {/* Summary & Actions */}
              <Card className="p-4 bg-blue-50 border-blue-200">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div className="text-sm text-blue-600 font-medium">Total Items Counted</div>
                    <div className="text-3xl font-bold text-blue-800">{grandTotal}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-blue-600">Items</div>
                    <div className="text-xl font-bold text-blue-800">{prepItems.length}</div>
                  </div>
                </div>

                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    onClick={handleSaveProgress}
                    disabled={isSaving}
                    className="flex-1"
                  >
                    {isSaving ? 'Saving...' : 'Save Progress'}
                  </Button>
                  <Button
                    onClick={handleSubmitForApproval}
                    disabled={isSubmitting || grandTotal === 0}
                    className="flex-1"
                  >
                    {isSubmitting ? 'Submitting...' : 'Submit for Approval'}
                  </Button>
                </div>
              </Card>
            </>
          ) : (
            // View-only mode for submitted/approved counts
            <div className="space-y-4">
              {activeCount?.countItems?.map(item => (
                <Card key={item.id} className="p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-semibold">{item.prepItem.name}</h4>
                      {item.trayBreakdown && (
                        <div className="text-sm text-gray-500 mt-1">
                          {Object.entries(item.trayBreakdown).map(([trayId, count]) => {
                            const prep = prepItems.find(p => p.id === item.prepItemId)
                            const tray = prep?.trayConfigs.find(t => t.id === trayId)
                            return tray ? `${count}× ${tray.name}` : null
                          }).filter(Boolean).join(', ')}
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <div className="text-2xl font-bold">{item.totalCounted}</div>
                      <div className="text-sm text-gray-500">{item.prepItem.outputUnit}</div>
                    </div>
                  </div>
                  {item.variance !== null && item.variance !== 0 && (
                    <div className={`text-sm mt-2 ${Number(item.variance) > 0 ? 'text-green-600' : 'text-red-600'}`}>
                      Variance: {Number(item.variance) > 0 ? '+' : ''}{Number(item.variance)} ({item.variancePercent != null ? Number(item.variancePercent).toFixed(1) : '0.0'}%)
                    </div>
                  )}
                </Card>
              ))}

              {/* Approval Info & Actions */}
              {activeCount?.status === 'submitted' && (
                <Card className="p-4 bg-yellow-50 border-yellow-200">
                  <div className="flex gap-3 mb-4">
                    <span className="text-2xl">⏳</span>
                    <div>
                      <p className="font-medium text-yellow-800">Awaiting Manager Approval</p>
                      <p className="text-sm text-yellow-700">
                        Submitted by {activeCount.submittedBy?.firstName} at {activeCount.submittedAt && formatTime(activeCount.submittedAt)}
                      </p>
                    </div>
                  </div>

                  {/* Manager Approval Buttons */}
                  <div className="border-t border-yellow-200 pt-4 mt-2">
                    <p className="text-sm text-yellow-800 mb-3 font-medium">Manager Actions</p>
                    <div className="flex gap-3">
                      <Button
                        variant="outline"
                        onClick={() => setShowRejectModal(true)}
                        disabled={isRejecting || isApproving}
                        className="flex-1 border-red-300 text-red-700 hover:bg-red-50"
                      >
                        Reject
                      </Button>
                      <Button
                        onClick={handleApprove}
                        disabled={isApproving || isRejecting}
                        className="flex-1 bg-green-600 hover:bg-green-700"
                      >
                        {isApproving ? 'Approving...' : 'Approve Count'}
                      </Button>
                    </div>
                    <p className="text-xs text-yellow-600 mt-2">
                      Approving will update prep stock and deduct raw ingredients from inventory.
                    </p>
                  </div>
                </Card>
              )}

              {activeCount?.status === 'approved' && (
                <Card className="p-4 bg-green-50 border-green-200">
                  <div className="flex gap-3">
                    <span className="text-2xl">✓</span>
                    <div>
                      <p className="font-medium text-green-800">Count Approved</p>
                      <p className="text-sm text-green-700">
                        Approved by {activeCount.approvedBy?.firstName} at {activeCount.approvedAt && formatTime(activeCount.approvedAt)}
                      </p>
                      <p className="text-sm text-green-700 mt-1">
                        Inventory has been updated and raw ingredients deducted.
                      </p>
                    </div>
                  </div>
                </Card>
              )}

              {activeCount?.status === 'rejected' && (
                <Card className="p-4 bg-red-50 border-red-200">
                  <div className="flex gap-3">
                    <span className="text-2xl">✕</span>
                    <div>
                      <p className="font-medium text-red-800">Count Rejected</p>
                      <p className="text-sm text-red-700">
                        Please start a new count with corrected values.
                      </p>
                    </div>
                  </div>
                </Card>
              )}
            </div>
          )}
        </div>
      )}

      {/* Rejection Reason Modal */}
      {showRejectModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>Reject Count</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-gray-600">
                Please provide a reason for rejecting this count. The staff member will need to submit a new count.
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Rejection Reason
                </label>
                <textarea
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  placeholder="e.g., Counts don't match observed inventory..."
                  className="w-full border rounded-lg px-3 py-2"
                  rows={3}
                />
              </div>
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowRejectModal(false)
                    setRejectionReason('')
                  }}
                  disabled={isRejecting}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleReject}
                  disabled={isRejecting}
                  className="flex-1 bg-red-600 hover:bg-red-700"
                >
                  {isRejecting ? 'Rejecting...' : 'Reject Count'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
