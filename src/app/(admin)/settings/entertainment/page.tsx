'use client'

import { Suspense } from 'react'
import { TimedRentalsContent } from '../../timed-rentals/page'

export default function EntertainmentPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-950" />}>
      <TimedRentalsContent />
    </Suspense>
  )
}
