'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { toast } from '@/stores/toast-store'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { getSharedSocket, releaseSharedSocket } from '@/lib/shared-socket'

// ─── Types ───────────────────────────────────────────────────────────────────

interface ModifierGroupData {
  id: string
  name: string
  showOnline: boolean
}

interface MenuItemData {
  id: string
  categoryId: string
  name: string
  price: number
  showOnline: boolean
  onlinePrice: number | null
  modifierGroups: ModifierGroupData[]
}

interface CategoryData {
  id: string
  name: string
  color: string | null
  showOnline: boolean
  itemCount: number
}

// ─── Toggle Component ────────────────────────────────────────────────────────

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean
  onChange: (val: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
        checked ? 'bg-blue-600' : 'bg-gray-600'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  )
}

// ─── Page Component ──────────────────────────────────────────────────────────

export default function OnlineMenuPage() {
  const hydrated = useAuthenticationGuard()
  const employee = useAuthStore(s => s.employee)
  const locationId = employee?.location?.id

  const [categories, setCategories] = useState<CategoryData[]>([])
  const [items, setItems] = useState<MenuItemData[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set())
  const [expandedModGroups, setExpandedModGroups] = useState<Set<string>>(new Set())

  // ─── Load menu data ────────────────────────────────────────────────────────

  const loadMenu = useCallback(async () => {
    if (!locationId) return
    try {
      const res = await fetch(`/api/menu?locationId=${locationId}`)
      if (!res.ok) throw new Error('Failed to load menu')
      const json = await res.json()
      const data = json.data
      setCategories(data.categories || [])
      setItems(data.items || [])
    } catch (err) {
      console.error('Failed to load menu:', err)
      toast.error('Failed to load menu data')
    } finally {
      setIsLoading(false)
    }
  }, [locationId])

  useEffect(() => {
    loadMenu()
  }, [loadMenu])

  // ─── Socket listener for menu changes ──────────────────────────────────────

  useEffect(() => {
    const socket = getSharedSocket()
    const onMenuChanged = () => {
      loadMenu()
    }
    socket.on('menu:changed', onMenuChanged)
    return () => {
      socket.off('menu:changed', onMenuChanged)
      releaseSharedSocket()
    }
  }, [loadMenu])

  // ─── Toggle handlers ──────────────────────────────────────────────────────

  const toggleCategoryOnline = async (cat: CategoryData) => {
    const newVal = !cat.showOnline
    // Optimistic update
    setCategories(prev => prev.map(c => c.id === cat.id ? { ...c, showOnline: newVal } : c))
    try {
      const res = await fetch(`/api/menu/categories/${cat.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ showOnline: newVal, locationId }),
      })
      if (!res.ok) throw new Error('Failed to update category')
    } catch {
      // Revert
      setCategories(prev => prev.map(c => c.id === cat.id ? { ...c, showOnline: !newVal } : c))
      toast.error('Failed to update category')
    }
  }

  const toggleItemOnline = async (item: MenuItemData) => {
    const newVal = !item.showOnline
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, showOnline: newVal } : i))
    try {
      const res = await fetch(`/api/menu/items/${item.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ showOnline: newVal }),
      })
      if (!res.ok) throw new Error('Failed to update item')
    } catch {
      setItems(prev => prev.map(i => i.id === item.id ? { ...i, showOnline: !newVal } : i))
      toast.error('Failed to update item')
    }
  }

  const updateOnlinePrice = async (itemId: string, value: string) => {
    const onlinePrice = value.trim() === '' ? null : parseFloat(value)
    if (onlinePrice !== null && isNaN(onlinePrice)) return

    setItems(prev => prev.map(i => i.id === itemId ? { ...i, onlinePrice } : i))
    try {
      const res = await fetch(`/api/menu/items/${itemId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ onlinePrice }),
      })
      if (!res.ok) throw new Error('Failed to update online price')
    } catch {
      toast.error('Failed to update online price')
      loadMenu() // Reload to revert
    }
  }

  const toggleModGroupOnline = async (itemId: string, mg: ModifierGroupData) => {
    const newVal = !mg.showOnline
    // Optimistic update
    setItems(prev => prev.map(i => {
      if (i.id !== itemId) return i
      return {
        ...i,
        modifierGroups: i.modifierGroups.map(g =>
          g.id === mg.id ? { ...g, showOnline: newVal } : g
        ),
      }
    }))
    try {
      const res = await fetch(`/api/menu/items/${itemId}/modifier-groups/${mg.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ showOnline: newVal }),
      })
      if (!res.ok) throw new Error('Failed to update modifier group')
    } catch {
      setItems(prev => prev.map(i => {
        if (i.id !== itemId) return i
        return {
          ...i,
          modifierGroups: i.modifierGroups.map(g =>
            g.id === mg.id ? { ...g, showOnline: !newVal } : g
          ),
        }
      }))
      toast.error('Failed to update modifier group')
    }
  }

  // ─── Expand/Collapse ──────────────────────────────────────────────────────

  const toggleCatExpanded = (catId: string) => {
    setExpandedCats(prev => {
      const next = new Set(prev)
      next.has(catId) ? next.delete(catId) : next.add(catId)
      return next
    })
  }

  const toggleModGroupExpanded = (key: string) => {
    setExpandedModGroups(prev => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  if (!hydrated) return null

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-950 p-6">
      <AdminPageHeader
        title="Online Menu"
        subtitle="Control which items appear in online ordering"
        breadcrumbs={[{ label: 'Online Ordering', href: '/settings/online-ordering' }]}
      />

      {/* Info banner */}
      <div className="max-w-5xl mx-auto mb-6">
        <div className="bg-blue-900/30 border border-blue-800/50 rounded-lg px-4 py-3 text-sm text-blue-300">
          Items are built in Menu Builder. Changes here only affect online visibility and pricing.
        </div>
      </div>

      {/* Category list */}
      <div className="max-w-5xl mx-auto space-y-3">
        {categories.length === 0 ? (
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-8 text-center text-gray-400">
            No categories found. Create categories in Menu Builder first.
          </div>
        ) : (
          categories.map(cat => {
            const catItems = items.filter(i => i.categoryId === cat.id)
            const isExpanded = expandedCats.has(cat.id)

            return (
              <div
                key={cat.id}
                className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden"
              >
                {/* Category header */}
                <div className="flex items-center justify-between px-4 py-3">
                  <button
                    onClick={() => toggleCatExpanded(cat.id)}
                    className="flex items-center gap-3 text-left flex-1 min-w-0"
                  >
                    <svg
                      className={`w-4 h-4 text-gray-400 transition-transform flex-shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                    {cat.color && (
                      <span
                        className="w-3 h-3 rounded-full flex-shrink-0"
                        style={{ backgroundColor: cat.color }}
                      />
                    )}
                    <span className="font-semibold text-white truncate">{cat.name}</span>
                    <span className="text-sm text-gray-500 flex-shrink-0">
                      ({catItems.length} items)
                    </span>
                  </button>
                  <div className="flex items-center gap-2 ml-4">
                    <span className="text-xs text-gray-500">Online</span>
                    <Toggle
                      checked={cat.showOnline}
                      onChange={() => toggleCategoryOnline(cat)}
                    />
                  </div>
                </div>

                {/* Expanded items */}
                {isExpanded && catItems.length > 0 && (
                  <div className="border-t border-gray-800">
                    {catItems.map(item => (
                      <div key={item.id}>
                        {/* Item row */}
                        <div className="flex items-center justify-between px-4 py-3 pl-12 border-b border-gray-800/50 last:border-b-0">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-3">
                              <span className="text-white text-sm font-medium truncate">{item.name}</span>
                              <span className="text-gray-500 text-xs flex-shrink-0">
                                POS: ${item.price.toFixed(2)}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-4 ml-4">
                            {/* Online price input */}
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-500 whitespace-nowrap">Online price:</span>
                              <OnlinePriceInput
                                value={item.onlinePrice}
                                posPrice={item.price}
                                onCommit={(val) => updateOnlinePrice(item.id, val)}
                              />
                            </div>
                            {/* Show online toggle */}
                            <Toggle
                              checked={item.showOnline}
                              onChange={() => toggleItemOnline(item)}
                            />
                          </div>
                        </div>
                        {/* Modifier groups under item */}
                        {item.modifierGroups.length > 0 && (
                          <div className="pl-16 pr-4 pb-2">
                            {item.modifierGroups.map(mg => {
                              const mgKey = `${item.id}:${mg.id}`
                              return (
                                <div
                                  key={mg.id}
                                  className="flex items-center justify-between py-1.5"
                                >
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs text-gray-600">mod</span>
                                    <span className="text-gray-400 text-xs">{mg.name}</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs text-gray-600">Online</span>
                                    <Toggle
                                      checked={mg.showOnline}
                                      onChange={() => toggleModGroupOnline(item.id, mg)}
                                    />
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* No items message */}
                {isExpanded && catItems.length === 0 && (
                  <div className="border-t border-gray-800 px-4 py-4 text-center text-gray-500 text-sm">
                    No items in this category.
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

// ─── Online Price Input ──────────────────────────────────────────────────────

function OnlinePriceInput({
  value,
  posPrice,
  onCommit,
}: {
  value: number | null
  posPrice: number
  onCommit: (val: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [localVal, setLocalVal] = useState(value !== null ? value.toFixed(2) : '')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setLocalVal(value !== null ? value.toFixed(2) : '')
  }, [value])

  const handleBlur = () => {
    setEditing(false)
    const trimmed = localVal.trim()
    const currentStr = value !== null ? value.toFixed(2) : ''
    if (trimmed !== currentStr) {
      onCommit(trimmed)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      inputRef.current?.blur()
    }
    if (e.key === 'Escape') {
      setLocalVal(value !== null ? value.toFixed(2) : '')
      setEditing(false)
    }
  }

  return (
    <div className="relative">
      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-xs pointer-events-none">$</span>
      <input
        ref={inputRef}
        type="text"
        inputMode="decimal"
        value={editing ? localVal : (value !== null ? value.toFixed(2) : '')}
        placeholder={posPrice.toFixed(2)}
        onFocus={() => setEditing(true)}
        onChange={(e) => setLocalVal(e.target.value)}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        className="w-24 pl-5 pr-2 py-1 text-xs text-right bg-gray-800 border border-gray-700 rounded text-white placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
      />
    </div>
  )
}
