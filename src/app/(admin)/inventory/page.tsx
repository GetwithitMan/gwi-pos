'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { IngredientLibrary } from '@/components/ingredients'
import { useAuthStore } from '@/stores/auth-store'

export default function FoodInventoryPage() {
  const router = useRouter()
  const { employee, isAuthenticated } = useAuthStore()

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login?redirect=/inventory')
    }
  }, [isAuthenticated, router])

  if (!isAuthenticated || !employee?.location?.id) {
    return null
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-slate-800 to-slate-900 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <Link
              href="/orders"
              className="text-sm text-slate-400 hover:text-white mb-1 inline-flex items-center gap-1"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to POS
            </Link>
            <h1 className="text-2xl font-bold text-white">Food Inventory</h1>
          </div>

          {/* Tab navigation between Food and Liquor */}
          <div className="flex gap-2">
            <div className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-medium">
              Food
            </div>
            <Link
              href="/inventory/beverages"
              className="px-4 py-2 rounded-lg bg-slate-700/50 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors font-medium"
            >
              Liquor
            </Link>
          </div>
        </div>
      </div>

      {/* Content - Light background for the IngredientLibrary */}
      <div className="p-6">
        <div className="max-w-7xl mx-auto">
          <IngredientLibrary locationId={employee.location.id} />
        </div>
      </div>
    </div>
  )
}
