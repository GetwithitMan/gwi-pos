'use client'

import { memo, useCallback } from 'react'

export interface IngredientMod {
  id: string
  ingredientName: string
  modificationType: 'no' | 'lite' | 'on_side' | 'extra' | 'swap'
  swappedToModifierName?: string | null
}

export interface KDSItem {
  id: string
  name: string
  quantity: number
  categoryName: string | null
  pricingOptionLabel: string | null
  specialNotes: string | null
  isCompleted: boolean
  completedAt: string | null
  completedBy: string | null  // Who marked complete (T023)
  resendCount: number
  lastResentAt: string | null
  resendNote: string | null
  // Seat assignment (T023)
  seatNumber: number | null
  // Coursing info (T013)
  courseNumber: number | null
  courseStatus: string
  isHeld: boolean
  firedAt: string | null
  // Weight-based item fields
  soldByWeight?: boolean
  weight?: number | null
  weightUnit?: string | null
  tareWeight?: number | null
  modifiers: { id: string; name: string; depth?: number; isCustomEntry?: boolean; isNoneSelection?: boolean; customEntryName?: string | null; swapTargetName?: string | null }[]
  ingredientModifications: IngredientMod[]
  allergens?: string[]
}

export interface KDSOrder {
  id: string
  orderNumber: number
  orderType: string
  tableName: string | null
  tabName: string | null
  employeeName: string
  createdAt: string
  elapsedMinutes: number
  timeStatus: 'fresh' | 'aging' | 'late'
  notes: string | null
  // Delivery customer info
  customerName?: string | null
  customerPhone?: string | null
  deliveryAddress?: string | null
  deliveryInstructions?: string | null
  source?: string | null
  // Notification pager info
  pagerNumber?: string | null
  items: KDSItem[]
}

export interface KDSOrderCardProps {
  order: KDSOrder
  onBumpItem: (itemId: string) => void
  onUncompleteItem: (itemId: string) => void
  onBumpOrder: (order: KDSOrder) => void
  socketConnected: boolean
  // Phase 6: Behavior config
  strikeThroughModifiers?: boolean
  // Phase 10: Keyboard navigation
  isSelected?: boolean
  // Voided/comped item overlay: map of itemId -> 'voided' | 'comped'
  voidingItems?: Map<string, 'voided' | 'comped'>
}

export const ORDER_TYPE_LABELS: Record<string, string> = {
  dine_in: 'Dine In',
  takeout: 'Takeout',
  delivery: 'Delivery',
  delivery_doordash: 'DoorDash',
  delivery_ubereats: 'Uber Eats',
  delivery_grubhub: 'Grubhub',
  bar_tab: 'Bar',
  boh_sale: 'BOH',
}

export const ORDER_TYPE_COLORS: Record<string, string> = {
  dine_in: 'bg-blue-600',
  takeout: 'bg-orange-600',
  delivery: 'bg-purple-600',
  delivery_doordash: 'bg-red-500',
  delivery_ubereats: 'bg-green-500',
  delivery_grubhub: 'bg-orange-500',
  bar_tab: 'bg-green-600',
  boh_sale: 'bg-gray-600',
}

// Course colors for KDS display (T013)
export const COURSE_COLORS: Record<number, string> = {
  0: '#EF4444', // ASAP - Red
  1: '#3B82F6', // Course 1 - Blue
  2: '#10B981', // Course 2 - Green
  3: '#F59E0B', // Course 3 - Amber
  4: '#EC4899', // Course 4 - Pink
  5: '#8B5CF6', // Course 5 - Violet
}

export const getCourseColor = (courseNumber: number): string => {
  return COURSE_COLORS[courseNumber] || '#6B7280'
}

// Stable style object for pricing option labels (avoids re-allocation per render)
const PRICING_OPTION_STYLE: React.CSSProperties = {
  fontSize: '12px',
  fontWeight: 600,
  color: '#38bdf8',
  marginLeft: '6px',
}

