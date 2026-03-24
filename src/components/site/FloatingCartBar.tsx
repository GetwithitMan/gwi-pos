'use client'

import { useState, useEffect } from 'react'
import { formatCurrency } from '@/lib/utils'
import { useCartItemCount, useCartSubtotal } from '@/stores/site-cart-store'
import { CartDrawer } from '@/components/site/CartDrawer'

export function FloatingCartBar() {
  const [mounted, setMounted] = useState(false)
  const itemCount = useCartItemCount()
  const subtotal = useCartSubtotal()
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => setMounted(true), [])

  if (!mounted) return null

  const visible = itemCount > 0

  return (
    <>
      {/* Floating bar */}
      <div
        className={`fixed bottom-0 inset-x-0 z-40 transition-transform duration-300 ease-out ${
          visible ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        <div className="mx-auto max-w-7xl px-4 pb-[env(safe-area-inset-bottom)]">
          <button
            onClick={() => setDrawerOpen(true)}
            className="w-full flex items-center justify-between px-5 h-14 rounded-t-xl shadow-lg transition-colors hover:opacity-95"
            style={{
              backgroundColor: 'var(--site-brand)',
              color: 'var(--site-brand-text)',
            }}
            aria-label={`View cart, ${itemCount} items, ${formatCurrency(subtotal)}`}
          >
            <div className="flex items-center gap-3">
              {/* Cart icon with badge */}
              <div className="relative">
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 0 0-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 0 0-16.536-1.84M7.5 14.25 5.106 5.272M6 20.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm12.75 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" />
                </svg>
                <span
                  className="absolute -top-1.5 -right-1.5 flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold"
                  style={{
                    backgroundColor: 'var(--site-brand-text)',
                    color: 'var(--site-brand)',
                  }}
                >
                  {itemCount}
                </span>
              </div>
              <span className="text-sm font-semibold">View Cart</span>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm font-bold">{formatCurrency(subtotal)}</span>
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
              </svg>
            </div>
          </button>
        </div>
      </div>

      {/* Cart drawer */}
      <CartDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </>
  )
}
