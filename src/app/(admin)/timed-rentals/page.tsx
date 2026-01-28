'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { formatCurrency } from '@/lib/utils'
import { AdminNav } from '@/components/admin/AdminNav'

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
}

export default function TimedRentalsPage() {
  const router = useRouter()
  const { employee, isAuthenticated } = useAuthStore()
  const [sessions, setSessions] = useState<TimedSession[]>([])
  const [timedItems, setTimedItems] = useState<TimedItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showStartModal, setShowStartModal] = useState(false)
  const [selectedItem, setSelectedItem] = useState<TimedItem | null>(null)
  const [selectedRateType, setSelectedRateType] = useState('hourly')

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
        // Filter to only timed rental items
        const timed = (data.items || []).filter((i: { itemType: string }) => i.itemType === 'timed_rental')
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
          <Button onClick={() => setShowStartModal(true)}>Start Session</Button>
        </div>

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
