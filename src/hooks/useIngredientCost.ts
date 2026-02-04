import { useState, useEffect } from 'react'
import { calculateYield, calculateCostPerOutputUnit } from '@/lib/unit-conversions'

interface UseIngredientCostProps {
  parentIngredientId?: string | null
  inputQuantity: string
  inputUnit: string
  outputQuantity: string
  outputUnit: string
  yieldPercent: string
  parentUnit?: string
}

interface CostResult {
  previewCost: number | null
  parentCostPerUnit: number | null
  derivedYield: number | null
  isLoading: boolean
  error: string | null
}

/**
 * Shared hook for ingredient cost calculation
 * Used by both PrepItemEditor and InventoryItemEditor
 */
export function useIngredientCost({
  parentIngredientId,
  inputQuantity,
  inputUnit,
  outputQuantity,
  outputUnit,
  yieldPercent,
  parentUnit,
}: UseIngredientCostProps): CostResult {
  const [previewCost, setPreviewCost] = useState<number | null>(null)
  const [parentCostPerUnit, setParentCostPerUnit] = useState<number | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Calculate derived yield when units are compatible
  const inputQty = parseFloat(inputQuantity) || 0
  const outputQty = parseFloat(outputQuantity) || 0
  const derivedYield = (inputQty > 0 && outputQty > 0)
    ? calculateYield(inputQty, inputUnit, outputQty, outputUnit)
    : null

  // Fetch parent cost and calculate preview
  useEffect(() => {
    if (!parentIngredientId || !inputQuantity) {
      setPreviewCost(null)
      setParentCostPerUnit(null)
      return
    }

    setIsLoading(true)
    setError(null)

    fetch(`/api/ingredients/${parentIngredientId}/cost`)
      .then(res => {
        if (!res.ok) throw new Error('Failed to fetch cost')
        return res.json()
      })
      .then(data => {
        if (data.costPerUnit) {
          setParentCostPerUnit(data.costPerUnit)

          const yieldFactor = (parseFloat(yieldPercent) / 100) || 1

          // Calculate cost per output unit
          const cost = calculateCostPerOutputUnit(
            data.costPerUnit,
            parentUnit || inputUnit,
            inputQty,
            inputUnit,
            outputQty,
            outputUnit
          )

          if (cost !== null) {
            // Adjust for yield
            setPreviewCost(cost / yieldFactor)
          } else {
            setPreviewCost(null)
          }
        }
      })
      .catch(err => {
        console.error('Failed to fetch parent cost:', err)
        setError('Unable to calculate cost')
        setPreviewCost(null)
        setParentCostPerUnit(null)
      })
      .finally(() => {
        setIsLoading(false)
      })
  }, [
    parentIngredientId,
    inputQuantity,
    inputUnit,
    outputQuantity,
    outputUnit,
    yieldPercent,
    parentUnit,
  ])

  return {
    previewCost,
    parentCostPerUnit,
    derivedYield,
    isLoading,
    error,
  }
}
