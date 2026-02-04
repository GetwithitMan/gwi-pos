'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { toast } from '@/stores/toast-store'

// Types for hierarchy data
interface HierarchyNode {
  id: string
  name: string
  type: 'inventory' | 'ingredient' | 'prep'
  // For inventory items
  standardQuantity?: number | null
  standardUnit?: string | null
  recipeYieldQuantity?: number | null
  recipeYieldUnit?: string | null
  description?: string | null
  category?: string | null
  categoryId?: string | null
  isActive?: boolean
  recipeCount?: number
  prepCount?: number
  // For recipe ingredients
  componentId?: string
  quantity?: number
  unit?: string
  costPerUnit?: number | null
  // For prep items
  preparationType?: string | null
  inputQuantity?: number | null
  inputUnit?: string | null
  outputQuantity?: number | null
  outputUnit?: string | null
  portionSize?: number | null
  portionUnit?: string | null
  yieldPercent?: number | null
  isDailyCountItem?: boolean
  countPrecision?: 'whole' | 'decimal'
  currentPrepStock?: number | null
  lowStockThreshold?: number | null
  criticalStockThreshold?: number | null
}

interface HierarchyData {
  inventoryItem: HierarchyNode
  recipeIngredients: HierarchyNode[]
  prepItems: HierarchyNode[]
}

interface HierarchyViewProps {
  inventoryItemId: string
  onClose?: () => void
  onEditItem?: (id: string, type: 'inventory' | 'prep') => void
  onAddPrepItem?: (parentId: string) => void
}

