'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const inventoryTabs = [
  { name: 'Quick Adjust', href: '/inventory/quick-adjust', icon: '⚡' },
  { name: 'Items', href: '/inventory/items' },
  { name: 'Beverages', href: '/inventory/beverages' },
  { name: 'Daily Counts', href: '/inventory/daily-prep-counts' },
  { name: 'Counts', href: '/inventory/counts' },
  { name: 'Vendors', href: '/inventory/vendors' },
  { name: 'Transactions', href: '/inventory/transactions' },
  { name: 'Waste', href: '/inventory/waste' },
  { name: 'Settings', href: '/inventory/settings' },
]

export function InventoryNav() {
  const pathname = usePathname()

  // Highlight "Ingredients" when on the base /inventory route
  const isIngredients = pathname === '/inventory'

  return (
    <div className="border-b bg-white sticky top-0 z-10">
      <div className="flex items-center gap-1 px-4 overflow-x-auto">
        {/* Ingredients link - the main food inventory page */}
        <Link
          href="/inventory"
          className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
            isIngredients
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
          }`}
        >
          Ingredients
        </Link>

        <div className="w-px h-6 bg-gray-200 mx-2" />

        {inventoryTabs.map((tab) => {
          const isActive = pathname === tab.href || pathname?.startsWith(tab.href + '/')
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors flex items-center gap-1.5 ${
                isActive
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
              }`}
            >
              {'icon' in tab && <span>{tab.icon}</span>}
              {tab.name}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
