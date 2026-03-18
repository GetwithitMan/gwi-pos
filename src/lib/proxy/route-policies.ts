/**
 * Online ordering paths: /:orderCode/:slug[/...]
 *
 * Pattern: 4-8 uppercase alphanumeric chars followed by a lowercase slug.
 * Example: /ABC123/my-venue or /ABC123/my-venue/confirm
 *
 * These are customer-facing public pages -- no auth cookies required.
 * We extract the slug from the path and pass it via x-venue-slug so that
 * the page component can call /api/public/resolve-order-code to get the
 * locationId without triggering the authenticated proxy flow.
 */
export const ONLINE_ORDER_PATH_RE = /^\/([A-Z0-9]{4,8})\/([a-z0-9-]+)(\/.*)?$/

/**
 * Public API paths that must never be blocked by cloud auth.
 * /api/online/* and /api/public/* are already behind locationId-based
 * isolation -- no venue session required.
 */
export const PUBLIC_API_PATH_RE = /^\/api\/(online|public)\//

// ═══════════════════════════════════════════════════════════
// Cellular terminal route policies
// ═══════════════════════════════════════════════════════════

/** Routes allowed for cellular terminals */
export const CELLULAR_ALLOWLIST: Array<string | RegExp> = [
  /^\/api\/orders$/,                           // GET list, POST create
  /^\/api\/orders\/[^/]+$/,                    // GET single order
  /^\/api\/orders\/[^/]+\/items$/,             // POST add items
  /^\/api\/orders\/[^/]+\/send$/,              // POST send to kitchen
  /^\/api\/orders\/[^/]+\/pay$/,               // POST payment
  /^\/api\/orders\/replay-cart-events$/,       // POST cart replay
  /^\/api\/menu(\/|$)/,         // read-only menu access
  /^\/api\/sync(\/|$)/,         // all sync endpoints (bootstrap, delta, events, floor-plan, outbox)
  /^\/api\/order-events(\/|$)/, // event-sourced order mutations (batch)
  /^\/api\/auth\/login(\/|$)/,      // PIN login
  /^\/api\/auth\/verify-pin(\/|$)/, // PIN verification for operations (voids, comps, etc.)
  /^\/api\/session(\/|$)/,      // session bootstrap
  /^\/api\/employees(\/|$)/,    // employee list for display
  '/api/barcode/lookup',        // barcode scanning
  '/api/auth/refresh-cellular', // token refresh
  /^\/api\/health(\/|$)/,       // health check
]

/** Routes hard-blocked for CELLULAR_ROAMING (403 always) */
export const CELLULAR_HARD_BLOCKED: Array<string | RegExp> = [
  /^\/api\/orders\/[^/]+\/refund/,
  /^\/api\/orders\/[^/]+\/adjust-tip/,
  /^\/api\/orders\/[^/]+\/split/,
  /^\/api\/orders\/[^/]+\/merge/,
  /^\/api\/shifts\/[^/]+\/close/,
  /^\/api\/(admin|settings|reports)(\/|$)/,
  /^\/api\/inventory(\/|$)/,
  /^\/api\/integrations(\/|$)/,
  /^\/api\/dashboard(\/|$)/,
  /^\/api\/cron(\/|$)/,
  /^\/api\/internal(\/|$)/,
  /^\/api\/fleet(\/|$)/,
]

/** Routes that require re-auth (pass through but flagged) */
export const CELLULAR_REAUTH_ROUTES: RegExp[] = [
  /^\/api\/orders\/[^/]+\/void/,
  /^\/api\/orders\/[^/]+\/comp/,
]

/**
 * Routes eligible for expired-token grace period.
 *
 * These are outage-recovery replay endpoints used by Android workers
 * (CartOutboxWorker, PaymentReconciliationWorker). When the JWT is expired
 * but within the 4-hour grace window, the proxy:
 *   1. Allows the request through (with x-cellular-authenticated headers)
 *   2. Issues a fresh token and attaches it as X-Refreshed-Token response header
 *   3. Logs the grace event for audit
 *
 * The Android client reads X-Refreshed-Token and stores the new JWT for
 * subsequent requests, self-healing without requiring a re-pair.
 */
export const CELLULAR_GRACE_ELIGIBLE_ROUTES: Array<string | RegExp> = [
  /^\/api\/orders\/replay-cart-events$/,  // CartOutboxWorker replay
  /^\/api\/orders\/[^/]+\/pay$/,          // PaymentReconciliationWorker replay
  '/api/auth/refresh-cellular',           // Token refresh itself
]

/**
 * Normalize a URL path by resolving `.` and `..` segments.
 *
 * Next.js `request.nextUrl.pathname` already normalizes via the WHATWG URL
 * constructor, but we normalize explicitly as defense-in-depth: if any
 * upstream layer ever passes a raw path, traversal sequences like
 * `/api/orders/../../admin/settings` cannot bypass the allowlist/blocklist.
 */
export function normalizePath(pathname: string): string {
  const segments = pathname.split('/').filter(s => s !== '' && s !== '.')
  const normalized: string[] = []
  for (const seg of segments) {
    if (seg === '..') {
      normalized.pop()
    } else {
      normalized.push(seg)
    }
  }
  return '/' + normalized.join('/')
}

export function matchesRouteList(pathname: string, routes: Array<string | RegExp>): boolean {
  const safe = normalizePath(pathname)
  for (const route of routes) {
    if (typeof route === 'string') {
      if (safe === route) return true
    } else {
      if (route.test(safe)) return true
    }
  }
  return false
}
