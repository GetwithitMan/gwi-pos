'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { getSharedSocket, releaseSharedSocket } from '@/lib/shared-socket'
import { useAuthStore } from '@/stores/auth-store'
import { Button } from '@/components/ui/button'
import { EntertainmentItemCard } from '@/components/entertainment/EntertainmentItemCard'
import { WaitlistPanel } from '@/components/entertainment/WaitlistPanel'
import { AddToWaitlistModal } from '@/components/entertainment/AddToWaitlistModal'
import { SeatFromWaitlistModal } from '@/components/entertainment/SeatFromWaitlistModal'
import type { EntertainmentItem, WaitlistEntry } from '@/lib/entertainment'
import { toast } from '@/stores/toast-store'

const REFRESH_INTERVAL = 30000 // 30s fallback only when socket disconnected

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

export default function EntertainmentKDSPage() {
  const router = useRouter()
  // Use auth store directly — do NOT use useAuthGuard() which redirects to /login.
  // KDS devices authenticate via device token, not employee session.
  const employee = useAuthStore(s => s.employee)

  const [items, setItems] = useState<EntertainmentItem[]>([])
  const [allWaitlist, setAllWaitlist] = useState<WaitlistEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAddWaitlistModal, setShowAddWaitlistModal] = useState(false)
  const [selectedItemForWaitlist, setSelectedItemForWaitlist] = useState<string | undefined>()
  const [showSeatModal, setShowSeatModal] = useState(false)
  const [selectedEntryForSeat, setSelectedEntryForSeat] = useState<WaitlistEntry | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())
  const [socketConnected, setSocketConnected] = useState(false)

  const socketRef = useRef<any>(null)

  // KDS device-token auth — paired KDS devices store config in localStorage
  const [kdsLocationId, setKdsLocationId] = useState<string>('')
  const [kdsScreenName, setKdsScreenName] = useState<string>('')

  useEffect(() => {
    if (employee?.location?.id) return // Employee auth takes precedence
    try {
      const storedConfig = localStorage.getItem('kds_screen_config')
      const storedToken = localStorage.getItem('kds_device_token')
      if (storedConfig && storedToken) {
        const config = JSON.parse(storedConfig)
        if (config.locationId) {
          setKdsLocationId(config.locationId)
          setKdsScreenName(config.name || 'Entertainment')
        }
      }
    } catch {
      // Invalid stored config
    }
  }, [employee?.location?.id])

  // Use employee location or KDS device location
  const locationId = employee?.location?.id || kdsLocationId

  // Fetch entertainment status
  const fetchStatus = useCallback(async () => {
    if (!locationId) return

    try {
      const response = await fetch(`/api/entertainment/status?locationId=${locationId}`, {
        cache: 'no-store',
      })
      if (response.ok) {
        const data = await response.json()
        // Fix clock-skew: compute offset between server time and client time,
        // then shift all timestamps so calculateTimeRemaining() works with local clock.
        const clockOffset = data.data.serverTime
          ? new Date(data.data.serverTime).getTime() - Date.now()
          : 0
        const adjustedItems = (data.data.items as EntertainmentItem[]).map(item => {
          if (!item.timeInfo || clockOffset === 0) return item
          const ti = { ...item.timeInfo }
          // Shift server timestamps into client-local time by subtracting the offset
          if (ti.expiresAt) {
            ti.expiresAt = new Date(new Date(ti.expiresAt).getTime() - clockOffset).toISOString()
          }
          if (ti.startedAt) {
            ti.startedAt = new Date(new Date(ti.startedAt).getTime() - clockOffset).toISOString()
          }
          return { ...item, timeInfo: ti }
        })
        setItems(adjustedItems)
        // Collect all waitlist entries from all items
        // Each item.id is a FloorPlanElement ID; waitlist entries use elementId to reference it
        const waitlistEntries: WaitlistEntry[] = data.data.items.flatMap((item: EntertainmentItem) =>
          item.waitlist.map(w => ({
            ...w,
            // Ensure elementId is set for SeatFromWaitlistModal matching
            elementId: w.elementId || item.id,
            menuItem: { id: item.id, name: item.displayName, status: item.status },
          }))
        )
        setAllWaitlist(waitlistEntries)
        setError(null)
      } else {
        setError('Failed to fetch entertainment status')
      }
    } catch (err) {
      console.error('Error fetching status:', err)
      setError('Failed to connect to server')
    } finally {
      setIsLoading(false)
      setLastRefresh(new Date())
    }
  }, [locationId])

  // Socket.io connection for real-time entertainment updates (shared socket)
  useEffect(() => {
    if (!locationId) return

    const socket = getSharedSocket()
    socketRef.current = socket

    const onConnect = () => {
      setSocketConnected(true)
      socket.emit('join_station', {
        locationId,
        tags: ['entertainment'],
        terminalId: `entertainment-kds-${locationId || 'fallback'}-${Math.random().toString(36).slice(2, 8)}`,
      })
    }

    const onDisconnect = () => {
      setSocketConnected(false)
    }

    const debouncedFetchTimer = { current: null as NodeJS.Timeout | null }
    const debouncedFetch = () => {
      if (debouncedFetchTimer.current) clearTimeout(debouncedFetchTimer.current)
      debouncedFetchTimer.current = setTimeout(() => fetchStatus(), 200)
    }

    const onEntertainmentChanged = () => {
      debouncedFetch()
    }

    const onListChanged = () => {
      debouncedFetch()
    }

    const onWaitlistNotify = (data: { customerName?: string; elementName?: string; message?: string; action?: string }) => {
      if (data.action === 'notified' || data.action === 'added') {
        if (data.action === 'notified') {
          playNotificationSound()
        }
        const msg = data.message || `${data.customerName || 'Customer'} — waitlist update`
        toast.info(msg)
      }
      debouncedFetch()
    }

    // Entertainment session-update: timer started/extended/stopped/warning from cron or API.
    // The status-changed event covers availability transitions, but session-update carries
    // timer lifecycle events (e.g. 'stopped' on expiry, 'warning' near expiry).
    const onSessionUpdate = (data: { action?: string; tableName?: string }) => {
      if (data.action === 'stopped') {
        playNotificationSound()
        toast.warning(`Timer expired: ${data.tableName || 'Entertainment item'}`)
      } else if (data.action === 'warning') {
        toast.info(`Timer warning: ${data.tableName || 'Entertainment item'} expiring soon`)
      }
      debouncedFetch()
    }

    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('entertainment:status-changed', onEntertainmentChanged)
    socket.on('entertainment:session-update', onSessionUpdate)
    socket.on('orders:list-changed', onListChanged)
    socket.on('entertainment:waitlist-notify', onWaitlistNotify)

    if (socket.connected) {
      onConnect()
    }

    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('entertainment:status-changed', onEntertainmentChanged)
      socket.off('entertainment:session-update', onSessionUpdate)
      socket.off('orders:list-changed', onListChanged)
      socket.off('entertainment:waitlist-notify', onWaitlistNotify)
      if (debouncedFetchTimer.current) clearTimeout(debouncedFetchTimer.current)
      socketRef.current = null
      releaseSharedSocket()
    }
  }, [locationId, fetchStatus])

  // Initial load + conditional fallback polling (only when socket disconnected)
  useEffect(() => {
    if (!locationId) return

    // Always fetch on mount
    fetchStatus()

    // Only poll if socket is NOT connected (fallback safety net)
    if (!socketConnected) {
      const interval = setInterval(fetchStatus, REFRESH_INTERVAL)

      const handleVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
          fetchStatus()
        }
      }

      const handleFocus = () => {
        fetchStatus()
      }

      document.addEventListener('visibilitychange', handleVisibilityChange)
      window.addEventListener('focus', handleFocus)

      return () => {
        clearInterval(interval)
        document.removeEventListener('visibilitychange', handleVisibilityChange)
        window.removeEventListener('focus', handleFocus)
      }
    }
  }, [locationId, fetchStatus, socketConnected])

  // Handle opening a tab
  const handleOpenTab = (orderId: string) => {
    // Navigate to orders page with the order selected
    window.location.href = `/orders?orderId=${orderId}`
  }

  // Handle extending time
  const handleExtendTime = async (itemId: string, minutes: number = 30) => {
    const item = items.find(i => i.id === itemId)
    if (!item?.currentOrder) return

    // Get the order item ID from the entertainment item
    // First try from item level, then from currentOrder
    const orderItemId = item.currentOrderItemId || item.currentOrder.orderItemId

    if (!orderItemId) {
      // Fallback: fetch the order to find the entertainment item
      try {
        const orderResponse = await fetch(`/api/orders/${item.currentOrder.orderId}`)
        if (!orderResponse.ok) {
          toast.error('Could not find order details')
          return
        }
        const orderData = await orderResponse.json()
        // Use the actual menuItemId (from status response) to match, not the FloorPlanElement ID
        const actualMenuItemId = item.menuItemId || itemId
        const entertainmentItem = orderData.items?.find(
          (i: { menuItemId: string }) => i.menuItemId === actualMenuItemId
        )
        if (!entertainmentItem?.id) {
          toast.error('Could not find entertainment item in order')
          return
        }
        // Extend using the found order item ID
        const response = await fetch('/api/entertainment/block-time', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderItemId: entertainmentItem.id,
            additionalMinutes: minutes,
            locationId,
          }),
        })

        if (response.ok) {
          fetchStatus()
        } else {
          const data = await response.json()
          toast.error(data.error || 'Failed to extend time')
        }
        return
      } catch (err) {
        console.error('Error extending time:', err)
        toast.error('Failed to extend time')
        return
      }
    }

    // Use the direct orderItemId if available
    try {
      const response = await fetch('/api/entertainment/block-time', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderItemId,
          additionalMinutes: minutes,
          locationId,
        }),
      })

      if (response.ok) {
        fetchStatus()
      } else {
        const data = await response.json()
        toast.error(data.error || 'Failed to extend time')
      }
    } catch (err) {
      console.error('Error extending time:', err)
      toast.error('Failed to extend time')
    }
  }

  // Handle setting an exact time remaining (calculates delta and extends)
  const handleSetTime = async (itemId: string, totalMinutes: number) => {
    const item = items.find(i => i.id === itemId)
    if (!item?.timeInfo?.expiresAt) return

    // Calculate how many minutes to add/subtract to reach the target
    const expiresAt = new Date(item.timeInfo.expiresAt)
    const now = new Date()
    const currentRemainingMs = expiresAt.getTime() - now.getTime()
    const targetMs = totalMinutes * 60 * 1000
    const deltaMs = targetMs - currentRemainingMs
    const deltaMinutes = Math.round(deltaMs / 60000)

    if (deltaMinutes <= 0) {
      toast.warning('Cannot reduce time below current remaining')
      return
    }

    // Use extend with the calculated delta
    await handleExtendTime(itemId, deltaMinutes)
  }

  // Handle stopping a session
  const handleStopSession = async (itemId: string) => {
    if (!confirm('Are you sure you want to stop this session?')) return

    const item = items.find(i => i.id === itemId)
    if (!item) return

    try {
      // Get the order item ID to properly stop the session
      const orderItemId = item.currentOrderItemId || item.currentOrder?.orderItemId

      if (orderItemId) {
        // Stop the block time via the proper endpoint (also updates MenuItem status)
        const response = await fetch(`/api/entertainment/block-time?orderItemId=${orderItemId}&locationId=${locationId}`, {
          method: 'DELETE',
        })

        if (response.ok) {
          await fetchStatus() // Refresh and wait for it
        } else {
          const data = await response.json()
          console.error('Failed to stop block time:', data)
          toast.error(data.error || 'Failed to stop session')
        }
      } else {
        // Fallback: just reset the entertainment item status directly
        // itemId is the FloorPlanElement ID, and the status PATCH expects elementId
        const response = await fetch('/api/entertainment/status', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            elementId: itemId,
            locationId,
            status: 'available',
          }),
        })

        if (response.ok) {
          await fetchStatus() // Refresh and wait for it
        } else {
          const data = await response.json()
          console.error('Failed to update status:', data)
          toast.error(data.error || 'Failed to stop session')
        }
      }
    } catch (err) {
      console.error('Error stopping session:', err)
      toast.error('Failed to stop session')
    }
  }

  // Handle add to waitlist
  const handleAddToWaitlist = (itemId?: string) => {
    if (itemId) {
      setSelectedItemForWaitlist(itemId)
      setShowAddWaitlistModal(true)
    } else if (items.length === 1) {
      // Auto-select if only one item
      setSelectedItemForWaitlist(items[0].id)
      setShowAddWaitlistModal(true)
    } else if (items.length > 1) {
      // Show picker state - set a sentinel so modal renders with picker
      setSelectedItemForWaitlist(undefined)
      setShowAddWaitlistModal(true)
    }
  }

  const handleSubmitWaitlist = async (data: {
    elementId: string
    customerName: string
    phone?: string
    partySize: number
    notes?: string
  }) => {
    const response = await fetch('/api/entertainment/waitlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        locationId,
        ...data,
      }),
    })

    if (!response.ok) {
      const result = await response.json()
      throw new Error(result.error || 'Failed to add to waitlist')
    }

    fetchStatus() // Refresh
  }

  // Handle notify waitlist entry
  const handleNotify = async (entryId: string) => {
    try {
      const response = await fetch(`/api/entertainment/waitlist/${entryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'notified' }),
      })

      if (response.ok) {
        fetchStatus()
      }
    } catch (err) {
      console.error('Error notifying:', err)
    }
  }

  // Handle seat waitlist entry - opens the seat modal
  const handleSeat = (entryId: string) => {
    // Find the waitlist entry
    const entry = allWaitlist.find(w => w.id === entryId)
    if (entry) {
      setSelectedEntryForSeat(entry)
      setShowSeatModal(true)
    }
  }

  // Handle remove waitlist entry
  const handleRemoveFromWaitlist = async (entryId: string) => {
    if (!confirm('Remove from waitlist?')) return

    try {
      const response = await fetch(`/api/entertainment/waitlist/${entryId}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        fetchStatus()
      }
    } catch (err) {
      console.error('Error removing:', err)
    }
  }

  // Group items by category
  const itemsByCategory = items.reduce((acc, item) => {
    const categoryName = item.category?.name || 'Other'
    if (!acc[categoryName]) {
      acc[categoryName] = []
    }
    acc[categoryName].push(item)
    return acc
  }, {} as Record<string, EntertainmentItem[]>)

  // Summary stats
  const summary = {
    total: items.length,
    available: items.filter(i => i.status === 'available').length,
    inUse: items.filter(i => i.status === 'in_use').length,
    waitlistTotal: allWaitlist.filter(w => !w.status || w.status === 'waiting').length,
  }

  // Allow access via employee auth OR KDS device token
  if (!locationId) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-white text-center">
          <h1 className="text-2xl font-bold mb-2">Loading...</h1>
          <p className="text-gray-400">Connecting to Entertainment Center...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <header className="bg-gray-800 border-b border-gray-700 px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Entertainment Center</h1>
            <p className="text-sm text-gray-400 flex items-center gap-2">
              {employee?.location?.name || kdsScreenName} - Last updated: {lastRefresh.toLocaleTimeString()}
              <span
                className={`inline-block w-2 h-2 rounded-full ${socketConnected ? 'bg-green-400' : 'bg-yellow-400'}`}
                title={socketConnected ? 'Live updates' : 'Polling fallback'}
              />
            </p>
          </div>

          {/* Summary stats */}
          <div className="flex items-center gap-6">
            <div className="text-center">
              <div className="text-2xl font-bold text-green-400">{summary.available}</div>
              <div className="text-xs text-gray-400">Available</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-400">{summary.inUse}</div>
              <div className="text-xs text-gray-400">In Use</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-400">{summary.waitlistTotal}</div>
              <div className="text-xs text-gray-400">Waiting</div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={fetchStatus}
              className="text-gray-300 border-gray-600 hover:bg-gray-700"
            >
              Refresh
            </Button>
            <Button
              size="sm"
              onClick={() => handleAddToWaitlist()}
            >
              + Add to Waitlist
            </Button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="p-4">
        {isLoading ? (
          <div className="flex items-center justify-center h-64" aria-busy="true">
            <div className="text-gray-400">Loading...</div>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-64" role="alert">
            <div className="text-red-400">{error}</div>
          </div>
        ) : items.length === 0 ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-center">
              <p className="text-gray-400 mb-2">No entertainment items found</p>
              <p className="text-sm text-gray-500">
                Add items with type &quot;timed_rental&quot; in the menu
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Items grid by category */}
            {Object.entries(itemsByCategory).map(([categoryName, categoryItems]) => (
              <div key={categoryName}>
                <h2 className="text-lg font-semibold text-gray-300 mb-3">
                  {categoryName}
                </h2>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                  {categoryItems.map((item) => (
                    <EntertainmentItemCard
                      key={item.id}
                      item={item}
                      onOpenTab={handleOpenTab}
                      onExtendTime={handleExtendTime}
                      onSetTime={handleSetTime}
                      onStopSession={handleStopSession}
                      onAddToWaitlist={handleAddToWaitlist}
                    />
                  ))}
                </div>
              </div>
            ))}

            {/* Waitlist panel at bottom */}
            {allWaitlist.length > 0 && (
              <div className="mt-8">
                <WaitlistPanel
                  waitlist={allWaitlist}
                  locationId={locationId}
                  onNotify={handleNotify}
                  onSeat={handleSeat}
                  onRemove={handleRemoveFromWaitlist}
                  onAddNew={() => handleAddToWaitlist()}
                  onRefresh={fetchStatus}
                />
              </div>
            )}
          </div>
        )}
      </main>

      {/* Add to Waitlist Modal - Item Picker when no item pre-selected */}
      {showAddWaitlistModal && !selectedItemForWaitlist && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowAddWaitlistModal(false)} />
          <div className="relative bg-white rounded-lg shadow-xl w-full max-w-sm mx-4 p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Select an Item</h2>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setSelectedItemForWaitlist(item.id)}
                  className="w-full text-left px-4 py-3 rounded-lg border-2 border-gray-200 hover:border-amber-400 hover:bg-amber-50 transition-colors font-medium text-gray-900"
                >
                  {item.displayName}
                  <span className={`ml-2 text-xs font-semibold ${item.status === 'available' ? 'text-green-600' : item.status === 'in_use' ? 'text-red-600' : 'text-gray-500'}`}>
                    ({item.status === 'in_use' ? 'In Use' : item.status === 'available' ? 'Available' : item.status})
                  </span>
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowAddWaitlistModal(false)}
              className="mt-4 w-full px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 font-medium"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Add to Waitlist Modal */}
      {showAddWaitlistModal && selectedItemForWaitlist && (
        <AddToWaitlistModal
          isOpen={showAddWaitlistModal}
          onClose={() => {
            setShowAddWaitlistModal(false)
            setSelectedItemForWaitlist(undefined)
          }}
          locationId={locationId}
          employeeId={employee?.id}
          elementId={selectedItemForWaitlist}
          menuItemName={items.find(i => i.id === selectedItemForWaitlist)?.displayName || 'Entertainment Item'}
          onSuccess={() => {
            // Refresh data after adding to waitlist
            fetchStatus()
          }}
        />
      )}

      {/* Seat from Waitlist Modal */}
      <SeatFromWaitlistModal
        isOpen={showSeatModal}
        onClose={() => {
          setShowSeatModal(false)
          setSelectedEntryForSeat(null)
        }}
        entry={selectedEntryForSeat}
        entertainmentItems={items}
        locationId={locationId}
        employeeId={employee?.id}
        onSuccess={() => {
          fetchStatus()
        }}
      />
    </div>
  )
}
