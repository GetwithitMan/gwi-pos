'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { io, type Socket } from 'socket.io-client'

/**
 * ExpoScreen - Expeditor view for food orders
 *
 * Shows ALL items from all prep stations
 * Displays item status: pending -> cooking -> ready -> served
 * Uses T-S notation: "T4-S2: Burger"
 * "RUN TABLE" button when all items ready
 */

// Item status colors
const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-slate-700/50 border-slate-600',
  cooking: 'bg-amber-900/30 border-amber-500 animate-pulse',
  ready: 'bg-green-900/30 border-green-500',
  served: 'bg-blue-900/20 border-blue-400 opacity-50',
}

const STATUS_ICONS: Record<string, string> = {
  pending: '[ ]',
  cooking: '[~]',
  ready: '[*]',
  served: '[X]',
}

interface ExpoItem {
  id: string
  name: string
  quantity: number
  status: 'pending' | 'cooking' | 'ready' | 'served'
  sourceTableLabel?: string // "T2" from sourceTable
  seatNumber?: number
  modifiers: Array<{ id: string; name: string; depth: number }>
  specialNotes?: string
  categoryName?: string
  completedAt?: string
  prepStationId?: string
  prepStationName?: string
}

interface ExpoOrder {
  id: string
  orderId: string
  orderNumber: number
  orderType: string
  tableName?: string
  tabName?: string
  items: ExpoItem[]
  createdAt: string
  elapsedMinutes: number
  timeStatus: 'fresh' | 'aging' | 'late'
  serverName: string
}

interface ExpoScreenProps {
  locationId: string
  deviceToken?: string
  screenConfig?: {
    id: string
    name: string
    agingWarning: number
    lateWarning: number
    columns: number
    fontSize: string
  }
  routingTag?: string
}

