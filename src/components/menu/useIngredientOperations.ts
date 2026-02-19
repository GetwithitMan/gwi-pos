import { useState } from 'react'
import { toast } from '@/stores/toast-store'
import type { Ingredient, IngredientLibraryItem } from './item-editor-types'

interface UseIngredientOperationsParams {
  itemId: string | undefined
  ingredientsLibrary: IngredientLibraryItem[]
  loadData: () => Promise<void>
  setSaving: (v: boolean) => void
}

export function useIngredientOperations({ itemId, ingredientsLibrary, loadData, setSaving }: UseIngredientOperationsParams) {
  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [showIngredientPicker, setShowIngredientPicker] = useState(false)
  const [relinkingIngredientId, setRelinkingIngredientId] = useState<string | null>(null)
  const [ingredientSearch, setIngredientSearch] = useState('')

  const saveIngredients = async (newIngredients: typeof ingredients) => {
    if (!itemId) return
    setSaving(true)
    try {
      const res = await fetch(`/api/menu/items/${itemId}/ingredients`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ingredients: newIngredients.map(i => ({
            ingredientId: i.ingredientId,
            isIncluded: i.isIncluded,
            allowNo: i.allowNo,
            allowLite: i.allowLite,
            allowExtra: i.allowExtra,
            allowOnSide: i.allowOnSide,
            extraPrice: i.extraPrice,
          }))
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }))
        console.error('Save ingredients failed:', res.status, err)
        toast.error(err.error || `Save failed (${res.status})`)
        return
      }
      await loadData()
      // No onItemUpdated() — ingredient toggles are local-only, no tree change
    } catch (e) {
      console.error('Failed to save:', e)
      toast.error('Failed to save ingredients')
    } finally {
      setSaving(false)
    }
  }

  const addIngredient = (ingredientId: string) => {
    const lib = ingredientsLibrary.find(i => i.id === ingredientId)
    if (!lib) return
    const newIngredients = [...ingredients, {
      id: '',
      ingredientId,
      name: lib.name,
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
  }

  const removeIngredient = (ingredientId: string) => {
    saveIngredients(ingredients.filter(i => i.ingredientId !== ingredientId))
  }

  // Swap an ingredient link — replace one ingredientId with another
  const swapIngredientLink = async (oldIngredientId: string, newIngredientId: string) => {
    const lib = ingredientsLibrary.find(i => i.id === newIngredientId)
    if (!lib) return
    setRelinkingIngredientId(null)
    setIngredientSearch('')
    await saveIngredients(ingredients.map(i =>
      i.ingredientId === oldIngredientId
        ? { ...i, ingredientId: newIngredientId, name: lib.name }
        : i
    ))
    toast.success(`Linked to ${lib.name}`)
  }

  const toggleIngredientOption = (ingredientId: string, option: 'allowNo' | 'allowLite' | 'allowExtra' | 'allowOnSide' | 'allowSwap') => {
    saveIngredients(ingredients.map(i => i.ingredientId === ingredientId ? { ...i, [option]: !i[option] } : i))
  }

  const updateExtraPrice = (ingredientId: string, price: number) => {
    saveIngredients(ingredients.map(i => i.ingredientId === ingredientId ? { ...i, extraPrice: price } : i))
  }

  return {
    ingredients, setIngredients,
    showIngredientPicker, setShowIngredientPicker,
    relinkingIngredientId, setRelinkingIngredientId,
    ingredientSearch, setIngredientSearch,
    saveIngredients, addIngredient, removeIngredient,
    swapIngredientLink, toggleIngredientOption, updateExtraPrice,
  }
}
