'use client'

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import dynamic from 'next/dynamic'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import { DriverCheckoutModal } from '@/components/delivery/DriverCheckoutModal'
import { useDeliveryFeature } from '@/hooks/useDeliveryFeature'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { toast } from '@/stores/toast-store'
import { getSharedSocket } from '@/lib/shared-socket'
import type { MapOrder, MapDriver, MapZone } from '@/components/delivery/DeliveryMap'

// Dynamic import for Leaflet map (no SSR)
const DeliveryMap = dynamic(() => import('@/components/delivery/DeliveryMap'), { ssr: false })

// ─── Types ──────────────────────────────────────────────────────────────────

type DeliveryStatus = 'pending' | 'preparing' | 'ready_for_pickup' | 'out_for_delivery' | 'delivered' | 'cancelled'
type ExceptionSeverity = 'critical' | 'high' | 'medium' | 'low'

interface DispatchOrder {
  id: string
  customerName: string
  address: string
  phone: string | null
  status: DeliveryStatus
  orderNumber: number | null
  lat: number | null
  lng: number | null
  deliveryFee: number
  estimatedMinutes: number
  scheduledFor: string | null
  driverId: string | null
  driverName: string | null
  createdAt: string
  readyAt: string | null
  dispatchedAt: string | null
  notes: string | null
  isLate: boolean
  lateByMinutes: number
  zoneName: string | null
}

interface DispatchDriver {
  id: string
  name: string
  initials: string
  phone: string | null
  status: 'available' | 'on_delivery' | 'returning' | 'offline'
  lat: number | null
  lng: number | null
  activeOrders: number
  currentRunId: string | null
  vehicleInfo: string | null
  onTimePct: number | null
  deliveriesPerHour: number | null
}

interface DispatchRun {
  id: string
  driverId: string
  driverName: string
  status: 'building' | 'dispatched' | 'in_progress' | 'completed'
  orders: { id: string; customerName: string; address: string; status: string }[]
  dispatchedAt: string | null
  estimatedCompletionAt: string | null
}

interface DispatchException {
  id: string
  type: string
  severity: ExceptionSeverity
  message: string
  orderId: string | null
  driverId: string | null
  orderNumber: number | null
  driverName: string | null
  createdAt: string
  resolvedAt: string | null
}

interface DispatchZone {
  id: string
  name: string
  color: string
  type: 'radius' | 'polygon' | 'zipcode'
  centerLat: number | null
  centerLng: number | null
  radiusMiles: number | null
  polygon: [number, number][] | null
}

interface DispatchData {
  orders: DispatchOrder[]
  drivers: DispatchDriver[]
  runs: DispatchRun[]
  exceptions: DispatchException[]
  zones: DispatchZone[]
  locationCenter: { lat: number; lng: number } | null
}

// ─── Status Config ──────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, { dot: string; text: string; bg: string }> = {
  pending:            { dot: 'bg-gray-400', text: 'text-gray-600', bg: 'bg-gray-50 border-gray-200' },
  preparing:          { dot: 'bg-yellow-400', text: 'text-yellow-700', bg: 'bg-yellow-50 border-yellow-200' },
  ready_for_pickup:   { dot: 'bg-green-400', text: 'text-green-700', bg: 'bg-green-50 border-green-200' },
  out_for_delivery:   { dot: 'bg-blue-400', text: 'text-blue-700', bg: 'bg-blue-50 border-blue-200' },
  delivered:          { dot: 'bg-green-600', text: 'text-green-800', bg: 'bg-green-50 border-green-300' },
  cancelled:          { dot: 'bg-red-400', text: 'text-red-600', bg: 'bg-red-50 border-red-200' },
}

const SEVERITY_COLORS: Record<ExceptionSeverity, { badge: string; border: string }> = {
  critical: { badge: 'bg-red-600 text-white', border: 'border-red-300 bg-red-50' },
  high:     { badge: 'bg-orange-500 text-white', border: 'border-orange-300 bg-orange-50' },
  medium:   { badge: 'bg-yellow-500 text-white', border: 'border-yellow-300 bg-yellow-50' },
  low:      { badge: 'bg-gray-400 text-white', border: 'border-gray-200 bg-gray-50' },
}

