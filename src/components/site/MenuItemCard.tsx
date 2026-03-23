'use client'

/**
 * MenuItemCard — Item card for the menu browse grid.
 *
 * Shows image (lazy loaded), name, description (2-line truncate), price,
 * stock badge, and "Add" button. Tap opens the item detail sheet.
 */

import Image from 'next/image'

export interface MenuItemData {
  id: string
  name: string
  description: string | null
  price: number
  imageUrl: string | null
  stockStatus: 'in_stock' | 'low_stock' | 'out_of_stock'
  itemType: string
}

interface MenuItemCardProps {
  item: MenuItemData
  onSelect: (itemId: string) => void
}

function formatPrice(cents: number): string {
  return `$${cents.toFixed(2)}`
}

function StockBadge({ status }: { status: string }) {
  if (status === 'in_stock') return null

  const isLow = status === 'low_stock'
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
      style={{
        backgroundColor: isLow ? 'rgba(234, 179, 8, 0.1)' : 'rgba(239, 68, 68, 0.1)',
        color: isLow ? '#b45309' : '#dc2626',
      }}
    >
      {isLow ? 'Low Stock' : 'Sold Out'}
    </span>
  )
}

export function MenuItemCard({ item, onSelect }: MenuItemCardProps) {
  const isSoldOut = item.stockStatus === 'out_of_stock'

  return (
    <button
      onClick={() => !isSoldOut && onSelect(item.id)}
      disabled={isSoldOut}
      className="w-full text-left group transition-shadow hover:shadow-lg"
      style={{
        borderRadius: 'var(--site-border-radius)',
        border: '1px solid var(--site-border)',
        backgroundColor: 'var(--site-bg)',
        boxShadow: 'var(--site-shadow-sm)',
        opacity: isSoldOut ? 0.6 : 1,
        overflow: 'hidden',
      }}
      aria-label={`${item.name} - ${formatPrice(item.price)}${isSoldOut ? ' (Sold Out)' : ''}`}
    >
      {/* Image */}
      {item.imageUrl ? (
        <div className="relative aspect-[4/3] overflow-hidden" style={{ backgroundColor: 'var(--site-bg-secondary)' }}>
          <Image
            src={item.imageUrl}
            alt={item.name}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className="object-cover transition-transform group-hover:scale-105"
            loading="lazy"
          />
          {!isSoldOut && item.stockStatus !== 'in_stock' && (
            <div className="absolute top-2 right-2">
              <StockBadge status={item.stockStatus} />
            </div>
          )}
          {isSoldOut && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/30">
              <span className="text-white text-sm font-semibold px-3 py-1 rounded-full bg-black/50">
                Sold Out
              </span>
            </div>
          )}
        </div>
      ) : (
        <div
          className="aspect-[4/3] flex items-center justify-center"
          style={{ backgroundColor: 'var(--site-bg-secondary)' }}
        >
          <svg
            className="h-12 w-12"
            style={{ color: 'var(--site-border)' }}
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={0.75}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z"
            />
          </svg>
          {isSoldOut && (
            <div className="absolute inset-0 flex items-center justify-center">
              <StockBadge status="out_of_stock" />
            </div>
          )}
        </div>
      )}

      {/* Content */}
      <div style={{ padding: 'var(--site-card-padding)' }}>
        <div className="flex items-start justify-between gap-2 mb-1">
          <h3
            className="text-base font-semibold leading-tight"
            style={{
              fontFamily: 'var(--site-heading-font)',
              color: 'var(--site-text)',
            }}
          >
            {item.name}
          </h3>
          <span
            className="shrink-0 text-base font-semibold"
            style={{ color: 'var(--site-brand)' }}
          >
            {formatPrice(item.price)}
          </span>
        </div>

        {item.description && (
          <p
            className="text-sm leading-snug line-clamp-2 mb-3"
            style={{ color: 'var(--site-text-muted)' }}
          >
            {item.description}
          </p>
        )}

        {!isSoldOut && (
          <div
            className="mt-auto flex items-center justify-center py-2 text-sm font-medium transition-opacity group-hover:opacity-90"
            style={{
              backgroundColor: 'var(--site-brand)',
              color: 'var(--site-text-on-brand)',
              borderRadius: 'var(--site-btn-radius)',
            }}
          >
            Add
          </div>
        )}
      </div>
    </button>
  )
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

export function MenuItemCardSkeleton() {
  return (
    <div
      className="animate-pulse overflow-hidden"
      style={{
        borderRadius: 'var(--site-border-radius)',
        border: '1px solid var(--site-border)',
        backgroundColor: 'var(--site-bg)',
      }}
    >
      <div className="aspect-[4/3]" style={{ backgroundColor: 'var(--site-bg-secondary)' }} />
      <div style={{ padding: 'var(--site-card-padding)' }}>
        <div className="flex justify-between gap-2 mb-2">
          <div className="h-5 rounded w-2/3" style={{ backgroundColor: 'var(--site-bg-secondary)' }} />
          <div className="h-5 rounded w-12" style={{ backgroundColor: 'var(--site-bg-secondary)' }} />
        </div>
        <div className="h-4 rounded w-full mb-1" style={{ backgroundColor: 'var(--site-bg-secondary)' }} />
        <div className="h-4 rounded w-3/4 mb-3" style={{ backgroundColor: 'var(--site-bg-secondary)' }} />
        <div className="h-9 rounded" style={{ backgroundColor: 'var(--site-bg-secondary)' }} />
      </div>
    </div>
  )
}
