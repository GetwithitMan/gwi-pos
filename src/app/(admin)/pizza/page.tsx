'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '@/stores/auth-store'
import { formatCurrency } from '@/lib/utils'
import { PizzaPrintSettings } from '@/types/print'
import { PizzaPrintSettingsEditor } from '@/components/hardware/PizzaPrintSettingsEditor'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'

// Types
interface PizzaConfig {
  id: string
  maxSections: number
  defaultSections: number
  sectionOptions: number[]
  pricingMode: string
  hybridPricing: Record<string, number> | null
  freeToppingsEnabled: boolean
  freeToppingsCount: number
  freeToppingsMode: string
  extraToppingPrice: number | null
  showVisualBuilder: boolean
  showToppingList: boolean
  defaultToListView: boolean
  printerIds: string[]
  printSettings: PizzaPrintSettings | null
}

interface Printer {
  id: string
  name: string
  printerRole: 'receipt' | 'kitchen' | 'bar'
}

interface PizzaSize {
  id: string
  name: string
  displayName: string | null
  inches: number | null
  slices: number
  basePrice: number
  priceMultiplier: number
  toppingMultiplier: number
  freeToppings: number
  isDefault: boolean
  isActive: boolean
  sortOrder: number
}

interface PizzaCrust {
  id: string
  name: string
  displayName: string | null
  description: string | null
  price: number
  isDefault: boolean
  isActive: boolean
  sortOrder: number
}

interface PizzaSauce {
  id: string
  name: string
  displayName: string | null
  description: string | null
  price: number
  allowLight: boolean
  allowExtra: boolean
  extraPrice: number
  isDefault: boolean
  isActive: boolean
  sortOrder: number
}

interface PizzaCheese {
  id: string
  name: string
  displayName: string | null
  description: string | null
  price: number
  allowLight: boolean
  allowExtra: boolean
  extraPrice: number
  isDefault: boolean
  isActive: boolean
  sortOrder: number
}

interface PizzaTopping {
  id: string
  name: string
  displayName: string | null
  description: string | null
  category: string
  price: number
  extraPrice: number | null
  color: string | null
  isActive: boolean
  sortOrder: number
}

const TOPPING_CATEGORIES = [
  { value: 'meat', label: 'Meats', color: '#ef4444' },
  { value: 'veggie', label: 'Vegetables', color: '#22c55e' },
  { value: 'cheese', label: 'Cheeses', color: '#eab308' },
  { value: 'premium', label: 'Premium', color: '#a855f7' },
  { value: 'seafood', label: 'Seafood', color: '#3b82f6' },
  { value: 'standard', label: 'Standard', color: '#6b7280' },
]

type TabType = 'config' | 'sizes' | 'crusts' | 'sauces' | 'cheeses' | 'toppings'