export function HierarchyView({
  inventoryItemId,
  onClose,
  onEditItem,
  onAddPrepItem,
}: HierarchyViewProps) {
  const [hierarchyData, setHierarchyData] = useState<HierarchyData | null>(null)
  const [selectedNode, setSelectedNode] = useState<HierarchyNode | null>(null)
  const [expanded, setExpanded] = useState(true)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadHierarchy = useCallback(async () => {
    if (!inventoryItemId) return

    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/ingredients/${inventoryItemId}/hierarchy`)
      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to load hierarchy')
      }
      const data = await response.json()
      setHierarchyData(data)
      // Auto-select the inventory item
      setSelectedNode(data.inventoryItem)
    } catch (err) {
      console.error('Error loading hierarchy:', err)
      setError(err instanceof Error ? err.message : 'Failed to load hierarchy')
    } finally {
      setIsLoading(false)
    }
  }, [inventoryItemId])

  useEffect(() => {
    loadHierarchy()
  }, [loadHierarchy])

  const handleAddPrepItem = () => {
    if (onAddPrepItem && hierarchyData) {
      onAddPrepItem(hierarchyData.inventoryItem.id)
    }
  }

  const handleEditNode = (node: HierarchyNode) => {
    if (onEditItem) {
      onEditItem(node.id, node.type === 'prep' ? 'prep' : 'inventory')
    }
  }

  const generateReport = async (nodeId: string, nodeType: string) => {
    toast.info(`Report generation for ${nodeType} coming soon`)
    // Future: fetch(`/api/reports/ingredient-usage/${nodeId}`)
  }

  // Render stock status badge
  const renderStockBadge = (node: HierarchyNode) => {
    if (!node.isDailyCountItem || node.currentPrepStock === null || node.currentPrepStock === undefined) {
      return null
    }

    const stock = node.currentPrepStock
    const critical = node.criticalStockThreshold ?? 0
    const low = node.lowStockThreshold ?? 0

    let colorClass = 'bg-green-100 text-green-800' // Good
    if (stock <= critical) {
      colorClass = 'bg-red-100 text-red-800' // Critical
    } else if (stock <= low) {
      colorClass = 'bg-yellow-100 text-yellow-800' // Low
    }

    return (
      <span className={`ml-2 px-2 py-0.5 rounded text-xs font-medium ${colorClass}`}>
        {stock} {node.outputUnit || node.portionUnit || 'units'}
      </span>
    )
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Loading hierarchy...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <div className="text-red-500">{error}</div>
        <Button variant="outline" onClick={loadHierarchy}>
          Retry
        </Button>
      </div>
    )
  }

  if (!hierarchyData) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">No data available</div>
      </div>
    )
  }

  const { inventoryItem, recipeIngredients, prepItems } = hierarchyData

  return (
    <div className="flex h-full min-h-[400px] bg-white rounded-lg border">
      {/* Left Panel: Tree Structure */}
      <div className="w-1/3 border-r overflow-y-auto">
        <div className="p-4">
          {/* Header with close button */}
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-gray-900">Hierarchy</h3>
            {onClose && (
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {/* Inventory Item (Root) */}
          <div
            className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors ${
              selectedNode?.id === inventoryItem.id
                ? 'bg-blue-100 border border-blue-300'
                : 'hover:bg-gray-100'
            }`}
            onClick={() => setSelectedNode(inventoryItem)}
          >
            <button
              onClick={(e) => {
                e.stopPropagation()
                setExpanded(!expanded)
              }}
              className="text-gray-500 hover:text-gray-700"
            >
              {expanded ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              )}
            </button>
            <span className="px-2 py-0.5 bg-blue-600 text-white rounded text-xs font-bold">INV</span>
            <span className="font-medium truncate">{inventoryItem.name}</span>
          </div>

          {expanded && (
            <div className="ml-6 mt-1 space-y-1">
              {/* Recipe Ingredients Section */}
              {recipeIngredients.length > 0 && (
                <div className="mb-2">
                  <div className="text-xs font-medium text-gray-500 uppercase tracking-wide py-1 px-2">
                    Recipe Ingredients ({recipeIngredients.length})
                  </div>
                  {recipeIngredients.map((ing) => (
                    <div
                      key={ing.id}
                      className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors text-sm ${
                        selectedNode?.id === ing.id
                          ? 'bg-purple-100 border border-purple-300'
                          : 'hover:bg-gray-100'
                      }`}
                      onClick={() => setSelectedNode(ing)}
                    >
                      <span className="px-1.5 py-0.5 bg-purple-600 text-white rounded text-xs">R</span>
                      <span className="truncate">{ing.name}</span>
                      <span className="text-gray-400 text-xs">
                        ({ing.quantity} {ing.unit})
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Prep Items Section */}
              <div>
                <div className="flex items-center justify-between py-1 px-2">
                  <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                    Prep Items ({prepItems.length})
                  </span>
                  {onAddPrepItem && (
                    <button
                      onClick={handleAddPrepItem}
                      className="text-xs text-blue-600 hover:text-blue-800 font-medium"
                    >
                      + Add
                    </button>
                  )}
                </div>
                {prepItems.length > 0 ? (
                  prepItems.map((prep) => (
                    <div
                      key={prep.id}
                      className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-colors text-sm ${
                        selectedNode?.id === prep.id
                          ? 'bg-green-100 border border-green-300'
                          : 'hover:bg-gray-100'
                      } ${!prep.isActive ? 'opacity-50' : ''}`}
                      onClick={() => setSelectedNode(prep)}
                    >
                      <span className="px-1.5 py-0.5 bg-green-600 text-white rounded text-xs">P</span>
                      <span className="truncate">{prep.name}</span>
                      {renderStockBadge(prep)}
                      {!prep.isActive && (
                        <span className="text-xs text-gray-400">(inactive)</span>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-gray-400 italic px-2 py-1">
                    No prep items yet
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Right Panel: Details */}
      <div className="flex-1 p-4 overflow-y-auto">
        {selectedNode ? (
          <Card className="p-4">
            {/* Node Header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                {selectedNode.type === 'inventory' && (
                  <span className="px-2 py-0.5 bg-blue-600 text-white rounded text-xs font-bold uppercase">
                    Inventory Item
                  </span>
                )}
                {selectedNode.type === 'ingredient' && (
                  <span className="px-2 py-0.5 bg-purple-600 text-white rounded text-xs font-bold uppercase">
                    Recipe Ingredient
                  </span>
                )}
                {selectedNode.type === 'prep' && (
                  <span className="px-2 py-0.5 bg-green-600 text-white rounded text-xs font-bold uppercase">
                    Prep Item
                  </span>
                )}
                <h3 className="text-lg font-bold">{selectedNode.name}</h3>
              </div>
              {onEditItem && selectedNode.type !== 'ingredient' && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleEditNode(selectedNode)}
                >
                  Edit
                </Button>
              )}
            </div>

            {/* Inventory Item Details */}
            {selectedNode.type === 'inventory' && (
              <div className="space-y-4">
                {selectedNode.description && (
                  <p className="text-gray-600">{selectedNode.description}</p>
                )}

                <div className="grid grid-cols-2 gap-4">
                  {selectedNode.standardQuantity && selectedNode.standardUnit && (
                    <div>
                      <label className="text-sm text-gray-500">Delivery Size</label>
                      <p className="font-medium">
                        {selectedNode.standardQuantity} {selectedNode.standardUnit}
                      </p>
                    </div>
                  )}

                  {selectedNode.recipeYieldQuantity && selectedNode.recipeYieldUnit && (
                    <div>
                      <label className="text-sm text-gray-500">Recipe Yield</label>
                      <p className="font-medium">
                        {selectedNode.recipeYieldQuantity} {selectedNode.recipeYieldUnit}
                      </p>
                    </div>
                  )}

                  {selectedNode.category && (
                    <div>
                      <label className="text-sm text-gray-500">Category</label>
                      <p className="font-medium">{selectedNode.category}</p>
                    </div>
                  )}

                  <div>
                    <label className="text-sm text-gray-500">Status</label>
                    <p className={`font-medium ${selectedNode.isActive ? 'text-green-600' : 'text-red-600'}`}>
                      {selectedNode.isActive ? 'Active' : 'Inactive'}
                    </p>
                  </div>
                </div>

                {/* Summary Stats */}
                <div className="pt-4 border-t">
                  <div className="flex gap-4">
                    <div className="text-center px-4 py-2 bg-purple-50 rounded">
                      <p className="text-2xl font-bold text-purple-600">{recipeIngredients.length}</p>
                      <p className="text-xs text-gray-500">Recipe Ingredients</p>
                    </div>
                    <div className="text-center px-4 py-2 bg-green-50 rounded">
                      <p className="text-2xl font-bold text-green-600">{prepItems.length}</p>
                      <p className="text-xs text-gray-500">Prep Items</p>
                    </div>
                  </div>
                </div>

                <div className="pt-4">
                  <Button
                    variant="outline"
                    onClick={() => generateReport(selectedNode.id, 'inventory')}
                  >
                    Generate Usage Report
                  </Button>
                </div>
              </div>
            )}

            {/* Recipe Ingredient Details */}
            {selectedNode.type === 'ingredient' && (
              <div className="space-y-4">
                <div className="p-3 bg-purple-50 rounded-lg">
                  <p className="text-sm text-purple-800">
                    This ingredient is used in the recipe for <strong>{inventoryItem.name}</strong>
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm text-gray-500">Quantity Used</label>
                    <p className="font-medium">
                      {selectedNode.quantity} {selectedNode.unit}
                    </p>
                  </div>

                  {selectedNode.costPerUnit !== null && selectedNode.costPerUnit !== undefined && (
                    <div>
                      <label className="text-sm text-gray-500">Cost per Unit</label>
                      <p className="font-medium">
                        ${selectedNode.costPerUnit.toFixed(2)}
                      </p>
                    </div>
                  )}

                  {selectedNode.category && (
                    <div>
                      <label className="text-sm text-gray-500">Category</label>
                      <p className="font-medium">{selectedNode.category}</p>
                    </div>
                  )}
                </div>

                <div className="pt-4">
                  <Button
                    variant="outline"
                    onClick={() => generateReport(selectedNode.componentId || selectedNode.id, 'ingredient')}
                  >
                    Generate Usage Report
                  </Button>
                </div>
              </div>
            )}

            {/* Prep Item Details */}
            {selectedNode.type === 'prep' && (
              <div className="space-y-4">
                <div className="p-3 bg-green-50 rounded-lg">
                  <p className="text-sm text-green-800">
                    Made from <strong>{inventoryItem.name}</strong>
                  </p>
                </div>

                {/* Input → Output Transformation */}
                <div className="p-4 border rounded-lg bg-gray-50">
                  <label className="text-sm text-gray-500 block mb-2">Transformation</label>
                  <div className="flex items-center gap-2 text-lg">
                    <span className="font-medium">
                      {selectedNode.inputQuantity || selectedNode.portionSize || '?'}{' '}
                      {selectedNode.inputUnit || selectedNode.portionUnit || 'units'}
                    </span>
                    <span className="text-gray-400">of {inventoryItem.name}</span>
                    <span className="text-gray-400 mx-2">→</span>
                    <span className="font-medium text-green-600">
                      {selectedNode.outputQuantity || '1'}{' '}
                      {selectedNode.outputUnit || 'each'}
                    </span>
                    <span className="text-gray-400">of {selectedNode.name}</span>
                  </div>
                  {selectedNode.yieldPercent && (
                    <p className="text-sm text-gray-500 mt-2">
                      Yield: {(selectedNode.yieldPercent * 100).toFixed(0)}%
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {selectedNode.preparationType && (
                    <div>
                      <label className="text-sm text-gray-500">Preparation Type</label>
                      <p className="font-medium">{selectedNode.preparationType}</p>
                    </div>
                  )}

                  <div>
                    <label className="text-sm text-gray-500">Status</label>
                    <p className={`font-medium ${selectedNode.isActive ? 'text-green-600' : 'text-red-600'}`}>
                      {selectedNode.isActive ? 'Active' : 'Inactive'}
                    </p>
                  </div>
                </div>

                {/* Daily Count Section */}
                {selectedNode.isDailyCountItem && (
                  <div className="pt-4 border-t">
                    <h4 className="font-medium mb-2">Daily Count Settings</h4>
                    <div className="grid grid-cols-3 gap-4">
                      <div>
                        <label className="text-sm text-gray-500">Current Stock</label>
                        <p className="font-medium">
                          {selectedNode.currentPrepStock ?? 'Not counted'}
                          {selectedNode.outputUnit && ` ${selectedNode.outputUnit}`}
                        </p>
                      </div>
                      <div>
                        <label className="text-sm text-gray-500">Low Stock At</label>
                        <p className="font-medium text-yellow-600">
                          {selectedNode.lowStockThreshold ?? 'Not set'}
                        </p>
                      </div>
                      <div>
                        <label className="text-sm text-gray-500">Critical At</label>
                        <p className="font-medium text-red-600">
                          {selectedNode.criticalStockThreshold ?? 'Not set'}
                        </p>
                      </div>
                    </div>
                    <p className="text-sm text-gray-500 mt-2">
                      Count precision: {selectedNode.countPrecision === 'decimal' ? 'Decimal (e.g., 2.5)' : 'Whole numbers'}
                    </p>
                  </div>
                )}

                <div className="pt-4">
                  <Button
                    variant="outline"
                    onClick={() => generateReport(selectedNode.id, 'prep')}
                  >
                    Generate Usage Report
                  </Button>
                </div>
              </div>
            )}
          </Card>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500">
            Select an item from the tree to view details
          </div>
        )}
      </div>
    </div>
  )
}
