'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { formatCurrency } from '@/lib/utils'
import { toast } from '@/stores/toast-store'
import { Modal } from '@/components/ui/modal'
import { useEvents } from '@/lib/events/use-events'

import type { EntertainmentVisualType } from '@/components/floor-plan/entertainment-visuals'
import {
  getPricingSummary,
  DEFAULT_PRICING,
  DEFAULT_PREPAID_PACKAGES,
  getPackageSavings,
  type PrepaidPackage,
  type HappyHourConfig,
} from '@/lib/entertainment-pricing'

interface TimedSession {
  id: string
  tableId?: string
  tableName?: string
  menuItemId: string
  menuItemName?: string
  orderId?: string
  startedAt: string
  endedAt?: string
  pausedAt?: string
  pausedMinutes: number
  elapsedMinutes: number
  totalMinutes?: number
  totalCharge?: number
  rateType: string
  rateAmount: number
  status: string
  notes?: string
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

interface ItemBuilderForm {
  name: string
  visualType: EntertainmentVisualType
  ratePerMinute: number
  gracePeriodMinutes: number
  // Prepaid packages
  prepaidPackages: PrepaidPackage[]
  // Happy hour
  happyHourEnabled: boolean
  happyHourPrice: number | null  // Simple HH price instead of full config
  // Status
  status: 'available' | 'maintenance'
}

export default function TimedRentalsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-950" />}>
      <TimedRentalsContent />
    </Suspense>
  )
}

function TimedRentalsContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const itemIdFromUrl = searchParams.get('item')

  const employee = useAuthStore(s => s.employee)
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)
  const locationId = employee?.location?.id
  const { isConnected, subscribe } = useEvents({ locationId })
  const [sessions, setSessions] = useState<TimedSession[]>([])
  const [timedItems, setTimedItems] = useState<TimedItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showStartModal, setShowStartModal] = useState(false)
  const [selectedItem, setSelectedItem] = useState<TimedItem | null>(null)
  const [selectedRateType, setSelectedRateType] = useState('hourly')

  // Builder state
  const [showBuilder, setShowBuilder] = useState(false)
  const [builderForm, setBuilderForm] = useState<ItemBuilderForm>({
    name: '',
    visualType: 'pool_table',
    ratePerMinute: DEFAULT_PRICING.ratePerMinute,
    gracePeriodMinutes: DEFAULT_PRICING.graceMinutes,
    prepaidPackages: DEFAULT_PREPAID_PACKAGES,
    happyHourEnabled: false,
    happyHourPrice: null,
    status: 'available'
  })
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login?redirect=/timed-rentals')
      return
    }
    loadData()
  }, [isAuthenticated, router])

  // Socket-driven updates for entertainment status changes
  useEffect(() => {
    if (!isConnected) return
    const unsub = subscribe('entertainment:session-update', () => {
      loadData()
    })
    return unsub
  }, [isConnected, subscribe])

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
        gracePeriodMinutes: DEFAULT_PRICING.graceMinutes,
        prepaidPackages: DEFAULT_PREPAID_PACKAGES,
        happyHourEnabled: false,
        happyHourPrice: null,
        status: 'available'
      })
      setShowBuilder(true)
    } else {
      // Load existing item
      const item = timedItems.find(i => i.id === itemIdFromUrl)
      if (item) {
        // Try to extract per-minute rate from existing pricing
        const perHour = item.timedPricing?.perHour || item.price || 15
        const ratePerMinute = perHour / 60

        setBuilderForm({
          name: item.name,
          visualType: item.visualType || 'pool_table',
          ratePerMinute,
          gracePeriodMinutes: item.gracePeriodMinutes || DEFAULT_PRICING.graceMinutes,
          prepaidPackages: (item.timedPricing as any)?.prepaidPackages || DEFAULT_PREPAID_PACKAGES,
          happyHourEnabled: (item.timedPricing as any)?.happyHour?.enabled || false,
          happyHourPrice: (item.timedPricing as any)?.happyHour?.price || null,
          status: item.entertainmentStatus || 'available'
        })
        setShowBuilder(true)
      }
    }
  }, [itemIdFromUrl, timedItems])

  const loadData = async () => {
    if (!employee?.location?.id) return

    try {
      const [sessionsRes, menuRes] = await Promise.all([
        fetch(`/api/timed-sessions?locationId=${employee.location.id}`),
        fetch(`/api/menu?locationId=${employee.location.id}`),
      ])

      if (sessionsRes.ok) {
        const data = await sessionsRes.json()
        setSessions(data.sessions || [])
      }

      if (menuRes.ok) {
        const data = await menuRes.json()
        // Filter to entertainment items - either by itemType OR categoryType
        const timed = (data.items || []).filter((i: { itemType: string; categoryType?: string }) =>
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

  const handleStartSession = async () => {
    if (!employee?.location?.id || !selectedItem) return

    try {
      const res = await fetch('/api/timed-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId: employee.location.id,
          menuItemId: selectedItem.id,
          rateType: selectedRateType,
          startedById: employee.id,
        }),
      })

      if (res.ok) {
        setShowStartModal(false)
        setSelectedItem(null)
        loadData()
      }
    } catch (error) {
      console.error('Failed to start session:', error)
    }
  }

  const handleSessionAction = async (sessionId: string, action: string) => {
    try {
      const res = await fetch(`/api/timed-sessions/${sessionId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          endedById: employee?.id,
        }),
      })

      if (res.ok) {
        loadData()
      }
    } catch (error) {
      console.error('Failed to update session:', error)
    }
  }

  const handleSaveItem = async () => {
    if (!employee?.location?.id) return
    if (!builderForm.name.trim()) {
      toast.warning('Please enter an item name')
      return
    }

    setIsSaving(true)
    try {
      const isNewItem = itemIdFromUrl === 'new'
      const url = isNewItem
        ? '/api/menu/items'
        : `/api/menu/items/${itemIdFromUrl}`

      const body = {
        locationId: employee.location.id,
        name: builderForm.name,
        itemType: 'timed_rental',
        price: builderForm.ratePerMinute * 60, // Base price = hourly rate
        timedPricing: {
          ratePerMinute: builderForm.ratePerMinute,
          prepaidPackages: builderForm.prepaidPackages,
          happyHour: builderForm.happyHourEnabled ? {
            enabled: true,
            price: builderForm.happyHourPrice,
          } : null,
          // Keep legacy fields for backward compatibility
          per15Min: builderForm.ratePerMinute * 15,
          per30Min: builderForm.ratePerMinute * 30,
          perHour: builderForm.ratePerMinute * 60,
        },
        gracePeriodMinutes: builderForm.gracePeriodMinutes,
        entertainmentStatus: builderForm.status,
        visualType: builderForm.visualType,
        // Ensure it's in entertainment category
        categoryId: null, // Will need to set entertainment category
      }

      const res = await fetch(url, {
        method: isNewItem ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (res.ok) {
        setShowBuilder(false)
        router.push('/timed-rentals')
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

  const formatDuration = (minutes: number) => {
    const hours = Math.floor(minutes / 60)
    const mins = minutes % 60
    if (hours > 0) {
      return `${hours}h ${mins}m`
    }
    return `${mins}m`
  }

  const calculateCurrentCharge = (session: TimedSession) => {
    const minutes = session.elapsedMinutes
    switch (session.rateType) {
      case 'per15Min':
        return Math.ceil(minutes / 15) * session.rateAmount
      case 'per30Min':
        return Math.ceil(minutes / 30) * session.rateAmount
      case 'hourly':
      default:
        return Math.ceil(minutes / 60) * session.rateAmount
    }
  }

  const activeSessions = sessions.filter(s => s.status === 'active' || s.status === 'paused')
  const completedSessions = sessions.filter(s => s.status === 'completed')

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

  if (!isAuthenticated) return null

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
              onClick={() => router.push('/timed-rentals?item=new')}
            >
              Create New Item
            </Button>
            <Button onClick={() => setShowStartModal(true)}>Start Session</Button>
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
              <p className="text-gray-500">Loading...</p>
            ) : timedItems.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-gray-500 mb-4">No entertainment items configured yet.</p>
                <Button onClick={() => router.push('/timed-rentals?item=new')}>
                  Create Your First Entertainment Item
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {timedItems.map(item => (
                  <button
                    key={item.id}
                    onClick={() => router.push(`/timed-rentals?item=${item.id}`)}
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
                        <div className="text-sm text-gray-500">
                          {formatCurrency(item.timedPricing?.perHour || item.price)}/hr
                        </div>
                      </div>
                    </div>
                    {item.blockTimeMinutes && (
                      <div className="text-xs text-gray-400">
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

        {/* Active Sessions */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Active Sessions ({activeSessions.length})</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-gray-500">Loading...</p>
            ) : activeSessions.length === 0 ? (
              <p className="text-gray-500">No active sessions</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {activeSessions.map(session => (
                  <Card key={session.id} className={session.status === 'paused' ? 'border-yellow-500' : 'border-green-500'}>
                    <CardContent className="p-4">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <h3 className="font-bold">{session.menuItemName || 'Unknown Item'}</h3>
                          {session.tableName && (
                            <p className="text-sm text-gray-500">{session.tableName}</p>
                          )}
                        </div>
                        <span className={`px-2 py-1 rounded text-xs ${
                          session.status === 'paused' ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800'
                        }`}>
                          {session.status}
                        </span>
                      </div>

                      <div className="text-3xl font-mono font-bold text-center my-4">
                        {formatDuration(session.elapsedMinutes)}
                      </div>

                      <div className="text-center mb-4">
                        <p className="text-sm text-gray-500">Current Charge</p>
                        <p className="text-xl font-bold text-green-600">
                          {formatCurrency(calculateCurrentCharge(session))}
                        </p>
                        <p className="text-xs text-gray-400">
                          {formatCurrency(session.rateAmount)} / {session.rateType.replace('per', '').replace('Min', ' min')}
                        </p>
                      </div>

                      <div className="flex gap-2">
                        {session.status === 'active' ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex-1"
                            onClick={() => handleSessionAction(session.id, 'pause')}
                          >
                            Pause
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex-1"
                            onClick={() => handleSessionAction(session.id, 'resume')}
                          >
                            Resume
                          </Button>
                        )}
                        <Button
                          size="sm"
                          className="flex-1"
                          onClick={() => handleSessionAction(session.id, 'stop')}
                        >
                          Stop & Bill
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Completed Sessions */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Sessions</CardTitle>
          </CardHeader>
          <CardContent>
            {completedSessions.length === 0 ? (
              <p className="text-gray-500">No completed sessions</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="text-left p-3 text-sm font-medium text-gray-600">Item</th>
                      <th className="text-left p-3 text-sm font-medium text-gray-600">Table</th>
                      <th className="text-left p-3 text-sm font-medium text-gray-600">Started</th>
                      <th className="text-right p-3 text-sm font-medium text-gray-600">Duration</th>
                      <th className="text-right p-3 text-sm font-medium text-gray-600">Charge</th>
                      <th className="text-left p-3 text-sm font-medium text-gray-600">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {completedSessions.slice(0, 20).map(session => (
                      <tr key={session.id}>
                        <td className="p-3">{session.menuItemName}</td>
                        <td className="p-3">{session.tableName || '-'}</td>
                        <td className="p-3 text-sm text-gray-500">
                          {new Date(session.startedAt).toLocaleString()}
                        </td>
                        <td className="p-3 text-right">
                          {session.totalMinutes ? formatDuration(session.totalMinutes) : '-'}
                        </td>
                        <td className="p-3 text-right font-medium">
                          {session.totalCharge ? formatCurrency(session.totalCharge) : '-'}
                        </td>
                        <td className="p-3">
                          <span className="px-2 py-1 rounded text-xs bg-gray-100 text-gray-800">
                            {session.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

      {/* Entertainment Builder Modal */}
      <Modal
        isOpen={showBuilder}
        onClose={() => {
          setShowBuilder(false)
          router.push('/timed-rentals')
        }}
        title={itemIdFromUrl === 'new' ? 'Create Entertainment Item' : 'Edit Entertainment Item'}
        size="2xl"
      >
            <div className="space-y-4">
              {/* Name + Visual Type Row */}
              <div className="flex gap-4 items-end">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
                  <input
                    type="text"
                    value={builderForm.name}
                    onChange={(e) => setBuilderForm({ ...builderForm, name: e.target.value })}
                    className="w-full border rounded px-3 py-2"
                    placeholder="Pool Table 1"
                  />
                </div>
                <div className="w-48">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Visual</label>
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
                <div className="text-sm font-medium text-gray-700 mb-2">Pricing</div>

                {/* Rate + Grace inline */}
                <div className="flex items-center gap-4 mb-2">
                  <div className="flex items-center gap-1">
                    <span className="text-gray-500">$</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={builderForm.ratePerMinute}
                      onChange={e => setBuilderForm({...builderForm, ratePerMinute: parseFloat(e.target.value) || 0.25})}
                      className="w-16 px-2 py-1 border rounded text-right text-sm"
                    />
                    <span className="text-gray-500 text-sm">/min</span>
                    <span className="text-gray-400 text-sm ml-1">(${(builderForm.ratePerMinute * 60).toFixed(2)}/hr)</span>
                  </div>
                  <div className="flex items-center gap-1 ml-auto">
                    <span className="text-gray-500 text-sm">Grace:</span>
                    <input
                      type="number"
                      min="0"
                      max="15"
                      value={builderForm.gracePeriodMinutes}
                      onChange={e => setBuilderForm({...builderForm, gracePeriodMinutes: parseInt(e.target.value) || 0})}
                      className="w-12 px-2 py-1 border rounded text-right text-sm"
                    />
                    <span className="text-gray-500 text-sm">min</span>
                  </div>
                </div>

                {/* Happy Hour checkbox + price */}
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={builderForm.happyHourEnabled}
                    onChange={e => setBuilderForm({...builderForm, happyHourEnabled: e.target.checked})}
                    className="rounded"
                  />
                  <span className="text-amber-700">Happy Hour:</span>
                  {builderForm.happyHourEnabled && (
                    <>
                      <span className="text-gray-500">$</span>
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        value={builderForm.happyHourPrice || builderForm.ratePerMinute * 0.5}
                        onChange={e => setBuilderForm({...builderForm, happyHourPrice: parseFloat(e.target.value) || 0})}
                        className="w-16 px-2 py-1 border rounded text-right text-sm"
                      />
                      <span className="text-gray-500 text-sm">/min</span>
                      <span className="text-amber-600 text-sm ml-1">(${((builderForm.happyHourPrice || builderForm.ratePerMinute * 0.5) * 60).toFixed(2)}/hr)</span>
                    </>
                  )}
                </label>
              </div>

              {/* Prepaid Packages */}
              <div className="border-t pt-3 mt-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">Prepaid Packages</span>
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
                        <span className="text-gray-500">min = $</span>
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
                <span className="text-sm font-medium text-gray-700">Status:</span>
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
                  router.push('/timed-rentals')
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

      {/* Start Session Modal */}
      <Modal
        isOpen={showStartModal}
        onClose={() => {
          setShowStartModal(false)
          setSelectedItem(null)
        }}
        title="Start Timed Session"
        size="md"
      >
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-gray-600 mb-1">Select Item</label>
                  {timedItems.length === 0 ? (
                    <p className="text-sm text-gray-500">
                      No timed rental items configured. Add items with type "timed_rental" in the menu.
                    </p>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      {timedItems.map(item => (
                        <button
                          key={item.id}
                          onClick={() => setSelectedItem(item)}
                          className={`p-3 border rounded-lg text-left ${
                            selectedItem?.id === item.id
                              ? 'border-blue-500 bg-blue-50'
                              : 'border-gray-200 hover:border-gray-300'
                          }`}
                        >
                          <div className="font-medium">{item.name}</div>
                          <div className="text-sm text-gray-500">
                            {formatCurrency(item.price)}/hr
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {selectedItem && (
                  <div>
                    <label className="block text-sm text-gray-600 mb-1">Rate Type</label>
                    <select
                      value={selectedRateType}
                      onChange={(e) => setSelectedRateType(e.target.value)}
                      className="w-full border rounded px-3 py-2"
                    >
                      <option value="hourly">Per Hour</option>
                      <option value="per30Min">Per 30 Minutes</option>
                      <option value="per15Min">Per 15 Minutes</option>
                    </select>
                  </div>
                )}

                <div className="flex gap-2 pt-4">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowStartModal(false)
                      setSelectedItem(null)
                    }}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleStartSession}
                    disabled={!selectedItem}
                    className="flex-1"
                  >
                    Start Timer
                  </Button>
                </div>
              </div>
      </Modal>
    </div>
  )
}
