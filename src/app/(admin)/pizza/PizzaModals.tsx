'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/modal'
import {
  PizzaSize,
  PizzaCrust,
  PizzaSauce,
  PizzaCheese,
  PizzaTopping,
  TOPPING_CATEGORIES,
} from './types'

// Size Modal
export interface SizeModalProps {
  size: PizzaSize | null
  onSave: (data: Partial<PizzaSize>) => void
  onClose: () => void
}

export function SizeModal({ size, onSave, onClose }: SizeModalProps) {
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
    <Modal isOpen={true} onClose={onClose} title={size ? 'Edit Size' : 'Add Size'} size="md">
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
    </Modal>
  )
}

// Crust Modal
export interface CrustModalProps {
  crust: PizzaCrust | null
  onSave: (data: Partial<PizzaCrust>) => void
  onClose: () => void
}

export function CrustModal({ crust, onSave, onClose }: CrustModalProps) {
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
    <Modal isOpen={true} onClose={onClose} title={crust ? 'Edit Crust' : 'Add Crust'} size="md">
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
    </Modal>
  )
}

// Sauce Modal
export interface SauceModalProps {
  sauce: PizzaSauce | null
  onSave: (data: Partial<PizzaSauce>) => void
  onClose: () => void
}

export function SauceModal({ sauce, onSave, onClose }: SauceModalProps) {
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
    <Modal isOpen={true} onClose={onClose} title={sauce ? 'Edit Sauce' : 'Add Sauce'} size="md">
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
    </Modal>
  )
}

// Cheese Modal
export interface CheeseModalProps {
  cheese: PizzaCheese | null
  onSave: (data: Partial<PizzaCheese>) => void
  onClose: () => void
}

export function CheeseModal({ cheese, onSave, onClose }: CheeseModalProps) {
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
    <Modal isOpen={true} onClose={onClose} title={cheese ? 'Edit Cheese' : 'Add Cheese'} size="md">
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
    </Modal>
  )
}

// Topping Modal
export interface ToppingModalProps {
  topping: PizzaTopping | null
  onSave: (data: Partial<PizzaTopping>) => void
  onClose: () => void
}

export function ToppingModal({ topping, onSave, onClose }: ToppingModalProps) {
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
    <Modal isOpen={true} onClose={onClose} title={topping ? 'Edit Topping' : 'Add Topping'} size="md">
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
    </Modal>
  )
}
