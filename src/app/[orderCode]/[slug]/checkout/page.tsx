/**
 * Guest Checkout Page for Online Ordering
 *
 * No authentication required — customers check out as guests.
 * Collects name, phone, email inline. No Clerk, no account needed.
 *
 * URL: ordercontrolcenter.com/{orderCode}/{slug}/checkout
 */

import { headers } from 'next/headers'
import { notFound } from 'next/navigation'
import { getDbForVenue } from '@/lib/db'
import { mergeWithDefaults } from '@/lib/settings'
import { CheckoutClient } from './client'
import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Checkout',
}

interface CheckoutConfig {
  venueName: string
  venueAddress: string | null
  prepTime: number
  tipSuggestions: number[]
  defaultTip: number
  requireZip: boolean
  allowSpecialRequests: boolean
  surchargeType: string | null
  surchargeAmount: number
  surchargeName: string
  deliveryEnabled: boolean
  slug: string
}

export default async function CheckoutPage({ params }: { params: Promise<{ orderCode: string; slug: string }> }) {
  const { slug } = await params
  const headersList = await headers()
  const venueSlug = headersList.get('x-venue-slug') || slug

  let config: CheckoutConfig | null = null

  try {
    const venueDb = await getDbForVenue(venueSlug)
    const location = await venueDb.location.findFirst({
      where: { isActive: true, deletedAt: null },
      select: { id: true, name: true, address: true, settings: true },
    })

    if (!location) notFound()

    const settings = mergeWithDefaults(location.settings as Record<string, unknown>)
    const online = settings.onlineOrdering

    config = {
      venueName: location.name,
      venueAddress: location.address,
      prepTime: online?.prepTime ?? 20,
      tipSuggestions: online?.tipSuggestions ?? [15, 18, 20],
      defaultTip: online?.defaultTip ?? 18,
      requireZip: online?.requireZip ?? false,
      allowSpecialRequests: online?.allowSpecialRequests ?? true,
      surchargeType: online?.surchargeType ?? null,
      surchargeAmount: online?.surchargeAmount ?? 0,
      surchargeName: online?.surchargeName ?? 'Online Order Fee',
      deliveryEnabled: settings.delivery?.enabled ?? false,
      slug: venueSlug,
    }
  } catch {
    notFound()
  }

  if (!config) notFound()

  return <CheckoutClient config={config} />
}