export default function PizzaAdminPage() {
  const router = useRouter()
  const { isAuthenticated } = useAuthStore()
  const [activeTab, setActiveTab] = useState<TabType>('sizes')
  const [isLoading, setIsLoading] = useState(true)

  // Data states
  const [config, setConfig] = useState<PizzaConfig | null>(null)
  const [sizes, setSizes] = useState<PizzaSize[]>([])
  const [crusts, setCrusts] = useState<PizzaCrust[]>([])
  const [sauces, setSauces] = useState<PizzaSauce[]>([])
  const [cheeses, setCheeses] = useState<PizzaCheese[]>([])
  const [toppings, setToppings] = useState<PizzaTopping[]>([])
  const [printers, setPrinters] = useState<Printer[]>([])

  // Modal states
  const [showSizeModal, setShowSizeModal] = useState(false)
  const [showCrustModal, setShowCrustModal] = useState(false)
  const [showSauceModal, setShowSauceModal] = useState(false)
  const [showCheeseModal, setShowCheeseModal] = useState(false)
  const [showToppingModal, setShowToppingModal] = useState(false)
  const [showPrintSettingsModal, setShowPrintSettingsModal] = useState(false)

  // Edit states
  const [editingSize, setEditingSize] = useState<PizzaSize | null>(null)
  const [editingCrust, setEditingCrust] = useState<PizzaCrust | null>(null)
  const [editingSauce, setEditingSauce] = useState<PizzaSauce | null>(null)
  const [editingCheese, setEditingCheese] = useState<PizzaCheese | null>(null)
  const [editingTopping, setEditingTopping] = useState<PizzaTopping | null>(null)

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login?redirect=/pizza')
      return
    }
    loadAllData()
  }, [isAuthenticated, router])

  const loadAllData = async () => {
    setIsLoading(true)
    try {
      const response = await fetch('/api/pizza')
      if (response.ok) {
        const data = await response.json()
        setConfig(data.config)
        setSizes(data.sizes)
        setCrusts(data.crusts)
        setSauces(data.sauces)
        setCheeses(data.cheeses)
        setToppings(data.toppings)
        setPrinters(data.printers || [])
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
        setConfig(data)
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

  const handleDeleteSize = async (id: string) => {
    if (!confirm('Delete this size?')) return
    try {
      await fetch(`/api/pizza/sizes/${id}`, { method: 'DELETE' })
      await loadAllData()
    } catch (error) {
      console.error('Failed to delete size:', error)
    }
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

  const handleDeleteCrust = async (id: string) => {
    if (!confirm('Delete this crust?')) return
    try {
      await fetch(`/api/pizza/crusts/${id}`, { method: 'DELETE' })
      await loadAllData()
    } catch (error) {
      console.error('Failed to delete crust:', error)
    }
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

  const handleDeleteSauce = async (id: string) => {
    if (!confirm('Delete this sauce?')) return
    try {
      await fetch(`/api/pizza/sauces/${id}`, { method: 'DELETE' })
      await loadAllData()
    } catch (error) {
      console.error('Failed to delete sauce:', error)
    }
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

  const handleDeleteCheese = async (id: string) => {
    if (!confirm('Delete this cheese?')) return
    try {
      await fetch(`/api/pizza/cheeses/${id}`, { method: 'DELETE' })
      await loadAllData()
    } catch (error) {
      console.error('Failed to delete cheese:', error)
    }
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

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 to-red-50 p-8">
        <div className="max-w-6xl mx-auto">
          <div className="text-center py-12 text-gray-500">Loading pizza configuration...</div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-red-50 p-6">
      <AdminPageHeader
        title="Pizza Builder Settings"
        subtitle="Configure sizes, crusts, sauces, cheeses, and toppings"
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
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as TabType)}
              className={`px-4 py-2 rounded-lg font-medium transition-all whitespace-nowrap ${
                activeTab === tab.id
                  ? 'bg-orange-500 text-white shadow-md'
                  : 'bg-white/80 text-gray-700 hover:bg-orange-100'
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

        {/* Modals */}
        {showSizeModal && (
          <SizeModal
            size={editingSize}
            onSave={handleSaveSize}
            onClose={() => { setShowSizeModal(false); setEditingSize(null) }}
          />
        )}

        {showCrustModal && (
          <CrustModal
            crust={editingCrust}
            onSave={handleSaveCrust}
            onClose={() => { setShowCrustModal(false); setEditingCrust(null) }}
          />
        )}

        {showSauceModal && (
          <SauceModal
            sauce={editingSauce}
            onSave={handleSaveSauce}
            onClose={() => { setShowSauceModal(false); setEditingSauce(null) }}
          />
        )}

        {showCheeseModal && (
          <CheeseModal
            cheese={editingCheese}
            onSave={handleSaveCheese}
            onClose={() => { setShowCheeseModal(false); setEditingCheese(null) }}
          />
        )}

        {showToppingModal && (
          <ToppingModal
            topping={editingTopping}
            onSave={handleSaveTopping}
            onClose={() => { setShowToppingModal(false); setEditingTopping(null) }}
          />
        )}
      </div>
    </div>
  )
}

// Config Tab
function ConfigTab({ config, printers, onSave, showPrintSettings, setShowPrintSettings }: {
  config: PizzaConfig | null
  printers: Printer[]
  onSave: (updates: Partial<PizzaConfig>) => void
  showPrintSettings: boolean
  setShowPrintSettings: (show: boolean) => void
}) {
  if (!config) return null

  const togglePrinter = (printerId: string) => {
    const currentIds = config.printerIds || []
    const newIds = currentIds.includes(printerId)
      ? currentIds.filter(id => id !== printerId)
      : [...currentIds, printerId]
    onSave({ printerIds: newIds })
  }

  const handleSavePrintSettings = (settings: PizzaPrintSettings) => {
    onSave({ printSettings: settings })
    setShowPrintSettings(false)
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Print Settings Modal */}
      {showPrintSettings && (
        <PizzaPrintSettingsEditor
          settings={config.printSettings}
          onSave={handleSavePrintSettings}
          onClose={() => setShowPrintSettings(false)}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>Printer Routing</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Send Pizza Orders To:</label>
            <p className="text-xs text-gray-500 mb-3">
              Select one or more printers. Pizza tickets will print to all selected printers.
            </p>
            {printers.length === 0 ? (
              <p className="text-sm text-gray-500 italic">No printers configured. Add printers in Hardware Settings.</p>
            ) : (
              <div className="space-y-2">
                {printers.map(printer => {
                  const isSelected = (config.printerIds || []).includes(printer.id)
                  return (
                    <div
                      key={printer.id}
                      onClick={() => togglePrinter(printer.id)}
                      className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        isSelected
                          ? 'bg-orange-50 border-orange-300'
                          : 'bg-gray-50 border-gray-200 hover:bg-gray-100'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {}}
                        className="w-5 h-5 rounded text-orange-500 pointer-events-none"
                      />
                      <div className="flex-1">
                        <span className="font-medium">{printer.name}</span>
                        <span className="text-xs text-gray-500 ml-2">({printer.printerRole})</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            {(config.printerIds || []).length === 0 && printers.length > 0 && (
              <p className="text-xs text-amber-600 mt-2">
                No printers selected. Pizza orders will use the default kitchen printer.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Kitchen Ticket Design</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-gray-600">
            Customize how pizza orders appear on kitchen tickets to prevent mistakes and improve accuracy.
          </p>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              <span className={config.printSettings ? 'text-green-600' : 'text-gray-400'}>
                {config.printSettings ? '✓' : '○'}
              </span>
              <span>Section headers for split pizzas</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className={config.printSettings?.modifications?.highlightNo ? 'text-green-600' : 'text-gray-400'}>
                {config.printSettings?.modifications?.highlightNo ? '✓' : '○'}
              </span>
              <span>NO items highlighted (allergy safe)</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className={config.printSettings?.modifications?.highlightExtra ? 'text-green-600' : 'text-gray-400'}>
                {config.printSettings?.modifications?.highlightExtra ? '✓' : '○'}
              </span>
              <span>EXTRA/LIGHT modifications highlighted</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className={config.printSettings?.allergyAlerts?.highlightAllergies ? 'text-green-600' : 'text-gray-400'}>
                {config.printSettings?.allergyAlerts?.highlightAllergies ? '✓' : '○'}
              </span>
              <span>Allergy alerts</span>
            </div>
          </div>
          <Button
            onClick={() => setShowPrintSettings(true)}
            className="w-full mt-4"
            variant={config.printSettings ? 'outline' : 'default'}
          >
            {config.printSettings ? 'Edit Print Settings' : 'Configure Print Settings'}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Section Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Default Section View</label>
            <select
              value={config.defaultSections}
              onChange={(e) => onSave({ defaultSections: parseInt(e.target.value) })}
              className="w-full p-2 border rounded-lg"
            >
              <option value={1}>Whole Pizza (1)</option>
              <option value={2}>Halves (2)</option>
              <option value={4}>Quarters (4)</option>
              <option value={8}>Eighths (8)</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Pricing Mode</label>
            <select
              value={config.pricingMode}
              onChange={(e) => onSave({ pricingMode: e.target.value })}
              className="w-full p-2 border rounded-lg"
            >
              <option value="fractional">Fractional (half = 50%)</option>
              <option value="flat">Flat (any coverage = 100%)</option>
              <option value="hybrid">Hybrid (custom percentages)</option>
            </select>
            <p className="text-xs text-gray-500 mt-1">
              Fractional: A topping covering half the pizza costs half price
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Free Toppings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="freeToppings"
              checked={config.freeToppingsEnabled}
              onChange={(e) => onSave({ freeToppingsEnabled: e.target.checked })}
              className="w-5 h-5 rounded"
            />
            <label htmlFor="freeToppings" className="text-sm font-medium">Enable Free Toppings</label>
          </div>
          {config.freeToppingsEnabled && (
            <>
              <div>
                <label className="block text-sm font-medium mb-1">Number of Free Toppings</label>
                <input
                  type="number"
                  value={config.freeToppingsCount}
                  onChange={(e) => onSave({ freeToppingsCount: parseInt(e.target.value) || 0 })}
                  className="w-full p-2 border rounded-lg"
                  min={0}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Free Toppings Mode</label>
                <select
                  value={config.freeToppingsMode}
                  onChange={(e) => onSave({ freeToppingsMode: e.target.value })}
                  className="w-full p-2 border rounded-lg"
                >
                  <option value="per_pizza">Same for all sizes</option>
                  <option value="per_size">Configure per size</option>
                </select>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Display Options</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="showVisual"
              checked={config.showVisualBuilder}
              onChange={(e) => onSave({ showVisualBuilder: e.target.checked })}
              className="w-5 h-5 rounded"
            />
            <label htmlFor="showVisual" className="text-sm font-medium">Show Visual Pizza Builder</label>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="showList"
              checked={config.showToppingList}
              onChange={(e) => onSave({ showToppingList: e.target.checked })}
              className="w-5 h-5 rounded"
            />
            <label htmlFor="showList" className="text-sm font-medium">Show Topping List View</label>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="defaultList"
              checked={config.defaultToListView}
              onChange={(e) => onSave({ defaultToListView: e.target.checked })}
              className="w-5 h-5 rounded"
            />
            <label htmlFor="defaultList" className="text-sm font-medium">Default to List View</label>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

// Sizes Tab
function SizesTab({ sizes, onAdd, onEdit, onDelete }: {
  sizes: PizzaSize[]
  onAdd: () => void
  onEdit: (size: PizzaSize) => void
  onDelete: (id: string) => void
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Pizza Sizes</CardTitle>
        <Button onClick={onAdd}>+ Add Size</Button>
      </CardHeader>
      <CardContent>
        {sizes.length === 0 ? (
          <p className="text-gray-500 text-center py-8">No sizes configured. Add your first size to get started.</p>
        ) : (
          <div className="space-y-2">
            {sizes.map(size => (
              <div
                key={size.id}
                className="flex items-center justify-between p-4 bg-white rounded-lg border hover:shadow-md transition-shadow"
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center text-2xl">
                    📐
                  </div>
                  <div>
                    <div className="font-semibold">{size.name}</div>
                    <div className="text-sm text-gray-500">
                      {size.displayName || `${size.inches || '?'}"`} • {size.slices} slices
                      {size.isDefault && <span className="ml-2 text-orange-600 font-medium">Default</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <div className="font-bold text-lg">{formatCurrency(size.basePrice)}</div>
                    <div className="text-xs text-gray-500">
                      Topping: {size.toppingMultiplier}x
                    </div>
                  </div>
                  <Button variant="ghost" onClick={() => onEdit(size)}>Edit</Button>
                  <Button variant="ghost" className="text-red-500" onClick={() => onDelete(size.id)}>Delete</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// Crusts Tab
function CrustsTab({ crusts, onAdd, onEdit, onDelete }: {
  crusts: PizzaCrust[]
  onAdd: () => void
  onEdit: (crust: PizzaCrust) => void
  onDelete: (id: string) => void
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Pizza Crusts</CardTitle>
        <Button onClick={onAdd}>+ Add Crust</Button>
      </CardHeader>
      <CardContent>
        {crusts.length === 0 ? (
          <p className="text-gray-500 text-center py-8">No crusts configured. Add your first crust to get started.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {crusts.map(crust => (
              <div
                key={crust.id}
                className="p-4 bg-white rounded-lg border hover:shadow-md transition-shadow"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="font-semibold">{crust.name}</div>
                  {crust.isDefault && <span className="text-xs bg-orange-100 text-orange-700 px-2 py-1 rounded">Default</span>}
                </div>
                {crust.description && <p className="text-sm text-gray-500 mb-2">{crust.description}</p>}
                <div className="flex items-center justify-between">
                  <div className="text-lg font-bold">
                    {crust.price > 0 ? `+${formatCurrency(crust.price)}` : 'Included'}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => onEdit(crust)}>Edit</Button>
                    <Button variant="ghost" size="sm" className="text-red-500" onClick={() => onDelete(crust.id)}>Delete</Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// Sauces Tab
function SaucesTab({ sauces, onAdd, onEdit, onDelete }: {
  sauces: PizzaSauce[]
  onAdd: () => void
  onEdit: (sauce: PizzaSauce) => void
  onDelete: (id: string) => void
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Pizza Sauces</CardTitle>
        <Button onClick={onAdd}>+ Add Sauce</Button>
      </CardHeader>
      <CardContent>
        {sauces.length === 0 ? (
          <p className="text-gray-500 text-center py-8">No sauces configured. Add your first sauce to get started.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {sauces.map(sauce => (
              <div
                key={sauce.id}
                className="p-4 bg-white rounded-lg border hover:shadow-md transition-shadow"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="font-semibold">{sauce.name}</div>
                  {sauce.isDefault && <span className="text-xs bg-orange-100 text-orange-700 px-2 py-1 rounded">Default</span>}
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-500 mb-2">
                  {sauce.allowLight && <span className="bg-gray-100 px-2 py-0.5 rounded">Light</span>}
                  {sauce.allowExtra && <span className="bg-gray-100 px-2 py-0.5 rounded">Extra +{formatCurrency(sauce.extraPrice)}</span>}
                </div>
                <div className="flex items-center justify-between">
                  <div className="text-lg font-bold">
                    {sauce.price > 0 ? `+${formatCurrency(sauce.price)}` : 'Included'}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => onEdit(sauce)}>Edit</Button>
                    <Button variant="ghost" size="sm" className="text-red-500" onClick={() => onDelete(sauce.id)}>Delete</Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// Cheeses Tab
function CheesesTab({ cheeses, onAdd, onEdit, onDelete }: {
  cheeses: PizzaCheese[]
  onAdd: () => void
  onEdit: (cheese: PizzaCheese) => void
  onDelete: (id: string) => void
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Pizza Cheeses</CardTitle>
        <Button onClick={onAdd}>+ Add Cheese</Button>
      </CardHeader>
      <CardContent>
        {cheeses.length === 0 ? (
          <p className="text-gray-500 text-center py-8">No cheeses configured. Add your first cheese to get started.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {cheeses.map(cheese => (
              <div
                key={cheese.id}
                className="p-4 bg-white rounded-lg border hover:shadow-md transition-shadow"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="font-semibold">{cheese.name}</div>
                  {cheese.isDefault && <span className="text-xs bg-orange-100 text-orange-700 px-2 py-1 rounded">Default</span>}
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-500 mb-2">
                  {cheese.allowLight && <span className="bg-gray-100 px-2 py-0.5 rounded">Light</span>}
                  {cheese.allowExtra && <span className="bg-gray-100 px-2 py-0.5 rounded">Extra +{formatCurrency(cheese.extraPrice)}</span>}
                </div>
                <div className="flex items-center justify-between">
                  <div className="text-lg font-bold">
                    {cheese.price > 0 ? `+${formatCurrency(cheese.price)}` : 'Included'}
                  </div>
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => onEdit(cheese)}>Edit</Button>
                    <Button variant="ghost" size="sm" className="text-red-500" onClick={() => onDelete(cheese.id)}>Delete</Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// Toppings Tab
function ToppingsTab({ toppings, onAdd, onEdit, onDelete }: {
  toppings: PizzaTopping[]
  onAdd: () => void
  onEdit: (topping: PizzaTopping) => void
  onDelete: (id: string) => void
}) {
  const [categoryFilter, setCategoryFilter] = useState<string>('all')

  const filteredToppings = categoryFilter === 'all'
    ? toppings
    : toppings.filter(t => t.category === categoryFilter)

  const groupedToppings = filteredToppings.reduce((acc, topping) => {
    const cat = topping.category || 'standard'
    if (!acc[cat]) acc[cat] = []
    acc[cat].push(topping)
    return acc
  }, {} as Record<string, PizzaTopping[]>)

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Pizza Toppings ({toppings.length})</CardTitle>
        <div className="flex items-center gap-4">
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="p-2 border rounded-lg"
          >
            <option value="all">All Categories</option>
            {TOPPING_CATEGORIES.map(cat => (
              <option key={cat.value} value={cat.value}>{cat.label}</option>
            ))}
          </select>
          <Button onClick={onAdd}>+ Add Topping</Button>
        </div>
      </CardHeader>
      <CardContent>
        {toppings.length === 0 ? (
          <p className="text-gray-500 text-center py-8">No toppings configured. Add your first topping to get started.</p>
        ) : (
          <div className="space-y-6">
            {Object.entries(groupedToppings).map(([category, categoryToppings]) => {
              const catConfig = TOPPING_CATEGORIES.find(c => c.value === category)
              return (
                <div key={category}>
                  <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                    <span
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: catConfig?.color || '#6b7280' }}
                    />
                    {catConfig?.label || category} ({categoryToppings.length})
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {categoryToppings.map(topping => (
                      <div
                        key={topping.id}
                        className="p-3 bg-white rounded-lg border hover:shadow-md transition-shadow"
                      >
                        <div className="flex items-center justify-between mb-1">
                          <div className="font-medium">{topping.name}</div>
                          <div className="font-bold text-green-600">{formatCurrency(topping.price)}</div>
                        </div>
                        {topping.extraPrice && (
                          <div className="text-xs text-gray-500 mb-2">
                            Extra: +{formatCurrency(topping.extraPrice)}
                          </div>
                        )}
                        <div className="flex gap-2">
                          <Button variant="ghost" size="sm" onClick={() => onEdit(topping)}>Edit</Button>
                          <Button variant="ghost" size="sm" className="text-red-500" onClick={() => onDelete(topping.id)}>Delete</Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// Modals
function SizeModal({ size, onSave, onClose }: {
  size: PizzaSize | null
  onSave: (data: Partial<PizzaSize>) => void
  onClose: () => void
}) {
  const [name, setName] = useState(size?.name || '')
  const [displayName, setDisplayName] = useState(size?.displayName || '')
  const [inches, setInches] = useState(size?.inches?.toString() || '')
  const [slices, setSlices] = useState(size?.slices?.toString() || '8')
  const [basePrice, setBasePrice] = useState(size?.basePrice?.toString() || '')
  const [toppingMultiplier, setToppingMultiplier] = useState(size?.toppingMultiplier?.toString() || '1.0')
  const [freeToppings, setFreeToppings] = useState(size?.freeToppings?.toString() || '0')
  const [isDefault, setIsDefault] = useState(size?.isDefault || false)

  const handleSubmit = () => {
    if (!name.trim() || !basePrice) return
    onSave({
      name: name.trim(),
      displayName: displayName.trim() || null,
      inches: inches ? parseInt(inches) : null,
      slices: parseInt(slices) || 8,
      basePrice: parseFloat(basePrice),
      toppingMultiplier: parseFloat(toppingMultiplier) || 1.0,
      freeToppings: parseInt(freeToppings) || 0,
      isDefault,
    })
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <h2 className="text-xl font-bold mb-4">{size ? 'Edit Size' : 'Add Size'}</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full p-2 border rounded-lg"
              placeholder="Large"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Display Name</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full p-2 border rounded-lg"
                placeholder='14"'
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Inches</label>
              <input
                type="number"
                value={inches}
                onChange={(e) => setInches(e.target.value)}
                className="w-full p-2 border rounded-lg"
                placeholder="14"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Slices</label>
              <input
                type="number"
                value={slices}
                onChange={(e) => setSlices(e.target.value)}
                className="w-full p-2 border rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Base Price *</label>
              <input
                type="number"
                step="0.01"
                value={basePrice}
                onChange={(e) => setBasePrice(e.target.value)}
                className="w-full p-2 border rounded-lg"
                placeholder="16.99"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Topping Multiplier</label>
              <input
                type="number"
                step="0.1"
                value={toppingMultiplier}
                onChange={(e) => setToppingMultiplier(e.target.value)}
                className="w-full p-2 border rounded-lg"
              />
              <p className="text-xs text-gray-500 mt-1">1.0 = standard, 1.25 = 25% more</p>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Free Toppings</label>
              <input
                type="number"
                value={freeToppings}
                onChange={(e) => setFreeToppings(e.target.value)}
                className="w-full p-2 border rounded-lg"
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="isDefault"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="w-5 h-5 rounded"
            />
            <label htmlFor="isDefault" className="text-sm font-medium">Default Size</label>
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit}>Save</Button>
        </div>
      </div>
    </div>
  )
}

function CrustModal({ crust, onSave, onClose }: {
  crust: PizzaCrust | null
  onSave: (data: Partial<PizzaCrust>) => void
  onClose: () => void
}) {
  const [name, setName] = useState(crust?.name || '')
  const [displayName, setDisplayName] = useState(crust?.displayName || '')
  const [description, setDescription] = useState(crust?.description || '')
  const [price, setPrice] = useState(crust?.price?.toString() || '0')
  const [isDefault, setIsDefault] = useState(crust?.isDefault || false)

  const handleSubmit = () => {
    if (!name.trim()) return
    onSave({
      name: name.trim(),
      displayName: displayName.trim() || null,
      description: description.trim() || null,
      price: parseFloat(price) || 0,
      isDefault,
    })
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <h2 className="text-xl font-bold mb-4">{crust ? 'Edit Crust' : 'Add Crust'}</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full p-2 border rounded-lg"
              placeholder="Hand Tossed"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Display Name</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full p-2 border rounded-lg"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full p-2 border rounded-lg"
              rows={2}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Price Upcharge</label>
            <input
              type="number"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="w-full p-2 border rounded-lg"
              placeholder="0.00"
            />
          </div>
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="isDefault"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="w-5 h-5 rounded"
            />
            <label htmlFor="isDefault" className="text-sm font-medium">Default Crust</label>
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit}>Save</Button>
        </div>
      </div>
    </div>
  )
}

function SauceModal({ sauce, onSave, onClose }: {
  sauce: PizzaSauce | null
  onSave: (data: Partial<PizzaSauce>) => void
  onClose: () => void
}) {
  const [name, setName] = useState(sauce?.name || '')
  const [description, setDescription] = useState(sauce?.description || '')
  const [price, setPrice] = useState(sauce?.price?.toString() || '0')
  const [allowLight, setAllowLight] = useState(sauce?.allowLight ?? true)
  const [allowExtra, setAllowExtra] = useState(sauce?.allowExtra ?? true)
  const [extraPrice, setExtraPrice] = useState(sauce?.extraPrice?.toString() || '0')
  const [isDefault, setIsDefault] = useState(sauce?.isDefault || false)

  const handleSubmit = () => {
    if (!name.trim()) return
    onSave({
      name: name.trim(),
      description: description.trim() || null,
      price: parseFloat(price) || 0,
      allowLight,
      allowExtra,
      extraPrice: parseFloat(extraPrice) || 0,
      isDefault,
    })
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <h2 className="text-xl font-bold mb-4">{sauce ? 'Edit Sauce' : 'Add Sauce'}</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full p-2 border rounded-lg"
              placeholder="Marinara"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full p-2 border rounded-lg"
              rows={2}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Price Upcharge</label>
            <input
              type="number"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="w-full p-2 border rounded-lg"
            />
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="allowLight"
                checked={allowLight}
                onChange={(e) => setAllowLight(e.target.checked)}
                className="w-4 h-4 rounded"
              />
              <label htmlFor="allowLight" className="text-sm">Allow Light</label>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="allowExtra"
                checked={allowExtra}
                onChange={(e) => setAllowExtra(e.target.checked)}
                className="w-4 h-4 rounded"
              />
              <label htmlFor="allowExtra" className="text-sm">Allow Extra</label>
            </div>
          </div>
          {allowExtra && (
            <div>
              <label className="block text-sm font-medium mb-1">Extra Price</label>
              <input
                type="number"
                step="0.01"
                value={extraPrice}
                onChange={(e) => setExtraPrice(e.target.value)}
                className="w-full p-2 border rounded-lg"
              />
            </div>
          )}
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="isDefault"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="w-5 h-5 rounded"
            />
            <label htmlFor="isDefault" className="text-sm font-medium">Default Sauce</label>
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit}>Save</Button>
        </div>
      </div>
    </div>
  )
}

function CheeseModal({ cheese, onSave, onClose }: {
  cheese: PizzaCheese | null
  onSave: (data: Partial<PizzaCheese>) => void
  onClose: () => void
}) {
  const [name, setName] = useState(cheese?.name || '')
  const [description, setDescription] = useState(cheese?.description || '')
  const [price, setPrice] = useState(cheese?.price?.toString() || '0')
  const [allowLight, setAllowLight] = useState(cheese?.allowLight ?? true)
  const [allowExtra, setAllowExtra] = useState(cheese?.allowExtra ?? true)
  const [extraPrice, setExtraPrice] = useState(cheese?.extraPrice?.toString() || '0')
  const [isDefault, setIsDefault] = useState(cheese?.isDefault || false)

  const handleSubmit = () => {
    if (!name.trim()) return
    onSave({
      name: name.trim(),
      description: description.trim() || null,
      price: parseFloat(price) || 0,
      allowLight,
      allowExtra,
      extraPrice: parseFloat(extraPrice) || 0,
      isDefault,
    })
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <h2 className="text-xl font-bold mb-4">{cheese ? 'Edit Cheese' : 'Add Cheese'}</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full p-2 border rounded-lg"
              placeholder="Mozzarella"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full p-2 border rounded-lg"
              rows={2}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Price Upcharge</label>
            <input
              type="number"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="w-full p-2 border rounded-lg"
            />
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="allowLight"
                checked={allowLight}
                onChange={(e) => setAllowLight(e.target.checked)}
                className="w-4 h-4 rounded"
              />
              <label htmlFor="allowLight" className="text-sm">Allow Light</label>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="allowExtra"
                checked={allowExtra}
                onChange={(e) => setAllowExtra(e.target.checked)}
                className="w-4 h-4 rounded"
              />
              <label htmlFor="allowExtra" className="text-sm">Allow Extra</label>
            </div>
          </div>
          {allowExtra && (
            <div>
              <label className="block text-sm font-medium mb-1">Extra Price</label>
              <input
                type="number"
                step="0.01"
                value={extraPrice}
                onChange={(e) => setExtraPrice(e.target.value)}
                className="w-full p-2 border rounded-lg"
              />
            </div>
          )}
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="isDefault"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="w-5 h-5 rounded"
            />
            <label htmlFor="isDefault" className="text-sm font-medium">Default Cheese</label>
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit}>Save</Button>
        </div>
      </div>
    </div>
  )
}

function ToppingModal({ topping, onSave, onClose }: {
  topping: PizzaTopping | null
  onSave: (data: Partial<PizzaTopping>) => void
  onClose: () => void
}) {
  const [name, setName] = useState(topping?.name || '')
  const [displayName, setDisplayName] = useState(topping?.displayName || '')
  const [description, setDescription] = useState(topping?.description || '')
  const [category, setCategory] = useState(topping?.category || 'standard')
  const [price, setPrice] = useState(topping?.price?.toString() || '')
  const [extraPrice, setExtraPrice] = useState(topping?.extraPrice?.toString() || '')
  const [color, setColor] = useState(topping?.color || '')

  const handleSubmit = () => {
    if (!name.trim() || !price) return
    onSave({
      name: name.trim(),
      displayName: displayName.trim() || null,
      description: description.trim() || null,
      category,
      price: parseFloat(price),
      extraPrice: extraPrice ? parseFloat(extraPrice) : null,
      color: color || null,
    })
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <h2 className="text-xl font-bold mb-4">{topping ? 'Edit Topping' : 'Add Topping'}</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full p-2 border rounded-lg"
              placeholder="Pepperoni"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Display Name</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full p-2 border rounded-lg"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full p-2 border rounded-lg"
            >
              {TOPPING_CATEGORIES.map(cat => (
                <option key={cat.value} value={cat.value}>{cat.label}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Price *</label>
              <input
                type="number"
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="w-full p-2 border rounded-lg"
                placeholder="2.00"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Extra Price</label>
              <input
                type="number"
                step="0.01"
                value={extraPrice}
                onChange={(e) => setExtraPrice(e.target.value)}
                className="w-full p-2 border rounded-lg"
                placeholder="3.00"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Color (for visual builder)</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={color || '#ef4444'}
                onChange={(e) => setColor(e.target.value)}
                className="w-10 h-10 border rounded cursor-pointer"
              />
              <input
                type="text"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="flex-1 p-2 border rounded-lg"
                placeholder="#ef4444"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full p-2 border rounded-lg"
              rows={2}
            />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit}>Save</Button>
        </div>
      </div>
    </div>
  )
}
