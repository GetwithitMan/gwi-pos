'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card } from '@/components/ui/card'
import { formatDate } from '@/lib/utils'

interface BatchInfo {
  batchId: string | null
  source: string | null
  count: number
  available: number
  createdAt: string | null
}

interface PoolData {
  total: number
  available: number
  activated: number
  lowPoolAlert: boolean
  threshold: number
  byBatch: BatchInfo[]
}

interface GiftCardPoolStatusProps {
  locationId: string | undefined
  refreshKey: number
}

export function GiftCardPoolStatus({ locationId, refreshKey }: GiftCardPoolStatusProps) {
  const [pool, setPool] = useState<PoolData | null>(null)
  const [loading, setLoading] = useState(true)

  const loadPool = useCallback(async () => {
    if (!locationId) return
    setLoading(true)
    try {
      const response = await fetch(`/api/gift-cards/pool?locationId=${locationId}`)
      if (response.ok) {
        const data = await response.json()
        setPool(data)
      }
    } catch (error) {
      console.error('Failed to load pool status:', error)
    } finally {
      setLoading(false)
    }
  }, [locationId])

  useEffect(() => {
    loadPool()
  }, [loadPool, refreshKey])

  if (loading) {
    return (
      <Card className="p-6 animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-32 mb-4" />
        <div className="h-8 bg-gray-200 rounded w-16 mb-2" />
        <div className="h-4 bg-gray-200 rounded w-24" />
      </Card>
    )
  }

  if (!pool) return null

  const usagePercent = pool.total > 0 ? Math.round((pool.activated / pool.total) * 100) : 0

  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-900">Pool Inventory</h3>
        {pool.lowPoolAlert && (
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
            Low Pool (below {pool.threshold})
          </span>
        )}
      </div>

      {/* Overview stats */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="text-center">
          <p className="text-2xl font-bold text-gray-900">{pool.total}</p>
          <p className="text-xs text-gray-500">Total</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-yellow-600">{pool.available}</p>
          <p className="text-xs text-gray-500">Available</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-green-600">{pool.activated}</p>
          <p className="text-xs text-gray-500">Activated</p>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-4">
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>{usagePercent}% used</span>
          <span>{pool.available} remaining</span>
        </div>
        <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${
              pool.lowPoolAlert ? 'bg-amber-500' : 'bg-green-500'
            }`}
            style={{ width: `${usagePercent}%` }}
          />
        </div>
      </div>

      {/* Per-batch breakdown */}
      {pool.byBatch.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">Batches</h4>
          <div className="space-y-2">
            {pool.byBatch.map((batch, i) => (
              <div key={batch.batchId || i} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg text-xs">
                <div>
                  <span className="font-mono text-gray-600">
                    {batch.batchId ? batch.batchId.slice(0, 8) + '...' : 'Unknown'}
                  </span>
                  <span className="ml-2 text-gray-400 capitalize">{batch.source}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-gray-500">{batch.available}/{batch.count} available</span>
                  {batch.createdAt && (
                    <span className="text-gray-400">{formatDate(batch.createdAt)}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {pool.total === 0 && (
        <p className="text-sm text-gray-500 text-center py-2">
          No cards in pool. Import or generate card numbers to get started.
        </p>
      )}
    </Card>
  )
}
