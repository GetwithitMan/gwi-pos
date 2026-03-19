'use client'

import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatCurrency } from '@/lib/utils'
import { PizzaPrintSettingsEditor } from '@/components/hardware/PizzaPrintSettingsEditor'
import { PizzaPrintSettings } from '@/types/print'
import { ChevronDown, ChevronUp, X, Plus, Trash2 } from 'lucide-react'
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
  PizzaCategory,
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
                {config.printSettings ? '\u2713' : '\u25CB'}
              </span>
              <span>Section headers for split pizzas</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className={config.printSettings?.modifications?.highlightNo ? 'text-green-600' : 'text-gray-900'}>
                {config.printSettings?.modifications?.highlightNo ? '\u2713' : '\u25CB'}
              </span>
              <span>NO items highlighted (allergy safe)</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className={config.printSettings?.modifications?.highlightExtra ? 'text-green-600' : 'text-gray-900'}>
                {config.printSettings?.modifications?.highlightExtra ? '\u2713' : '\u25CB'}
              </span>
              <span>EXTRA/LIGHT modifications highlighted</span>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className={config.printSettings?.allergyAlerts?.highlightAllergies ? 'text-green-600' : 'text-gray-900'}>
                {config.printSettings?.allergyAlerts?.highlightAllergies ? '\u2713' : '\u25CB'}
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

// ─── Items Tab (replaces SpecialtiesTab) ────────────────────────────────────

export interface ItemsTabProps {
  items: PizzaMenuItem[]
  categories: PizzaCategory[]
  specialties: PizzaSpecialty[]
  onUpdateItem: (itemId: string, updates: Record<string, any>) => Promise<void>
  onCreateItem: (data: { name: string; price: number; categoryId: string }) => Promise<void>
  onDeleteItem: (itemId: string) => void
  onCreateCategory: (name: string, color: string) => Promise<void>
  onDeleteCategory: (categoryId: string) => void
  onEditSpecialty: (specialty: PizzaSpecialty) => void
  onAddSpecialty: () => void
  onDeleteSpecialty: (specialtyId: string) => void
}

// Default category colors for the color picker
const CATEGORY_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4',
  '#3b82f6', '#8b5cf6', '#ec4899', '#6b7280', '#78716c',
]

/** Inline editable text field -- renders as plain text until clicked */
function InlineEditText({
  value,
  onSave,
  className = '',
  placeholder = '',
  type = 'text',
}: {
  value: string
  onSave: (val: string) => void
  className?: string
  placeholder?: string
  type?: 'text' | 'number' | 'textarea'
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null)

  useEffect(() => { setDraft(value) }, [value])
  useEffect(() => {
    if (editing && inputRef.current) inputRef.current.focus()
  }, [editing])

  const commit = () => {
    setEditing(false)
    const trimmed = draft.trim()
    if (trimmed !== value && trimmed !== '') {
      onSave(trimmed)
    } else {
      setDraft(value)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && type !== 'textarea') {
      e.preventDefault()
      commit()
    }
    if (e.key === 'Escape') {
      setDraft(value)
      setEditing(false)
    }
  }

  if (!editing) {
    return (
      <span
        onClick={() => setEditing(true)}
        className={`cursor-pointer hover:bg-gray-100 rounded px-1 -mx-1 transition-colors ${className}`}
        title="Click to edit"
      >
        {value || <span className="text-gray-400 italic">{placeholder}</span>}
      </span>
    )
  }

  if (type === 'textarea') {
    return (
      <textarea
        ref={inputRef as React.RefObject<HTMLTextAreaElement>}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        className={`border border-blue-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-400 w-full text-sm ${className}`}
        rows={2}
        placeholder={placeholder}
      />
    )
  }

  return (
    <input
      ref={inputRef as React.RefObject<HTMLInputElement>}
      type={type === 'number' ? 'number' : 'text'}
      step={type === 'number' ? '0.01' : undefined}
      min={type === 'number' ? '0' : undefined}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={handleKeyDown}
      className={`border border-blue-300 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-400 ${className}`}
      placeholder={placeholder}
    />
  )
}

