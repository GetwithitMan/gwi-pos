import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'GWI POS - Bartender',
  description: 'Bartender mobile tab management',
}

export default function MobileLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {children}
    </div>
  )
}
