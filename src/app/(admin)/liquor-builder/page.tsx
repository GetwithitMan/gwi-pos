'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { formatCurrency } from '@/lib/utils'
import { AdminNav } from '@/components/admin/AdminNav'
import { SPIRIT_TIERS, BOTTLE_SIZES, LIQUOR_DEFAULTS } from '@/lib/constants'

interface SpiritCategory {
  id: string
  name: string
  displayName?: string | null
  description?: string | null
  sortOrder: number
  isActive: boolean
  bottleCount: number
  modifierGroupCount: number
}

interface BottleProduct {
  id: string
  name: string
  brand?: string | null
  displayName?: string | null
  spiritCategoryId: string
  spiritCategory: {
    id: string
    name: string
    displayName?: string | null
  }
  tier: string
  bottleSizeMl: number
  bottleSizeOz?: number | null
  unitCost: number
  pourSizeOz?: number | null
  poursPerBottle?: number | null
  pourCost?: number | null
  currentStock: number
  lowStockAlert?: number | null
  isActive: boolean
}

interface RecipeCocktail {
  id: string
  name: string
  description?: string | null
  sellPrice: number
  category: {
    id: string
    name: string
    color: string
  }
  hasRecipe: boolean
  ingredientCount: number
  totalPourCost: number
  profitMargin: number
  grossProfit: number
  ingredients?: {
    id: string
    bottleProductId: string
    bottleProductName: string
    spiritCategory: string
    tier: string
    pourCount: number
    pourCost: number
    isSubstitutable: boolean
    ingredientCost: number
  }[]
}

type TabType = 'bottles' | 'categories' | 'recipes'

function LiquorBuilderContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { employee, isAuthenticated } = useAuthStore()
  const [activeTab, setActiveTab] = useState<TabType>('bottles')
  const [isLoading, setIsLoading] = useState(true)
  const [pendingItemId, setPendingItemId] = useState<string | null>(null)

  // Data state
  const [categories, setCategories] = useState<SpiritCategory[]>([])
  const [bottles, setBottles] = useState<BottleProduct[]>([])
  const [cocktails, setCocktails] = useState<RecipeCocktail[]>([])
  const [recipeSummary, setRecipeSummary] = useState({ total: 0, withRecipes: 0, withoutRecipes: 0, averageMargin: 0 })

  // Modal state
  const [showCategoryModal, setShowCategoryModal] = useState(false)
  const [showBottleModal, setShowBottleModal] = useState(false)
  const [showRecipeModal, setShowRecipeModal] = useState(false)
  const [editingCategory, setEditingCategory] = useState<SpiritCategory | null>(null)
  const [editingBottle, setEditingBottle] = useState<BottleProduct | null>(null)
  const [editingCocktail, setEditingCocktail] = useState<RecipeCocktail | null>(null)

  // Filter state
  const [categoryFilter, setCategoryFilter] = useState<string>('')
  const [tierFilter, setTierFilter] = useState<string>('')

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login?redirect=/liquor-builder')
      return
    }
    loadData()
  }, [isAuthenticated, router])

  // Handle ?item= query parameter to open recipe modal directly
  useEffect(() => {
    const itemId = searchParams.get('item')
    if (itemId) {
      setPendingItemId(itemId)
      setActiveTab('recipes')
    }
  }, [searchParams])

  // Open recipe modal when cocktails are loaded and we have a pending item
  useEffect(() => {
    if (pendingItemId && cocktails.length > 0 && !isLoading) {
      const cocktail = cocktails.find(c => c.id === pendingItemId)
      if (cocktail) {
        setEditingCocktail(cocktail)
        setShowRecipeModal(true)
        setPendingItemId(null)
        // Clear the URL param
        router.replace('/liquor-builder', { scroll: false })
      }
    }
  }, [pendingItemId, cocktails, isLoading, router])

  const loadData = async () => {
    setIsLoading(true)
    try {
      await Promise.all([loadCategories(), loadBottles(), loadCocktails()])
    } finally {
      setIsLoading(false)
    }
  }

  const loadCategories = async () => {
    const res = await fetch('/api/liquor/categories')
    if (res.ok) {
      const data = await res.json()
      setCategories(data)
    }
  }

  const loadBottles = async () => {
    const res = await fetch('/api/liquor/bottles')
    if (res.ok) {
      const data = await res.json()
      setBottles(data)
    }
  }

  const loadCocktails = async () => {
    const res = await fetch('/api/liquor/recipes')
    if (res.ok) {
      const data = await res.json()
      setCocktails(data.cocktails)
      setRecipeSummary(data.summary)
    }
  }

  const getTierLabel = (tier: string) => {
    return SPIRIT_TIERS.find(t => t.value === tier)?.label || tier
  }

  const getTierColor = (tier: string) => {
    const colors: Record<string, string> = {
      well: 'bg-gray-100 text-gray-700',
      call: 'bg-blue-100 text-blue-700',
      premium: 'bg-purple-100 text-purple-700',
      top_shelf: 'bg-amber-100 text-amber-700',
    }
    return colors[tier] || 'bg-gray-100 text-gray-700'
  }

  // Filter bottles
  const filteredBottles = bottles.filter(b => {
    if (categoryFilter && b.spiritCategoryId !== categoryFilter) return false
    if (tierFilter && b.tier !== tierFilter) return false
    return true
  })

  if (!isAuthenticated) return null

  return (
    <div className="min-h-screen bg-gray-100">
      <AdminNav />

      <div className="lg:ml-64 p-6">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Liquor Builder</h1>
          <p className="text-gray-600">Manage spirit inventory, recipes, and pour cost tracking</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 mb-6 border-b">
          {[
            { id: 'bottles', label: 'Bottle Library', count: bottles.length },
            { id: 'categories', label: 'Spirit Categories', count: categories.length },
            { id: 'recipes', label: 'Cocktail Recipes', count: recipeSummary.withRecipes },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as TabType)}
              className={`px-4 py-2 font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
              <span className="ml-2 bg-gray-200 text-gray-700 px-2 py-0.5 rounded-full text-xs">
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="text-center py-8 text-gray-500">Loading...</div>
        ) : (
          <>
            {/* Bottles Tab */}
            {activeTab === 'bottles' && (
              <div>
                <div className="flex justify-between items-center mb-4">
                  <div className="flex gap-2">
                    <select
                      value={categoryFilter}
                      onChange={e => setCategoryFilter(e.target.value)}
                      className="border rounded-lg px-3 py-2"
                    >
                      <option value="">All Categories</option>
                      {categories.map(cat => (
                        <option key={cat.id} value={cat.id}>{cat.name}</option>
                      ))}
                    </select>
                    <select
                      value={tierFilter}
                      onChange={e => setTierFilter(e.target.value)}
                      className="border rounded-lg px-3 py-2"
                    >
                      <option value="">All Tiers</option>
                      {SPIRIT_TIERS.map(tier => (
                        <option key={tier.value} value={tier.value}>{tier.label}</option>
                      ))}
                    </select>
                  </div>
                  <Button onClick={() => { setEditingBottle(null); setShowBottleModal(true); }}>
                    + Add Bottle
                  </Button>
                </div>

                {filteredBottles.length === 0 ? (
                  <Card>
                    <CardContent className="py-12 text-center">
                      <p className="text-gray-500 mb-4">No bottles in your library yet</p>
                      <Button onClick={() => { setEditingBottle(null); setShowBottleModal(true); }}>
                        Add Your First Bottle
                      </Button>
                    </CardContent>
                  </Card>
                ) : (
                  <Card>
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Product</th>
                            <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Category</th>
                            <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">Tier</th>
                            <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Size</th>
                            <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Cost</th>
                            <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Pours</th>
                            <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Pour Cost</th>
                            <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Stock</th>
                            <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {filteredBottles.map(bottle => (
                            <tr key={bottle.id} className={!bottle.isActive ? 'bg-gray-50 opacity-60' : ''}>
                              <td className="px-4 py-3">
                                <div className="font-medium">{bottle.name}</div>
                                {bottle.brand && (
                                  <div className="text-sm text-gray-500">{bottle.brand}</div>
                                )}
                              </td>
                              <td className="px-4 py-3 text-sm">{bottle.spiritCategory.name}</td>
                              <td className="px-4 py-3 text-center">
                                <span className={`px-2 py-1 rounded-full text-xs font-medium ${getTierColor(bottle.tier)}`}>
                                  {getTierLabel(bottle.tier)}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-right text-sm">{bottle.bottleSizeMl} mL</td>
                              <td className="px-4 py-3 text-right text-sm">{formatCurrency(bottle.unitCost)}</td>
                              <td className="px-4 py-3 text-right text-sm">{bottle.poursPerBottle || '-'}</td>
                              <td className="px-4 py-3 text-right">
                                <span className="font-medium text-green-600">
                                  {bottle.pourCost ? formatCurrency(bottle.pourCost) : '-'}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-right text-sm">
                                <span className={bottle.lowStockAlert && bottle.currentStock <= bottle.lowStockAlert ? 'text-red-600 font-medium' : ''}>
                                  {bottle.currentStock}
                                </span>
                              </td>
                              <td className="px-4 py-3 text-right">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => { setEditingBottle(bottle); setShowBottleModal(true); }}
                                >
                                  Edit
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </Card>
                )}
              </div>
            )}

            {/* Categories Tab */}
            {activeTab === 'categories' && (
              <div>
                <div className="flex justify-end mb-4">
                  <Button onClick={() => { setEditingCategory(null); setShowCategoryModal(true); }}>
                    + Add Category
                  </Button>
                </div>

                {categories.length === 0 ? (
                  <Card>
                    <CardContent className="py-12 text-center">
                      <p className="text-gray-500 mb-4">No spirit categories yet</p>
                      <Button onClick={() => { setEditingCategory(null); setShowCategoryModal(true); }}>
                        Create Your First Category
                      </Button>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {categories.map(category => (
                      <Card key={category.id}>
                        <CardHeader className="flex flex-row items-center justify-between pb-2">
                          <CardTitle className="text-lg">{category.name}</CardTitle>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => { setEditingCategory(category); setShowCategoryModal(true); }}
                            >
                              Edit
                            </Button>
                          </div>
                        </CardHeader>
                        <CardContent>
                          {category.description && (
                            <p className="text-sm text-gray-500 mb-3">{category.description}</p>
                          )}
                          <div className="flex gap-4 text-sm">
                            <div>
                              <span className="text-gray-500">Bottles:</span>
                              <span className="ml-1 font-medium">{category.bottleCount}</span>
                            </div>
                            <div>
                              <span className="text-gray-500">Modifier Groups:</span>
                              <span className="ml-1 font-medium">{category.modifierGroupCount}</span>
                            </div>
                          </div>
                          {!category.isActive && (
                            <span className="inline-block mt-2 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                              Inactive
                            </span>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Recipes Tab */}
            {activeTab === 'recipes' && (
              <div>
                {/* Summary Cards */}
                <div className="grid grid-cols-4 gap-4 mb-6">
                  <Card>
                    <CardContent className="p-4 text-center">
                      <div className="text-2xl font-bold">{recipeSummary.total}</div>
                      <div className="text-sm text-gray-500">Total Cocktails</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4 text-center">
                      <div className="text-2xl font-bold text-green-600">{recipeSummary.withRecipes}</div>
                      <div className="text-sm text-gray-500">With Recipes</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4 text-center">
                      <div className="text-2xl font-bold text-orange-600">{recipeSummary.withoutRecipes}</div>
                      <div className="text-sm text-gray-500">Need Recipes</div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="p-4 text-center">
                      <div className="text-2xl font-bold text-blue-600">{recipeSummary.averageMargin}%</div>
                      <div className="text-sm text-gray-500">Avg Margin</div>
                    </CardContent>
                  </Card>
                </div>

                {cocktails.length === 0 ? (
                  <Card>
                    <CardContent className="py-12 text-center">
                      <p className="text-gray-500 mb-4">No cocktails found in your menu</p>
                      <p className="text-sm text-gray-400">Add items to a &quot;Liquor&quot; category to see them here</p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-4">
                    {cocktails.map(cocktail => (
                      <Card key={cocktail.id}>
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <h3 className="font-bold text-lg">{cocktail.name}</h3>
                                <span
                                  className="px-2 py-0.5 rounded text-xs"
                                  style={{ backgroundColor: cocktail.category.color + '20', color: cocktail.category.color }}
                                >
                                  {cocktail.category.name}
                                </span>
                                {cocktail.hasRecipe ? (
                                  <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded text-xs">
                                    Recipe Set
                                  </span>
                                ) : (
                                  <span className="bg-orange-100 text-orange-700 px-2 py-0.5 rounded text-xs">
                                    Needs Recipe
                                  </span>
                                )}
                              </div>
                              {cocktail.description && (
                                <p className="text-sm text-gray-500 mt-1">{cocktail.description}</p>
                              )}
                              <div className="flex items-center gap-6 mt-2 text-sm">
                                <div>
                                  <span className="text-gray-500">Sell Price:</span>
                                  <span className="ml-1 font-medium">{formatCurrency(cocktail.sellPrice)}</span>
                                </div>
                                {cocktail.hasRecipe && (
                                  <>
                                    <div>
                                      <span className="text-gray-500">Pour Cost:</span>
                                      <span className="ml-1 font-medium text-red-600">{formatCurrency(cocktail.totalPourCost)}</span>
                                    </div>
                                    <div>
                                      <span className="text-gray-500">Profit:</span>
                                      <span className="ml-1 font-medium text-green-600">{formatCurrency(cocktail.grossProfit)}</span>
                                    </div>
                                    <div>
                                      <span className="text-gray-500">Margin:</span>
                                      <span className={`ml-1 font-medium ${cocktail.profitMargin >= 70 ? 'text-green-600' : cocktail.profitMargin >= 50 ? 'text-yellow-600' : 'text-red-600'}`}>
                                        {cocktail.profitMargin}%
                                      </span>
                                    </div>
                                  </>
                                )}
                              </div>
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => { setEditingCocktail(cocktail); setShowRecipeModal(true); }}
                            >
                              {cocktail.hasRecipe ? 'Edit Recipe' : 'Add Recipe'}
                            </Button>
                          </div>

                          {/* Show ingredients if recipe exists */}
                          {cocktail.hasRecipe && cocktail.ingredients && (
                            <div className="mt-4 pt-4 border-t">
                              <h4 className="text-sm font-medium mb-2">Ingredients:</h4>
                              <div className="flex flex-wrap gap-2">
                                {cocktail.ingredients.map(ing => (
                                  <div
                                    key={ing.id}
                                    className="bg-gray-50 border rounded px-3 py-1.5 text-sm"
                                  >
                                    <span className="font-medium">{ing.pourCount}x</span>
                                    <span className="ml-1">{ing.bottleProductName}</span>
                                    <span className={`ml-2 px-1.5 py-0.5 rounded text-xs ${getTierColor(ing.tier)}`}>
                                      {getTierLabel(ing.tier)}
                                    </span>
                                    <span className="ml-2 text-gray-500">{formatCurrency(ing.ingredientCost)}</span>
                                    {ing.isSubstitutable && (
                                      <span className="ml-1 text-blue-500 text-xs" title="Can be substituted for different tier">*</span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Category Modal */}
      {showCategoryModal && (
        <CategoryModal
          category={editingCategory}
          onSave={async (data) => {
            const method = editingCategory ? 'PUT' : 'POST'
            const url = editingCategory ? `/api/liquor/categories/${editingCategory.id}` : '/api/liquor/categories'
            const res = await fetch(url, {
              method,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(data),
            })
            if (res.ok) {
              await loadCategories()
              setShowCategoryModal(false)
              setEditingCategory(null)
            }
          }}
          onDelete={editingCategory ? async () => {
            if (!confirm('Delete this category?')) return
            const res = await fetch(`/api/liquor/categories/${editingCategory.id}`, { method: 'DELETE' })
            if (res.ok) {
              await loadCategories()
              setShowCategoryModal(false)
              setEditingCategory(null)
            } else {
              const err = await res.json()
              alert(err.error || 'Failed to delete')
            }
          } : undefined}
          onClose={() => { setShowCategoryModal(false); setEditingCategory(null); }}
        />
      )}

      {/* Bottle Modal */}
      {showBottleModal && (
        <BottleModal
          bottle={editingBottle}
          categories={categories}
          onSave={async (data) => {
            const method = editingBottle ? 'PUT' : 'POST'
            const url = editingBottle ? `/api/liquor/bottles/${editingBottle.id}` : '/api/liquor/bottles'
            const res = await fetch(url, {
              method,
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(data),
            })
            if (res.ok) {
              await loadBottles()
              setShowBottleModal(false)
              setEditingBottle(null)
            }
          }}
          onDelete={editingBottle ? async () => {
            if (!confirm('Delete this bottle?')) return
            const res = await fetch(`/api/liquor/bottles/${editingBottle.id}`, { method: 'DELETE' })
            if (res.ok) {
              await loadBottles()
              setShowBottleModal(false)
              setEditingBottle(null)
            } else {
              const err = await res.json()
              alert(err.error || 'Failed to delete')
            }
          } : undefined}
          onClose={() => { setShowBottleModal(false); setEditingBottle(null); }}
        />
      )}

      {/* Recipe Modal */}
      {showRecipeModal && editingCocktail && (
        <RecipeModal
          cocktail={editingCocktail}
          bottles={bottles}
          onSave={async (ingredients) => {
            const res = await fetch(`/api/menu/items/${editingCocktail.id}/recipe`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ingredients }),
            })
            if (res.ok) {
              await loadCocktails()
              setShowRecipeModal(false)
              setEditingCocktail(null)
            }
          }}
          onClose={() => { setShowRecipeModal(false); setEditingCocktail(null); }}
        />
      )}
    </div>
  )
}

// Category Modal Component
function CategoryModal({
  category,
  onSave,
  onDelete,
  onClose,
}: {
  category: SpiritCategory | null
  onSave: (data: { name: string; displayName?: string; description?: string; isActive?: boolean }) => Promise<void>
  onDelete?: () => Promise<void>
  onClose: () => void
}) {
  const [name, setName] = useState(category?.name || '')
  const [displayName, setDisplayName] = useState(category?.displayName || '')
  const [description, setDescription] = useState(category?.description || '')
  const [isActive, setIsActive] = useState(category?.isActive ?? true)
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    await onSave({ name, displayName: displayName || undefined, description: description || undefined, isActive })
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-md w-full">
        <div className="p-6 border-b">
          <h2 className="text-xl font-bold">{category ? 'Edit Category' : 'New Spirit Category'}</h2>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Name *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full border rounded-lg px-3 py-2"
              placeholder="e.g., Tequila, Vodka, Rum"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Display Name</label>
            <input
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              className="w-full border rounded-lg px-3 py-2"
              placeholder="Optional display name"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full border rounded-lg px-3 py-2"
              rows={2}
            />
          </div>
          <div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={isActive}
                onChange={e => setIsActive(e.target.checked)}
              />
              <span>Active</span>
            </label>
          </div>
          <div className="flex justify-between pt-4 border-t">
            <div>
              {onDelete && (
                <Button type="button" variant="danger" onClick={onDelete}>
                  Delete
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving || !name.trim()}>
                {saving ? 'Saving...' : category ? 'Save Changes' : 'Create'}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

// Bottle Modal Component
function BottleModal({
  bottle,
  categories,
  onSave,
  onDelete,
  onClose,
}: {
  bottle: BottleProduct | null
  categories: SpiritCategory[]
  onSave: (data: any) => Promise<void>
  onDelete?: () => Promise<void>
  onClose: () => void
}) {
  const [name, setName] = useState(bottle?.name || '')
  const [brand, setBrand] = useState(bottle?.brand || '')
  const [spiritCategoryId, setSpiritCategoryId] = useState(bottle?.spiritCategoryId || categories[0]?.id || '')
  const [tier, setTier] = useState(bottle?.tier || 'well')
  const [bottleSizeMl, setBottleSizeMl] = useState(bottle?.bottleSizeMl?.toString() || '750')
  const [unitCost, setUnitCost] = useState(bottle?.unitCost?.toString() || '')
  const [pourSizeOz, setPourSizeOz] = useState(bottle?.pourSizeOz?.toString() || '')
  const [currentStock, setCurrentStock] = useState(bottle?.currentStock?.toString() || '0')
  const [lowStockAlert, setLowStockAlert] = useState(bottle?.lowStockAlert?.toString() || '')
  const [isActive, setIsActive] = useState(bottle?.isActive ?? true)
  const [saving, setSaving] = useState(false)

  // Calculate pour metrics preview
  const effectivePourSizeOz = pourSizeOz ? parseFloat(pourSizeOz) : LIQUOR_DEFAULTS.pourSizeOz
  const bottleMl = parseInt(bottleSizeMl) || 0
  const cost = parseFloat(unitCost) || 0
  const poursPerBottle = bottleMl > 0 ? Math.floor(bottleMl / (effectivePourSizeOz * LIQUOR_DEFAULTS.mlPerOz)) : 0
  const pourCost = poursPerBottle > 0 ? cost / poursPerBottle : 0

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !spiritCategoryId || !bottleSizeMl || !unitCost) return
    setSaving(true)
    await onSave({
      name,
      brand: brand || undefined,
      spiritCategoryId,
      tier,
      bottleSizeMl: parseInt(bottleSizeMl),
      unitCost: parseFloat(unitCost),
      pourSizeOz: pourSizeOz ? parseFloat(pourSizeOz) : undefined,
      currentStock: parseInt(currentStock) || 0,
      lowStockAlert: lowStockAlert ? parseInt(lowStockAlert) : undefined,
      isActive,
    })
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b">
          <h2 className="text-xl font-bold">{bottle ? 'Edit Bottle' : 'New Bottle Product'}</h2>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Product Name *</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                className="w-full border rounded-lg px-3 py-2"
                placeholder="e.g., Patron Silver"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Brand</label>
              <input
                type="text"
                value={brand}
                onChange={e => setBrand(e.target.value)}
                className="w-full border rounded-lg px-3 py-2"
                placeholder="e.g., Patron"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Spirit Category *</label>
              <select
                value={spiritCategoryId}
                onChange={e => setSpiritCategoryId(e.target.value)}
                className="w-full border rounded-lg px-3 py-2"
                required
              >
                <option value="">Select Category</option>
                {categories.map(cat => (
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Tier *</label>
              <select
                value={tier}
                onChange={e => setTier(e.target.value)}
                className="w-full border rounded-lg px-3 py-2"
              >
                {SPIRIT_TIERS.map(t => (
                  <option key={t.value} value={t.value}>{t.label} - {t.description}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Bottle Size (mL) *</label>
              <select
                value={bottleSizeMl}
                onChange={e => setBottleSizeMl(e.target.value)}
                className="w-full border rounded-lg px-3 py-2"
              >
                {BOTTLE_SIZES.map(size => (
                  <option key={size.value} value={size.value}>{size.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Unit Cost ($) *</label>
              <input
                type="number"
                step="0.01"
                value={unitCost}
                onChange={e => setUnitCost(e.target.value)}
                className="w-full border rounded-lg px-3 py-2"
                placeholder="e.g., 42.99"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Pour Size (oz)</label>
              <input
                type="number"
                step="0.25"
                value={pourSizeOz}
                onChange={e => setPourSizeOz(e.target.value)}
                className="w-full border rounded-lg px-3 py-2"
                placeholder={`Default: ${LIQUOR_DEFAULTS.pourSizeOz}`}
              />
            </div>
          </div>

          {/* Calculated Preview */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h4 className="font-medium text-blue-900 mb-2">Calculated Metrics</h4>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-blue-700">Pours per Bottle:</span>
                <span className="ml-2 font-bold text-blue-900">{poursPerBottle}</span>
              </div>
              <div>
                <span className="text-blue-700">Pour Cost:</span>
                <span className="ml-2 font-bold text-green-600">{formatCurrency(pourCost)}</span>
              </div>
              <div>
                <span className="text-blue-700">Pour Size:</span>
                <span className="ml-2 font-bold text-blue-900">{effectivePourSizeOz} oz</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Current Stock (bottles)</label>
              <input
                type="number"
                value={currentStock}
                onChange={e => setCurrentStock(e.target.value)}
                className="w-full border rounded-lg px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Low Stock Alert</label>
              <input
                type="number"
                value={lowStockAlert}
                onChange={e => setLowStockAlert(e.target.value)}
                className="w-full border rounded-lg px-3 py-2"
                placeholder="Alert when below this"
              />
            </div>
          </div>

          <div>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={isActive}
                onChange={e => setIsActive(e.target.checked)}
              />
              <span>Active</span>
            </label>
          </div>

          <div className="flex justify-between pt-4 border-t">
            <div>
              {onDelete && (
                <Button type="button" variant="danger" onClick={onDelete}>
                  Delete
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving || !name.trim() || !spiritCategoryId || !unitCost}>
                {saving ? 'Saving...' : bottle ? 'Save Changes' : 'Create'}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}

// Recipe Modal Component
function RecipeModal({
  cocktail,
  bottles,
  onSave,
  onClose,
}: {
  cocktail: RecipeCocktail
  bottles: BottleProduct[]
  onSave: (ingredients: { bottleProductId: string; pourCount: number; isSubstitutable: boolean; sortOrder: number }[]) => Promise<void>
  onClose: () => void
}) {
  const [ingredients, setIngredients] = useState<{
    bottleProductId: string
    pourCount: number
    isSubstitutable: boolean
    sortOrder: number
  }[]>(
    cocktail.ingredients?.map((ing, i) => ({
      bottleProductId: ing.bottleProductId,
      pourCount: ing.pourCount,
      isSubstitutable: ing.isSubstitutable,
      sortOrder: i,
    })) || []
  )
  const [saving, setSaving] = useState(false)

  // Group bottles by category for easier selection
  const bottlesByCategory = bottles.reduce((acc, bottle) => {
    const cat = bottle.spiritCategory.name
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(bottle)
    return acc
  }, {} as Record<string, BottleProduct[]>)

  const addIngredient = () => {
    setIngredients([...ingredients, {
      bottleProductId: '',
      pourCount: 1,
      isSubstitutable: true,
      sortOrder: ingredients.length,
    }])
  }

  const removeIngredient = (index: number) => {
    setIngredients(ingredients.filter((_, i) => i !== index))
  }

  const updateIngredient = (index: number, field: string, value: any) => {
    setIngredients(ingredients.map((ing, i) =>
      i === index ? { ...ing, [field]: value } : ing
    ))
  }

  // Calculate total pour cost
  const totalPourCost = ingredients.reduce((sum, ing) => {
    const bottle = bottles.find(b => b.id === ing.bottleProductId)
    return sum + (bottle?.pourCost || 0) * ing.pourCount
  }, 0)

  const profitMargin = cocktail.sellPrice > 0
    ? ((cocktail.sellPrice - totalPourCost) / cocktail.sellPrice) * 100
    : 0

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const validIngredients = ingredients.filter(ing => ing.bottleProductId)
    setSaving(true)
    await onSave(validIngredients)
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b">
          <h2 className="text-xl font-bold">Recipe: {cocktail.name}</h2>
          <p className="text-sm text-gray-500">Sell Price: {formatCurrency(cocktail.sellPrice)}</p>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="font-medium">Ingredients</h3>
            <Button type="button" variant="outline" size="sm" onClick={addIngredient}>
              + Add Ingredient
            </Button>
          </div>

          {ingredients.length === 0 ? (
            <div className="text-center py-8 bg-gray-50 rounded">
              <p className="text-gray-500">No ingredients yet</p>
              <Button type="button" variant="ghost" onClick={addIngredient} className="mt-2">
                Add First Ingredient
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              {ingredients.map((ing, index) => {
                const selectedBottle = bottles.find(b => b.id === ing.bottleProductId)
                const ingredientCost = (selectedBottle?.pourCost || 0) * ing.pourCount
                return (
                  <div key={index} className="border rounded-lg p-4 bg-gray-50">
                    <div className="flex gap-4 items-start">
                      <div className="flex-1">
                        <label className="block text-xs text-gray-500 mb-1">Spirit</label>
                        <select
                          value={ing.bottleProductId}
                          onChange={e => updateIngredient(index, 'bottleProductId', e.target.value)}
                          className="w-full border rounded px-2 py-2"
                        >
                          <option value="">Select...</option>
                          {Object.entries(bottlesByCategory).map(([category, catBottles]) => (
                            <optgroup key={category} label={category}>
                              {catBottles.map(b => (
                                <option key={b.id} value={b.id}>
                                  {b.name} ({b.tier}) - {formatCurrency(b.pourCost || 0)}/pour
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      </div>
                      <div className="w-24">
                        <label className="block text-xs text-gray-500 mb-1">Pours</label>
                        <input
                          type="number"
                          step="0.5"
                          min="0.5"
                          value={ing.pourCount}
                          onChange={e => updateIngredient(index, 'pourCount', parseFloat(e.target.value) || 1)}
                          className="w-full border rounded px-2 py-2 text-center"
                        />
                      </div>
                      <div className="w-24 text-center">
                        <label className="block text-xs text-gray-500 mb-1">Cost</label>
                        <div className="py-2 font-medium text-green-600">
                          {formatCurrency(ingredientCost)}
                        </div>
                      </div>
                      <div className="w-24">
                        <label className="block text-xs text-gray-500 mb-1">Swap?</label>
                        <label className="flex items-center gap-1 py-2">
                          <input
                            type="checkbox"
                            checked={ing.isSubstitutable}
                            onChange={e => updateIngredient(index, 'isSubstitutable', e.target.checked)}
                          />
                          <span className="text-sm">Yes</span>
                        </label>
                      </div>
                      <div className="pt-5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeIngredient(index)}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Summary */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="grid grid-cols-4 gap-4 text-center">
              <div>
                <div className="text-sm text-blue-700">Sell Price</div>
                <div className="text-lg font-bold">{formatCurrency(cocktail.sellPrice)}</div>
              </div>
              <div>
                <div className="text-sm text-blue-700">Pour Cost</div>
                <div className="text-lg font-bold text-red-600">{formatCurrency(totalPourCost)}</div>
              </div>
              <div>
                <div className="text-sm text-blue-700">Profit</div>
                <div className="text-lg font-bold text-green-600">
                  {formatCurrency(cocktail.sellPrice - totalPourCost)}
                </div>
              </div>
              <div>
                <div className="text-sm text-blue-700">Margin</div>
                <div className={`text-lg font-bold ${profitMargin >= 70 ? 'text-green-600' : profitMargin >= 50 ? 'text-yellow-600' : 'text-red-600'}`}>
                  {profitMargin.toFixed(1)}%
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving...' : 'Save Recipe'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function LiquorBuilderPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen">Loading...</div>}>
      <LiquorBuilderContent />
    </Suspense>
  )
}
