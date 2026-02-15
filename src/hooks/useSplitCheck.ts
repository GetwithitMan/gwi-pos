'use client'

import { useState, useCallback, useMemo, useRef } from 'react'
import { getSeatColor, SEAT_COLORS } from '@/lib/seat-utils'
import { splitAmountEvenly } from '@/lib/split-pricing'

// ============================================
// Types
// ============================================

export type SplitMode = 'by_seat' | 'custom' | 'even' | 'bp'

export interface SplitItemShare {
  id: string
  originalItemId: string
  seatNumber?: number | null
  name: string
  price: number
  quantity: number
  categoryType?: string | null
  isSentToKitchen: boolean
  isPaid: boolean
  shareKey?: string
  fractionLabel?: string
}

export interface SplitCheck {
  id: string
  label: string
  color: string
  seatNumber?: number | null
  items: SplitItemShare[]
  subtotal: number
}

export interface SplitAssignments {
  ticketIndex: number
  itemIds: string[]
}

export interface UseSplitCheckOptions {
  orderId: string
  items: Array<{
    id: string
    seatNumber?: number | null
    name: string
    price: number
    quantity: number
    categoryType?: string | null
    sentToKitchen?: boolean
    isPaid?: boolean
  }>
  defaultMode?: SplitMode
}

export interface UseSplitCheckResult {
  checks: SplitCheck[]
  splitMode: SplitMode
  selectedItemId: string | null
  evenWays: number
  setEvenWays: (ways: number) => void
  selectItem: (id: string | null) => void
  moveItemToCheck: (checkId: string) => void
  moveItemToNewCheck: () => void
  splitItem: (itemId: string, ways: number) => void
  applyMode: (mode: SplitMode) => void
  reset: () => void
  getAssignments: () => SplitAssignments[]
  getSplitItemsPayload: () => {
    originalItemId: string
    fractions: Array<{ ticketIndex: number; fraction: number }>
  }[]
  originalTotal: number
  splitTotal: number
  hasIntegrityIssue: boolean
  integrityIssues: string[]
}

// ============================================
// Helpers
// ============================================

function deepClone<T>(data: T): T {
  return JSON.parse(JSON.stringify(data))
}

function recomputeSubtotals(checks: SplitCheck[]): SplitCheck[] {
  return checks.map(check => ({
    ...check,
    subtotal: check.items.reduce((sum, item) => sum + item.price * item.quantity, 0),
  }))
}

function buildShareFromItem(item: UseSplitCheckOptions['items'][number]): SplitItemShare {
  return {
    id: 'share-' + item.id,
    originalItemId: item.id,
    seatNumber: item.seatNumber,
    name: item.name,
    price: item.price,
    quantity: item.quantity,
    categoryType: item.categoryType,
    isSentToKitchen: item.sentToKitchen ?? false,
    isPaid: item.isPaid ?? false,
  }
}

const NO_SEAT_COLOR = '#6b7280'
const BUSINESS_COLOR = '#10b981'
const PLEASURE_COLOR = '#8b5cf6'
const BUSINESS_TYPES = new Set(['food', 'drinks', 'combos', 'pizza', 'retail'])
const PLEASURE_TYPES = new Set(['liquor', 'entertainment'])

// ============================================
// Hook
// ============================================

