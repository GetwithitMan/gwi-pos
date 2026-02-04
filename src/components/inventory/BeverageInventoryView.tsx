'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { toast } from '@/stores/toast-store'
import { formatCurrency } from '@/lib/utils'

interface SpiritCategory {
  id: string
  name: string
  displayName: string | null
}

interface BottleProduct {
  id: string
  name: string
  brand: string | null
  displayName: string | null
  spiritCategoryId: string
  spiritCategory: SpiritCategory
  tier: 'well' | 'call' | 'premium' | 'top_shelf'
  bottleSizeMl: number
  bottleSizeOz: number | null
  unitCost: number
  pourSizeOz: number | null
  poursPerBottle: number | null
  pourCost: number | null
  currentStock: number
  lowStockAlert: number | null
  isActive: boolean
  inventoryItemId: string | null
  inventoryStock: number | null // Stock in oz from linked InventoryItem
}

interface BeverageInventoryViewProps {
  locationId: string
}

const TIER_ORDER: Record<string, number> = {
  well: 0,
  call: 1,
  premium: 2,
  top_shelf: 3,
}

const TIER_LABELS: Record<string, string> = {
  well: 'Well',
  call: 'Call',
  premium: 'Premium',
  top_shelf: 'Top Shelf',
}

const TIER_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  well: { bg: 'bg-gray-500/20', text: 'text-gray-300', border: 'border-gray-500/30' },
  call: { bg: 'bg-blue-500/20', text: 'text-blue-300', border: 'border-blue-500/30' },
  premium: { bg: 'bg-purple-500/20', text: 'text-purple-300', border: 'border-purple-500/30' },
  top_shelf: { bg: 'bg-amber-500/20', text: 'text-amber-300', border: 'border-amber-500/30' },
}

