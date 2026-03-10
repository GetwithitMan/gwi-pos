import { useState, useRef, useCallback } from 'react'
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

  // Ref tracks the latest intended state (updated optimistically before API calls)
  const ingredientsRef = useRef(ingredients)
  ingredientsRef.current = ingredients

  // Optimistically update both state and ref, then persist to server
  const applyAndSave = useCallback(async (newIngredients: Ingredient[]) => {
    if (!itemId) return
    // Optimistic: update state + ref immediately so next operation sees latest
    setIngredients(newIngredients)
    ingredientsRef.current = newIngredients
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
        // Rollback: reload server state on failure
        await loadData()
        return
      }
      // Sync with server (may add server-generated IDs etc.)
      await loadData()
    } catch (e) {
      console.error('Failed to save:', e)
      toast.error('Failed to save ingredients')
      await loadData()
    } finally {
      setSaving(false)
    }
  }, [itemId, loadData, setSaving])

  const addIngredient = (ingredientId: string) => {
    const lib = ingredientsLibrary.find(i => i.id === ingredientId)
    if (!lib) return
    // Prevent duplicate — ingredient already linked
    if (ingredientsRef.current.some(i => i.ingredientId === ingredientId)) {
      toast.info(`"${lib.name}" is already linked`)
      return
    }
    const newIngredients = [...ingredientsRef.current, {
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
    applyAndSave(newIngredients)
    setShowIngredientPicker(false)
    setIngredientSearch('')
  }

  const removeIngredient = (ingredientId: string) => {
    applyAndSave(ingredientsRef.current.filter(i => i.ingredientId !== ingredientId))
  }

  const swapIngredientLink = async (oldIngredientId: string, newIngredientId: string) => {
    const lib = ingredientsLibrary.find(i => i.id === newIngredientId)
    if (!lib) return
    setRelinkingIngredientId(null)
    setIngredientSearch('')
    await applyAndSave(ingredientsRef.current.map(i =>
      i.ingredientId === oldIngredientId
        ? { ...i, ingredientId: newIngredientId, name: lib.name }
        : i
    ))
    toast.success(`Linked to ${lib.name}`)
  }

  const toggleIngredientOption = (ingredientId: string, option: 'allowNo' | 'allowLite' | 'allowExtra' | 'allowOnSide' | 'allowSwap') => {
    applyAndSave(ingredientsRef.current.map(i => i.ingredientId === ingredientId ? { ...i, [option]: !i[option] } : i))
  }

  const updateExtraPrice = (ingredientId: string, price: number) => {
    applyAndSave(ingredientsRef.current.map(i => i.ingredientId === ingredientId ? { ...i, extraPrice: price } : i))
  }

  return {
    ingredients, setIngredients,
    showIngredientPicker, setShowIngredientPicker,
    relinkingIngredientId, setRelinkingIngredientId,
    ingredientSearch, setIngredientSearch,
    saveIngredients: applyAndSave, addIngredient, removeIngredient,
    swapIngredientLink, toggleIngredientOption, updateExtraPrice,
  }
}
