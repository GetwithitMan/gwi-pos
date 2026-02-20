'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { toast } from '@/stores/toast-store'
import { Modal } from '@/components/ui/modal'

interface StockItem {
  id: string
  name: string
  category: string
  categoryIcon: string | null
  categoryColor: string | null
  parentName: string | null
  currentStock: number
  unit: string
  countPrecision: 'whole' | 'decimal'
  lowStockThreshold: number | null
  criticalStockThreshold: number | null
  lastCountedAt: string | null
}

interface PendingChange {
  itemId: string
  itemName: string
  category: string
  previousStock: number
  newStock: number
  unit: string
}

type StockLevel = 'critical' | 'low' | 'ok' | 'good'

function getStockLevel(item: StockItem): StockLevel {
  const { currentStock, lowStockThreshold, criticalStockThreshold } = item
  if (criticalStockThreshold !== null && currentStock <= criticalStockThreshold) return 'critical'
  if (lowStockThreshold !== null && currentStock <= lowStockThreshold) return 'low'
  if (lowStockThreshold !== null && currentStock > lowStockThreshold * 2) return 'good'
  return 'ok'
}

const STOCK_COLORS: Record<StockLevel, { bg: string; text: string; border: string; dot: string }> = {
  critical: { bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-300', dot: 'bg-red-500' },
  low: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-300', dot: 'bg-amber-500' },
  ok: { bg: 'bg-white', text: 'text-gray-700', border: 'border-gray-200', dot: 'bg-gray-300' },
  good: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', dot: 'bg-emerald-500' },
}

export default function QuickStockAdjustPage() {
  const employee = useAuthStore(s => s.employee)
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/inventory/quick-adjust' })
  const [items, setItems] = useState<StockItem[]>([])
  const [byCategory, setByCategory] = useState<Record<string, StockItem[]>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [stockFilter, setStockFilter] = useState<'all' | 'low' | 'critical'>('all')

  // Collapsed categories - all collapsed by default
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())

  // Pending changes tracking
  const [pendingChanges, setPendingChanges] = useState<Map<string, PendingChange>>(new Map())
  const [localStocks, setLocalStocks] = useState<Map<string, number>>(new Map())

  // Verification modal
  const [showVerifyModal, setShowVerifyModal] = useState(false)
  const [verifyText, setVerifyText] = useState('')
  const [employeePin, setEmployeePin] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [pinError, setPinError] = useState('')

  const locationId = employee?.location?.id

  const loadData = useCallback(async () => {
    if (!locationId) return
    try {
      setIsLoading(true)
      const response = await fetch(`/api/inventory/stock-adjust?locationId=${locationId}`)
      if (response.ok) {
        const data = await response.json()
        setItems(data.data.items || [])
        setByCategory(data.data.byCategory || {})
        // Reset local state
        setLocalStocks(new Map())
        setPendingChanges(new Map())
      } else {
        toast.error('Failed to load stock items')
      }
    } catch (error) {
      console.error('Failed to load stock items:', error)
      toast.error('Failed to load stock items')
    } finally {
      setIsLoading(false)
    }
  }, [locationId])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Get current stock (local override or original)
  const getCurrentStock = (item: StockItem): number => {
    return localStocks.has(item.id) ? localStocks.get(item.id)! : item.currentStock
  }

  const filteredByCategory = useMemo(() => {
    const result: Record<string, StockItem[]> = {}
    for (const [category, categoryItems] of Object.entries(byCategory)) {
      const filtered = categoryItems.filter(item => {
        if (searchQuery) {
          const query = searchQuery.toLowerCase()
          if (!item.name.toLowerCase().includes(query) && !item.parentName?.toLowerCase().includes(query)) {
            return false
          }
        }
        if (stockFilter !== 'all') {
          const level = getStockLevel(item)
          if (stockFilter === 'critical' && level !== 'critical') return false
          if (stockFilter === 'low' && level !== 'low' && level !== 'critical') return false
        }
        return true
      })
      if (filtered.length > 0) result[category] = filtered
    }
    return result
  }, [byCategory, searchQuery, stockFilter])

  const stats = useMemo(() => {
    let critical = 0, low = 0
    for (const item of items) {
      const level = getStockLevel(item)
      if (level === 'critical') critical++
      else if (level === 'low') low++
    }
    return { critical, low, total: items.length }
  }, [items])

  // Stage a change locally (doesn't save to server yet)
  const handleLocalAdjust = (item: StockItem, operation: 'add' | 'subtract' | 'set', quantity: number) => {
    const currentStock = getCurrentStock(item)
    let newStock: number

    switch (operation) {
      case 'set':
        newStock = quantity
        break
      case 'add':
        newStock = currentStock + quantity
        break
      case 'subtract':
        newStock = Math.max(0, currentStock - quantity)
        break
    }

    // Round based on precision
    if (item.countPrecision === 'whole') {
      newStock = Math.round(newStock)
    } else {
      newStock = Math.round(newStock * 100) / 100
    }

    // Update local stock display
    setLocalStocks(prev => new Map(prev).set(item.id, newStock))

    // Track the pending change (compare to ORIGINAL stock, not local)
    if (newStock !== item.currentStock) {
      setPendingChanges(prev => {
        const next = new Map(prev)
        next.set(item.id, {
          itemId: item.id,
          itemName: item.name,
          category: item.category,
          previousStock: item.currentStock,
          newStock,
          unit: item.unit,
        })
        return next
      })
    } else {
      // Remove from pending if back to original
      setPendingChanges(prev => {
        const next = new Map(prev)
        next.delete(item.id)
        return next
      })
    }
  }

  const handleDiscardChanges = () => {
    setLocalStocks(new Map())
    setPendingChanges(new Map())
    toast.info('Changes discarded')
  }

  const handleOpenVerifyModal = () => {
    setVerifyText('')
    setEmployeePin('')
    setPinError('')
    setShowVerifyModal(true)
  }

  const handleVerifyAndSave = async () => {
    // Validate "VERIFY" text
    if (verifyText.toUpperCase() !== 'VERIFY') {
      setPinError('Please type VERIFY to confirm')
      return
    }

    // Validate PIN
    if (!employeePin || employeePin.length < 4) {
      setPinError('Please enter your employee PIN')
      return
    }

    // Verify PIN against server
    setIsSaving(true)
    setPinError('')

    try {
      // First verify the PIN
      const pinResponse = await fetch('/api/auth/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: employeePin, locationId }),
      })

      if (!pinResponse.ok) {
        setPinError('Invalid PIN. Please try again.')
        setIsSaving(false)
        return
      }

      const pinData = await pinResponse.json()
      const verifiedEmployeeId = pinData.data.employee?.id

      if (!verifiedEmployeeId) {
        setPinError('Could not verify employee. Please try again.')
        setIsSaving(false)
        return
      }

      // Now save all pending changes
      const adjustments = Array.from(pendingChanges.values()).map(change => ({
        ingredientId: change.itemId,
        quantity: change.newStock,
        operation: 'set',
      }))

      const response = await fetch('/api/inventory/stock-adjust', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adjustments,
          employeeId: verifiedEmployeeId,
        }),
      })

      if (response.ok) {
        const data = await response.json()
        toast.success(`${data.data.summary.success} item(s) updated successfully`)
        setShowVerifyModal(false)
        // Reload data to get fresh state
        await loadData()
      } else {
        toast.error('Failed to save adjustments')
      }
    } catch (error) {
      console.error('Error saving adjustments:', error)
      toast.error('Failed to save adjustments')
    } finally {
      setIsSaving(false)
    }
  }

  const toggleCategory = (category: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev)
      if (next.has(category)) {
        next.delete(category)
      } else {
        next.add(category)
      }
      return next
    })
  }

  if (!hydrated) return null

  const pendingCount = pendingChanges.size

  return (
    <div className="h-[calc(100vh-120px)] flex flex-col bg-gray-50">
      {/* Compact Header */}
      <div className="bg-blue-600 px-4 py-2 flex items-center gap-4 flex-shrink-0">
        <Link href="/orders" className="text-blue-200 hover:text-white">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Link>
        <h1 className="text-lg font-bold text-white">Quick Stock Adjust</h1>

        {/* Stats */}
        <div className="flex gap-2 ml-auto">
          {stats.critical > 0 && (
            <button
              onClick={() => setStockFilter(stockFilter === 'critical' ? 'all' : 'critical')}
              className={`px-2 py-1 rounded text-xs font-medium ${stockFilter === 'critical' ? 'bg-red-500 text-white' : 'bg-red-400/30 text-white'}`}
            >
              {stats.critical} Critical
            </button>
          )}
          {stats.low > 0 && (
            <button
              onClick={() => setStockFilter(stockFilter === 'low' ? 'all' : 'low')}
              className={`px-2 py-1 rounded text-xs font-medium ${stockFilter === 'low' ? 'bg-amber-500 text-white' : 'bg-amber-400/30 text-white'}`}
            >
              {stats.low} Low
            </button>
          )}
          <span className="px-2 py-1 rounded bg-white/20 text-white text-xs">{stats.total} items</span>
        </div>
      </div>

      {/* Search Bar */}
      <div className="px-4 py-2 bg-white border-b flex gap-2 flex-shrink-0">
        <div className="flex-1 relative">
          <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search..."
            className="w-full pl-8 pr-3 py-1.5 text-sm border rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
        </div>
        {stockFilter !== 'all' && (
          <Button size="sm" variant="outline" onClick={() => setStockFilter('all')} className="text-xs">
            Clear Filter
          </Button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-2">
        {isLoading ? (
          <div className="flex items-center justify-center py-10 text-gray-500 text-sm">Loading...</div>
        ) : Object.keys(filteredByCategory).length === 0 ? (
          <div className="text-center py-10 text-gray-500 text-sm">
            {items.length === 0 ? 'No daily count items configured' : 'No items match filters'}
          </div>
        ) : (
          <div className="space-y-1">
            {Object.entries(filteredByCategory).map(([category, categoryItems]) => {
              const isExpanded = expandedCategories.has(category)
              const categoryPendingCount = categoryItems.filter(i => pendingChanges.has(i.id)).length

              return (
                <div key={category} className="bg-white rounded-lg border overflow-hidden">
                  {/* Category Header - Clickable to expand/collapse */}
                  <button
                    onClick={() => toggleCategory(category)}
                    className="w-full px-3 py-2 bg-gray-100 border-b flex items-center justify-between hover:bg-gray-150 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <svg
                        className={`w-4 h-4 text-gray-500 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                      <span className="font-medium text-sm text-gray-700">{category}</span>
                      <span className="text-xs text-gray-500">({categoryItems.length})</span>
                    </div>
                    {categoryPendingCount > 0 && (
                      <span className="px-2 py-0.5 bg-orange-100 text-orange-700 text-xs font-medium rounded-full">
                        {categoryPendingCount} pending
                      </span>
                    )}
                  </button>

                  {/* Items - Only shown when expanded */}
                  {isExpanded && (
                    <div className="divide-y">
                      {categoryItems.map(item => (
                        <StockRow
                          key={item.id}
                          item={item}
                          currentStock={getCurrentStock(item)}
                          hasPendingChange={pendingChanges.has(item.id)}
                          onAdjust={handleLocalAdjust}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Pending Changes Footer */}
      {pendingCount > 0 && (
        <div className="flex-shrink-0 border-t bg-orange-50 px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm font-medium text-orange-800">
                {pendingCount} unsaved change{pendingCount !== 1 ? 's' : ''}
              </span>
              <p className="text-xs text-orange-600">Changes require verification before saving</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={handleDiscardChanges}>
                Discard
              </Button>
              <Button size="sm" onClick={handleOpenVerifyModal} className="bg-orange-600 hover:bg-orange-700">
                Review & Save
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Verification Modal */}
      <Modal
        isOpen={showVerifyModal}
        onClose={() => setShowVerifyModal(false)}
        title="Confirm Stock Adjustments"
        size="md"
      >

            {/* Changes Summary */}
            <div className="py-3 max-h-48 overflow-y-auto border-b">
              <p className="text-xs text-gray-500 mb-2 font-medium">CHANGES TO BE SAVED:</p>
              <div className="space-y-1">
                {Array.from(pendingChanges.values()).map(change => (
                  <div key={change.itemId} className="flex items-center justify-between text-sm py-1">
                    <span className="text-gray-700 truncate flex-1">{change.itemName}</span>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-gray-400">{change.previousStock}</span>
                      <span className="text-gray-400">→</span>
                      <span className={`font-medium ${change.newStock > change.previousStock ? 'text-green-600' : change.newStock < change.previousStock ? 'text-red-600' : 'text-gray-600'}`}>
                        {change.newStock}
                      </span>
                      <span className="text-xs text-gray-400">{change.unit}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Verification Form */}
            <div className="py-4 space-y-4">
              {/* Type VERIFY */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Type <span className="font-bold text-orange-600">VERIFY</span> to confirm
                </label>
                <input
                  type="text"
                  value={verifyText}
                  onChange={(e) => setVerifyText(e.target.value)}
                  placeholder="Type VERIFY"
                  className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-orange-400 text-center font-mono uppercase"
                  autoComplete="off"
                />
              </div>

              {/* Employee PIN */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Enter your employee PIN
                </label>
                <input
                  type="password"
                  inputMode="numeric"
                  value={employeePin}
                  onChange={(e) => setEmployeePin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="****"
                  className="w-full px-3 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-orange-400 text-center font-mono text-xl tracking-widest"
                  autoComplete="off"
                />
                <p className="text-xs text-gray-500 mt-1">Your PIN will be logged with this adjustment</p>
              </div>

              {/* Error Message */}
              {pinError && (
                <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">
                  {pinError}
                </div>
              )}
            </div>

            {/* Modal Actions */}
            <div className="pt-3 border-t flex gap-2">
              <Button
                variant="outline"
                onClick={() => setShowVerifyModal(false)}
                disabled={isSaving}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                onClick={handleVerifyAndSave}
                disabled={isSaving || verifyText.toUpperCase() !== 'VERIFY' || employeePin.length < 4}
                className="flex-1 bg-orange-600 hover:bg-orange-700"
              >
                {isSaving ? 'Saving...' : 'Confirm & Save'}
              </Button>
            </div>
      </Modal>
    </div>
  )
}

function StockRow({
  item,
  currentStock,
  hasPendingChange,
  onAdjust,
}: {
  item: StockItem
  currentStock: number
  hasPendingChange: boolean
  onAdjust: (item: StockItem, op: 'add' | 'subtract' | 'set', qty: number) => void
}) {
  const [editing, setEditing] = useState(false)
  const [editVal, setEditVal] = useState('')
  const level = getStockLevel({ ...item, currentStock })
  const colors = STOCK_COLORS[level]
  const step = item.countPrecision === 'decimal' ? 0.5 : 1

  const handleSet = () => {
    const val = parseFloat(editVal)
    if (!isNaN(val) && val >= 0) {
      onAdjust(item, 'set', val)
      setEditing(false)
    }
  }

  return (
    <div className={`flex items-center gap-2 px-2 py-1.5 ${hasPendingChange ? 'bg-orange-50' : colors.bg}`}>
      {/* Status dot */}
      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${hasPendingChange ? 'bg-orange-500' : colors.dot}`} />

      {/* Name */}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-900 truncate">{item.name}</div>
        {item.parentName && <div className="text-xs text-gray-500 truncate">from {item.parentName}</div>}
      </div>

      {/* Original stock indicator when changed */}
      {hasPendingChange && (
        <div className="text-xs text-gray-400 flex-shrink-0">
          was {item.currentStock}
        </div>
      )}

      {/* Controls */}
      {editing ? (
        <div className="flex items-center gap-1">
          <input
            type="number"
            value={editVal}
            onChange={(e) => setEditVal(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSet(); if (e.key === 'Escape') setEditing(false); }}
            autoFocus
            className="w-16 h-7 text-center text-sm border rounded focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          <button onClick={handleSet} className="px-2 h-7 text-xs bg-blue-500 text-white rounded hover:bg-blue-600">Set</button>
          <button onClick={() => setEditing(false)} className="px-2 h-7 text-xs bg-gray-200 rounded hover:bg-gray-300">X</button>
        </div>
      ) : (
        <div className="flex items-center gap-1">
          {/* Subtract */}
          <button
            onClick={() => onAdjust(item, 'subtract', step)}
            disabled={currentStock <= 0}
            className="w-8 h-8 flex items-center justify-center bg-white border rounded text-lg font-bold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
          >
            −
          </button>

          {/* Stock Display */}
          <button
            onClick={() => { setEditVal(currentStock.toString()); setEditing(true); }}
            className={`w-16 h-8 flex flex-col items-center justify-center border rounded ${hasPendingChange ? 'border-orange-400 bg-orange-50' : `${colors.border} ${colors.bg}`}`}
          >
            <span className={`text-sm font-bold leading-tight ${hasPendingChange ? 'text-orange-700' : colors.text}`}>
              {currentStock}
            </span>
            <span className="text-[10px] text-gray-500 leading-tight">{item.unit}</span>
          </button>

          {/* Add */}
          <button
            onClick={() => onAdjust(item, 'add', step)}
            className="w-8 h-8 flex items-center justify-center bg-white border rounded text-lg font-bold text-gray-600 hover:bg-gray-50"
          >
            +
          </button>

          {/* Quick +5 */}
          <button
            onClick={() => onAdjust(item, 'add', step * 5)}
            className="px-1.5 h-8 text-xs font-medium bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
          >
            +{step * 5}
          </button>
        </div>
      )}
    </div>
  )
}
