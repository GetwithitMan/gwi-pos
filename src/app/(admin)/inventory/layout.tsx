'use client'

import { AdminNav } from '@/components/admin/AdminNav'
import { InventoryNav } from '@/components/inventory/InventoryNav'
import { usePathname } from 'next/navigation'

export default function InventoryLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const pathname = usePathname()

  // Don't show InventoryNav on the base /inventory page (Quick Stock)
  // as it has its own full-page layout
  const isQuickStockPage = pathname === '/inventory'

  if (isQuickStockPage) {
    // Return children directly - the Quick Stock page has its own AdminNav
    return <>{children}</>
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <AdminNav />
      <div className="lg:ml-64">
        <InventoryNav />
        <div className="p-6">
          {children}
        </div>
      </div>
    </div>
  )
}
