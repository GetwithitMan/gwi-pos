import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Online Order',
  description: 'Order online for pickup',
}

export default function OnlineOrderLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
