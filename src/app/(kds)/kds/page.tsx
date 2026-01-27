'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuthStore } from '@/stores/auth-store'

interface KDSItem {
  id: string
  name: string
  quantity: number
  categoryName: string | null
  specialNotes: string | null
  isCompleted: boolean
  completedAt: string | null
  resendCount: number
  lastResentAt: string | null
  modifiers: { id: string; name: string }[]
}

interface KDSOrder {
  id: string
  orderNumber: number
  orderType: string
  tableName: string | null
  tabName: string | null
  employeeName: string
  createdAt: string
  elapsedMinutes: number
  timeStatus: 'fresh' | 'aging' | 'late'
  notes: string | null
  items: KDSItem[]
}

interface PrepStation {
  id: string
  name: string
  displayName: string | null
  color: string | null
  stationType: string
  showAllItems: boolean
}

const ORDER_TYPE_LABELS: Record<string, string> = {
  dine_in: 'Dine In',
  takeout: 'Takeout',
  delivery: 'Delivery',
  bar_tab: 'Bar',
}

const ORDER_TYPE_COLORS: Record<string, string> = {
  dine_in: 'bg-blue-600',
  takeout: 'bg-orange-600',
  delivery: 'bg-purple-600',
  bar_tab: 'bg-green-600',
}

function KDSContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const stationId = searchParams.get('station')
  const { employee, isAuthenticated } = useAuthStore()

  const [orders, setOrders] = useState<KDSOrder[]>([])
  const [station, setStation] = useState<PrepStation | null>(null)
  const [stations, setStations] = useState<PrepStation[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date())
  const [showCompleted, setShowCompleted] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)

  // Load available stations
  useEffect(() => {
    if (employee?.location?.id) {
      loadStations()
    }
  }, [employee?.location?.id])

  // Load orders on interval
  useEffect(() => {
    if (!employee?.location?.id) return

    loadOrders()
    const interval = setInterval(loadOrders, 5000) // Refresh every 5 seconds

    return () => clearInterval(interval)
  }, [employee?.location?.id, stationId, showCompleted])

  // Redirect if not authenticated
  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login')
    }
  }, [isAuthenticated, router])

  const loadStations = async () => {
    try {
      const response = await fetch(`/api/prep-stations?locationId=${employee?.location?.id}`)
      if (response.ok) {
        const data = await response.json()
        setStations(data.stations || [])
      }
    } catch (error) {
      console.error('Failed to load stations:', error)
    }
  }

  const loadOrders = useCallback(async () => {
    if (!employee?.location?.id) return

    try {
      const params = new URLSearchParams({
        locationId: employee.location.id,
      })
      if (stationId) {
        params.append('stationId', stationId)
      } else {
        params.append('showAll', 'true')
      }

      const response = await fetch(`/api/kds?${params}`)
      if (response.ok) {
        const data = await response.json()

        // Filter out orders where all items are completed (unless showCompleted)
        let filteredOrders = data.orders || []
        if (!showCompleted) {
          filteredOrders = filteredOrders.filter((order: KDSOrder) =>
            order.items.some(item => !item.isCompleted)
          )
        }

        setOrders(filteredOrders)
        setStation(data.station)
        setLastUpdate(new Date())
      }
    } catch (error) {
      console.error('Failed to load KDS orders:', error)
    } finally {
      setIsLoading(false)
    }
  }, [employee?.location?.id, stationId, showCompleted])

  const handleBumpItem = async (itemId: string) => {
    try {
      await fetch('/api/kds', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemIds: [itemId],
          action: 'complete',
        }),
      })
      loadOrders()
    } catch (error) {
      console.error('Failed to bump item:', error)
    }
  }

  const handleBumpOrder = async (order: KDSOrder) => {
    const incompleteItemIds = order.items
      .filter(item => !item.isCompleted)
      .map(item => item.id)

    if (incompleteItemIds.length === 0) return

    try {
      await fetch('/api/kds', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemIds: incompleteItemIds,
          action: 'bump_order',
        }),
      })
      loadOrders()
    } catch (error) {
      console.error('Failed to bump order:', error)
    }
  }

  const handleUncompleteItem = async (itemId: string) => {
    try {
      await fetch('/api/kds', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemIds: [itemId],
          action: 'uncomplete',
        }),
      })
      loadOrders()
    } catch (error) {
      console.error('Failed to uncomplete item:', error)
    }
  }

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen()
      setIsFullscreen(true)
    } else {
      document.exitFullscreen()
      setIsFullscreen(false)
    }
  }

  const formatTime = (minutes: number) => {
    if (minutes < 1) return 'Just now'
    if (minutes < 60) return `${minutes}m`
    const hours = Math.floor(minutes / 60)
    const mins = minutes % 60
    return `${hours}h ${mins}m`
  }

  const getTimeStatusColor = (status: string) => {
    switch (status) {
      case 'fresh': return 'text-green-400'
      case 'aging': return 'text-yellow-400'
      case 'late': return 'text-red-400'
      default: return 'text-gray-400'
    }
  }

  const getTimeStatusBg = (status: string) => {
    switch (status) {
      case 'fresh': return 'border-green-500'
      case 'aging': return 'border-yellow-500'
      case 'late': return 'border-red-500 animate-pulse'
      default: return 'border-gray-500'
    }
  }

  if (!isAuthenticated) return null

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push('/orders')}
            className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              {station ? (
                <>
                  <span
                    className="w-4 h-4 rounded"
                    style={{ backgroundColor: station.color || '#3B82F6' }}
                  />
                  {station.displayName || station.name}
                </>
              ) : (
                'All Stations'
              )}
            </h1>
            <p className="text-sm text-gray-400">
              {orders.length} order{orders.length !== 1 ? 's' : ''} •
              Updated {lastUpdate.toLocaleTimeString()}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Station Selector */}
          <select
            value={stationId || ''}
            onChange={(e) => {
              const newStation = e.target.value
              if (newStation) {
                router.push(`/kds?station=${newStation}`)
              } else {
                router.push('/kds')
              }
            }}
            className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">All Stations</option>
            {stations.map(s => (
              <option key={s.id} value={s.id}>
                {s.displayName || s.name}
              </option>
            ))}
          </select>

          {/* Show Completed Toggle */}
          <button
            onClick={() => setShowCompleted(!showCompleted)}
            className={`px-3 py-2 rounded-lg text-sm transition-colors ${
              showCompleted
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            {showCompleted ? 'Hide Done' : 'Show Done'}
          </button>

          {/* Fullscreen Toggle */}
          <button
            onClick={toggleFullscreen}
            className="p-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
          >
            {isFullscreen ? (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
              </svg>
            )}
          </button>

          {/* Refresh Button */}
          <button
            onClick={loadOrders}
            className="p-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </header>

      {/* Orders Grid */}
      <div className="p-4">
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-gray-400 text-xl">Loading orders...</div>
          </div>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64">
            <div className="w-24 h-24 bg-gray-800 rounded-full flex items-center justify-center mb-4">
              <svg className="w-12 h-12 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-gray-400 text-xl">All caught up!</p>
            <p className="text-gray-500 text-sm mt-1">No pending orders</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
            {orders.map(order => {
              const allCompleted = order.items.every(item => item.isCompleted)
              const someCompleted = order.items.some(item => item.isCompleted)

              return (
                <div
                  key={order.id}
                  className={`bg-gray-800 rounded-lg border-t-4 overflow-hidden transition-all ${
                    allCompleted ? 'opacity-50 border-green-500' : getTimeStatusBg(order.timeStatus)
                  }`}
                >
                  {/* Order Header */}
                  <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className={`text-2xl font-bold ${allCompleted ? 'text-green-400' : ''}`}>
                        #{order.orderNumber}
                      </span>
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${ORDER_TYPE_COLORS[order.orderType]} text-white`}>
                        {ORDER_TYPE_LABELS[order.orderType] || order.orderType}
                      </span>
                    </div>
                    <div className={`text-lg font-mono font-bold ${getTimeStatusColor(order.timeStatus)}`}>
                      {formatTime(order.elapsedMinutes)}
                    </div>
                  </div>

                  {/* Order Info */}
                  <div className="px-4 py-2 bg-gray-750 border-b border-gray-700 text-sm text-gray-400">
                    <div className="flex justify-between">
                      <span>{order.tableName || order.tabName || order.employeeName}</span>
                      <span>{order.items.length} item{order.items.length !== 1 ? 's' : ''}</span>
                    </div>
                  </div>

                  {/* Items */}
                  <div className="divide-y divide-gray-700">
                    {order.items.map(item => (
                      <div
                        key={item.id}
                        className={`px-4 py-3 transition-colors ${
                          item.isCompleted
                            ? 'bg-green-900/20'
                            : 'hover:bg-gray-750 cursor-pointer'
                        }`}
                        onClick={() => {
                          if (item.isCompleted) {
                            handleUncompleteItem(item.id)
                          } else {
                            handleBumpItem(item.id)
                          }
                        }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1">
                            <div className={`font-medium ${item.isCompleted ? 'line-through text-gray-500' : 'text-white'}`}>
                              <span className="text-blue-400 mr-2">{item.quantity}x</span>
                              {item.name}
                              {/* RESEND badge */}
                              {item.resendCount > 0 && (
                                <span className="ml-2 px-2 py-0.5 bg-red-600 text-white text-xs font-bold rounded animate-pulse">
                                  🔄 RESEND{item.resendCount > 1 ? ` x${item.resendCount}` : ''}
                                </span>
                              )}
                            </div>

                            {/* Modifiers */}
                            {item.modifiers.length > 0 && (
                              <div className="mt-1 space-y-0.5">
                                {item.modifiers.map(mod => (
                                  <div
                                    key={mod.id}
                                    className={`text-sm pl-4 ${item.isCompleted ? 'text-gray-600' : 'text-yellow-400'}`}
                                  >
                                    • {mod.name}
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* Special Notes */}
                            {item.specialNotes && (
                              <div className={`mt-1 text-sm font-medium ${
                                item.isCompleted ? 'text-gray-600' : 'text-orange-400'
                              }`}>
                                ⚠ {item.specialNotes}
                              </div>
                            )}
                          </div>

                          {/* Completion indicator */}
                          {item.isCompleted ? (
                            <div className="w-6 h-6 bg-green-600 rounded-full flex items-center justify-center flex-shrink-0">
                              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                              </svg>
                            </div>
                          ) : (
                            <div className="w-6 h-6 border-2 border-gray-500 rounded-full flex-shrink-0" />
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Order Notes */}
                  {order.notes && (
                    <div className="px-4 py-2 bg-orange-900/30 border-t border-orange-800/50">
                      <p className="text-sm text-orange-300">
                        <span className="font-medium">Note:</span> {order.notes}
                      </p>
                    </div>
                  )}

                  {/* Bump Order Button */}
                  {!allCompleted && (
                    <div className="p-3 border-t border-gray-700">
                      <button
                        onClick={() => handleBumpOrder(order)}
                        className="w-full py-3 bg-green-600 hover:bg-green-700 rounded-lg font-bold text-lg transition-colors"
                      >
                        BUMP ORDER
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Footer - Current Time */}
      <div className="fixed bottom-0 left-0 right-0 bg-gray-800 border-t border-gray-700 px-4 py-2 flex justify-between items-center text-sm">
        <span className="text-gray-400">
          {employee?.location?.name}
        </span>
        <span className="font-mono text-2xl">
          {new Date().toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })}
        </span>
        <span className="text-gray-400">
          KDS v1.0
        </span>
      </div>
    </div>
  )
}

function KDSLoading() {
  return (
    <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
      <div className="text-gray-400 text-xl">Loading KDS...</div>
    </div>
  )
}

export default function KDSPage() {
  return (
    <Suspense fallback={<KDSLoading />}>
      <KDSContent />
    </Suspense>
  )
}
