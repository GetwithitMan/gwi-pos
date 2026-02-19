import { useState, type MutableRefObject } from 'react'
import { toast } from '@/stores/toast-store'
import type { Ingredient, IngredientLibraryItem, IngredientCategory } from './item-editor-types'

interface UseIngredientCreationParams {
  locationId: string
  onIngredientCreated?: (ingredient: IngredientLibraryItem) => void
  onCategoryCreated?: (category: IngredientCategory) => void
  onItemUpdated: () => void
  // Cross-hook dependencies (passed from other hooks)
  linkIngredientRef: MutableRefObject<((groupId: string, modId: string, ingredientId: string | null) => Promise<void>) | undefined>
  linkingModifierRef: MutableRefObject<{ groupId: string; modId: string } | null>
  showIngredientPicker: boolean
  ingredients: Ingredient[]
  saveIngredients: (newIngredients: Ingredient[]) => Promise<void>
  setShowIngredientPicker: (v: boolean) => void
  setIngredientSearch: (v: string) => void
}

export function useIngredientCreation({
  locationId,
  onIngredientCreated,
  onCategoryCreated,
  onItemUpdated,
  linkIngredientRef,
  linkingModifierRef,
  showIngredientPicker,
  ingredients,
  saveIngredients,
  setShowIngredientPicker,
  setIngredientSearch,
}: UseIngredientCreationParams) {
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set())
  const [creatingInventoryInCategory, setCreatingInventoryInCategory] = useState<string | null>(null)
  const [creatingPrepUnderParent, setCreatingPrepUnderParent] = useState<string | null>(null)
  const [newInventoryName, setNewInventoryName] = useState('')
  const [newPrepName, setNewPrepName] = useState('')
  const [creatingIngredientLoading, setCreatingIngredientLoading] = useState(false)
  const [creatingNewCategory, setCreatingNewCategory] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')

  // Create new ingredient category inline
  const createCategory = async () => {
    if (!newCategoryName.trim()) return
    setCreatingIngredientLoading(true)

    try {
      const response = await fetch('/api/ingredient-categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          name: newCategoryName.trim(),
          needsVerification: true,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
        toast.error(errorData.error || 'Failed to create category')
        return
      }

      const { data } = await response.json()
      onCategoryCreated?.(data)
      setNewCategoryName('')
      setCreatingNewCategory(false)

      // Auto-expand the new category and open inventory item creation
      setExpandedCategories(prev => {
        const next = new Set(prev)
        next.add(data.id)
        return next
      })
      setCreatingInventoryInCategory(data.id)
      toast.success(`Created "${data.name}" — now add an inventory item`)
    } catch (error) {
      console.error('Error creating category:', error)
      toast.error('Failed to create category')
    } finally {
      setCreatingIngredientLoading(false)
    }
  }

  // Create inventory item (parent)
  const createInventoryItem = async (categoryId: string) => {
    if (!newInventoryName.trim()) return
    setCreatingIngredientLoading(true)

    try {
      const response = await fetch('/api/ingredients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          name: newInventoryName.trim(),
          categoryId,
          parentIngredientId: null,
          needsVerification: true,
          isBaseIngredient: true,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))

        // 409 = duplicate name — auto-expand the existing item so user can add a prep item under it
        if (response.status === 409 && errorData.existing) {
          const existingId = errorData.existing.id
          const existingCatId = errorData.existing.categoryId || categoryId
          setNewInventoryName('')
          setCreatingInventoryInCategory(null)

          // Expand the category and the existing inventory item, then open prep creation
          setExpandedCategories(prev => {
            const next = new Set(prev)
            next.add(existingCatId)
            return next
          })
          setExpandedParents(prev => {
            const next = new Set(prev)
            next.add(existingId)
            return next
          })
          setCreatingPrepUnderParent(existingId)
          toast.info(`"${errorData.existing.name}" already exists — add a prep item below`)
          return
        }

        toast.error(errorData.error || 'Failed to create ingredient')
        return
      }

      const { data } = await response.json()
      onIngredientCreated?.(data)  // Optimistic local update + socket event
      setNewInventoryName('')
      setCreatingInventoryInCategory(null)

      // Auto-expand the new inventory item and prompt to add a prep item
      setExpandedCategories(prev => {
        const next = new Set(prev)
        next.add(categoryId)
        return next
      })
      setExpandedParents(prev => {
        const next = new Set(prev)
        next.add(data.id)
        return next
      })
      setCreatingPrepUnderParent(data.id)
      toast.success(`Created "${data.name}" — now add a prep item below`)

      // Defer full refresh so optimistic update renders first (prevents race with loadMenu replacing data)
      setTimeout(() => onItemUpdated(), 100)
    } catch (error) {
      console.error('Error creating inventory item:', error)
      toast.error('Failed to create ingredient')
    } finally {
      setCreatingIngredientLoading(false)
    }
  }

  // Create prep item (child) with auto-link
  const createPrepItem = async (parentId: string, categoryId: string) => {
    if (!newPrepName.trim()) return
    setCreatingIngredientLoading(true)

    try {
      const response = await fetch('/api/ingredients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationId,
          name: newPrepName.trim(),
          categoryId,
          parentIngredientId: parentId,
          needsVerification: true,
          isBaseIngredient: false,
        }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))

        // 409 = duplicate name — if it's a prep item, offer to use the existing one
        if (response.status === 409 && errorData.existing) {
          const existingItem = errorData.existing
          const isPrepItem = !!existingItem.parentIngredientId

          if (isPrepItem) {
            // It's an existing prep item — ask if they want to use it
            const useExisting = confirm(
              `"${existingItem.name}" already exists as a prep item. Use the existing one instead?`
            )
            if (useExisting) {
              const currentLinkingModifier = linkingModifierRef.current
              // Auto-link or auto-add the existing prep item
              if (currentLinkingModifier) {
                await linkIngredientRef.current?.(currentLinkingModifier.groupId, currentLinkingModifier.modId, existingItem.id)
                toast.success(`Linked existing "${existingItem.name}"`)
              } else if (showIngredientPicker) {
                const alreadyAdded = ingredients.some(i => i.ingredientId === existingItem.id)
                if (alreadyAdded) {
                  toast.info(`"${existingItem.name}" is already added to this item`)
                } else {
                  const newIngredients = [...ingredients, {
                    id: '', ingredientId: existingItem.id, name: existingItem.name,
                    isIncluded: true, allowNo: true, allowLite: true, allowExtra: true,
                    allowOnSide: true, allowSwap: true, extraPrice: 0,
                  }]
                  saveIngredients(newIngredients)
                  setShowIngredientPicker(false)
                  setIngredientSearch('')
                  toast.success(`Added existing "${existingItem.name}"`)
                }
              }
              setNewPrepName('')
              setCreatingPrepUnderParent(null)
              return
            }
            // User said no — keep the form open so they can change the name
            toast.info('Change the name to create a new prep item')
            return
          } else {
            // It's an inventory item with the same name — tell user to pick a different name
            toast.error(`"${existingItem.name}" exists as an inventory item. Use a different name for the prep item.`)
            return
          }
        }

        toast.error(errorData.error || 'Failed to create prep item')
        return
      }

      const { data } = await response.json()
      onIngredientCreated?.(data)  // Optimistic local update + socket event

      const currentLinkingModifier = linkingModifierRef.current

      // Auto-link to modifier OR auto-add to ingredients
      if (currentLinkingModifier) {
        await linkIngredientRef.current?.(currentLinkingModifier.groupId, currentLinkingModifier.modId, data.id)
        toast.success(`Created "${data.name}" and linked - pending verification`)
      } else if (showIngredientPicker) {
        // Auto-add to ingredients when called from green ingredient picker
        const newIngredients = [...ingredients, {
          id: '',
          ingredientId: data.id,
          name: data.name,
          isIncluded: true,
          allowNo: true,
          allowLite: true,
          allowExtra: true,
          allowOnSide: true,
          allowSwap: true,
          extraPrice: 0,
        }]
        saveIngredients(newIngredients)
        setShowIngredientPicker(false)
        setIngredientSearch('')
        toast.success(`Created "${data.name}" and added - pending verification`)
      } else {
        toast.success(`Created "${data.name}" - pending verification`)
      }

      setNewPrepName('')
      setCreatingPrepUnderParent(null)

      // Defer full refresh so optimistic update renders first
      setTimeout(() => onItemUpdated(), 100)
    } catch (error) {
      console.error('Error creating prep item:', error)
      toast.error('Failed to create prep item')
    } finally {
      setCreatingIngredientLoading(false)
    }
  }

  return {
    expandedCategories, setExpandedCategories,
    expandedParents, setExpandedParents,
    creatingInventoryInCategory, setCreatingInventoryInCategory,
    creatingPrepUnderParent, setCreatingPrepUnderParent,
    newInventoryName, setNewInventoryName,
    newPrepName, setNewPrepName,
    creatingIngredientLoading,
    creatingNewCategory, setCreatingNewCategory,
    newCategoryName, setNewCategoryName,
    createCategory, createInventoryItem, createPrepItem,
  }
}
