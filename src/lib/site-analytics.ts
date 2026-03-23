/**
 * Site Analytics — Phase 1
 *
 * Lightweight event tracking for the customer-facing ordering site.
 * Phase 1: structured console.log (swap to Segment/PostHog later).
 */

export type SiteAnalyticsEventType =
  | 'site.menu_viewed'
  | 'site.item_viewed'
  | 'site.item_added'
  | 'site.item_removed'
  | 'site.checkout_started'
  | 'site.coupon_applied'
  | 'site.gift_card_applied'
  | 'site.payment_tokenized'
  | 'site.order_placed'
  | 'site.order_failed'
  | 'site.account_created'
  | 'site.qr_scanned'

interface SiteAnalyticsEvent {
  event: SiteAnalyticsEventType
  slug: string
  locationId?: string
  customerId?: string
  metadata?: Record<string, unknown>
  timestamp: string
}

/**
 * Track a site analytics event.
 * Phase 1: structured console.log.
 * Phase H: swap to SiteAnalyticsEvent table + external provider.
 */
export function trackSiteEvent(
  event: SiteAnalyticsEventType,
  slug: string,
  metadata?: Record<string, unknown>,
): void {
  const payload: SiteAnalyticsEvent = {
    event,
    slug,
    metadata,
    timestamp: new Date().toISOString(),
  }

  // Phase 1: structured logging (replace with DB insert + Segment in Phase H)
  if (typeof window === 'undefined') {
    // Server-side
    console.log('[site-analytics]', JSON.stringify(payload))
  } else {
    // Client-side
    console.log('[site-analytics]', payload)
  }
}
