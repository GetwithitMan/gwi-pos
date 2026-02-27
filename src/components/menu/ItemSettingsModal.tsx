'use client'

import { useState, useEffect, useCallback } from 'react'
import { Modal } from '@/components/ui/modal'
import { toast } from '@/stores/toast-store'
import { SizingOptionsInline } from './SizingOptionsInline'

interface ItemSettings {
  id: string
  name: string
  displayName: string | null
  price: number
  priceCC: number | null
  description: string | null
  sku: string | null
  imageUrl: string | null
  isActive: boolean
  showOnPOS: boolean
  showOnline: boolean
  // Tax
  taxRate: number | null
  isTaxExempt: boolean
  // Kitchen
  prepTime: number | null
  courseNumber: number | null
  // Availability
  availableFrom: string | null
  availableTo: string | null
  availableDays: string | null
  // Commission
  commissionType: string | null
  commissionValue: number | null
  // Weight-Based Selling
  soldByWeight: boolean
  weightUnit: string | null
  pricePerWeightUnit: number | null
}

interface IngredientLibraryItem {
  id: string
  name: string
  category: string | null
  categoryName: string | null
  categoryId: string | null
  parentIngredientId: string | null
  parentName: string | null
  needsVerification: boolean
  allowNo: boolean
  allowLite: boolean
  allowOnSide: boolean
  allowExtra: boolean
  extraPrice: number
  allowSwap: boolean
  swapModifierGroupId: string | null
  swapUpcharge: number
}

interface IngredientCategory {
  id: string
  code: number
  name: string
  icon: string | null
  color: string | null
  sortOrder: number
  isActive: boolean
  ingredientCount: number
  needsVerification?: boolean
}

interface ItemSettingsModalProps {
  itemId: string
  onClose: () => void
  onSaved: () => void
  ingredientsLibrary?: IngredientLibraryItem[]
  ingredientCategories?: IngredientCategory[]
  locationId?: string
  onIngredientCreated?: (ingredient: IngredientLibraryItem) => void
  onCategoryCreated?: (category: IngredientCategory) => void
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function ItemSettingsModal({ itemId, onClose, onSaved, ingredientsLibrary = [], ingredientCategories = [], locationId = '', onIngredientCreated, onCategoryCreated }: ItemSettingsModalProps) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [activeTab, setActiveTab] = useState('basics')

