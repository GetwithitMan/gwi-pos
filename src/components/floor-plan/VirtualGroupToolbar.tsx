// src/components/floor-plan/VirtualGroupToolbar.tsx
'use client'

import React, { useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useFloorPlanStore, FloorPlanTable } from './useFloorPlanStore'

interface VirtualGroupToolbarProps {
  locationId: string
  onError?: (message: string) => void
  onSuccess?: (message: string) => void
}

/**
 * Floating toolbar for virtual group operations.
 * Shows when 2+ tables are selected OR when a grouped table is selected.
 *
 * Actions:
 * - Link Tables (create new group)
 * - Add to Group (add selected to existing group)
 * - Remove from Group (remove selected from group)
 * - Dissolve Group (remove all tables from group)
 */
export const VirtualGroupToolbar: React.FC<VirtualGroupToolbarProps> = ({
  locationId,
  onError,
  onSuccess,
}) => {
  const {
    tables,
    selectedTableIds,
    clearTableSelection,
    applyVirtualGroupUpdate,
  } = useFloorPlanStore()

  // Get selected tables
  const selectedTables = useMemo(() => {
    return tables.filter(t => selectedTableIds.includes(t.id))
  }, [tables, selectedTableIds])

  // Determine what actions are available
  const analysis = useMemo(() => {
    // Check if any selected table is in a virtual group
    const groupedTables = selectedTables.filter(t => t.virtualGroupId)
    const ungroupedTables = selectedTables.filter(t => !t.virtualGroupId)

    // Get unique group IDs among selected tables
    const groupIds = new Set(groupedTables.map(t => t.virtualGroupId).filter(Boolean))

    // Find the primary table if any
    const primaryTable = groupedTables.find(t => t.virtualGroupPrimary)

    // All tables in the same group (for context)
    const sameGroupTables = groupIds.size === 1
      ? tables.filter(t => t.virtualGroupId === [...groupIds][0])
      : []

    return {
      showToolbar: selectedTables.length >= 1,
      selectedCount: selectedTables.length,
      groupedCount: groupedTables.length,
      ungroupedCount: ungroupedTables.length,
      groupIds: [...groupIds] as string[],
      isSingleGroup: groupIds.size === 1,
      primaryTable,
      sameGroupTables,
      // Can create new group: 2+ ungrouped tables selected
      canCreate: ungroupedTables.length >= 2 && groupedTables.length === 0,
      // Can add to group: have ungrouped tables + exactly one group represented
      canAdd: ungroupedTables.length > 0 && groupIds.size === 1,
      // Can remove from group: have grouped tables selected
      canRemove: groupedTables.length > 0,
      // Can dissolve: exactly one group selected (all or some tables)
      canDissolve: groupIds.size === 1 && groupedTables.length > 0,
    }
  }, [selectedTables, tables])

  if (!analysis.showToolbar) return null

  const handleLinkTables = async () => {
    if (selectedTableIds.length < 2) {
      onError?.('Select at least 2 tables to link')
      return
    }

    // Check none are already in a group
    const alreadyGrouped = selectedTables.filter(t => t.virtualGroupId)
    if (alreadyGrouped.length > 0) {
      onError?.('Some tables are already in a group. Remove them first.')
      return
    }

    try {
      const res = await fetch('/api/tables/virtual-group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          locationId,
          tableIds: selectedTableIds,
          primaryTableId: selectedTableIds[0], // First selected is primary
        }),
      })

      const data = await res.json()
      if (res.ok && data.data) {
        applyVirtualGroupUpdate({
          virtualGroupId: data.data.virtualGroupId,
          tableIds: selectedTableIds,
          primaryTableId: data.data.primaryTableId,
          color: data.data.color,
        })
        onSuccess?.(`Linked ${selectedTableIds.length} tables`)
        clearTableSelection()
      } else {
        onError?.(data.error || 'Failed to link tables')
      }
    } catch (err) {
      console.error('Link tables error:', err)
      onError?.('Failed to link tables')
    }
  }

  const handleAddToGroup = async () => {
    if (analysis.groupIds.length !== 1) {
      onError?.('Select tables from exactly one existing group to add to')
      return
    }

    const virtualGroupId = analysis.groupIds[0]
    const tablesToAdd = selectedTables.filter(t => !t.virtualGroupId).map(t => t.id)

    if (tablesToAdd.length === 0) {
      onError?.('No ungrouped tables selected to add')
      return
    }

    try {
      const res = await fetch('/api/tables/virtual-group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'add',
          locationId,
          virtualGroupId,
          tableIds: tablesToAdd,
        }),
      })

      const data = await res.json()
      if (res.ok && data.data) {
        applyVirtualGroupUpdate({
          virtualGroupId,
          tableIds: [...analysis.sameGroupTables.map(t => t.id), ...tablesToAdd],
          color: data.data.color,
        })
        onSuccess?.(`Added ${tablesToAdd.length} table(s) to group`)
        clearTableSelection()
      } else {
        onError?.(data.error || 'Failed to add to group')
      }
    } catch (err) {
      console.error('Add to group error:', err)
      onError?.('Failed to add to group')
    }
  }

  const handleRemoveFromGroup = async () => {
    if (analysis.groupIds.length !== 1) {
      onError?.('Select tables from one group to remove')
      return
    }

    const virtualGroupId = analysis.groupIds[0]
    const tablesToRemove = selectedTables.filter(t => t.virtualGroupId === virtualGroupId).map(t => t.id)

    if (tablesToRemove.length === 0) {
      onError?.('No grouped tables selected to remove')
      return
    }

    try {
      const res = await fetch('/api/tables/virtual-group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'remove',
          locationId,
          virtualGroupId,
          tableIds: tablesToRemove,
        }),
      })

      const data = await res.json()
      if (res.ok && data.data) {
        applyVirtualGroupUpdate({
          virtualGroupId,
          tableIds: analysis.sameGroupTables.filter(t => !tablesToRemove.includes(t.id)).map(t => t.id),
          removedTableIds: tablesToRemove,
        })
        onSuccess?.(`Removed ${tablesToRemove.length} table(s) from group`)
        clearTableSelection()
      } else {
        onError?.(data.error || 'Failed to remove from group')
      }
    } catch (err) {
      console.error('Remove from group error:', err)
      onError?.('Failed to remove from group')
    }
  }

  const handleDissolveGroup = async () => {
    if (analysis.groupIds.length !== 1) {
      onError?.('Select tables from one group to dissolve')
      return
    }

    const virtualGroupId = analysis.groupIds[0]

    try {
      const res = await fetch('/api/tables/virtual-group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'dissolve',
          locationId,
          virtualGroupId,
        }),
      })

      const data = await res.json()
      if (res.ok && data.data) {
        applyVirtualGroupUpdate({
          virtualGroupId,
          tableIds: [],
          dissolved: true,
        })
        onSuccess?.('Group dissolved')
        clearTableSelection()
      } else {
        onError?.(data.error || 'Failed to dissolve group')
      }
    } catch (err) {
      console.error('Dissolve group error:', err)
      onError?.('Failed to dissolve group')
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        className="absolute bottom-6 left-1/2 -translate-x-1/2 z-50"
      >
        <div className="flex items-center gap-2 px-4 py-3 bg-slate-800/95 backdrop-blur-sm rounded-xl border border-slate-700 shadow-xl">
          {/* Selection info */}
          <div className="text-sm text-slate-300 pr-3 border-r border-slate-600">
            <span className="font-medium text-white">{analysis.selectedCount}</span>
            {' '}table{analysis.selectedCount !== 1 ? 's' : ''} selected
            {analysis.groupedCount > 0 && (
              <span className="text-cyan-400 ml-1">
                ({analysis.groupedCount} linked)
              </span>
            )}
          </div>

          {/* Link Tables - create new group */}
          {analysis.canCreate && (
            <button
              onClick={handleLinkTables}
              className="flex items-center gap-2 px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-medium rounded-lg transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
              Link Tables
            </button>
          )}

          {/* Add to Group */}
          {analysis.canAdd && analysis.ungroupedCount > 0 && (
            <button
              onClick={handleAddToGroup}
              className="flex items-center gap-2 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-lg transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              Add to Group
            </button>
          )}

          {/* Remove from Group */}
          {analysis.canRemove && (
            <button
              onClick={handleRemoveFromGroup}
              className="flex items-center gap-2 px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-sm font-medium rounded-lg transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
              </svg>
              Remove
            </button>
          )}

          {/* Dissolve Group */}
          {analysis.canDissolve && (
            <button
              onClick={handleDissolveGroup}
              className="flex items-center gap-2 px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white text-sm font-medium rounded-lg transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              Dissolve
            </button>
          )}

          {/* Clear selection */}
          <button
            onClick={clearTableSelection}
            className="ml-2 p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
            title="Clear selection"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  )
}
