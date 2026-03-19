'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import type { IngredientLibraryItem, IngredientCategory } from '@/components/menu/IngredientHierarchyPicker'
import { PizzaIngredientLinker } from './PizzaIngredientLinker'
import { formatCurrency } from '@/lib/utils'
import {
  PizzaSize,
  PizzaCrust,
  PizzaSauce,
  PizzaCheese,
  PizzaTopping,
  PizzaSpecialty,
  PizzaMenuItem,
  SpecialtyToppingEntry,
  TOPPING_CATEGORIES,
  AMOUNT_OPTIONS,
  ALL_SECTIONS,
} from './types'

/** Shared ingredient linker props passed through from the page */
export interface IngredientLinkerPassthrough {
  ingredientsLibrary: IngredientLibraryItem[]
  ingredientCategories: IngredientCategory[]
  ingredientInventoryMap: Record<string, string>
  onIngredientCreated: (ingredient: any) => void
  onCategoryCreated: (category: any) => void
  onIngredientDataRefresh: () => void
}

// Size Modal
export interface SizeModalProps extends IngredientLinkerPassthrough {
  size: PizzaSize | null
  onSave: (data: Partial<PizzaSize>) => void
  onClose: () => void
}

export function SizeModal({
  size, onSave, onClose,
  ingredientsLibrary, ingredientCategories, ingredientInventoryMap,
  onIngredientCreated, onCategoryCreated, onIngredientDataRefresh,
}: SizeModalProps) {
  const [name, setName] = useState(size?.name || '')
  const [displayName, setDisplayName] = useState(size?.displayName || '')
  const [inches, setInches] = useState(size?.inches?.toString() || '')
  const [slices, setSlices] = useState(size?.slices?.toString() || '8')
  const [basePrice, setBasePrice] = useState(size?.basePrice?.toString() || '')
  const [toppingMultiplier, setToppingMultiplier] = useState(size?.toppingMultiplier?.toString() || '1.0')
  const [inventoryMultiplier, setInventoryMultiplier] = useState(size?.inventoryMultiplier?.toString() || '1.0')
  const [freeToppings, setFreeToppings] = useState(size?.freeToppings?.toString() || '0')
  const [isDefault, setIsDefault] = useState(size?.isDefault || false)
  const [inventoryItemId, setInventoryItemId] = useState(size?.inventoryItemId || '')
  const [usageQuantity, setUsageQuantity] = useState(size?.usageQuantity?.toString() || '')
  const [usageUnit, setUsageUnit] = useState(size?.usageUnit || 'oz')
  const [selectedItemName, setSelectedItemName] = useState(size?.inventoryItemName || '')

  const handleSubmit = () => {
    if (!name.trim() || !basePrice) return
    onSave({
      name: name.trim(),
      displayName: displayName.trim() || null,
      inches: inches ? parseInt(inches) : null,
      slices: parseInt(slices) || 8,
      basePrice: parseFloat(basePrice),
      toppingMultiplier: parseFloat(toppingMultiplier) || 1.0,
      inventoryMultiplier: parseFloat(inventoryMultiplier) || 1.0,
      freeToppings: parseInt(freeToppings) || 0,
      isDefault,
      inventoryItemId: inventoryItemId || null,
      usageQuantity: usageQuantity ? parseFloat(usageQuantity) : null,
      usageUnit: usageUnit || null,
    })
  }

  return (
    <Modal isOpen={true} onClose={onClose} title={size ? 'Edit Size' : 'Add Size'} size="lg">
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
              <label className="block text-sm font-medium mb-1">Topping Price Multiplier</label>
              <input
                type="number"
                step="0.1"
                value={toppingMultiplier}
                onChange={(e) => setToppingMultiplier(e.target.value)}
                className="w-full p-2 border rounded-lg"
              />
              <p className="text-xs text-gray-900 mt-1">Scales topping prices (1.0 = standard)</p>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Inventory Multiplier</label>
              <input
                type="number"
                step="0.1"
                value={inventoryMultiplier}
                onChange={(e) => setInventoryMultiplier(e.target.value)}
                className="w-full p-2 border rounded-lg"
              />
              <p className="text-xs text-gray-900 mt-1">Scales all ingredient usage (Small=0.75, Med=1.0, Lg=1.3)</p>
            </div>
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
          <PizzaIngredientLinker
            inventoryItemId={inventoryItemId}
            setInventoryItemId={setInventoryItemId}
            selectedItemName={selectedItemName}
            setSelectedItemName={setSelectedItemName}
            usageQuantity={usageQuantity}
            setUsageQuantity={setUsageQuantity}
            usageUnit={usageUnit}
            setUsageUnit={setUsageUnit}
            ingredientsLibrary={ingredientsLibrary}
            ingredientCategories={ingredientCategories}
            ingredientInventoryMap={ingredientInventoryMap}
            onIngredientCreated={onIngredientCreated}
            onCategoryCreated={onCategoryCreated}
            onIngredientDataRefresh={onIngredientDataRefresh}
            componentLabel="size"
          />
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit}>Save</Button>
        </div>
    </Modal>
  )
}