export function useSplitCheck({ orderId, items, defaultMode }: UseSplitCheckOptions): UseSplitCheckResult {
  // Build initial state
  const [initChecks, initMode, initTotal] = useMemo(() => {
    const shares = items.map(buildShareFromItem)

    // Count distinct seat numbers from non-paid items
    const seatNumbers = new Set<number>()
    for (const item of items) {
      if (!item.isPaid && item.seatNumber != null) {
        seatNumbers.add(item.seatNumber)
      }
    }

    let checks: SplitCheck[]
    let mode: SplitMode

    if (defaultMode) {
      mode = defaultMode
    } else if (seatNumbers.size >= 2) {
      mode = 'by_seat'
    } else {
      mode = 'custom'
    }

    if (mode === 'by_seat' && seatNumbers.size >= 2) {
      const seatMap = new Map<number, SplitItemShare[]>()
      const noSeatItems: SplitItemShare[] = []

      for (const share of shares) {
        if (share.seatNumber != null) {
          const arr = seatMap.get(share.seatNumber) || []
          arr.push(share)
          seatMap.set(share.seatNumber, arr)
        } else {
          noSeatItems.push(share)
        }
      }

      let checkIdx = 1
      checks = []
      const sortedSeats = Array.from(seatMap.keys()).sort((a, b) => a - b)
      for (const seatNum of sortedSeats) {
        checks.push({
          id: `check-${checkIdx}`,
          label: `Seat ${seatNum}`,
          color: getSeatColor(seatNum, true),
          seatNumber: seatNum,
          items: seatMap.get(seatNum)!,
          subtotal: 0,
        })
        checkIdx++
      }

      if (noSeatItems.length > 0) {
        checks.push({
          id: `check-${checkIdx}`,
          label: 'No Seat',
          color: NO_SEAT_COLOR,
          items: noSeatItems,
          subtotal: 0,
        })
        checkIdx++
      }

      checks = recomputeSubtotals(checks)
    } else {
      checks = recomputeSubtotals([{
        id: 'check-1',
        label: 'Check 1',
        color: SEAT_COLORS[0],
        items: shares,
        subtotal: 0,
      }])
    }

    const total = checks.reduce((sum, c) => sum + c.subtotal, 0)
    return [checks, mode, total]
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // Intentionally empty — initialize once

  const [checks, setChecks] = useState<SplitCheck[]>(initChecks)
  const [splitMode, setSplitMode] = useState<SplitMode>(initMode)
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [evenWays, setEvenWays] = useState(2)
  const originalSnapshotRef = useRef<SplitCheck[]>(deepClone(initChecks))
  const originalTotalRef = useRef<number>(initTotal)
  const originalModeRef = useRef<SplitMode>(initMode)
  const nextCheckNumRef = useRef<number>(initChecks.length + 1)
  const nextShareIdRef = useRef<number>(items.length + 1)

  // Derived values
  const splitTotal = useMemo(
    () => checks.reduce((sum, c) => sum + c.subtotal, 0),
    [checks]
  )

  const originalTotal = originalTotalRef.current

  const { hasIntegrityIssue, integrityIssues } = useMemo(() => {
    const issues: string[] = []

    // Check all original item IDs are covered exactly once
    const originalIds = new Set(items.map(i => i.id))
    const coveredIds = new Map<string, number>()
    for (const check of checks) {
      for (const item of check.items) {
        coveredIds.set(item.originalItemId, (coveredIds.get(item.originalItemId) || 0) + 1)
      }
    }

    for (const id of originalIds) {
      if (!coveredIds.has(id)) {
        issues.push(`Item ${id} is missing from all checks`)
      }
    }

    // Check for items that appear exactly once but shouldn't be duplicated
    // (items appearing >1 means they were split, which is valid)

    // Check total integrity
    if (Math.abs(splitTotal - originalTotal) > 0.01) {
      issues.push(`Total mismatch: split=$${splitTotal.toFixed(2)} vs original=$${originalTotal.toFixed(2)}`)
    }

    // Check split item price integrity
    const splitGroups = new Map<string, SplitItemShare[]>()
    for (const check of checks) {
      for (const item of check.items) {
        if (item.shareKey) {
          const arr = splitGroups.get(item.originalItemId) || []
          arr.push(item)
          splitGroups.set(item.originalItemId, arr)
        }
      }
    }

    for (const [origId, shares] of splitGroups) {
      const originalItem = items.find(i => i.id === origId)
      if (originalItem) {
        const sharesTotal = shares.reduce((sum, s) => sum + s.price * s.quantity, 0)
        const origTotal = originalItem.price * originalItem.quantity
        if (Math.abs(sharesTotal - origTotal) > 0.01) {
          issues.push(`Split item ${origId} fractions sum to $${sharesTotal.toFixed(2)} but original is $${origTotal.toFixed(2)}`)
        }
      }
    }

    return { hasIntegrityIssue: issues.length > 0, integrityIssues: issues }
  }, [checks, items, splitTotal, originalTotal])

  // Actions

  const selectItem = useCallback((id: string | null) => {
    if (id === null) {
      setSelectedItemId(null)
      return
    }
    // Don't allow selecting paid items
    for (const check of checks) {
      const item = check.items.find(i => i.id === id)
      if (item?.isPaid) return
    }
    setSelectedItemId(prev => prev === id ? null : id)
  }, [checks])

  const moveItemToCheck = useCallback((checkId: string) => {
    if (!selectedItemId) return

    setChecks(prev => {
      let movedItem: SplitItemShare | null = null
      let sourceCheckIdx = -1

      // Find and remove from source check
      const updated = prev.map((check, idx) => {
        const itemIdx = check.items.findIndex(i => i.id === selectedItemId)
        if (itemIdx !== -1) {
          movedItem = check.items[itemIdx]
          sourceCheckIdx = idx
          return {
            ...check,
            items: check.items.filter((_, i) => i !== itemIdx),
          }
        }
        return check
      })

      if (!movedItem) return prev

      // Add to target check
      const result = updated.map(check => {
        if (check.id === checkId) {
          return { ...check, items: [...check.items, movedItem!] }
        }
        return check
      })

      return recomputeSubtotals(result)
    })

    setSelectedItemId(null)
  }, [selectedItemId])

  const moveItemToNewCheck = useCallback(() => {
    if (!selectedItemId) return

    const newCheckNum = nextCheckNumRef.current
    nextCheckNumRef.current++

    setChecks(prev => {
      let movedItem: SplitItemShare | null = null

      // Find and remove from source check
      const updated = prev.map(check => {
        const itemIdx = check.items.findIndex(i => i.id === selectedItemId)
        if (itemIdx !== -1) {
          movedItem = check.items[itemIdx]
          return {
            ...check,
            items: check.items.filter((_, i) => i !== itemIdx),
          }
        }
        return check
      })

      if (!movedItem) return prev

      // Create new check with the item
      const newCheck: SplitCheck = {
        id: `check-${newCheckNum}`,
        label: `Check ${newCheckNum}`,
        color: SEAT_COLORS[(newCheckNum - 1) % SEAT_COLORS.length],
        items: [movedItem],
        subtotal: 0,
      }

      return recomputeSubtotals([...updated, newCheck])
    })

    setSelectedItemId(null)
  }, [selectedItemId])

  const splitItem = useCallback((itemId: string, ways: number) => {
    if (ways < 2) return

    setChecks(prev => {
      let targetCheckIdx = -1
      let targetItemIdx = -1

      for (let ci = 0; ci < prev.length; ci++) {
        const ii = prev[ci].items.findIndex(i => i.id === itemId)
        if (ii !== -1) {
          targetCheckIdx = ci
          targetItemIdx = ii
          break
        }
      }

      if (targetCheckIdx === -1) return prev

      const item = prev[targetCheckIdx].items[targetItemIdx]
      const totalAmount = item.price * item.quantity
      const amounts = splitAmountEvenly(totalAmount, ways, 'none')
      const shareKey = `split-${item.originalItemId}`

      const newShares: SplitItemShare[] = amounts.map((amount, i) => {
        const shareId = nextShareIdRef.current++
        return {
          id: `share-${shareId}`,
          originalItemId: item.originalItemId,
          seatNumber: item.seatNumber,
          name: item.name,
          price: amount,
          quantity: 1,
          categoryType: item.categoryType,
          isSentToKitchen: item.isSentToKitchen,
          isPaid: item.isPaid,
          shareKey,
          fractionLabel: `${i + 1}/${ways}`,
        }
      })

      const result = prev.map((check, ci) => {
        if (ci !== targetCheckIdx) return check
        const newItems = [...check.items]
        newItems.splice(targetItemIdx, 1, ...newShares)
        return { ...check, items: newItems }
      })

      return recomputeSubtotals(result)
    })
  }, [])

  const applyMode = useCallback((mode: SplitMode) => {
    // Collect all items from all checks
    const allItems: SplitItemShare[] = []
    for (const check of checks) {
      allItems.push(...check.items)
    }

    let newChecks: SplitCheck[]

    switch (mode) {
      case 'by_seat': {
        const seatMap = new Map<number, SplitItemShare[]>()
        const noSeatItems: SplitItemShare[] = []

        for (const item of allItems) {
          if (item.seatNumber != null) {
            const arr = seatMap.get(item.seatNumber) || []
            arr.push(item)
            seatMap.set(item.seatNumber, arr)
          } else {
            noSeatItems.push(item)
          }
        }

        let checkIdx = 1
        newChecks = []
        const sortedSeats = Array.from(seatMap.keys()).sort((a, b) => a - b)
        for (const seatNum of sortedSeats) {
          newChecks.push({
            id: `check-${nextCheckNumRef.current++}`,
            label: `Seat ${seatNum}`,
            color: getSeatColor(seatNum, true),
            seatNumber: seatNum,
            items: seatMap.get(seatNum)!,
            subtotal: 0,
          })
          checkIdx++
        }

        if (noSeatItems.length > 0) {
          newChecks.push({
            id: `check-${nextCheckNumRef.current++}`,
            label: 'No Seat',
            color: NO_SEAT_COLOR,
            items: noSeatItems,
            subtotal: 0,
          })
        }

        // If no seats found, put everything in one check
        if (newChecks.length === 0) {
          newChecks = [{
            id: `check-${nextCheckNumRef.current++}`,
            label: 'Check 1',
            color: SEAT_COLORS[0],
            items: allItems,
            subtotal: 0,
          }]
        }

        newChecks = recomputeSubtotals(newChecks)
        break
      }

      case 'custom': {
        newChecks = recomputeSubtotals([{
          id: `check-${nextCheckNumRef.current++}`,
          label: 'Check 1',
          color: SEAT_COLORS[0],
          items: allItems,
          subtotal: 0,
        }])
        break
      }

      case 'even': {
        // Don't rearrange items — just set mode. UI handles even display.
        setSplitMode('even')
        setSelectedItemId(null)
        return
      }

      case 'bp': {
        const businessItems: SplitItemShare[] = []
        const pleasureItems: SplitItemShare[] = []

        for (const item of allItems) {
          if (item.categoryType && PLEASURE_TYPES.has(item.categoryType)) {
            pleasureItems.push(item)
          } else {
            businessItems.push(item)
          }
        }

        newChecks = []
        if (businessItems.length > 0) {
          newChecks.push({
            id: `check-${nextCheckNumRef.current++}`,
            label: 'Business',
            color: BUSINESS_COLOR,
            items: businessItems,
            subtotal: 0,
          })
        }
        if (pleasureItems.length > 0) {
          newChecks.push({
            id: `check-${nextCheckNumRef.current++}`,
            label: 'Pleasure',
            color: PLEASURE_COLOR,
            items: pleasureItems,
            subtotal: 0,
          })
        }

        // If all items ended up in one bucket, still create both checks (empty one too)
        if (newChecks.length === 0) {
          newChecks = [{
            id: `check-${nextCheckNumRef.current++}`,
            label: 'Business',
            color: BUSINESS_COLOR,
            items: allItems,
            subtotal: 0,
          }]
        }

        newChecks = recomputeSubtotals(newChecks)
        break
      }
    }

    setChecks(newChecks)
    setSplitMode(mode)
    setSelectedItemId(null)
  }, [checks])

  const reset = useCallback(() => {
    setChecks(deepClone(originalSnapshotRef.current))
    setSplitMode(originalModeRef.current)
    setSelectedItemId(null)
    setEvenWays(2)
    nextCheckNumRef.current = originalSnapshotRef.current.length + 1
  }, [])

  const getAssignments = useCallback((): SplitAssignments[] => {
    // Find split item IDs (items appearing in multiple checks) — these go in splitItems, not assignments
    const idCounts = new Map<string, number>()
    for (const check of checks) {
      for (const item of check.items) {
        idCounts.set(item.originalItemId, (idCounts.get(item.originalItemId) || 0) + 1)
      }
    }
    const splitOrigIds = new Set<string>()
    for (const [id, count] of idCounts) {
      if (count > 1) splitOrigIds.add(id)
    }

    return checks
      .map((check, idx) => ({
        ticketIndex: idx + 1,
        itemIds: check.items
          .filter(i => !splitOrigIds.has(i.originalItemId))
          .map(i => i.originalItemId),
      }))
      .filter(a => a.itemIds.length > 0)
  }, [checks])

  const getSplitItemsPayload = useCallback(() => {
    // Find all originalItemIds that appear more than once (split items)
    const idCounts = new Map<string, SplitItemShare[]>()
    for (const check of checks) {
      for (const item of check.items) {
        const arr = idCounts.get(item.originalItemId) || []
        arr.push(item)
        idCounts.set(item.originalItemId, arr)
      }
    }

    const result: {
      originalItemId: string
      fractions: Array<{ ticketIndex: number; fraction: number }>
    }[] = []

    for (const [origId, shares] of idCounts) {
      if (shares.length <= 1) continue

      const totalSharePrice = shares.reduce((sum, s) => sum + s.price * s.quantity, 0)
      if (totalSharePrice === 0) continue

      const fractions: Array<{ ticketIndex: number; fraction: number }> = []

      for (const share of shares) {
        // Find which check this share belongs to
        const checkIdx = checks.findIndex(c => c.items.some(i => i.id === share.id))
        if (checkIdx === -1) continue
        fractions.push({
          ticketIndex: checkIdx + 1,
          fraction: (share.price * share.quantity) / totalSharePrice,
        })
      }

      result.push({ originalItemId: origId, fractions })
    }

    return result
  }, [checks])

  return {
    checks,
    splitMode,
    selectedItemId,
    evenWays,
    setEvenWays,
    selectItem,
    moveItemToCheck,
    moveItemToNewCheck,
    splitItem,
    applyMode,
    reset,
    getAssignments,
    getSplitItemsPayload,
    originalTotal,
    splitTotal,
    hasIntegrityIssue,
    integrityIssues,
  }
}
