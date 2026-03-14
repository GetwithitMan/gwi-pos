'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { formatCurrency } from '@/lib/utils'
import { toast } from '@/stores/toast-store'
import { Modal } from '@/components/ui/modal'
import { useSocket } from '@/hooks/useSocket'
import { useOrderSettings } from '@/hooks/useOrderSettings'
import { calculateCardPrice } from '@/lib/pricing'
import { calculateTimeRemaining, calculateElapsedTime } from '@/lib/entertainment'

import type { EntertainmentVisualType } from '@/components/floor-plan/entertainment-visuals'
import {
  DEFAULT_PRICING,
  DEFAULT_PREPAID_PACKAGES,
  getPackageSavings,
  type PrepaidPackage,
} from '@/lib/entertainment-pricing'

/** Status item from GET /api/entertainment/status */
interface StatusItem {
  id: string
  name: string
  displayName: string
  status: 'available' | 'in_use' | 'maintenance'
  currentOrder: {
    orderId: string
    orderItemId: string | null
    tabName: string
  } | null
  currentOrderItemId?: string | null
  timeInfo: {
    type: 'block' | 'per_minute'
    startedAt?: string
    expiresAt?: string
    minutesRemaining?: number
    minutesElapsed?: number
    isExpired?: boolean
    isExpiringSoon?: boolean
    blockMinutes?: number
  } | null
  price: number
  linkedMenuItem: { id: string; name: string } | null
}

interface TimedItem {
  id: string
  name: string
  price: number
  timedPricing?: {
    per15Min?: number
    per30Min?: number
    perHour?: number
  }
  blockTimeMinutes?: number
  minimumMinutes?: number
  gracePeriodMinutes?: number
  entertainmentStatus?: 'available' | 'maintenance'
  visualType?: EntertainmentVisualType
}

type OvertimeMode = 'multiplier' | 'custom_rate' | 'flat_fee' | 'per_minute'
type RateUnit = 'second' | 'minute' | 'hour'
const RATE_UNIT_MULTIPLIERS: Record<RateUnit, number> = { second: 1/60, minute: 1, hour: 60 }
const RATE_UNIT_LABELS: Record<RateUnit, string> = { second: 'sec', minute: 'min', hour: 'hr' }
const BILLING_OPTIONS = [
  { value: 1, label: '1 min' },
  { value: 5, label: '5 min' },
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 60, label: '1 hour' },
]

interface PricingWindowForm {
  id: string
  name: string
  percentAdjust: number   // -50 = 50% off, +25 = 25% extra
  dollarAdjust: number    // per minute: -0.05 = $0.05/min off, +0.10 = $0.10/min extra
  startTime: string       // "13:00"
  endTime: string         // "16:00"
  days: string[]
  enabled: boolean
}

interface ItemBuilderForm {
  name: string
  visualType: EntertainmentVisualType
  ratePerMinute: number
  rateUnit: RateUnit
  billingGranularity: number // incrementMinutes: 1, 5, 15, 30, 60
  gracePeriodMinutes: number
  // Prepaid packages
  prepaidPackages: PrepaidPackage[]
  // Pricing windows (replaces single happy hour)
  pricingWindows: PricingWindowForm[]
  // Overtime pricing
  overtimeEnabled: boolean
  overtimeMode: OvertimeMode
  overtimeMultiplier: number
  overtimePerMinuteRate: number
  overtimeFlatFee: number
  overtimeGraceMinutes: number
  // Status
  status: 'available' | 'maintenance'
}

export default function TimedRentalsPage() {
  const router = useRouter()
  useEffect(() => { router.replace('/settings/entertainment') }, [router])
  return <div className="min-h-screen bg-gray-950" />
}

