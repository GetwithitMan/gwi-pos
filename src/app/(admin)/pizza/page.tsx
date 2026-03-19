'use client'

import { useState, useEffect, useCallback } from 'react'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { useAuthStore } from '@/stores/auth-store'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import type { IngredientLibraryItem, IngredientCategory } from '@/components/menu/IngredientHierarchyPicker'
import {
  PizzaConfig,
  Printer,
  PizzaSize,
  PizzaCrust,
  PizzaSauce,
  PizzaCheese,
  PizzaTopping,
  PizzaSpecialty,
  PizzaMenuItem,
} from './types'
import {
  ConfigTab,
  SizesTab,
  CrustsTab,
  SaucesTab,
  CheesesTab,
  ToppingsTab,
  SpecialtiesTab,
} from './PizzaTabs'
import {
  SizeModal,
  CrustModal,
  SauceModal,
  CheeseModal,
  ToppingModal,
  SpecialtyModal,
} from './PizzaModals'

type TabType = 'config' | 'sizes' | 'crusts' | 'sauces' | 'cheeses' | 'toppings' | 'specialties'

export default function PizzaAdminPage() {
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/pizza' })
  const locationId = useAuthStore(s => s.employee?.location?.id)
  const employeeId = useAuthStore(s => s.employee?.id)
  const [activeTab, setActiveTab] = useState<TabType>('sizes')
  const [isLoading, setIsLoading] = useState(true)
  const [confirmAction, setConfirmAction] = useState<{ action: () => void; title: string; message: string } | null>(null)

  // Data states
  const [config, setConfig] = useState<PizzaConfig | null>(null)
  const [sizes, setSizes] = useState<PizzaSize[]>([])
  const [crusts, setCrusts] = useState<PizzaCrust[]>([])
  const [sauces, setSauces] = useState<PizzaSauce[]>([])
  const [cheeses, setCheeses] = useState<PizzaCheese[]>([])
  const [toppings, setToppings] = useState<PizzaTopping[]>([])
  const [printers, setPrinters] = useState<Printer[]>([])
  const [specialties, setSpecialties] = useState<PizzaSpecialty[]>([])
  const [pizzaMenuItems, setPizzaMenuItems] = useState<PizzaMenuItem[]>([])

  // Ingredient data (for topping inventory linking)
  const [ingredientsLibrary, setIngredientsLibrary] = useState<IngredientLibraryItem[]>([])
  const [ingredientCategories, setIngredientCategories] = useState<IngredientCategory[]>([])
  const [ingredientInventoryMap, setIngredientInventoryMap] = useState<Record<string, string>>({})

  // Modal states
  const [showSizeModal, setShowSizeModal] = useState(false)
  const [showCrustModal, setShowCrustModal] = useState(false)
  const [showSauceModal, setShowSauceModal] = useState(false)
  const [showCheeseModal, setShowCheeseModal] = useState(false)
  const [showToppingModal, setShowToppingModal] = useState(false)
  const [showPrintSettingsModal, setShowPrintSettingsModal] = useState(false)
  const [showSpecialtyModal, setShowSpecialtyModal] = useState(false)

  // Edit states
  const [editingSize, setEditingSize] = useState<PizzaSize | null>(null)
  const [editingCrust, setEditingCrust] = useState<PizzaCrust | null>(null)
  const [editingSauce, setEditingSauce] = useState<PizzaSauce | null>(null)
  const [editingCheese, setEditingCheese] = useState<PizzaCheese | null>(null)
  const [editingTopping, setEditingTopping] = useState<PizzaTopping | null>(null)
  const [editingSpecialty, setEditingSpecialty] = useState<PizzaSpecialty | null>(null)

  const loadIngredientData = useCallback(async () => {
    if (!locationId) return
    try {
      const params = `locationId=${locationId}${employeeId ? `&requestingEmployeeId=${employeeId}` : ''}`
      const [ingRes, catRes] = await Promise.all([
        fetch(`/api/ingredients?${params}`),
        fetch(`/api/ingredient-categories?${params}`),
      ])
      if (ingRes.ok) {
        const ingData = await ingRes.json()
        const rawIngredients = ingData.data || []
        const ingredients = rawIngredients.map((ing: any) => ({
          ...ing,
          categoryName: ing.categoryRelation?.name || ing.category || null,
          categoryId: ing.categoryId || null,
          parentName: ing.parentIngredient?.name || null,
          needsVerification: ing.needsVerification || false,
        }))
        setIngredientsLibrary(ingredients)
        // Build ingredientId → inventoryItemId map
        const map: Record<string, string> = {}
        for (const ing of rawIngredients) {
          if (ing.inventoryItemId) map[ing.id] = ing.inventoryItemId
        }
        setIngredientInventoryMap(map)
      }
      if (catRes.ok) {
        const catData = await catRes.json()
        setIngredientCategories(catData.data || [])
      }
    } catch (error) {
      console.error('Failed to load ingredient data:', error)
    }
  }, [locationId, employeeId])

  const handleIngredientCreated = useCallback((ingredient: any) => {
    const normalized: IngredientLibraryItem = {
      id: ingredient.id,
      name: ingredient.name,
      category: ingredient.category || null,
      categoryName: ingredient.categoryRelation?.name || ingredient.category || null,
      categoryId: ingredient.categoryId || null,
      parentIngredientId: ingredient.parentIngredientId || null,
      parentName: ingredient.parentIngredient?.name || null,
      needsVerification: ingredient.needsVerification ?? true,
      allowNo: ingredient.allowNo ?? true,
      allowLite: ingredient.allowLite ?? true,
      allowExtra: ingredient.allowExtra ?? true,
      allowOnSide: ingredient.allowOnSide ?? false,
      extraPrice: ingredient.extraPrice ?? 0,
      allowSwap: ingredient.allowSwap ?? false,
      swapModifierGroupId: null,
      swapUpcharge: 0,
    }
    setIngredientsLibrary(prev => {
      if (prev.some(i => i.id === normalized.id)) return prev
      return [...prev, normalized]
    })
    if (ingredient.inventoryItemId) {
      setIngredientInventoryMap(prev => ({ ...prev, [ingredient.id]: ingredient.inventoryItemId }))
    }
  }, [])

  const handleCategoryCreated = useCallback((category: IngredientCategory) => {
    setIngredientCategories(prev => {
      if (prev.some(c => c.id === category.id)) return prev
      return [...prev, category]
    })
  }, [])

  useEffect(() => {
    loadAllData()
    loadIngredientData()
  }, [loadIngredientData])

  const loadAllData = async () => {
    setIsLoading(true)
    try {
      const [pizzaRes, specialtiesRes, menuItemsRes] = await Promise.all([
        fetch('/api/pizza'),
        fetch('/api/pizza/specialties'),
        fetch('/api/menu/items'),
      ])

      if (pizzaRes.ok) {
        const data = await pizzaRes.json()
        setConfig(data.data.config)
        setSizes(data.data.sizes)
        setCrusts(data.data.crusts)
        setSauces(data.data.sauces)
        setCheeses(data.data.cheeses)
        setToppings(data.data.toppings)
        setPrinters(data.data.printers || [])
      }

      if (specialtiesRes.ok) {
        const specialtiesData = await specialtiesRes.json()
        // API returns array directly (not wrapped in { data: [] })
        setSpecialties(Array.isArray(specialtiesData) ? specialtiesData : (specialtiesData.data || []))
      }

      if (menuItemsRes.ok) {
        const menuData = await menuItemsRes.json()
        const allItems = menuData.data?.items || menuData.data || []
        // Filter to pizza items (API returns isPizza flag based on itemType or categoryType)
        const pizzaItems: PizzaMenuItem[] = allItems
          .filter((item: any) => item.isPizza)
          .map((item: any) => ({
            id: item.id,
            name: item.name,
            price: typeof item.price === 'string' ? parseFloat(item.price) : (item.price || 0),
            categoryName: item.categoryName || item.category?.name,
          }))
        // Fallback: include items from categories containing "pizza" in name
        if (pizzaItems.length === 0) {
          const fallbackItems: PizzaMenuItem[] = allItems
            .filter((item: any) => {
              const catName = (item.categoryName || item.category?.name || '').toLowerCase()
              return catName.includes('pizza') || catName.includes('pie')
            })
            .map((item: any) => ({
              id: item.id,
              name: item.name,
              price: typeof item.price === 'string' ? parseFloat(item.price) : (item.price || 0),
              categoryName: item.categoryName || item.category?.name,
            }))
          setPizzaMenuItems(fallbackItems)
        } else {
          setPizzaMenuItems(pizzaItems)
        }
      }
    } catch (error) {
      console.error('Failed to load pizza data:', error)
    } finally {
      setIsLoading(false)
    }
  }

  // Config handlers
  const handleSaveConfig = async (updates: Partial<PizzaConfig>) => {
    try {
      const response = await fetch('/api/pizza/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      })
      if (response.ok) {
        const data = await response.json()
        setConfig(data.data)
      }
    } catch (error) {
      console.error('Failed to save config:', error)
    }
  }

  // Size handlers
  const handleSaveSize = async (sizeData: Partial<PizzaSize>) => {
    try {
      const method = editingSize ? 'PATCH' : 'POST'
      const url = editingSize ? `/api/pizza/sizes/${editingSize.id}` : '/api/pizza/sizes'
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sizeData)
      })
      if (response.ok) {
        await loadAllData()
        setShowSizeModal(false)
        setEditingSize(null)
      }
    } catch (error) {
      console.error('Failed to save size:', error)
    }
  }

  const handleDeleteSize = (id: string) => {
    setConfirmAction({
      title: 'Delete Size',
      message: 'Delete this size?',
      action: async () => {
        try {
          await fetch(`/api/pizza/sizes/${id}`, { method: 'DELETE' })
          await loadAllData()
        } catch (error) {
          console.error('Failed to delete size:', error)
        }
      },
    })
  }

  // Crust handlers
  const handleSaveCrust = async (crustData: Partial<PizzaCrust>) => {
    try {
      const method = editingCrust ? 'PATCH' : 'POST'
      const url = editingCrust ? `/api/pizza/crusts/${editingCrust.id}` : '/api/pizza/crusts'
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(crustData)
      })
      if (response.ok) {
        await loadAllData()
        setShowCrustModal(false)
        setEditingCrust(null)
      }
    } catch (error) {
      console.error('Failed to save crust:', error)
    }
  }

  const handleDeleteCrust = (id: string) => {
    setConfirmAction({
      title: 'Delete Crust',
      message: 'Delete this crust?',
      action: async () => {
        try {
          await fetch(`/api/pizza/crusts/${id}`, { method: 'DELETE' })
          await loadAllData()
        } catch (error) {
          console.error('Failed to delete crust:', error)
        }
      },
    })
  }

  // Sauce handlers
  const handleSaveSauce = async (sauceData: Partial<PizzaSauce>) => {
    try {
      const method = editingSauce ? 'PATCH' : 'POST'
      const url = editingSauce ? `/api/pizza/sauces/${editingSauce.id}` : '/api/pizza/sauces'
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sauceData)
      })
      if (response.ok) {
        await loadAllData()
        setShowSauceModal(false)
        setEditingSauce(null)
      }
    } catch (error) {
      console.error('Failed to save sauce:', error)
    }
  }

  const handleDeleteSauce = (id: string) => {
    setConfirmAction({
      title: 'Delete Sauce',
      message: 'Delete this sauce?',
      action: async () => {
        try {
          await fetch(`/api/pizza/sauces/${id}`, { method: 'DELETE' })
          await loadAllData()
        } catch (error) {
          console.error('Failed to delete sauce:', error)
        }
      },
    })
  }

  // Cheese handlers
  const handleSaveCheese = async (cheeseData: Partial<PizzaCheese>) => {
    try {
      const method = editingCheese ? 'PATCH' : 'POST'
      const url = editingCheese ? `/api/pizza/cheeses/${editingCheese.id}` : '/api/pizza/cheeses'
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cheeseData)
      })
      if (response.ok) {
        await loadAllData()
        setShowCheeseModal(false)
        setEditingCheese(null)
      }
    } catch (error) {
      console.error('Failed to save cheese:', error)
    }
  }

  const handleDeleteCheese = (id: string) => {
    setConfirmAction({
      title: 'Delete Cheese',
      message: 'Delete this cheese?',
      action: async () => {
        try {
          await fetch(`/api/pizza/cheeses/${id}`, { method: 'DELETE' })
          await loadAllData()
        } catch (error) {
          console.error('Failed to delete cheese:', error)
        }
      },
    })
  }

  // Topping handlers
  const handleSaveTopping = async (toppingData: Partial<PizzaTopping>) => {
    try {
      const method = editingTopping ? 'PATCH' : 'POST'
      const url = editingTopping ? `/api/pizza/toppings/${editingTopping.id}` : '/api/pizza/toppings'
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toppingData)
      })
      if (response.ok) {
        await loadAllData()
        setShowToppingModal(false)
        setEditingTopping(null)
      }
    } catch (error) {
      console.error('Failed to save topping:', error)
    }
  }

  const handleDeleteTopping = async (id: string) => {
    if (!confirm('Delete this topping?')) return
    try {
      await fetch(`/api/pizza/toppings/${id}`, { method: 'DELETE' })
      await loadAllData()
    } catch (error) {
      console.error('Failed to delete topping:', error)
    }
  }

  // Specialty handlers
  const handleSaveSpecialty = async (data: any) => {
    try {
      if (editingSpecialty) {
        const response = await fetch(`/api/pizza/specialties/${editingSpecialty.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        })
        if (response.ok) {
          await loadAllData()
          setShowSpecialtyModal(false)
          setEditingSpecialty(null)
        }
      } else {
        const response = await fetch('/api/pizza/specialties', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        })
        if (response.ok) {
          await loadAllData()
          setShowSpecialtyModal(false)
          setEditingSpecialty(null)
        }
      }
    } catch (error) {
      console.error('Failed to save specialty:', error)
    }
  }

  const handleDeleteSpecialty = (id: string) => {
    setConfirmAction({
      title: 'Delete Specialty',
      message: 'Delete this specialty pizza? The menu item itself will not be deleted.',
      action: async () => {
        try {
          await fetch(`/api/pizza/specialties/${id}`, { method: 'DELETE' })
          await loadAllData()
        } catch (error) {
          console.error('Failed to delete specialty:', error)
        }
      },
    })
  }

  if (!hydrated) return null

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 to-red-50 p-8">
        <div className="max-w-6xl mx-auto">
          <div className="text-center py-12 text-gray-900">Loading pizza configuration...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-red-50 p-6">
      <AdminPageHeader
        title="Pizza Builder Settings"
        subtitle="Configure sizes, crusts, sauces, cheeses, toppings, and specialty pizzas"
        breadcrumbs={[{ label: 'Menu', href: '/menu' }]}
      />
      <div className="max-w-6xl mx-auto mt-6">

        {/* Tabs */}
        <div className="flex gap-2 mb-6 border-b border-gray-200 pb-4 overflow-x-auto">
          {[
            { id: 'config', label: 'Settings', icon: '⚙️' },
            { id: 'sizes', label: 'Sizes', icon: '📐' },
            { id: 'crusts', label: 'Crusts', icon: '🍞' },
            { id: 'sauces', label: 'Sauces', icon: '🥫' },
            { id: 'cheeses', label: 'Cheeses', icon: '🧀' },
            { id: 'toppings', label: 'Toppings', icon: '🍕' },
            { id: 'specialties', label: 'Specialties', icon: '⭐' },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as TabType)}
              className={`px-4 py-2 rounded-lg font-medium transition-all whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-orange-500 text-white shadow-md'
                  : 'bg-white/80 text-gray-900 hover:bg-orange-100'
              }`}
            >
              <span className="mr-2">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        {activeTab === 'config' && (
          <ConfigTab
            config={config}
            printers={printers}
            onSave={handleSaveConfig}
            showPrintSettings={showPrintSettingsModal}
            setShowPrintSettings={setShowPrintSettingsModal}
          />
        )}

        {activeTab === 'sizes' && (
          <SizesTab
            sizes={sizes}
            onAdd={() => { setEditingSize(null); setShowSizeModal(true) }}
            onEdit={(size) => { setEditingSize(size); setShowSizeModal(true) }}
            onDelete={handleDeleteSize}
          />
        )}

        {activeTab === 'crusts' && (
          <CrustsTab
            crusts={crusts}
            onAdd={() => { setEditingCrust(null); setShowCrustModal(true) }}
            onEdit={(crust) => { setEditingCrust(crust); setShowCrustModal(true) }}
            onDelete={handleDeleteCrust}
          />
        )}

        {activeTab === 'sauces' && (
          <SaucesTab
            sauces={sauces}
            onAdd={() => { setEditingSauce(null); setShowSauceModal(true) }}
            onEdit={(sauce) => { setEditingSauce(sauce); setShowSauceModal(true) }}
            onDelete={handleDeleteSauce}
          />
        )}

        {activeTab === 'cheeses' && (
          <CheesesTab
            cheeses={cheeses}
            onAdd={() => { setEditingCheese(null); setShowCheeseModal(true) }}
            onEdit={(cheese) => { setEditingCheese(cheese); setShowCheeseModal(true) }}
            onDelete={handleDeleteCheese}
          />
        )}

        {activeTab === 'toppings' && (
          <ToppingsTab
            toppings={toppings}
            onAdd={() => { setEditingTopping(null); setShowToppingModal(true) }}
            onEdit={(topping) => { setEditingTopping(topping); setShowToppingModal(true) }}
            onDelete={handleDeleteTopping}
          />
        )}

        {activeTab === 'specialties' && (
          <SpecialtiesTab
            specialties={specialties}
            onAdd={() => { setEditingSpecialty(null); setShowSpecialtyModal(true) }}
            onEdit={(specialty) => { setEditingSpecialty(specialty); setShowSpecialtyModal(true) }}
            onDelete={handleDeleteSpecialty}
          />
        )}

        {/* Modals */}
        {showSizeModal && (
          <SizeModal
            size={editingSize}
            onSave={handleSaveSize}
            onClose={() => { setShowSizeModal(false); setEditingSize(null) }}
            ingredientsLibrary={ingredientsLibrary}
            ingredientCategories={ingredientCategories}
            ingredientInventoryMap={ingredientInventoryMap}
            onIngredientCreated={handleIngredientCreated}
            onCategoryCreated={handleCategoryCreated}
            onIngredientDataRefresh={loadIngredientData}
          />
        )}

        {showCrustModal && (
          <CrustModal
            crust={editingCrust}
            onSave={handleSaveCrust}
            onClose={() => { setShowCrustModal(false); setEditingCrust(null) }}
            ingredientsLibrary={ingredientsLibrary}
            ingredientCategories={ingredientCategories}
            ingredientInventoryMap={ingredientInventoryMap}
            onIngredientCreated={handleIngredientCreated}
            onCategoryCreated={handleCategoryCreated}
            onIngredientDataRefresh={loadIngredientData}
          />
        )}

        {showSauceModal && (
          <SauceModal
            sauce={editingSauce}
            onSave={handleSaveSauce}
            onClose={() => { setShowSauceModal(false); setEditingSauce(null) }}
            ingredientsLibrary={ingredientsLibrary}
            ingredientCategories={ingredientCategories}
            ingredientInventoryMap={ingredientInventoryMap}
            onIngredientCreated={handleIngredientCreated}
            onCategoryCreated={handleCategoryCreated}
            onIngredientDataRefresh={loadIngredientData}
          />
        )}

        {showCheeseModal && (
          <CheeseModal
            cheese={editingCheese}
            onSave={handleSaveCheese}
            onClose={() => { setShowCheeseModal(false); setEditingCheese(null) }}
            ingredientsLibrary={ingredientsLibrary}
            ingredientCategories={ingredientCategories}
            ingredientInventoryMap={ingredientInventoryMap}
            onIngredientCreated={handleIngredientCreated}
            onCategoryCreated={handleCategoryCreated}
            onIngredientDataRefresh={loadIngredientData}
          />
        )}

        {showToppingModal && (
          <ToppingModal
            topping={editingTopping}
            onSave={handleSaveTopping}
            onClose={() => { setShowToppingModal(false); setEditingTopping(null) }}
            ingredientsLibrary={ingredientsLibrary}
            ingredientCategories={ingredientCategories}
            ingredientInventoryMap={ingredientInventoryMap}
            onIngredientCreated={handleIngredientCreated}
            onCategoryCreated={handleCategoryCreated}
            onIngredientDataRefresh={loadIngredientData}
          />
        )}

        {showSpecialtyModal && (
          <SpecialtyModal
            specialty={editingSpecialty}
            pizzaMenuItems={pizzaMenuItems}
            existingSpecialtyMenuItemIds={specialties.map(s => s.menuItemId)}
            crusts={crusts}
            sauces={sauces}
            cheeses={cheeses}
            toppings={toppings}
            onSave={handleSaveSpecialty}
            onClose={() => { setShowSpecialtyModal(false); setEditingSpecialty(null) }}
          />
        )}

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
    </div>
  )
}
