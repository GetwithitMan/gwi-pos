'use client'

/**
 * CartSidebar — Always-visible desktop cart sidebar (left pane).
 *
 * Shows cart items, subtotal, checkout button. Hidden on mobile (< lg).
 * The FloatingCartBar + CartDrawer handle mobile.
 */

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { formatCurrency } from '@/lib/utils'
import { useCartItems, useCartItemCount, useCartSubtotal, useSiteCartStore } from '@/stores/site-cart-store'
import { CartItemRow } from '@/components/site/CartItemRow'

export function CartSidebar() {
  const [mounted, setMounted] = useState(false)
  const items = useCartItems()
  const itemCount = useCartItemCount()
  const subtotal = useCartSubtotal()
  const clearCart = useSiteCartStore((s) => s.clearCart)
  const [confirmClear, setConfirmClear] = useState(false)
  const pathname = usePathname()

  const checkoutUrl = pathname.includes('/checkout') ? pathname : `${pathname.replace(/\/$/, '')}/checkout`

  useEffect(() => setMounted(true), [])

  const handleClear = useCallback(() => {
    if (!confirmClear) {
      setConfirmClear(true)
      setTimeout(() => setConfirmClear(false), 3000)
      return
    }
    clearCart()
    setConfirmClear(false)
  }, [confirmClear, clearCart])

  if (!mounted) return null

  return (
    <aside
      className="hidden lg:flex lg:flex-col lg:w-[340px] xl:w-[380px] shrink-0 border-r"
      style={{
        borderColor: 'var(--site-border)',
        backgroundColor: 'var(--site-surface, var(--site-bg))',
        height: 'calc(100vh - 64px)',
        position: 'sticky',
        top: 64,
        zIndex: 10,
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-4 border-b shrink-0"
        style={{ borderColor: 'var(--site-border)' }}
      >
        <h2 className="text-lg font-bold" style={{ color: 'var(--site-text)' }}>
          Your Order
          {itemCount > 0 && (
            <span
              className="ml-2 inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 rounded-full text-xs font-bold"
              style={{
                backgroundColor: 'var(--site-brand)',
                color: 'var(--site-brand-text, #fff)',
              }}
            >
              {itemCount}
            </span>
          )}
        </h2>
      </div>

      {/* Content */}
      {items.length === 0 ? (
        /* Empty state */
        <div className="flex-1 flex flex-col items-center justify-center px-5 gap-4">
          <svg
            className="h-16 w-16 opacity-15"
            style={{ color: 'var(--site-text-muted)' }}
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1}
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 0 0-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 0 0-16.536-1.84M7.5 14.25 5.106 5.272M6 20.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm12.75 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" />
          </svg>
          <p className="text-sm font-medium" style={{ color: 'var(--site-text-muted)' }}>
            Your cart is empty
          </p>
          <p className="text-xs text-center" style={{ color: 'var(--site-text-muted)' }}>
            Browse the menu and add items to get started
          </p>
        </div>
      ) : (
        <>
          {/* Scrollable item list */}
          <div className="flex-1 overflow-y-auto px-5">
            {items.map((item) => (
              <CartItemRow key={item.id} item={item} />
            ))}
          </div>

          {/* Footer: subtotal + actions */}
          <div
            className="shrink-0 border-t px-5 py-4 space-y-3"
            style={{ borderColor: 'var(--site-border)' }}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium" style={{ color: 'var(--site-text-muted)' }}>
                Subtotal
              </span>
              <span className="text-xl font-bold" style={{ color: 'var(--site-text)' }}>
                {formatCurrency(subtotal)}
              </span>
            </div>

            <Link
              href={checkoutUrl}
              className="block w-full text-center py-3.5 rounded-xl text-sm font-bold transition-all hover:opacity-90"
              style={{
                backgroundColor: 'var(--site-brand)',
                color: 'var(--site-brand-text, #fff)',
              }}
            >
              Checkout
            </Link>

            <button
              onClick={handleClear}
              className="w-full text-center py-1.5 text-xs font-medium transition-colors hover:opacity-70"
              style={{ color: 'var(--site-text-muted)' }}
            >
              {confirmClear ? 'Tap again to confirm' : 'Clear Cart'}
            </button>
          </div>
        </>
      )}
    </aside>
  )
}