/** Toggle switch */
function Toggle({
  checked,
  onChange,
  label,
  size = 'md',
}: {
  checked: boolean
  onChange: (val: boolean) => void
  label?: string
  size?: 'sm' | 'md'
}) {
  const w = size === 'sm' ? 'w-8' : 'w-10'
  const h = size === 'sm' ? 'h-4' : 'h-5'
  const dot = size === 'sm' ? 'w-3 h-3' : 'w-4 h-4'
  const translate = size === 'sm' ? 'translate-x-4' : 'translate-x-5'

  return (
    <label className="inline-flex items-center gap-2 cursor-pointer select-none">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex ${w} ${h} items-center rounded-full transition-colors ${
          checked ? 'bg-green-500' : 'bg-gray-300'
        }`}
      >
        <span
          className={`inline-block ${dot} transform rounded-full bg-white transition-transform ${
            checked ? translate : 'translate-x-0.5'
          }`}
        />
      </button>
      {label && <span className="text-sm text-gray-700">{label}</span>}
    </label>
  )
}

/** Tag input for allergens */
function TagInput({
  tags,
  onChange,
}: {
  tags: string[]
  onChange: (tags: string[]) => void
}) {
  const [draft, setDraft] = useState('')

  const addTag = () => {
    const trimmed = draft.trim()
    if (trimmed && !tags.includes(trimmed)) {
      onChange([...tags, trimmed])
    }
    setDraft('')
  }

  return (
    <div>
      <div className="flex flex-wrap gap-1 mb-1">
        {tags.map(tag => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 border border-amber-200 rounded-full text-xs text-amber-800"
          >
            {tag}
            <button
              type="button"
              onClick={() => onChange(tags.filter(t => t !== tag))}
              className="hover:text-red-500"
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-1">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); addTag() }
          }}
          placeholder="Add allergen..."
          className="flex-1 text-xs border rounded px-2 py-1"
        />
        <button
          type="button"
          onClick={addTag}
          className="text-xs px-2 py-1 bg-gray-100 border rounded hover:bg-gray-200"
        >
          Add
        </button>
      </div>
    </div>
  )
}

export function ItemsTab({
  items,
  categories,
  specialties,
  onUpdateItem,
  onCreateItem,
  onDeleteItem,
  onCreateCategory,
  onDeleteCategory,
  onEditSpecialty,
  onAddSpecialty,
  onDeleteSpecialty,
}: ItemsTabProps) {
  // Category filter
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null)

  // New category form
  const [showNewCategory, setShowNewCategory] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [newCatColor, setNewCatColor] = useState(CATEGORY_COLORS[0])
  const [creatingCategory, setCreatingCategory] = useState(false)

  // New item form
  const [showNewItem, setShowNewItem] = useState(false)
  const [newItemName, setNewItemName] = useState('')
  const [newItemPrice, setNewItemPrice] = useState('')
  const [newItemCategoryId, setNewItemCategoryId] = useState('')
  const [creatingItem, setCreatingItem] = useState(false)

  // Expanded items
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())

  // Delete confirm
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [deleteCategoryConfirmId, setDeleteCategoryConfirmId] = useState<string | null>(null)

  // Build specialty lookup
  const specialtyMap = new Map(specialties.map(s => [s.menuItemId, s]))

  // Sort items: by category, then sortOrder, then name. Inactive at the bottom.
  const sortedItems = [...items].sort((a, b) => {
    // Inactive items go to the bottom
    const aActive = a.isActive !== false
    const bActive = b.isActive !== false
    if (aActive !== bActive) return aActive ? -1 : 1

    // By category name
    const aCat = (a.categoryName || '').toLowerCase()
    const bCat = (b.categoryName || '').toLowerCase()
    if (aCat !== bCat) return aCat.localeCompare(bCat)

    // By sortOrder
    const aSort = a.sortOrder ?? 999
    const bSort = b.sortOrder ?? 999
    if (aSort !== bSort) return aSort - bSort

    // By name
    return a.name.localeCompare(b.name)
  })

  // Client-side category filter
  const filteredItems = activeCategoryId
    ? sortedItems.filter(item => item.categoryId === activeCategoryId)
    : sortedItems

  // Category counts
  const categoryCountMap = new Map<string, number>()
  for (const item of items) {
    if (item.categoryId) {
      categoryCountMap.set(item.categoryId, (categoryCountMap.get(item.categoryId) || 0) + 1)
    }
  }

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleCreateCategory = async () => {
    if (!newCatName.trim()) return
    setCreatingCategory(true)
    try {
      await onCreateCategory(newCatName.trim(), newCatColor)
      setNewCatName('')
      setNewCatColor(CATEGORY_COLORS[0])
      setShowNewCategory(false)
    } finally {
      setCreatingCategory(false)
    }
  }

  const handleCreateItem = async () => {
    if (!newItemName.trim() || !newItemPrice) return
    setCreatingItem(true)
    try {
      await onCreateItem({
        name: newItemName.trim(),
        price: parseFloat(newItemPrice) || 0,
        categoryId: newItemCategoryId,
      })
      setNewItemName('')
      setNewItemPrice('')
      setNewItemCategoryId('')
      setShowNewItem(false)
    } finally {
      setCreatingItem(false)
    }
  }

  return (
    <Card>
      {/* Header: Category Filter Bar */}
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between mb-3">
          <CardTitle>Pizza Items ({items.length})</CardTitle>
          <Button onClick={() => setShowNewItem(!showNewItem)}>
            <Plus className="w-4 h-4 mr-1" />
            New Item
          </Button>
        </div>

        {/* Category filter pills */}
        <div className="flex flex-wrap gap-2 items-center">
          {/* "All" pill */}
          <button
            onClick={() => setActiveCategoryId(null)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              activeCategoryId === null
                ? 'bg-orange-500 text-white shadow-sm'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            All
            <span className={`text-xs px-1.5 py-0.5 rounded-full ${
              activeCategoryId === null ? 'bg-orange-600 text-white' : 'bg-gray-200 text-gray-600'
            }`}>
              {items.length}
            </span>
          </button>

          {/* Category pills */}
          {categories.map(cat => {
            const count = categoryCountMap.get(cat.id) || 0
            const isActive = activeCategoryId === cat.id
            return (
              <div key={cat.id} className="relative group">
                <button
                  onClick={() => setActiveCategoryId(isActive ? null : cat.id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                    isActive
                      ? 'text-white shadow-sm'
                      : 'text-gray-700 hover:opacity-80'
                  }`}
                  style={{
                    backgroundColor: isActive ? cat.color : `${cat.color}20`,
                    borderColor: cat.color,
                  }}
                >
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: isActive ? 'white' : cat.color }}
                  />
                  {cat.name}
                  <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                    isActive ? 'bg-white/20 text-white' : 'bg-white/60 text-gray-600'
                  }`}>
                    {count}
                  </span>
                </button>
                {/* Delete button for categories */}
                {deleteCategoryConfirmId === cat.id ? (
                  <div className="absolute -top-1 -right-1 z-10 bg-white border border-red-300 rounded-lg shadow-lg p-2 flex items-center gap-1">
                    <button
                      onClick={() => { onDeleteCategory(cat.id); setDeleteCategoryConfirmId(null) }}
                      className="text-xs bg-red-500 text-white px-2 py-0.5 rounded hover:bg-red-600"
                    >
                      Delete
                    </button>
                    <button
                      onClick={() => setDeleteCategoryConfirmId(null)}
                      className="text-xs text-gray-500 px-1 hover:text-gray-700"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={(e) => { e.stopPropagation(); setDeleteCategoryConfirmId(cat.id) }}
                    className="absolute -top-1 -right-1 w-4 h-4 bg-gray-200 rounded-full items-center justify-center text-gray-500 hover:bg-red-100 hover:text-red-500 hidden group-hover:flex text-xs"
                    title="Delete category"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            )
          })}

          {/* "+ Add" category button */}
          {!showNewCategory ? (
            <button
              onClick={() => setShowNewCategory(true)}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-medium text-gray-500 border border-dashed border-gray-300 hover:border-gray-400 hover:text-gray-700 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Add
            </button>
          ) : (
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-white border rounded-lg shadow-sm">
              <input
                type="text"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                placeholder="Category name"
                className="w-28 text-sm border-b border-gray-200 focus:border-blue-400 focus:outline-none px-1 py-0.5"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateCategory()
                  if (e.key === 'Escape') { setShowNewCategory(false); setNewCatName('') }
                }}
              />
              <div className="flex gap-1">
                {CATEGORY_COLORS.map(color => (
                  <button
                    key={color}
                    onClick={() => setNewCatColor(color)}
                    className={`w-4 h-4 rounded-full border-2 transition-transform ${
                      newCatColor === color ? 'border-gray-800 scale-125' : 'border-transparent hover:scale-110'
                    }`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
              <Button
                size="sm"
                onClick={handleCreateCategory}
                disabled={!newCatName.trim() || creatingCategory}
                className="text-xs h-7"
              >
                {creatingCategory ? '...' : 'Create'}
              </Button>
              <button
                onClick={() => { setShowNewCategory(false); setNewCatName('') }}
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent>
        {/* New Item Inline Form */}
        {showNewItem && (
          <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex-1 min-w-[180px]">
                <label className="block text-xs font-medium text-gray-600 mb-1">Name</label>
                <input
                  type="text"
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  placeholder="e.g. Margherita Pizza"
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateItem()
                    if (e.key === 'Escape') setShowNewItem(false)
                  }}
                />
              </div>
              <div className="w-28">
                <label className="block text-xs font-medium text-gray-600 mb-1">Price</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={newItemPrice}
                  onChange={(e) => setNewItemPrice(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreateItem()
                  }}
                />
              </div>
              <div className="w-44">
                <label className="block text-xs font-medium text-gray-600 mb-1">Category</label>
                <select
                  value={newItemCategoryId}
                  onChange={(e) => setNewItemCategoryId(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  <option value="">Select category...</option>
                  {categories.map(cat => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
              </div>
              <Button
                onClick={handleCreateItem}
                disabled={!newItemName.trim() || !newItemPrice || creatingItem}
                className="h-[38px]"
              >
                {creatingItem ? 'Adding...' : 'Add Item'}
              </Button>
              <button
                onClick={() => setShowNewItem(false)}
                className="text-gray-400 hover:text-gray-600 pb-2"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}

        {/* Item Cards */}
        {filteredItems.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-4xl mb-3">🍕</div>
            <p className="text-gray-900 mb-1">
              {activeCategoryId ? 'No items in this category.' : 'No pizza items yet.'}
            </p>
            <p className="text-sm text-gray-500">
              {activeCategoryId
                ? 'Try selecting a different category or create a new item.'
                : 'Click "+ New Item" to create your first pizza.'}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredItems.map(item => {
              const isExpanded = expandedIds.has(item.id)
              const isActive = item.isActive !== false
              const specialty = specialtyMap.get(item.id)
              const hasSpecialty = !!specialty
              const catObj = categories.find(c => c.id === item.categoryId)

              return (
                <div
                  key={item.id}
                  className={`rounded-lg border transition-shadow hover:shadow-md ${
                    isActive ? 'bg-white' : 'bg-gray-50 opacity-60'
                  }`}
                >
                  {/* Collapsed Row */}
                  <div className="flex items-center gap-3 p-4">
                    {/* Photo placeholder */}
                    {item.imageUrl ? (
                      <img
                        src={item.imageUrl}
                        alt={item.name}
                        className="w-10 h-10 rounded-lg object-cover flex-shrink-0"
                      />
                    ) : (
                      <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center text-lg flex-shrink-0">
                        🍕
                      </div>
                    )}

                    {/* Name (inline editable) */}
                    <div className="flex-1 min-w-0">
                      <InlineEditText
                        value={item.name}
                        onSave={(val) => onUpdateItem(item.id, { name: val })}
                        className="font-semibold text-gray-900 text-base"
                        placeholder="Item name"
                      />
                    </div>

                    {/* Price (inline editable) */}
                    <InlineEditText
                      value={String(item.price)}
                      onSave={(val) => {
                        const num = parseFloat(val)
                        if (!isNaN(num) && num >= 0) onUpdateItem(item.id, { price: num })
                      }}
                      className="font-semibold text-green-600 text-base w-20 text-right"
                      type="number"
                      placeholder="0.00"
                    />

                    {/* Category badge */}
                    {catObj && (
                      <span
                        className="px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0"
                        style={{
                          backgroundColor: `${catObj.color}20`,
                          color: catObj.color,
                        }}
                      >
                        {catObj.name}
                      </span>
                    )}

                    {/* Active toggle */}
                    <Toggle
                      checked={isActive}
                      onChange={(val) => onUpdateItem(item.id, { isActive: val })}
                      size="sm"
                    />

                    {/* Specialty/BYO badge */}
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ${
                      hasSpecialty
                        ? 'bg-orange-100 text-orange-700'
                        : 'bg-blue-50 text-blue-600'
                    }`}>
                      {hasSpecialty ? 'Specialty' : 'BYO'}
                    </span>

                    {/* Expand button */}
                    <button
                      onClick={() => toggleExpand(item.id)}
                      className="p-1 rounded hover:bg-gray-100 transition-colors flex-shrink-0"
                      title={isExpanded ? 'Collapse' : 'Expand'}
                    >
                      {isExpanded
                        ? <ChevronUp className="w-5 h-5 text-gray-500" />
                        : <ChevronDown className="w-5 h-5 text-gray-500" />
                      }
                    </button>
                  </div>

                  {/* Expanded Details */}
                  {isExpanded && (
                    <div className="px-4 pb-4 pt-0">
                      <div className="bg-gray-50 rounded-lg border-t border-gray-200 p-4 space-y-4">
                        {/* Description */}
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">Description</label>
                          <InlineEditText
                            value={item.description || ''}
                            onSave={(val) => onUpdateItem(item.id, { description: val || null })}
                            className="text-sm text-gray-700"
                            type="textarea"
                            placeholder="Add a description..."
                          />
                        </div>

                        {/* Commission */}
                        <div className="flex flex-wrap items-end gap-3">
                          <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Commission</label>
                            <select
                              value={item.commissionType || 'none'}
                              onChange={(e) => {
                                const val = e.target.value === 'none' ? null : e.target.value
                                onUpdateItem(item.id, {
                                  commissionType: val,
                                  commissionValue: val ? (item.commissionValue || 0) : null,
                                })
                              }}
                              className="px-2 py-1.5 border rounded text-sm"
                            >
                              <option value="none">None</option>
                              <option value="fixed">Fixed ($)</option>
                              <option value="percent">Percent (%)</option>
                            </select>
                          </div>
                          {item.commissionType && item.commissionType !== 'none' && (
                            <div>
                              <label className="block text-xs font-medium text-gray-500 mb-1">
                                {item.commissionType === 'fixed' ? 'Amount ($)' : 'Rate (%)'}
                              </label>
                              <input
                                type="number"
                                step={item.commissionType === 'fixed' ? '0.01' : '1'}
                                min="0"
                                defaultValue={item.commissionValue ?? ''}
                                onBlur={(e) => {
                                  const num = parseFloat(e.target.value)
                                  if (!isNaN(num)) onUpdateItem(item.id, { commissionValue: num })
                                }}
                                className="w-24 px-2 py-1.5 border rounded text-sm"
                              />
                            </div>
                          )}
                        </div>

                        {/* Tax */}
                        <div className="flex flex-wrap items-end gap-3">
                          <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Tax Rate (%)</label>
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              defaultValue={item.taxRate ?? ''}
                              onBlur={(e) => {
                                const num = parseFloat(e.target.value)
                                onUpdateItem(item.id, { taxRate: isNaN(num) ? null : num })
                              }}
                              className="w-24 px-2 py-1.5 border rounded text-sm"
                              placeholder="0.00"
                            />
                          </div>
                          <div className="flex items-center gap-2 pb-1">
                            <input
                              type="checkbox"
                              id={`tax-exempt-${item.id}`}
                              checked={item.isTaxExempt || false}
                              onChange={(e) => onUpdateItem(item.id, { isTaxExempt: e.target.checked })}
                              className="w-4 h-4 rounded"
                            />
                            <label htmlFor={`tax-exempt-${item.id}`} className="text-sm text-gray-700">Tax Exempt</label>
                          </div>
                        </div>

                        {/* Allergens */}
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-1">Allergens</label>
                          <TagInput
                            tags={item.allergens || []}
                            onChange={(tags) => onUpdateItem(item.id, { allergens: tags })}
                          />
                        </div>

                        {/* Visibility */}
                        <div>
                          <label className="block text-xs font-medium text-gray-500 mb-2">Visibility</label>
                          <div className="flex items-center gap-6">
                            <Toggle
                              checked={item.showOnPOS !== false}
                              onChange={(val) => onUpdateItem(item.id, { showOnPOS: val })}
                              label="Show on POS"
                            />
                            <Toggle
                              checked={item.showOnline !== false}
                              onChange={(val) => onUpdateItem(item.id, { showOnline: val })}
                              label="Show Online"
                            />
                          </div>
                        </div>

                        {/* Kitchen */}
                        <div className="flex flex-wrap items-end gap-3">
                          <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Prep Station</label>
                            <input
                              type="text"
                              defaultValue={item.prepStationId || ''}
                              onBlur={(e) => {
                                onUpdateItem(item.id, { prepStationId: e.target.value.trim() || null })
                              }}
                              className="w-40 px-2 py-1.5 border rounded text-sm"
                              placeholder="e.g. Pizza Oven"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Prep Time (min)</label>
                            <input
                              type="number"
                              min="0"
                              defaultValue={item.prepTime ?? ''}
                              onBlur={(e) => {
                                const num = parseInt(e.target.value)
                                onUpdateItem(item.id, { prepTime: isNaN(num) ? null : num })
                              }}
                              className="w-24 px-2 py-1.5 border rounded text-sm"
                              placeholder="0"
                            />
                          </div>
                        </div>

                        {/* Actions row */}
                        <div className="flex items-center gap-3 pt-2 border-t border-gray-200">
                          {hasSpecialty ? (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => onEditSpecialty(specialty!)}
                              >
                                Configure Specialty
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-red-500"
                                onClick={() => onDeleteSpecialty(specialty!.id)}
                              >
                                Remove Specialty
                              </Button>
                            </>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={onAddSpecialty}
                            >
                              Configure Specialty
                            </Button>
                          )}

                          <div className="flex-1" />

                          {/* Delete Item */}
                          {deleteConfirmId === item.id ? (
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-red-600 font-medium">Delete this item?</span>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-red-600 hover:bg-red-50"
                                onClick={() => { onDeleteItem(item.id); setDeleteConfirmId(null) }}
                              >
                                Confirm
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setDeleteConfirmId(null)}
                              >
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-red-500 hover:bg-red-50"
                              onClick={() => setDeleteConfirmId(item.id)}
                            >
                              <Trash2 className="w-4 h-4 mr-1" />
                              Delete Item
                            </Button>
                          )}
                        </div>
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
