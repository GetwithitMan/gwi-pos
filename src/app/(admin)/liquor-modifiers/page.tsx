'use client'

import { Suspense } from 'react'
import { useAuthenticationGuard } from '@/hooks/useAuthenticationGuard'
import { LiquorModifiers } from '@/components/liquor/LiquorModifiers'

function LiquorModifiersContent() {
  const hydrated = useAuthenticationGuard({ redirectUrl: '/login?redirect=/liquor-modifiers' })
  if (!hydrated) return null
  return <LiquorModifiers />
}

export default function LiquorModifiersPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen">Loading...</div>}>
      <LiquorModifiersContent />
    </Suspense>
  )
}
