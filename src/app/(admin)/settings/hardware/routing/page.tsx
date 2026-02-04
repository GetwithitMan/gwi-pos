'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { AdminSubNav, hardwareSubNav } from '@/components/admin/AdminSubNav'

interface Category {
  id: string
  name: string
  categoryType: string
  printerIds: string[] | null
}

interface MenuItem {
  id: string
  name: string
  categoryId: string
  printerIds: string[] | null
  backupPrinterIds: string[] | null
}

interface Printer {
  id: string
  name: string
  printerType: string
  printerRole: string
  ipAddress: string
}

interface KDSScreen {
  id: string
  name: string
  screenType: string
  isActive: boolean
}

// Combined type for print destinations
interface PrintDestination {
  id: string
  name: string
  type: 'printer' | 'kds'
  role: string
}

export default function RoutingPage() {
  const router = useRouter()
  const { isAuthenticated } = useAuthStore()
  const [isLoading, setIsLoading] = useState(true)
  const [categories, setCategories] = useState<Category[]>([])
  const [printers, setPrinters] = useState<Printer[]>([])
  const [kdsScreens, setKdsScreens] = useState<KDSScreen[]>([])
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())
  const [categoryItems, setCategoryItems] = useState<Record<string, MenuItem[]>>({})
  const [editingItem, setEditingItem] = useState<string | null>(null)

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login?redirect=/settings/hardware/routing')
      return
    }
    loadData()
  }, [isAuthenticated, router])

  const loadData = async () => {
    setIsLoading(true)
    try {
      const [menuRes, printersRes, kdsRes] = await Promise.all([
        fetch('/api/menu'),
        fetch('/api/hardware/printers'),
        fetch('/api/hardware/kds-screens'),
      ])

      if (menuRes.ok) {
        const menuData = await menuRes.json()
        // Convert printerIds from JSON to arrays
        const cats = (menuData.categories || []).map((c: any) => ({
          ...c,
          printerIds: c.printerIds || null,
        }))
        setCategories(cats)

        // Group items by category
        const itemsByCategory: Record<string, MenuItem[]> = {}
        for (const item of menuData.items || []) {
          if (!itemsByCategory[item.categoryId]) {
            itemsByCategory[item.categoryId] = []
          }
          itemsByCategory[item.categoryId].push({
            ...item,
            printerIds: item.printerIds || null,
            backupPrinterIds: item.backupPrinterIds || null,
          })
        }
        setCategoryItems(itemsByCategory)
      }

      if (printersRes.ok) {
        const printersData = await printersRes.json()
        setPrinters(printersData.printers || [])
      }

      if (kdsRes.ok) {
        const kdsData = await kdsRes.json()
        setKdsScreens(kdsData.screens || [])
      }
    } catch (error) {
      console.error('Failed to load data:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const toggleCategory = (categoryId: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev)
      if (next.has(categoryId)) {
        next.delete(categoryId)
      } else {
        next.add(categoryId)
      }
      return next
    })
  }

  const handleCategoryPrintersChange = async (categoryId: string, printerIds: string[]) => {
    try {
      await fetch(`/api/menu/categories/${categoryId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ printerIds: printerIds.length > 0 ? printerIds : null }),
      })
      setCategories((prev) =>
        prev.map((c) =>
          c.id === categoryId ? { ...c, printerIds: printerIds.length > 0 ? printerIds : null } : c
        )
      )
    } catch (error) {
      console.error('Failed to update category printers:', error)
    }
  }

  const handleItemPrintersChange = async (
    itemId: string,
    categoryId: string,
    printerIds: string[],
    backupPrinterIds: string[]
  ) => {
    try {
      await fetch(`/api/menu/items/${itemId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          printerIds: printerIds.length > 0 ? printerIds : null,
          backupPrinterIds: backupPrinterIds.length > 0 ? backupPrinterIds : null,
        }),
      })
      setCategoryItems((prev) => ({
        ...prev,
        [categoryId]: prev[categoryId].map((item) =>
          item.id === itemId
            ? {
                ...item,
                printerIds: printerIds.length > 0 ? printerIds : null,
                backupPrinterIds: backupPrinterIds.length > 0 ? backupPrinterIds : null,
              }
            : item
        ),
      }))
      setEditingItem(null)
    } catch (error) {
      console.error('Failed to update item printers:', error)
    }
  }

  const togglePrinter = (currentIds: string[] | null, printerId: string): string[] => {
    const ids = currentIds || []
    if (ids.includes(printerId)) {
      return ids.filter((id) => id !== printerId)
    }
    return [...ids, printerId]
  }

  const getDestinationNames = (ids: string[] | null): string => {
    if (!ids || ids.length === 0) return 'None'
    return ids
      .map((id) => {
        const printer = printers.find((p) => p.id === id)
        if (printer) return printer.name
        const kds = kdsScreens.find((k) => k.id === id)
        if (kds) return `${kds.name} (KDS)`
        return 'Unknown'
      })
      .join(', ')
  }

  // Combined list of all print destinations
  const printDestinations: PrintDestination[] = [
    ...printers.map(p => ({ id: p.id, name: p.name, type: 'printer' as const, role: p.printerRole })),
    ...kdsScreens.filter(k => k.isActive).map(k => ({ id: k.id, name: k.name, type: 'kds' as const, role: k.screenType }))
  ]

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-5xl mx-auto">
          <div className="text-center py-12 text-gray-500">Loading routing configuration...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Print Routing"
        subtitle="Configure which printers each category and item prints to"
        breadcrumbs={[
          { label: 'Settings', href: '/settings' },
          { label: 'Hardware', href: '/settings/hardware' },
        ]}
      />
      <AdminSubNav items={hardwareSubNav} basePath="/settings/hardware" />

      <div className="max-w-5xl mx-auto">

        {/* Info Card */}
        <Card className="mb-6 bg-blue-50 border-blue-200">
          <CardContent className="py-4">
            <p className="text-sm text-blue-800">
              <strong>How it works:</strong> Assign printers at the category level, then override
              for specific items. Items can print to multiple printers with backup failover.
            </p>
            <p className="text-xs text-blue-600 mt-1">
              <strong>Priority:</strong> Item printers → Category printers → Default kitchen printer
            </p>
          </CardContent>
        </Card>

        {printDestinations.length === 0 && (
          <Card className="mb-6 bg-yellow-50 border-yellow-200">
            <CardContent className="py-4">
              <p className="text-sm text-yellow-800">
                No printers or KDS screens configured. Add them in the{' '}
                <button
                  onClick={() => router.push('/settings/hardware')}
                  className="underline font-medium"
                >
                  Hardware Settings
                </button>{' '}
                first.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Categories */}
        <div className="space-y-4">
          {categories.map((category) => (
            <Card key={category.id}>
              <CardHeader
                className="cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => toggleCategory(category.id)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="text-lg">
                      {expandedCategories.has(category.id) ? '▼' : '▶'}
                    </span>
                    <CardTitle className="text-lg">{category.name}</CardTitle>
                    <span className="text-xs bg-gray-100 px-2 py-1 rounded text-gray-600">
                      {category.categoryType}
                    </span>
                  </div>
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <span className="text-sm text-gray-600">Destinations:</span>
                    <div className="flex flex-wrap gap-1">
                      {printDestinations.map((dest) => (
                        <button
                          key={dest.id}
                          onClick={() =>
                            handleCategoryPrintersChange(
                              category.id,
                              togglePrinter(category.printerIds, dest.id)
                            )
                          }
                          className={`px-2 py-1 text-xs rounded border transition-colors ${
                            category.printerIds?.includes(dest.id)
                              ? dest.type === 'kds' ? 'bg-green-500 text-white border-green-500' : 'bg-blue-500 text-white border-blue-500'
                              : 'bg-white text-gray-700 border-gray-300 hover:border-blue-300'
                          }`}
                        >
                          {dest.name}{dest.type === 'kds' ? ' (KDS)' : ''}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </CardHeader>

              {expandedCategories.has(category.id) && categoryItems[category.id] && (
                <CardContent className="border-t">
                  <div className="space-y-2">
                    {categoryItems[category.id].map((item) => (
                      <div
                        key={item.id}
                        className="p-3 bg-gray-50 rounded-lg"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex-1">
                            <span className="text-sm font-medium">{item.name}</span>
                            {(item.printerIds || item.backupPrinterIds) && (
                              <div className="text-xs text-gray-500 mt-1">
                                {item.printerIds && (
                                  <span>Destinations: {getDestinationNames(item.printerIds)}</span>
                                )}
                                {item.backupPrinterIds && (
                                  <span className="ml-2 text-orange-600">
                                    Backup: {getDestinationNames(item.backupPrinterIds)}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setEditingItem(editingItem === item.id ? null : item.id)}
                          >
                            {editingItem === item.id ? 'Done' : 'Edit'}
                          </Button>
                        </div>

                        {editingItem === item.id && (
                          <div className="mt-3 pt-3 border-t space-y-3">
                            <div>
                              <label className="text-xs font-medium text-gray-700 mb-1 block">
                                Print Destinations (override category)
                              </label>
                              <div className="flex flex-wrap gap-1">
                                {printDestinations.map((dest) => (
                                  <button
                                    key={dest.id}
                                    onClick={() =>
                                      handleItemPrintersChange(
                                        item.id,
                                        category.id,
                                        togglePrinter(item.printerIds, dest.id),
                                        item.backupPrinterIds || []
                                      )
                                    }
                                    className={`px-2 py-1 text-xs rounded border transition-colors ${
                                      item.printerIds?.includes(dest.id)
                                        ? dest.type === 'kds' ? 'bg-green-500 text-white border-green-500' : 'bg-blue-500 text-white border-blue-500'
                                        : 'bg-white text-gray-700 border-gray-300 hover:border-blue-300'
                                    }`}
                                  >
                                    {dest.name}{dest.type === 'kds' ? ' (KDS)' : ''}
                                  </button>
                                ))}
                              </div>
                              <p className="text-xs text-gray-500 mt-1">
                                Leave empty to inherit from category
                              </p>
                            </div>

                            <div>
                              <label className="text-xs font-medium text-gray-700 mb-1 block">
                                Backup Destinations (failover)
                              </label>
                              <div className="flex flex-wrap gap-1">
                                {printDestinations.map((dest) => (
                                  <button
                                    key={dest.id}
                                    onClick={() =>
                                      handleItemPrintersChange(
                                        item.id,
                                        category.id,
                                        item.printerIds || [],
                                        togglePrinter(item.backupPrinterIds, dest.id)
                                      )
                                    }
                                    className={`px-2 py-1 text-xs rounded border transition-colors ${
                                      item.backupPrinterIds?.includes(dest.id)
                                        ? 'bg-orange-500 text-white border-orange-500'
                                        : 'bg-white text-gray-700 border-gray-300 hover:border-orange-300'
                                    }`}
                                  >
                                    {dest.name}{dest.type === 'kds' ? ' (KDS)' : ''}
                                  </button>
                                ))}
                              </div>
                              <p className="text-xs text-gray-500 mt-1">
                                Used if primary destinations fail
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                    {categoryItems[category.id].length === 0 && (
                      <p className="text-sm text-gray-500 text-center py-4">
                        No items in this category
                      </p>
                    )}
                  </div>
                </CardContent>
              )}
            </Card>
          ))}
        </div>

        {categories.length === 0 && (
          <Card>
            <CardContent className="py-12">
              <p className="text-center text-gray-500">
                No categories found. Add categories in the Menu page.
              </p>
            </CardContent>
          </Card>
        )}

        {/* Modifier Routing Info */}
        <Card className="mt-6 bg-gray-50">
          <CardContent className="py-4">
            <p className="text-sm text-gray-700">
              <strong>Modifier Routing:</strong> Configure modifier printer routing in the{' '}
              <button
                onClick={() => router.push('/modifiers')}
                className="underline font-medium text-blue-600"
              >
                Modifiers
              </button>{' '}
              page. Options: Follow main item, Also send to printer, or Send only to printer.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
