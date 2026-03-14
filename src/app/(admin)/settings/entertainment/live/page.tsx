'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { EntertainmentItemCard } from '@/components/entertainment/EntertainmentItemCard'
import type { EntertainmentItem } from '@/lib/entertainment'
import { getSharedSocket, releaseSharedSocket, getTerminalId } from '@/lib/shared-socket'
import { useAuthStore } from '@/stores/auth-store'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { toast } from '@/stores/toast-store'

const REFRESH_INTERVAL = 30000 // 30s fallback when socket disconnected

export default function EntertainmentLiveStatusPage() {
  const router = useRouter()
  const employee = useAuthStore((s) => s.employee)
  const locationId = employee?.location?.id || ''

  const [items, setItems] = useState<EntertainmentItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [socketConnected, setSocketConnected] = useState(false)
  const socketRef = useRef<any>(null)

  // Fetch entertainment status
  const fetchStatus = useCallback(async () => {
    if (!locationId) return

    try {
      const response = await fetch(`/api/entertainment/status?locationId=${locationId}`, {
        cache: 'no-store',
      })
      if (response.ok) {
        const data = await response.json()
        // Fix clock-skew: shift server timestamps to client-local time
        const clockOffset = data.data.serverTime
          ? new Date(data.data.serverTime).getTime() - Date.now()
          : 0
        const adjustedItems = (data.data.items as EntertainmentItem[]).map((item: EntertainmentItem) => {
          if (!item.timeInfo || clockOffset === 0) return item
          const ti = { ...item.timeInfo }
          if (ti.expiresAt) {
            ti.expiresAt = new Date(new Date(ti.expiresAt).getTime() - clockOffset).toISOString()
          }
          if (ti.startedAt) {
            ti.startedAt = new Date(new Date(ti.startedAt).getTime() - clockOffset).toISOString()
          }
          return { ...item, timeInfo: ti }
        })
        setItems(adjustedItems)
      } else {
        toast.error('Failed to fetch entertainment status')
      }
    } catch (err) {
      console.error('Error fetching entertainment status:', err)
      toast.error('Failed to connect to server')
    } finally {
      setIsLoading(false)
    }
  }, [locationId])

  // Socket.io real-time updates
  useEffect(() => {
    if (!locationId) return

    const socket = getSharedSocket()
    socketRef.current = socket

    const onConnect = () => {
      setSocketConnected(true)
      socket.emit('join_station', {
        locationId,
        tags: ['entertainment'],
        terminalId: getTerminalId(),
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

    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    socket.on('entertainment:status-changed', debouncedFetch)
    socket.on('entertainment:session-update', debouncedFetch)

    if (socket.connected) {
      onConnect()
    }

    return () => {
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
      socket.off('entertainment:status-changed', debouncedFetch)
      socket.off('entertainment:session-update', debouncedFetch)
      if (debouncedFetchTimer.current) clearTimeout(debouncedFetchTimer.current)
      socketRef.current = null
      releaseSharedSocket()
    }
  }, [locationId, fetchStatus])

  // Initial load + fallback polling when socket disconnected
  useEffect(() => {
    if (!locationId) return

    fetchStatus()

    if (!socketConnected) {
      const interval = setInterval(fetchStatus, REFRESH_INTERVAL)
      return () => clearInterval(interval)
    }
  }, [locationId, fetchStatus, socketConnected])

  // Action handlers
  const handleExtendTime = async (itemId: string, minutes: number) => {
    const item = items.find((i) => i.id === itemId)
    if (!item?.currentOrder) return

    const orderItemId = item.currentOrderItemId || item.currentOrder.orderItemId
    if (!orderItemId) {
      toast.error('Could not find order item ID')
      return
    }

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

  const handleSetTime = async (itemId: string, totalMinutes: number) => {
    const item = items.find((i) => i.id === itemId)
    if (!item?.timeInfo?.expiresAt) return

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

    await handleExtendTime(itemId, deltaMinutes)
  }

  const handleStopSession = async (itemId: string) => {
    const item = items.find((i) => i.id === itemId)
    if (!item?.currentOrder) return

    const orderItemId = item.currentOrderItemId || item.currentOrder.orderItemId
    if (!orderItemId) {
      toast.error('Could not find order item ID')
      return
    }

    try {
      const response = await fetch(
        `/api/entertainment/block-time?orderItemId=${orderItemId}&locationId=${locationId}`,
        { method: 'DELETE' }
      )

      if (response.ok) {
        fetchStatus()
      } else {
        const data = await response.json()
        toast.error(data.error || 'Failed to stop session')
      }
    } catch (err) {
      console.error('Error stopping session:', err)
      toast.error('Failed to stop session')
    }
  }

  const handleOpenTab = (orderId: string) => {
    router.push(`/orders?orderId=${orderId}`)
  }

  // Summary stats
  const summary = {
    available: items.filter((i) => i.status === 'available').length,
    inUse: items.filter((i) => i.status === 'in_use').length,
    maintenance: items.filter((i) => i.status === 'maintenance').length,
  }

  return (
    <div className="p-6">
      <AdminPageHeader
        title="Live Status"
        breadcrumbs={[
          { label: 'Settings', href: '/settings' },
          { label: 'Entertainment', href: '/settings/entertainment' },
          { label: 'Live Status', href: '/settings/entertainment/live' },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <span
              className={`inline-block w-2 h-2 rounded-full ${socketConnected ? 'bg-green-400' : 'bg-yellow-400'}`}
              title={socketConnected ? 'Live updates active' : 'Polling fallback'}
            />
            <span className="text-xs text-gray-500">
              {socketConnected ? 'Live' : 'Polling'}
            </span>
          </div>
        }
      />

      {/* Summary stats bar */}
      <div className="flex items-center gap-6 mb-6 p-4 bg-white rounded-lg border">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-green-500" />
          <span className="text-sm font-medium text-gray-700">Available</span>
          <span className="text-lg font-bold text-green-600">{summary.available}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-amber-500" />
          <span className="text-sm font-medium text-gray-700">In Use</span>
          <span className="text-lg font-bold text-amber-600">{summary.inUse}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-gray-400" />
          <span className="text-sm font-medium text-gray-700">Maintenance</span>
          <span className="text-lg font-bold text-gray-500">{summary.maintenance}</span>
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-center">
          <p className="text-gray-500 mb-2">No entertainment items configured</p>
          <Link
            href="/settings/entertainment"
            className="text-blue-600 hover:text-blue-800 text-sm font-medium"
          >
            Go to Item Manager
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {items.map((item) => (
            <EntertainmentItemCard
              key={item.id}
              item={item}
              onOpenTab={handleOpenTab}
              onExtendTime={handleExtendTime}
              onSetTime={handleSetTime}
              onStopSession={handleStopSession}
            />
          ))}
        </div>
      )}
    </div>
  )
}
