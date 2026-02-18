'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { BeverageInventoryView } from '@/components/inventory/BeverageInventoryView'
import { useAuthStore } from '@/stores/auth-store'

export default function BeverageInventoryPage() {
  const router = useRouter()
  const employee = useAuthStore(s => s.employee)
  const isAuthenticated = useAuthStore(s => s.isAuthenticated)

  useEffect(() => {
    if (!isAuthenticated) {
      router.push('/login?redirect=/inventory/beverages')
    }
  }, [isAuthenticated, router])

  if (!isAuthenticated || !employee?.location?.id) {
    return null
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header with navigation */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <Link
              href="/orders"
              className="text-sm text-slate-400 hover:text-white mb-2 inline-flex items-center gap-1"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to POS
            </Link>
            <h1 className="text-2xl font-bold text-white">Liquor Inventory</h1>
            <p className="text-slate-400 text-sm mt-1">Track bottles, pours, and stock levels</p>
          </div>

          {/* Tab navigation between Food and Liquor */}
          <div className="flex gap-2">
            <Link
              href="/inventory"
              className="px-4 py-2 rounded-lg bg-slate-700/50 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors font-medium"
            >
              Food
            </Link>
            <div className="px-4 py-2 rounded-lg bg-amber-600 text-white font-medium">
              Liquor
            </div>
          </div>
        </div>

        {/* Quick action */}
        <div className="flex justify-end mb-4">
          <Link href="/liquor-builder">
            <Button className="bg-blue-600 hover:bg-blue-700 text-white">
              Open Liquor Builder
            </Button>
          </Link>
        </div>

        {/* Beverage Inventory */}
        <BeverageInventoryView locationId={employee.location.id} />
      </div>
    </div>
  )
}