export function BeverageInventoryView({ locationId }: BeverageInventoryViewProps) {
  const [bottles, setBottles] = useState<BottleProduct[]>([])
  const [categories, setCategories] = useState<SpiritCategory[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedBottle, setSelectedBottle] = useState<BottleProduct | null>(null)
  const [showAdjustModal, setShowAdjustModal] = useState(false)
  const [syncStatus, setSyncStatus] = useState<{ needsSync: number; total: number } | null>(null)
  const [isSyncing, setIsSyncing] = useState(false)

  // Filters
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [tierFilter, setTierFilter] = useState<string>('all')
  const [lowStockOnly, setLowStockOnly] = useState(false)

  useEffect(() => {
    loadData()
    checkSyncStatus()
  }, [locationId])

  const loadData = async () => {
    setIsLoading(true)
    try {
      const [bottlesRes, categoriesRes] = await Promise.all([
        fetch('/api/liquor/bottles'),
        fetch('/api/liquor/categories'),
      ])

      if (bottlesRes.ok) {
        const data = await bottlesRes.json()
        setBottles(data || [])
      }
      if (categoriesRes.ok) {
        const data = await categoriesRes.json()
        setCategories(data || [])
      }
    } catch (error) {
      console.error('Failed to load beverage inventory:', error)
      toast.error('Failed to load beverage inventory')
    } finally {
      setIsLoading(false)
    }
  }

  const checkSyncStatus = async () => {
    try {
      const res = await fetch('/api/liquor/bottles/sync-inventory')
      if (res.ok) {
        const data = await res.json()
        setSyncStatus(data)
      }
    } catch (error) {
      console.error('Failed to check sync status:', error)
    }
  }

  const handleSyncInventory = async () => {
    setIsSyncing(true)
    try {
      const res = await fetch('/api/liquor/bottles/sync-inventory', {
        method: 'POST',
      })
      const data = await res.json()
      if (res.ok) {
        toast.success(data.message)
        await loadData()
        await checkSyncStatus()
      } else {
        toast.error(data.error || 'Failed to sync inventory')
      }
    } catch (error) {
      console.error('Failed to sync inventory:', error)
      toast.error('Failed to sync inventory')
    } finally {
      setIsSyncing(false)
    }
  }

  // Filter and group bottles
  const { filteredBottles, groupedByCategory } = useMemo(() => {
    let filtered = bottles

    // Search filter
    if (search) {
      const searchLower = search.toLowerCase()
      filtered = filtered.filter(b =>
        b.name.toLowerCase().includes(searchLower) ||
        b.brand?.toLowerCase().includes(searchLower) ||
        b.displayName?.toLowerCase().includes(searchLower)
      )
    }

    // Category filter
    if (categoryFilter !== 'all') {
      filtered = filtered.filter(b => b.spiritCategoryId === categoryFilter)
    }

    // Tier filter
    if (tierFilter !== 'all') {
      filtered = filtered.filter(b => b.tier === tierFilter)
    }

    // Low stock filter
    if (lowStockOnly) {
      filtered = filtered.filter(b =>
        b.lowStockAlert !== null && b.currentStock <= b.lowStockAlert
      )
    }

    // Group by category
    const grouped: Record<string, BottleProduct[]> = {}
    for (const bottle of filtered) {
      const catName = bottle.spiritCategory?.name || 'Uncategorized'
      if (!grouped[catName]) {
        grouped[catName] = []
      }
      grouped[catName].push(bottle)
    }

    // Sort within each category by tier then name
    for (const cat of Object.keys(grouped)) {
      grouped[cat].sort((a, b) => {
        const tierDiff = (TIER_ORDER[a.tier] || 0) - (TIER_ORDER[b.tier] || 0)
        if (tierDiff !== 0) return tierDiff
        return a.name.localeCompare(b.name)
      })
    }

    return { filteredBottles: filtered, groupedByCategory: grouped }
  }, [bottles, search, categoryFilter, tierFilter, lowStockOnly])

  // Calculate inventory value
  const totalValue = useMemo(() => {
    return bottles.reduce((sum, b) => sum + (b.currentStock * b.unitCost), 0)
  }, [bottles])

  const totalBottles = useMemo(() => {
    return bottles.reduce((sum, b) => sum + b.currentStock, 0)
  }, [bottles])

  const lowStockCount = useMemo(() => {
    return bottles.filter(b => b.lowStockAlert !== null && b.currentStock <= b.lowStockAlert).length
  }, [bottles])

  const isLowStock = (bottle: BottleProduct) =>
    bottle.lowStockAlert !== null && bottle.currentStock <= bottle.lowStockAlert

  // Convert oz to bottles for display
  const formatStock = (bottle: BottleProduct) => {
    const stockOz = bottle.inventoryStock !== null
      ? bottle.inventoryStock
      : (bottle.bottleSizeOz ? bottle.currentStock * bottle.bottleSizeOz : null)

    if (stockOz !== null && bottle.bottleSizeOz) {
      const bottlesCount = stockOz / bottle.bottleSizeOz
      return {
        bottles: bottlesCount.toFixed(1),
        oz: stockOz.toFixed(1),
      }
    }

    return {
      bottles: bottle.currentStock.toString(),
      oz: bottle.bottleSizeOz ? (bottle.currentStock * bottle.bottleSizeOz).toFixed(1) : '-',
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-white/60">Loading beverage inventory...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Sync Alert Banner */}
      {syncStatus && syncStatus.needsSync > 0 && (
        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
                <svg className="w-5 h-5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <p className="font-medium text-amber-200">
                  {syncStatus.needsSync} bottles need inventory sync
                </p>
                <p className="text-sm text-amber-300/70">
                  These bottles were created before the inventory integration. Sync them to enable stock tracking.
                </p>
              </div>
            </div>
            <Button
              onClick={handleSyncInventory}
              disabled={isSyncing}
              className="bg-amber-500/20 border border-amber-500/30 text-amber-200 hover:bg-amber-500/30"
            >
              {isSyncing ? 'Syncing...' : 'Sync Now'}
            </Button>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-slate-900/80 backdrop-blur-xl border border-white/10 text-center">
          <p className="text-3xl font-bold text-white">{bottles.length}</p>
          <p className="text-xs text-white/50 mt-1">Products</p>
        </div>
        <div className="p-4 rounded-xl bg-slate-900/80 backdrop-blur-xl border border-white/10 text-center">
          <p className="text-3xl font-bold text-white">{totalBottles.toFixed(1)}</p>
          <p className="text-xs text-white/50 mt-1">Total Bottles</p>
        </div>
        <div className="p-4 rounded-xl bg-slate-900/80 backdrop-blur-xl border border-white/10 text-center">
          <p className="text-3xl font-bold text-emerald-400">{formatCurrency(totalValue)}</p>
          <p className="text-xs text-white/50 mt-1">Inventory Value</p>
        </div>
        <div className={`p-4 rounded-xl backdrop-blur-xl border text-center ${
          lowStockCount > 0
            ? 'bg-red-500/10 border-red-500/30'
            : 'bg-slate-900/80 border-white/10'
        }`}>
          <p className={`text-3xl font-bold ${lowStockCount > 0 ? 'text-red-400' : 'text-white'}`}>
            {lowStockCount}
          </p>
          <p className="text-xs text-white/50 mt-1">Low Stock Items</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-4 items-center p-4 rounded-xl bg-slate-900/80 backdrop-blur-xl border border-white/10">
        <input
          type="text"
          placeholder="Search bottles..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder-white/40 w-64 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
        />
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50"
        >
          <option value="all" className="bg-slate-800">All Categories</option>
          {categories.map(c => (
            <option key={c.id} value={c.id} className="bg-slate-800">{c.displayName || c.name}</option>
          ))}
        </select>
        <select
          value={tierFilter}
          onChange={(e) => setTierFilter(e.target.value)}
          className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50"
        >
          <option value="all" className="bg-slate-800">All Tiers</option>
          <option value="well" className="bg-slate-800">Well</option>
          <option value="call" className="bg-slate-800">Call</option>
          <option value="premium" className="bg-slate-800">Premium</option>
          <option value="top_shelf" className="bg-slate-800">Top Shelf</option>
        </select>
        <label className="flex items-center gap-2 cursor-pointer text-white/70 hover:text-white">
          <input
            type="checkbox"
            checked={lowStockOnly}
            onChange={(e) => setLowStockOnly(e.target.checked)}
            className="rounded bg-white/10 border-white/20"
          />
          <span className="text-sm">Low Stock Only</span>
        </label>
        <div className="flex-1" />
        <Link href="/liquor-builder">
          <Button variant="outline" className="border-white/20 text-white hover:bg-white/10">
            Liquor Builder
          </Button>
        </Link>
        <Button variant="ghost" onClick={loadData} className="text-white/70 hover:text-white hover:bg-white/10">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </Button>
      </div>

      {/* Bottles by Category */}
      {Object.keys(groupedByCategory).length === 0 ? (
        <div className="text-center py-12 rounded-xl bg-slate-900/80 backdrop-blur-xl border border-white/10">
          <div className="text-white/60">
            {bottles.length === 0
              ? 'No bottles found. Add bottles in the Liquor Builder.'
              : 'No bottles match your filters.'}
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(groupedByCategory)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([categoryName, categoryBottles]) => (
              <div key={categoryName} className="rounded-xl bg-slate-900/80 backdrop-blur-xl border border-white/10 overflow-hidden">
                <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-white">{categoryName}</h3>
                  <span className="text-sm text-white/50">{categoryBottles.length} items</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="text-left text-xs text-white/40 border-b border-white/5">
                        <th className="px-6 py-3 font-medium">Product</th>
                        <th className="px-4 py-3 font-medium">Tier</th>
                        <th className="px-4 py-3 font-medium text-right">Size</th>
                        <th className="px-4 py-3 font-medium text-right">Unit Cost</th>
                        <th className="px-4 py-3 font-medium text-right">Pour Cost</th>
                        <th className="px-4 py-3 font-medium text-right">Stock</th>
                        <th className="px-4 py-3 font-medium text-right">Value</th>
                        <th className="px-4 py-3 font-medium text-center">Status</th>
                        <th className="px-4 py-3"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {categoryBottles.map(bottle => {
                        const stock = formatStock(bottle)
                        const tierStyle = TIER_COLORS[bottle.tier]
                        const lowStock = isLowStock(bottle)

                        return (
                          <tr
                            key={bottle.id}
                            className={`border-b border-white/5 last:border-0 hover:bg-white/5 transition-colors ${
                              lowStock ? 'bg-red-500/5' : ''
                            }`}
                          >
                            <td className="px-6 py-3">
                              <div className="font-medium text-white">{bottle.name}</div>
                              {bottle.brand && (
                                <div className="text-xs text-white/40">{bottle.brand}</div>
                              )}
                            </td>
                            <td className="px-4 py-3">
                              <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${tierStyle.bg} ${tierStyle.text} ${tierStyle.border}`}>
                                {TIER_LABELS[bottle.tier]}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right text-sm text-white/70">
                              {bottle.bottleSizeMl}ml
                              {bottle.bottleSizeOz && (
                                <span className="text-white/40 ml-1">
                                  ({bottle.bottleSizeOz.toFixed(1)}oz)
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right text-sm text-white/70">
                              {formatCurrency(bottle.unitCost)}
                            </td>
                            <td className="px-4 py-3 text-right text-sm">
                              <span className="text-emerald-400">
                                {bottle.pourCost ? formatCurrency(bottle.pourCost) : '-'}
                              </span>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <div className={`font-mono text-sm ${lowStock ? 'text-red-400' : 'text-white'}`}>
                                {stock.bottles} <span className="text-white/40">btl</span>
                              </div>
                              <div className="text-xs text-white/40 font-mono">
                                {stock.oz} oz
                              </div>
                              {bottle.lowStockAlert !== null && (
                                <div className="text-xs text-white/30">
                                  par: {bottle.lowStockAlert}
                                </div>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right text-sm text-white/70">
                              {formatCurrency(bottle.currentStock * bottle.unitCost)}
                            </td>
                            <td className="px-4 py-3 text-center">
                              <div className="flex items-center justify-center gap-2">
                                {lowStock ? (
                                  <span className="px-2 py-1 rounded text-xs bg-red-500/20 text-red-400 border border-red-500/30">
                                    Low Stock
                                  </span>
                                ) : (
                                  <span className="px-2 py-1 rounded text-xs bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                                    In Stock
                                  </span>
                                )}
                                {bottle.inventoryItemId && (
                                  <span className="w-2 h-2 rounded-full bg-emerald-400" title="Synced to Inventory" />
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3 text-right">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setSelectedBottle(bottle)
                                  setShowAdjustModal(true)
                                }}
                                className="text-white/50 hover:text-white hover:bg-white/10"
                              >
                                Adjust
                              </Button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
        </div>
      )}

      {/* Adjust Stock Modal */}
      {showAdjustModal && selectedBottle && (
        <AdjustBottleStockModal
          bottle={selectedBottle}
          onClose={() => {
            setShowAdjustModal(false)
            setSelectedBottle(null)
          }}
          onSave={() => {
            setShowAdjustModal(false)
            setSelectedBottle(null)
            loadData()
          }}
        />
      )}
    </div>
  )
}

// Adjust Bottle Stock Modal with glassmorphism
function AdjustBottleStockModal({
  bottle,
  onClose,
  onSave,
}: {
  bottle: BottleProduct
  onClose: () => void
  onSave: () => void
}) {
  const [adjustment, setAdjustment] = useState(0)
  const [reason, setReason] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  const newStock = bottle.currentStock + adjustment

  const handleSave = async () => {
    if (adjustment === 0) {
      toast.error('Adjustment cannot be 0')
      return
    }

    setIsSaving(true)
    try {
      const res = await fetch(`/api/liquor/bottles/${bottle.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentStock: newStock,
        }),
      })

      if (res.ok) {
        toast.success('Stock adjusted')
        onSave()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to adjust stock')
      }
    } catch (error) {
      console.error('Failed to adjust stock:', error)
      toast.error('Failed to adjust stock')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="w-full max-w-md rounded-xl bg-slate-900/95 backdrop-blur-xl border border-white/10 shadow-2xl">
        <div className="px-6 py-4 border-b border-white/10">
          <h2 className="text-lg font-semibold text-white">Adjust Stock</h2>
          <p className="text-sm text-white/50">{bottle.name}</p>
        </div>
        <div className="p-6 space-y-4">
          <div className="p-3 rounded-lg bg-white/5 border border-white/10">
            <div className="text-sm text-white/50">Current stock</div>
            <div className="text-xl font-bold text-white">
              {bottle.currentStock} bottles
              {bottle.bottleSizeOz && (
                <span className="text-sm font-normal text-white/40 ml-2">
                  ({(bottle.currentStock * bottle.bottleSizeOz).toFixed(1)} oz)
                </span>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm text-white/70 mb-2">Adjustment (bottles)</label>
            <input
              type="number"
              step="1"
              value={adjustment}
              onChange={(e) => setAdjustment(parseInt(e.target.value) || 0)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              placeholder="+/- bottles"
            />
            <p className="text-xs text-white/40 mt-1">
              Use positive for additions, negative for removals
            </p>
          </div>

          <div className="p-3 rounded-lg bg-white/5 border border-white/10">
            <div className="text-sm text-white/50">New stock will be</div>
            <div className={`text-xl font-bold ${newStock < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
              {newStock} bottles
              {bottle.bottleSizeOz && (
                <span className="text-sm font-normal text-white/40 ml-2">
                  ({(newStock * bottle.bottleSizeOz).toFixed(1)} oz)
                </span>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm text-white/70 mb-2">Reason / Notes</label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              placeholder="Optional"
            />
          </div>

          <div className="flex gap-3 pt-4">
            <Button
              variant="ghost"
              onClick={onClose}
              disabled={isSaving}
              className="flex-1 border border-white/10 text-white hover:bg-white/10"
            >
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSaving || adjustment === 0}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
            >
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
