/**
 * Site Bootstrap — data loading for the public ordering website.
 *
 * getSiteBootstrapData(slug)  → full bootstrap payload for initial site load
 * getSiteCapabilities(slug)   → derived capability flags from settings
 */

import type { PrismaClient } from '@/generated/prisma/client'
import { mergeWithDefaults } from '@/lib/settings'
import type { SiteBootstrapResponse } from '@/lib/site-api-schemas'
import type { LocationSettings, VenuePortalSettings } from '@/lib/settings/types'

// ── Capability Derivation ───────────────────────────────────────────────────

interface CapabilityInput {
  settings: LocationSettings
  portal: VenuePortalSettings
  hasOnlineItems: boolean
  hasGiftCards: boolean
  hasActiveCoupons: boolean
  hasDeliveryZones: boolean
  isCurrentlyOpen: boolean
}

export function deriveSiteCapabilities(input: CapabilityInput): SiteBootstrapResponse['capabilities'] {
  const { settings, portal, hasOnlineItems, hasGiftCards, hasActiveCoupons, hasDeliveryZones, isCurrentlyOpen } = input

  return {
    canBrowseMenu: portal.siteEnabled && hasOnlineItems,
    canPlacePickupOrder: portal.siteEnabled && hasOnlineItems,
    canPlaceDeliveryOrder: portal.siteEnabled && hasOnlineItems && (settings.delivery?.enabled ?? false) && hasDeliveryZones,
    canPlaceDineInOrder: portal.siteEnabled && (settings.qrOrdering?.enabled ?? false),
    canReserve: settings.reservationSettings?.allowOnlineBooking ?? false,
    canUseRewards: portal.rewardsPageEnabled,
    canViewOrderHistory: portal.orderHistoryEnabled,
    canUseGiftCards: hasGiftCards,
    canUseCoupons: hasActiveCoupons,
    isCurrentlyOpen,
    isAcceptingOrders: portal.siteEnabled && isCurrentlyOpen && hasOnlineItems,
  }
}

// ── Business Hours Check ────────────────────────────────────────────────────

function checkIsCurrentlyOpen(hours: SiteBootstrapResponse['hours'], timezone: string): boolean {
  if (hours.length === 0) return true // No hours configured = always open

  const now = new Date()
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
  const parts = formatter.formatToParts(now)
  const dayIndex = now.toLocaleDateString('en-US', { timeZone: timezone, weekday: 'short' })
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  const currentDay = dayMap[dayIndex] ?? now.getDay()

  const todayHours = hours.find(h => h.day === currentDay)
  if (!todayHours || todayHours.closed) return false

  const hourPart = parts.find(p => p.type === 'hour')?.value ?? '00'
  const minutePart = parts.find(p => p.type === 'minute')?.value ?? '00'
  const currentMinutes = parseInt(hourPart) * 60 + parseInt(minutePart)

  const [openH, openM] = todayHours.open.split(':').map(Number)
  const [closeH, closeM] = todayHours.close.split(':').map(Number)
  const openMinutes = openH * 60 + openM
  let closeMinutes = closeH * 60 + closeM

  // Handle overnight hours (e.g., open 18:00, close 02:00)
  if (closeMinutes <= openMinutes) {
    closeMinutes += 24 * 60
    return currentMinutes >= openMinutes || currentMinutes < (closeMinutes - 24 * 60)
  }

  return currentMinutes >= openMinutes && currentMinutes < closeMinutes
}

// ── Main Bootstrap Loader ───────────────────────────────────────────────────

