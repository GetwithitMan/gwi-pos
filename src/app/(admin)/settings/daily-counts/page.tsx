'use client'

import { useEffect, useState, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { toast } from '@/stores/toast-store'

interface TrayConfig {
  id: string
  name: string
  capacity: number
  description?: string | null
  sortOrder: number
  isActive: boolean
}

interface PrepItem {
  id: string
  name: string
  outputUnit: string
  preparationType: string | null
  yieldPercent: number | null
  batchYield: number
  costPerUnit: number | null
  currentPrepStock: number
  isDailyCountItem: boolean
  trayConfigs: TrayConfig[]
  parentIngredient?: {
    id: string
    name: string
    inventoryItem?: {
      id: string
      name: string
      costPerUnit: number
    } | null
  } | null
}

export default function DailyCountsSettingsPage() {
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/settings/daily-counts' })
  const employee = useAuthStore(s => s.employee)
  const [prepItems, setPrepItems] = useState<PrepItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [confirmAction, setConfirmAction] = useState<{ action: () => void; title: string; message: string } | null>(null)
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null)

  // New tray form state
  const [newTray, setNewTray] = useState({ name: '', capacity: '' })
  const [addingTrayFor, setAddingTrayFor] = useState<string | null>(null)

  const locationId = employee?.location?.id

  const loadPrepItems = useCallback(async () => {
    if (!locationId) {
      setIsLoading(false)
      return
    }

    try {
      setIsLoading(true)
      const response = await fetch(`/api/inventory/prep-tray-configs?locationId=${locationId}`)
      if (response.ok) {
        const data = await response.json()
        setPrepItems(data.data || [])
      }
    } catch (error) {
      console.error('Failed to load prep items:', error)
      toast.error('Failed to load prep items')
    } finally {
      setIsLoading(false)
    }
  }, [locationId])

  useEffect(() => {
    loadPrepItems()
  }, [loadPrepItems])

  const handleToggleDailyCount = async (item: PrepItem) => {
    try {
      const response = await fetch('/api/inventory/prep-tray-configs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ingredientId: item.id,
          isDailyCountItem: !item.isDailyCountItem,
        }),
      })

      if (response.ok) {
        setPrepItems(items =>
          items.map(i =>
            i.id === item.id ? { ...i, isDailyCountItem: !i.isDailyCountItem } : i
          )
        )
        toast.success(
          item.isDailyCountItem
            ? `${item.name} removed from daily counts`
            : `${item.name} added to daily counts`
        )
      } else {
        toast.error('Failed to update item')
      }
    } catch (error) {
      console.error('Failed to toggle daily count:', error)
      toast.error('Failed to update item')
    }
  }

  const handleAddTray = async (prepItemId: string) => {
    if (!newTray.name || !newTray.capacity) {
      toast.error('Please enter name and capacity')
      return
    }

    try {
      const response = await fetch('/api/inventory/prep-tray-configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          prepItemId,
          name: newTray.name,
          capacity: parseFloat(newTray.capacity),
        }),
      })

      if (response.ok) {
        const data = await response.json()
        setPrepItems(items =>
          items.map(i =>
            i.id === prepItemId
              ? { ...i, trayConfigs: [...i.trayConfigs, data.data] }
              : i
          )
        )
        setNewTray({ name: '', capacity: '' })
        setAddingTrayFor(null)
        toast.success('Tray configuration added')
      } else {
        const errorData = await response.json()
        toast.error(errorData.error || 'Failed to add tray')
      }
    } catch (error) {
      console.error('Failed to add tray:', error)
      toast.error('Failed to add tray')
    }
  }

  const handleDeleteTray = (prepItemId: string, trayId: string) => {
    setConfirmAction({
      title: 'Delete Tray',
      message: 'Delete this tray configuration?',
      action: async () => {
        try {
          const response = await fetch(`/api/inventory/prep-tray-configs/${trayId}`, {
            method: 'DELETE',
          })

          if (response.ok) {
            setPrepItems(items =>
              items.map(i =>
                i.id === prepItemId
                  ? { ...i, trayConfigs: i.trayConfigs.filter(t => t.id !== trayId) }
                  : i
              )
            )
            toast.success('Tray configuration deleted')
          } else {
            toast.error('Failed to delete tray')
          }
        } catch (error) {
          console.error('Failed to delete tray:', error)
          toast.error('Failed to delete tray')
        }
      },
    })
  }

  const dailyCountItems = prepItems.filter(i => i.isDailyCountItem)
  const otherItems = prepItems.filter(i => !i.isDailyCountItem)

  if (!hydrated) return null

  // Wait for auth to load
  if (!locationId || isLoading) {
    return null
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Daily Prep Counts"
        subtitle="Configure which prep items are counted each morning"
        breadcrumbs={[{ label: 'Settings', href: '/settings' }]}
      />

      <div className="max-w-4xl mx-auto space-y-6">
        {/* Info Card */}
        <Card className="p-4 bg-blue-50 border-blue-200">
          <div className="flex gap-3">
            <span className="text-2xl">📋</span>
            <div className="text-sm text-blue-700">
              <p className="font-medium mb-1">How Daily Counts Work</p>
              <p>
                Each morning before opening, staff counts prepared items (like pizza dough balls).
                When the count is approved, the system automatically deducts the raw ingredients
                (flour, yeast, water) from your inventory.
              </p>
            </div>
          </div>
        </Card>

        {/* Daily Count Items */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold">Daily Count Items ({dailyCountItems.length})</h3>
          </div>

          {dailyCountItems.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <span className="text-4xl mb-3 block">📦</span>
              <p className="font-medium mb-1">No items configured for daily counting</p>
              <p className="text-sm">Enable items below to add them to the morning count.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {dailyCountItems.map(item => (
                <div
                  key={item.id}
                  className="border rounded-lg overflow-hidden"
                >
                  {/* Item Header */}
                  <div
                    className="flex items-center justify-between p-4 bg-green-50 cursor-pointer hover:bg-green-100 transition-colors"
                    onClick={() => setExpandedItemId(expandedItemId === item.id ? null : item.id)}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-green-600 text-xl">✓</span>
                      <div>
                        <span className="font-medium">{item.name}</span>
                        <span className="text-gray-500 text-sm ml-2">
                          ({item.outputUnit})
                        </span>
                      </div>
                      {item.trayConfigs.length > 0 && (
                        <span className="px-2 py-0.5 bg-green-200 text-green-800 rounded text-xs">
                          {item.trayConfigs.length} tray{item.trayConfigs.length !== 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleToggleDailyCount(item)
                        }}
                        className="text-red-600 border-red-200 hover:bg-red-50"
                      >
                        Remove
                      </Button>
                      <span className="text-gray-400">
                        {expandedItemId === item.id ? '▼' : '▶'}
                      </span>
                    </div>
                  </div>

                  {/* Expanded: Tray Configurations */}
                  {expandedItemId === item.id && (
                    <div className="p-4 border-t bg-white">
                      <h4 className="font-medium mb-3 text-sm text-gray-700">
                        Tray Configurations
                      </h4>

                      {item.trayConfigs.length === 0 ? (
                        <p className="text-sm text-gray-500 mb-3">
                          No tray configurations yet. Add trays to make counting faster.
                        </p>
                      ) : (
                        <div className="space-y-2 mb-4">
                          {item.trayConfigs.map(tray => (
                            <div
                              key={tray.id}
                              className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                            >
                              <div>
                                <span className="font-medium">{tray.name}</span>
                                <span className="text-gray-500 ml-2">
                                  = {tray.capacity} {item.outputUnit}
                                </span>
                              </div>
                              <button
                                onClick={() => handleDeleteTray(item.id, tray.id)}
                                className="text-red-500 hover:text-red-700 p-1"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Add Tray Form */}
                      {addingTrayFor === item.id ? (
                        <div className="flex items-end gap-3 p-3 bg-blue-50 rounded-lg">
                          <div className="flex-1">
                            <label className="block text-xs font-medium text-gray-600 mb-1">
                              Tray Name
                            </label>
                            <input
                              type="text"
                              value={newTray.name}
                              onChange={(e) => setNewTray({ ...newTray, name: e.target.value })}
                              placeholder="e.g., Large Dough Tray"
                              className="w-full px-3 py-2 border rounded-lg text-sm"
                              autoFocus
                            />
                          </div>
                          <div className="w-32">
                            <label className="block text-xs font-medium text-gray-600 mb-1">
                              Capacity
                            </label>
                            <input
                              type="number"
                              value={newTray.capacity}
                              onChange={(e) => setNewTray({ ...newTray, capacity: e.target.value })}
                              placeholder="6"
                              className="w-full px-3 py-2 border rounded-lg text-sm"
                            />
                          </div>
                          <div className="text-sm text-gray-500 pb-2">
                            {item.outputUnit}
                          </div>
                          <Button
                            size="sm"
                            onClick={() => handleAddTray(item.id)}
                          >
                            Add
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setAddingTrayFor(null)
                              setNewTray({ name: '', capacity: '' })
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setAddingTrayFor(item.id)}
                          className="w-full"
                        >
                          + Add Tray Configuration
                        </Button>
                      )}

                      {/* Quick Add Suggestions */}
                      {item.trayConfigs.length === 0 && addingTrayFor !== item.id && (
                        <div className="mt-3 pt-3 border-t">
                          <p className="text-xs text-gray-500 mb-2">Quick add common trays:</p>
                          <div className="flex flex-wrap gap-2">
                            {[
                              { name: 'Full Tray', capacity: 12 },
                              { name: 'Half Tray', capacity: 6 },
                              { name: 'Speed Rack', capacity: 24 },
                              { name: 'Loose', capacity: 1 },
                            ].map(suggestion => (
                              <button
                                key={suggestion.name}
                                onClick={async () => {
                                  try {
                                    const response = await fetch('/api/inventory/prep-tray-configs', {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({
                                        locationId,
                                        prepItemId: item.id,
                                        name: suggestion.name,
                                        capacity: suggestion.capacity,
                                      }),
                                    })
                                    if (response.ok) {
                                      const data = await response.json()
                                      setPrepItems(items =>
                                        items.map(i =>
                                          i.id === item.id
                                            ? { ...i, trayConfigs: [...i.trayConfigs, data.data] }
                                            : i
                                        )
                                      )
                                      toast.success(`Added ${suggestion.name}`)
                                    }
                                  } catch {
                                    toast.error('Failed to add tray')
                                  }
                                }}
                                className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded transition-colors"
                              >
                                {suggestion.name} ({suggestion.capacity})
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* Available Prep Items */}
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">
            Available Prep Items ({otherItems.length})
          </h3>
          <p className="text-sm text-gray-600 mb-4">
            Click to add an item to the daily count list.
          </p>

          {otherItems.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p>All prep items are configured for daily counting.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {otherItems.map(item => (
                <button
                  key={item.id}
                  onClick={() => handleToggleDailyCount(item)}
                  className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50 transition-colors text-left"
                >
                  <div>
                    <span className="font-medium">{item.name}</span>
                    <span className="text-gray-500 text-sm ml-2">
                      ({item.outputUnit})
                    </span>
                  </div>
                  <span className="text-green-600 text-xl">+</span>
                </button>
              ))}
            </div>
          )}
        </Card>

        {/* Preview Section */}
        {dailyCountItems.length > 0 && (
          <Card className="p-6">
            <h3 className="text-lg font-semibold mb-4">Count Preview</h3>
            <p className="text-sm text-gray-600 mb-4">
              This is how the morning count screen will look:
            </p>

            <div className="border rounded-lg p-4 bg-gray-50">
              {dailyCountItems.map(item => (
                <div key={item.id} className="mb-4 last:mb-0">
                  <div className="font-medium mb-2">{item.name}</div>
                  {item.trayConfigs.length > 0 ? (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                      {item.trayConfigs.map(tray => (
                        <div
                          key={tray.id}
                          className="flex items-center justify-between p-2 bg-white rounded border"
                        >
                          <span className="text-sm">{tray.name}</span>
                          <div className="flex items-center gap-1">
                            <button className="w-6 h-6 bg-gray-100 rounded text-gray-600 hover:bg-gray-200">−</button>
                            <span className="w-8 text-center font-medium">0</span>
                            <button className="w-6 h-6 bg-gray-100 rounded text-gray-600 hover:bg-gray-200">+</button>
                          </div>
                        </div>
                      ))}
                      <div className="flex items-center justify-between p-2 bg-green-50 rounded border border-green-200">
                        <span className="text-sm font-medium">Total</span>
                        <span className="font-bold">0 {item.outputUnit}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 p-2 bg-white rounded border">
                      <span className="text-sm text-gray-500">Manual count:</span>
                      <input
                        type="number"
                        placeholder="0"
                        className="w-20 px-2 py-1 border rounded text-center"
                        disabled
                      />
                      <span className="text-sm text-gray-500">{item.outputUnit}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

      <ConfirmDialog
        open={!!confirmAction}
        title={confirmAction?.title || 'Confirm'}
        description={confirmAction?.message}
        confirmLabel="Delete"
        destructive
        onConfirm={() => { confirmAction?.action(); setConfirmAction(null) }}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  )
}
