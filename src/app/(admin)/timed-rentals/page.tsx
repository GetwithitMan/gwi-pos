'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { formatCurrency } from '@/lib/utils'
import { AdminNav } from '@/components/admin/AdminNav'
import type { EntertainmentVisualType } from '@/components/floor-plan/entertainment-visuals'

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
  blockTimeMinutes: number
  per15Min: number
  per30Min: number
  perHour: number
  minimumMinutes: number
  gracePeriodMinutes: number
  status: 'available' | 'maintenance'
}

export default function TimedRentalsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const itemIdFromUrl = searchParams.get('item')

  const { employee, isAuthenticated } = useAuthStore()
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
    blockTimeMinutes: 60,
    per15Min: 0,
    per30Min: 0,
    perHour: 15,
    minimumMinutes: 30,
    gracePeriodMinutes: 5,
    status: 'available'
  })
  const [isSaving, setIsSaving] = useState(false)

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login?redirect=/timed-rentals')
      return
    }
    loadData()

    // Refresh every 30 seconds for live timer updates
    const interval = setInterval(loadData, 30000)
    return () => clearInterval(interval)
  }, [isAuthenticated, router])

  // Handle URL parameter for item builder
  useEffect(() => {
    if (!itemIdFromUrl || timedItems.length === 0) return

    if (itemIdFromUrl === 'new') {
      // Create new item
      setBuilderForm({
        name: '',
        visualType: 'pool_table',
        blockTimeMinutes: 60,
        per15Min: 0,
        per30Min: 0,
        perHour: 15,
        minimumMinutes: 30,
        gracePeriodMinutes: 5,
        status: 'available'
      })
      setShowBuilder(true)
    } else {
      // Load existing item
      const item = timedItems.find(i => i.id === itemIdFromUrl)
      if (item) {
        setBuilderForm({
          name: item.name,
          visualType: item.visualType || 'pool_table',
          blockTimeMinutes: item.blockTimeMinutes || 60,
          per15Min: item.timedPricing?.per15Min || 0,
          per30Min: item.timedPricing?.per30Min || 0,
          perHour: item.timedPricing?.perHour || item.price || 15,
          minimumMinutes: item.minimumMinutes || 30,
          gracePeriodMinutes: item.gracePeriodMinutes || 5,
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
      alert('Please enter an item name')
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
        price: builderForm.perHour, // Base price = hourly rate
        timedPricing: {
          per15Min: builderForm.per15Min,
          per30Min: builderForm.per30Min,
          perHour: builderForm.perHour,
        },
        blockTimeMinutes: builderForm.blockTimeMinutes,
        minimumMinutes: builderForm.minimumMinutes,
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
        alert(`Failed to save: ${error.error || 'Unknown error'}`)
      }
    } catch (error) {
      console.error('Failed to save item:', error)
      alert('Failed to save item')
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

  if (!isAuthenticated) return null

  return (
    <div className="min-h-screen bg-gray-100">
      <AdminNav />

      <div className="lg:ml-64 p-6">
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
      </div>

      {/* Entertainment Builder Modal */}
      {showBuilder && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <Card className="w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <CardHeader>
              <CardTitle>
                {itemIdFromUrl === 'new' ? 'Create Entertainment Item' : 'Edit Entertainment Item'}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {/* Item Name */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Item Name</label>
                  <input
                    type="text"
                    value={builderForm.name}
                    onChange={(e) => setBuilderForm({ ...builderForm, name: e.target.value })}
                    className="w-full border rounded px-3 py-2"
                    placeholder="Pool Table 1"
                  />
                </div>

                {/* Visual Type Selector */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Visual Type</label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { value: 'pool_table', label: 'Pool Table' },
                      { value: 'dartboard', label: 'Dartboard' },
                      { value: 'arcade', label: 'Arcade' },
                      { value: 'foosball', label: 'Foosball' },
                      { value: 'shuffleboard', label: 'Shuffleboard' },
                      { value: 'ping_pong', label: 'Ping Pong' },
                      { value: 'bowling_lane', label: 'Bowling Lane' },
                      { value: 'karaoke_stage', label: 'Karaoke' },
                      { value: 'dj_booth', label: 'DJ Booth' },
                      { value: 'photo_booth', label: 'Photo Booth' },
                      { value: 'vr_station', label: 'VR Station' },
                      { value: 'game_table', label: 'Game Table' },
                    ].map(type => (
                      <button
                        key={type.value}
                        onClick={() => setBuilderForm({ ...builderForm, visualType: type.value as EntertainmentVisualType })}
                        className={`p-3 border rounded-lg text-sm ${
                          builderForm.visualType === type.value
                            ? 'border-blue-500 bg-blue-50 text-blue-700'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        {type.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Block Time Presets */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Block Time (Default Duration)</label>
                  <div className="flex gap-2">
                    {[30, 60, 90].map(minutes => (
                      <button
                        key={minutes}
                        onClick={() => setBuilderForm({ ...builderForm, blockTimeMinutes: minutes })}
                        className={`flex-1 px-4 py-2 border rounded-lg ${
                          builderForm.blockTimeMinutes === minutes
                            ? 'border-blue-500 bg-blue-50 text-blue-700'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        {minutes} min
                      </button>
                    ))}
                    <input
                      type="number"
                      value={builderForm.blockTimeMinutes}
                      onChange={(e) => setBuilderForm({ ...builderForm, blockTimeMinutes: parseInt(e.target.value) || 0 })}
                      className="w-24 border rounded px-3 py-2"
                      placeholder="Custom"
                    />
                  </div>
                </div>

                {/* Pricing */}
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Per 15 Min</label>
                    <input
                      type="number"
                      step="0.01"
                      value={builderForm.per15Min}
                      onChange={(e) => setBuilderForm({ ...builderForm, per15Min: parseFloat(e.target.value) || 0 })}
                      className="w-full border rounded px-3 py-2"
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Per 30 Min</label>
                    <input
                      type="number"
                      step="0.01"
                      value={builderForm.per30Min}
                      onChange={(e) => setBuilderForm({ ...builderForm, per30Min: parseFloat(e.target.value) || 0 })}
                      className="w-full border rounded px-3 py-2"
                      placeholder="0.00"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Per Hour</label>
                    <input
                      type="number"
                      step="0.01"
                      value={builderForm.perHour}
                      onChange={(e) => setBuilderForm({ ...builderForm, perHour: parseFloat(e.target.value) || 0 })}
                      className="w-full border rounded px-3 py-2"
                      placeholder="0.00"
                    />
                  </div>
                </div>

                {/* Minimum Minutes */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Minimum Minutes</label>
                  <select
                    value={builderForm.minimumMinutes}
                    onChange={(e) => setBuilderForm({ ...builderForm, minimumMinutes: parseInt(e.target.value) })}
                    className="w-full border rounded px-3 py-2"
                  >
                    <option value={0}>No Minimum</option>
                    <option value={15}>15 minutes</option>
                    <option value={30}>30 minutes</option>
                    <option value={45}>45 minutes</option>
                    <option value={60}>60 minutes</option>
                  </select>
                </div>

                {/* Grace Period */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Grace Period (Minutes)</label>
                  <input
                    type="number"
                    value={builderForm.gracePeriodMinutes}
                    onChange={(e) => setBuilderForm({ ...builderForm, gracePeriodMinutes: parseInt(e.target.value) || 0 })}
                    className="w-full border rounded px-3 py-2"
                    placeholder="5"
                  />
                  <p className="text-xs text-gray-500 mt-1">Extra time before charging next block</p>
                </div>

                {/* Status Toggle */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">Status</label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setBuilderForm({ ...builderForm, status: 'available' })}
                      className={`flex-1 px-4 py-2 border rounded-lg ${
                        builderForm.status === 'available'
                          ? 'border-green-500 bg-green-50 text-green-700'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      Available
                    </button>
                    <button
                      onClick={() => setBuilderForm({ ...builderForm, status: 'maintenance' })}
                      className={`flex-1 px-4 py-2 border rounded-lg ${
                        builderForm.status === 'maintenance'
                          ? 'border-red-500 bg-red-50 text-red-700'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      Maintenance
                    </button>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-2 pt-4">
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
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Start Session Modal */}
      {showStartModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>Start Timed Session</CardTitle>
            </CardHeader>
            <CardContent>
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
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
