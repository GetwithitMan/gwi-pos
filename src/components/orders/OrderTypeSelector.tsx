'use client'

import { useState, useEffect } from 'react'
import { OrderTypeConfig, WorkflowRules, OrderCustomFields, FieldDefinition } from '@/types/order-types'

// Icons mapping
const ICONS: Record<string, React.ReactNode> = {
  table: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
    </svg>
  ),
  wine: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 2L12 8L15 2M12 8v9M9 20h6M12 17L8 20M12 17l4 3" />
    </svg>
  ),
  bag: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
    </svg>
  ),
  truck: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 17h8M8 17a2 2 0 11-4 0 2 2 0 014 0zM16 17a2 2 0 104 0 2 2 0 00-4 0zM3 9h4l3-6h4l3 6h4v5h-2M5 9v8" />
    </svg>
  ),
  phone: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
    </svg>
  ),
  car: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 17h8M8 17a2 2 0 11-4 0 2 2 0 014 0zM16 17a2 2 0 104 0 2 2 0 00-4 0zM5 11l2-6h10l2 6M5 11h14v6H5v-6z" />
    </svg>
  ),
}

// Module-level cache — order types don't change during a shift
let cachedOrderTypes: OrderTypeConfig[] | null = null
let orderTypeCacheLocationId: string | null = null

interface OrderTypeSelectorProps {
  locationId: string
  selectedType?: string | null
  onSelectType: (orderType: OrderTypeConfig, customFields?: OrderCustomFields) => void
  onBarModeClick?: () => void  // Called when Bar Tab is clicked to switch to bar mode
  className?: string
  compact?: boolean
}

