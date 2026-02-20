'use client'

import { Button } from '@/components/ui/button'
import { IngredientLibrary } from '@/components/ingredients'
import { useAuthStore } from '@/stores/auth-store'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'

export default function IngredientsPage() {
  const employee = useAuthStore(s => s.employee)
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/ingredients' })

  if (!hydrated || !employee?.location?.id) {
    return null
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Ingredients"
        breadcrumbs={[{ label: 'Menu', href: '/menu' }]}
      />
      <div className="max-w-6xl mx-auto mt-6">
        <IngredientLibrary locationId={employee.location.id} />
      </div>
    </div>
  )
}