// ─── Tab type ───────────────────────────────────────────────────────────────

type RightPanelTab = 'ready' | 'active' | 'drivers' | 'exceptions'

// ─── Component ──────────────────────────────────────────────────────────────

export default function DispatchPage() {
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/dispatch' })
  const employee = useAuthStore(s => s.employee)
  const dispatchEnabled = useDeliveryFeature('dispatchBoardProvisioned')

  const [isLoading, setIsLoading] = useState(true)
  const [data, setData] = useState<DispatchData>({
    orders: [],
    drivers: [],
    runs: [],
    exceptions: [],
    zones: [],
    locationCenter: null,
  })

  const [activeTab, setActiveTab] = useState<RightPanelTab>('ready')

  // Run builder state
  const [buildingRun, setBuildingRun] = useState(false)
  const [selectedOrderIds, setSelectedOrderIds] = useState<Set<string>>(new Set())
  const [assignDriverModal, setAssignDriverModal] = useState(false)
  const [selectedDriverId, setSelectedDriverId] = useState('')

  // Exception resolve
  const [resolvingExceptionId, setResolvingExceptionId] = useState<string | null>(null)

  // Driver checkout modal
  const [checkoutSessionId, setCheckoutSessionId] = useState<string | null>(null)
  const [checkoutDriverName, setCheckoutDriverName] = useState('')

  // GPS throttle ref (1 update per 5s per driver)
  const lastGpsUpdate = useRef<Map<string, number>>(new Map())

  // ─── Data fetching ──────────────────────────────────────────────────────

  const loadDispatchData = useCallback(async () => {
    try {
      const res = await fetch('/api/delivery/dispatch')
      if (!res.ok) return
      const json = await res.json()
      setData(json.data ?? json)
    } catch (error) {
      console.error('[Dispatch] Failed to load data:', error)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (employee?.location?.id && dispatchEnabled) {
      loadDispatchData()
    } else {
      setIsLoading(false)
    }
  }, [employee?.location?.id, dispatchEnabled, loadDispatchData])

  // ─── Socket real-time updates ─────────────────────────────────────────

  useEffect(() => {
    if (!dispatchEnabled) return
    const socket = getSharedSocket()

    const handleStatusChanged = () => {
      void loadDispatchData()
    }

    const handleDriverLocation = (payload: { driverId: string; lat: number; lng: number }) => {
      const now = Date.now()
      const last = lastGpsUpdate.current.get(payload.driverId) ?? 0
      if (now - last < 5000) return // Throttle: 1 update per 5s per driver
      lastGpsUpdate.current.set(payload.driverId, now)

      setData(prev => ({
        ...prev,
        drivers: prev.drivers.map(d =>
          d.id === payload.driverId
            ? { ...d, lat: payload.lat, lng: payload.lng }
            : d
        ),
      }))
    }

    const handleException = () => {
      void loadDispatchData()
      // Optional sound alert
      try {
        const audio = new Audio('/sounds/alert.mp3')
        void audio.play().catch(err => console.warn('audio playback failed:', err))
      } catch {}
    }

    socket.on('delivery:status_changed', handleStatusChanged)
    socket.on('delivery:run_created', handleStatusChanged)
    socket.on('delivery:run_completed', handleStatusChanged)
    socket.on('driver:status_changed', handleStatusChanged)
    socket.on('driver:location_update', handleDriverLocation)
    socket.on('delivery:exception_created', handleException)
    socket.on('delivery:exception_resolved', handleStatusChanged)

    return () => {
      socket.off('delivery:status_changed', handleStatusChanged)
      socket.off('delivery:run_created', handleStatusChanged)
      socket.off('delivery:run_completed', handleStatusChanged)
      socket.off('driver:status_changed', handleStatusChanged)
      socket.off('driver:location_update', handleDriverLocation)
      socket.off('delivery:exception_created', handleException)
      socket.off('delivery:exception_resolved', handleStatusChanged)
    }
  }, [dispatchEnabled, loadDispatchData])

  // ─── Auto-refresh fallback (30s) ─────────────────────────────────────

  useEffect(() => {
    if (!dispatchEnabled) return
    const interval = setInterval(loadDispatchData, 30000)
    return () => clearInterval(interval)
  }, [dispatchEnabled, loadDispatchData])

  // ─── Derived data ────────────────────────────────────────────────────

  const readyOrders = useMemo(
    () => data.orders.filter(o => o.status === 'ready_for_pickup'),
    [data.orders]
  )
  const activeOrders = useMemo(
    () => data.orders.filter(o => o.status === 'out_for_delivery'),
    [data.orders]
  )
  const lateOrders = useMemo(
    () => data.orders.filter(o => o.isLate),
    [data.orders]
  )
  const openExceptions = useMemo(
    () => data.exceptions
      .filter(e => !e.resolvedAt)
      .sort((a, b) => {
        const order: Record<ExceptionSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 }
        return (order[a.severity] ?? 4) - (order[b.severity] ?? 4)
      }),
    [data.exceptions]
  )
  const availableDrivers = useMemo(
    () => data.drivers.filter(d => d.status === 'available' || d.status === 'on_delivery'),
    [data.drivers]
  )

  // ─── Map data ────────────────────────────────────────────────────────

  const mapOrders: MapOrder[] = useMemo(
    () => data.orders
      .filter(o => o.lat != null && o.lng != null && o.status !== 'delivered' && o.status !== 'cancelled')
      .map(o => ({
        id: o.id,
        lat: o.lat!,
        lng: o.lng!,
        customerName: o.customerName,
        address: o.address,
        status: o.isLate ? 'late' as const : o.status as MapOrder['status'],
        orderNumber: o.orderNumber ?? undefined,
        driverName: o.driverName,
        estimatedMinutes: o.estimatedMinutes,
      })),
    [data.orders]
  )

  const mapDrivers: MapDriver[] = useMemo(
    () => data.drivers
      .filter(d => d.lat != null && d.lng != null && d.status !== 'offline')
      .map(d => ({
        id: d.id,
        lat: d.lat!,
        lng: d.lng!,
        name: d.name,
        initials: d.initials,
        status: d.status as MapDriver['status'],
        activeOrders: d.activeOrders,
      })),
    [data.drivers]
  )

  const mapZones: MapZone[] = useMemo(
    () => data.zones.map(z => ({
      id: z.id,
      name: z.name,
      color: z.color,
      type: z.type,
      centerLat: z.centerLat ?? undefined,
      centerLng: z.centerLng ?? undefined,
      radiusMiles: z.radiusMiles ?? undefined,
      polygon: z.polygon ?? undefined,
    })),
    [data.zones]
  )

  const mapCenter: [number, number] = useMemo(
    () => data.locationCenter
      ? [data.locationCenter.lat, data.locationCenter.lng]
      : [40.7128, -74.006], // NYC default
    [data.locationCenter]
  )

  // ─── Actions ─────────────────────────────────────────────────────────

  async function handleAssignSingle(orderId: string, driverId: string) {
    try {
      const res = await fetch('/api/delivery/dispatch/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderIds: [orderId], driverId }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error || 'Failed to assign')
        return
      }
      toast.success('Driver assigned')
      void loadDispatchData()
    } catch {
      toast.error('Failed to assign driver')
    }
  }

  async function handleCreateRun() {
    if (selectedOrderIds.size === 0 || !selectedDriverId) return
    try {
      const res = await fetch('/api/delivery/dispatch/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderIds: Array.from(selectedOrderIds),
          driverId: selectedDriverId,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error || 'Failed to create run')
        return
      }
      toast.success(`Run created with ${selectedOrderIds.size} order${selectedOrderIds.size !== 1 ? 's' : ''}`)
      setBuildingRun(false)
      setSelectedOrderIds(new Set())
      setSelectedDriverId('')
      setAssignDriverModal(false)
      void loadDispatchData()
    } catch {
      toast.error('Failed to create run')
    }
  }

  async function handleResolveException(exceptionId: string) {
    setResolvingExceptionId(exceptionId)
    try {
      const res = await fetch(`/api/delivery/dispatch/exceptions/${exceptionId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolvedBy: employee?.id }),
      })
      const json = await res.json()
      if (!res.ok) {
        toast.error(json.error || 'Failed to resolve exception')
        return
      }
      toast.success('Exception resolved')
      void loadDispatchData()
    } catch {
      toast.error('Failed to resolve exception')
    } finally {
      setResolvingExceptionId(null)
    }
  }

  function toggleOrderSelection(orderId: string) {
    setSelectedOrderIds(prev => {
      const next = new Set(prev)
      if (next.has(orderId)) {
        next.delete(orderId)
      } else {
        next.add(orderId)
      }
      return next
    })
  }

  function suggestDriver(orderId: string): DispatchDriver | null {
    // Simple heuristic: pick available driver with fewest active orders
    const order = data.orders.find(o => o.id === orderId)
    if (!order) return null
    const eligible = data.drivers
      .filter(d => d.status === 'available' || (d.status === 'on_delivery' && d.activeOrders < 3))
      .sort((a, b) => a.activeOrders - b.activeOrders)
    return eligible[0] || null
  }

  // ─── Render guards ───────────────────────────────────────────────────

  if (!hydrated) return null

  if (!dispatchEnabled) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-md">
          <div className="text-4xl mb-4">🚚</div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">Dispatch Board Not Enabled</h2>
          <p className="text-gray-600 text-sm">
            The dispatch board requires provisioning from Mission Control.
            Contact your administrator to enable delivery dispatch for this venue.
          </p>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent mx-auto mb-3"></div>
          <p className="text-gray-600">Loading dispatch board...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* ─── Toolbar ──────────────────────────────────────────────────── */}
      <div className="flex-shrink-0 bg-white border-b border-gray-200 px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold text-gray-900">Dispatch</h1>
            <div className="flex items-center gap-3 ml-4">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                Active: {activeOrders.length}
              </span>
              {lateOrders.length > 0 && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-red-50 text-red-700 border border-red-200 animate-pulse">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
                  Late: {lateOrders.length}!
                </span>
              )}
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-green-50 text-green-700 border border-green-200">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
                Drivers: {data.drivers.filter(d => d.status !== 'offline').length}
              </span>
              {openExceptions.length > 0 && (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-orange-50 text-orange-700 border border-orange-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-orange-500"></span>
                  Exceptions: {openExceptions.length}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {buildingRun ? (
              <>
                <span className="text-sm text-gray-600">
                  {selectedOrderIds.size} selected
                </span>
                <Button
                  size="sm"
                  onClick={() => {
                    if (selectedOrderIds.size === 0) {
                      toast.error('Select at least one order')
                      return
                    }
                    setAssignDriverModal(true)
                  }}
                  disabled={selectedOrderIds.size === 0}
                  className="bg-green-600 hover:bg-green-700"
                >
                  Assign Driver
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setBuildingRun(false)
                    setSelectedOrderIds(new Set())
                  }}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                onClick={() => setBuildingRun(true)}
                disabled={readyOrders.length === 0}
                className="bg-blue-600 hover:bg-blue-700"
              >
                Create Run
              </Button>
            )}
            <button
              onClick={loadDispatchData}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              title="Refresh"
            >
              <svg className="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* ─── Main Content (Map + Panel) ───────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">
        {/* Map */}
        <div className="flex-1 relative">
          <DeliveryMap
            center={mapCenter}
            zoom={13}
            orders={mapOrders}
            drivers={mapDrivers}
            zones={mapZones}
          />
        </div>

        {/* Right Panel */}
        <div className="w-[420px] flex-shrink-0 bg-white border-l border-gray-200 flex flex-col overflow-hidden">
          {/* Tab Bar */}
          <div className="flex border-b border-gray-200">
            {([
              { key: 'ready' as const, label: 'Ready', count: readyOrders.length },
              { key: 'active' as const, label: 'Active', count: data.runs.filter(r => r.status !== 'completed').length },
              { key: 'drivers' as const, label: 'Drivers', count: data.drivers.length },
              { key: 'exceptions' as const, label: 'Exceptions', count: openExceptions.length },
            ]).map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex-1 px-3 py-2.5 text-sm font-medium transition-colors relative ${
                  activeTab === tab.key
                    ? 'text-blue-600 border-b-2 border-blue-600'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {tab.label}
                {tab.count > 0 && (
                  <span className={`ml-1.5 inline-flex items-center justify-center w-5 h-5 text-xs rounded-full ${
                    tab.key === 'exceptions' && tab.count > 0
                      ? 'bg-red-100 text-red-700'
                      : 'bg-gray-100 text-gray-600'
                  }`}>
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          <div className="flex-1 overflow-y-auto">
            {activeTab === 'ready' && (
              <ReadyTab
                orders={readyOrders}
                drivers={availableDrivers}
                buildingRun={buildingRun}
                selectedOrderIds={selectedOrderIds}
                onToggleOrder={toggleOrderSelection}
                onAssign={handleAssignSingle}
                onSuggestDriver={suggestDriver}
              />
            )}
            {activeTab === 'active' && (
              <ActiveTab runs={data.runs.filter(r => r.status !== 'completed')} />
            )}
            {activeTab === 'drivers' && (
              <DriversTab
                drivers={data.drivers}
                onEndShift={(sessionId, name) => {
                  setCheckoutSessionId(sessionId)
                  setCheckoutDriverName(name)
                }}
              />
            )}
            {activeTab === 'exceptions' && (
              <ExceptionsTab
                exceptions={openExceptions}
                resolvingId={resolvingExceptionId}
                onResolve={handleResolveException}
              />
            )}
          </div>
        </div>
      </div>

      {/* ─── Assign Driver Modal (for Run Builder) ────────────────────── */}
      <Modal
        isOpen={assignDriverModal}
        onClose={() => setAssignDriverModal(false)}
        title={`Assign Driver to ${selectedOrderIds.size} Order${selectedOrderIds.size !== 1 ? 's' : ''}`}
        size="sm"
      >
        <div className="space-y-4">
          <select
            value={selectedDriverId}
            onChange={e => setSelectedDriverId(e.target.value)}
            className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-900 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">Select a driver...</option>
            {availableDrivers.map(d => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.activeOrders} active{d.status === 'available' ? ' - available' : ''})
              </option>
            ))}
          </select>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={() => setAssignDriverModal(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleCreateRun}
              disabled={!selectedDriverId}
              className="bg-green-600 hover:bg-green-700"
            >
              Dispatch Run
            </Button>
          </div>
        </div>
      </Modal>

      {/* ─── Driver Checkout Modal ──────────────────────────────────── */}
      <DriverCheckoutModal
        isOpen={!!checkoutSessionId}
        onClose={() => setCheckoutSessionId(null)}
        sessionId={checkoutSessionId || ''}
        driverName={checkoutDriverName}
        onCheckoutComplete={loadDispatchData}
      />
    </div>
  )
}

// ─── Drivers Tab ────────────────────────────────────────────────────────────

function DriversTab({
  drivers,
  onEndShift,
}: {
  drivers: DispatchDriver[]
  onEndShift: (sessionId: string, driverName: string) => void
}) {
  if (drivers.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-500 text-sm">
        No active driver sessions
      </div>
    )
  }

  return (
    <div className="divide-y divide-gray-100">
      {drivers.map(driver => {
        const statusColors: Record<string, string> = {
          available: 'bg-green-100 text-green-700',
          on_delivery: 'bg-blue-100 text-blue-700',
          returning: 'bg-purple-100 text-purple-700',
          offline: 'bg-gray-100 text-gray-500',
        }
        const statusBadge = statusColors[driver.status] || 'bg-gray-100 text-gray-600'

        return (
          <div key={driver.id} className="p-3 hover:bg-gray-50 transition-colors">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center">
                  <span className="text-xs font-bold text-indigo-700">
                    {driver.initials}
                  </span>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900">{driver.name}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${statusBadge}`}>
                      {driver.status.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-400">
                    {driver.activeOrders > 0 && (
                      <span>{driver.activeOrders} active order{driver.activeOrders !== 1 ? 's' : ''}</span>
                    )}
                    {driver.vehicleInfo && (
                      <span>{driver.vehicleInfo}</span>
                    )}
                    {driver.onTimePct != null && (
                      <span>{driver.onTimePct}% on-time</span>
                    )}
                  </div>
                </div>
              </div>
              <button
                onClick={() => onEndShift(driver.id, driver.name)}
                className="text-xs px-2.5 py-1 bg-red-50 text-red-700 border border-red-200 rounded-md hover:bg-red-100 hover:border-red-300 transition-colors font-medium flex-shrink-0"
              >
                End Shift
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Ready Tab ──────────────────────────────────────────────────────────────

function ReadyTab({
  orders,
  drivers,
  buildingRun,
  selectedOrderIds,
  onToggleOrder,
  onAssign,
  onSuggestDriver,
}: {
  orders: DispatchOrder[]
  drivers: DispatchDriver[]
  buildingRun: boolean
  selectedOrderIds: Set<string>
  onToggleOrder: (id: string) => void
  onAssign: (orderId: string, driverId: string) => void
  onSuggestDriver: (orderId: string) => DispatchDriver | null
}) {
  const [assigningOrderId, setAssigningOrderId] = useState<string | null>(null)
  const [quickDriverId, setQuickDriverId] = useState('')

  if (orders.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-500 text-sm">
        No orders ready for pickup
      </div>
    )
  }

  return (
    <div className="divide-y divide-gray-100">
      {orders.map(order => {
        const suggested = onSuggestDriver(order.id)
        const isSelected = selectedOrderIds.has(order.id)

        return (
          <div
            key={order.id}
            className={`p-3 hover:bg-gray-50 transition-colors ${
              isSelected ? 'bg-blue-50 border-l-2 border-l-blue-500' : ''
            }`}
          >
            <div className="flex items-start gap-2">
              {buildingRun && (
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => onToggleOrder(order.id)}
                  className="mt-1 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-gray-900">{order.customerName}</span>
                    {order.orderNumber && (
                      <span className="text-xs text-gray-500">#{order.orderNumber}</span>
                    )}
                  </div>
                  {order.readyAt && (
                    <span className="text-xs text-gray-400">
                      {Math.round((Date.now() - new Date(order.readyAt).getTime()) / 60000)}m ago
                    </span>
                  )}
                </div>
                <div className="text-xs text-gray-500 mt-0.5 truncate">{order.address}</div>
                <div className="flex items-center gap-2 mt-1.5 text-xs">
                  {order.zoneName && (
                    <span className="text-gray-400">{order.zoneName}</span>
                  )}
                  <span className="text-gray-400">ETA: {order.estimatedMinutes}min</span>
                  {order.deliveryFee > 0 && (
                    <span className="text-gray-400">${order.deliveryFee.toFixed(2)}</span>
                  )}
                </div>

                {!buildingRun && (
                  <div className="flex items-center gap-1.5 mt-2">
                    {assigningOrderId === order.id ? (
                      <div className="flex items-center gap-1.5">
                        <select
                          value={quickDriverId}
                          onChange={e => setQuickDriverId(e.target.value)}
                          className="text-xs px-2 py-1 border border-gray-300 rounded-md bg-white"
                        >
                          <option value="">Pick driver...</option>
                          {drivers.map(d => (
                            <option key={d.id} value={d.id}>
                              {d.name} ({d.activeOrders})
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => {
                            if (quickDriverId) {
                              onAssign(order.id, quickDriverId)
                              setAssigningOrderId(null)
                              setQuickDriverId('')
                            }
                          }}
                          disabled={!quickDriverId}
                          className="text-xs px-2 py-1 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                        >
                          Go
                        </button>
                        <button
                          onClick={() => { setAssigningOrderId(null); setQuickDriverId('') }}
                          className="text-xs px-2 py-1 text-gray-500 hover:text-gray-700"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <>
                        <button
                          onClick={() => setAssigningOrderId(order.id)}
                          className="text-xs px-2.5 py-1 bg-blue-600 text-white rounded-md hover:bg-blue-700 font-medium"
                        >
                          Assign
                        </button>
                        {suggested && (
                          <button
                            onClick={() => onAssign(order.id, suggested.id)}
                            className="text-xs px-2 py-1 bg-green-50 text-green-700 border border-green-200 rounded-md hover:bg-green-100"
                            title={`Suggest: ${suggested.name} (${suggested.activeOrders} active)`}
                          >
                            Suggest: {suggested.name}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Active Tab ─────────────────────────────────────────────────────────────

function ActiveTab({ runs }: { runs: DispatchRun[] }) {
  if (runs.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-500 text-sm">
        No active runs
      </div>
    )
  }

  return (
    <div className="divide-y divide-gray-100">
      {runs.map(run => (
        <div key={run.id} className="p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-purple-100 flex items-center justify-center">
                <span className="text-xs font-bold text-purple-700">
                  {run.driverName.split(' ').map(n => n[0]).join('').slice(0, 2)}
                </span>
              </div>
              <div>
                <span className="text-sm font-medium text-gray-900">{run.driverName}</span>
                <span className={`ml-2 text-xs px-1.5 py-0.5 rounded-full ${
                  run.status === 'dispatched' ? 'bg-blue-100 text-blue-700'
                    : run.status === 'in_progress' ? 'bg-purple-100 text-purple-700'
                    : 'bg-gray-100 text-gray-600'
                }`}>
                  {run.status.replace(/_/g, ' ')}
                </span>
              </div>
            </div>
            <span className="text-xs text-gray-400">
              {run.orders.length} order{run.orders.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="space-y-1 ml-9">
            {run.orders.map((order, i) => (
              <div key={order.id} className="flex items-center gap-2 text-xs">
                <span className="w-4 h-4 flex items-center justify-center rounded-full bg-gray-100 text-gray-500 text-[10px] font-medium">
                  {i + 1}
                </span>
                <span className="text-gray-700">{order.customerName}</span>
                <span className="text-gray-400 truncate flex-1">{order.address}</span>
                <span className={`capitalize ${
                  order.status === 'delivered' ? 'text-green-600' : 'text-gray-500'
                }`}>
                  {order.status.replace(/_/g, ' ')}
                </span>
              </div>
            ))}
          </div>
          {run.estimatedCompletionAt && (
            <div className="text-xs text-gray-400 mt-1.5 ml-9">
              Est. complete: {new Date(run.estimatedCompletionAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Exceptions Tab ─────────────────────────────────────────────────────────

function ExceptionsTab({
  exceptions,
  resolvingId,
  onResolve,
}: {
  exceptions: DispatchException[]
  resolvingId: string | null
  onResolve: (id: string) => void
}) {
  if (exceptions.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-gray-500 text-sm">
        No open exceptions
      </div>
    )
  }

  return (
    <div className="divide-y divide-gray-100">
      {exceptions.map(ex => {
        const sev = SEVERITY_COLORS[ex.severity]
        return (
          <div key={ex.id} className={`p-3 border-l-2 ${sev.border}`}>
            <div className="flex items-start justify-between">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wide ${sev.badge}`}>
                    {ex.severity}
                  </span>
                  <span className="text-xs text-gray-500 capitalize">{ex.type.replace(/_/g, ' ')}</span>
                </div>
                <p className="text-sm text-gray-800 mt-1">{ex.message}</p>
                <div className="flex items-center gap-2 mt-1 text-xs text-gray-400">
                  {ex.orderNumber && <span>Order #{ex.orderNumber}</span>}
                  {ex.driverName && <span>Driver: {ex.driverName}</span>}
                  <span>{new Date(ex.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                </div>
              </div>
              <button
                onClick={() => onResolve(ex.id)}
                disabled={resolvingId === ex.id}
                className="ml-2 text-xs px-2.5 py-1 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 flex-shrink-0"
              >
                {resolvingId === ex.id ? 'Resolving...' : 'Resolve'}
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
