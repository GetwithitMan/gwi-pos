'use client'

/**
 * SiteHeader — Responsive navigation for the public ordering website.
 *
 * Shows venue logo/name, navigation links (driven by capabilities),
 * cart icon, and account icon. Collapses to hamburger on mobile.
 *
 * In QR mode: minimal header — logo + table badge + cart only.
 */

import { useState } from 'react'
import Link from 'next/link'
import { useSiteModeContext } from '@/components/site/SiteShell'
import type { SiteBootstrapResponse } from '@/lib/site-api-schemas'

interface SiteHeaderProps {
  venueName: string
  logoUrl: string | null
  capabilities: SiteBootstrapResponse['capabilities']
}

export function SiteHeader({ venueName, logoUrl, capabilities }: SiteHeaderProps) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const { isQR, tableId } = useSiteModeContext()

  const navLinks: Array<{ href: string; label: string }> = []

  if (capabilities.canBrowseMenu) {
    navLinks.push({ href: '/menu', label: 'Menu' })
  }
  if (capabilities.canReserve) {
    navLinks.push({ href: '/reserve', label: 'Reservations' })
  }
  if (capabilities.canUseGiftCards) {
    navLinks.push({ href: '/gift-cards', label: 'Gift Cards' })
  }

  // ── QR Mode: minimal header ────────────────────────────────────────
  if (isQR) {
    return (
      <header
        className="sticky top-0 z-50 border-b backdrop-blur-md"
        style={{
          backgroundColor: 'rgba(var(--site-brand-rgb), 0.03)',
          borderColor: 'var(--site-border)',
        }}
      >
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-12 items-center justify-between">
            {/* Logo / venue name + table badge */}
            <div className="flex items-center gap-3 shrink-0">
              <Link href="/menu" className="flex items-center gap-2">
                {logoUrl ? (
                  <img src={logoUrl} alt={venueName} className="h-7 w-auto object-contain" />
                ) : (
                  <span
                    className="text-lg font-bold"
                    style={{
                      fontFamily: 'var(--site-heading-font)',
                      fontWeight: 'var(--site-heading-weight)',
                      color: 'var(--site-brand)',
                    }}
                  >
                    {venueName}
                  </span>
                )}
              </Link>
              {tableId && (
                <span
                  className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold"
                  style={{
                    backgroundColor: 'var(--site-brand)',
                    color: 'var(--site-brand-contrast, #fff)',
                  }}
                >
                  Table {tableId}
                </span>
              )}
            </div>

            {/* Cart icon only */}
            {capabilities.isAcceptingOrders && (
              <Link
                href="/checkout"
                className="relative p-2 rounded-lg transition-colors hover:opacity-80"
                style={{ color: 'var(--site-text)' }}
                aria-label="Cart"
              >
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 0 0-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 0 0-16.536-1.84M7.5 14.25 5.106 5.272M6 20.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm12.75 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" />
                </svg>
              </Link>
            )}
          </div>
        </div>
      </header>
    )
  }

  // ── Normal Mode: full header ───────────────────────────────────────
  return (
    <header
      className="sticky top-0 z-50 border-b backdrop-blur-md"
      style={{
        backgroundColor: 'rgba(var(--site-brand-rgb), 0.03)',
        borderColor: 'var(--site-border)',
      }}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Logo / venue name */}
          <Link href="/" className="flex items-center gap-3 shrink-0">
            {logoUrl ? (
              <img src={logoUrl} alt={venueName} className="h-9 w-auto object-contain" />
            ) : (
              <span
                className="text-xl font-bold"
                style={{
                  fontFamily: 'var(--site-heading-font)',
                  fontWeight: 'var(--site-heading-weight)',
                  color: 'var(--site-brand)',
                }}
              >
                {venueName}
              </span>
            )}
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-6">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm font-medium transition-colors hover:opacity-80"
                style={{ color: 'var(--site-text)' }}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          {/* Actions */}
          <div className="flex items-center gap-3">
            {/* Cart icon */}
            {capabilities.isAcceptingOrders && (
              <Link
                href="/checkout"
                className="relative p-2 rounded-lg transition-colors hover:opacity-80"
                style={{ color: 'var(--site-text)' }}
                aria-label="Cart"
              >
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 0 0-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 0 0-16.536-1.84M7.5 14.25 5.106 5.272M6 20.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm12.75 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" />
                </svg>
              </Link>
            )}

            {/* Account icon */}
            {capabilities.canViewOrderHistory && (
              <Link
                href="/account"
                className="p-2 rounded-lg transition-colors hover:opacity-80"
                style={{ color: 'var(--site-text)' }}
                aria-label="Account"
              >
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                </svg>
              </Link>
            )}

            {/* Mobile hamburger */}
            <button
              className="md:hidden p-2 rounded-lg"
              style={{ color: 'var(--site-text)' }}
              onClick={() => setMobileOpen(!mobileOpen)}
              aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileOpen}
            >
              {mobileOpen ? (
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Mobile nav dropdown */}
        {mobileOpen && (
          <nav className="md:hidden border-t py-3 space-y-1" style={{ borderColor: 'var(--site-border)' }}>
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="block px-3 py-2 rounded-lg text-sm font-medium transition-colors hover:opacity-80"
                style={{ color: 'var(--site-text)' }}
                onClick={() => setMobileOpen(false)}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        )}
      </div>
    </header>
  )
}