// Crust Modal
export interface CrustModalProps extends IngredientLinkerPassthrough {
  crust: PizzaCrust | null
  onSave: (data: Partial<PizzaCrust>) => void
  onClose: () => void
}

export function CrustModal({
  crust, onSave, onClose,
  ingredientsLibrary, ingredientCategories, ingredientInventoryMap,
  onIngredientCreated, onCategoryCreated, onIngredientDataRefresh,
}: CrustModalProps) {
  const [name, setName] = useState(crust?.name || '')
  const [displayName, setDisplayName] = useState(crust?.displayName || '')
  const [description, setDescription] = useState(crust?.description || '')
  const [price, setPrice] = useState(crust?.price?.toString() || '0')
  const [isDefault, setIsDefault] = useState(crust?.isDefault || false)
  const [inventoryItemId, setInventoryItemId] = useState(crust?.inventoryItemId || '')
  const [usageQuantity, setUsageQuantity] = useState(crust?.usageQuantity?.toString() || '')
  const [usageUnit, setUsageUnit] = useState(crust?.usageUnit || 'oz')
  const [selectedItemName, setSelectedItemName] = useState(crust?.inventoryItemName || '')

  const handleSubmit = () => {
    if (!name.trim()) return
    onSave({
      name: name.trim(),
      displayName: displayName.trim() || null,
      description: description.trim() || null,
      price: parseFloat(price) || 0,
      isDefault,
      inventoryItemId: inventoryItemId || null,
      usageQuantity: usageQuantity ? parseFloat(usageQuantity) : null,
      usageUnit: usageUnit || null,
    })
  }

  return (
    <Modal isOpen={true} onClose={onClose} title={crust ? 'Edit Crust' : 'Add Crust'} size="lg">
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
              id="crustDefault"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="w-5 h-5 rounded"
            />
            <label htmlFor="crustDefault" className="text-sm font-medium">Default Crust</label>
          </div>
          <PizzaIngredientLinker
            inventoryItemId={inventoryItemId}
            setInventoryItemId={setInventoryItemId}
            selectedItemName={selectedItemName}
            setSelectedItemName={setSelectedItemName}
            usageQuantity={usageQuantity}
            setUsageQuantity={setUsageQuantity}
            usageUnit={usageUnit}
            setUsageUnit={setUsageUnit}
            ingredientsLibrary={ingredientsLibrary}
            ingredientCategories={ingredientCategories}
            ingredientInventoryMap={ingredientInventoryMap}
            onIngredientCreated={onIngredientCreated}
            onCategoryCreated={onCategoryCreated}
            onIngredientDataRefresh={onIngredientDataRefresh}
            componentLabel="crust"
          />
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit}>Save</Button>
        </div>
    </Modal>
  )
}

// Sauce Modal
export interface SauceModalProps extends IngredientLinkerPassthrough {
  sauce: PizzaSauce | null
  onSave: (data: Partial<PizzaSauce>) => void
  onClose: () => void
}