// Hoisted helpers (pure functions, no component state dependency)
export const formatTime = (minutes: number) => {
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return `${hours}h ${mins}m`
}

export const getTimeStatusColor = (status: string) => {
  switch (status) {
    case 'fresh': return 'text-green-400'
    case 'aging': return 'text-yellow-400'
    case 'late': return 'text-red-400'
    default: return 'text-gray-400'
  }
}

export const getTimeStatusBg = (status: string) => {
  switch (status) {
    case 'fresh': return 'border-green-500'
    case 'aging': return 'border-yellow-400 bg-yellow-950/30'
    case 'late': return 'border-red-400 bg-red-950/40 animate-pulse'
    default: return 'border-gray-500'
  }
}

// ---------------------------------------------------------------------------
// MEMOIZED KDS ORDER CARD — prevents full grid re-render when one card changes
// ---------------------------------------------------------------------------
export const KDSOrderCard = memo(function KDSOrderCard({
  order,
  onBumpItem,
  onUncompleteItem,
  onBumpOrder,
  socketConnected,
  strikeThroughModifiers = false,
  isSelected = false,
  voidingItems,
}: KDSOrderCardProps) {
  const allCompleted = order.items.every(item => item.isCompleted)

  const handleBumpOrderClick = useCallback(() => {
    onBumpOrder(order)
  }, [onBumpOrder, order])

  return (
    <div
      className={`bg-gray-800 rounded-lg border-t-4 overflow-hidden transition-all ${
        allCompleted ? 'opacity-50 border-green-500' : getTimeStatusBg(order.timeStatus)
      } ${isSelected ? 'ring-2 ring-blue-400 ring-offset-2 ring-offset-gray-900' : ''}`}
    >
      {/* Order Header */}
      <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className={`text-2xl font-bold ${allCompleted ? 'text-green-400' : ''}`}>
            #{order.orderNumber}
          </span>
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${ORDER_TYPE_COLORS[order.orderType]} text-white`}>
            {ORDER_TYPE_LABELS[order.orderType] || order.orderType}
          </span>
          {order.pagerNumber && (
            <span className="px-2 py-0.5 rounded text-xs font-bold bg-teal-900/60 text-teal-300 border border-teal-700/50">
              Pager #{order.pagerNumber}
            </span>
          )}
        </div>
        <div className={`text-lg font-mono font-bold ${getTimeStatusColor(order.timeStatus)}`}>
          {formatTime(order.elapsedMinutes)}
        </div>
      </div>

      {/* Order Info */}
      <div className="px-4 py-2 bg-gray-750 border-b border-gray-700 text-sm text-gray-400">
        <div className="flex justify-between">
          <span>{order.tableName || order.tabName || order.employeeName}</span>
          <span>{order.items.length} item{order.items.length !== 1 ? 's' : ''}</span>
        </div>

        {/* Delivery Customer Info */}
        {order.orderType.startsWith('delivery') && (order.customerName || order.customerPhone) && (
          <div className="mt-1 text-xs space-y-0.5">
            {order.customerName && (
              <div className="font-semibold text-white truncate">
                {order.customerName}
              </div>
            )}
            {order.customerPhone && (
              <div className="text-gray-400 truncate">
                {order.customerPhone}
              </div>
            )}
            {order.deliveryAddress && (
              <div className="text-gray-400 truncate" title={order.deliveryAddress}>
                {order.deliveryAddress}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Items */}
      <div className="divide-y divide-gray-700">
        {order.items.map(item => {
          const voidStatus = voidingItems?.get(item.id)
          return (
          <div
            key={item.id}
            className={`relative px-4 py-3 transition-colors ${
              voidStatus
                ? 'bg-red-900/40'
                : item.isCompleted
                ? 'bg-green-900/20'
                : 'hover:bg-gray-750 cursor-pointer'
            }`}
            onClick={() => voidStatus ? undefined : (item.isCompleted ? onUncompleteItem(item.id) : onBumpItem(item.id))}
          >
            {/* VOIDED / COMPED overlay */}
            {voidStatus && (
              <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
                <span className={`text-2xl font-black tracking-widest px-4 py-1 rounded border-2 rotate-[-6deg] ${
                  voidStatus === 'voided'
                    ? 'text-red-400 border-red-500 bg-red-950/80'
                    : 'text-yellow-400 border-yellow-500 bg-yellow-950/80'
                }`}>
                  {voidStatus === 'voided' ? 'VOIDED' : 'COMPED'}
                </span>
              </div>
            )}
            <div className={`flex items-start justify-between gap-2 ${voidStatus ? 'opacity-40' : ''}`}>
              <div className="flex-1">
                <div className={`font-medium ${voidStatus ? 'line-through text-red-400' : item.isCompleted ? 'line-through text-gray-500' : 'text-white'}`}>
                  {/* Seat number prefix (T023) */}
                  {item.seatNumber && (
                    <span className="text-purple-400 font-bold mr-1">S{item.seatNumber}:</span>
                  )}
                  {item.soldByWeight && item.weight != null ? (
                    <span className="bg-green-100 text-green-800 px-1.5 py-0.5 rounded text-xs font-bold mr-2">
                      {Number(item.weight).toFixed(2)} {item.weightUnit || 'lb'}
                    </span>
                  ) : (
                    <span className="text-blue-400 mr-2">{item.quantity}x</span>
                  )}
                  {item.name}
                  {item.pricingOptionLabel && (
                    <span style={PRICING_OPTION_STYLE}>
                      ({item.pricingOptionLabel})
                    </span>
                  )}
                  {/* Course badge (T013) */}
                  {item.courseNumber != null && item.courseNumber >= 0 && (
                    <span
                      className={`ml-2 px-1.5 py-0.5 text-xs font-bold rounded text-white ${item.isHeld ? 'animate-pulse ring-1 ring-red-400' : ''}`}
                      style={{ backgroundColor: getCourseColor(item.courseNumber) }}
                    >
                      {item.courseNumber === 0 ? 'ASAP' : `C${item.courseNumber}`}
                      {item.courseStatus === 'fired' && ' '}
                      {item.courseStatus === 'ready' && ' '}
                    </span>
                  )}
                  {/* Held badge */}
                  {item.isHeld && (
                    <span className="ml-1 px-1.5 py-0.5 bg-red-600 text-white text-xs font-bold rounded animate-pulse">
                      HOLD
                    </span>
                  )}
                  {item.resendCount > 0 && (
                    <span className="ml-2 px-2 py-0.5 bg-red-600 text-white text-xs font-bold rounded animate-pulse">
                      RESEND{item.resendCount > 1 ? ` x${item.resendCount}` : ''}
                    </span>
                  )}
                </div>

                {item.resendNote && (
                  <div className={`mt-1 text-sm font-medium ${item.isCompleted ? 'text-gray-600' : 'text-red-400'}`}>
                    {item.resendNote}
                  </div>
                )}

                {item.ingredientModifications?.length > 0 && (
                  <div className="mt-1 space-y-0.5">
                    {item.ingredientModifications.map(ing => (
                      <div
                        key={ing.id}
                        className={`text-sm pl-4 font-semibold ${
                          item.isCompleted ? 'text-gray-600' :
                          ing.modificationType === 'no' ? 'text-red-400' :
                          ing.modificationType === 'swap' ? 'text-purple-400' :
                          ing.modificationType === 'extra' ? 'text-green-400' : 'text-cyan-400'
                        }`}
                      >
                        {ing.modificationType === 'no' && `NO ${ing.ingredientName}`}
                        {ing.modificationType === 'lite' && `LITE ${ing.ingredientName}`}
                        {ing.modificationType === 'on_side' && `SIDE ${ing.ingredientName}`}
                        {ing.modificationType === 'extra' && `EXTRA ${ing.ingredientName}`}
                        {ing.modificationType === 'swap' && `SWAP ${ing.ingredientName} → ${ing.swappedToModifierName}`}
                      </div>
                    ))}
                  </div>
                )}

                {item.modifiers.length > 0 && (() => {
                  // Aggregate stacked modifiers by (name, preModifier, depth)
                  const aggregatedMods = item.modifiers.reduce((acc, mod) => {
                    const key = `${mod.name}|${mod.depth || 0}`
                    const existing = acc.find(a => a.key === key)
                    if (existing) {
                      existing.count++
                    } else {
                      acc.push({ ...mod, key, count: 1 })
                    }
                    return acc
                  }, [] as (typeof item.modifiers[number] & { key: string; count: number })[])

                  return (
                    <div className="mt-1 space-y-0.5">
                      {aggregatedMods.map((mod, idx) => {
                        const depth = mod.depth || 0
                        const prefix = depth > 0 ? '-'.repeat(depth) + ' ' : '• '
                        return (
                          <div
                            key={`${mod.key}-${idx}`}
                            className={`text-sm pl-4 ${
                              item.isCompleted ? 'text-gray-600' : depth === 0 ? 'text-yellow-400' : 'text-yellow-300'
                            } ${item.isCompleted && strikeThroughModifiers ? 'line-through' : ''}`}
                          >
                            {prefix}{mod.isNoneSelection ? '' : mod.isCustomEntry ? 'CUSTOM: ' : ''}{mod.swapTargetName ? `${mod.name} → ${mod.swapTargetName}` : mod.name}{mod.count > 1 ? ` ×${mod.count}` : ''}
                          </div>
                        )
                      })}
                    </div>
                  )
                })()}

                {item.specialNotes && (
                  <div className={`mt-1 text-sm font-medium ${item.isCompleted ? 'text-gray-600' : 'text-orange-400'}`}>
                    {item.specialNotes}
                  </div>
                )}

                {/* Allergen badges */}
                {item.allergens && item.allergens.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {item.allergens.map(allergen => (
                      <span
                        key={allergen}
                        className={`px-1.5 py-0.5 text-[10px] font-bold rounded border ${
                          item.isCompleted
                            ? 'bg-gray-700 text-gray-400 border-gray-600'
                            : 'bg-orange-900/60 text-orange-300 border-orange-500/50'
                        }`}
                      >
                        {allergen.toUpperCase()}
                      </span>
                    ))}
                  </div>
                )}

                {/* Completion info (T023) */}
                {item.isCompleted && item.completedAt && (
                  <div className="mt-1 text-xs text-green-500">
                    ✓ Completed {new Date(item.completedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                    {item.completedBy && <span className="text-gray-500"> by {item.completedBy}</span>}
                  </div>
                )}
              </div>

              {item.isCompleted ? (
                <div className="w-6 h-6 bg-green-600 rounded-full flex items-center justify-center flex-shrink-0">
                  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
              ) : (
                <div className="w-6 h-6 border-2 border-gray-500 rounded-full flex-shrink-0" />
              )}
            </div>
          </div>
          )
        })}
      </div>

      {(order.notes || order.deliveryInstructions) && (
        <div className="px-4 py-2 bg-orange-900/30 border-t border-orange-800/50">
          {order.deliveryInstructions && (
            <p className="text-sm text-orange-300 font-medium">
              Delivery: {order.deliveryInstructions}
            </p>
          )}
          {order.notes && order.notes !== order.deliveryInstructions && (
            <p className="text-sm text-orange-300">
              <span className="font-medium">Note:</span> {order.notes}
            </p>
          )}
        </div>
      )}

      {!allCompleted && (
        <div className="p-3 border-t border-gray-700">
          <button
            onClick={handleBumpOrderClick}
            disabled={!socketConnected}
            className={`w-full py-3 rounded-lg font-bold text-lg transition-colors ${
              socketConnected
                ? 'bg-green-600 hover:bg-green-700'
                : 'bg-gray-600 cursor-not-allowed opacity-60'
            }`}
          >
            BUMP ORDER
          </button>
        </div>
      )}
    </div>
  )
})