export function TimedRentalsContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const itemIdFromUrl = searchParams.get('item')

  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/timed-rentals' })
  const employee = useAuthStore(s => s.employee)
  const locationId = employee?.location?.id
  const { socket, isConnected } = useSocket()
  const { dualPricing } = useOrderSettings()
  const cashDiscountPct = dualPricing.cashDiscountPercent || 4.0
  const isDualPricingEnabled = dualPricing.enabled !== false
  const [activeItems, setActiveItems] = useState<StatusItem[]>([])
  const [timedItems, setTimedItems] = useState<TimedItem[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // Builder state
  const [showBuilder, setShowBuilder] = useState(false)
  const [builderForm, setBuilderForm] = useState<ItemBuilderForm>({
    name: '',
    visualType: 'pool_table',
    ratePerMinute: DEFAULT_PRICING.ratePerMinute,
    rateUnit: 'hour',
    billingGranularity: 15,
    gracePeriodMinutes: DEFAULT_PRICING.graceMinutes,
    prepaidPackages: DEFAULT_PREPAID_PACKAGES,
    pricingWindows: [],
    overtimeEnabled: false,
    overtimeMode: 'multiplier',
    overtimeMultiplier: 1.5,
    overtimePerMinuteRate: 0.50,
    overtimeFlatFee: 10,
    overtimeGraceMinutes: 5,
    status: 'available'
  })
  const [isSaving, setIsSaving] = useState(false)
  const [rateInputStr, setRateInputStr] = useState('15')

  // Sync rate display value when builder opens or unit changes
  useEffect(() => {
    if (!showBuilder) return
    const rpm = typeof builderForm.ratePerMinute === 'number' ? builderForm.ratePerMinute : 0
    const mul = RATE_UNIT_MULTIPLIERS[builderForm.rateUnit]
    const display = rpm * mul
    setRateInputStr(display > 0 ? parseFloat(display.toFixed(4)).toString() : '')
  }, [showBuilder, builderForm.rateUnit])

  // Entertainment settings state
  const [allowExtendWithWaitlist, setAllowExtendWithWaitlist] = useState(true)
  const [isSavingSettings, setIsSavingSettings] = useState(false)

  // Load entertainment settings
  useEffect(() => {
    async function loadEntertainmentSettings() {
      try {
        const res = await fetch('/api/settings')
        if (res.ok) {
          const data = await res.json()
          const s = data.data?.settings
          if (s?.entertainment?.allowExtendWithWaitlist !== undefined) {
            setAllowExtendWithWaitlist(s.entertainment.allowExtendWithWaitlist)
          }
        }
      } catch (err) {
        console.error('Failed to load entertainment settings:', err)
      }
    }
    loadEntertainmentSettings()
  }, [])

  const saveEntertainmentSettings = async (value: boolean) => {
    setAllowExtendWithWaitlist(value)
    setIsSavingSettings(true)
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          settings: { entertainment: { allowExtendWithWaitlist: value } },
          employeeId: employee?.id,
        }),
      })
      if (res.ok) {
        toast.success(value ? 'Extensions allowed with waitlist' : 'Extensions blocked when waitlist active')
      } else {
        setAllowExtendWithWaitlist(!value) // revert on failure
        toast.error('Failed to save setting')
      }
    } catch {
      setAllowExtendWithWaitlist(!value) // revert on failure
      toast.error('Failed to save setting')
    } finally {
      setIsSavingSettings(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  // Socket-driven updates for entertainment status changes
  useEffect(() => {
    if (!socket || !isConnected) return
    const onUpdate = () => loadData()
    socket.on('entertainment:session-update', onUpdate)
    socket.on('entertainment:status-changed', onUpdate)
    return () => {
      socket.off('entertainment:session-update', onUpdate)
      socket.off('entertainment:status-changed', onUpdate)
    }
  }, [socket, isConnected])

  // 20s fallback polling only when socket is disconnected
  useEffect(() => {
    if (isConnected) return
    const fallback = setInterval(loadData, 20000)
    return () => clearInterval(fallback)
  }, [isConnected])

  // Instant refresh on tab switch
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === 'visible') loadData()
    }
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [])

  // Handle URL parameter for item builder
  useEffect(() => {
    if (!itemIdFromUrl || timedItems.length === 0) return

    if (itemIdFromUrl === 'new') {
      // Create new item
      setBuilderForm({
        name: '',
        visualType: 'pool_table',
        ratePerMinute: DEFAULT_PRICING.ratePerMinute,
        rateUnit: 'hour',
        billingGranularity: 15,
        gracePeriodMinutes: DEFAULT_PRICING.graceMinutes,
        prepaidPackages: DEFAULT_PREPAID_PACKAGES,
        pricingWindows: [],
        overtimeEnabled: false,
        overtimeMode: 'multiplier',
        overtimeMultiplier: 1.5,
        overtimePerMinuteRate: 0.50,
        overtimeFlatFee: 10,
        overtimeGraceMinutes: 5,
        status: 'available'
      })
      setShowBuilder(true)
    } else {
      // Load existing item — fetch from individual item endpoint to get MenuItem-level columns
      const item = timedItems.find(i => i.id === itemIdFromUrl)
      if (item) {
        const ratePerMinute = (item.timedPricing as any)?.ratePerMinute
          || ((item.timedPricing?.perHour || item.price || 15) / 60)
        const savedRateUnit: RateUnit = (item.timedPricing as any)?.rateUnit || 'hour'
        const savedBillingGranularity: number = (item.timedPricing as any)?.billingGranularity || 15

        // Load pricing windows from timedPricing JSON, or convert legacy happyHour
        let pricingWindows: PricingWindowForm[] = []
        const storedWindows = (item.timedPricing as any)?.pricingWindows
        if (Array.isArray(storedWindows) && storedWindows.length > 0) {
          // Migrate old type/value format to percentAdjust/dollarAdjust
          pricingWindows = storedWindows.map((w: any) => {
            if (w.percentAdjust !== undefined) return w
            const pct = w.type === 'discount' ? -(w.value || 0) : w.type === 'surcharge' ? (w.value || 0) : 0
            const dollar = w.type === 'fixed_rate' ? (w.value || 0) - ratePerMinute : 0
            return { ...w, percentAdjust: pct, dollarAdjust: dollar }
          })
        } else if ((item.timedPricing as any)?.happyHour?.enabled) {
          // Convert legacy single happy hour to a pricing window
          const legacyHH = (item.timedPricing as any).happyHour
          const legacyPrice = legacyHH.price || 0
          const discountPct = ratePerMinute > 0 && legacyPrice > 0
            ? Math.round((1 - legacyPrice / ratePerMinute) * 100)
            : 50
          pricingWindows = [{
            id: 'legacy-hh',
            name: 'Happy Hour',
            percentAdjust: -discountPct,
            dollarAdjust: 0,
            startTime: '13:00',
            endTime: '18:00',
            days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
            enabled: true,
          }]
        }

        // Extract overtime fields from timedPricing JSON (fallback defaults)
        const overtime = (item.timedPricing as any)?.overtime
        let otEnabled = overtime?.enabled || false
        let otMode: OvertimeMode = overtime?.mode || 'multiplier'
        let otMultiplier = overtime?.multiplier ?? 1.5
        let otPerMinuteRate = overtime?.perMinuteRate ?? 0.50
        let otFlatFee = overtime?.flatFee ?? 10
        let otGraceMinutes = overtime?.graceMinutes ?? 5

        const applyForm = () => {
          setBuilderForm({
            name: item.name,
            visualType: item.visualType || 'pool_table',
            ratePerMinute,
            rateUnit: savedRateUnit,
            billingGranularity: savedBillingGranularity,
            gracePeriodMinutes: item.gracePeriodMinutes || DEFAULT_PRICING.graceMinutes,
            prepaidPackages: (item.timedPricing as any)?.prepaidPackages || DEFAULT_PREPAID_PACKAGES,
            pricingWindows,
            overtimeEnabled: otEnabled,
            overtimeMode: otMode,
            overtimeMultiplier: otMultiplier,
            overtimePerMinuteRate: otPerMinuteRate,
            overtimeFlatFee: otFlatFee,
            overtimeGraceMinutes: otGraceMinutes,
            status: item.entertainmentStatus || 'available'
          })
          setShowBuilder(true)
        }

        // Fetch full item detail for authoritative columns
        void (async () => {
          try {
            const detailRes = await fetch(`/api/menu/items/${itemIdFromUrl}?locationId=${employee?.location?.id}`)
            if (detailRes.ok) {
              const detailData = await detailRes.json()
              const detail = detailData.data?.item
              if (detail) {
                // Convert legacy happyHour* columns into a pricing window if no pricingWindows exist
                if (detail.happyHourEnabled && pricingWindows.length === 0) {
                  const discountPct = detail.happyHourDiscount != null ? Number(detail.happyHourDiscount) : 50
                  pricingWindows = [{
                    id: 'legacy-hh',
                    name: 'Happy Hour',
                    percentAdjust: -discountPct,
                    dollarAdjust: 0,
                    startTime: detail.happyHourStart || '13:00',
                    endTime: detail.happyHourEnd || '16:00',
                    days: Array.isArray(detail.happyHourDays) ? detail.happyHourDays : ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
                    enabled: true,
                  }]
                }
                // Populate overtime fields from MenuItem columns if present
                if (detail.overtimeEnabled != null) otEnabled = detail.overtimeEnabled
                if (detail.overtimeMode) otMode = detail.overtimeMode as OvertimeMode
                if (detail.overtimeMultiplier != null) otMultiplier = Number(detail.overtimeMultiplier)
                if (detail.overtimePerMinuteRate != null) otPerMinuteRate = Number(detail.overtimePerMinuteRate)
                if (detail.overtimeFlatFee != null) otFlatFee = Number(detail.overtimeFlatFee)
                if (detail.overtimeGraceMinutes != null) otGraceMinutes = Number(detail.overtimeGraceMinutes)
              }
            }
          } catch {
            // Fall back to timedPricing JSON values already set above
          }
          applyForm()
        })()
      }
    }
  }, [itemIdFromUrl, timedItems])

  const loadData = async () => {
    if (!employee?.location?.id) return

    try {
      const [statusRes, menuRes] = await Promise.all([
        fetch(`/api/entertainment/status?locationId=${employee.location.id}`, { cache: 'no-store' }),
        fetch(`/api/menu?locationId=${employee.location.id}`),
      ])

      if (statusRes.ok) {
        const data = await statusRes.json()
        const items: StatusItem[] = data.data?.items || []
        setActiveItems(items.filter(i => i.status === 'in_use'))
      }

      if (menuRes.ok) {
        const data = await menuRes.json()
        // Filter to entertainment items - either by itemType OR categoryType
        const timed = (data.data.items || []).filter((i: { itemType: string; categoryType?: string }) =>
          i.itemType === 'timed_rental' || i.categoryType === 'entertainment'
        )
        setTimedItems(timed)
      }
    } catch (error) {
      console.error('Failed to load data:', error)
    } finally {
      setIsLoading(false)
    }
  }

  // Extend time on an active session
  const handleExtendTime = async (item: StatusItem, minutes: number) => {
    const orderItemId = item.currentOrderItemId || item.currentOrder?.orderItemId
    if (!orderItemId || !locationId) {
      toast.error('Cannot find session to extend')
      return
    }

    try {
      const res = await fetch('/api/entertainment/block-time', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderItemId, additionalMinutes: minutes, locationId }),
      })

      if (res.ok) {
        toast.success(`Extended by ${minutes} minutes`)
        loadData()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to extend time')
      }
    } catch (err) {
      console.error('Error extending time:', err)
      toast.error('Failed to extend time')
    }
  }

  // Stop an active session
  const handleStopSession = async (item: StatusItem) => {
    if (!confirm('Stop this session and finalize the charge?')) return

    const orderItemId = item.currentOrderItemId || item.currentOrder?.orderItemId
    if (!orderItemId || !locationId) {
      toast.error('Cannot find session to stop')
      return
    }

    try {
      const res = await fetch(`/api/entertainment/block-time?orderItemId=${orderItemId}&locationId=${locationId}`, {
        method: 'DELETE',
      })

      if (res.ok) {
        toast.success('Session stopped')
        loadData()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to stop session')
      }
    } catch (err) {
      console.error('Error stopping session:', err)
      toast.error('Failed to stop session')
    }
  }

  // Check if two time ranges overlap on any shared day
  const windowsOverlap = (a: PricingWindowForm, b: PricingWindowForm): boolean => {
    if (!a.enabled || !b.enabled) return false
    if (!a.days.some(d => b.days.includes(d))) return false
    // Normalize to minutes for comparison
    const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }
    const aStart = toMin(a.startTime), aEnd = toMin(a.endTime)
    const bStart = toMin(b.startTime), bEnd = toMin(b.endTime)
    const aOvernight = aStart >= aEnd
    const bOvernight = bStart >= bEnd
    if (!aOvernight && !bOvernight) return aStart < bEnd && bStart < aEnd
    if (aOvernight && !bOvernight) return bStart >= aStart || bEnd <= aEnd
    if (!aOvernight && bOvernight) return aStart >= bStart || aEnd <= bEnd
    return true // both overnight — always overlap
  }

  const handleSaveItem = async () => {
    if (!employee?.location?.id) return
    if (!builderForm.name.trim()) {
      toast.warning('Please enter an item name')
      return
    }

    // Check for overlapping pricing windows
    const enabled = builderForm.pricingWindows.filter(w => w.enabled)
    for (let i = 0; i < enabled.length; i++) {
      for (let j = i + 1; j < enabled.length; j++) {
        if (windowsOverlap(enabled[i], enabled[j])) {
          const sharedDays = enabled[i].days.filter(d => enabled[j].days.includes(d))
          toast.error(`"${enabled[i].name}" and "${enabled[j].name}" overlap on ${sharedDays.map(d => d.charAt(0).toUpperCase() + d.slice(1, 3)).join(', ')}`)
          return
        }
      }
    }

    setIsSaving(true)
    try {
      const isNewItem = itemIdFromUrl === 'new'
      const url = isNewItem
        ? '/api/menu/items'
        : `/api/menu/items/${itemIdFromUrl}`

      // Sync first discount-type window to happyHour* columns for backward compat
      const firstDiscount = builderForm.pricingWindows.find(w => {
        if (!w.enabled) return false
        const eff = builderForm.ratePerMinute * (1 + (w.percentAdjust || 0) / 100) + (w.dollarAdjust || 0)
        return eff < builderForm.ratePerMinute
      })
      const hhDiscount = firstDiscount && builderForm.ratePerMinute > 0
        ? Math.round((1 - (builderForm.ratePerMinute * (1 + (firstDiscount.percentAdjust || 0) / 100) + (firstDiscount.dollarAdjust || 0)) / builderForm.ratePerMinute) * 100)
        : null
      const hhEnabled = !!firstDiscount

      const body = {
        locationId: employee.location.id,
        name: builderForm.name,
        itemType: 'timed_rental',
        price: builderForm.ratePerMinute * 60, // Base price = hourly rate
        ratePerMinute: builderForm.ratePerMinute,
        minimumCharge: 0,
        incrementMinutes: builderForm.billingGranularity,
        timedPricing: {
          ratePerMinute: builderForm.ratePerMinute,
          rateUnit: builderForm.rateUnit,
          billingGranularity: builderForm.billingGranularity,
          prepaidPackages: builderForm.prepaidPackages,
          pricingWindows: builderForm.pricingWindows,
          // Keep legacy happyHour for backward compat (reading code may still check this)
          happyHour: firstDiscount ? {
            enabled: true,
            price: builderForm.ratePerMinute * (1 + (firstDiscount.percentAdjust || 0) / 100) + (firstDiscount.dollarAdjust || 0),
          } : null,
          overtime: builderForm.overtimeEnabled ? {
            enabled: true,
            mode: builderForm.overtimeMode,
            multiplier: builderForm.overtimeMultiplier,
            perMinuteRate: builderForm.overtimePerMinuteRate,
            flatFee: builderForm.overtimeFlatFee,
            graceMinutes: builderForm.overtimeGraceMinutes,
          } : null,
        },
        gracePeriodMinutes: builderForm.gracePeriodMinutes,
        entertainmentStatus: builderForm.status,
        visualType: builderForm.visualType,
        // Ensure it's in entertainment category
        categoryId: null, // Will need to set entertainment category
        // Sync to MenuItem columns for backward compat with pricing engine
        happyHourEnabled: hhEnabled,
        happyHourDiscount: hhDiscount,
        happyHourStart: firstDiscount?.startTime || null,
        happyHourEnd: firstDiscount?.endTime || null,
        happyHourDays: firstDiscount?.days || [],
        // MenuItem-level overtime columns
        overtimeEnabled: builderForm.overtimeEnabled,
        overtimeMode: builderForm.overtimeEnabled ? builderForm.overtimeMode : null,
        overtimeMultiplier: builderForm.overtimeEnabled ? builderForm.overtimeMultiplier : null,
        overtimePerMinuteRate: builderForm.overtimeEnabled ? builderForm.overtimePerMinuteRate : null,
        overtimeFlatFee: builderForm.overtimeEnabled ? builderForm.overtimeFlatFee : null,
        overtimeGraceMinutes: builderForm.overtimeEnabled ? builderForm.overtimeGraceMinutes : null,
      }

      const res = await fetch(url, {
        method: isNewItem ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (res.ok) {
        setShowBuilder(false)
        router.push('/settings/entertainment')
        loadData()
      } else {
        const error = await res.json()
        toast.error(`Failed to save: ${error.error || 'Unknown error'}`)
      }
    } catch (error) {
      console.error('Failed to save item:', error)
      toast.error('Failed to save item')
    } finally {
      setIsSaving(false)
    }
  }

  // Visual type options with icons
  const VISUAL_TYPES = [
    { value: 'pool_table', label: 'Pool Table', icon: '🎱' },
    { value: 'dartboard', label: 'Dartboard', icon: '🎯' },
    { value: 'arcade', label: 'Arcade', icon: '🕹️' },
    { value: 'foosball', label: 'Foosball', icon: '⚽' },
    { value: 'bowling_lane', label: 'Bowling', icon: '🎳' },
    { value: 'ping_pong', label: 'Ping Pong', icon: '🏓' },
    { value: 'karaoke_stage', label: 'Karaoke', icon: '🎤' },
    { value: 'dj_booth', label: 'DJ Booth', icon: '🎧' },
    { value: 'photo_booth', label: 'Photo', icon: '📸' },
    { value: 'vr_station', label: 'VR', icon: '🥽' },
    { value: 'game_table', label: 'Game', icon: '🎮' },
    { value: 'shuffleboard', label: 'Shuffle', icon: '🪑' },
  ]

  if (!hydrated) return null

  return (
    <div className="p-6 max-w-7xl mx-auto">
        <div className="mb-6 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Timed Rentals</h1>
            <p className="text-gray-600">Pool tables, dart boards, and hourly rentals</p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => router.push('/settings/entertainment?item=new')}
            >
              Create New Item
            </Button>
            <Button onClick={() => router.push('/kds/entertainment')}>
              Open Entertainment Center
            </Button>
          </div>
        </div>

        {/* Entertainment Items Library */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span>🎱</span>
              Entertainment Items ({timedItems.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-gray-900">Loading...</p>
            ) : timedItems.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-900 mb-4">No entertainment items configured yet.</p>
                <Button onClick={() => router.push('/settings/entertainment?item=new')}>
                  Create Your First Entertainment Item
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {timedItems.map(item => (
                  <button
                    key={item.id}
                    onClick={() => router.push(`/settings/entertainment?item=${item.id}`)}
                    className="p-4 border rounded-lg text-left hover:border-blue-500 hover:bg-blue-50 transition-colors"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-2xl">
                        {item.visualType === 'pool_table' ? '🎱' :
                         item.visualType === 'dartboard' ? '🎯' :
                         item.visualType === 'arcade' ? '🕹️' :
                         item.visualType === 'foosball' ? '⚽' :
                         item.visualType === 'karaoke_stage' ? '🎤' :
                         item.visualType === 'bowling_lane' ? '🎳' :
                         item.visualType === 'ping_pong' ? '🏓' : '🎮'}
                      </span>
                      <div>
                        <div className="font-medium">{item.name}</div>
                        <div className="text-sm text-gray-900">
                          {(() => {
                            const rpm = Number((item.timedPricing as any)?.ratePerMinute || 0)
                            if (rpm > 0) {
                              const unit: RateUnit = (item.timedPricing as any)?.rateUnit || 'hour'
                              const mul = RATE_UNIT_MULTIPLIERS[unit]
                              const lbl = RATE_UNIT_LABELS[unit]
                              return `$${(rpm * mul).toFixed(2)}/${lbl}`
                            }
                            if (item.timedPricing?.perHour) return `${formatCurrency(item.timedPricing.perHour)}/hr`
                            return `${formatCurrency(item.price)} flat`
                          })()}
                        </div>
                        {isDualPricingEnabled && (item.timedPricing?.perHour || item.price) > 0 && (
                          <div className="text-xs text-gray-900">
                            Card: {formatCurrency(calculateCardPrice(item.timedPricing?.perHour || item.price, cashDiscountPct))}/hr
                          </div>
                        )}
                      </div>
                    </div>
                    {item.blockTimeMinutes && (
                      <div className="text-xs text-gray-900">
                        {item.blockTimeMinutes} min blocks
                      </div>
                    )}
                    <div className={`text-xs mt-1 ${
                      item.entertainmentStatus === 'maintenance' ? 'text-red-500' : 'text-green-500'
                    }`}>
                      {item.entertainmentStatus === 'maintenance' ? '🔧 Maintenance' : '✓ Available'}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Active Sessions — from entertainment status API (real block-time system) */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Active Sessions ({activeItems.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-gray-900">Loading...</p>
            ) : activeItems.length === 0 ? (
              <p className="text-gray-900">No active sessions</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {activeItems.map(item => (
                  <ActiveSessionCard
                    key={item.id}
                    item={item}
                    onExtendTime={handleExtendTime}
                    onStopSession={handleStopSession}
                    onOpenTab={(orderId) => router.push(`/orders?orderId=${orderId}`)}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Entertainment Policies */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Policies</CardTitle>
          </CardHeader>
          <CardContent>
            <label className="flex items-center justify-between gap-4 cursor-pointer">
              <div>
                <div className="font-medium text-gray-900">Block extensions when waitlist is active</div>
                <div className="text-sm text-gray-500">
                  When enabled, customers cannot extend their session if others are waiting for the same equipment type.
                  They must finish so the next person can play.
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={!allowExtendWithWaitlist}
                disabled={isSavingSettings}
                onClick={() => saveEntertainmentSettings(!allowExtendWithWaitlist)}
                className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                  !allowExtendWithWaitlist ? 'bg-blue-600' : 'bg-gray-200'
                } ${isSavingSettings ? 'opacity-50' : ''}`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    !allowExtendWithWaitlist ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </label>
          </CardContent>
        </Card>

        {/* Recent Sessions — view on Entertainment Center */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Sessions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-center py-6">
              <p className="text-gray-900 mb-3">
                Session history is available on the Entertainment Center, which manages
                all active and completed entertainment sessions tied to customer orders.
              </p>
              <Button
                variant="outline"
                onClick={() => router.push('/kds/entertainment')}
              >
                View on Entertainment Center
              </Button>
            </div>
          </CardContent>
        </Card>

      {/* Entertainment Builder Modal */}
      <Modal
        isOpen={showBuilder}
        onClose={() => {
          setShowBuilder(false)
          router.push('/settings/entertainment')
        }}
        title={itemIdFromUrl === 'new' ? 'Create Entertainment Item' : 'Edit Entertainment Item'}
        size="2xl"
      >
            <div className="space-y-4">
              {/* Name + Visual Type Row */}
              <div className="flex gap-4 items-end">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-900 mb-1">Name</label>
                  <input
                    type="text"
                    value={builderForm.name}
                    onChange={(e) => setBuilderForm({ ...builderForm, name: e.target.value })}
                    className="w-full border rounded px-3 py-2"
                    placeholder="Pool Table 1"
                  />
                </div>
                <div className="w-48">
                  <label className="block text-sm font-medium text-gray-900 mb-1">Visual</label>
                  <select
                    value={builderForm.visualType}
                    onChange={(e) => setBuilderForm({...builderForm, visualType: e.target.value as EntertainmentVisualType})}
                    className="w-full border rounded px-3 py-2"
                  >
                    {VISUAL_TYPES.map(type => (
                      <option key={type.value} value={type.value}>
                        {type.icon} {type.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Pricing */}
              <div className="border-t pt-3 mt-3">
                <div className="text-sm font-medium text-gray-900 mb-2">Pricing</div>

                {/* Rate + Unit selector */}
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <div className="flex items-center gap-1">
                    <span className="text-gray-900">$</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={rateInputStr}
                      onChange={e => {
                        const raw = e.target.value
                        setRateInputStr(raw)
                        if (raw === '' || raw === '.' || raw === '0.') return
                        const v = parseFloat(raw)
                        if (!isNaN(v)) {
                          const divisor = RATE_UNIT_MULTIPLIERS[builderForm.rateUnit]
                          setBuilderForm({...builderForm, ratePerMinute: v / divisor})
                        }
                      }}
                      onBlur={() => {
                        const v = parseFloat(rateInputStr)
                        const mul = RATE_UNIT_MULTIPLIERS[builderForm.rateUnit]
                        if (isNaN(v) || v <= 0) {
                          setBuilderForm({...builderForm, ratePerMinute: 0.01})
                          setRateInputStr((0.01 * mul).toString())
                        } else {
                          setBuilderForm({...builderForm, ratePerMinute: v / mul})
                          setRateInputStr(v.toString())
                        }
                      }}
                      className="w-24 px-2 py-1 border rounded text-right text-sm"
                    />
                    <select
                      value={builderForm.rateUnit}
                      onChange={e => setBuilderForm({...builderForm, rateUnit: e.target.value as RateUnit})}
                      className="px-2 py-1 border rounded text-sm bg-white"
                    >
                      <option value="second">/ second</option>
                      <option value="minute">/ minute</option>
                      <option value="hour">/ hour</option>
                    </select>
                  </div>
                  {builderForm.rateUnit !== 'minute' && typeof builderForm.ratePerMinute === 'number' && (
                    <span className="text-xs text-gray-500">(${builderForm.ratePerMinute.toFixed(4)}/min)</span>
                  )}
                  {isDualPricingEnabled && builderForm.ratePerMinute > 0 && (
                    <span className="text-xs text-gray-500">Card: ${calculateCardPrice(builderForm.ratePerMinute * RATE_UNIT_MULTIPLIERS[builderForm.rateUnit], cashDiscountPct).toFixed(2)}/{RATE_UNIT_LABELS[builderForm.rateUnit]}</span>
                  )}
                </div>

                {/* Billing granularity + Grace */}
                <div className="flex items-center gap-4 mb-2">
                  <div className="flex items-center gap-1">
                    <span className="text-gray-900 text-sm">Bill every:</span>
                    <select
                      value={builderForm.billingGranularity}
                      onChange={e => setBuilderForm({...builderForm, billingGranularity: parseInt(e.target.value)})}
                      className="px-2 py-1 border rounded text-sm bg-white"
                    >
                      {BILLING_OPTIONS.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-1 ml-auto">
                    <span className="text-gray-900 text-sm">Grace:</span>
                    <input
                      type="number"
                      min="0"
                      max="15"
                      value={builderForm.gracePeriodMinutes}
                      onChange={e => setBuilderForm({...builderForm, gracePeriodMinutes: parseInt(e.target.value) || 0})}
                      className="w-12 px-2 py-1 border rounded text-right text-sm"
                    />
                    <span className="text-gray-900 text-sm">min</span>
                  </div>
                </div>

              </div>

              {/* Pricing Schedule (multiple windows) */}
              <div className="border-t pt-3 mt-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-900">Pricing Schedule</span>
                  <button
                    type="button"
                    onClick={() => {
                      const newWindow: PricingWindowForm = {
                        id: `pw-${Date.now()}`,
                        name: builderForm.pricingWindows.length === 0 ? 'Happy Hour' : `Window ${builderForm.pricingWindows.length + 1}`,
                        percentAdjust: -50,
                        dollarAdjust: 0,
                        startTime: '13:00',
                        endTime: '18:00',
                        days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
                        enabled: true,
                      }
                      setBuilderForm({...builderForm, pricingWindows: [...builderForm.pricingWindows, newWindow]})
                    }}
                    className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                  >
                    + Add Pricing Window
                  </button>
                </div>

                {builderForm.pricingWindows.length === 0 && (
                  <p className="text-xs text-gray-500 italic">No pricing windows configured. Base rate applies at all times.</p>
                )}

                {builderForm.pricingWindows.map((window, index) => {
                  const updateWindow = (updates: Partial<PricingWindowForm>) => {
                    const windows = [...builderForm.pricingWindows]
                    windows[index] = { ...windows[index], ...updates }
                    setBuilderForm({...builderForm, pricingWindows: windows})
                  }
                  const removeWindow = () => {
                    setBuilderForm({...builderForm, pricingWindows: builderForm.pricingWindows.filter((_, i) => i !== index)})
                  }
                  // Calculate effective rate for display
                  const effectiveRate = Math.max(0, builderForm.ratePerMinute * (1 + (window.percentAdjust || 0) / 100) + (window.dollarAdjust || 0))
                  const isDiscount = effectiveRate < builderForm.ratePerMinute

                  return (
                    <div key={window.id} className={`mb-3 p-3 rounded-lg border ${window.enabled ? 'bg-white border-gray-200' : 'bg-gray-50 border-gray-100 opacity-60'}`}>
                      {/* Header row: enable toggle, name, remove */}
                      <div className="flex items-center gap-2 mb-2">
                        <input
                          type="checkbox"
                          checked={window.enabled}
                          onChange={e => updateWindow({ enabled: e.target.checked })}
                          className="rounded"
                        />
                        <input
                          type="text"
                          value={window.name}
                          onChange={e => updateWindow({ name: e.target.value })}
                          placeholder="Window name"
                          className="flex-1 px-2 py-1 border rounded text-sm font-medium"
                        />
                        <button type="button" onClick={removeWindow} className="text-red-400 hover:text-red-600 text-sm px-1">Remove</button>
                      </div>

                      {/* Adjustments row: % and $ side by side */}
                      <div className="flex items-center gap-4 mb-2 ml-6">
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            inputMode="numeric"
                            value={window.percentAdjust}
                            onChange={e => {
                              const raw = e.target.value
                              if (raw === '' || raw === '-') { updateWindow({ percentAdjust: raw as any }); return }
                              const v = parseFloat(raw)
                              if (!isNaN(v)) updateWindow({ percentAdjust: v })
                            }}
                            onBlur={() => {
                              const v = parseFloat(String(window.percentAdjust))
                              updateWindow({ percentAdjust: isNaN(v) ? 0 : v })
                            }}
                            className="w-24 px-2 py-1 border rounded text-right text-sm"
                          />
                          <span className="text-gray-900 text-sm">%</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-gray-900 text-sm">$</span>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={window.dollarAdjust}
                            onChange={e => {
                              const raw = e.target.value
                              if (raw === '' || raw === '-' || raw === '.' || raw === '-.' || raw === '0.' || raw === '-0.') { updateWindow({ dollarAdjust: raw as any }); return }
                              const v = parseFloat(raw)
                              if (!isNaN(v)) updateWindow({ dollarAdjust: v })
                            }}
                            onBlur={() => {
                              const v = parseFloat(String(window.dollarAdjust))
                              updateWindow({ dollarAdjust: isNaN(v) ? 0 : v })
                            }}
                            className="w-24 px-2 py-1 border rounded text-right text-sm"
                          />
                          <span className="text-gray-900 text-sm">/min</span>
                        </div>
                        <span className={`text-xs font-medium ${isDiscount ? 'text-green-600' : effectiveRate > builderForm.ratePerMinute ? 'text-red-600' : 'text-gray-500'}`}>
                          = ${(effectiveRate * RATE_UNIT_MULTIPLIERS[builderForm.rateUnit]).toFixed(2)}/{RATE_UNIT_LABELS[builderForm.rateUnit]}
                          {isDiscount ? ' (discount)' : effectiveRate > builderForm.ratePerMinute ? ' (premium)' : ''}
                        </span>
                        {isDualPricingEnabled && effectiveRate > 0 && (
                          <span className="text-xs text-gray-500">Card: ${calculateCardPrice(effectiveRate * RATE_UNIT_MULTIPLIERS[builderForm.rateUnit], cashDiscountPct).toFixed(2)}/{RATE_UNIT_LABELS[builderForm.rateUnit]}</span>
                        )}
                      </div>

                      {/* Schedule row */}
                      <div className="ml-6 space-y-2">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="text-gray-900">From</span>
                          <input
                            type="time"
                            value={window.startTime}
                            onChange={e => updateWindow({ startTime: e.target.value })}
                            className="px-2 py-1 border rounded text-sm"
                          />
                          <span className="text-gray-900">to</span>
                          <input
                            type="time"
                            value={window.endTime}
                            onChange={e => updateWindow({ endTime: e.target.value })}
                            className="px-2 py-1 border rounded text-sm"
                          />
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const).map(day => (
                            <button
                              key={day}
                              type="button"
                              onClick={() => {
                                const days = window.days.includes(day)
                                  ? window.days.filter(d => d !== day)
                                  : [...window.days, day]
                                updateWindow({ days })
                              }}
                              className={`px-2 py-0.5 rounded text-xs font-medium ${
                                window.days.includes(day)
                                  ? isDiscount
                                    ? 'bg-amber-100 text-amber-800 border border-amber-300'
                                    : 'bg-red-100 text-red-800 border border-red-300'
                                  : 'bg-gray-100 text-gray-900 border border-gray-200'
                              }`}
                            >
                              {day.charAt(0).toUpperCase() + day.slice(1, 3)}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Overtime Pricing */}
              <div className="border-t pt-3 mt-3">
                <label className="flex items-center gap-2 text-sm mb-2">
                  <input
                    type="checkbox"
                    checked={builderForm.overtimeEnabled}
                    onChange={e => setBuilderForm({...builderForm, overtimeEnabled: e.target.checked})}
                    className="rounded"
                  />
                  <span className="font-medium text-gray-900">Enable Overtime Charges</span>
                </label>

                {builderForm.overtimeEnabled && (
                  <div className="ml-6 space-y-3">
                    {/* Mode selector pills */}
                    <div>
                      <div className="text-xs text-gray-900 mb-1">Overtime Mode</div>
                      <div className="flex flex-wrap gap-1">
                        {([
                          { value: 'multiplier' as OvertimeMode, label: 'Rate Multiplier' },
                          { value: 'custom_rate' as OvertimeMode, label: 'Custom Rate' },
                          { value: 'per_minute' as OvertimeMode, label: 'Per Minute' },
                          { value: 'flat_fee' as OvertimeMode, label: 'Flat Fee' },
                        ] as const).map(mode => (
                          <button
                            key={mode.value}
                            type="button"
                            onClick={() => setBuilderForm({...builderForm, overtimeMode: mode.value})}
                            className={`px-3 py-1 rounded text-xs font-medium ${
                              builderForm.overtimeMode === mode.value
                                ? 'bg-blue-100 text-blue-800 border border-blue-300'
                                : 'bg-gray-100 text-gray-900 border border-gray-200'
                            }`}
                          >
                            {mode.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Mode-specific input */}
                    <div>
                      {builderForm.overtimeMode === 'multiplier' && (
                        <div className="flex items-center gap-1 text-sm">
                          <span className="text-gray-900">Multiplier:</span>
                          <input
                            type="number"
                            step="0.1"
                            min="1"
                            value={builderForm.overtimeMultiplier}
                            onChange={e => setBuilderForm({...builderForm, overtimeMultiplier: parseFloat(e.target.value) || 1.5})}
                            className="w-24 px-2 py-1 border rounded text-right text-sm"
                          />
                          <span className="text-gray-900">x base rate</span>
                          <span className="text-gray-900 text-xs ml-1">
                            (${(builderForm.ratePerMinute * builderForm.overtimeMultiplier * RATE_UNIT_MULTIPLIERS[builderForm.rateUnit]).toFixed(2)}/{RATE_UNIT_LABELS[builderForm.rateUnit]})
                          </span>
                        </div>
                      )}

                      {builderForm.overtimeMode === 'custom_rate' && (
                        <div className="flex items-center gap-1 text-sm">
                          <span className="text-gray-900">Rate: $</span>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={builderForm.overtimePerMinuteRate}
                            onChange={e => {
                              const raw = e.target.value
                              if (raw === '' || raw === '.' || raw === '0.') {
                                setBuilderForm({...builderForm, overtimePerMinuteRate: raw as any})
                              } else {
                                const v = parseFloat(raw)
                                if (!isNaN(v)) setBuilderForm({...builderForm, overtimePerMinuteRate: v})
                              }
                            }}
                            onBlur={() => {
                              const v = parseFloat(String(builderForm.overtimePerMinuteRate))
                              setBuilderForm({...builderForm, overtimePerMinuteRate: isNaN(v) || v <= 0 ? 0.01 : v})
                            }}
                            className="w-24 px-2 py-1 border rounded text-right text-sm"
                          />
                          <span className="text-gray-900">/min</span>
                          {builderForm.rateUnit !== 'minute' && (
                            <span className="text-gray-900 text-xs ml-1">
                              (${((parseFloat(String(builderForm.overtimePerMinuteRate)) || 0) * RATE_UNIT_MULTIPLIERS[builderForm.rateUnit]).toFixed(2)}/{RATE_UNIT_LABELS[builderForm.rateUnit]})
                            </span>
                          )}
                        </div>
                      )}

                      {builderForm.overtimeMode === 'per_minute' && (
                        <div className="flex items-center gap-1 text-sm">
                          <span className="text-gray-900">Rate: $</span>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={builderForm.overtimePerMinuteRate}
                            onChange={e => {
                              const raw = e.target.value
                              if (raw === '' || raw === '.' || raw === '0.') {
                                setBuilderForm({...builderForm, overtimePerMinuteRate: raw as any})
                              } else {
                                const v = parseFloat(raw)
                                if (!isNaN(v)) setBuilderForm({...builderForm, overtimePerMinuteRate: v})
                              }
                            }}
                            onBlur={() => {
                              const v = parseFloat(String(builderForm.overtimePerMinuteRate))
                              setBuilderForm({...builderForm, overtimePerMinuteRate: isNaN(v) || v <= 0 ? 0.01 : v})
                            }}
                            className="w-24 px-2 py-1 border rounded text-right text-sm"
                          />
                          <span className="text-gray-900">/min (exact)</span>
                          {builderForm.rateUnit !== 'minute' && (
                            <span className="text-gray-900 text-xs ml-1">
                              (${((parseFloat(String(builderForm.overtimePerMinuteRate)) || 0) * RATE_UNIT_MULTIPLIERS[builderForm.rateUnit]).toFixed(2)}/{RATE_UNIT_LABELS[builderForm.rateUnit]})
                            </span>
                          )}
                        </div>
                      )}

                      {builderForm.overtimeMode === 'flat_fee' && (
                        <div className="flex items-center gap-1 text-sm">
                          <span className="text-gray-900">Fee: $</span>
                          <input
                            type="number"
                            step="1"
                            min="1"
                            value={builderForm.overtimeFlatFee}
                            onChange={e => setBuilderForm({...builderForm, overtimeFlatFee: parseFloat(e.target.value) || 10})}
                            className="w-24 px-2 py-1 border rounded text-right text-sm"
                          />
                          <span className="text-gray-900">one-time</span>
                        </div>
                      )}
                    </div>

                    {/* Grace period */}
                    <div className="flex items-center gap-1 text-sm">
                      <span className="text-gray-900">Grace period:</span>
                      <input
                        type="number"
                        min="0"
                        max="30"
                        value={builderForm.overtimeGraceMinutes}
                        onChange={e => setBuilderForm({...builderForm, overtimeGraceMinutes: parseInt(e.target.value) || 0})}
                        className="w-12 px-2 py-1 border rounded text-right text-sm"
                      />
                      <span className="text-gray-900">min before overtime starts</span>
                    </div>

                    {/* Preview text */}
                    <div className="text-xs text-blue-600 bg-blue-50 px-2 py-1.5 rounded">
                      {(() => {
                        const sessionMin = 60
                        const overMin = 15
                        const billableOver = Math.max(0, overMin - builderForm.overtimeGraceMinutes)
                        let charge = 0
                        if (builderForm.overtimeMode === 'multiplier') {
                          charge = billableOver * builderForm.ratePerMinute * builderForm.overtimeMultiplier
                        } else if (builderForm.overtimeMode === 'custom_rate' || builderForm.overtimeMode === 'per_minute') {
                          charge = billableOver * builderForm.overtimePerMinuteRate
                        } else if (builderForm.overtimeMode === 'flat_fee') {
                          charge = billableOver > 0 ? builderForm.overtimeFlatFee : 0
                        }
                        return billableOver > 0
                          ? `If a ${sessionMin}-min session goes ${overMin} min over: +${formatCurrency(charge)} overtime (${billableOver} billable min after ${builderForm.overtimeGraceMinutes}-min grace)`
                          : `If a ${sessionMin}-min session goes ${overMin} min over: no charge (within ${builderForm.overtimeGraceMinutes}-min grace period)`
                      })()}
                    </div>
                  </div>
                )}
              </div>

              {/* Prepaid Packages */}
              <div className="border-t pt-3 mt-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-900">Prepaid Packages</span>
                  <button
                    type="button"
                    onClick={() => {
                      const newPkg = { minutes: 30, price: 10, label: '' }
                      setBuilderForm({...builderForm, prepaidPackages: [...builderForm.prepaidPackages, newPkg]})
                    }}
                    className="text-xs text-green-600 hover:text-green-800"
                  >
                    + Add
                  </button>
                </div>

                <div className="space-y-1">
                  {builderForm.prepaidPackages.map((pkg, idx) => {
                    const savings = getPackageSavings(pkg, builderForm.ratePerMinute)
                    return (
                      <div key={idx} className="flex items-center gap-2 text-sm">
                        <input
                          type="number"
                          value={pkg.minutes}
                          onChange={e => {
                            const updated = [...builderForm.prepaidPackages]
                            updated[idx] = {...pkg, minutes: parseInt(e.target.value) || 0}
                            setBuilderForm({...builderForm, prepaidPackages: updated})
                          }}
                          className="w-12 px-1 py-0.5 border rounded text-right text-sm"
                        />
                        <span className="text-gray-900">min = $</span>
                        <input
                          type="number"
                          step="0.50"
                          value={pkg.price}
                          onChange={e => {
                            const updated = [...builderForm.prepaidPackages]
                            updated[idx] = {...pkg, price: parseFloat(e.target.value) || 0}
                            setBuilderForm({...builderForm, prepaidPackages: updated})
                          }}
                          className="w-14 px-1 py-0.5 border rounded text-right text-sm"
                        />
                        {savings > 0 && (
                          <span className="text-green-600 text-xs">(saves ${savings.toFixed(2)})</span>
                        )}
                        {isDualPricingEnabled && pkg.price > 0 && (
                          <span className="text-xs text-gray-900">Card: ${calculateCardPrice(pkg.price, cashDiscountPct).toFixed(2)}</span>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            const updated = builderForm.prepaidPackages.filter((_, i) => i !== idx)
                            setBuilderForm({...builderForm, prepaidPackages: updated})
                          }}
                          className="ml-auto text-red-400 hover:text-red-600 text-xs"
                        >
                          ✕
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Inline Status Radio Buttons */}
              <div className="flex items-center gap-6 border-t pt-3 mt-3">
                <span className="text-sm font-medium text-gray-900">Status:</span>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="status"
                    checked={builderForm.status === 'available'}
                    onChange={() => setBuilderForm({...builderForm, status: 'available'})}
                    className="text-green-600 focus:ring-green-500"
                  />
                  <span className="text-sm text-green-700">Available</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="status"
                    checked={builderForm.status === 'maintenance'}
                    onChange={() => setBuilderForm({...builderForm, status: 'maintenance'})}
                    className="text-amber-600 focus:ring-amber-500"
                  />
                  <span className="text-sm text-amber-700">Maintenance</span>
                </label>
              </div>
            </div>
            {/* Actions */}
            <div className="flex gap-2 pt-4 border-t">
              <Button
                variant="outline"
                onClick={() => {
                  setShowBuilder(false)
                  router.push('/settings/entertainment')
                }}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSaveItem}
                disabled={isSaving || !builderForm.name.trim()}
                className="flex-1"
              >
                {isSaving ? 'Saving...' : 'Save Item'}
              </Button>
            </div>
      </Modal>

    </div>
  )
}

/** Live-updating card for an in-use entertainment item */
function ActiveSessionCard({
  item,
  onExtendTime,
  onStopSession,
  onOpenTab,
}: {
  item: StatusItem
  onExtendTime: (item: StatusItem, minutes: number) => void
  onStopSession: (item: StatusItem) => void
  onOpenTab: (orderId: string) => void
}) {
  const [timerDisplay, setTimerDisplay] = useState('')
  const [urgencyLevel, setUrgencyLevel] = useState<'normal' | 'warning' | 'critical' | 'expired'>('normal')

  // 1-second timer tick
  useEffect(() => {
    if (!item.timeInfo) {
      setTimerDisplay('')
      return
    }

    const updateTimer = () => {
      if (item.timeInfo?.type === 'block' && item.timeInfo.expiresAt) {
        const result = calculateTimeRemaining(item.timeInfo.expiresAt)
        setTimerDisplay(result.formatted)
        setUrgencyLevel(result.urgencyLevel)
      } else if (item.timeInfo?.type === 'per_minute' && item.timeInfo.startedAt) {
        const result = calculateElapsedTime(item.timeInfo.startedAt)
        setTimerDisplay(result.formatted)
        setUrgencyLevel('normal')
      }
    }

    updateTimer()
    const interval = setInterval(updateTimer, 1000)
    return () => clearInterval(interval)
  }, [item.timeInfo])

  const timerColorClass =
    urgencyLevel === 'expired' ? 'text-red-600 bg-red-100' :
    urgencyLevel === 'critical' ? 'text-orange-600 bg-orange-100' :
    urgencyLevel === 'warning' ? 'text-yellow-600 bg-yellow-100' :
    'text-gray-900 bg-gray-100'

  const borderClass =
    urgencyLevel === 'expired' || urgencyLevel === 'critical'
      ? 'border-red-500'
      : 'border-green-500'

  return (
    <Card className={borderClass}>
      <CardContent className="p-4">
        <div className="flex justify-between items-start mb-2">
          <div>
            <h3 className="font-bold">{item.displayName}</h3>
            {item.currentOrder && (
              <p className="text-sm text-gray-900">Tab: {item.currentOrder.tabName}</p>
            )}
          </div>
          <span className="px-2 py-1 rounded text-xs bg-red-100 text-red-800">
            in use
          </span>
        </div>

        {/* Live timer */}
        {timerDisplay && (
          <div className={`text-center p-3 rounded-lg my-3 ${timerColorClass}`}>
            <div className="text-3xl font-mono font-bold">
              {timerDisplay}
            </div>
            <div className="text-xs mt-1 opacity-75">
              {item.timeInfo?.type === 'block'
                ? `${item.timeInfo.blockMinutes || ''} min block`
                : 'Elapsed time'}
            </div>
          </div>
        )}

        {/* Estimated charge based on per-minute rate */}
        {item.price > 0 && item.timeInfo?.minutesElapsed != null && (
          <div className="text-center mb-3">
            <p className="text-sm text-gray-900">Est. charge</p>
            <p className="text-lg font-bold text-green-600">
              {formatCurrency(item.price * (item.timeInfo.minutesElapsed / 60))}
            </p>
          </div>
        )}

        {/* Extend buttons (block time only) */}
        {item.timeInfo?.type === 'block' && (
          <div className="flex gap-1 mb-2">
            {[15, 30, 60].map(min => (
              <Button
                key={min}
                variant="outline"
                size="sm"
                className="flex-1 text-xs"
                onClick={() => onExtendTime(item, min)}
              >
                +{min}m
              </Button>
            ))}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2">
          {item.currentOrder && (
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => onOpenTab(item.currentOrder!.orderId)}
            >
              Open Tab
            </Button>
          )}
          <Button
            size="sm"
            className="flex-1 bg-red-600 hover:bg-red-700 text-white"
            onClick={() => onStopSession(item)}
          >
            Stop Session
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
