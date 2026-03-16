'use client'

/**
 * Customer Delivery Tracking Page — Public, no auth required.
 *
 * Mobile-first, clean, branded design. Shows:
 *   - Map (restaurant pin, customer pin, driver marker if visible)
 *   - 5-step progress bar: Placed -> Preparing -> Ready -> On the Way -> Delivered
 *   - ETA countdown (large, 48px)
 *   - Driver info (if shareDriverInfo enabled)
 *   - Contact restaurant phone
 *
 * Data flow:
 *   - Initial fetch: GET /api/public/delivery-tracking/[token]
 *   - Location poll: GET /api/public/delivery-tracking/[token]/location (every 15s)
 *   - Respects hideDriverLocationUntilNearby setting
 *
 * Token-based access: no auth, no internal IDs exposed. Invalid/expired tokens get 404.
 */

import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import { useParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import type { MapMarker } from '@/components/delivery/TrackingMap'

// Dynamic import — no SSR for Leaflet
const TrackingMap = dynamic(() => import('@/components/delivery/TrackingMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full bg-gray-900 flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  ),
})

// ── Types ───────────────────────────────────────────────────────────────────

interface TrackingData {
  orderNumber: number
  status: string
  restaurantName: string
  restaurantPhone: string | null
  restaurantCoords: { lat: number; lng: number } | null
  customerCoords: { lat: number; lng: number } | null
  customerAddress: string | null
  driverName: string | null
  driverVehicle: string | null
  driverCoords: { lat: number; lng: number } | null
  driverVisible: boolean
  estimatedDeliveryAt: string | null
  promisedAt: string | null
  shareDriverInfo: boolean
  emergencyDisabled: boolean
  cancelled: boolean
  cancelReason: string | null
  delivered: boolean
  deliveredAt: string | null
  failed: boolean
}

interface DriverLocation {
  lat: number
  lng: number
  visible: boolean
}

// ── Status Steps ────────────────────────────────────────────────────────────

type TrackingStep = 'placed' | 'preparing' | 'ready' | 'on_the_way' | 'delivered'

const STEPS: { key: TrackingStep; label: string }[] = [
  { key: 'placed', label: 'Order Placed' },
  { key: 'preparing', label: 'Preparing' },
  { key: 'ready', label: 'Ready' },
  { key: 'on_the_way', label: 'On the Way' },
  { key: 'delivered', label: 'Delivered' },
]

function mapStatusToStep(status: string): TrackingStep {
  switch (status) {
    case 'pending':
    case 'confirmed':
      return 'placed'
    case 'preparing':
      return 'preparing'
    case 'ready_for_pickup':
    case 'assigned':
      return 'ready'
    case 'dispatched':
    case 'en_route':
    case 'arrived':
      return 'on_the_way'
    case 'delivered':
      return 'delivered'
    default:
      return 'placed'
  }
}

function getStepIndex(step: TrackingStep): number {
  return STEPS.findIndex(s => s.key === step)
}

// ── ETA Formatting ──────────────────────────────────────────────────────────

function formatEta(targetIso: string): { label: string; expired: boolean } {
  const target = new Date(targetIso).getTime()
  const now = Date.now()
  const diffMs = target - now

  if (diffMs <= 0) {
    return { label: 'Any moment now', expired: true }
  }

  const totalMinutes = Math.ceil(diffMs / 60000)

  if (totalMinutes <= 1) {
    return { label: '~1 min', expired: false }
  }

  if (totalMinutes < 60) {
    return { label: `~${totalMinutes} min`, expired: false }
  }

  const hours = Math.floor(totalMinutes / 60)
  const mins = totalMinutes % 60
  if (mins === 0) {
    return { label: `~${hours} hr`, expired: false }
  }
  return { label: `~${hours} hr ${mins} min`, expired: false }
}

// ── Phone formatter ─────────────────────────────────────────────────────────

function formatPhoneDisplay(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  if (digits.length === 11 && digits[0] === '1') {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  }
  return phone
}

function formatPhoneHref(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  return `tel:+1${digits.length === 11 && digits[0] === '1' ? digits.slice(1) : digits}`
}

// ── Main Page ───────────────────────────────────────────────────────────────

export default function DeliveryTrackingPage() {
  const params = useParams()
  const token = params?.token as string

  const [data, setData] = useState<TrackingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [etaLabel, setEtaLabel] = useState<string>('')
  const [driverLoc, setDriverLoc] = useState<DriverLocation | null>(null)

  const locationPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const etaTickRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const statusPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Fetch initial tracking data ──────────────────────────────────────────

  const fetchTrackingData = useCallback(async () => {
    if (!token) return

    try {
      const res = await fetch(`/api/public/delivery-tracking/${encodeURIComponent(token)}`)

      if (res.status === 404) {
        setNotFound(true)
        setLoading(false)
        return
      }

      if (!res.ok) {
        setError('Unable to load tracking information. Please try again.')
        setLoading(false)
        return
      }

      const json = await res.json()
      setData(json.data)
      setError(null)

      // Set initial driver location from tracking data
      if (json.data.driverCoords && json.data.driverVisible) {
        setDriverLoc({ lat: json.data.driverCoords.lat, lng: json.data.driverCoords.lng, visible: true })
      }
    } catch {
      setError('Network error. Please check your connection.')
    } finally {
      setLoading(false)
    }
  }, [token])

  // ── Fetch driver location ────────────────────────────────────────────────

  const fetchDriverLocation = useCallback(async () => {
    if (!token || !data || data.delivered || data.cancelled || data.failed) return

    try {
      const res = await fetch(`/api/public/delivery-tracking/${encodeURIComponent(token)}/location`)
      if (!res.ok) return

      const json = await res.json()
      if (json.data) {
        setDriverLoc(json.data)
      }
    } catch {
      // Silent fail on location poll
    }
  }, [token, data])

  // ── Effects ──────────────────────────────────────────────────────────────

  // Initial fetch
  useEffect(() => {
    void fetchTrackingData()
  }, [fetchTrackingData])

  // Poll driver location every 15s
  useEffect(() => {
    if (!data || data.delivered || data.cancelled || data.failed) return

    // Only poll location during active delivery states
    const step = mapStatusToStep(data.status)
    if (step === 'delivered') return

    locationPollRef.current = setInterval(fetchDriverLocation, 15_000)

    return () => {
      if (locationPollRef.current) clearInterval(locationPollRef.current)
    }
  }, [data, fetchDriverLocation])

  // Poll status every 30s to pick up state changes
  useEffect(() => {
    if (!data || data.delivered || data.cancelled || data.failed) return

    statusPollRef.current = setInterval(fetchTrackingData, 30_000)

    return () => {
      if (statusPollRef.current) clearInterval(statusPollRef.current)
    }
  }, [data, fetchTrackingData])

  // ETA countdown — tick every second
  useEffect(() => {
    const etaSource = data?.estimatedDeliveryAt || data?.promisedAt
    if (!etaSource || data?.delivered || data?.cancelled || data?.failed) {
      setEtaLabel('')
      return
    }

    function tick() {
      const result = formatEta(etaSource!)
      setEtaLabel(result.label)
    }

    tick()
    etaTickRef.current = setInterval(tick, 1000)

    return () => {
      if (etaTickRef.current) clearInterval(etaTickRef.current)
    }
  }, [data?.estimatedDeliveryAt, data?.promisedAt, data?.delivered, data?.cancelled, data?.failed])

  // ── Build map markers ────────────────────────────────────────────────────

  const mapMarkers = useMemo<MapMarker[]>(() => {
    if (!data) return []

    const markers: MapMarker[] = []

    if (data.restaurantCoords) {
      markers.push({
        lat: data.restaurantCoords.lat,
        lng: data.restaurantCoords.lng,
        type: 'restaurant',
        label: data.restaurantName,
      })
    }

    if (data.customerCoords) {
      markers.push({
        lat: data.customerCoords.lat,
        lng: data.customerCoords.lng,
        type: 'customer',
        label: data.customerAddress || 'Delivery Address',
      })
    }

    // Driver marker — only if visible (respects hideDriverLocationUntilNearby)
    const activeLoc = driverLoc ?? (data.driverCoords && data.driverVisible ? { ...data.driverCoords, visible: true } : null)
    if (activeLoc && activeLoc.visible) {
      markers.push({
        lat: activeLoc.lat,
        lng: activeLoc.lng,
        type: 'driver',
        label: data.driverName ? `Driver: ${data.driverName}` : 'Your Driver',
      })
    }

    return markers
  }, [data, driverLoc])

  // ── Derived state ────────────────────────────────────────────────────────

  const currentStep = data ? mapStatusToStep(data.status) : 'placed'
  const currentStepIndex = getStepIndex(currentStep)
  const isTerminal = data?.delivered || data?.cancelled || data?.failed

  // ── Render: Loading ──────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-3 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400 text-base">Loading tracking info...</p>
        </div>
      </div>
    )
  }

  // ── Render: 404 ──────────────────────────────────────────────────────────

  if (notFound) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
        <div className="max-w-sm w-full text-center">
          <div className="text-5xl mb-4 text-gray-600">?</div>
          <h1 className="text-xl font-bold text-white mb-2">Tracking Not Found</h1>
          <p className="text-gray-400 text-sm">
            This tracking link is invalid or has expired. If you believe this is an error,
            please contact the restaurant directly.
          </p>
        </div>
      </div>
    )
  }

  // ── Render: Error ────────────────────────────────────────────────────────

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
        <div className="max-w-sm w-full text-center">
          <div className="bg-red-900/30 border border-red-800 rounded-xl p-6">
            <p className="text-red-300 text-sm">{error || 'Something went wrong.'}</p>
            <button
              onClick={() => { setLoading(true); void fetchTrackingData() }}
              className="mt-4 px-5 py-2 bg-red-800 hover:bg-red-700 text-white text-sm rounded-lg transition-colors"
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Render: Emergency Disabled ───────────────────────────────────────────

  if (data.emergencyDisabled) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-6">
        <div className="max-w-sm w-full text-center">
          <div className="bg-amber-900/30 border border-amber-700 rounded-xl p-6">
            <div className="text-3xl mb-3">!</div>
            <h1 className="text-lg font-bold text-white mb-2">Service Temporarily Unavailable</h1>
            <p className="text-gray-300 text-sm mb-4">
              Delivery tracking is temporarily unavailable. Please contact the restaurant for updates.
            </p>
            {data.restaurantPhone && (
              <a
                href={formatPhoneHref(data.restaurantPhone)}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg transition-colors"
              >
                <PhoneIcon />
                Call {formatPhoneDisplay(data.restaurantPhone)}
              </a>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ── Render: Cancelled ────────────────────────────────────────────────────

  if (data.cancelled) {
    return (
      <div className="min-h-screen bg-gray-950 text-white">
        <TrackingHeader restaurantName={data.restaurantName} orderNumber={data.orderNumber} />
        <div className="max-w-lg mx-auto px-4 py-8">
          <div className="bg-red-900/20 border border-red-800 rounded-xl p-6 text-center">
            <div className="text-4xl mb-3 text-red-400">X</div>
            <h2 className="text-lg font-bold text-white mb-2">Order Cancelled</h2>
            {data.cancelReason && (
              <p className="text-gray-300 text-sm mb-4">{data.cancelReason}</p>
            )}
            <p className="text-gray-400 text-sm">
              Please contact the restaurant if you have questions.
            </p>
          </div>
          {data.restaurantPhone && (
            <ContactSection phone={data.restaurantPhone} restaurantName={data.restaurantName} />
          )}
        </div>
      </div>
    )
  }

  // ── Render: Failed Delivery ──────────────────────────────────────────────

  if (data.failed) {
    return (
      <div className="min-h-screen bg-gray-950 text-white">
        <TrackingHeader restaurantName={data.restaurantName} orderNumber={data.orderNumber} />
        <div className="max-w-lg mx-auto px-4 py-8">
          <div className="bg-amber-900/20 border border-amber-700 rounded-xl p-6 text-center">
            <div className="text-4xl mb-3">!</div>
            <h2 className="text-lg font-bold text-white mb-2">Delivery Issue</h2>
            <p className="text-gray-300 text-sm mb-4">
              We were unable to complete your delivery. The restaurant has been notified
              and will reach out to arrange redelivery or a refund.
            </p>
          </div>
          {data.restaurantPhone && (
            <ContactSection phone={data.restaurantPhone} restaurantName={data.restaurantName} />
          )}
        </div>
      </div>
    )
  }

  // ── Render: Main Tracking View ───────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <TrackingHeader restaurantName={data.restaurantName} orderNumber={data.orderNumber} />

      {/* Map — top 40vh */}
      <div className="w-full" style={{ height: '40vh', minHeight: '240px', maxHeight: '400px' }}>
        <TrackingMap markers={mapMarkers} className="w-full h-full" />
      </div>

      {/* Content */}
      <div className="max-w-lg mx-auto px-4 py-5 space-y-5 pb-8">

        {/* Status Progress Bar */}
        <div className="bg-gray-900 rounded-xl p-5">
          <div className="flex items-center justify-between relative">
            {/* Connecting line behind dots */}
            <div className="absolute top-3 left-0 right-0 h-0.5 bg-gray-700" />
            <div
              className="absolute top-3 left-0 h-0.5 bg-blue-500 transition-all duration-500"
              style={{ width: `${(currentStepIndex / (STEPS.length - 1)) * 100}%` }}
            />

            {STEPS.map((step, i) => {
              const isComplete = i < currentStepIndex
              const isCurrent = i === currentStepIndex
              const isPending = i > currentStepIndex

              return (
                <div key={step.key} className="flex flex-col items-center relative z-10" style={{ flex: 1 }}>
                  {/* Dot */}
                  <div
                    className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all duration-300 ${
                      isComplete
                        ? 'bg-blue-500 border-blue-500'
                        : isCurrent
                        ? 'bg-blue-500 border-blue-400 ring-4 ring-blue-500/30'
                        : 'bg-gray-800 border-gray-600'
                    }`}
                  >
                    {isComplete && (
                      <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                    {isCurrent && (
                      <div className="w-2 h-2 bg-white rounded-full" />
                    )}
                  </div>

                  {/* Label */}
                  <span
                    className={`text-xs mt-2 text-center leading-tight ${
                      isComplete || isCurrent ? 'text-blue-400 font-medium' : 'text-gray-500'
                    }`}
                    style={{ maxWidth: '64px' }}
                  >
                    {step.label}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* ETA Section */}
        {etaLabel && !data.delivered && (
          <div className="bg-gray-900 rounded-xl p-5 text-center">
            <p className="text-gray-400 text-sm mb-1">Estimated Arrival</p>
            <p className="text-white font-bold" style={{ fontSize: '48px', lineHeight: 1.1 }}>
              {etaLabel}
            </p>
          </div>
        )}

        {/* Delivered Success */}
        {data.delivered && (
          <div className="bg-green-900/20 border border-green-700 rounded-xl p-5 text-center">
            <div className="text-4xl mb-2">&#10003;</div>
            <h2 className="text-lg font-bold text-green-400 mb-1">Delivered!</h2>
            {data.deliveredAt && (
              <p className="text-gray-400 text-sm">
                Delivered at {new Date(data.deliveredAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              </p>
            )}
          </div>
        )}

        {/* Driver Info */}
        {data.shareDriverInfo && data.driverName && !data.delivered && (
          <div className="bg-gray-900 rounded-xl p-5">
            <p className="text-gray-400 text-xs uppercase tracking-wider mb-2">Your Driver</p>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gray-700 rounded-full flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
                </svg>
              </div>
              <div>
                <p className="text-white font-medium">{data.driverName}</p>
                {data.driverVehicle && (
                  <p className="text-gray-400 text-sm">{data.driverVehicle}</p>
                )}
              </div>
            </div>
            {/* Driver location hint when hidden */}
            {!data.driverVisible && currentStep === 'on_the_way' && (
              <p className="text-gray-500 text-xs mt-3">Driver is on the way</p>
            )}
          </div>
        )}

        {/* Contact Restaurant */}
        {data.restaurantPhone && (
          <ContactSection phone={data.restaurantPhone} restaurantName={data.restaurantName} />
        )}
      </div>
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────────────────

function TrackingHeader({ restaurantName, orderNumber }: { restaurantName: string; orderNumber: number }) {
  return (
    <div className="bg-gray-900 border-b border-gray-800 px-4 py-3.5">
      <div className="max-w-lg mx-auto">
        <h1 className="text-lg font-bold text-white">{restaurantName}</h1>
        <p className="text-gray-400 text-sm">Order #{orderNumber}</p>
      </div>
    </div>
  )
}

function ContactSection({ phone, restaurantName }: { phone: string; restaurantName: string }) {
  return (
    <div className="bg-gray-900 rounded-xl p-5">
      <p className="text-gray-400 text-xs uppercase tracking-wider mb-3">Contact Restaurant</p>
      <a
        href={formatPhoneHref(phone)}
        className="flex items-center gap-3 w-full px-4 py-3 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
      >
        <PhoneIcon />
        <div>
          <p className="text-white font-medium text-sm">{formatPhoneDisplay(phone)}</p>
          <p className="text-gray-400 text-xs">{restaurantName}</p>
        </div>
      </a>
    </div>
  )
}

function PhoneIcon() {
  return (
    <svg className="w-5 h-5 text-blue-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
    </svg>
  )
}
