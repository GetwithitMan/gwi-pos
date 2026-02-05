'use client'

/**
 * useTableGroups Hook
 *
 * Manages physical and virtual table groups.
 * Uses API routes instead of direct Prisma calls to work in the browser.
 */

import { useState, useCallback, useEffect } from 'react'
import type { TableGroup, GroupColor } from '../types'

interface UseTableGroupsOptions {
  locationId: string
  autoLoad?: boolean
}

interface VirtualGroupAPIResponse {
  data?: {
    virtualGroupId: string
    groupColor: string
    primaryTableId: string
    memberTableIds: string[]
    tables: Array<{
      id: string
      name: string
      virtualGroupId: string
      virtualGroupPrimary: boolean
      virtualGroupColor: string
    }>
    message?: string
  }
  error?: string
  requiresAction?: boolean
  existingOrders?: Array<{
    tableId: string
    tableName: string
    orderId: string
    orderNumber: number
    itemCount: number
    total: number
  }>
}

interface VirtualGroupListItem {
  virtualGroupId: string
  primaryTableId: string
  groupColor: string
  createdAt: string
  tables: Array<{
    id: string
    name: string
    isPrimary: boolean
  }>
}

export function useTableGroups({ locationId, autoLoad = true }: UseTableGroupsOptions) {
  const [groups, setGroups] = useState<TableGroup[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load groups via API
  const loadGroups = useCallback(async () => {
    if (!locationId) return

    setIsLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/tables/virtual-combine?locationId=${locationId}`)
      if (!res.ok) {
        throw new Error('Failed to load virtual groups')
      }

      const data = await res.json()
      const virtualGroups: VirtualGroupListItem[] = data.data || []

      // Convert API response to TableGroup format
      const loadedGroups: TableGroup[] = virtualGroups.map((vg) => ({
        id: vg.virtualGroupId,
        locationId,
        name: vg.tables.map((t) => t.name).join('+'),
        color: (vg.groupColor || 'blue') as GroupColor,
        isVirtual: true,
        tableIds: vg.tables.map((t) => t.id),
        primaryTableId: vg.primaryTableId,
        createdAt: new Date(vg.createdAt),
        createdBy: '',
      }))

      setGroups(loadedGroups)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load groups')
    } finally {
      setIsLoading(false)
    }
  }, [locationId])

  // Auto-load on mount
  useEffect(() => {
    if (autoLoad) {
      loadGroups()
    }
  }, [autoLoad, loadGroups])

  // Get group for a table
  const getGroupForTable = useCallback(
    (tableId: string) => {
      return groups.find((g) => g.tableIds.includes(tableId)) || null
    },
    [groups]
  )

  // Check if table is in a group
  const isTableInGroup = useCallback(
    (tableId: string) => {
      return groups.some((g) => g.tableIds.includes(tableId))
    },
    [groups]
  )

  // Create virtual group via API
  const createVirtualGroup = useCallback(
    async (
      tableIds: string[],
      employeeId: string,
      _color?: GroupColor,
      visualOffsets?: Array<{ tableId: string; offsetX: number; offsetY: number }>
    ) => {
      if (tableIds.length < 2) {
        setError('Need at least 2 tables to create a group')
        return null
      }

      setIsLoading(true)
      setError(null)

      try {
        // First table is primary
        const primaryTableId = tableIds[0]

        const res = await fetch('/api/tables/virtual-combine', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tableIds,
            primaryTableId,
            locationId,
            employeeId,
            visualOffsets, // Pass visual offsets to persist in DB
          }),
        })

        const data: VirtualGroupAPIResponse = await res.json()

        if (!res.ok) {
          throw new Error(data.error || 'Failed to create virtual group')
        }

        // Handle case where orders need to be dealt with first
        if (data.requiresAction) {
          setError(`Some tables have open orders: ${data.existingOrders?.map((o) => o.tableName).join(', ')}`)
          return null
        }

        if (!data.data) {
          throw new Error('No data returned from API')
        }

        // Create TableGroup from response
        const group: TableGroup = {
          id: data.data.virtualGroupId,
          locationId,
          name: data.data.tables.map((t) => t.name).join('+'),
          color: (data.data.groupColor || 'blue') as GroupColor,
          isVirtual: true,
          tableIds: data.data.memberTableIds,
          primaryTableId: data.data.primaryTableId,
          createdAt: new Date(),
          createdBy: employeeId,
        }

        setGroups((prev) => [...prev, group])
        return group
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to create group'
        setError(message)
        console.error('[useTableGroups] createVirtualGroup error:', err)
        return null
      } finally {
        setIsLoading(false)
      }
    },
    [locationId]
  )

  // Dissolve group via API
  const dissolveGroup = useCallback(
    async (groupId: string, employeeId: string = 'emp-1') => {
      setIsLoading(true)
      setError(null)

      try {
        const res = await fetch(`/api/tables/virtual-combine/${groupId}/dissolve`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            locationId,
            employeeId,
          }),
        })

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Failed to dissolve group')
        }

        setGroups((prev) => prev.filter((g) => g.id !== groupId))
        return true
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to dissolve group')
        console.error('[useTableGroups] dissolveGroup error:', err)
        return false
      } finally {
        setIsLoading(false)
      }
    },
    [locationId]
  )

  // Add table to existing group via API
  const addToGroup = useCallback(
    async (
      groupId: string,
      tableId: string,
      employeeId: string = 'emp-1',
      offsetX: number = 0,
      offsetY: number = 0
    ) => {
      setIsLoading(true)
      setError(null)

      try {
        const res = await fetch(`/api/tables/virtual-combine/${groupId}/add`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tableId,
            locationId,
            employeeId,
            offsetX, // Pass visual offset to persist in DB
            offsetY,
          }),
        })

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Failed to add table to group')
        }

        // Reload groups to get updated state
        await loadGroups()
        return true
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to add table to group')
        return false
      } finally {
        setIsLoading(false)
      }
    },
    [locationId, loadGroups]
  )

  // Remove table from group via API
  const removeFromGroup = useCallback(
    async (groupId: string, tableId: string, employeeId: string = 'emp-1') => {
      setIsLoading(true)
      setError(null)

      try {
        const res = await fetch(`/api/tables/virtual-combine/${groupId}/remove`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tableId,
            locationId,
            employeeId,
          }),
        })

        const data = await res.json()

        if (!res.ok) {
          throw new Error(data.error || 'Failed to remove table from group')
        }

        // Check if group was dissolved
        if (data.data?.dissolved) {
          setGroups((prev) => prev.filter((g) => g.id !== groupId))
        } else {
          // Reload groups to get updated state
          await loadGroups()
        }

        return true
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to remove table from group')
        return false
      } finally {
        setIsLoading(false)
      }
    },
    [locationId, loadGroups]
  )

  // Get virtual groups only
  const virtualGroups = groups.filter((g) => g.isVirtual)

  // Get physical groups only
  const physicalGroups = groups.filter((g) => !g.isVirtual)

  return {
    // State
    groups,
    virtualGroups,
    physicalGroups,
    isLoading,
    error,

    // Queries
    getGroupForTable,
    isTableInGroup,

    // Actions
    loadGroups,
    createVirtualGroup,
    dissolveGroup,
    addToGroup,
    removeFromGroup,
  }
}

export default useTableGroups
