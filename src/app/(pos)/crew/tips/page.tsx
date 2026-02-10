'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function CrewTipsPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/crew/tip-bank')
  }, [router])

  return null
}
