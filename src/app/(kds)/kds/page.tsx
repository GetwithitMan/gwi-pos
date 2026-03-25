'use client'

import { useState, useEffect, useCallback, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { getSharedSocket, releaseSharedSocket } from '@/lib/shared-socket'
import type { Socket } from 'socket.io-client'
import { useAuthStore } from '@/stores/auth-store'
import { SilentErrorBoundary } from '@/components/ui/SilentErrorBoundary'
import { KDSClockModal } from '../components/KDSClockModal'
import { ToastContainer } from '@/components/ui/ToastContainer'
import DeliveryExpoRail from '@/components/delivery/DeliveryExpoRail'
import { KDSOrderCard, ORDER_TYPE_LABELS } from '../components/KDSOrderCard'
import type { KDSOrder } from '../components/KDSOrderCard'
import { KDSHeader } from '../components/KDSHeader'
import { KDSAllDayCounts } from '../components/KDSAllDayCounts'

// LocalStorage keys for device authentication
const DEVICE_TOKEN_KEY = 'kds_device_token'
const SCREEN_CONFIG_KEY = 'kds_screen_config'

function playNotificationSound() {
  try {
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()
    const oscillator = audioCtx.createOscillator()
    const gainNode = audioCtx.createGain()
    oscillator.connect(gainNode)
    gainNode.connect(audioCtx.destination)
    oscillator.frequency.value = 800
    oscillator.type = 'sine'
    gainNode.gain.value = 0.3
    oscillator.start()
    gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.5)
    oscillator.stop(audioCtx.currentTime + 0.5)
  } catch (e) {
    // Audio not available
  }
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
  // KDS Overhaul: new config fields
  displayMode?: string // 'tiled' | 'classic' | 'split' | 'takeout'
  transitionTimes?: Record<string, { caution: number; late: number }> | null
  orderBehavior?: {
    tapToStart?: boolean
    mergeCards?: boolean
    mergeWindowMinutes?: number
    newCardPerSend?: boolean
    moveCompletedToBottom?: boolean
    strikeThroughModifiers?: boolean
    resetTimerOnRecall?: boolean
    intelligentSort?: boolean
    showAllDayCounts?: boolean
    allDayCountResetHour?: number
    orderTrackerEnabled?: boolean
    sendSmsOnReady?: boolean
    printOnBump?: boolean
    printerId?: string | null
  } | null
  orderTypeFilters?: Record<string, boolean> | null
  sourceLinks?: Array<{
    id: string
    targetScreenId: string
    targetScreenName: string
    linkType: string
    bumpAction: string
  }>
  stations: Array<{
    id: string
    name: string
    displayName: string | null
    stationType: string
    color: string | null
  }>
}

type AuthState = 'checking' | 'authenticated' | 'requires_pairing' | 'employee_fallback'

// Phase 2: Resolve per-order-type transition times with fallback to global thresholds
function getThresholds(
  orderType: string,
  config: ScreenConfig | null,
): { caution: number; late: number } {
  const tt = config?.transitionTimes
  if (tt && tt[orderType]) {
    return tt[orderType]
  }
  return { caution: config?.agingWarning ?? 10, late: config?.lateWarning ?? 20 }
}

// Phase 2: Compute time status using per-order-type thresholds
function computeTimeStatus(
  createdAt: string,
  orderType: string,
  config: ScreenConfig | null,
): { elapsed: number; status: 'fresh' | 'aging' | 'late' } {
  const { caution, late } = getThresholds(orderType, config)
  const elapsed = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60_000)
  let status: 'fresh' | 'aging' | 'late' = 'fresh'
  if (elapsed >= late) status = 'late'
  else if (elapsed >= caution) status = 'aging'
  return { elapsed, status }
}

function KDSContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const screenParam = searchParams.get('screen') // Can be slug or ID
  const stationParam = searchParams.get('station') // Legacy station filter
  const employee = useAuthStore(s => s.employee)
  const isEmployeeAuthenticated = useAuthStore(s => s.isAuthenticated)

  // Hydration guard: wait for Zustand to rehydrate from localStorage
  // before checking employee fallback auth
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => { setHydrated(true) }, [])

  // Authentication state
  const [authState, setAuthState] = useState<AuthState>('checking')
  const [screenConfig, setScreenConfig] = useState<ScreenConfig | null>(null)
  const [deviceToken, setDeviceToken] = useState<string | null>(null)

  // KDS state
  const [orders, setOrders] = useState<KDSOrder[]>([])
  const [station, setStation] = useState<PrepStation | null>(null)
  const [stations, setStations] = useState<PrepStation[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [clockTime, setClockTime] = useState('')

  // Hydration-safe clock — only runs on client
  useEffect(() => {
    const tick = () => setClockTime(new Date().toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])
  const [showCompleted, setShowCompleted] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [socketConnected, setSocketConnected] = useState(false)
  const [expoMode, setExpoMode] = useState(false)
  const [showKdsClockModal, setShowKdsClockModal] = useState(false)
  const [flashActive, setFlashActive] = useState(false)
  const socketRef = useRef<Socket | null>(null)

  // Voided/comped items: show "VOIDED" or "COMPED" overlay for 5s before removing
  const [voidingItems, setVoidingItems] = useState<Map<string, 'voided' | 'comped'>>(new Map())

  // Phase 10: Bump bar / keyboard navigation
  const [selectedOrderIndex, setSelectedOrderIndex] = useState(0)

  // Authenticate device on mount (after hydration so employee fallback works)
  useEffect(() => {
    if (hydrated) authenticateDevice()
  }, [screenParam, hydrated])

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
        const result = data.data || data

        if (response.ok && result.authenticated) {
          // Successfully authenticated
          setScreenConfig(result.screen)
          setDeviceToken(storedToken)
          localStorage.setItem(SCREEN_CONFIG_KEY, JSON.stringify(result.screen))
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
          const result = data.data || data
          setScreenConfig(result.screen)
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

  // Redirect entertainment screens to the dedicated entertainment KDS page
  useEffect(() => {
    if (authState === 'authenticated' && screenConfig?.screenType === 'entertainment') {
      router.replace('/entertainment')
    }
  }, [authState, screenConfig, router])

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
      loadOrders() // Refresh data on (re)connect — may have missed events while disconnected

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
        terminalId: `kds-${screenConfig?.id || 'fallback-' + Math.random().toString(36).slice(2, 8)}`,
        stationId: stationIds?.[0],
      })
    }

    const loadOrdersDebounceRef = { current: null as NodeJS.Timeout | null }
    const debouncedLoadOrders = () => {
      if (loadOrdersDebounceRef.current) clearTimeout(loadOrdersDebounceRef.current)
      loadOrdersDebounceRef.current = setTimeout(() => {
        loadOrders()
      }, 50)
    }

    const onOrderReceived = () => {
      if (screenConfig?.playSound) playNotificationSound()
      if (screenConfig?.flashOnNew) {
        setFlashActive(true)
        setTimeout(() => setFlashActive(false), 500)
      }
      debouncedLoadOrders()
    }
    const onItemStatus = (payload: { orderId?: string; itemId?: string; status?: string }) => {
      // Show "VOIDED" / "COMPED" overlay for 5 seconds before refreshing
      if (payload?.itemId && (payload.status === 'voided' || payload.status === 'comped')) {
        const status = payload.status as 'voided' | 'comped'
        setVoidingItems(prev => {
          const next = new Map(prev)
          next.set(payload.itemId!, status)
          return next
        })
        // After 5 seconds, clear the overlay and refresh
        setTimeout(() => {
          setVoidingItems(prev => {
            const next = new Map(prev)
            next.delete(payload.itemId!)
            return next
          })
          debouncedLoadOrders()
        }, 5000)
        return
      }
      debouncedLoadOrders()
    }
    const onOrderBumped = () => debouncedLoadOrders()
    const onOrderCreated = () => debouncedLoadOrders()
    const onOrderClosed = () => debouncedLoadOrders()
    const onListChanged = () => debouncedLoadOrders()
    const onOrderUpdated = () => debouncedLoadOrders()
    const onDisconnect = () => setSocketConnected(false)

    // Entertainment timer expiry: when a timed rental expires, the cron emits
    // entertainment:session-update with action='stopped'. Refresh KDS data so
    // entertainment-type stations reflect the updated item status.
    const onEntertainmentSessionUpdate = (payload: { action: string; tableName?: string }) => {
      if (payload.action === 'stopped' || payload.action === 'warning') {
        debouncedLoadOrders()
      }
    }

    // KDS Overhaul: Screen communication listeners
    const seenEventIds = new Set<string>()

    const onOrderForwarded = (payload: { eventId: string; targetScreenId: string }) => {
      // Dedupe by eventId
      if (seenEventIds.has(payload.eventId)) return
      seenEventIds.add(payload.eventId)
      setTimeout(() => seenEventIds.delete(payload.eventId), 60000)

      // Only react if this screen is the target
      if (screenConfig?.id && payload.targetScreenId === screenConfig.id) {
        if (screenConfig.playSound) playNotificationSound()
        if (screenConfig.flashOnNew) {
          setFlashActive(true)
          setTimeout(() => setFlashActive(false), 500)
        }
        debouncedLoadOrders()
      }
    }

    const onMultiClear = (payload: { eventId: string; targetScreenId: string }) => {
      if (seenEventIds.has(payload.eventId)) return
      seenEventIds.add(payload.eventId)
      setTimeout(() => seenEventIds.delete(payload.eventId), 60000)

      if (screenConfig?.id && payload.targetScreenId === screenConfig.id) {
        debouncedLoadOrders()
      }
    }

    socket.on('connect', onConnect)
    socket.on('kds:order-received', onOrderReceived)
    socket.on('kds:item-status', onItemStatus)
    socket.on('kds:order-bumped', onOrderBumped)
    socket.on('order:created', onOrderCreated)
    socket.on('order:closed', onOrderClosed)
    socket.on('orders:list-changed', onListChanged)
    socket.on('order:updated', onOrderUpdated)
    socket.on('entertainment:session-update', onEntertainmentSessionUpdate)
    socket.on('kds:order-forwarded', onOrderForwarded)
    socket.on('kds:multi-clear', onMultiClear)
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
      socket.off('order:closed', onOrderClosed)
      socket.off('orders:list-changed', onListChanged)
      socket.off('order:updated', onOrderUpdated)
      socket.off('entertainment:session-update', onEntertainmentSessionUpdate)
      socket.off('kds:order-forwarded', onOrderForwarded)
      socket.off('kds:multi-clear', onMultiClear)
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
  }, [authState, screenConfig, stationParam, showCompleted, expoMode])

  // Fallback polling ONLY when socket is disconnected (20s)
  useEffect(() => {
    if (authState !== 'authenticated' && authState !== 'employee_fallback') return
    if (socketConnected) return
    const fallback = setInterval(loadOrders, 20000)
    return () => clearInterval(fallback)
  }, [authState, socketConnected])

  // Client-side order age recomputation every 30s
  // Phase 2: Uses per-order-type transition times with fallback to global thresholds
  useEffect(() => {
    if (orders.length === 0) return

    const tick = () => {
      setOrders(prev => prev.map(order => {
        const { elapsed, status } = computeTimeStatus(order.createdAt, order.orderType, screenConfig)
        if (elapsed === order.elapsedMinutes && status === order.timeStatus) return order
        return { ...order, elapsedMinutes: elapsed, timeStatus: status }
      }))
    }

    const interval = setInterval(tick, 30_000)
    return () => clearInterval(interval)
  }, [orders.length, screenConfig])

  // Instant refresh on tab switch
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === 'visible') loadOrders()
    }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [])

  // Reset selection when orders change
  useEffect(() => {
    setSelectedOrderIndex(prev => Math.min(prev, Math.max(orders.length - 1, 0)))
  }, [orders.length])

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
      const headers: Record<string, string> = {}
      if (deviceToken) {
        headers['x-device-token'] = deviceToken
      }

      let allOrders: KDSOrder[] = []

      if (expoMode) {
        // Expo mode: fetch from /api/kds/expo — returns all items across all stations
        let cursor: string | null = null
        do {
          const params = new URLSearchParams({ locationId })
          if (cursor) params.set('cursor', cursor)
          const pageRes = await fetch(`/api/kds/expo?${params}`, { headers })

          if (pageRes.status === 401) {
            setAuthState('requires_pairing')
            return
          }
          if (!pageRes.ok) break

          const pageData = await pageRes.json()
          const expoOrders = (pageData.data?.orders ?? []) as Array<{
            id: string
            orderNumber: number
            orderType: string
            table?: { name?: string } | null
            tabName?: string | null
            employeeName: string
            createdAt: string
            elapsedMinutes: number
            timeStatus: 'fresh' | 'aging' | 'late'
            items: Array<{
              id: string
              name: string
              quantity: number
              seatNumber?: number | null
              kitchenStatus?: string | null
              isCompleted: boolean
              completedAt?: string | null
              specialNotes?: string | null
              categoryName?: string | null
              prepStationName?: string | null
              modifiers: Array<{ id: string; name: string; depth?: number }>
            }>
          }>

          // Normalize expo response to KDSOrder shape
          const normalized: KDSOrder[] = expoOrders.map(eo => ({
            id: eo.id,
            orderNumber: eo.orderNumber,
            orderType: eo.orderType,
            tableName: eo.table?.name || null,
            tabName: eo.tabName || null,
            employeeName: eo.employeeName,
            createdAt: eo.createdAt,
            elapsedMinutes: eo.elapsedMinutes,
            timeStatus: eo.timeStatus,
            notes: null,
            items: eo.items.map(ei => ({
              id: ei.id,
              name: ei.name,
              quantity: ei.quantity,
              categoryName: ei.categoryName || null,
              pricingOptionLabel: ei.prepStationName || null, // Show station name in expo
              specialNotes: ei.specialNotes || null,
              isCompleted: ei.isCompleted,
              completedAt: ei.completedAt || null,
              completedBy: null,
              resendCount: 0,
              lastResentAt: null,
              resendNote: null,
              seatNumber: ei.seatNumber ?? null,
              courseNumber: null,
              courseStatus: 'pending',
              isHeld: false,
              firedAt: null,
              modifiers: ei.modifiers || [],
              ingredientModifications: [],
            })),
          }))

          allOrders = allOrders.concat(normalized)
          cursor = pageData.data?.nextCursor ?? null
        } while (cursor)
      } else {
        // Station mode: fetch from /api/kds with station filtering
        const params = new URLSearchParams({ locationId })

        // KDS Overhaul: pass screenId for forwarding-aware item queries
        if (screenConfig?.id) {
          params.append('screenId', screenConfig.id)
        }

        const stationIds = getStationIds()
        if (stationIds && stationIds.length > 0) {
          stationIds.forEach(id => params.append('stationId', id))
        } else {
          params.append('showAll', 'true')
        }

        let cursor: string | null = null
        do {
          const pageParams = new URLSearchParams(params)
          if (cursor) pageParams.set('cursor', cursor)
          const pageRes = await fetch(`/api/kds?${pageParams}`, { headers })

          if (pageRes.status === 401) {
            setAuthState('requires_pairing')
            return
          }
          if (!pageRes.ok) break

          const pageData = await pageRes.json()
          allOrders = allOrders.concat(pageData.data?.orders ?? [])
          cursor = pageData.data?.nextCursor ?? null
          if (!station) setStation(pageData.data?.station)
        } while (cursor)
      }

      let filteredOrders = allOrders
      if (!showCompleted) {
        filteredOrders = filteredOrders.filter((order: KDSOrder) =>
          order.items.some(item => !item.isCompleted)
        )
      }

      // Phase 3: Apply order type filters
      const typeFilters = screenConfig?.orderTypeFilters
      if (typeFilters) {
        filteredOrders = filteredOrders.filter((order: KDSOrder) => {
          // If the order type is explicitly set to false, hide it
          if (typeFilters[order.orderType] === false) return false
          return true
        })
      }

      // Phase 2: Recompute using per-order-type transition times
      filteredOrders = filteredOrders.map(order => {
        const { elapsed, status } = computeTimeStatus(order.createdAt, order.orderType, screenConfig)
        return { ...order, elapsedMinutes: elapsed, timeStatus: status }
      })

      setOrders(filteredOrders)
      setLastUpdate(new Date())
    } catch (error) {
      console.error('Failed to load KDS orders:', error)
    } finally {
      setIsLoading(false)
    }
  }, [screenConfig, stationParam, showCompleted, deviceToken, expoMode])

  const handleBumpItem = useCallback(async (itemId: string) => {
    if (!socketConnected) return
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (deviceToken) headers['x-device-token'] = deviceToken

      const endpoint = expoMode ? '/api/kds/expo' : '/api/kds'
      const body = expoMode
        ? { itemIds: [itemId], action: 'serve' }
        : { itemIds: [itemId], action: 'complete', screenId: screenConfig?.id }

      await fetch(endpoint, {
        method: 'PUT',
        headers,
        body: JSON.stringify(body),
      })
      loadOrders()
    } catch (error) {
      console.error('Failed to bump item:', error)
    }
  }, [deviceToken, loadOrders, socketConnected, expoMode])

  const handleBumpOrder = useCallback(async (order: KDSOrder) => {
    if (!socketConnected) return
    const incompleteItemIds = order.items
      .filter(item => !item.isCompleted)
      .map(item => item.id)

    if (incompleteItemIds.length === 0) return

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (deviceToken) headers['x-device-token'] = deviceToken

      const endpoint = expoMode ? '/api/kds/expo' : '/api/kds'

      await fetch(endpoint, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          itemIds: incompleteItemIds,
          action: 'bump_order',
          orderId: order.id,
          screenId: screenConfig?.id,
        }),
      })
      loadOrders()
    } catch (error) {
      console.error('Failed to bump order:', error)
    }
  }, [deviceToken, loadOrders, socketConnected, expoMode])

  const handleUncompleteItem = useCallback(async (itemId: string) => {
    if (!socketConnected) return
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (deviceToken) headers['x-device-token'] = deviceToken

      if (expoMode) {
        // Expo: update status back to pending
        await fetch('/api/kds/expo', {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            itemIds: [itemId],
            action: 'update_status',
            status: 'pending',
          }),
        })
      } else {
        await fetch('/api/kds', {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            itemIds: [itemId],
            action: 'uncomplete',
            screenId: screenConfig?.id,
          }),
        })
      }
      loadOrders()
    } catch (error) {
      console.error('Failed to uncomplete item:', error)
    }
  }, [deviceToken, loadOrders, socketConnected, expoMode])

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen()
      setIsFullscreen(true)
    } else {
      document.exitFullscreen()
      setIsFullscreen(false)
    }
  }

  // Phase 10: Bump bar / keyboard shortcuts
  // Arrow keys navigate between orders, Enter/Space bumps selected order
  useEffect(() => {
    if (authState !== 'authenticated' && authState !== 'employee_fallback') return

    const handler = (e: KeyboardEvent) => {
      // Don't capture when typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      const orderCount = orders.length
      if (orderCount === 0) return

      switch (e.key) {
        case 'ArrowRight':
          e.preventDefault()
          setSelectedOrderIndex(prev => Math.min(prev + 1, orderCount - 1))
          break
        case 'ArrowLeft':
          e.preventDefault()
          setSelectedOrderIndex(prev => Math.max(prev - 1, 0))
          break
        case 'ArrowDown': {
          // Move down by columns count
          e.preventDefault()
          const cols = screenConfig?.columns ?? 4
          setSelectedOrderIndex(prev => Math.min(prev + cols, orderCount - 1))
          break
        }
        case 'ArrowUp': {
          e.preventDefault()
          const cols = screenConfig?.columns ?? 4
          setSelectedOrderIndex(prev => Math.max(prev - cols, 0))
          break
        }
        case 'Enter':
        case ' ':
          // Bump the selected order
          e.preventDefault()
          if (socketConnected && orders[selectedOrderIndex]) {
            handleBumpOrder(orders[selectedOrderIndex])
          }
          break
        case 'Home':
          e.preventDefault()
          setSelectedOrderIndex(0)
          break
        case 'End':
          e.preventDefault()
          setSelectedOrderIndex(Math.max(orderCount - 1, 0))
          break
        case 'r':
        case 'R':
          // Refresh
          e.preventDefault()
          loadOrders()
          break
        case 'f':
        case 'F':
          // Toggle fullscreen
          e.preventDefault()
          toggleFullscreen()
          break
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [authState, orders, selectedOrderIndex, socketConnected, screenConfig?.columns, handleBumpOrder, loadOrders])

  // Phase 3: Display mode and grid class computation
  const displayMode = screenConfig?.displayMode || 'tiled'
  const cols = screenConfig?.columns ?? 4
  // Classic mode: fewer, larger cards (max 3 columns, extra padding)
  const effectiveCols = displayMode === 'classic' ? Math.min(cols, 3) : cols
  const gridClassName = displayMode === 'classic'
    ? `grid gap-6 ${
        effectiveCols === 2 ? 'grid-cols-1 md:grid-cols-2' :
        'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
      }`
    : `grid gap-4 ${
        cols <= 2 ? 'grid-cols-1 md:grid-cols-2' :
        cols === 3 ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3' :
        cols === 4 ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4' :
        cols === 5 ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5' :
        'grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 3xl:grid-cols-6'
      }`

  // Phase 6: Sort orders based on behavior config
  const sortedOrders = (() => {
    let result = [...orders]
    const behavior = screenConfig?.orderBehavior

    // Move completed orders to bottom if configured
    if (behavior?.moveCompletedToBottom) {
      const active = result.filter(o => o.items.some(i => !i.isCompleted))
      const completed = result.filter(o => o.items.every(i => i.isCompleted))
      result = [...active, ...completed]
    }

    // Intelligent sort: prioritize late > aging > fresh
    if (behavior?.intelligentSort) {
      const statusPriority: Record<string, number> = { late: 0, aging: 1, fresh: 2 }
      result.sort((a, b) => {
        const pa = statusPriority[a.timeStatus] ?? 2
        const pb = statusPriority[b.timeStatus] ?? 2
        if (pa !== pb) return pa - pb
        // Within same priority, older first
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      })
    }

    return result
  })()

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

  const locationName = employee?.location?.name || screenConfig?.locationId || ''

  return (
    <div className={`min-h-screen bg-gray-900 text-white relative ${flashActive ? 'kds-flash' : ''}`}>
      {/* Flash-on-new-order keyframe */}
      {flashActive && (
        <style>{`
          @keyframes kdsFlash {
            0% { background-color: rgba(59, 130, 246, 0.3); }
            100% { background-color: transparent; }
          }
          .kds-flash { animation: kdsFlash 0.5s ease-out; }
        `}</style>
      )}
      {/* Disconnect overlay */}
      {!socketConnected && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center">
          <div className="text-center">
            <div className="w-20 h-20 bg-red-900/50 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-10 h-10 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636a9 9 0 010 12.728M15.536 8.464a5 5 0 010 7.072M6.343 17.657a9 9 0 010-12.728M9.172 14.828a5 5 0 010-7.072M12 12h.01" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-white mb-2">KDS Disconnected</h2>
            <p className="text-gray-400 mb-1">Connection to the server was lost.</p>
            <p className="text-gray-500 text-sm">Order bumping is disabled. Reconnecting…</p>
          </div>
        </div>
      )}

      {/* Header */}
      <KDSHeader
        authState={authState}
        screenConfig={screenConfig}
        station={station}
        orders={orders}
        lastUpdate={lastUpdate}
        socketConnected={socketConnected}
        expoMode={expoMode}
        setExpoMode={setExpoMode}
        showCompleted={showCompleted}
        setShowCompleted={setShowCompleted}
        stationParam={stationParam}
        stations={stations}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
        onShowClock={() => setShowKdsClockModal(true)}
        onRefresh={loadOrders}
        onNavigateBack={() => router.push('/orders')}
        onStationChange={(newStation) => {
          if (newStation) {
            router.push(`/kds?station=${newStation}`)
          } else {
            router.push('/kds')
          }
        }}
        setIsLoading={setIsLoading}
      />

      {/* KDS Clock In/Out Modal */}
      <KDSClockModal
        isOpen={showKdsClockModal}
        onClose={() => setShowKdsClockModal(false)}
        locationId={getLocationId()}
      />

      {/* Delivery Expo Rail — feature-gated, only renders when deliveryKdsProvisioned */}
      <SilentErrorBoundary name="DeliveryExpoRail">
        <DeliveryExpoRail locationId={getLocationId()} />
      </SilentErrorBoundary>

      {/* Phase 4: All Day Counts panel */}
      <KDSAllDayCounts
        locationId={getLocationId()}
        resetHour={screenConfig?.orderBehavior?.allDayCountResetHour}
        enabled={screenConfig?.orderBehavior?.showAllDayCounts}
      />

      {/* Orders Grid — Phase 3: Display mode aware */}
      <div className="p-4">
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-gray-400 text-xl">Loading orders...</div>
          </div>
        ) : sortedOrders.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64">
            <div className="w-24 h-24 bg-gray-800 rounded-full flex items-center justify-center mb-4">
              <svg className="w-12 h-12 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-gray-400 text-xl">All caught up!</p>
            <p className="text-gray-500 text-sm mt-1">No pending orders</p>
          </div>
        ) : displayMode === 'split' ? (
          /* Split mode: grouped by order type */
          <div className="space-y-6">
            {Object.entries(
              sortedOrders.reduce<Record<string, KDSOrder[]>>((acc, order) => {
                const key = order.orderType
                if (!acc[key]) acc[key] = []
                acc[key].push(order)
                return acc
              }, {})
            ).map(([orderType, groupOrders]) => (
              <div key={orderType}>
                <h2 className="text-lg font-bold text-gray-300 mb-3 uppercase tracking-wide">
                  {ORDER_TYPE_LABELS[orderType] || orderType} ({groupOrders.length})
                </h2>
                <div className={gridClassName}>
                  {groupOrders.map(order => {
                    const globalIdx = sortedOrders.indexOf(order)
                    return (
                    <SilentErrorBoundary key={order.id} name="KDS Ticket">
                      <KDSOrderCard
                        order={order}
                        onBumpItem={handleBumpItem}
                        onUncompleteItem={handleUncompleteItem}
                        onBumpOrder={handleBumpOrder}
                        socketConnected={socketConnected}
                        strikeThroughModifiers={screenConfig?.orderBehavior?.strikeThroughModifiers}
                        isSelected={globalIdx === selectedOrderIndex}
                        voidingItems={voidingItems}
                      />
                    </SilentErrorBoundary>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : displayMode === 'takeout' ? (
          /* Takeout mode: single-column condensed list */
          <div className="max-w-2xl mx-auto space-y-3">
            {sortedOrders.map((order, idx) => (
              <SilentErrorBoundary key={order.id} name="KDS Ticket">
                <KDSOrderCard
                  order={order}
                  onBumpItem={handleBumpItem}
                  onUncompleteItem={handleUncompleteItem}
                  onBumpOrder={handleBumpOrder}
                  socketConnected={socketConnected}
                  strikeThroughModifiers={screenConfig?.orderBehavior?.strikeThroughModifiers}
                  isSelected={idx === selectedOrderIndex}
                  voidingItems={voidingItems}
                />
              </SilentErrorBoundary>
            ))}
          </div>
        ) : (
          /* Tiled (default) and Classic modes */
          <div className={gridClassName}>
            {sortedOrders.map((order, idx) => (
                <SilentErrorBoundary key={order.id} name="KDS Ticket">
                  <KDSOrderCard
                    order={order}
                    onBumpItem={handleBumpItem}
                    onUncompleteItem={handleUncompleteItem}
                    onBumpOrder={handleBumpOrder}
                    socketConnected={socketConnected}
                    strikeThroughModifiers={screenConfig?.orderBehavior?.strikeThroughModifiers}
                    isSelected={idx === selectedOrderIndex}
                    voidingItems={voidingItems}
                  />
                </SilentErrorBoundary>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="fixed bottom-0 left-0 right-0 bg-gray-800 border-t border-gray-700 px-4 py-2 flex justify-between items-center text-sm">
        <span className="text-gray-400">
          {locationName}
        </span>
        <span className="font-mono text-2xl" suppressHydrationWarning>
          {clockTime}
        </span>
        <span className="text-gray-400 flex items-center gap-2">
          {screenConfig && <span className="w-2 h-2 rounded-full bg-green-500" />}
          KDS v1.0
        </span>
      </div>

      {/* Toast notifications for clock in/out feedback */}
      <ToastContainer />
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
