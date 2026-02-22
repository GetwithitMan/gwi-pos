'use client'

import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { LiquorInventory } from '@/components/liquor/LiquorInventory'

export default function LiquorInventoryPage() {
  const employee = useAuthStore(s => s.employee)
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/liquor-inventory' })

  if (!hydrated || !employee?.location?.id) {
    return null
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Liquor Inventory"
        breadcrumbs={[{ label: 'Liquor Builder', href: '/liquor-builder' }]}
      />
      <div className="max-w-6xl mx-auto mt-6">
        <LiquorInventory locationId={employee.location.id} />
      </div>
    </div>
  )
}
