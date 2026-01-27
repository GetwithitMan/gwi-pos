'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { formatCurrency } from '@/lib/utils'

interface Category {
  id: string
  name: string
  color: string
  itemCount: number
  isActive: boolean
}

interface MenuItem {
  id: string
  name: string
  price: number
  categoryId: string
  description?: string
  isActive: boolean
  isAvailable: boolean
}

export default function MenuManagementPage() {
  const router = useRouter()
  const { employee, isAuthenticated } = useAuthStore()
  const [categories, setCategories] = useState<Category[]>([])
  const [items, setItems] = useState<MenuItem[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [showCategoryModal, setShowCategoryModal] = useState(false)
  const [showItemModal, setShowItemModal] = useState(false)
  const [editingCategory, setEditingCategory] = useState<Category | null>(null)
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null)

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login')
      return
    }
    loadMenu()
  }, [isAuthenticated, router])

  const loadMenu = async () => {
    try {
      const response = await fetch('/api/menu')
      if (response.ok) {
        const data = await response.json()
        setCategories(data.categories)
        setItems(data.items)
        if (data.categories.length > 0 && !selectedCategory) {
          setSelectedCategory(data.categories[0].id)
        }
      }
    } catch (error) {
      console.error('Failed to load menu:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSaveCategory = async (categoryData: Partial<Category>) => {
    try {
      const method = editingCategory ? 'PUT' : 'POST'
      const url = editingCategory
        ? `/api/menu/categories/${editingCategory.id}`
        : '/api/menu/categories'

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(categoryData),
      })

      if (response.ok) {
        loadMenu()
        setShowCategoryModal(false)
        setEditingCategory(null)
      }
    } catch (error) {
      console.error('Failed to save category:', error)
    }
  }

  const handleSaveItem = async (itemData: Partial<MenuItem>) => {
    try {
      const method = editingItem ? 'PUT' : 'POST'
      const url = editingItem
        ? `/api/menu/items/${editingItem.id}`
        : '/api/menu/items'

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...itemData, categoryId: selectedCategory }),
      })

      if (response.ok) {
        loadMenu()
        setShowItemModal(false)
        setEditingItem(null)
      }
    } catch (error) {
      console.error('Failed to save item:', error)
    }
  }

  const handleDeleteCategory = async (id: string) => {
    if (!confirm('Delete this category and all its items?')) return
    try {
      await fetch(`/api/menu/categories/${id}`, { method: 'DELETE' })
      loadMenu()
      if (selectedCategory === id) {
        setSelectedCategory(categories[0]?.id || null)
      }
    } catch (error) {
      console.error('Failed to delete category:', error)
    }
  }

  const handleDeleteItem = async (id: string) => {
    if (!confirm('Delete this item?')) return
    try {
      await fetch(`/api/menu/items/${id}`, { method: 'DELETE' })
      loadMenu()
    } catch (error) {
      console.error('Failed to delete item:', error)
    }
  }

  const handleToggleItem86 = async (item: MenuItem) => {
    try {
      await fetch(`/api/menu/items/${item.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isAvailable: !item.isAvailable }),
      })
      loadMenu()
    } catch (error) {
      console.error('Failed to toggle 86:', error)
    }
  }

  const filteredItems = items.filter(item => item.categoryId === selectedCategory)

  if (!isAuthenticated) return null

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-white border-b px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => router.push('/orders')}>
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to POS
          </Button>
          <h1 className="text-2xl font-bold">Menu Management</h1>
        </div>
        <div className="flex items-center gap-4">
          <Button variant="outline" onClick={() => router.push('/modifiers')}>
            <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
            </svg>
            Modifiers
          </Button>
          <div className="text-sm text-gray-500">
            {employee?.displayName} · {employee?.role.name}
          </div>
        </div>
      </header>

      <div className="flex h-[calc(100vh-73px)]">
        {/* Categories Sidebar */}
        <div className="w-72 bg-white border-r p-4 overflow-y-auto">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-lg">Categories</h2>
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setEditingCategory(null)
                setShowCategoryModal(true)
              }}
            >
              + Add
            </Button>
          </div>

          {isLoading ? (
            <div className="text-center py-8 text-gray-400">Loading...</div>
          ) : categories.length === 0 ? (
            <div className="text-center py-8 text-gray-400">
              <p>No categories yet</p>
              <p className="text-sm">Click + Add to create one</p>
            </div>
          ) : (
            <div className="space-y-2">
              {categories.map(category => (
                <div
                  key={category.id}
                  className={`p-3 rounded-lg cursor-pointer transition-all ${
                    selectedCategory === category.id
                      ? 'bg-blue-50 border-2 border-blue-500'
                      : 'bg-gray-50 border-2 border-transparent hover:bg-gray-100'
                  }`}
                  onClick={() => setSelectedCategory(category.id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-4 h-4 rounded"
                        style={{ backgroundColor: category.color }}
                      />
                      <span className="font-medium">{category.name}</span>
                    </div>
                    <span className="text-sm text-gray-500">{category.itemCount}</span>
                  </div>
                  {selectedCategory === category.id && (
                    <div className="flex gap-2 mt-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation()
                          setEditingCategory(category)
                          setShowCategoryModal(true)
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-500 hover:text-red-700"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDeleteCategory(category.id)
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Items Grid */}
        <div className="flex-1 p-6 overflow-y-auto">
          {selectedCategory ? (
            <>
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-semibold">
                  {categories.find(c => c.id === selectedCategory)?.name} Items
                </h2>
                <Button
                  variant="primary"
                  onClick={() => {
                    setEditingItem(null)
                    setShowItemModal(true)
                  }}
                >
                  + Add Item
                </Button>
              </div>

              {filteredItems.length === 0 ? (
                <Card className="p-8 text-center">
                  <p className="text-gray-400">No items in this category</p>
                  <p className="text-sm text-gray-400">Click + Add Item to create one</p>
                </Card>
              ) : (
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {filteredItems.map(item => (
                    <Card
                      key={item.id}
                      className={`overflow-hidden ${!item.isAvailable ? 'opacity-60' : ''}`}
                    >
                      <CardContent className="p-4">
                        <div className="flex justify-between items-start mb-2">
                          <h3 className="font-semibold">{item.name}</h3>
                          {!item.isAvailable && (
                            <span className="bg-red-100 text-red-800 text-xs px-2 py-1 rounded">
                              86'd
                            </span>
                          )}
                        </div>
                        <p className="text-lg font-bold text-blue-600 mb-2">
                          {formatCurrency(item.price)}
                        </p>
                        {item.description && (
                          <p className="text-sm text-gray-500 mb-3 line-clamp-2">
                            {item.description}
                          </p>
                        )}
                        <div className="flex gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setEditingItem(item)
                              setShowItemModal(true)
                            }}
                          >
                            Edit
                          </Button>
                          <Button
                            variant={item.isAvailable ? 'outline' : 'primary'}
                            size="sm"
                            onClick={() => handleToggleItem86(item)}
                          >
                            {item.isAvailable ? '86 It' : 'Restore'}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-500"
                            onClick={() => handleDeleteItem(item.id)}
                          >
                            Delete
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </>
          ) : (
            <Card className="p-8 text-center">
              <p className="text-gray-400">Select a category to view items</p>
            </Card>
          )}
        </div>
      </div>

      {/* Category Modal */}
      {showCategoryModal && (
        <CategoryModal
          category={editingCategory}
          onSave={handleSaveCategory}
          onClose={() => {
            setShowCategoryModal(false)
            setEditingCategory(null)
          }}
        />
      )}

      {/* Item Modal */}
      {showItemModal && (
        <ItemModal
          item={editingItem}
          onSave={handleSaveItem}
          onClose={() => {
            setShowItemModal(false)
            setEditingItem(null)
          }}
        />
      )}
    </div>
  )
}

// Category Modal Component
function CategoryModal({
  category,
  onSave,
  onClose
}: {
  category: Category | null
  onSave: (data: Partial<Category>) => void
  onClose: () => void
}) {
  const [name, setName] = useState(category?.name || '')
  const [color, setColor] = useState(category?.color || '#3b82f6')

  const colors = [
    '#ef4444', '#f97316', '#eab308', '#22c55e',
    '#3b82f6', '#8b5cf6', '#ec4899', '#6b7280'
  ]

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{category ? 'Edit Category' : 'New Category'}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g., Appetizers"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">Color</label>
            <div className="flex gap-2 flex-wrap">
              {colors.map(c => (
                <button
                  key={c}
                  className={`w-10 h-10 rounded-lg ${color === c ? 'ring-2 ring-offset-2 ring-blue-500' : ''}`}
                  style={{ backgroundColor: c }}
                  onClick={() => setColor(c)}
                />
              ))}
            </div>
          </div>
          <div className="flex gap-2 pt-4">
            <Button variant="outline" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              disabled={!name.trim()}
              onClick={() => onSave({ name, color })}
            >
              {category ? 'Save Changes' : 'Create Category'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// Item Modal Component
function ItemModal({
  item,
  onSave,
  onClose
}: {
  item: MenuItem | null
  onSave: (data: Partial<MenuItem>) => void
  onClose: () => void
}) {
  const [name, setName] = useState(item?.name || '')
  const [price, setPrice] = useState(item?.price?.toString() || '')
  const [description, setDescription] = useState(item?.description || '')

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{item ? 'Edit Item' : 'New Item'}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g., Buffalo Wings"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Price</label>
            <div className="relative">
              <span className="absolute left-3 top-2 text-gray-500">$</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="w-full pl-7 pr-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0.00"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Description (optional)</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Brief description..."
              rows={2}
            />
          </div>
          <div className="flex gap-2 pt-4">
            <Button variant="outline" className="flex-1" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              disabled={!name.trim() || !price}
              onClick={() => onSave({
                name,
                price: parseFloat(price),
                description: description || undefined
              })}
            >
              {item ? 'Save Changes' : 'Create Item'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
