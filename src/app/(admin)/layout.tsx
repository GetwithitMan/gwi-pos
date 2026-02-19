'use client'

import { useAuthGuard } from '@/hooks/useAuthGuard'

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { isReady } = useAuthGuard()

  if (!isReady) return null

  return <>{children}</>
}