export function OrderTypeSelector({
  locationId,
  selectedType,
  onSelectType,
  onBarModeClick,
  className = '',
  compact = false,
}: OrderTypeSelectorProps) {
  const [orderTypes, setOrderTypes] = useState<OrderTypeConfig[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [showFieldsModal, setShowFieldsModal] = useState(false)
  const [pendingOrderType, setPendingOrderType] = useState<OrderTypeConfig | null>(null)
  const [customFieldValues, setCustomFieldValues] = useState<OrderCustomFields>({})
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  // Load order types (with module-level cache)
  useEffect(() => {
    async function loadOrderTypes() {
      // Use cached types if available for same location
      if (cachedOrderTypes && orderTypeCacheLocationId === locationId) {
        setOrderTypes(cachedOrderTypes)
        setIsLoading(false)
        return
      }

      try {
        const response = await fetch(`/api/order-types?locationId=${locationId}`)
        if (response.ok) {
          const data = await response.json()
          const types = data.orderTypes || []
          setOrderTypes(types)
          cachedOrderTypes = types
          orderTypeCacheLocationId = locationId
        }
      } catch (error) {
        console.error('Failed to load order types:', error)
      } finally {
        setIsLoading(false)
      }
    }

    if (locationId) {
      loadOrderTypes()
    }
  }, [locationId])

  // Check if order type has required fields that need to be collected
  const hasRequiredFields = (orderType: OrderTypeConfig): boolean => {
    const required = orderType.requiredFields as Record<string, boolean> || {}
    const definitions = orderType.fieldDefinitions as Record<string, FieldDefinition> || {}

    // Check for fields that need user input (not tableId which is selected separately)
    const needsInput = Object.keys(required).some(
      field => required[field] && field !== 'tableId' && definitions[field]
    )

    return needsInput
  }

  // Handle order type button click
  const handleTypeClick = (orderType: OrderTypeConfig) => {
    // Special handling for bar_tab - switch to bar mode instead
    if (orderType.slug === 'bar_tab' && onBarModeClick) {
      onBarModeClick()
      return
    }

    if (hasRequiredFields(orderType)) {
      // Show fields modal to collect required data
      setPendingOrderType(orderType)
      setCustomFieldValues({})
      setFieldErrors({})
      setShowFieldsModal(true)
    } else {
      // No required fields, select immediately
      onSelectType(orderType)
    }
  }

  // Validate and submit custom fields
  const handleFieldsSubmit = () => {
    if (!pendingOrderType) return

    const required = pendingOrderType.requiredFields as Record<string, boolean> || {}
    const definitions = pendingOrderType.fieldDefinitions as Record<string, FieldDefinition> || {}
    const errors: Record<string, string> = {}

    // Validate required fields
    Object.keys(required).forEach(field => {
      if (required[field] && field !== 'tableId' && definitions[field]) {
        const value = customFieldValues[field]
        if (!value || value.trim() === '') {
          errors[field] = `${definitions[field].label} is required`
        }
      }
    })

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      return
    }

    // All valid, submit
    onSelectType(pendingOrderType, customFieldValues)
    setShowFieldsModal(false)
    setPendingOrderType(null)
    setCustomFieldValues({})
  }

  // Render field input based on type
  const renderFieldInput = (fieldName: string, definition: FieldDefinition) => {
    const value = customFieldValues[fieldName] || ''
    const error = fieldErrors[fieldName]

    const baseClass = `w-full px-3 py-2 rounded-lg border transition-colors ${
      error ? 'border-red-400 bg-red-50' : 'border-gray-300 focus:border-blue-500'
    } focus:outline-none`

    switch (definition.type) {
      case 'textarea':
        return (
          <textarea
            value={value}
            onChange={(e) => setCustomFieldValues(prev => ({ ...prev, [fieldName]: e.target.value }))}
            placeholder={definition.placeholder}
            className={`${baseClass} min-h-[80px]`}
          />
        )
      case 'select':
        // Use button grid for better touch UX
        // Dynamic column count based on options
        const optCount = definition.options?.length || 0
        const gridCols = optCount <= 4 ? 'grid-cols-2'
          : optCount <= 6 ? 'grid-cols-3'
          : 'grid-cols-4'

        // Color options get special styling with colored backgrounds
        const isColorField = fieldName.toLowerCase().includes('color')

        return (
          <div className={`grid ${gridCols} gap-2`}>
            {definition.options?.map(opt => {
              const isSelected = value === opt.value

              // For color fields, show actual colors
              if (isColorField) {
                const colorMap: Record<string, string> = {
                  black: '#1a1a1a',
                  white: '#f5f5f5',
                  silver: '#a8a8a8',
                  red: '#dc2626',
                  blue: '#2563eb',
                  green: '#16a34a',
                  brown: '#78350f',
                  gold: '#d4a574',
                  orange: '#ea580c',
                  yellow: '#eab308',
                  purple: '#7c3aed',
                  other: '#6b7280',
                }
                const bgColor = colorMap[opt.value] || '#6b7280'
                const textColor = ['white', 'yellow', 'gold', 'silver'].includes(opt.value) ? '#333' : '#fff'

                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setCustomFieldValues(prev => ({ ...prev, [fieldName]: opt.value }))}
                    className={`px-2 py-3 rounded-lg text-sm font-medium transition-all ${
                      isSelected
                        ? 'ring-4 ring-blue-500 ring-offset-2 shadow-lg scale-105'
                        : 'hover:scale-105 hover:shadow-md'
                    }`}
                    style={{ backgroundColor: bgColor, color: textColor }}
                  >
                    {opt.label}
                  </button>
                )
              }

              // Regular select options
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setCustomFieldValues(prev => ({ ...prev, [fieldName]: opt.value }))}
                  className={`px-3 py-3 rounded-lg text-sm font-medium transition-all ${
                    isSelected
                      ? 'bg-blue-500 text-white shadow-lg ring-2 ring-blue-300'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200 hover:shadow'
                  }`}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        )
      case 'time':
        return (
          <input
            type="time"
            value={value}
            onChange={(e) => setCustomFieldValues(prev => ({ ...prev, [fieldName]: e.target.value }))}
            className={baseClass}
          />
        )
      case 'phone':
        return (
          <input
            type="tel"
            value={value}
            onChange={(e) => setCustomFieldValues(prev => ({ ...prev, [fieldName]: e.target.value }))}
            placeholder={definition.placeholder || '555-123-4567'}
            className={baseClass}
          />
        )
      default:
        return (
          <input
            type="text"
            value={value}
            onChange={(e) => setCustomFieldValues(prev => ({ ...prev, [fieldName]: e.target.value }))}
            placeholder={definition.placeholder}
            className={baseClass}
          />
        )
    }
  }

  if (isLoading) {
    return (
      <div className={`flex gap-2 ${className}`}>
        {[1, 2, 3].map(i => (
          <div key={i} className="h-8 w-20 bg-gray-200 rounded-lg animate-pulse" />
        ))}
      </div>
    )
  }

  if (orderTypes.length === 0) {
    // Fallback to hardcoded types if none configured
    return (
      <div className={`flex gap-2 ${className}`}>
        <button
          onClick={() => onSelectType({ slug: 'dine_in', name: 'Dine In' } as OrderTypeConfig)}
          className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-all ${
            selectedType === 'dine_in'
              ? 'bg-blue-500 text-white'
              : 'bg-white/20 text-gray-700 hover:bg-white/40'
          }`}
        >
          Table
        </button>
        <button
          onClick={() => onBarModeClick ? onBarModeClick() : onSelectType({ slug: 'bar_tab', name: 'Bar Tab' } as OrderTypeConfig)}
          className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-all ${
            selectedType === 'bar_tab'
              ? 'bg-purple-500 text-white'
              : 'bg-white/20 text-gray-700 hover:bg-white/40'
          }`}
        >
          Bar Mode
        </button>
        <button
          onClick={() => onSelectType({ slug: 'takeout', name: 'Takeout' } as OrderTypeConfig)}
          className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-all ${
            selectedType === 'takeout'
              ? 'bg-emerald-500 text-white'
              : 'bg-white/20 text-gray-700 hover:bg-white/40'
          }`}
        >
          Takeout
        </button>
      </div>
    )
  }

  return (
    <>
      <div className={`flex gap-2 flex-wrap ${className}`}>
        {orderTypes.map(orderType => {
          const isSelected = selectedType === orderType.slug
          const icon = orderType.icon ? ICONS[orderType.icon] : null
          const bgColor = orderType.color || '#6B7280'

          return (
            <button
              key={orderType.id}
              onClick={() => handleTypeClick(orderType)}
              className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-all flex items-center gap-1.5 ${
                isSelected
                  ? 'text-white shadow-md'
                  : 'bg-white/20 text-gray-700 hover:bg-white/40'
              }`}
              style={isSelected ? { backgroundColor: bgColor } : undefined}
            >
              {icon}
              {compact ? null : orderType.name}
            </button>
          )
        })}
      </div>

      {/* Custom Fields Modal */}
      {showFieldsModal && pendingOrderType && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold mb-6 flex items-center gap-3 text-gray-800">
              <span
                className="w-10 h-10 rounded-full flex items-center justify-center text-white"
                style={{ backgroundColor: pendingOrderType.color || '#6B7280' }}
              >
                {pendingOrderType.icon && ICONS[pendingOrderType.icon]}
              </span>
              {pendingOrderType.name} Order
            </h3>

            <div className="space-y-4">
              {/* Render required fields */}
              {Object.entries(pendingOrderType.requiredFields as Record<string, boolean> || {}).map(([field, isRequired]) => {
                if (!isRequired || field === 'tableId') return null
                const definition = (pendingOrderType.fieldDefinitions as Record<string, FieldDefinition>)?.[field]
                if (!definition) return null

                return (
                  <div key={field}>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {definition.label}
                      {isRequired && <span className="text-red-500 ml-1">*</span>}
                    </label>
                    {renderFieldInput(field, definition)}
                    {fieldErrors[field] && (
                      <p className="text-red-500 text-xs mt-1">{fieldErrors[field]}</p>
                    )}
                  </div>
                )
              })}

              {/* Render optional fields */}
              {Object.entries(pendingOrderType.optionalFields as Record<string, boolean> || {}).map(([field, isEnabled]) => {
                if (!isEnabled) return null
                const definition = (pendingOrderType.fieldDefinitions as Record<string, FieldDefinition>)?.[field]
                if (!definition) return null

                return (
                  <div key={field}>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      {definition.label}
                    </label>
                    {renderFieldInput(field, definition)}
                  </div>
                )
              })}
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => {
                  setShowFieldsModal(false)
                  setPendingOrderType(null)
                }}
                className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleFieldsSubmit}
                className="flex-1 px-4 py-2 text-white rounded-lg font-medium transition-colors"
                style={{ backgroundColor: pendingOrderType.color || '#3B82F6' }}
              >
                Start Order
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// Badge component for displaying order type on KDS/orders
export function OrderTypeBadge({
  orderType,
  customFields,
  size = 'md',
}: {
  orderType?: OrderTypeConfig | { slug: string; name: string; color?: string }
  customFields?: OrderCustomFields
  size?: 'sm' | 'md' | 'lg'
}) {
  if (!orderType) return null

  const sizeClasses = {
    sm: 'px-1.5 py-0.5 text-[10px]',
    md: 'px-2 py-1 text-xs',
    lg: 'px-3 py-1.5 text-sm',
  }

  // Format badge text with custom field values
  let badgeText = orderType.name
  const kdsConfig = 'kdsConfig' in orderType ? orderType.kdsConfig as { badgeText?: string } : null

  if (kdsConfig?.badgeText && customFields) {
    badgeText = kdsConfig.badgeText.replace(
      /\{(\w+)\}/g,
      (_, field) => customFields[field] || ''
    )
  }

  return (
    <span
      className={`inline-flex items-center rounded-full font-medium ${sizeClasses[size]}`}
      style={{
        backgroundColor: `${orderType.color || '#6B7280'}20`,
        color: orderType.color || '#6B7280',
      }}
    >
      {badgeText}
    </span>
  )
}
