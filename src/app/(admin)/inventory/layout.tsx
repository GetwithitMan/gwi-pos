'use client'

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
    return <>{children}</>
  }

  return (
    <>
      <InventoryNav />
      <div className="p-6">
        {children}
      </div>
    </>
  )
}
