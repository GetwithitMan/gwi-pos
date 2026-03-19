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
  PizzaSpecialty,
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
            <p className="text-xs text-gray-900 mb-3">
              Select one or more printers. Pizza tickets will print to all selected printers.
            </p>
            {printers.length === 0 ? (
              <p className="text-sm text-gray-900 italic">No printers configured. Add printers in Hardware Settings.</p>
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
                        <span className="text-xs text-gray-900 ml-2">({printer.printerRole})</span>
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
              <span className={config.printSettings ? 'text-green-600' : 'text-gray-900'}>
                {config.printSettings ? '✓' : '○'}
              </span>
              <span>Section headers for split pizzas</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className={config.printSettings?.modifications?.highlightNo ? 'text-green-600' : 'text-gray-900'}>
                {config.printSettings?.modifications?.highlightNo ? '✓' : '○'}
              </span>
              <span>NO items highlighted (allergy safe)</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className={config.printSettings?.modifications?.highlightExtra ? 'text-green-600' : 'text-gray-900'}>
                {config.printSettings?.modifications?.highlightExtra ? '✓' : '○'}
              </span>
              <span>EXTRA/LIGHT modifications highlighted</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className={config.printSettings?.allergyAlerts?.highlightAllergies ? 'text-green-600' : 'text-gray-900'}>
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
          {/* Section Options */}
          <div>
            <label className="block text-sm font-medium mb-2">Available Divisions</label>
            <div className="flex flex-wrap gap-2">
              {[
                { value: 1, label: 'Whole' },
                { value: 2, label: 'Halves' },
                { value: 3, label: 'Thirds' },
                { value: 4, label: 'Quarters' },
                { value: 6, label: 'Sixths' },
                { value: 8, label: 'Eighths' },
              ].map(opt => {
                const isChecked = (config.sectionOptions || []).includes(opt.value)
                return (
                  <label key={opt.value} className="flex items-center gap-1.5 px-3 py-1.5 rounded border cursor-pointer select-none text-sm" style={{ borderColor: isChecked ? '#6366f1' : '#e5e7eb', backgroundColor: isChecked ? '#eef2ff' : 'white' }}>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => {
                        const current = config.sectionOptions || [1, 2, 3, 4, 6, 8]
                        const next = isChecked
                          ? current.filter((v: number) => v !== opt.value)
                          : [...current, opt.value].sort((a: number, b: number) => a - b)
                        if (next.length > 0) onSave({ sectionOptions: next })
                      }}
                      className="sr-only"
                    />
                    {opt.label}
                  </label>
                )
              })}
            </div>
            <p className="text-xs text-gray-900 mt-1">Check which division modes are available in the pizza builder</p>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Default Section View</label>
            <select
              value={config.defaultSections}
              onChange={(e) => onSave({ defaultSections: parseInt(e.target.value) })}
              className="w-full p-2 border rounded-lg"
            >
              {(config.sectionOptions || [1, 2, 4, 8]).map((v: number) => {
                const labels: Record<number, string> = { 1: 'Whole Pizza (1)', 2: 'Halves (2)', 3: 'Thirds (3)', 4: 'Quarters (4)', 6: 'Sixths (6)', 8: 'Eighths (8)' }
                return <option key={v} value={v}>{labels[v] || `${v} sections`}</option>
              })}
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
            <p className="text-xs text-gray-900 mt-1">
              Fractional: A topping covering half the pizza costs half price
            </p>
            {config.pricingMode === 'hybrid' && (
              <div className="mt-3 p-3 bg-purple-50 rounded-lg border border-purple-200">
                <label className="block text-sm font-medium mb-2">Custom Pricing Percentages</label>
                <p className="text-xs text-gray-900 mb-3">Set the price percentage charged for each division level (1.0 = 100%)</p>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { key: 'whole', label: 'Whole', default: 1.0 },
                    { key: 'half', label: 'Half', default: 0.6 },
                    { key: 'third', label: 'Third', default: 0.45 },
                    { key: 'quarter', label: 'Quarter', default: 0.35 },
                    { key: 'sixth', label: 'Sixth', default: 0.2 },
                    { key: 'eighth', label: 'Eighth', default: 0.15 },
                  ].map(item => (
                    <div key={item.key}>
                      <label className="block text-xs text-gray-600 mb-1">{item.label}</label>
                      <input
                        type="number"
                        step="0.05"
                        min="0"
                        max="1"
                        className="w-full px-2 py-1 text-sm border rounded"
                        value={config.hybridPricing?.[item.key] ?? item.default}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value)
                          if (!isNaN(val) && val >= 0 && val <= 2) {
                            onSave({
                              hybridPricing: {
                                ...(config.hybridPricing || { whole: 1.0, half: 0.6, third: 0.45, quarter: 0.35, sixth: 0.2, eighth: 0.15 }),
                                [item.key]: val,
                              }
                            })
                          }
                        }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Condiment Sections</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium">Allow section-based sauce & cheese</label>
              <p className="text-xs text-gray-900">Let staff place sauce or cheese on specific sections (e.g. marinara on left, BBQ on right)</p>
            </div>
            <input
              type="checkbox"
              checked={config.allowCondimentSections || false}
              onChange={(e) => onSave({ allowCondimentSections: e.target.checked })}
              className="h-4 w-4"
            />
          </div>
          {config.allowCondimentSections && (
            <div>
              <label className="block text-sm font-medium mb-1">Max Condiment Division</label>
              <select
                className="w-full px-3 py-2 border rounded-md text-sm"
                value={config.condimentDivisionMax || 1}
                onChange={(e) => onSave({ condimentDivisionMax: parseInt(e.target.value) })}
              >
                <option value={1}>Whole only</option>
                <option value={2}>Up to halves</option>
                <option value={3}>Up to thirds</option>
              </select>
              <p className="text-xs text-gray-900 mt-1">Maximum number of sections for sauce and cheese placement</p>
            </div>
          )}
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
          <p className="text-gray-900 text-center py-8">No sizes configured. Add your first size to get started.</p>
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
                    <div className="text-sm text-gray-900">
                      {size.displayName || `${size.inches || '?'}"`} • {size.slices} slices
                      {size.isDefault && <span className="ml-2 text-orange-600 font-medium">Default</span>}
                    </div>
                    {size.inventoryItemName ? (
                      <div className="text-xs text-blue-600">
                        Linked: {size.inventoryItemName}
                        {size.usageQuantity ? ` (${size.usageQuantity} ${size.usageUnit || 'ea'})` : ''}
                      </div>
                    ) : (
                      <div className="text-xs text-amber-500">No inventory link</div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <div className="font-bold text-lg">{formatCurrency(size.basePrice)}</div>
                    <div className="text-xs text-gray-900">
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
          <p className="text-gray-900 text-center py-8">No crusts configured. Add your first crust to get started.</p>
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
                {crust.description && <p className="text-sm text-gray-900 mb-2">{crust.description}</p>}
                {crust.inventoryItemName ? (
                  <div className="text-xs text-blue-600 mb-1">
                    Linked: {crust.inventoryItemName}
                    {crust.usageQuantity ? ` (${crust.usageQuantity} ${crust.usageUnit || 'ea'})` : ''}
                  </div>
                ) : (
                  <div className="text-xs text-amber-500 mb-1">No inventory link</div>
                )}
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
          <p className="text-gray-900 text-center py-8">No sauces configured. Add your first sauce to get started.</p>
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
                <div className="flex items-center gap-2 text-xs text-gray-900 mb-2">
                  {sauce.allowLight && <span className="bg-gray-100 px-2 py-0.5 rounded">Light</span>}
                  {sauce.allowExtra && <span className="bg-gray-100 px-2 py-0.5 rounded">Extra +{formatCurrency(sauce.extraPrice)}</span>}
                </div>
                {sauce.inventoryItemName ? (
                  <div className="text-xs text-blue-600 mb-1">
                    Linked: {sauce.inventoryItemName}
                    {sauce.usageQuantity ? ` (${sauce.usageQuantity} ${sauce.usageUnit || 'ea'})` : ''}
                  </div>
                ) : (
                  <div className="text-xs text-amber-500 mb-1">No inventory link</div>
                )}
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
          <p className="text-gray-900 text-center py-8">No cheeses configured. Add your first cheese to get started.</p>
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
                <div className="flex items-center gap-2 text-xs text-gray-900 mb-2">
                  {cheese.allowLight && <span className="bg-gray-100 px-2 py-0.5 rounded">Light</span>}
                  {cheese.allowExtra && <span className="bg-gray-100 px-2 py-0.5 rounded">Extra +{formatCurrency(cheese.extraPrice)}</span>}
                </div>
                {cheese.inventoryItemName ? (
                  <div className="text-xs text-blue-600 mb-1">
                    Linked: {cheese.inventoryItemName}
                    {cheese.usageQuantity ? ` (${cheese.usageQuantity} ${cheese.usageUnit || 'ea'})` : ''}
                  </div>
                ) : (
                  <div className="text-xs text-amber-500 mb-1">No inventory link</div>
                )}
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
          <p className="text-gray-900 text-center py-8">No toppings configured. Add your first topping to get started.</p>
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
                          <div className="text-xs text-gray-900">
                            Extra: +{formatCurrency(topping.extraPrice)}
                          </div>
                        )}
                        {topping.inventoryItemName ? (
                          <div className="text-xs text-blue-600 mb-1">
                            Linked: {topping.inventoryItemName}
                            {topping.usageQuantity ? ` (${topping.usageQuantity} ${topping.usageUnit || 'ea'})` : ''}
                          </div>
                        ) : (
                          <div className="text-xs text-amber-500 mb-1">No inventory link</div>
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

// Specialties Tab
export interface SpecialtiesTabProps {
  specialties: PizzaSpecialty[]
  pizzaMenuItems: PizzaMenuItem[]
  onAdd: () => void
  onEdit: (specialty: PizzaSpecialty) => void
  onDelete: (id: string) => void
  onUpdateMenuItem?: (itemId: string, updates: { name?: string; price?: number; isActive?: boolean }) => void
}

export function SpecialtiesTab({ specialties, pizzaMenuItems, onAdd, onEdit, onDelete, onUpdateMenuItem }: SpecialtiesTabProps) {
  const modFlags = [
    { key: 'allowSizeChange', label: 'Size', icon: '📐' },
    { key: 'allowCrustChange', label: 'Crust', icon: '🍞' },
    { key: 'allowSauceChange', label: 'Sauce', icon: '🥫' },
    { key: 'allowCheeseChange', label: 'Cheese', icon: '🧀' },
    { key: 'allowToppingMods', label: 'Toppings', icon: '🍕' },
  ] as const

  // Build unified list: all pizza menu items with their specialty (if any)
  const specialtyMap = new Map(specialties.map(s => [s.menuItemId, s]))

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Pizzas ({pizzaMenuItems.length})</CardTitle>
        <Button onClick={onAdd}>+ New Pizza</Button>
      </CardHeader>
      <CardContent>
        {pizzaMenuItems.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-4xl mb-3">🍕</div>
            <p className="text-gray-900 mb-1">No pizzas yet.</p>
            <p className="text-sm text-gray-500">Click &quot;+ New Pizza&quot; to create your first pizza.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {pizzaMenuItems.map(item => {
              const specialty = specialtyMap.get(item.id)
              const hasSpecialty = !!specialty
              const toppingCount = specialty?.toppings?.length || 0
              return (
                <div
                  key={item.id}
                  className={`p-4 rounded-lg border transition-shadow hover:shadow-md ${
                    hasSpecialty ? 'bg-white border-orange-200' : 'bg-gray-50 border-gray-200'
                  }`}
                >
                  {/* Row 1: Name, Price, Actions — all on one line */}
                  <div className="flex items-center gap-3">
                    {/* Pizza name */}
                    <div className="flex-1 min-w-0">
                      <span className="text-lg font-bold text-gray-900 truncate block">{item.name}</span>
                    </div>

                    {/* Price — clickable to edit via menu page */}
                    <a
                      href={`/settings/menu?item=${item.id}`}
                      className="text-base font-semibold text-green-600 whitespace-nowrap hover:underline cursor-pointer"
                      title="Edit price, commission, and item settings"
                    >
                      {formatCurrency(item.price)} ✎
                    </a>

                    {/* Status badge */}
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      hasSpecialty
                        ? 'bg-orange-100 text-orange-700'
                        : 'bg-blue-50 text-blue-600'
                    }`}>
                      {hasSpecialty ? 'Specialty' : 'BYO'}
                    </span>

                    {/* Actions */}
                    {hasSpecialty ? (
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => onEdit(specialty!)}>Edit</Button>
                        <Button variant="ghost" size="sm" className="text-red-500" onClick={() => onDelete(specialty!.id)}>Remove</Button>
                      </div>
                    ) : (
                      <Button variant="outline" size="sm" onClick={onAdd}>
                        Configure
                      </Button>
                    )}
                  </div>

                  {/* Row 2: Specialty details (only if configured) */}
                  {hasSpecialty && specialty && (
                    <div className="mt-3 pt-3 border-t border-orange-100">
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {specialty.defaultCrust && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-xs text-amber-800">
                            🍞 {specialty.defaultCrust.name}
                          </span>
                        )}
                        {specialty.defaultSauce && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-50 border border-red-200 text-xs text-red-800">
                            🥫 {specialty.defaultSauce.name}
                            {specialty.sauceAmount !== 'regular' && (
                              <span className="text-red-500 font-medium capitalize"> ({specialty.sauceAmount})</span>
                            )}
                          </span>
                        )}
                        {specialty.defaultCheese && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-50 border border-yellow-200 text-xs text-yellow-800">
                            🧀 {specialty.defaultCheese.name}
                            {specialty.cheeseAmount !== 'regular' && (
                              <span className="text-yellow-600 font-medium capitalize"> ({specialty.cheeseAmount})</span>
                            )}
                          </span>
                        )}
                        {toppingCount > 0 && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-50 border border-orange-200 text-xs text-orange-800">
                            {toppingCount} topping{toppingCount !== 1 ? 's' : ''}: {specialty.toppings.map(t => t.name).join(', ')}
                          </span>
                        )}
                      </div>

                      {/* Modification flags inline */}
                      <div className="flex gap-1.5 flex-wrap">
                        {modFlags.map(flag => {
                          const allowed = specialty[flag.key]
                          return (
                            <span
                              key={flag.key}
                              className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                allowed
                                  ? 'bg-green-50 text-green-700 border border-green-200'
                                  : 'bg-gray-50 text-gray-400 border border-gray-200 line-through'
                              }`}
                            >
                              {flag.icon} {flag.label}
                            </span>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
