'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

export default function TimedRentalsPage() {
  const router = useRouter()
  useEffect(() => {
    router.replace('/settings/entertainment')
  }, [router])
  return <div className="min-h-screen bg-gray-950" />
}
