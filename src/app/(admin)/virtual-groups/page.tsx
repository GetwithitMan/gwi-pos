'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/auth-store'
import { ManagerGroupDashboard } from '@/components/admin/ManagerGroupDashboard'
import { toast } from '@/stores/toast-store'

interface ActiveGroupData {
  id: string
  primaryTableId: string
  primaryTableName: string
  groupColor: string
  createdAt: string
  tableCount: number
  totalSpend: number
  totalGuests: number
  serverId?: string
  serverName: string
  members: {
    id: string
    name: string
    abbreviation?: string
    isPrimary: boolean
    sectionName?: string
    currentOrder: {
      id: string
      orderNumber: number
      total: number
      guestCount: number
      itemCount: number
    } | null
  }[]
}

interface ApiResponse {
  data: {
    summary: {
      totalGroups: number
      totalTablesLinked: number
      totalGroupSpend: number
      highValueGroups: number
    }
    groups: ActiveGroupData[]
  }
}

export default function VirtualGroupsPage() {
  const router = useRouter()
  const { employee, isAuthenticated } = useAuthStore()

  const [groups, setGroups] = useState<ActiveGroupData[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Auth check
  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login?redirect=/virtual-groups')
    }
  }, [isAuthenticated, router])

  // Load active groups
  const loadGroups = useCallback(async () => {
    if (!employee?.location?.id) return

    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch(
        `/api/tables/virtual-combine/active?locationId=${employee.location.id}`
      )

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to load virtual groups')
      }

      const data: ApiResponse = await response.json()
      setGroups(data.data.groups)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      console.error('Failed to load virtual groups:', err)
    } finally {
      setIsLoading(false)
    }
  }, [employee?.location?.id])

  useEffect(() => {
    loadGroups()
    // Refresh every 30 seconds
    const interval = setInterval(loadGroups, 30000)
    return () => clearInterval(interval)
  }, [loadGroups])

  // Convert API data to dashboard format
  const dashboardTables = groups.flatMap((group) =>
    group.members.map((member) => ({
      id: member.id,
      name: member.name,
      abbreviation: member.abbreviation,
      virtualGroupId: group.id,
      virtualGroupPrimary: member.isPrimary,
      virtualGroupColor: group.groupColor,
      virtualGroupCreatedAt: group.createdAt,
      currentOrder: member.currentOrder
        ? {
            id: member.currentOrder.id,
            orderNumber: member.currentOrder.orderNumber,
            total: member.currentOrder.total,
            guestCount: member.currentOrder.guestCount,
            createdAt: group.createdAt,
            server: member.isPrimary
              ? {
                  id: group.serverId || '',
                  firstName: group.serverName.split(' ')[0] || '',
                  lastName: group.serverName.split(' ').slice(1).join(' ') || '',
                }
              : undefined,
          }
        : null,
    }))
  )

  const handleTransferGroup = async (groupId: string, newServerId: string) => {
    // TODO: Open server selection modal
    toast.info('Server transfer coming soon - select a server to transfer to')
  }

  const handleDissolveGroup = async (groupId: string) => {
    if (!employee?.location?.id) return
    if (!confirm('Are you sure you want to dissolve this virtual group?')) return

    try {
      const response = await fetch(
        `/api/tables/virtual-combine/${groupId}/dissolve`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            locationId: employee.location.id,
            employeeId: employee.id,
            splitOrder: false,
          }),
        }
      )

      if (response.ok) {
        toast.success('Virtual group dissolved')
        loadGroups()
      } else {
        const data = await response.json()
        toast.error(data.error || 'Failed to dissolve group')
      }
    } catch (err) {
      toast.error('Failed to dissolve group')
      console.error('Dissolve error:', err)
    }
  }

  const handleViewGroupDetails = (groupId: string) => {
    // Navigate to the group checkout view
    router.push(`/orders?virtualGroupId=${groupId}`)
  }

  if (!isAuthenticated) return null

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-400">Loading virtual groups...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-400 mb-4">{error}</p>
          <button
            onClick={loadGroups}
            className="px-4 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-700"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-950">
      {/* Back Navigation */}
      <div className="fixed top-4 left-4 z-10">
        <button
          onClick={() => router.push('/orders')}
          className="flex items-center gap-2 px-3 py-2 bg-slate-800/80 backdrop-blur-sm text-white rounded-lg hover:bg-slate-700 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Orders
        </button>
      </div>

      {/* Refresh Button */}
      <div className="fixed top-4 right-4 z-10">
        <button
          onClick={loadGroups}
          className="flex items-center gap-2 px-3 py-2 bg-slate-800/80 backdrop-blur-sm text-white rounded-lg hover:bg-slate-700 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Refresh
        </button>
      </div>

      <ManagerGroupDashboard
        tables={dashboardTables}
        onTransferGroup={handleTransferGroup}
        onDissolveGroup={handleDissolveGroup}
        onViewGroupDetails={handleViewGroupDetails}
        riskThreshold={500}
      />
    </div>
  )
}