export function ExpoScreen({
  locationId,
  deviceToken,
  screenConfig,
  routingTag = 'expo',
}: ExpoScreenProps) {
  const [orders, setOrders] = useState<ExpoOrder[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date())
  const [socketConnected, setSocketConnected] = useState(false)
  const socketRef = useRef<Socket | null>(null)

  // Fetch orders for expo view
  const loadOrders = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        locationId,
        showAll: 'true',
      })

      const headers: Record<string, string> = {}
      if (deviceToken) {
        headers['x-device-token'] = deviceToken
      }

      const response = await fetch(`/api/kds/expo?${params}`, { headers })

      if (response.ok) {
        const data = await response.json()
        const mappedOrders = mapOrders(data.orders || [])
        setOrders(mappedOrders)
        setLastUpdate(new Date())
      }
    } catch (error) {
      console.error('Failed to load expo orders:', error)
    } finally {
      setIsLoading(false)
    }
  }, [locationId, deviceToken])

  // Socket connection for live updates
  useEffect(() => {
    const socket = io(window.location.origin, {
      path: '/api/socket',
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    })

    socket.on('connect', () => {
      setSocketConnected(true)
      socket.emit('join_station', {
        locationId,
        tags: [routingTag || 'expo'],
        terminalId: `expo-${screenConfig?.id || locationId}-${Date.now()}`,
      })
    })

    // Refresh on any KDS event
    socket.on('kds:order-received', () => loadOrders())
    socket.on('kds:item-status', () => loadOrders())
    socket.on('kds:order-bumped', () => loadOrders())
    socket.on('order:created', () => loadOrders())

    socket.on('disconnect', () => setSocketConnected(false))

    socketRef.current = socket
    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [locationId, routingTag, screenConfig?.id])

  // Initial fetch + fallback polling when socket disconnected
  useEffect(() => {
    // One initial fetch
    loadOrders()

    // Fallback polling ONLY when socket is disconnected (30s, not 3s)
    if (!socketConnected) {
      const interval = setInterval(loadOrders, 30000)
      return () => clearInterval(interval)
    }
  }, [loadOrders, socketConnected])

  // Map raw orders to ExpoOrder format
  function mapOrders(rawOrders: any[]): ExpoOrder[] {
    return rawOrders.map((order) => ({
      id: order.id,
      orderId: order.id,
      orderNumber: order.orderNumber,
      orderType: order.orderType,
      tableName: order.table?.name,
      tabName: order.tabName,
      items: (order.items || []).map(transformItem),
      createdAt: order.createdAt,
      elapsedMinutes: order.elapsedMinutes || 0,
      timeStatus: order.timeStatus || 'fresh',
      serverName: order.employeeName || 'Unknown',
    })).sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    )
  }

  function transformItem(item: any): ExpoItem {
    return {
      id: item.id,
      name: item.name || item.menuItem?.name || 'Unknown',
      quantity: item.quantity || 1,
      status:
        item.kitchenStatus ||
        (item.isCompleted ? 'ready' : 'pending'),
      seatNumber: item.seatNumber,
      modifiers: (item.modifiers || []).map((m: any) => ({
        id: m.id,
        name: m.preModifier ? `${m.preModifier} ${m.name}` : m.name,
        depth: m.depth || 0,
      })),
      specialNotes: item.specialNotes,
      categoryName: item.categoryName,
      completedAt: item.completedAt,
      prepStationId: item.prepStationId,
      prepStationName: item.prepStationName,
    }
  }

  // Update item status
  const updateItemStatus = async (itemId: string, newStatus: string) => {
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      if (deviceToken) headers['x-device-token'] = deviceToken

      await fetch('/api/kds/expo', {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          itemIds: [itemId],
          action: newStatus === 'served' ? 'serve' : 'update_status',
          status: newStatus,
        }),
      })
      loadOrders()
    } catch (error) {
      console.error('Failed to update item status:', error)
    }
  }

  // Run table - mark all ready items as served
  const runTable = async (order: ExpoOrder) => {
    const readyItemIds = order.items
      .filter((item) => item.status === 'ready')
      .map((item) => item.id)

    if (readyItemIds.length === 0) return

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      if (deviceToken) headers['x-device-token'] = deviceToken

      await fetch('/api/kds/expo', {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          itemIds: readyItemIds,
          action: 'serve',
        }),
      })
      loadOrders()
    } catch (error) {
      console.error('Failed to run table:', error)
    }
  }

  // Check if all items are ready
  const canRunTable = (order: ExpoOrder) => {
    const activeItems = order.items.filter((i) => i.status !== 'served')
    return (
      activeItems.length > 0 && activeItems.every((i) => i.status === 'ready')
    )
  }

  // Time status colors
  const getTimeStatusColor = (status: string) => {
    switch (status) {
      case 'fresh':
        return 'border-green-500 text-green-400'
      case 'aging':
        return 'border-amber-500 text-amber-400'
      case 'late':
        return 'border-red-500 text-red-400 animate-pulse'
      default:
        return 'border-slate-500 text-slate-400'
    }
  }

  const formatTime = (minutes: number) => {
    if (minutes < 1) return 'Just now'
    if (minutes < 60) return `${minutes}m`
    const hours = Math.floor(minutes / 60)
    const mins = minutes % 60
    return `${hours}h ${mins}m`
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-4 border-purple-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-400">Loading Expo...</p>
        </div>
      </div>
    )
  }

  const columns = screenConfig?.columns || 4

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      {/* Header */}
      <header className="bg-purple-900 border-b border-purple-700 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold">EXPO</h1>
          <span className="text-purple-300">
            {orders.length} order{orders.length !== 1 ? 's' : ''} | Updated{' '}
            {lastUpdate.toLocaleTimeString()}
            <span className={`ml-2 w-2 h-2 rounded-full inline-block ${socketConnected ? 'bg-green-500' : 'bg-yellow-500 animate-pulse'}`}
              title={socketConnected ? 'Live updates' : 'Polling fallback'} />
          </span>
        </div>
        <button
          onClick={loadOrders}
          className="p-2 bg-purple-800 hover:bg-purple-700 rounded-lg transition-colors"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
        </button>
      </header>

      {/* Orders Grid */}
      <div className="p-4">
        {orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64">
            <div className="w-24 h-24 bg-slate-800 rounded-full flex items-center justify-center mb-4">
              <svg
                className="w-12 h-12 text-green-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <p className="text-slate-400 text-xl">All tables running!</p>
          </div>
        ) : (
          <div
            className="grid gap-4"
            style={{
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            }}
          >
            {orders.map((order) => {
              const allReady = canRunTable(order)

              return (
                <div
                  key={order.id}
                  className={`bg-slate-800 rounded-lg border-t-4 overflow-hidden ${getTimeStatusColor(order.timeStatus)}`}
                >
                  {/* Order Header */}
                  <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl font-bold">
                        #{order.orderNumber}
                      </span>
                    </div>
                    <div
                      className={`text-lg font-mono font-bold ${getTimeStatusColor(order.timeStatus)}`}
                    >
                      {formatTime(order.elapsedMinutes)}
                    </div>
                  </div>

                  {/* Table Info */}
                  <div className="px-4 py-2 bg-slate-900/50 border-b border-slate-700">
                    <div className="font-bold text-lg">
                      {order.tableName ||
                        order.tabName ||
                        'Bar'}
                    </div>
                    <div className="text-sm text-slate-400">
                      Server: {order.serverName}
                    </div>
                  </div>

                  {/* Items */}
                  <div className="divide-y divide-slate-700 max-h-80 overflow-y-auto">
                    {order.items.map((item) => (
                      <div
                        key={item.id}
                        className={`px-4 py-2 cursor-pointer transition-colors border-l-4 ${STATUS_COLORS[item.status]}`}
                        onClick={() => {
                          const nextStatus =
                            item.status === 'pending'
                              ? 'cooking'
                              : item.status === 'cooking'
                                ? 'ready'
                                : item.status === 'ready'
                                  ? 'served'
                                  : 'pending'
                          updateItemStatus(item.id, nextStatus)
                        }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1">
                            <div className="font-medium">
                              <span className="font-mono mr-2 text-slate-500">
                                {STATUS_ICONS[item.status]}
                              </span>
                              {item.sourceTableLabel && (
                                <span className="text-purple-400 mr-1">
                                  {item.sourceTableLabel}
                                  {item.seatNumber && `-S${item.seatNumber}`}:
                                </span>
                              )}
                              {!item.sourceTableLabel && item.seatNumber && (
                                <span className="text-purple-400 mr-1">
                                  S{item.seatNumber}:
                                </span>
                              )}
                              <span className="text-cyan-400 mr-1">
                                {item.quantity}x
                              </span>
                              {item.name}
                            </div>

                            {item.modifiers.slice(0, 2).map((mod) => (
                              <div
                                key={mod.id}
                                className="text-sm text-slate-400 pl-8"
                              >
                                {mod.name}
                              </div>
                            ))}

                            {item.prepStationName && (
                              <div className="text-xs text-slate-500 pl-8 mt-1">
                                via {item.prepStationName}
                              </div>
                            )}
                          </div>

                          {item.status === 'ready' && (
                            <div className="w-6 h-6 bg-green-600 rounded-full flex items-center justify-center flex-shrink-0">
                              <svg
                                className="w-4 h-4 text-white"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={3}
                                  d="M5 13l4 4L19 7"
                                />
                              </svg>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* RUN TABLE Button */}
                  <div className="p-3 border-t border-slate-700">
                    <button
                      onClick={() => runTable(order)}
                      disabled={!allReady}
                      className={`w-full py-3 rounded-lg font-bold text-lg transition-colors ${
                        allReady
                          ? 'bg-green-600 hover:bg-green-700 text-white'
                          : 'bg-slate-700 text-slate-500 cursor-not-allowed'
                      }`}
                    >
                      {allReady ? 'RUN TABLE' : 'Waiting...'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="fixed bottom-0 left-0 right-0 bg-slate-800 border-t border-slate-700 px-4 py-2 flex justify-between items-center text-sm">
        <span className="text-slate-400">
          {screenConfig?.name || 'Expo Screen'}
        </span>
        <span className="font-mono text-2xl">
          {new Date().toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })}
        </span>
        <span className="text-purple-400">Tag: {routingTag}</span>
      </div>
    </div>
  )
}
