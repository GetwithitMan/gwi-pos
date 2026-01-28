'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/stores/auth-store'
import { Button } from '@/components/ui/button'
import { EntertainmentItemCard } from '@/components/entertainment/EntertainmentItemCard'
import { WaitlistPanel } from '@/components/entertainment/WaitlistPanel'
import { AddToWaitlistModal } from '@/components/entertainment/AddToWaitlistModal'
import { SeatFromWaitlistModal } from '@/components/entertainment/SeatFromWaitlistModal'
import type { EntertainmentItem, WaitlistEntry } from '@/lib/entertainment'

const REFRESH_INTERVAL = 5000 // 5 seconds

export default function EntertainmentKDSPage() {
  const router = useRouter()
  const { employee, isAuthenticated } = useAuthStore()

  const [items, setItems] = useState<EntertainmentItem[]>([])
  const [allWaitlist, setAllWaitlist] = useState<WaitlistEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showAddWaitlistModal, setShowAddWaitlistModal] = useState(false)
  const [selectedItemForWaitlist, setSelectedItemForWaitlist] = useState<string | undefined>()
  const [showSeatModal, setShowSeatModal] = useState(false)
  const [selectedEntryForSeat, setSelectedEntryForSeat] = useState<WaitlistEntry | null>(null)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())

  // Get location ID from employee context
  const locationId = employee?.location?.id || ''

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login?redirect=/entertainment')
    }
  }, [isAuthenticated, router])

  // Fetch entertainment status
  const fetchStatus = useCallback(async () => {
    if (!locationId) return

    try {
      const response = await fetch(`/api/entertainment/status?locationId=${locationId}`)
      if (response.ok) {
        const data = await response.json()
        setItems(data.items)
        // Collect all waitlist entries from all items
        const waitlistEntries: WaitlistEntry[] = data.items.flatMap((item: EntertainmentItem) =>
          item.waitlist.map(w => ({
            ...w,
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

  // Initial load and polling
  useEffect(() => {
    if (locationId) {
      fetchStatus()
      const interval = setInterval(fetchStatus, REFRESH_INTERVAL)
      return () => clearInterval(interval)
    }
  }, [locationId, fetchStatus])

  // Handle opening a tab
  const handleOpenTab = (orderId: string) => {
    // Navigate to orders page with the order selected
    window.location.href = `/orders?orderId=${orderId}`
  }

  // Handle extending time
  const handleExtendTime = async (itemId: string) => {
    const item = items.find(i => i.id === itemId)
    if (!item?.currentOrder) return

    // Find the order item ID - we'll need to extend the block time
    try {
      const response = await fetch('/api/entertainment/block-time', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderItemId: item.currentOrder.orderId, // This should be the orderItemId
          additionalMinutes: 30, // Default extend by 30 minutes
        }),
      })

      if (response.ok) {
        fetchStatus() // Refresh
      } else {
        const data = await response.json()
        alert(data.error || 'Failed to extend time')
      }
    } catch (err) {
      console.error('Error extending time:', err)
      alert('Failed to extend time')
    }
  }

  // Handle stopping a session
  const handleStopSession = async (itemId: string) => {
    if (!confirm('Are you sure you want to stop this session?')) return

    try {
      // Reset the entertainment item status
      const response = await fetch('/api/entertainment/status', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          menuItemId: itemId,
          status: 'available',
        }),
      })

      if (response.ok) {
        fetchStatus() // Refresh
      } else {
        const data = await response.json()
        alert(data.error || 'Failed to stop session')
      }
    } catch (err) {
      console.error('Error stopping session:', err)
      alert('Failed to stop session')
    }
  }

  // Handle add to waitlist
  const handleAddToWaitlist = (itemId?: string) => {
    setSelectedItemForWaitlist(itemId)
    setShowAddWaitlistModal(true)
  }

  const handleSubmitWaitlist = async (data: {
    menuItemId: string
    customerName: string
    phoneNumber?: string
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

  if (!locationId) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-white text-center">
          <h1 className="text-2xl font-bold mb-2">Loading...</h1>
          <p className="text-gray-400">Please log in to access the Entertainment Center</p>
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
            <p className="text-sm text-gray-400">
              {employee?.location?.name} - Last updated: {lastRefresh.toLocaleTimeString()}
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
          <div className="flex items-center justify-center h-64">
            <div className="text-gray-400">Loading...</div>
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-64">
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
                  onNotify={handleNotify}
                  onSeat={handleSeat}
                  onRemove={handleRemoveFromWaitlist}
                  onAddNew={() => handleAddToWaitlist()}
                />
              </div>
            )}
          </div>
        )}
      </main>

      {/* Add to Waitlist Modal */}
      {selectedItemForWaitlist && (
        <AddToWaitlistModal
          isOpen={showAddWaitlistModal}
          onClose={() => {
            setShowAddWaitlistModal(false)
            setSelectedItemForWaitlist(undefined)
          }}
          locationId={locationId}
          employeeId={employee?.id}
          menuItemId={selectedItemForWaitlist}
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
