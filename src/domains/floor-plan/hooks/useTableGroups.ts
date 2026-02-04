'use client'

/**
 * useTableGroups Hook
 *
 * Manages physical and virtual table groups.
 */

import { useState, useCallback, useEffect } from 'react'
import type { TableGroup, GroupColor } from '../types'
import * as GroupService from '../services/group-service'

interface UseTableGroupsOptions {
  locationId: string
  autoLoad?: boolean
}

export function useTableGroups({ locationId, autoLoad = true }: UseTableGroupsOptions) {
  const [groups, setGroups] = useState<TableGroup[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load groups
  const loadGroups = useCallback(async () => {
    if (!locationId) return

    setIsLoading(true)
    setError(null)

    try {
      const loadedGroups = await GroupService.getGroupsForLocation(locationId)
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

  // Create virtual group
  const createVirtualGroup = useCallback(
    async (tableIds: string[], employeeId: string, color?: GroupColor) => {
      if (tableIds.length < 2) {
        setError('Need at least 2 tables to create a group')
        return null
      }

      setIsLoading(true)
      setError(null)

      try {
        const group = await GroupService.createVirtualGroup(
          locationId,
          tableIds,
          employeeId,
          color
        )
        setGroups((prev) => [...prev, group])
        return group
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create group')
        return null
      } finally {
        setIsLoading(false)
      }
    },
    [locationId]
  )

  // Dissolve group
  const dissolveGroup = useCallback(
    async (groupId: string) => {
      setIsLoading(true)
      setError(null)

      try {
        await GroupService.dissolveGroup(groupId)
        setGroups((prev) => prev.filter((g) => g.id !== groupId))
        return true
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to dissolve group')
        return false
      } finally {
        setIsLoading(false)
      }
    },
    []
  )

  // Add table to existing group
  const addToGroup = useCallback(
    async (groupId: string, tableId: string) => {
      setIsLoading(true)
      setError(null)

      try {
        const updatedGroup = await GroupService.addTableToGroup(groupId, tableId)
        setGroups((prev) =>
          prev.map((g) => (g.id === groupId ? updatedGroup : g))
        )
        return true
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to add table to group')
        return false
      } finally {
        setIsLoading(false)
      }
    },
    []
  )

  // Remove table from group
  const removeFromGroup = useCallback(
    async (groupId: string, tableId: string) => {
      setIsLoading(true)
      setError(null)

      try {
        const updatedGroup = await GroupService.removeTableFromGroup(groupId, tableId)
        if (updatedGroup) {
          setGroups((prev) =>
            prev.map((g) => (g.id === groupId ? updatedGroup : g))
          )
        } else {
          // Group was dissolved
          setGroups((prev) => prev.filter((g) => g.id !== groupId))
        }
        return true
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to remove table from group')
        return false
      } finally {
        setIsLoading(false)
      }
    },
    []
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