export function SauceModal({
  sauce, onSave, onClose,
  ingredientsLibrary, ingredientCategories, ingredientInventoryMap,
  onIngredientCreated, onCategoryCreated, onIngredientDataRefresh,
}: SauceModalProps) {
  const [name, setName] = useState(sauce?.name || '')
  const [description, setDescription] = useState(sauce?.description || '')
  const [price, setPrice] = useState(sauce?.price?.toString() || '0')
  const [allowLight, setAllowLight] = useState(sauce?.allowLight ?? true)
  const [allowExtra, setAllowExtra] = useState(sauce?.allowExtra ?? true)
  const [extraPrice, setExtraPrice] = useState(sauce?.extraPrice?.toString() || '0')
  const [isDefault, setIsDefault] = useState(sauce?.isDefault || false)
  const [inventoryItemId, setInventoryItemId] = useState(sauce?.inventoryItemId || '')
  const [usageQuantity, setUsageQuantity] = useState(sauce?.usageQuantity?.toString() || '')
  const [usageUnit, setUsageUnit] = useState(sauce?.usageUnit || 'oz')
  const [selectedItemName, setSelectedItemName] = useState(sauce?.inventoryItemName || '')

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
      inventoryItemId: inventoryItemId || null,
      usageQuantity: usageQuantity ? parseFloat(usageQuantity) : null,
      usageUnit: usageUnit || null,
    })
  }

  return (
    <Modal isOpen={true} onClose={onClose} title={sauce ? 'Edit Sauce' : 'Add Sauce'} size="lg">
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
                id="sauceAllowLight"
                checked={allowLight}
                onChange={(e) => setAllowLight(e.target.checked)}
                className="w-4 h-4 rounded"
              />
              <label htmlFor="sauceAllowLight" className="text-sm">Allow Light</label>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="sauceAllowExtra"
                checked={allowExtra}
                onChange={(e) => setAllowExtra(e.target.checked)}
                className="w-4 h-4 rounded"
              />
              <label htmlFor="sauceAllowExtra" className="text-sm">Allow Extra</label>
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
              id="sauceDefault"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="w-5 h-5 rounded"
            />
            <label htmlFor="sauceDefault" className="text-sm font-medium">Default Sauce</label>
          </div>
          <PizzaIngredientLinker
            inventoryItemId={inventoryItemId}
            setInventoryItemId={setInventoryItemId}
            selectedItemName={selectedItemName}
            setSelectedItemName={setSelectedItemName}
            usageQuantity={usageQuantity}
            setUsageQuantity={setUsageQuantity}
            usageUnit={usageUnit}
            setUsageUnit={setUsageUnit}
            ingredientsLibrary={ingredientsLibrary}
            ingredientCategories={ingredientCategories}
            ingredientInventoryMap={ingredientInventoryMap}
            onIngredientCreated={onIngredientCreated}
            onCategoryCreated={onCategoryCreated}
            onIngredientDataRefresh={onIngredientDataRefresh}
            componentLabel="sauce"
          />
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit}>Save</Button>
        </div>
    </Modal>
  )
}

// Cheese Modal
export interface CheeseModalProps extends IngredientLinkerPassthrough {
  cheese: PizzaCheese | null
  onSave: (data: Partial<PizzaCheese>) => void
  onClose: () => void
}

export function CheeseModal({
  cheese, onSave, onClose,
  ingredientsLibrary, ingredientCategories, ingredientInventoryMap,
  onIngredientCreated, onCategoryCreated, onIngredientDataRefresh,
}: CheeseModalProps) {
  const [name, setName] = useState(cheese?.name || '')
  const [description, setDescription] = useState(cheese?.description || '')
  const [price, setPrice] = useState(cheese?.price?.toString() || '0')
  const [allowLight, setAllowLight] = useState(cheese?.allowLight ?? true)
  const [allowExtra, setAllowExtra] = useState(cheese?.allowExtra ?? true)
  const [extraPrice, setExtraPrice] = useState(cheese?.extraPrice?.toString() || '0')
  const [isDefault, setIsDefault] = useState(cheese?.isDefault || false)
  const [inventoryItemId, setInventoryItemId] = useState(cheese?.inventoryItemId || '')
  const [usageQuantity, setUsageQuantity] = useState(cheese?.usageQuantity?.toString() || '')
  const [usageUnit, setUsageUnit] = useState(cheese?.usageUnit || 'oz')
  const [selectedItemName, setSelectedItemName] = useState(cheese?.inventoryItemName || '')

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
      inventoryItemId: inventoryItemId || null,
      usageQuantity: usageQuantity ? parseFloat(usageQuantity) : null,
      usageUnit: usageUnit || null,
    })
  }

  return (
    <Modal isOpen={true} onClose={onClose} title={cheese ? 'Edit Cheese' : 'Add Cheese'} size="lg">
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
                id="cheeseAllowLight"
                checked={allowLight}
                onChange={(e) => setAllowLight(e.target.checked)}
                className="w-4 h-4 rounded"
              />
              <label htmlFor="cheeseAllowLight" className="text-sm">Allow Light</label>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="cheeseAllowExtra"
                checked={allowExtra}
                onChange={(e) => setAllowExtra(e.target.checked)}
                className="w-4 h-4 rounded"
              />
              <label htmlFor="cheeseAllowExtra" className="text-sm">Allow Extra</label>
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
              id="cheeseDefault"
              checked={isDefault}
              onChange={(e) => setIsDefault(e.target.checked)}
              className="w-5 h-5 rounded"
            />
            <label htmlFor="cheeseDefault" className="text-sm font-medium">Default Cheese</label>
          </div>
          <PizzaIngredientLinker
            inventoryItemId={inventoryItemId}
            setInventoryItemId={setInventoryItemId}
            selectedItemName={selectedItemName}
            setSelectedItemName={setSelectedItemName}
            usageQuantity={usageQuantity}
            setUsageQuantity={setUsageQuantity}
            usageUnit={usageUnit}
            setUsageUnit={setUsageUnit}
            ingredientsLibrary={ingredientsLibrary}
            ingredientCategories={ingredientCategories}
            ingredientInventoryMap={ingredientInventoryMap}
            onIngredientCreated={onIngredientCreated}
            onCategoryCreated={onCategoryCreated}
            onIngredientDataRefresh={onIngredientDataRefresh}
            componentLabel="cheese"
          />
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit}>Save</Button>
        </div>
    </Modal>
  )
}

