import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Customer Display',
  description: 'Customer-Facing Display for GWI POS',
}

export default function CFDLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-black text-white overflow-hidden">
      {children}
    </div>
  )
}
