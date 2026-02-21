'use client'

import { useState, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { hasPermission, isAdmin, PERMISSIONS } from '@/lib/auth-utils'
import { useAuthStore } from '@/stores/auth-store'

const CLOUD_PARENT_DOMAINS = [
  '.ordercontrolcenter.com',
  '.barpos.restaurant',
]

const MISSION_CONTROL_URL = 'https://app.thepasspos.com'

interface SettingsNavItem {
  name: string
  href: string
  subItems?: { name: string; href: string }[]
}

interface SettingsSection {
  title: string
  icon: string
  permission?: string | null
  items: SettingsNavItem[]
  adminItems?: SettingsNavItem[]
}

const settingsSections: SettingsSection[] = [
  {
    title: 'Venue',
    icon: '🏢',
    permission: PERMISSIONS.SETTINGS_VENUE,
    items: [
      { name: 'Business Info', href: '/settings/venue' },
      { name: 'General', href: '/settings' },
      { name: 'Tax Rules', href: '/settings/tax-rules' },
      { name: 'Order Types', href: '/settings/order-types' },
      { name: 'Order Numbering', href: '/settings/orders' },
    ],
  },
  {
    title: 'Menu',
    icon: '🍔',
    permission: PERMISSIONS.SETTINGS_MENU,
    items: [
      { name: 'Menu Builder', href: '/settings/menu' },
      { name: 'Ingredients', href: '/settings/ingredients' },
      { name: 'Combos', href: '/settings/combos' },
      { name: 'Liquor Builder', href: '/settings/liquor-builder' },
      { name: 'Pizza', href: '/settings/pizza' },
      { name: 'Discounts', href: '/settings/discounts' },
      { name: 'Happy Hour', href: '/settings/happy-hour' },
    ],
  },
  {
    title: 'Online Ordering',
    icon: '🌐',
    permission: PERMISSIONS.SETTINGS_VENUE,
    items: [
      { name: 'Overview', href: '/settings/online-ordering' },
      { name: 'Online Menu', href: '/settings/online-ordering/menu' },
      { name: 'Order Config', href: '/settings/online-ordering/orders' },
      { name: 'Hours', href: '/settings/online-ordering/hours' },
      { name: 'Payments', href: '/settings/online-ordering/payments' },
      { name: 'Notifications', href: '/settings/online-ordering/notifications' },
    ],
  },
  {
    title: 'Inventory',
    icon: '📦',
    permission: PERMISSIONS.SETTINGS_INVENTORY,
    items: [
      { name: 'Stock Adjust', href: '/settings/inventory' },
      { name: 'Items', href: '/settings/inventory/items' },
      { name: 'Beverages', href: '/settings/inventory/beverages' },
      { name: 'Daily Counts', href: '/settings/inventory/daily-prep-counts' },
      { name: 'Counts', href: '/settings/inventory/counts' },
      { name: 'Waste Log', href: '/settings/inventory/waste' },
      { name: 'Transactions', href: '/settings/inventory/transactions' },
      { name: 'Vendors', href: '/settings/inventory/vendors' },
      { name: 'Config', href: '/settings/inventory/config' },
    ],
  },
  {
    title: 'Floor & Tables',
    icon: '🪑',
    permission: PERMISSIONS.SETTINGS_FLOOR,
    items: [
      { name: 'Floor Plan Editor', href: '/settings/floor-plan' },
      { name: 'Reservations', href: '/settings/reservations' },
      { name: 'Entertainment', href: '/settings/entertainment' },
      { name: 'Events', href: '/settings/events' },
    ],
  },
  {
    title: 'Customers',
    icon: '👥',
    permission: PERMISSIONS.SETTINGS_CUSTOMERS,
    items: [
      { name: 'Customer List', href: '/settings/customers' },
      { name: 'Gift Cards', href: '/settings/gift-cards' },
      { name: 'House Accounts', href: '/settings/house-accounts' },
      { name: 'Coupons', href: '/settings/coupons' },
    ],
  },
  {
    title: 'Team',
    icon: '👔',
    permission: PERMISSIONS.SETTINGS_TEAM,
    items: [
      { name: 'Employees', href: '/settings/employees' },
      { name: 'Roles & Permissions', href: '/settings/roles' },
      { name: 'Scheduling', href: '/settings/scheduling' },
      { name: 'Payroll', href: '/settings/payroll' },
    ],
  },
  {
    title: 'Tips',
    icon: '💰',
    permission: PERMISSIONS.SETTINGS_TIPS,
    items: [
      { name: 'Tip Settings', href: '/settings/tips' },
      { name: 'Tip-Out Rules', href: '/settings/tip-outs' },
      { name: 'Tip Groups', href: '/settings/tip-groups' },
      { name: 'Tip Payouts', href: '/settings/tip-payouts' },
    ],
  },
  {
    title: 'Payments',
    icon: '💳',
    permission: PERMISSIONS.SETTINGS_PAYMENTS,
    items: [
      { name: 'Payment Config', href: '/settings/payments' },
      { name: 'Receipts', href: '/settings/receipts' },
      { name: 'Tabs & Pre-Auth', href: '/settings/tabs' },
    ],
  },
  {
    title: 'Reports',
    icon: '📊',
    permission: null,
    items: [
      { name: 'My Shift', href: '/settings/reports/shift' },
      { name: 'My Commissions', href: '/settings/reports/commission' },
    ],
    adminItems: [
      { name: 'Reports Hub', href: '/settings/reports' },
      { name: 'Daily Summary', href: '/settings/reports/daily' },
      { name: 'Sales', href: '/settings/reports/sales' },
      { name: 'Product Mix', href: '/settings/reports/product-mix' },
      { name: 'Order History', href: '/settings/reports/order-history' },
      { name: 'Tips', href: '/settings/reports/tips' },
      { name: 'Employee Reports', href: '/settings/reports/employees' },
      { name: 'Voids & Comps', href: '/settings/reports/voids' },
      { name: 'Reservations', href: '/settings/reports/reservations' },
      { name: 'Coupons', href: '/settings/reports/coupons' },
      { name: 'Liquor', href: '/settings/reports/liquor' },
      { name: 'Payroll', href: '/settings/reports/payroll' },
    ],
  },
  {
    title: 'Hardware',
    icon: '🔧',
    permission: PERMISSIONS.SETTINGS_HARDWARE,
    items: [
      { name: 'Overview', href: '/settings/hardware' },
      { name: 'Printers', href: '/settings/hardware/printers' },
      { name: 'KDS Screens', href: '/settings/hardware/kds-screens' },
      { name: 'Print Routing', href: '/settings/hardware/routing' },
      { name: 'Terminals', href: '/settings/hardware/terminals' },
      { name: 'Payment Readers', href: '/settings/hardware/payment-readers' },
      { name: 'Prep Stations', href: '/settings/hardware/prep-stations' },
    ],
  },
  {
    title: 'Security',
    icon: '🔒',
    permission: PERMISSIONS.SETTINGS_SECURITY,
    items: [
      { name: 'PIN & Lockout', href: '/settings/security' },
    ],
  },
  {
    title: 'Integrations',
    icon: '🔗',
    permission: PERMISSIONS.SETTINGS_INTEGRATIONS,
    items: [
      { name: 'SMS (Twilio)', href: '/settings/integrations/sms' },
      { name: 'Email (Resend)', href: '/settings/integrations/email' },
      { name: 'Slack', href: '/settings/integrations/slack' },
    ],
  },
  {
    title: 'Monitoring',
    icon: '🖥️',
    permission: PERMISSIONS.SETTINGS_MONITORING,
    items: [
      { name: 'Dashboard', href: '/settings/monitoring' },
      { name: 'Error Logs', href: '/settings/monitoring/errors' },
    ],
  },
]

export function SettingsNav() {
  const pathname = usePathname()
  const employee = useAuthStore(s => s.employee)
  const logout = useAuthStore(s => s.logout)
  const permissions = employee?.permissions || []
  const userIsAdmin = isAdmin(permissions)

  const isCloud = useMemo(() => {
    if (typeof window === 'undefined') return false
    return CLOUD_PARENT_DOMAINS.some((d) => window.location.hostname.endsWith(d))
  }, [])

  const handleCloudSignOut = useCallback(async () => {
    try {
      await fetch('/api/auth/cloud-session', { method: 'DELETE' })
    } catch {
      // Cookie clear failed — redirect anyway
    }
    logout()
    window.location.href = MISSION_CONTROL_URL
  }, [logout])

  // Auto-expand section that contains the active page
  const getActiveSection = () => {
    for (const section of settingsSections) {
      const allItems = [...section.items, ...(section.adminItems || [])]
      for (const item of allItems) {
        if (pathname === item.href || pathname.startsWith(item.href + '/')) {
          return section.title
        }
      }
    }
    return 'Venue' // default
  }

  const [expandedSections, setExpandedSections] = useState<string[]>([getActiveSection()])

  const canView = (permission?: string | null) => {
    if (!permission) return true
    return hasPermission(permissions, permission)
  }

  const filteredSections = settingsSections
    .map((section) => {
      const visibleItems = section.items
      const adminItems = userIsAdmin && section.adminItems ? section.adminItems : []
      return { ...section, items: [...visibleItems, ...adminItems] }
    })
    .filter((section) => {
      const hasAccess = section.permission === null || canView(section.permission)
      return section.items.length > 0 && hasAccess
    })

  const toggleSection = (title: string) => {
    setExpandedSections((prev) =>
      prev.includes(title) ? prev.filter((s) => s !== title) : [...prev, title]
    )
  }

  const isActive = (href: string) => {
    // Exact match for /settings (General page)
    if (href === '/settings') return pathname === '/settings'
    return pathname === href || pathname.startsWith(href + '/')
  }

  return (
    <nav className="w-56 bg-white border-r min-h-screen overflow-y-auto flex-shrink-0">
      {/* Header */}
      <div className="px-4 py-3 border-b bg-gray-50">
        {isCloud ? (
          <a
            href={MISSION_CONTROL_URL}
            className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-1"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Mission Control
          </a>
        ) : (
          <Link href="/orders" className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to POS
          </Link>
        )}
        <h2 className="text-sm font-bold text-gray-900">Settings</h2>
      </div>

      {/* Sections */}
      <div className="py-1">
        {filteredSections.map((section) => {
          const isExpanded = expandedSections.includes(section.title)
          const hasSectionActive = section.items.some((item) => isActive(item.href))

          return (
            <div key={section.title}>
              {/* Section Header */}
              <button
                onClick={() => toggleSection(section.title)}
                className={`w-full px-3 py-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wider transition-colors ${
                  hasSectionActive
                    ? 'text-blue-700 bg-blue-50/50'
                    : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <span>{section.icon}</span>
                  <span>{section.title}</span>
                </span>
                <svg
                  className={`w-3.5 h-3.5 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Section Items */}
              {isExpanded && (
                <div className="pb-1">
                  {section.items.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`block pl-8 pr-3 py-1.5 text-sm transition-colors ${
                        isActive(item.href)
                          ? 'text-blue-700 bg-blue-50 font-medium border-r-2 border-blue-600'
                          : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                      }`}
                    >
                      {item.name}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Cloud mode: Sign Out */}
      {isCloud && (
        <div className="mt-auto px-4 py-3 border-t">
          <button
            onClick={handleCloudSignOut}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Sign Out
          </button>
        </div>
      )}
    </nav>
  )
}