export async function getSiteBootstrapData(
  db: PrismaClient,
  locationId: string,
  location: { name: string; address: string | null; phone: string | null; timezone: string; settings: unknown },
): Promise<SiteBootstrapResponse> {
  const settings = mergeWithDefaults(location.settings as Partial<LocationSettings> | null)
  const portal = settings.venuePortal ?? {
    enabled: false,
    slug: '',
    brandColor: '#3B82F6',
    rewardsPageEnabled: false,
    orderHistoryEnabled: false,
    cakeOrderingOnPortal: false,
    siteEnabled: false,
    themePreset: 'modern' as const,
    showHero: true,
    showAbout: true,
    showHours: true,
    showFeaturedItems: true,
    showReservations: false,
    showContact: true,
    showRewardsOnSite: false,
    showGiftCards: false,
    aboutText: '',
    socialLinks: {},
    featuredItemSource: 'first_n' as const,
  }

  // ── Parallel data queries ───────────────────────────────────────────────
  const [onlineItemCount, giftCardCount, activeCouponCount, deliveryZoneCount] = await Promise.all([
    // eslint-disable-next-line no-restricted-syntax -- aggregate count on injected PrismaClient, not global db
    db.menuItem.count({
      where: { locationId, showOnline: true, deletedAt: null, isActive: true },
    }),
    db.giftCard.count({
      where: { locationId, status: 'active' },
    }).catch(() => 0), // GiftCard table may not exist yet
    db.coupon.count({
      where: {
        locationId,
        isActive: true,
        deletedAt: null,
        validFrom: { lte: new Date() },
        OR: [
          { validUntil: null },
          { validUntil: { gte: new Date() } },
        ],
      },
    }).catch(() => 0),
    // DeliveryZone model not yet in schema — stub until migration adds it
    Promise.resolve(0),
  ])

  // ── Hours (from reservation settings or empty) ──────────────────────────
  // Hours are not yet stored as a dedicated model; return empty array.
  // The site admin settings page will allow configuring operating hours.
  const hours: SiteBootstrapResponse['hours'] = []

  const isCurrentlyOpen = checkIsCurrentlyOpen(hours, location.timezone)

  // ── Capabilities ────────────────────────────────────────────────────────
  const capabilities = deriveSiteCapabilities({
    settings,
    portal,
    hasOnlineItems: onlineItemCount > 0,
    hasGiftCards: giftCardCount > 0,
    hasActiveCoupons: activeCouponCount > 0,
    hasDeliveryZones: deliveryZoneCount > 0,
    isCurrentlyOpen,
  })

  // ── Tip suggestions ─────────────────────────────────────────────────────
  const tipSuggestions = settings.tips.suggestedPercentages ?? [15, 18, 20, 25]
  const defaultTip = tipSuggestions[1] ?? 18

  // ── Surcharge ───────────────────────────────────────────────────────────
  const convenienceFee = settings.convenienceFees
  const surchargeType = convenienceFee?.enabled ? 'convenience_fee' : null
  const surchargeAmount = convenienceFee?.fees?.online ?? 0
  const surchargeName = convenienceFee?.disclosureText ?? 'Online ordering fee'

  // ── Organization email from location (not in Location model) ────────────
  // Email is not on the Location model; return null. Admin can configure via portal settings.
  const venueEmail: string | null = null

  return {
    venue: {
      name: location.name,
      address: location.address,
      phone: location.phone,
      email: venueEmail,
    },
    branding: {
      brandColor: portal.brandColor || '#3B82F6',
      brandColorSecondary: portal.brandColorSecondary || portal.brandColor || '#3B82F6',
      logoUrl: portal.logoUrl || null,
      bannerUrl: portal.bannerUrl || null,
      tagline: portal.tagline || null,
      themePreset: portal.themePreset || 'modern',
      headingFont: portal.headingFont || null,
    },
    sections: {
      showHero: portal.showHero ?? true,
      showAbout: portal.showAbout ?? true,
      showHours: portal.showHours ?? true,
      showFeaturedItems: portal.showFeaturedItems ?? true,
      showReservations: portal.showReservations ?? false,
      showContact: portal.showContact ?? true,
      showRewardsOnSite: portal.showRewardsOnSite ?? false,
      showGiftCards: portal.showGiftCards ?? false,
    },
    content: {
      aboutText: portal.aboutText || '',
      socialLinks: portal.socialLinks || {},
      footerText: portal.footerText || null,
    },
    hours,
    capabilities,
    orderingConfig: {
      prepTime: 15, // Default 15 minutes — no platform-specific setting yet
      tipSuggestions,
      defaultTip,
      requireZip: false,
      allowSpecialRequests: true,
      surchargeType,
      surchargeAmount,
      surchargeName,
      minOrderAmount: null,
      maxOrderAmount: null,
    },
  }
}

// ── Standalone Capabilities (for quick checks without full bootstrap) ─────

export async function getSiteCapabilities(
  db: PrismaClient,
  locationId: string,
  settings: LocationSettings,
  portal: VenuePortalSettings,
  timezone: string,
): Promise<SiteBootstrapResponse['capabilities']> {
  const [onlineItemCount, giftCardCount, activeCouponCount, deliveryZoneCount] = await Promise.all([
    // eslint-disable-next-line no-restricted-syntax -- aggregate count on injected PrismaClient, not global db
    db.menuItem.count({ where: { locationId, showOnline: true, deletedAt: null, isActive: true } }),
    db.giftCard.count({ where: { locationId, status: 'active' } }).catch(() => 0),
    db.coupon.count({
      where: {
        locationId, isActive: true, deletedAt: null,
        validFrom: { lte: new Date() },
        OR: [{ validUntil: null }, { validUntil: { gte: new Date() } }],
      },
    }).catch(() => 0),
    // DeliveryZone model not yet in schema — stub until migration adds it
    Promise.resolve(0),
  ])

  const isCurrentlyOpen = checkIsCurrentlyOpen([], timezone)

  return deriveSiteCapabilities({
    settings,
    portal,
    hasOnlineItems: onlineItemCount > 0,
    hasGiftCards: giftCardCount > 0,
    hasActiveCoupons: activeCouponCount > 0,
    hasDeliveryZones: deliveryZoneCount > 0,
    isCurrentlyOpen,
  })
}
