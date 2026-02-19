'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatCurrency } from '@/lib/utils'
import { PizzaPrintSettingsEditor } from '@/components/hardware/PizzaPrintSettingsEditor'
import { PizzaPrintSettings } from '@/types/print'
import {
  PizzaConfig,
  Printer,
  PizzaSize,
  PizzaCrust,
  PizzaSauce,
  PizzaCheese,
  PizzaTopping,
  TOPPING_CATEGORIES,
} from './types'

// Config Tab
export interface ConfigTabProps {
  config: PizzaConfig | null
  printers: Printer[]
  onSave: (updates: Partial<PizzaConfig>) => void
  showPrintSettings: boolean
  setShowPrintSettings: (show: boolean) => void
}

export function ConfigTab({ config, printers, onSave, showPrintSettings, setShowPrintSettings }: ConfigTabProps) {
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
export interface SizesTabProps {
  sizes: PizzaSize[]
  onAdd: () => void
  onEdit: (size: PizzaSize) => void
  onDelete: (id: string) => void
}

export function SizesTab({ sizes, onAdd, onEdit, onDelete }: SizesTabProps) {
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
export interface CrustsTabProps {
  crusts: PizzaCrust[]
  onAdd: () => void
  onEdit: (crust: PizzaCrust) => void
  onDelete: (id: string) => void
}

export function CrustsTab({ crusts, onAdd, onEdit, onDelete }: CrustsTabProps) {
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
export interface SaucesTabProps {
  sauces: PizzaSauce[]
  onAdd: () => void
  onEdit: (sauce: PizzaSauce) => void
  onDelete: (id: string) => void
}

export function SaucesTab({ sauces, onAdd, onEdit, onDelete }: SaucesTabProps) {
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
export interface CheesesTabProps {
  cheeses: PizzaCheese[]
  onAdd: () => void
  onEdit: (cheese: PizzaCheese) => void
  onDelete: (id: string) => void
}

export function CheesesTab({ cheeses, onAdd, onEdit, onDelete }: CheesesTabProps) {
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
export interface ToppingsTabProps {
  toppings: PizzaTopping[]
  onAdd: () => void
  onEdit: (topping: PizzaTopping) => void
  onDelete: (id: string) => void
}

export function ToppingsTab({ toppings, onAdd, onEdit, onDelete }: ToppingsTabProps) {
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