// Topping Modal
export interface ToppingModalProps extends IngredientLinkerPassthrough {
  topping: PizzaTopping | null
  onSave: (data: Partial<PizzaTopping>) => void
  onClose: () => void
}

export function ToppingModal({
  topping, onSave, onClose,
  ingredientsLibrary, ingredientCategories, ingredientInventoryMap,
  onIngredientCreated, onCategoryCreated, onIngredientDataRefresh,
}: ToppingModalProps) {
  const [name, setName] = useState(topping?.name || '')
  const [displayName, setDisplayName] = useState(topping?.displayName || '')
  const [description, setDescription] = useState(topping?.description || '')
  const [category, setCategory] = useState(topping?.category || 'standard')
  const [price, setPrice] = useState(topping?.price?.toString() || '')
  const [extraPrice, setExtraPrice] = useState(topping?.extraPrice?.toString() || '')
  const [color, setColor] = useState(topping?.color || '')
  const [inventoryItemId, setInventoryItemId] = useState(topping?.inventoryItemId || '')
  const [usageQuantity, setUsageQuantity] = useState(topping?.usageQuantity?.toString() || '')
  const [usageUnit, setUsageUnit] = useState(topping?.usageUnit || 'oz')
  const [selectedItemName, setSelectedItemName] = useState(topping?.inventoryItemName || '')

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
      inventoryItemId: inventoryItemId || null,
      usageQuantity: usageQuantity ? parseFloat(usageQuantity) : null,
      usageUnit: usageUnit || null,
    })
  }

  return (
    <Modal isOpen={true} onClose={onClose} title={topping ? 'Edit Topping' : 'Add Topping'} size="lg">
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
          <PizzaIngredientLinker
            inventoryItemId={inventoryItemId}
            setInventoryItemId={setInventoryItemId}
            selectedItemName={selectedItemName}
            setSelectedItemName={setSelectedItemName}
            usageQuantity={usageQuantity}
            setUsageQuantity={setUsageQuantity}
            usageUnit={usageUnit}
            setUsageUnit={setUsageUnit}
            ingredientsLibrary={ingredientsLibrary}
            ingredientCategories={ingredientCategories}
            ingredientInventoryMap={ingredientInventoryMap}
            onIngredientCreated={onIngredientCreated}
            onCategoryCreated={onCategoryCreated}
            onIngredientDataRefresh={onIngredientDataRefresh}
            componentLabel="topping"
          />
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
    </Modal>
  )
}

// Specialty Modal
export interface SpecialtyModalProps {
  specialty: PizzaSpecialty | null
  pizzaMenuItems: PizzaMenuItem[]
  existingSpecialtyMenuItemIds: string[]
  crusts: PizzaCrust[]
  sauces: PizzaSauce[]
  cheeses: PizzaCheese[]
  toppings: PizzaTopping[]
  onSave: (data: any) => void
  onClose: () => void
  locationId?: string
  onMenuItemCreated?: () => void
}