  // Form state
  const [name, setName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [price, setPrice] = useState('')
  const [priceCC, setPriceCC] = useState<number | null>(null)
  const [description, setDescription] = useState('')
  const [sku, setSku] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [uploading, setUploading] = useState(false)
  const [isActive, setIsActive] = useState(true)
  const [showOnPOS, setShowOnPOS] = useState(true)
  const [showOnline, setShowOnline] = useState(true)
  // Ingredient costing (read-only)
  const [ingredientCosts, setIngredientCosts] = useState<{
    ingredients: { name: string; cost: number | null }[]
    totalCost: number
    hasCostData: boolean
  } | null>(null)
  const [costingLoading, setCostingLoading] = useState(false)
  const [costExpanded, setCostExpanded] = useState(false)
  // Tax
  const [taxRate, setTaxRate] = useState('')
  const [isTaxExempt, setIsTaxExempt] = useState(false)
  // Kitchen
  const [prepTime, setPrepTime] = useState('')
  const [courseNumber, setCourseNumber] = useState('')
  // Availability
  const [availableFrom, setAvailableFrom] = useState('')
  const [availableTo, setAvailableTo] = useState('')
  const [availableDays, setAvailableDays] = useState<Set<string>>(new Set())
  // Commission
  const [commissionType, setCommissionType] = useState('')
  const [commissionValue, setCommissionValue] = useState('')
  // Weight-Based Selling
  const [soldByWeight, setSoldByWeight] = useState(false)
  const [weightUnit, setWeightUnit] = useState('lb')
  const [pricePerWeightUnit, setPricePerWeightUnit] = useState('')
  // Whether size options are active (overrides base price)
  const [sizesActive, setSizesActive] = useState(false)
  const handleSizesActiveChange = useCallback((active: boolean) => setSizesActive(active), [])

  // Fetch full item data on mount
  useEffect(() => {
    const fetchItem = async () => {
      try {
        const res = await fetch(`/api/menu/items/${itemId}`)
        if (!res.ok) throw new Error('Failed to load')
        const raw = await res.json()
        const data = raw.data ?? raw
        const it = data.item as ItemSettings

        setName(it.name || '')
        setDisplayName(it.displayName || '')
        setPrice(String(it.price ?? ''))
        setPriceCC(it.priceCC != null ? Number(it.priceCC) : null)
        setDescription(it.description || '')
        setSku(it.sku || '')
        setImageUrl(it.imageUrl || '')
        setIsActive(it.isActive ?? true)
        setShowOnPOS(it.showOnPOS ?? true)
        setShowOnline(it.showOnline ?? true)
        setTaxRate(it.taxRate != null ? String(it.taxRate) : '')
        setIsTaxExempt(it.isTaxExempt ?? false)
        setPrepTime(it.prepTime != null ? String(it.prepTime) : '')
        setCourseNumber(it.courseNumber != null ? String(it.courseNumber) : '')
        setAvailableFrom(it.availableFrom || '')
        setAvailableTo(it.availableTo || '')
        if (it.availableDays) {
          setAvailableDays(new Set(it.availableDays.split(',')))
        }
        setCommissionType(it.commissionType || '')
        setCommissionValue(it.commissionValue != null ? String(it.commissionValue) : '')
        setSoldByWeight(it.soldByWeight ?? false)
        setWeightUnit(it.weightUnit || 'lb')
        setPricePerWeightUnit(it.pricePerWeightUnit != null ? String(it.pricePerWeightUnit) : '')

        // Auto-focus name if new item
        if (it.name === 'New Item') {
          setActiveTab('basics')
        }

        // Fetch ingredient costing
        fetchIngredientCosts()
      } catch {
        toast.error('Failed to load item settings')
      } finally {
        setLoading(false)
      }
    }

    const fetchIngredientCosts = async () => {
      setCostingLoading(true)
      try {
        // First try formal recipe costing
        const recipeRes = await fetch(`/api/menu/items/${itemId}/inventory-recipe`)
        if (recipeRes.ok) {
          const recipeRaw = await recipeRes.json()
          const recipeData = recipeRaw.data ?? recipeRaw
          if (recipeData.recipe?.ingredients?.length > 0) {
            setIngredientCosts({
              ingredients: recipeData.recipe.ingredients.map((ing: { inventoryItem?: { name?: string } | null; prepItem?: { name?: string } | null; lineCost: number }) => ({
                name: ing.inventoryItem?.name || ing.prepItem?.name || 'Unknown',
                cost: ing.lineCost,
              })),
              totalCost: recipeData.costing?.totalCost ?? 0,
              hasCostData: true,
            })
            setCostingLoading(false)
            return
          }
        }

        // Fall back to MenuItemIngredient list with per-ingredient cost lookups
        const ingRes = await fetch(`/api/menu/items/${itemId}/ingredients`)
        if (ingRes.ok) {
          const ingData = await ingRes.json()
          const items = (ingData.data || []).filter((i: { isIncluded: boolean }) => i.isIncluded)
          if (items.length > 0) {
            // Batch fetch costs for all ingredients in parallel
            const costResults = await Promise.allSettled(
              items.map((i: { ingredientId: string }) =>
                fetch(`/api/ingredients/${i.ingredientId}/cost`).then(r => r.ok ? r.json().then(raw => raw.data ?? raw) : null)
              )
            )

            let totalCost = 0
            let hasCostData = false
            const ingredients = items.map((i: { name: string }, idx: number) => {
              const result = costResults[idx]
              const costData = result.status === 'fulfilled' ? result.value : null
              const cost = costData?.costPerUnit != null ? Number(costData.costPerUnit) : null
              if (cost != null && cost > 0) {
                totalCost += cost
                hasCostData = true
              }
              return { name: i.name, cost }
            })

            setIngredientCosts({ ingredients, totalCost, hasCostData })
          }
        }
      } catch {
        // Silent — costing is informational only
      } finally {
        setCostingLoading(false)
      }
    }

    fetchItem()
  }, [itemId])

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Item name is required')
      return
    }
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        displayName: displayName.trim() || null,
        price: parseFloat(price) || 0,
        description: description.trim() || null,
        sku: sku.trim() || null,
        imageUrl: imageUrl.trim() || null,
        isActive,
        showOnPOS,
        showOnline,
        taxRate: taxRate ? parseFloat(taxRate) : null,
        isTaxExempt,
        prepTime: prepTime ? parseInt(prepTime) : null,
        courseNumber: courseNumber ? parseInt(courseNumber) : null,
        availableFrom: availableFrom || null,
        availableTo: availableTo || null,
        availableDays: availableDays.size > 0 ? Array.from(availableDays).join(',') : null,
        commissionType: commissionType || null,
        commissionValue: commissionValue ? parseFloat(commissionValue) : null,
        // Weight-Based Selling
        soldByWeight,
        weightUnit: soldByWeight ? weightUnit : null,
        pricePerWeightUnit: soldByWeight && pricePerWeightUnit ? parseFloat(pricePerWeightUnit) : null,
      }

      const res = await fetch(`/api/menu/items/${itemId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed to save' }))
        toast.error(err.error || 'Failed to save')
        return
      }

      toast.success('Item settings saved')
      onSaved()
      onClose()
    } catch {
      toast.error('Failed to save item settings')
    } finally {
      setSaving(false)
    }
  }

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/upload', { method: 'POST', body: formData })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Upload failed' }))
        toast.error(err.error || 'Upload failed')
        return
      }
      const raw = await res.json()
      const data = raw.data ?? raw
      setImageUrl(data.url)
      toast.success('Image uploaded')
    } catch {
      toast.error('Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const toggleDay = (dayIndex: string, set: Set<string>, setter: (s: Set<string>) => void) => {
    const next = new Set(set)
    if (next.has(dayIndex)) next.delete(dayIndex)
    else next.add(dayIndex)
    setter(next)
  }

  const tabs = [
    { id: 'basics', label: 'Basics' },
    { id: 'display', label: 'Display & Channels' },
    { id: 'kitchen', label: 'Kitchen & Print' },
    { id: 'availability', label: 'Availability' },
    { id: 'pricing', label: 'Tax & Commission' },
  ]

  const inputClass = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500'
  const labelClass = 'block text-xs font-semibold text-gray-500 mb-1'

  return (
    <Modal isOpen={true} onClose={onClose} title="Edit Item" size="2xl" variant="default">
      <div className="-m-5 bg-white rounded-b-2xl flex flex-col max-h-[75vh]">

        {loading ? (
          <div className="p-12 text-center text-gray-400">Loading...</div>
        ) : (
          <>
            {/* Tabs */}
            <div className="px-5 pt-3 pb-0 shrink-0 flex gap-1 overflow-x-auto">
              {tabs.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                    activeTab === tab.id
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tab Content */}
            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              {/* BASICS TAB */}
              {activeTab === 'basics' && (
                <>
                  <div>
                    <label className={labelClass}>Name *</label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Item name"
                      className={inputClass}
                      autoFocus
                    />
                  </div>
                  <div className={`grid grid-cols-2 gap-3 ${sizesActive ? 'opacity-50 pointer-events-none' : ''}`}>
                    <div>
                      <label className={labelClass}>Price ($)</label>
                      <input
                        type="number"
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                        placeholder="0.00"
                        step="0.01"
                        min="0"
                        className={inputClass}
                        disabled={sizesActive}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Card Price ($)</label>
                      <div className="px-3 py-2 border border-gray-200 rounded-lg text-sm bg-gray-50 text-gray-600">
                        {priceCC != null ? `$${priceCC.toFixed(2)}` : 'Auto from cash discount'}
                      </div>
                      <p className="text-[11px] text-gray-400 mt-0.5">Auto-calculated from cash discount settings.</p>
                    </div>
                  </div>

                  {/* Sold by Weight Toggle */}
                  <div className="border border-gray-200 rounded-xl p-3 space-y-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={soldByWeight}
                        onChange={(e) => setSoldByWeight(e.target.checked)}
                        className="w-4 h-4 rounded"
                      />
                      <span className="text-sm font-medium text-gray-700">Sold by Weight</span>
                      <span className="text-[11px] text-gray-400">(requires scale)</span>
                    </label>
                    {soldByWeight && (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className={labelClass}>Weight Unit</label>
                          <select
                            value={weightUnit}
                            onChange={(e) => setWeightUnit(e.target.value)}
                            className={inputClass}
                          >
                            <option value="lb">Pounds (lb)</option>
                            <option value="kg">Kilograms (kg)</option>
                            <option value="oz">Ounces (oz)</option>
                            <option value="g">Grams (g)</option>
                          </select>
                        </div>
                        <div>
                          <label className={labelClass}>Price per {weightUnit}</label>
                          <input
                            type="number"
                            value={pricePerWeightUnit}
                            onChange={(e) => setPricePerWeightUnit(e.target.value)}
                            placeholder="e.g. 5.99"
                            step="0.01"
                            min="0"
                            className={inputClass}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Size Options (Pricing Variants) */}
                  <SizingOptionsInline
                    itemId={itemId}
                    onSizesActiveChange={handleSizesActiveChange}
                    ingredientsLibrary={ingredientsLibrary}
                    ingredientCategories={ingredientCategories}
                    locationId={locationId}
                    onIngredientCreated={onIngredientCreated}
                    onCategoryCreated={onCategoryCreated}
                  />

                  {/* Ingredient Cost Breakdown — collapsible */}
                  <div className="border border-gray-200 rounded-xl overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setCostExpanded(!costExpanded)}
                      className="w-full px-3 py-2 bg-gray-50 flex items-center justify-between hover:bg-gray-100 transition-colors"
                    >
                      <span className="text-xs font-semibold text-gray-500">INGREDIENT COSTS</span>
                      <span className="flex items-center gap-2">
                        {!costingLoading && ingredientCosts?.hasCostData && (
                          <span className="text-xs font-bold text-gray-700">${ingredientCosts.totalCost.toFixed(2)}</span>
                        )}
                        {!costingLoading && ingredientCosts && !ingredientCosts.hasCostData && ingredientCosts.ingredients.length > 0 && (
                          <span className="text-[11px] text-gray-400">{ingredientCosts.ingredients.length} ingredients</span>
                        )}
                        {costingLoading && <span className="text-[11px] text-gray-400">Loading...</span>}
                        <svg className={`w-3.5 h-3.5 text-gray-400 transition-transform ${costExpanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </span>
                    </button>
                    {costExpanded && (
                      <>
                        {costingLoading ? (
                          <div className="px-3 py-4 text-xs text-gray-400 text-center border-t">Loading costs...</div>
                        ) : ingredientCosts && ingredientCosts.ingredients.length > 0 ? (
                          <div>
                            <div className="divide-y divide-gray-100 border-t">
                              {ingredientCosts.ingredients.map((ing, i) => (
                                <div key={i} className="px-3 py-1.5 flex items-center justify-between">
                                  <span className="text-sm text-gray-700">{ing.name}</span>
                                  <span className={`text-sm font-medium ${ing.cost != null && ing.cost > 0 ? 'text-gray-900' : 'text-gray-300'}`}>
                                    {ing.cost != null && ing.cost > 0 ? `$${ing.cost.toFixed(2)}` : '—'}
                                  </span>
                                </div>
                              ))}
                            </div>
                            <div className="border-t border-gray-200 bg-gray-50 px-3 py-2 space-y-1">
                              {ingredientCosts.hasCostData ? (
                                <>
                                  <div className="flex items-center justify-between">
                                    <span className="text-xs font-semibold text-gray-600">Total Cost</span>
                                    <span className="text-sm font-bold text-gray-900">${ingredientCosts.totalCost.toFixed(2)}</span>
                                  </div>
                                  {parseFloat(price) > 0 && (
                                    <>
                                      <div className="flex items-center justify-between">
                                        <span className="text-xs text-gray-500">Food Cost %</span>
                                        {(() => {
                                          const pct = (ingredientCosts.totalCost / parseFloat(price)) * 100
                                          return (
                                            <span className={`text-xs font-semibold ${pct > 35 ? 'text-red-600' : pct > 28 ? 'text-amber-600' : 'text-green-600'}`}>
                                              {pct.toFixed(1)}%
                                            </span>
                                          )
                                        })()}
                                      </div>
                                      <div className="flex items-center justify-between">
                                        <span className="text-xs text-gray-500">Gross Profit</span>
                                        <span className="text-xs font-semibold text-gray-700">
                                          ${(parseFloat(price) - ingredientCosts.totalCost).toFixed(2)}
                                        </span>
                                      </div>
                                    </>
                                  )}
                                </>
                              ) : (
                                <p className="text-[11px] text-gray-400 text-center">
                                  Costs appear once ingredients are linked to inventory items.
                                </p>
                              )}
                            </div>
                          </div>
                        ) : (
                          <div className="px-3 py-4 text-xs text-gray-400 text-center border-t">
                            No ingredients assigned. Add them in the Menu Builder.
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  <div>
                    <label className={labelClass}>Description</label>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Optional description for online ordering, receipts, etc."
                      rows={2}
                      className={`${inputClass} resize-none`}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelClass}>SKU</label>
                      <input
                        type="text"
                        value={sku}
                        onChange={(e) => setSku(e.target.value)}
                        placeholder="Optional product code"
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Image</label>
                      {imageUrl ? (
                        <div className="flex items-center gap-2">
                          <img src={imageUrl} alt="Item" className="w-10 h-10 rounded-lg object-cover border" />
                          <button
                            type="button"
                            onClick={() => setImageUrl('')}
                            className="text-xs text-red-500 hover:text-red-700 font-medium"
                          >
                            Remove
                          </button>
                        </div>
                      ) : (
                        <label className={`${inputClass} flex items-center justify-center cursor-pointer text-gray-400 hover:text-gray-600 hover:border-blue-400 transition-colors`}>
                          <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                          {uploading ? 'Uploading...' : 'Choose image...'}
                        </label>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="w-4 h-4 rounded" />
                      <span className="text-sm text-gray-700">Active</span>
                    </label>
                  </div>
                </>
              )}

              {/* DISPLAY & CHANNELS TAB */}
              {activeTab === 'display' && (
                <>
                  <div>
                    <label className={labelClass}>Kitchen Chit Name</label>
                    <input
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Name shown on kitchen tickets (defaults to item name)"
                      className={inputClass}
                    />
                    <p className="text-[11px] text-gray-400 mt-1">Overrides item name on kitchen chits and KDS. Leave blank to use item name.</p>
                  </div>
                  <div className="space-y-2">
                    <span className={labelClass}>Channels</span>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={showOnPOS} onChange={(e) => setShowOnPOS(e.target.checked)} className="w-4 h-4 rounded" />
                      <span className="text-sm text-gray-700">Show on POS</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={showOnline} onChange={(e) => setShowOnline(e.target.checked)} className="w-4 h-4 rounded" />
                      <span className="text-sm text-gray-700">Show on Online Ordering</span>
                    </label>
                  </div>
                </>
              )}

              {/* KITCHEN & PRINT TAB */}
              {activeTab === 'kitchen' && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelClass}>Prep Time (min)</label>
                      <input
                        type="number"
                        value={prepTime}
                        onChange={(e) => setPrepTime(e.target.value)}
                        placeholder="e.g. 15"
                        min="0"
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Default Course #</label>
                      <input
                        type="number"
                        value={courseNumber}
                        onChange={(e) => setCourseNumber(e.target.value)}
                        placeholder="e.g. 1"
                        min="1"
                        className={inputClass}
                      />
                    </div>
                  </div>
                  <p className="text-[11px] text-gray-400">Kitchen chit name can be set in the Display &amp; Channels tab.</p>
                </>
              )}

              {/* AVAILABILITY TAB */}
              {activeTab === 'availability' && (
                <>
                  <div>
                    <span className={labelClass}>Time Window</span>
                    <div className="grid grid-cols-2 gap-3 mt-1">
                      <div>
                        <label className="text-[11px] text-gray-400">Available From</label>
                        <input
                          type="time"
                          value={availableFrom}
                          onChange={(e) => setAvailableFrom(e.target.value)}
                          className={inputClass}
                        />
                      </div>
                      <div>
                        <label className="text-[11px] text-gray-400">Available Until</label>
                        <input
                          type="time"
                          value={availableTo}
                          onChange={(e) => setAvailableTo(e.target.value)}
                          className={inputClass}
                        />
                      </div>
                    </div>
                    <p className="text-[11px] text-gray-400 mt-1">Leave blank for all-day availability.</p>
                  </div>
                  <div>
                    <span className={labelClass}>Available Days</span>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {DAYS.map((day, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => toggleDay(String(i), availableDays, setAvailableDays)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                            availableDays.has(String(i))
                              ? 'bg-blue-600 text-white'
                              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                          }`}
                        >
                          {day.slice(0, 3)}
                        </button>
                      ))}
                    </div>
                    <p className="text-[11px] text-gray-400 mt-1">Select none for every day.</p>
                  </div>

                </>
              )}

              {/* TAX & COMMISSION TAB */}
              {activeTab === 'pricing' && (
                <>
                  <div>
                    <label className={labelClass}>Tax Rate Override (%)</label>
                    <input
                      type="number"
                      value={taxRate}
                      onChange={(e) => setTaxRate(e.target.value)}
                      placeholder="Leave blank to use location default"
                      step="0.01"
                      min="0"
                      max="100"
                      className={inputClass}
                    />
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isTaxExempt}
                      onChange={(e) => setIsTaxExempt(e.target.checked)}
                      className="w-4 h-4 rounded"
                    />
                    <span className="text-sm text-gray-700">Tax Exempt</span>
                  </label>

                  <div className="border-t pt-4 mt-4">
                    <span className={labelClass}>Commission</span>
                    <div className="grid grid-cols-2 gap-3 mt-1">
                      <div>
                        <select
                          value={commissionType}
                          onChange={(e) => setCommissionType(e.target.value)}
                          className={inputClass}
                        >
                          <option value="">None</option>
                          <option value="percent">Percentage</option>
                          <option value="fixed">Fixed Amount</option>
                        </select>
                      </div>
                      {commissionType && (
                        <div>
                          <input
                            type="number"
                            value={commissionValue}
                            onChange={(e) => setCommissionValue(e.target.value)}
                            placeholder={commissionType === 'percent' ? 'e.g. 10' : 'e.g. 2.00'}
                            step="0.01"
                            min="0"
                            className={inputClass}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t shrink-0 flex gap-3 rounded-b-2xl">
              <button
                onClick={onClose}
                className="flex-1 py-2.5 rounded-lg text-sm font-semibold bg-gray-100 text-gray-600 hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 py-2.5 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
