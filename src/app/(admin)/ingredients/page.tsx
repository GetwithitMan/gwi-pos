'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { IngredientLibrary } from '@/components/ingredients'
import { useAuthStore } from '@/stores/auth-store'
import { AdminPageHeader } from '@/components/admin/AdminPageHeader'
import { AdminSubNav, menuSubNav } from '@/components/admin/AdminSubNav'

export default function IngredientsPage() {
  const router = useRouter()
  const { employee, isAuthenticated } = useAuthStore()

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login?redirect=/ingredients')
    }
  }, [isAuthenticated, router])

  if (!isAuthenticated || !employee?.location?.id) {
    return null
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <AdminPageHeader
        title="Ingredients"
        breadcrumbs={[{ label: 'Menu', href: '/menu' }]}
      />
      <AdminSubNav items={menuSubNav} basePath="/menu" />

      <div className="max-w-6xl mx-auto mt-6">
        <IngredientLibrary locationId={employee.location.id} />
      </div>
    </div>
  )
}