export function SpecialtyModal({
  specialty, pizzaMenuItems, existingSpecialtyMenuItemIds,
  crusts, sauces, cheeses, toppings,
  onSave, onClose, locationId, onMenuItemCreated,
}: SpecialtyModalProps) {
  const isEdit = !!specialty
  const [menuItemId, setMenuItemId] = useState(specialty?.menuItemId || '')
  const [defaultCrustId, setDefaultCrustId] = useState(specialty?.defaultCrustId || '')
  const [defaultSauceId, setDefaultSauceId] = useState(specialty?.defaultSauceId || '')
  const [defaultCheeseId, setDefaultCheeseId] = useState(specialty?.defaultCheeseId || '')
  const [sauceAmount, setSauceAmount] = useState(specialty?.sauceAmount || 'regular')
  const [cheeseAmount, setCheeseAmount] = useState(specialty?.cheeseAmount || 'regular')
  const [selectedToppings, setSelectedToppings] = useState<SpecialtyToppingEntry[]>(specialty?.toppings || [])
  const [allowSizeChange, setAllowSizeChange] = useState(specialty?.allowSizeChange ?? true)
  const [allowCrustChange, setAllowCrustChange] = useState(specialty?.allowCrustChange ?? true)
  const [allowSauceChange, setAllowSauceChange] = useState(specialty?.allowSauceChange ?? true)
  const [allowCheeseChange, setAllowCheeseChange] = useState(specialty?.allowCheeseChange ?? true)
  const [allowToppingMods, setAllowToppingMods] = useState(specialty?.allowToppingMods ?? true)
  const [toppingCategoryTab, setToppingCategoryTab] = useState('all')

  // Inline "Create New Pizza" state
  const [showCreateNew, setShowCreateNew] = useState(false)
  const [newPizzaName, setNewPizzaName] = useState('')
  const [newPizzaPrice, setNewPizzaPrice] = useState('')
  const [creatingNew, setCreatingNew] = useState(false)

  // Available menu items (exclude those already linked to a specialty, unless editing this one)
  const availableMenuItems = pizzaMenuItems.filter(
    item => !existingSpecialtyMenuItemIds.includes(item.id) || item.id === specialty?.menuItemId
  )

  const selectedMenuItem = pizzaMenuItems.find(m => m.id === menuItemId)

  // Topping helpers
  const addTopping = (topping: PizzaTopping) => {
    if (selectedToppings.some(t => t.toppingId === topping.id)) return
    setSelectedToppings(prev => [...prev, {
      toppingId: topping.id,
      name: topping.name,
      sections: [...ALL_SECTIONS], // whole pizza
      amount: 'regular',
    }])
  }

  const removeTopping = (toppingId: string) => {
    setSelectedToppings(prev => prev.filter(t => t.toppingId !== toppingId))
  }

  const updateToppingAmount = (toppingId: string, amount: string) => {
    setSelectedToppings(prev => prev.map(t =>
      t.toppingId === toppingId ? { ...t, amount } : t
    ))
  }

  const updateToppingSections = (toppingId: string, sectionMode: 'whole' | 'left' | 'right') => {
    const sectionMap = {
      whole: [...ALL_SECTIONS],
      left: ALL_SECTIONS.filter(i => i < 12),
      right: ALL_SECTIONS.filter(i => i >= 12),
    }
    setSelectedToppings(prev => prev.map(t =>
      t.toppingId === toppingId ? { ...t, sections: sectionMap[sectionMode] } : t
    ))
  }

  const getToppingSectionMode = (sections: number[]): 'whole' | 'left' | 'right' => {
    if (sections.length === 24) return 'whole'
    if (sections.length === 12 && sections.every(s => s < 12)) return 'left'
    if (sections.length === 12 && sections.every(s => s >= 12)) return 'right'
    return 'whole'
  }

  // Filter toppings by category for the picker
  const filteredPickerToppings = toppingCategoryTab === 'all'
    ? toppings
    : toppings.filter(t => t.category === toppingCategoryTab)

  const handleSubmit = () => {
    if (!menuItemId && !isEdit) return
    onSave({
      menuItemId,
      defaultCrustId: defaultCrustId || null,
      defaultSauceId: defaultSauceId || null,
      defaultCheeseId: defaultCheeseId || null,
      sauceAmount,
      cheeseAmount,
      toppings: selectedToppings,
      allowSizeChange,
      allowCrustChange,
      allowSauceChange,
      allowCheeseChange,
      allowToppingMods,
    })
  }

  const modToggles = [
    { key: 'allowSizeChange', label: 'Size', value: allowSizeChange, setter: setAllowSizeChange },
    { key: 'allowCrustChange', label: 'Crust', value: allowCrustChange, setter: setAllowCrustChange },
    { key: 'allowSauceChange', label: 'Sauce', value: allowSauceChange, setter: setAllowSauceChange },
    { key: 'allowCheeseChange', label: 'Cheese', value: allowCheeseChange, setter: setAllowCheeseChange },
    { key: 'allowToppingMods', label: 'Toppings', value: allowToppingMods, setter: setAllowToppingMods },
  ]

  return (
    <Modal isOpen={true} onClose={onClose} title={isEdit ? 'Edit Specialty Pizza' : 'Create Specialty Pizza'} size="3xl">
      <div className="space-y-6">

        {/* Step 1: Pizza Name & Price */}
        <div>
          <label className="block text-sm font-semibold text-gray-700 mb-2">Pizza *</label>
          {isEdit ? (
            <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border">
              <div className="text-lg font-bold">{specialty?.menuItem.name}</div>
              <div className="text-sm text-green-600 font-medium">{formatCurrency(specialty?.menuItem.price || 0)}</div>
              <span className="text-xs text-gray-400 ml-auto">Cannot change after creation</span>
            </div>
          ) : showCreateNew ? (
            /* Inline create new pizza */
            <div className="space-y-2">
              <div className="flex gap-3">
                <input
                  type="text"
                  value={newPizzaName}
                  onChange={(e) => setNewPizzaName(e.target.value)}
                  placeholder="Pizza name (e.g., BBQ Chicken)"
                  className="flex-1 p-2.5 border rounded-lg text-sm"
                  autoFocus
                />
                <input
                  type="number"
                  value={newPizzaPrice}
                  onChange={(e) => setNewPizzaPrice(e.target.value)}
                  placeholder="Price"
                  step="0.01"
                  min="0"
                  className="w-28 p-2.5 border rounded-lg text-sm"
                />
                <button
                  onClick={async () => {
                    if (!newPizzaName.trim() || !newPizzaPrice || !locationId) return
                    setCreatingNew(true)
                    try {
                      // Find or create a pizza category
                      const catRes = await fetch(`/api/menu/categories?locationId=${locationId}`)
                      const catData = await catRes.json()
                      const cats = catData.data?.categories || catData.categories || catData || []
                      let pizzaCat = (Array.isArray(cats) ? cats : []).find(
                        (c: any) => c.categoryType === 'pizza' || c.name?.toLowerCase().includes('pizza')
                      )
                      if (!pizzaCat) {
                        // Create a pizza category
                        const newCatRes = await fetch('/api/menu/categories', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ locationId, name: 'Pizza', categoryType: 'pizza' }),
                        })
                        const newCatData = await newCatRes.json()
                        pizzaCat = newCatData.data?.category || newCatData
                      }
                      // Create the menu item
                      const itemRes = await fetch('/api/menu/items', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          locationId,
                          name: newPizzaName.trim(),
                          price: parseFloat(newPizzaPrice),
                          categoryId: pizzaCat.id,
                          itemType: 'pizza',
                        }),
                      })
                      const itemData = await itemRes.json()
                      const newItem = itemData.data?.item || itemData
                      if (newItem?.id) {
                        setMenuItemId(newItem.id)
                        setShowCreateNew(false)
                        setNewPizzaName('')
                        setNewPizzaPrice('')
                        onMenuItemCreated?.()
                      }
                    } catch (err) {
                      console.error('Failed to create pizza:', err)
                    } finally {
                      setCreatingNew(false)
                    }
                  }}
                  disabled={!newPizzaName.trim() || !newPizzaPrice || creatingNew}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50"
                >
                  {creatingNew ? '...' : 'Create'}
                </button>
              </div>
              <button
                onClick={() => setShowCreateNew(false)}
                className="text-xs text-blue-600 hover:underline"
              >
                ← Pick an existing pizza instead
              </button>
            </div>
          ) : (
            /* Select existing or create new */
            <div className="space-y-2">
              {availableMenuItems.length > 0 ? (
                <select
                  value={menuItemId}
                  onChange={(e) => setMenuItemId(e.target.value)}
                  className="w-full p-2.5 border rounded-lg text-sm"
                >
                  <option value="">Select an existing pizza...</option>
                  {availableMenuItems.map(item => (
                    <option key={item.id} value={item.id}>
                      {item.name} - {formatCurrency(item.price)}
                      {item.categoryName ? ` (${item.categoryName})` : ''}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-sm text-gray-500 italic">No pizza menu items available.</p>
              )}
              <button
                onClick={() => setShowCreateNew(true)}
                className="text-sm text-blue-600 hover:underline font-medium"
              >
                + Create a new pizza
              </button>
            </div>
          )}
          {!isEdit && selectedMenuItem && !showCreateNew && (
            <div className="mt-1.5 text-sm text-green-600 font-medium">
              Selected: {selectedMenuItem.name} - {formatCurrency(selectedMenuItem.price)}
            </div>
          )}
        </div>

        {/* Step 2: Default Configuration */}
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-gray-700 border-b pb-1">Default Configuration</h3>

          {/* Crust */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Default Crust</label>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setDefaultCrustId('')}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                  !defaultCrustId
                    ? 'bg-orange-500 text-white border-orange-500'
                    : 'bg-white text-gray-700 border-gray-200 hover:border-orange-300'
                }`}
              >
                None
              </button>
              {crusts.map(crust => (
                <button
                  key={crust.id}
                  onClick={() => setDefaultCrustId(crust.id)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                    defaultCrustId === crust.id
                      ? 'bg-orange-500 text-white border-orange-500'
                      : 'bg-white text-gray-700 border-gray-200 hover:border-orange-300'
                  }`}
                >
                  {crust.name}
                  {crust.price > 0 && <span className="ml-1 text-xs opacity-75">+{formatCurrency(crust.price)}</span>}
                </button>
              ))}
            </div>
          </div>

          {/* Sauce + Amount */}
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Default Sauce</label>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setDefaultSauceId('')}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                    !defaultSauceId
                      ? 'bg-red-500 text-white border-red-500'
                      : 'bg-white text-gray-700 border-gray-200 hover:border-red-300'
                  }`}
                >
                  None
                </button>
                {sauces.map(sauce => (
                  <button
                    key={sauce.id}
                    onClick={() => setDefaultSauceId(sauce.id)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                      defaultSauceId === sauce.id
                        ? 'bg-red-500 text-white border-red-500'
                        : 'bg-white text-gray-700 border-gray-200 hover:border-red-300'
                    }`}
                  >
                    {sauce.name}
                  </button>
                ))}
              </div>
            </div>
            {defaultSauceId && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Amount</label>
                <div className="flex gap-1">
                  {AMOUNT_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setSauceAmount(opt.value)}
                      className={`px-2.5 py-1.5 rounded text-xs font-medium border transition-colors ${
                        sauceAmount === opt.value
                          ? 'bg-red-100 text-red-800 border-red-300'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-red-200'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Cheese + Amount */}
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">Default Cheese</label>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setDefaultCheeseId('')}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                    !defaultCheeseId
                      ? 'bg-yellow-500 text-white border-yellow-500'
                      : 'bg-white text-gray-700 border-gray-200 hover:border-yellow-300'
                  }`}
                >
                  None
                </button>
                {cheeses.map(cheese => (
                  <button
                    key={cheese.id}
                    onClick={() => setDefaultCheeseId(cheese.id)}
                    className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                      defaultCheeseId === cheese.id
                        ? 'bg-yellow-500 text-white border-yellow-500'
                        : 'bg-white text-gray-700 border-gray-200 hover:border-yellow-300'
                    }`}
                  >
                    {cheese.name}
                  </button>
                ))}
              </div>
            </div>
            {defaultCheeseId && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Amount</label>
                <div className="flex gap-1">
                  {AMOUNT_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setCheeseAmount(opt.value)}
                      className={`px-2.5 py-1.5 rounded text-xs font-medium border transition-colors ${
                        cheeseAmount === opt.value
                          ? 'bg-yellow-100 text-yellow-800 border-yellow-300'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-yellow-200'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Toppings Picker */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">
              Toppings ({selectedToppings.length} selected)
            </label>

            {/* Category tabs for the picker */}
            <div className="flex gap-1 mb-2 overflow-x-auto pb-1">
              <button
                onClick={() => setToppingCategoryTab('all')}
                className={`px-2.5 py-1 rounded text-xs font-medium whitespace-nowrap border transition-colors ${
                  toppingCategoryTab === 'all'
                    ? 'bg-gray-800 text-white border-gray-800'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                }`}
              >
                All
              </button>
              {TOPPING_CATEGORIES.map(cat => (
                <button
                  key={cat.value}
                  onClick={() => setToppingCategoryTab(cat.value)}
                  className={`px-2.5 py-1 rounded text-xs font-medium whitespace-nowrap border transition-colors ${
                    toppingCategoryTab === cat.value
                      ? 'text-white border-transparent'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                  }`}
                  style={toppingCategoryTab === cat.value ? { backgroundColor: cat.color } : undefined}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            {/* Topping chips - clickable to add */}
            <div className="flex flex-wrap gap-1.5 p-3 bg-gray-50 rounded-lg border min-h-[48px] max-h-[140px] overflow-y-auto">
              {filteredPickerToppings.length === 0 ? (
                <span className="text-xs text-gray-400">No toppings in this category</span>
              ) : (
                filteredPickerToppings.map(topping => {
                  const isSelected = selectedToppings.some(t => t.toppingId === topping.id)
                  const catConfig = TOPPING_CATEGORIES.find(c => c.value === topping.category)
                  return (
                    <button
                      key={topping.id}
                      onClick={() => isSelected ? removeTopping(topping.id) : addTopping(topping)}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                        isSelected
                          ? 'text-white shadow-sm'
                          : 'bg-white text-gray-700 border-gray-200 hover:border-gray-400'
                      }`}
                      style={isSelected ? {
                        backgroundColor: catConfig?.color || '#f97316',
                        borderColor: catConfig?.color || '#f97316',
                      } : undefined}
                    >
                      {isSelected && '✓ '}{topping.name}
                    </button>
                  )
                })
              )}
            </div>

            {/* Selected toppings with section/amount controls */}
            {selectedToppings.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {selectedToppings.map(st => {
                  const sectionMode = getToppingSectionMode(st.sections)
                  const catConfig = TOPPING_CATEGORIES.find(c => {
                    const topping = toppings.find(t => t.id === st.toppingId)
                    return c.value === topping?.category
                  })
                  return (
                    <div
                      key={st.toppingId}
                      className="flex items-center gap-2 px-3 py-1.5 bg-white rounded-lg border text-sm"
                    >
                      {/* Color dot */}
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: catConfig?.color || '#6b7280' }}
                      />
                      {/* Name */}
                      <span className="font-medium flex-1 min-w-0 truncate">{st.name}</span>
                      {/* Section selector */}
                      <div className="flex gap-0.5 flex-shrink-0">
                        {(['whole', 'left', 'right'] as const).map(mode => (
                          <button
                            key={mode}
                            onClick={() => updateToppingSections(st.toppingId, mode)}
                            className={`px-2 py-0.5 rounded text-xs font-medium border transition-colors ${
                              sectionMode === mode
                                ? 'bg-indigo-100 text-indigo-800 border-indigo-300'
                                : 'bg-white text-gray-500 border-gray-200 hover:border-indigo-200'
                            }`}
                          >
                            {mode === 'whole' ? 'Whole' : mode === 'left' ? 'Left' : 'Right'}
                          </button>
                        ))}
                      </div>
                      {/* Amount selector */}
                      <div className="flex gap-0.5 flex-shrink-0">
                        {AMOUNT_OPTIONS.filter(o => o.value !== 'light').map(opt => (
                          <button
                            key={opt.value}
                            onClick={() => updateToppingAmount(st.toppingId, opt.value)}
                            className={`px-2 py-0.5 rounded text-xs font-medium border transition-colors ${
                              st.amount === opt.value
                                ? 'bg-orange-100 text-orange-800 border-orange-300'
                                : 'bg-white text-gray-500 border-gray-200 hover:border-orange-200'
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>
                      {/* Remove */}
                      <button
                        onClick={() => removeTopping(st.toppingId)}
                        className="text-gray-400 hover:text-red-500 transition-colors flex-shrink-0 ml-1"
                        title="Remove topping"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Step 3: Modification Permissions */}
        <div>
          <h3 className="text-sm font-semibold text-gray-700 border-b pb-1 mb-3">Customer Modification Permissions</h3>
          <div className="flex flex-wrap gap-3">
            {modToggles.map(toggle => (
              <label
                key={toggle.key}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer select-none transition-colors ${
                  toggle.value
                    ? 'bg-green-50 border-green-300'
                    : 'bg-gray-50 border-gray-200'
                }`}
              >
                <input
                  type="checkbox"
                  checked={toggle.value}
                  onChange={(e) => toggle.setter(e.target.checked)}
                  className="sr-only"
                />
                <span className={`w-8 h-5 rounded-full relative transition-colors ${toggle.value ? 'bg-green-500' : 'bg-gray-300'}`}>
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${toggle.value ? 'left-3.5' : 'left-0.5'}`} />
                </span>
                <span className={`text-sm font-medium ${toggle.value ? 'text-green-800' : 'text-gray-500'}`}>
                  {toggle.label}
                </span>
              </label>
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-2">
            Toggle off to lock a component. Customers will not be able to change locked options.
          </p>
        </div>
      </div>

      {/* Save / Cancel */}
      <div className="flex justify-end gap-3 mt-6">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={handleSubmit} disabled={!isEdit && !menuItemId}>
          {isEdit ? 'Save Changes' : 'Create Specialty'}
        </Button>
      </div>
    </Modal>
  )
}
