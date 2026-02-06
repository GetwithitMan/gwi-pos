'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

interface SubNavItem {
  label: string
  href: string
  permission?: string
}

interface AdminSubNavProps {
  items: SubNavItem[]
  basePath: string
}

export function AdminSubNav({ items, basePath }: AdminSubNavProps) {
  const pathname = usePathname()

  // Check if current path matches the item href
  // For base paths like /inventory, also match /inventory exactly
  const isActive = (href: string) => {
    if (href === basePath) {
      return pathname === href
    }
    return pathname === href || pathname.startsWith(href + '/')
  }

  return (
    <div className="flex gap-1 p-1 bg-gray-100 rounded-lg mb-6 overflow-x-auto">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={`px-4 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
            isActive(item.href)
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
          }`}
        >
          {item.label}
        </Link>
      ))}
    </div>
  )
}

// Pre-defined sub-nav configurations for common sections
export const inventorySubNav: SubNavItem[] = [
  { label: 'Ingredients', href: '/inventory' },
  { label: '⚡ Quick Adjust', href: '/inventory/quick-adjust' },
  { label: 'Items', href: '/inventory/items' },
  { label: 'Beverages', href: '/inventory/beverages' },
  { label: 'Daily Counts', href: '/inventory/daily-prep-counts' },
  { label: 'Counts', href: '/inventory/counts' },
  { label: 'Waste', href: '/inventory/waste' },
  { label: 'Transactions', href: '/inventory/transactions' },
  { label: 'Vendors', href: '/inventory/vendors' },
  { label: 'Settings', href: '/inventory/settings' },
]

export const hardwareSubNav: SubNavItem[] = [
  { label: 'Overview', href: '/settings/hardware' },
  { label: 'Printers', href: '/settings/hardware/printers' },
  { label: 'KDS Screens', href: '/settings/hardware/kds-screens' },
  { label: 'Print Routing', href: '/settings/hardware/routing' },
  { label: 'Terminals', href: '/settings/hardware/terminals' },
  { label: 'Payment Readers', href: '/settings/hardware/payment-readers' },
]

export const reportsSubNav: SubNavItem[] = [
  { label: 'Hub', href: '/reports' },
  { label: 'Daily', href: '/reports/daily' },
  { label: 'Shift', href: '/reports/shift' },
  { label: 'Sales', href: '/reports/sales' },
  { label: 'Product Mix', href: '/reports/product-mix' },
  { label: 'Tips', href: '/reports/tips' },
  { label: 'Employees', href: '/reports/employees' },
]

export const settingsSubNav: SubNavItem[] = [
  { label: 'General', href: '/settings' },
  { label: 'Order Types', href: '/settings/order-types' },
  { label: 'Tax Rules', href: '/tax-rules' },
  { label: 'Tip-Out Rules', href: '/settings/tip-outs' },
  { label: 'Daily Counts', href: '/settings/daily-counts' },
  { label: 'Hardware', href: '/settings/hardware' },
]

export const menuSubNav: SubNavItem[] = [
  { label: 'Menu Items', href: '/menu' },
  { label: 'Ingredients', href: '/ingredients' },
  { label: 'Combos', href: '/combos' },
  { label: 'Discounts', href: '/discounts' },
  { label: 'Liquor Builder', href: '/liquor-builder' },
  { label: 'Pizza', href: '/pizza' },
]

export const customersSubNav: SubNavItem[] = [
  { label: 'Customers', href: '/customers' },
  { label: 'Gift Cards', href: '/gift-cards' },
  { label: 'House Accounts', href: '/house-accounts' },
  { label: 'Coupons', href: '/coupons' },
]

export const teamSubNav: SubNavItem[] = [
  { label: 'Events', href: '/events' },
  { label: 'Employees', href: '/employees' },
  { label: 'Roles', href: '/roles' },
  { label: 'Scheduling', href: '/scheduling' },
  { label: 'Payroll', href: '/payroll' },
]

export const floorSubNav: SubNavItem[] = [
  { label: 'Floor Plan', href: '/floorplan/editor' },
  { label: 'Reservations', href: '/reservations' },
]
