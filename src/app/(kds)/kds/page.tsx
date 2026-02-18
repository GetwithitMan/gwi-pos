'use client'

import { useState, useEffect, useCallback, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { getSharedSocket, releaseSharedSocket } from '@/lib/shared-socket'
import type { Socket } from 'socket.io-client'
import { useAuthStore } from '@/stores/auth-store'

// LocalStorage keys for device authentication
const DEVICE_TOKEN_KEY = 'kds_device_token'
const SCREEN_CONFIG_KEY = 'kds_screen_config'

interface IngredientMod {
  id: string
  ingredientName: string
  modificationType: 'no' | 'lite' | 'on_side' | 'extra' | 'swap'
  swappedToModifierName?: string | null
}

interface KDSItem {
  id: string
  name: string
  quantity: number
  categoryName: string | null
  specialNotes: string | null
  isCompleted: boolean
  completedAt: string | null
  completedBy: string | null  // Who marked complete (T023)
  resendCount: number
  lastResentAt: string | null
  resendNote: string | null
  // Seat assignment (T023)
  seatNumber: number | null
  // Coursing info (T013)
  courseNumber: number | null
  courseStatus: string
  isHeld: boolean
  firedAt: string | null
  modifiers: { id: string; name: string; depth?: number }[]
  ingredientModifications: IngredientMod[]
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
  showAllItems?: boolean
}

interface ScreenConfig {
  id: string
  name: string
  slug: string | null
  screenType: string
  locationId: string
  columns: number
  fontSize: string
  colorScheme: string
  agingWarning: number
  lateWarning: number
  playSound: boolean
  flashOnNew: boolean
  stations: Array<{
    id: string
    name: string
    displayName: string | null
    stationType: string
    color: string | null
  }>
}

type AuthState = 'checking' | 'authenticated' | 'requires_pairing' | 'employee_fallback'

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

// Course colors for KDS display (T013)
const COURSE_COLORS: Record<number, string> = {
  0: '#EF4444', // ASAP - Red
  1: '#3B82F6', // Course 1 - Blue
  2: '#10B981', // Course 2 - Green
  3: '#F59E0B', // Course 3 - Amber
  4: '#EC4899', // Course 4 - Pink
  5: '#8B5CF6', // Course 5 - Violet
}

const getCourseColor = (courseNumber: number): string => {
  return COURSE_COLORS[courseNumber] || '#6B7280'
}

function KDSContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const screenParam = searchParams.get('screen') // Can be slug or ID
  const stationParam = searchParams.get('station') // Legacy station filter
  const employee = useAuthStore(s => s.employee)
  const isEmployeeAuthenticated = useAuthStore(s => s.isAuthenticated)

  // Authentication state
  const [authState, setAuthState] = useState<AuthState>('checking')
  const [screenConfig, setScreenConfig] = useState<ScreenConfig | null>(null)
  const [deviceToken, setDeviceToken] = useState<string | null>(null)

  // KDS state
  const [orders, setOrders] = useState<KDSOrder[]>([])
  const [station, setStation] = useState<PrepStation | null>(null)
  const [stations, setStations] = useState<PrepStation[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date())
  const [showCompleted, setShowCompleted] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [socketConnected, setSocketConnected] = useState(false)
  const socketRef = useRef<Socket | null>(null)

  // Authenticate device on mount
  useEffect(() => {
    authenticateDevice()
  }, [screenParam])

  const authenticateDevice = async () => {
    setAuthState('checking')

    // Get stored token
    const storedToken = localStorage.getItem(DEVICE_TOKEN_KEY)
    const storedConfig = localStorage.getItem(SCREEN_CONFIG_KEY)

    // If we have a screen parameter, try to authenticate
    if (screenParam) {
      try {
        const headers: Record<string, string> = {}
        if (storedToken) {
          headers['x-device-token'] = storedToken
        }

        // Try to authenticate with the screen
        const response = await fetch(
          `/api/hardware/kds-screens/auth?slug=${encodeURIComponent(screenParam)}`,
          { headers }
        )

        const data = await response.json()

        if (response.ok && data.authenticated) {
          // Successfully authenticated
          setScreenConfig(data.screen)
          setDeviceToken(storedToken)
          localStorage.setItem(SCREEN_CONFIG_KEY, JSON.stringify(data.screen))
          setAuthState('authenticated')
          return
        }

        if (response.status === 401 && data.requiresPairing) {
          // Screen requires pairing
          setAuthState('requires_pairing')
          return
        }

        // Screen not found or other error
        if (response.status === 404) {
          // Invalid screen parameter
          console.error('Screen not found:', screenParam)
        }
      } catch (error) {
        console.error('Authentication failed:', error)
      }
    }

    // If we have a stored config and token, try to use them
    if (storedToken && storedConfig) {
      try {
        const config = JSON.parse(storedConfig) as ScreenConfig

        // Verify the token is still valid
        const response = await fetch(
          `/api/hardware/kds-screens/auth?screenId=${config.id}`,
          { headers: { 'x-device-token': storedToken } }
        )

        if (response.ok) {
          const data = await response.json()
          setScreenConfig(data.screen)
          setDeviceToken(storedToken)
          setAuthState('authenticated')
          return
        }
      } catch (error) {
        // Invalid stored config, clear it
        localStorage.removeItem(DEVICE_TOKEN_KEY)
        localStorage.removeItem(SCREEN_CONFIG_KEY)
      }
    }

    // Fall back to employee authentication (for managers/troubleshooting)
    if (isEmployeeAuthenticated && employee) {
      setAuthState('employee_fallback')
      return
    }

    // No authentication - require pairing
    setAuthState('requires_pairing')
  }

  // Redirect to pairing if needed
  useEffect(() => {
    if (authState === 'requires_pairing') {
      const returnUrl = screenParam ? `/kds?screen=${screenParam}` : '/kds'
      router.push(`/kds/pair?returnTo=${encodeURIComponent(returnUrl)}${screenParam ? `&screen=${screenParam}` : ''}`)
    }
  }, [authState, screenParam, router])

  // Load stations based on screen config or employee location
  useEffect(() => {
    if (authState === 'authenticated' && screenConfig) {
      // Use stations from screen config
      setStations(screenConfig.stations)
    } else if (authState === 'employee_fallback' && employee?.location?.id) {
      loadStations()
    }
  }, [authState, screenConfig, employee?.location?.id])

  // Socket connection for live updates (shared socket)
  useEffect(() => {
    if (authState !== 'authenticated' && authState !== 'employee_fallback') return

    const socket = getSharedSocket()

    const onConnect = () => {
      setSocketConnected(true)

      const locationId = getLocationId()

      // Build tags from station config
      const tags: string[] = []
      if (screenConfig?.stations?.length) {
        screenConfig.stations.forEach(s => {
          if (s.stationType) tags.push(s.stationType)
        })
      }
      if (tags.length === 0) tags.push('kitchen')

      const stationIds = getStationIds()

      socket.emit('join_station', {
        locationId,
        tags,
        terminalId: `kds-${screenConfig?.id || 'fallback'}`,
        stationId: stationIds?.[0],
      })
    }

    const loadOrdersDebounceRef = { current: null as NodeJS.Timeout | null }
    const debouncedLoadOrders = () => {
      if (loadOrdersDebounceRef.current) clearTimeout(loadOrdersDebounceRef.current)
      loadOrdersDebounceRef.current = setTimeout(() => {
        loadOrders()
      }, 200)
    }

    const onOrderReceived = () => debouncedLoadOrders()
    const onItemStatus = () => debouncedLoadOrders()
    const onOrderBumped = () => debouncedLoadOrders()
    const onOrderCreated = () => debouncedLoadOrders()
    const onDisconnect = () => setSocketConnected(false)

    socket.on('connect', onConnect)
    socket.on('kds:order-received', onOrderReceived)
    socket.on('kds:item-status', onItemStatus)
    socket.on('kds:order-bumped', onOrderBumped)
    socket.on('order:created', onOrderCreated)
    socket.on('disconnect', onDisconnect)

    if (socket.connected) {
      onConnect()
    }

    socketRef.current = socket
    return () => {
      if (loadOrdersDebounceRef.current) clearTimeout(loadOrdersDebounceRef.current)
      socket.off('connect', onConnect)
      socket.off('kds:order-received', onOrderReceived)
      socket.off('kds:item-status', onItemStatus)
      socket.off('kds:order-bumped', onOrderBumped)
      socket.off('order:created', onOrderCreated)
      socket.off('disconnect', onDisconnect)
      socketRef.current = null
      releaseSharedSocket()
    }
  }, [authState, screenConfig])

  // Load orders on mount + heartbeat (always runs)
  useEffect(() => {
    if (authState !== 'authenticated' && authState !== 'employee_fallback') return

    // One initial fetch on mount
    loadOrders()

    // Heartbeat always runs (device keepalive)
    const heartbeatInterval = setInterval(sendHeartbeat, 30000)
    sendHeartbeat()

    return () => {
      clearInterval(heartbeatInterval)
    }
  }, [authState, screenConfig, stationParam, showCompleted])

  // Fallback polling ONLY when socket is disconnected (20s)
  useEffect(() => {
    if (authState !== 'authenticated' && authState !== 'employee_fallback') return
    if (socketConnected) return
    const fallback = setInterval(loadOrders, 20000)
    return () => clearInterval(fallback)
  }, [authState, socketConnected])

  // Instant refresh on tab switch
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === 'visible') loadOrders()
    }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [])

  const sendHeartbeat = async () => {
    if (!screenConfig || !deviceToken) return

    try {
      await fetch(`/api/hardware/kds-screens/${screenConfig.id}/heartbeat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-device-token': deviceToken,
        },
      })
    } catch (error) {
      console.error('Heartbeat failed:', error)
    }
  }

  const loadStations = async () => {
    if (!employee?.location?.id) return

    try {
      const response = await fetch(`/api/prep-stations?locationId=${employee.location.id}`)
      if (response.ok) {
        const data = await response.json()
        setStations(data.stations || [])
      }
    } catch (error) {
      console.error('Failed to load stations:', error)
    }
  }

  const getLocationId = () => {
    if (screenConfig?.locationId) return screenConfig.locationId
    if (employee?.location?.id) return employee.location.id
    return '' // No location available
  }

  const getStationIds = () => {
    // If using screen config, use its assigned stations
    if (screenConfig?.stations?.length) {
      return screenConfig.stations.map(s => s.id)
    }
    // If using legacy station param
    if (stationParam) {
      return [stationParam]
    }
    return null // All stations
  }

  const loadOrders = useCallback(async () => {
    const locationId = getLocationId()
    if (!locationId) return

    try {
      const params = new URLSearchParams({ locationId })

      const stationIds = getStationIds()
      if (stationIds && stationIds.length > 0) {
        stationIds.forEach(id => params.append('stationId', id))
      } else {
        params.append('showAll', 'true')
      }

      const headers: Record<string, string> = {}
      if (deviceToken) {
        headers['x-device-token'] = deviceToken
      }

      const response = await fetch(`/api/kds?${params}`, { headers })

      if (response.status === 401) {
        // Token expired or invalid
        setAuthState('requires_pairing')
        return
      }

      if (response.ok) {
        const data = await response.json()

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
  }, [screenConfig, stationParam, showCompleted, deviceToken])

  const handleBumpItem = useCallback(async (itemId: string) => {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (deviceToken) headers['x-device-token'] = deviceToken

      await fetch('/api/kds', {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          itemIds: [itemId],
          action: 'complete',
        }),
      })
      loadOrders()
    } catch (error) {
      console.error('Failed to bump item:', error)
    }
  }, [deviceToken, loadOrders])

  const handleBumpOrder = useCallback(async (order: KDSOrder) => {
    const incompleteItemIds = order.items
      .filter(item => !item.isCompleted)
      .map(item => item.id)

    if (incompleteItemIds.length === 0) return

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (deviceToken) headers['x-device-token'] = deviceToken

      await fetch('/api/kds', {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          itemIds: incompleteItemIds,
          action: 'bump_order',
        }),
      })
      loadOrders()
    } catch (error) {
      console.error('Failed to bump order:', error)
    }
  }, [deviceToken, loadOrders])

  const handleUncompleteItem = useCallback(async (itemId: string) => {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (deviceToken) headers['x-device-token'] = deviceToken

      await fetch('/api/kds', {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          itemIds: [itemId],
          action: 'uncomplete',
        }),
      })
      loadOrders()
    } catch (error) {
      console.error('Failed to uncomplete item:', error)
    }
  }, [deviceToken, loadOrders])

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

  // Show loading while checking auth
  if (authState === 'checking') {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <div className="text-gray-400 text-xl">Authenticating...</div>
        </div>
      </div>
    )
  }

  // Show unauthorized screen (should redirect, but just in case)
  if (authState === 'requires_pairing') {
    return (
      <div className="min-h-screen bg-gray-900 text-white flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="w-20 h-20 bg-red-900/50 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-10 h-10 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold mb-2">Device Not Authorized</h1>
          <p className="text-gray-400 mb-6">This display needs to be paired before it can access the KDS.</p>
          <button
            onClick={() => router.push('/kds/pair')}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium transition-colors"
          >
            Pair This Device
          </button>
        </div>
      </div>
    )
  }

  const displayName = screenConfig?.name || station?.displayName || station?.name || 'All Stations'
  const locationName = employee?.location?.name || screenConfig?.locationId || ''

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700 px-4 py-3 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center gap-4">
          {authState === 'employee_fallback' && (
            <button
              onClick={() => router.push('/orders')}
              className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          )}
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              {screenConfig ? (
                <>
                  <span className="w-3 h-3 rounded-full bg-green-500" title="Paired" />
                  {screenConfig.name}
                </>
              ) : station ? (
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
              <span className={`ml-2 w-2 h-2 rounded-full inline-block ${socketConnected ? 'bg-green-500' : 'bg-yellow-500 animate-pulse'}`}
                title={socketConnected ? 'Live updates' : 'Polling fallback'} />
              {authState === 'employee_fallback' && (
                <span className="ml-2 text-yellow-500">(Employee Mode)</span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Station Selector - only for employee fallback mode */}
          {authState === 'employee_fallback' && (
            <select
              value={stationParam || ''}
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
          )}

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
                              {/* Seat number prefix (T023) */}
                              {item.seatNumber && (
                                <span className="text-purple-400 font-bold mr-1">S{item.seatNumber}:</span>
                              )}
                              <span className="text-blue-400 mr-2">{item.quantity}x</span>
                              {item.name}
                              {/* Course badge (T013) */}
                              {item.courseNumber != null && item.courseNumber >= 0 && (
                                <span
                                  className={`ml-2 px-1.5 py-0.5 text-xs font-bold rounded text-white ${item.isHeld ? 'animate-pulse ring-1 ring-red-400' : ''}`}
                                  style={{ backgroundColor: getCourseColor(item.courseNumber) }}
                                >
                                  {item.courseNumber === 0 ? 'ASAP' : `C${item.courseNumber}`}
                                  {item.courseStatus === 'fired' && ' '}
                                  {item.courseStatus === 'ready' && ' '}
                                </span>
                              )}
                              {/* Held badge */}
                              {item.isHeld && (
                                <span className="ml-1 px-1.5 py-0.5 bg-red-600 text-white text-xs font-bold rounded animate-pulse">
                                  HOLD
                                </span>
                              )}
                              {item.resendCount > 0 && (
                                <span className="ml-2 px-2 py-0.5 bg-red-600 text-white text-xs font-bold rounded animate-pulse">
                                  RESEND{item.resendCount > 1 ? ` x${item.resendCount}` : ''}
                                </span>
                              )}
                            </div>

                            {item.resendNote && (
                              <div className={`mt-1 text-sm font-medium ${item.isCompleted ? 'text-gray-600' : 'text-red-400'}`}>
                                {item.resendNote}
                              </div>
                            )}

                            {item.ingredientModifications?.length > 0 && (
                              <div className="mt-1 space-y-0.5">
                                {item.ingredientModifications.map(ing => (
                                  <div
                                    key={ing.id}
                                    className={`text-sm pl-4 font-semibold ${
                                      item.isCompleted ? 'text-gray-600' :
                                      ing.modificationType === 'no' ? 'text-red-400' :
                                      ing.modificationType === 'swap' ? 'text-purple-400' :
                                      ing.modificationType === 'extra' ? 'text-green-400' : 'text-cyan-400'
                                    }`}
                                  >
                                    {ing.modificationType === 'no' && `NO ${ing.ingredientName}`}
                                    {ing.modificationType === 'lite' && `LITE ${ing.ingredientName}`}
                                    {ing.modificationType === 'on_side' && `SIDE ${ing.ingredientName}`}
                                    {ing.modificationType === 'extra' && `EXTRA ${ing.ingredientName}`}
                                    {ing.modificationType === 'swap' && `SWAP ${ing.ingredientName} → ${ing.swappedToModifierName}`}
                                  </div>
                                ))}
                              </div>
                            )}

                            {item.modifiers.length > 0 && (
                              <div className="mt-1 space-y-0.5">
                                {item.modifiers.map(mod => {
                                  const depth = mod.depth || 0
                                  const prefix = depth > 0 ? '-'.repeat(depth) + ' ' : '• '
                                  return (
                                    <div
                                      key={mod.id}
                                      className={`text-sm pl-4 ${
                                        item.isCompleted ? 'text-gray-600' : depth === 0 ? 'text-yellow-400' : 'text-yellow-300'
                                      }`}
                                    >
                                      {prefix}{mod.name}
                                    </div>
                                  )
                                })}
                              </div>
                            )}

                            {item.specialNotes && (
                              <div className={`mt-1 text-sm font-medium ${item.isCompleted ? 'text-gray-600' : 'text-orange-400'}`}>
                                {item.specialNotes}
                              </div>
                            )}

                            {/* Completion info (T023) */}
                            {item.isCompleted && item.completedAt && (
                              <div className="mt-1 text-xs text-green-500">
                                ✓ Completed {new Date(item.completedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                                {item.completedBy && <span className="text-gray-500"> by {item.completedBy}</span>}
                              </div>
                            )}
                          </div>

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

                  {order.notes && (
                    <div className="px-4 py-2 bg-orange-900/30 border-t border-orange-800/50">
                      <p className="text-sm text-orange-300">
                        <span className="font-medium">Note:</span> {order.notes}
                      </p>
                    </div>
                  )}

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

      {/* Footer */}
      <div className="fixed bottom-0 left-0 right-0 bg-gray-800 border-t border-gray-700 px-4 py-2 flex justify-between items-center text-sm">
        <span className="text-gray-400">
          {locationName}
        </span>
        <span className="font-mono text-2xl">
          {new Date().toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
          })}
        </span>
        <span className="text-gray-400 flex items-center gap-2">
          {screenConfig && <span className="w-2 h-2 rounded-full bg-green-500" />}
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
