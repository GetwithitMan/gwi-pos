'use client'

import { useState, useEffect } from 'react'
import { formatCurrency } from '@/lib/utils'

interface ModifierGroup {
  id: string
  name: string
  displayName?: string
  minSelections: number
  maxSelections: number
  isRequired: boolean
  modifiers: {
    id: string
    name: string
    price: number
    childModifierGroupId?: string
    childModifierGroup?: ModifierGroup | null
  }[]
}

interface Ingredient {
  id: string
  ingredientId: string
  name: string
  isIncluded: boolean
  allowNo: boolean
  allowLite: boolean
  allowExtra: boolean
  allowOnSide: boolean
  extraPrice: number
}

interface MenuItem {
  id: string
  name: string
  price: number
  description?: string
  printerIds?: string[] | null
}

interface ItemTreeViewProps {
  item: MenuItem | null
  onSelectNode?: (nodeType: string, nodeId: string) => void
  selectedNode?: { type: string; id: string } | null
}

type ExpandedState = Record<string, boolean>

export function ItemTreeView({ item, onSelectNode, selectedNode }: ItemTreeViewProps) {
  const [itemOwnedGroups, setItemOwnedGroups] = useState<ModifierGroup[]>([])
  const [sharedGroups, setSharedGroups] = useState<ModifierGroup[]>([])
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState<ExpandedState>({
    root: true,
    ingredients: true,
    modifiers: true,
    printing: false,
  })

  useEffect(() => {
    if (!item?.id) {
      setItemOwnedGroups([])
      setSharedGroups([])
      setIngredients([])
      return
    }

    setLoading(true)
    Promise.all([
      fetch(`/api/menu/items/${item.id}/modifier-groups`).then(r => r.json()),
      fetch(`/api/menu/items/${item.id}/modifiers`).then(r => r.json()),
      fetch(`/api/menu/items/${item.id}/ingredients`).then(r => r.json()),
    ])
      .then(([ownedData, sharedData, ingData]) => {
        setItemOwnedGroups(ownedData.data || [])
        setSharedGroups(sharedData.modifierGroups || [])
        setIngredients(ingData.data || [])
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [item?.id])

  const toggle = (key: string) => {
    setExpanded(prev => ({ ...prev, [key]: !prev[key] }))
  }

  const isNodeSelected = (type: string, id: string) => {
    return selectedNode?.type === type && selectedNode?.id === id
  }

  if (!item) {
    return (
      <div className="h-full flex items-center justify-center text-gray-400 p-4">
        <p className="text-sm">Select an item to view its structure</p>
      </div>
    )
  }

  // Tree node component
  const TreeNode = ({
    label,
    nodeKey,
    icon,
    children,
    isLeaf = false,
    onClick,
    badge,
    depth = 0,
    nodeType,
    nodeId,
  }: {
    label: string
    nodeKey: string
    icon?: React.ReactNode
    children?: React.ReactNode
    isLeaf?: boolean
    onClick?: () => void
    badge?: React.ReactNode
    depth?: number
    nodeType?: string
    nodeId?: string
  }) => {
    const isExpanded = expanded[nodeKey]
    const isSelected = nodeType && nodeId ? isNodeSelected(nodeType, nodeId) : false
    const indent = depth * 16

    return (
      <div style={{ marginLeft: indent }}>
        <div
          className={`flex items-center gap-1 py-1 px-2 rounded cursor-pointer transition-colors text-sm ${
            isSelected
              ? 'bg-blue-100 text-blue-800'
              : 'hover:bg-gray-100'
          }`}
          onClick={() => {
            if (!isLeaf) toggle(nodeKey)
            if (onClick) onClick()
            if (onSelectNode && nodeType && nodeId) onSelectNode(nodeType, nodeId)
          }}
        >
          {!isLeaf ? (
            <span className={`text-gray-400 transition-transform ${isExpanded ? 'rotate-90' : ''}`}>
              ▶
            </span>
          ) : (
            <span className="w-3" />
          )}
          {icon && <span className="text-gray-500">{icon}</span>}
          <span className={`flex-1 truncate ${isLeaf ? 'text-gray-600' : 'font-medium'}`}>
            {label}
          </span>
          {badge}
        </div>
        {!isLeaf && isExpanded && children && (
          <div className="ml-2 border-l border-gray-200">
            {children}
          </div>
        )}
      </div>
    )
  }

  // Render modifier group recursively
  const renderModifierGroup = (group: ModifierGroup, depth: number = 0, prefix: string = '') => {
    const groupKey = `${prefix}group-${group.id}`

    return (
      <TreeNode
        key={group.id}
        label={group.displayName || group.name}
        nodeKey={groupKey}
        nodeType="modifierGroup"
        nodeId={group.id}
        depth={depth}
        badge={
          <span className="text-xs text-gray-400">
            {group.modifiers.length}
          </span>
        }
      >
        {group.modifiers.map(mod => (
          <div key={mod.id}>
            <TreeNode
              label={mod.name}
              nodeKey={`${groupKey}-mod-${mod.id}`}
              nodeType="modifier"
              nodeId={mod.id}
              isLeaf={!mod.childModifierGroup}
              depth={depth + 1}
              badge={
                mod.price > 0 ? (
                  <span className="text-xs text-green-600">+{formatCurrency(mod.price)}</span>
                ) : null
              }
            >
              {mod.childModifierGroup && renderModifierGroup(mod.childModifierGroup, depth + 2, `${groupKey}-`)}
            </TreeNode>
          </div>
        ))}
      </TreeNode>
    )
  }

  return (
    <div className="h-full flex flex-col bg-white border-r">
      {/* Header */}
      <div className="p-3 border-b bg-gray-50">
        <h3 className="font-semibold text-sm text-gray-700">Item Structure</h3>
      </div>

      {/* Tree Content */}
      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <div className="text-center py-4 text-gray-400 text-sm">Loading...</div>
        ) : (
          <div className="space-y-1">
            {/* Root Item */}
            <TreeNode
              label={item.name}
              nodeKey="root"
              nodeType="item"
              nodeId={item.id}
              icon={<span>📦</span>}
              badge={
                <span className="text-xs font-medium text-blue-600">
                  {formatCurrency(item.price)}
                </span>
              }
            >
              {/* Ingredients Branch */}
              <TreeNode
                label="Ingredients"
                nodeKey="ingredients"
                nodeType="ingredientsSection"
                nodeId="ingredients"
                icon={<span>🥗</span>}
                badge={
                  <span className="text-xs text-gray-400">{ingredients.length}</span>
                }
              >
                {ingredients.length === 0 ? (
                  <div className="py-1 px-4 text-xs text-gray-400 italic">None</div>
                ) : (
                  ingredients.map(ing => (
                    <TreeNode
                      key={ing.id}
                      label={ing.name}
                      nodeKey={`ing-${ing.ingredientId}`}
                      nodeType="ingredient"
                      nodeId={ing.ingredientId}
                      isLeaf
                      depth={1}
                      badge={
                        <div className="flex gap-0.5">
                          {ing.allowNo && <span className="w-2 h-2 rounded-full bg-red-400" title="No" />}
                          {ing.allowLite && <span className="w-2 h-2 rounded-full bg-yellow-400" title="Lite" />}
                          {ing.allowOnSide && <span className="w-2 h-2 rounded-full bg-blue-400" title="Side" />}
                          {ing.allowExtra && <span className="w-2 h-2 rounded-full bg-green-400" title="Extra" />}
                        </div>
                      }
                    />
                  ))
                )}
              </TreeNode>

              {/* Item Modifier Groups Branch */}
              <TreeNode
                label="Item Modifiers"
                nodeKey="itemModifiers"
                nodeType="itemModifiersSection"
                nodeId="itemModifiers"
                icon={<span>⚙️</span>}
                badge={
                  <span className="text-xs text-gray-400">{itemOwnedGroups.length}</span>
                }
              >
                {itemOwnedGroups.length === 0 ? (
                  <div className="py-1 px-4 text-xs text-gray-400 italic">None</div>
                ) : (
                  itemOwnedGroups.map(group => renderModifierGroup(group, 1))
                )}
              </TreeNode>

              {/* Shared Modifier Groups Branch */}
              {sharedGroups.length > 0 && (
                <TreeNode
                  label="Shared Modifiers"
                  nodeKey="sharedModifiers"
                  nodeType="sharedModifiersSection"
                  nodeId="sharedModifiers"
                  icon={<span>🔗</span>}
                  badge={
                    <span className="text-xs text-gray-400">{sharedGroups.length}</span>
                  }
                >
                  {sharedGroups.map(group => (
                    <TreeNode
                      key={group.id}
                      label={group.displayName || group.name}
                      nodeKey={`shared-${group.id}`}
                      nodeType="sharedModifierGroup"
                      nodeId={group.id}
                      depth={1}
                      badge={
                        <span className="text-xs text-gray-400">{group.modifiers.length}</span>
                      }
                    >
                      {group.modifiers.map(mod => (
                        <TreeNode
                          key={mod.id}
                          label={mod.name}
                          nodeKey={`shared-${group.id}-mod-${mod.id}`}
                          isLeaf
                          depth={2}
                          badge={
                            mod.price > 0 ? (
                              <span className="text-xs text-green-600">+{formatCurrency(mod.price)}</span>
                            ) : null
                          }
                        />
                      ))}
                    </TreeNode>
                  ))}
                </TreeNode>
              )}

              {/* Print Routing Branch */}
              <TreeNode
                label="Print Routing"
                nodeKey="printing"
                nodeType="printingSection"
                nodeId="printing"
                icon={<span>🖨️</span>}
              >
                {!item.printerIds || item.printerIds.length === 0 ? (
                  <div className="py-1 px-4 text-xs text-gray-400 italic">Category default</div>
                ) : (
                  <div className="py-1 px-4 text-xs text-gray-500">
                    {item.printerIds.length} printer(s) configured
                  </div>
                )}
              </TreeNode>
            </TreeNode>
          </div>
        )}
      </div>
    </div>
  )
}
