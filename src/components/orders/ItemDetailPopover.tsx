'use client'

import { useState, useEffect } from 'react'
import { formatCurrency } from '@/lib/utils'

interface ItemDetail {
  id: string
  name: string
  description: string | null
  price: number
  isAvailable: boolean
  is86d: boolean
  itemType: string | null
  category: { id: string; name: string; categoryType: string } | null
  recipe: {
    totalCost: number | null
    foodCostPct: number | null
    ingredients: Array<{
      id: string
      name: string
      quantity: number | null
      unit: string
      cost: number | null
      notes: string | null
    }>
  } | null
  ingredients: Array<{
    id: string
    name: string
    isDefault: boolean
    isRequired: boolean
  }>
}

interface ItemDetailPopoverProps {
  menuItemId: string
  itemName: string
  quantity: number
  locationId?: string
  position: { x: number; y: number }
  onClose: () => void
}

export function ItemDetailPopover({
  menuItemId,
  itemName,
  quantity,
  locationId,
  position,
  onClose,
}: ItemDetailPopoverProps) {
  const [detail, setDetail] = useState<ItemDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!menuItemId) return
    const controller = new AbortController()
    const params = locationId ? `?locationId=${encodeURIComponent(locationId)}` : ''
    void fetch(`/api/menu/items/${menuItemId}/details${params}`, { signal: controller.signal })
      .then(r => r.ok ? r.json() : Promise.reject(new Error('Failed to fetch')))
      .then(json => {
        setDetail(json.data)
        setLoading(false)
      })
      .catch(err => {
        if (err?.name === 'AbortError') return
        setError('Could not load details')
        setLoading(false)
      })
    return () => controller.abort()
  }, [menuItemId, locationId])

  // Click outside to close
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-item-detail-popover]')) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  // Clamp to viewport
  const left = Math.min(position.x, window.innerWidth - 320)
  const top = Math.min(position.y, window.innerHeight - 400)

  return (
    <div
      data-item-detail-popover
      style={{
        position: 'fixed',
        left,
        top,
        zIndex: 9999,
        width: '300px',
        maxHeight: '380px',
        overflowY: 'auto',
        background: '#1e293b',
        border: '1px solid rgba(148, 163, 184, 0.3)',
        borderRadius: '12px',
        boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
        padding: '16px',
        color: '#e2e8f0',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
        <div>
          <div style={{ fontSize: '15px', fontWeight: 700, color: '#f1f5f9' }}>{itemName}</div>
          <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>
            Qty: {quantity}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: '#64748b',
            cursor: 'pointer',
            fontSize: '18px',
            lineHeight: 1,
            padding: '0 4px',
          }}
        >
          x
        </button>
      </div>

      {loading && (
        <div style={{ fontSize: '12px', color: '#94a3b8', textAlign: 'center', padding: '20px 0' }}>
          Loading...
        </div>
      )}

      {error && (
        <div style={{ fontSize: '12px', color: '#f87171', textAlign: 'center', padding: '20px 0' }}>
          {error}
        </div>
      )}

      {detail && (
        <>
          {/* 86'd warning */}
          {detail.is86d && (
            <div style={{
              background: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              borderRadius: '6px',
              padding: '6px 10px',
              fontSize: '11px',
              fontWeight: 600,
              color: '#f87171',
              marginBottom: '10px',
            }}>
              86&apos;d - Currently Unavailable
            </div>
          )}

          {/* Price & Category */}
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '10px',
            paddingBottom: '10px',
            borderBottom: '1px solid rgba(148, 163, 184, 0.15)',
          }}>
            <span style={{ fontSize: '14px', fontWeight: 600, color: '#60a5fa' }}>
              {formatCurrency(detail.price)}
            </span>
            {detail.category && (
              <span style={{
                fontSize: '11px',
                background: 'rgba(148, 163, 184, 0.15)',
                borderRadius: '4px',
                padding: '2px 8px',
                color: '#94a3b8',
              }}>
                {detail.category.name}
              </span>
            )}
          </div>

          {/* Description */}
          {detail.description && (
            <div style={{ marginBottom: '10px' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Description
              </div>
              <div style={{ fontSize: '12px', color: '#cbd5e1', lineHeight: 1.4 }}>
                {detail.description}
              </div>
            </div>
          )}

          {/* Recipe */}
          {detail.recipe && detail.recipe.ingredients.length > 0 && (
            <div style={{ marginBottom: '10px' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Recipe
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                {detail.recipe.ingredients.map(ing => (
                  <div key={ing.id} style={{ fontSize: '12px', color: '#cbd5e1', display: 'flex', justifyContent: 'space-between' }}>
                    <span>
                      {ing.name}
                      {ing.quantity && <span style={{ color: '#64748b' }}> ({ing.quantity} {ing.unit})</span>}
                    </span>
                    {ing.cost != null && (
                      <span style={{ color: '#64748b', fontSize: '11px' }}>{formatCurrency(ing.cost)}</span>
                    )}
                  </div>
                ))}
              </div>
              {detail.recipe.totalCost != null && (
                <div style={{
                  marginTop: '6px',
                  paddingTop: '6px',
                  borderTop: '1px solid rgba(148, 163, 184, 0.1)',
                  fontSize: '11px',
                  color: '#94a3b8',
                  display: 'flex',
                  justifyContent: 'space-between',
                }}>
                  <span>Total Cost</span>
                  <span>{formatCurrency(detail.recipe.totalCost)}</span>
                </div>
              )}
            </div>
          )}

          {/* Ingredients (menu item ingredients, not recipe) */}
          {detail.ingredients.length > 0 && !detail.recipe && (
            <div style={{ marginBottom: '10px' }}>
              <div style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                Ingredients
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {detail.ingredients.map(ing => (
                  <span key={ing.id} style={{
                    fontSize: '11px',
                    background: 'rgba(148, 163, 184, 0.1)',
                    borderRadius: '4px',
                    padding: '2px 6px',
                    color: '#94a3b8',
                  }}>
                    {ing.name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
