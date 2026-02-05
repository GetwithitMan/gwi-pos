'use client'

import { useState } from 'react'
import { formatCurrency } from '@/lib/utils'
import {
  type IngredientModification,
  type IngredientModificationType,
  type MenuItemIngredient,
} from './useModifierSelections'
import { EightySixBadge } from './EightySixBadge'

interface IngredientsSectionProps {
  ingredients: MenuItemIngredient[]
  ingredientMods: Record<string, IngredientModification>
  loading: boolean
  onToggleMod: (ingredient: MenuItemIngredient, modType: IngredientModificationType) => void
  onOpenSwap: (ingredient: MenuItemIngredient) => void
  modTotal: number
}

export function IngredientsSection({
  ingredients,
  ingredientMods,
  loading,
  onToggleMod,
  onOpenSwap,
  modTotal,
}: IngredientsSectionProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  // Only show included ingredients
  const includedIngredients = ingredients.filter(ing => ing.isIncluded)

  // Count modifications (anything not 'standard')
  const modificationCount = Object.values(ingredientMods).filter(
    m => m.modificationType !== 'standard'
  ).length

  if (includedIngredients.length === 0) {
    return null
  }

  return (
    <div className="mb-4">
      {/* Collapsed/Expanded Header Button */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between p-3 bg-white/5 border border-white/10 rounded-xl hover:bg-white/8 transition-all"
      >
        <div className="flex items-center gap-2">
          <span>🥗</span>
          <span className="font-semibold text-sm text-slate-200">
            Customize Ingredients ({includedIngredients.length})
          </span>
          {modificationCount > 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">
              {modificationCount} {modificationCount === 1 ? 'change' : 'changes'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {modTotal > 0 && (
            <span className="text-sm text-emerald-400 font-medium">
              +{formatCurrency(modTotal)}
            </span>
          )}
          <svg
            className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${
              isExpanded ? 'rotate-180' : ''
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Expanded Ingredients List */}
      <div
        className="overflow-hidden transition-all duration-300 ease-in-out"
        style={{
          maxHeight: isExpanded ? `${includedIngredients.length * 70 + 16}px` : '0px',
        }}
      >
        <div className="space-y-2 mt-2">
          {loading ? (
            <div className="text-center py-4 text-slate-400 text-sm">Loading ingredients...</div>
          ) : (
            includedIngredients.map(ingredient => {
              const mod = ingredientMods[ingredient.ingredientId]
              const modType = mod?.modificationType || 'standard'
              const isModified = modType !== 'standard'
              const is86d = ingredient.is86d || false

              return (
                <div
                  key={ingredient.ingredientId}
                  className={`relative p-2 rounded-lg border transition-all ${
                    is86d
                      ? 'bg-red-500/10 border-red-500/20'
                      : isModified
                      ? 'bg-amber-500/10 border-amber-500/20'
                      : 'bg-white/[0.03] border-white/[0.06]'
                  }`}
                  style={{ minHeight: '44px' }}
                >
                  <div className="flex items-center justify-between">
                    {/* Left: Ingredient name and badge */}
                    <div className="flex items-center gap-2 flex-1">
                      <span
                        className={`font-medium text-sm ${
                          is86d
                            ? 'line-through text-red-400'
                            : modType === 'no'
                            ? 'line-through text-slate-500'
                            : 'text-slate-200'
                        }`}
                      >
                        {ingredient.name}
                      </span>
                      {is86d && (
                        <>
                          <EightySixBadge size="sm" />
                          <span className="text-xs text-red-400">(out of stock)</span>
                        </>
                      )}
                      {!is86d && isModified && (
                        <span
                          className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                            modType === 'no'
                              ? 'bg-red-500/20 text-red-300'
                              : modType === 'lite'
                              ? 'bg-yellow-500/20 text-yellow-300'
                              : modType === 'on_side'
                              ? 'bg-blue-500/20 text-blue-300'
                              : modType === 'extra'
                              ? 'bg-green-500/20 text-green-300'
                              : modType === 'swap'
                              ? 'bg-purple-500/20 text-purple-300'
                              : ''
                          }`}
                        >
                          {modType === 'no'
                            ? 'NO'
                            : modType === 'lite'
                            ? 'LITE'
                            : modType === 'on_side'
                            ? 'SIDE'
                            : modType === 'extra'
                            ? 'EXTRA'
                            : modType === 'swap'
                            ? `→ ${mod?.swappedTo?.name}`
                            : ''}
                        </span>
                      )}
                      {!is86d && mod?.priceAdjustment > 0 && (
                        <span className="text-xs text-emerald-400">
                          +{formatCurrency(mod.priceAdjustment)}
                        </span>
                      )}
                    </div>

                    {/* Right: Modification buttons - disabled if 86'd */}
                    <div className="flex gap-1">
                      {ingredient.allowNo && (
                        <button
                          onClick={() => !is86d && onToggleMod(ingredient, 'no')}
                          className={`mm-premod-no px-2 py-1 text-xs rounded transition-all ${
                            modType === 'no' ? 'active' : ''
                          } ${is86d ? 'opacity-30 cursor-not-allowed pointer-events-none' : ''}`}
                          style={{ minHeight: '32px', minWidth: '44px' }}
                          disabled={is86d}
                        >
                          No
                        </button>
                      )}
                      {ingredient.allowLite && (
                        <button
                          onClick={() => !is86d && onToggleMod(ingredient, 'lite')}
                          className={`mm-premod-lite px-2 py-1 text-xs rounded transition-all ${
                            modType === 'lite' ? 'active' : ''
                          } ${is86d ? 'opacity-30 cursor-not-allowed pointer-events-none' : ''}`}
                          style={{ minHeight: '32px', minWidth: '44px' }}
                          disabled={is86d}
                        >
                          Lite
                        </button>
                      )}
                      {ingredient.allowExtra && (
                        <button
                          onClick={() => !is86d && onToggleMod(ingredient, 'extra')}
                          className={`mm-premod-extra px-2 py-1 text-xs rounded transition-all ${
                            modType === 'extra' ? 'active' : ''
                          } ${is86d ? 'opacity-30 cursor-not-allowed pointer-events-none' : ''}`}
                          style={{ minHeight: '32px', minWidth: '44px' }}
                          title={
                            ingredient.extraPrice > 0
                              ? `+${formatCurrency(ingredient.extraPrice)}`
                              : ''
                          }
                          disabled={is86d}
                        >
                          Ex{ingredient.extraPrice > 0 ? ` +$${ingredient.extraPrice.toFixed(0)}` : ''}
                        </button>
                      )}
                      {ingredient.allowOnSide && (
                        <button
                          onClick={() => !is86d && onToggleMod(ingredient, 'on_side')}
                          className={`mm-premod-side px-2 py-1 text-xs rounded transition-all ${
                            modType === 'on_side' ? 'active' : ''
                          } ${is86d ? 'opacity-30 cursor-not-allowed pointer-events-none' : ''}`}
                          style={{ minHeight: '32px', minWidth: '44px' }}
                          disabled={is86d}
                        >
                          Side
                        </button>
                      )}
                      {ingredient.allowSwap && ingredient.swapModifierGroup && (
                        <button
                          onClick={() => !is86d && onOpenSwap(ingredient)}
                          className={`mm-premod-swap px-2 py-1 text-xs rounded transition-all ${
                            modType === 'swap' ? 'active' : ''
                          } ${is86d ? 'opacity-30 cursor-not-allowed pointer-events-none' : ''}`}
                          style={{ minHeight: '32px', minWidth: '44px' }}
                          disabled={is86d}
                        >
                          Swap
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
