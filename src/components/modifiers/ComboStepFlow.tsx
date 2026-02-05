'use client'

import { useState } from 'react'
import { formatCurrency } from '@/lib/utils'
import type { MenuItem } from '@/types'

interface ComboStepFlowProps {
  item: MenuItem
  template: {
    id: string
    basePrice: number
    comparePrice?: number | null
    components: {
      id: string
      slotName: string
      displayName: string
      isRequired: boolean
      minSelections: number
      maxSelections: number
      menuItemId?: string | null
      menuItem?: {
        id: string
        name: string
        price: number
        modifierGroups?: {
          modifierGroup: {
            id: string
            name: string
            displayName?: string | null
            minSelections: number
            maxSelections: number
            isRequired: boolean
            modifiers: {
              id: string
              name: string
              price: number
              childModifierGroupId?: string | null
            }[]
          }
        }[]
      } | null
      itemPriceOverride?: number | null
      modifierPriceOverrides?: Record<string, number> | null
      // Legacy fields
      options: { id: string; menuItemId: string; name: string; upcharge: number; isAvailable: boolean }[]
    }[]
  }
  onConfirm: (selections: Record<string, Record<string, string[]>>) => void
  onCancel: () => void
}

export function ComboStepFlow({ item, template, onConfirm, onCancel }: ComboStepFlowProps) {
  const [currentStep, setCurrentStep] = useState(0)
  const [selections, setSelections] = useState<Record<string, Record<string, string[]>>>({})

  const currentComponent = template.components[currentStep]
  const isFirstStep = currentStep === 0
  const isLastStep = currentStep === template.components.length - 1

  // Calculate total upcharges
  const calculateUpcharges = () => {
    let total = 0
    for (const component of template.components) {
      if (component.menuItem) {
        const componentSelections = selections[component.id] || {}
        for (const mg of component.menuItem.modifierGroups || []) {
          const groupSelections = componentSelections[mg.modifierGroup.id] || []
          for (const modifierId of groupSelections) {
            const modifier = mg.modifierGroup.modifiers.find(m => m.id === modifierId)
            if (modifier) {
              const overridePrice = component.modifierPriceOverrides?.[modifier.id]
              const price = overridePrice !== undefined ? overridePrice : 0
              total += price
            }
          }
        }
      } else if (component.options && component.options.length > 0) {
        // Legacy options
        const legacySelections = (selections[component.id] as unknown as string[]) || []
        for (const optionId of legacySelections) {
          const option = component.options.find(o => o.id === optionId)
          if (option) total += option.upcharge
        }
      }
    }
    return total
  }

  const totalUpcharges = calculateUpcharges()
  const finalTotal = template.basePrice + totalUpcharges

  // Validate current step selections (for required components)
  const isCurrentStepValid = () => {
    if (!currentComponent.isRequired) return true

    if (currentComponent.menuItem) {
      const componentSelections = selections[currentComponent.id] || {}
      const requiredGroups = currentComponent.menuItem.modifierGroups?.filter(mg => mg.modifierGroup.isRequired) || []

      for (const mg of requiredGroups) {
        const groupSelections = componentSelections[mg.modifierGroup.id] || []
        if (groupSelections.length < mg.modifierGroup.minSelections) {
          return false
        }
      }
      return true
    } else if (currentComponent.options && currentComponent.options.length > 0) {
      const legacySelections = (selections[currentComponent.id] as unknown as string[]) || []
      return legacySelections.length >= currentComponent.minSelections
    }

    return true
  }

  const handleNext = () => {
    if (isCurrentStepValid()) {
      if (isLastStep) {
        onConfirm(selections)
      } else {
        setCurrentStep(currentStep + 1)
      }
    }
  }

  const handleBack = () => {
    if (!isFirstStep) {
      setCurrentStep(currentStep - 1)
    }
  }

  const handleModifierToggle = (groupId: string, modifierId: string, maxSelections: number) => {
    setSelections(prev => {
      const compSelections = prev[currentComponent.id] || {}
      const current = compSelections[groupId] || []

      let newGroupSelections: string[]
      if (current.includes(modifierId)) {
        newGroupSelections = current.filter(id => id !== modifierId)
      } else if (maxSelections === 1) {
        newGroupSelections = [modifierId]
      } else if (current.length < maxSelections) {
        newGroupSelections = [...current, modifierId]
      } else {
        return prev
      }

      return {
        ...prev,
        [currentComponent.id]: {
          ...compSelections,
          [groupId]: newGroupSelections,
        },
      }
    })
  }

  const handleLegacyOptionToggle = (optionId: string) => {
    setSelections(prev => {
      const current = (prev[currentComponent.id] as unknown as string[]) || []
      let newSelections: string[]

      if (current.includes(optionId)) {
        newSelections = current.filter(id => id !== optionId)
      } else if (currentComponent.maxSelections === 1) {
        newSelections = [optionId]
      } else if (current.length < currentComponent.maxSelections) {
        newSelections = [...current, optionId]
      } else {
        return prev
      }

      return { ...prev, [currentComponent.id]: newSelections as unknown as Record<string, string[]> }
    })
  }

  return (
    <div className="fixed inset-0 bg-slate-900/95 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-gradient-to-br from-slate-800/90 to-slate-900/90 backdrop-blur-lg rounded-2xl shadow-2xl border border-white/10 w-full max-w-3xl max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-white/10 bg-white/5">
          <h2 className="text-xl font-bold text-slate-100">{item.name}</h2>
          <div className="flex items-center gap-2 text-sm mt-1">
            {template.comparePrice && (
              <span className="line-through text-slate-400">{formatCurrency(template.comparePrice)}</span>
            )}
            <span className="font-bold text-emerald-400">{formatCurrency(template.basePrice)}</span>
            {template.comparePrice && (
              <span className="text-green-400 text-xs font-medium">
                Save {formatCurrency(template.comparePrice - template.basePrice)}!
              </span>
            )}
            {totalUpcharges > 0 && (
              <span className="text-amber-400 text-xs">
                +{formatCurrency(totalUpcharges)} upgrades
              </span>
            )}
          </div>
        </div>

        {/* Horizontal Stepper */}
        <div className="px-6 py-4 bg-white/5 border-b border-white/10">
          <div className="flex items-center justify-between">
            {template.components.map((component, index) => {
              const isActive = index === currentStep
              const isCompleted = index < currentStep
              const isUpcoming = index > currentStep

              return (
                <div key={component.id} className="flex items-center flex-1">
                  {/* Step Circle */}
                  <div className="flex flex-col items-center">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                        isActive
                          ? 'bg-gradient-to-r from-emerald-500 to-cyan-500 text-white scale-110 shadow-lg shadow-emerald-500/50'
                          : isCompleted
                          ? 'bg-emerald-500/80 text-white'
                          : 'bg-slate-700/50 text-slate-400 border border-slate-600'
                      }`}
                    >
                      {isCompleted ? '✓' : index + 1}
                    </div>
                    <span
                      className={`text-[10px] mt-1 text-center max-w-[80px] ${
                        isActive ? 'text-emerald-300 font-semibold' : 'text-slate-400'
                      }`}
                    >
                      {component.displayName}
                    </span>
                  </div>

                  {/* Connector Line */}
                  {index < template.components.length - 1 && (
                    <div
                      className={`flex-1 h-0.5 mx-2 transition-colors ${
                        isCompleted ? 'bg-emerald-500/80' : 'bg-slate-700/50'
                      }`}
                    />
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Step Content */}
        <div className="p-6 overflow-y-auto max-h-[50vh]">
          {/* New structure: menuItem with modifierGroups */}
          {currentComponent.menuItem && (
            <div className="space-y-6">
              {currentComponent.menuItem.modifierGroups && currentComponent.menuItem.modifierGroups.length > 0 ? (
                currentComponent.menuItem.modifierGroups.map(mg => {
                  const group = mg.modifierGroup
                  const componentSelections = selections[currentComponent.id] || {}
                  const groupSelections = componentSelections[group.id] || []

                  return (
                    <div key={group.id}>
                      <p className="text-sm text-slate-300 mb-3 font-medium">
                        {group.displayName || group.name}
                        {group.isRequired && <span className="text-red-400 ml-1">*</span>}
                        {group.maxSelections > 1 && (
                          <span className="text-xs text-slate-400 ml-2">
                            (choose up to {group.maxSelections})
                          </span>
                        )}
                      </p>
                      <div className="grid grid-cols-2 gap-3">
                        {group.modifiers.map(mod => {
                          const isSelected = groupSelections.includes(mod.id)
                          const overridePrice = currentComponent.modifierPriceOverrides?.[mod.id]
                          const displayPrice = overridePrice !== undefined ? overridePrice : 0

                          return (
                            <button
                              key={mod.id}
                              onClick={() => handleModifierToggle(group.id, mod.id, group.maxSelections)}
                              className={`p-3 rounded-lg border-2 text-left text-sm transition-all ${
                                isSelected
                                  ? 'border-emerald-500 bg-emerald-500/20 shadow-md shadow-emerald-500/20'
                                  : 'border-slate-600 bg-slate-800/50 hover:border-slate-500 hover:bg-slate-700/50'
                              }`}
                            >
                              <span className="font-medium text-slate-100">{mod.name}</span>
                              {displayPrice > 0 && (
                                <span className="text-emerald-400 text-xs ml-1 block mt-1">
                                  +{formatCurrency(displayPrice)}
                                </span>
                              )}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })
              ) : (
                <p className="text-sm text-slate-400 italic text-center py-8">
                  No customization options for this step
                </p>
              )}
            </div>
          )}

          {/* Legacy structure: options array */}
          {!currentComponent.menuItem && currentComponent.options && currentComponent.options.length > 0 && (
            <div>
              <p className="text-sm text-slate-300 mb-3 font-medium">
                {currentComponent.displayName}
                {currentComponent.isRequired && <span className="text-red-400 ml-1">*</span>}
              </p>
              <div className="grid grid-cols-2 gap-3">
                {currentComponent.options.map(option => {
                  const legacySelections = (selections[currentComponent.id] as unknown as string[]) || []
                  const isSelected = legacySelections.includes(option.id)

                  return (
                    <button
                      key={option.id}
                      onClick={() => handleLegacyOptionToggle(option.id)}
                      disabled={!option.isAvailable}
                      className={`p-3 rounded-lg border-2 text-left transition-all ${
                        isSelected
                          ? 'border-emerald-500 bg-emerald-500/20'
                          : !option.isAvailable
                          ? 'border-slate-700 bg-slate-800/30 opacity-50 cursor-not-allowed'
                          : 'border-slate-600 bg-slate-800/50 hover:border-slate-500 hover:bg-slate-700/50'
                      }`}
                    >
                      <span className="font-medium text-slate-100">{option.name}</span>
                      {option.upcharge > 0 && (
                        <span className="text-emerald-400 text-sm ml-1 block mt-1">
                          +{formatCurrency(option.upcharge)}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer - Navigation */}
        <div className="p-4 border-t border-white/10 bg-white/5 flex items-center justify-between gap-3">
          <div className="text-sm text-slate-300">
            Step {currentStep + 1} of {template.components.length}
          </div>

          <div className="flex gap-3">
            <button
              onClick={handleBack}
              disabled={isFirstStep}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                isFirstStep
                  ? 'bg-slate-700/30 text-slate-500 cursor-not-allowed'
                  : 'bg-slate-700 hover:bg-slate-600 text-slate-200'
              }`}
            >
              Back
            </button>
            <button
              onClick={onCancel}
              className="px-4 py-2 rounded-lg text-sm font-medium bg-slate-700 hover:bg-slate-600 text-slate-200 transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleNext}
              disabled={!isCurrentStepValid()}
              className={`px-6 py-2 rounded-lg text-sm font-semibold transition-all ${
                isCurrentStepValid()
                  ? 'bg-gradient-to-r from-emerald-500 to-cyan-500 hover:from-emerald-600 hover:to-cyan-600 text-white shadow-lg shadow-emerald-500/30'
                  : 'bg-slate-700/30 text-slate-500 cursor-not-allowed'
              }`}
            >
              {isLastStep ? `Add to Order • ${formatCurrency(finalTotal)}` : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
