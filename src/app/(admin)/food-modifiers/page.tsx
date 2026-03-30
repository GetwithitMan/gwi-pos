'use client'

import { Suspense } from 'react'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { FoodModifiers } from '@/components/food/FoodModifiers'

function FoodModifiersContent() {
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/food-modifiers' })
  if (!hydrated) return null
  return <FoodModifiers />
}

export default function FoodModifiersPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen">Loading...</div>}>
      <FoodModifiersContent />
    </Suspense>
  )
}
