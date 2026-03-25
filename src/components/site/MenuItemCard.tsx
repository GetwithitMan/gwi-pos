'use client'

/**
 * MenuItemCard — Item card for the menu browse grid.
 *
 * Shows image (lazy loaded) or letter placeholder, name, description (2-line truncate),
 * price, stock badge. Tap opens the item detail sheet.
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

export function MenuItemCard({ item, onSelect }: MenuItemCardProps) {
  const isSoldOut = item.stockStatus === 'out_of_stock'
  const isLowStock = item.stockStatus === 'low_stock'

  return (
    <div
      onClick={() => !isSoldOut && onSelect(item.id)}
      className={`bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden ${
        isSoldOut
          ? 'opacity-60'
          : 'hover:shadow-md transition-shadow cursor-pointer'
      }`}
      role="button"
      tabIndex={isSoldOut ? -1 : 0}
      onKeyDown={(e) => {
        if (!isSoldOut && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          onSelect(item.id)
        }
      }}
      aria-label={`${item.name} - ${formatPrice(item.price)}${isSoldOut ? ' (Sold Out)' : ''}`}
    >
      {/* Image or letter placeholder */}
      {item.imageUrl ? (
        <div className="relative aspect-[4/3] w-full overflow-hidden bg-gray-100">
          <Image
            src={item.imageUrl}
            alt={item.name}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 50vw, 33vw"
            className="object-cover"
            loading="lazy"
          />
          {isLowStock && (
            <div className="absolute top-2 right-2">
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                Low Stock
              </span>
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
        <div className="relative aspect-[4/3] w-full bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
          <span className="text-5xl font-bold text-gray-200">{item.name.charAt(0)}</span>
          {isLowStock && (
            <div className="absolute top-2 right-2">
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                Low Stock
              </span>
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
      )}

      {/* Content */}
      <div className="p-3">
        <div className="flex items-start justify-between">
          <h3 className="font-semibold text-gray-900 text-sm leading-tight">{item.name}</h3>
          <span className="text-sm font-semibold text-gray-900 ml-2 whitespace-nowrap">
            {formatPrice(item.price)}
          </span>
        </div>
        {item.description && (
          <p className="text-xs text-gray-500 mt-1 line-clamp-2">{item.description}</p>
        )}
      </div>
    </div>
  )
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

export function MenuItemCardSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden animate-pulse">
      <div className="aspect-[4/3] bg-gray-100" />
      <div className="p-3">
        <div className="flex justify-between gap-2 mb-2">
          <div className="h-4 rounded bg-gray-200 w-2/3" />
          <div className="h-4 rounded bg-gray-200 w-12" />
        </div>
        <div className="h-3 rounded bg-gray-100 w-full mb-1" />
        <div className="h-3 rounded bg-gray-100 w-3/4" />
      </div>
    </div>
  )
}
