'use client'

import { useEffect, useCallback, useState } from 'react'
import Link from 'next/link'
import { formatCurrency } from '@/lib/utils'
import { useCartItems, useCartItemCount, useCartSubtotal, useSiteCartStore } from '@/stores/site-cart-store'
import { CartItemRow } from '@/components/site/CartItemRow'

interface CartDrawerProps {
  open: boolean
  onClose: () => void
}

export function CartDrawer({ open, onClose }: CartDrawerProps) {
  const [mounted, setMounted] = useState(false)
  const items = useCartItems()
  const itemCount = useCartItemCount()
  const subtotal = useCartSubtotal()
  const clearCart = useSiteCartStore((s) => s.clearCart)
  const [confirmClear, setConfirmClear] = useState(false)

  useEffect(() => setMounted(true), [])

  // Body scroll lock
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
      return () => {
        document.body.style.overflow = ''
      }
    }
  }, [open])

  // Escape key to close
  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  const handleClear = useCallback(() => {
    if (!confirmClear) {
      setConfirmClear(true)
      return
    }
    clearCart()
    setConfirmClear(false)
    onClose()
  }, [confirmClear, clearCart, onClose])

  // Reset confirmation when drawer closes
  useEffect(() => {
    if (!open) setConfirmClear(false)
  }, [open])

  if (!mounted) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-50 bg-black/50 transition-opacity duration-300 ${
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel — right on desktop, bottom sheet on mobile */}
      <div
        className={`fixed z-50 flex flex-col transition-transform duration-300 ease-out
          /* Mobile: bottom sheet */
          inset-x-0 bottom-0 max-h-[85vh] rounded-t-2xl
          /* Desktop: right panel */
          md:inset-y-0 md:right-0 md:left-auto md:bottom-auto md:w-[420px] md:max-h-none md:rounded-t-none md:rounded-l-2xl
          ${open
            ? 'translate-y-0 md:translate-x-0 md:translate-y-0'
            : 'translate-y-full md:translate-y-0 md:translate-x-full'
          }`}
        style={{ backgroundColor: 'var(--site-bg)' }}
        role="dialog"
        aria-modal="true"
        aria-label="Shopping cart"
      >
        {/* Mobile drag handle */}
        <div className="flex justify-center pt-3 pb-1 md:hidden">
          <div
            className="w-10 h-1 rounded-full opacity-30"
            style={{ backgroundColor: 'var(--site-text)' }}
          />
        </div>

        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 border-b shrink-0"
          style={{ borderColor: 'var(--site-border)' }}
        >
          <h2 className="text-lg font-bold" style={{ color: 'var(--site-text)' }}>
            Your Cart {itemCount > 0 && `(${itemCount} item${itemCount !== 1 ? 's' : ''})`}
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg transition-colors hover:opacity-70"
            style={{ color: 'var(--site-text-muted)' }}
            aria-label="Close cart"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        {items.length === 0 ? (
          /* Empty state */
          <div className="flex-1 flex flex-col items-center justify-center px-5 py-12 gap-4">
            <svg
              className="h-16 w-16 opacity-20"
              style={{ color: 'var(--site-text-muted)' }}
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1}
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 0 0-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 0 0-16.536-1.84M7.5 14.25 5.106 5.272M6 20.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm12.75 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" />
            </svg>
            <p className="text-sm" style={{ color: 'var(--site-text-muted)' }}>
              Your cart is empty
            </p>
            <Link
              href="/menu"
              onClick={onClose}
              className="px-6 py-2.5 rounded-lg text-sm font-semibold transition-colors hover:opacity-90"
              style={{
                backgroundColor: 'var(--site-brand)',
                color: 'var(--site-brand-text)',
              }}
            >
              Browse Menu
            </Link>
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
                <span className="text-lg font-bold" style={{ color: 'var(--site-text)' }}>
                  {formatCurrency(subtotal)}
                </span>
              </div>

              <Link
                href="/checkout"
                onClick={onClose}
                className="block w-full text-center py-3.5 rounded-xl text-sm font-bold transition-colors hover:opacity-90"
                style={{
                  backgroundColor: 'var(--site-brand)',
                  color: 'var(--site-brand-text)',
                }}
              >
                Proceed to Checkout
              </Link>

              <button
                onClick={handleClear}
                className="w-full text-center py-2 text-xs font-medium transition-colors hover:opacity-70"
                style={{ color: 'var(--site-text-muted)' }}
              >
                {confirmClear ? 'Tap again to confirm' : 'Clear Cart'}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  )
}
