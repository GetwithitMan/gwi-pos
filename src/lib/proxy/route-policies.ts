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
  // ── Orders: core CRUD & lifecycle ────────────────────────────────────────
  /^\/api\/orders$/,                                  // GET list, POST create
  /^\/api\/orders\/open$/,                            // GET open orders (summary view)
  /^\/api\/orders\/[^/]+$/,                           // GET single order, PUT update order
  /^\/api\/orders\/[^/]+\/items$/,                    // POST add items
  /^\/api\/orders\/[^/]+\/items\/[^/]+$/,             // PUT update item, DELETE remove item
  /^\/api\/orders\/[^/]+\/items\/[^/]+\/discount$/,   // POST/DELETE item-level discount
  /^\/api\/orders\/[^/]+\/send$/,                     // POST send to kitchen
  /^\/api\/orders\/[^/]+\/pay$/,                      // POST payment
  /^\/api\/orders\/[^/]+\/open-tab$/,                 // POST open bar tab
  /^\/api\/orders\/[^/]+\/close-tab$/,                // POST close bar tab
  /^\/api\/orders\/[^/]+\/record-card-auth$/,         // POST record card pre-auth for tab
  /^\/api\/orders\/[^/]+\/comp-void$/,                // POST comp/void item (reauth-flagged)
  /^\/api\/orders\/[^/]+\/discount$/,                 // GET/POST/DELETE order-level discount
  /^\/api\/orders\/[^/]+\/transfer$/,                 // POST transfer order to another employee/table
  /^\/api\/orders\/[^/]+\/seating(\/|$)/,             // POST add seat, DELETE remove seat
  /^\/api\/orders\/[^/]+\/customer$/,                 // GET/PUT customer link on order
  /^\/api\/orders\/[^/]+\/split-tickets(\/|$)/,       // GET/POST/PATCH/DELETE split tickets
  /^\/api\/orders\/[^/]+\/fire-course$/,              // POST fire course
  /^\/api\/orders\/[^/]+\/void-tab$/,                 // POST void an entire tab
  /^\/api\/orders\/[^/]+\/void-payment$/,             // POST void a payment (reauth-flagged)
  /^\/api\/orders\/[^/]+\/apply-coupon$/,             // POST apply coupon/promo code
  /^\/api\/orders\/[^/]+\/reopen$/,                   // POST reopen a closed order (reauth-flagged)
  /^\/api\/orders\/[^/]+\/apply-deposit$/,            // POST apply reservation deposit
  /^\/api\/orders\/[^/]+\/add-ha-payment$/,           // POST add house account payment
  /^\/api\/orders\/bulk-action$/,                     // POST bulk order operations
  /^\/api\/orders\/replay-cart-events$/,              // POST offline cart replay

  // ── Auth ─────────────────────────────────────────────────────────────────
  /^\/api\/auth\/login(\/|$)/,      // PIN login
  /^\/api\/auth\/verify-pin(\/|$)/, // PIN verification for operations (voids, comps, etc.)
  '/api/auth/refresh-cellular',     // token refresh

  // ── Sync ─────────────────────────────────────────────────────────────────
  /^\/api\/sync(\/|$)/,         // all sync endpoints (bootstrap, delta, events, floor-plan, outbox, employee-reasons)
  /^\/api\/order-events(\/|$)/, // event-sourced order mutations (batch)
  /^\/api\/session(\/|$)/,      // session bootstrap

  // ── Menu & data ──────────────────────────────────────────────────────────
  /^\/api\/menu(\/|$)/,         // read-only menu access
  /^\/api\/employees(\/|$)/,    // employee list, quick-bar, layout
  /^\/api\/pizza(\/|$)/,        // pizza data + specialties
  '/api/barcode/lookup',        // barcode scanning

  // ── Shifts & time clock ──────────────────────────────────────────────────
  /^\/api\/shifts(\/|$)/,       // GET list, GET detail, POST start (close is hard-blocked separately)
  /^\/api\/time-clock(\/|$)/,   // GET status, POST toggle/clock-in, PUT clock-out

  // ── Customers ────────────────────────────────────────────────────────────
  /^\/api\/customers(\/|$)/,    // search, create, update, detail, match-by-card, house-account, send-verification
  /^\/api\/card-profiles\/stats$/, // card profile stats for customer matching

  // ── Payment-adjacent ─────────────────────────────────────────────────────
  /^\/api\/gift-cards(\/|$)/,     // gift card lookup
  /^\/api\/house-accounts$/,      // GET house accounts list (read-only)
  /^\/api\/tips(\/|$)/,           // pending tips, recorded tips, self-service tip adjustments
  /^\/api\/membership-plans(\/|$)/, // GET membership plans list
  /^\/api\/memberships(\/|$)/,    // POST enroll, GET charges

  // ── Hardware & print ─────────────────────────────────────────────────────
  /^\/api\/hardware\/terminals\/heartbeat-native$/, // terminal heartbeat (connectivity check)
  /^\/api\/hardware\/terminals\/pair-native$/,      // terminal pairing
  /^\/api\/hardware\/payment-readers\/register-direct$/, // register payment reader
  /^\/api\/print(\/|$)/,         // cash drawer open, kitchen reprint
  /^\/api\/drawers(\/|$)/,       // safe drop

  // ── Receipts ─────────────────────────────────────────────────────────────
  /^\/api\/receipts(\/|$)/,      // email receipt, SMS receipt

  // ── Remote void approval ─────────────────────────────────────────────────
  /^\/api\/voids\/remote-approval(\/|$)/, // request, status, managers list

  // ── Entertainment ────────────────────────────────────────────────────────
  /^\/api\/entertainment(\/|$)/, // block time start/extend/stop, status, waitlist

  // ── Reservations & host stand ────────────────────────────────────────────
  /^\/api\/reservations(\/|$)/, // CRUD, availability, transition, messages, deposit
  /^\/api\/waitlist(\/|$)/,     // host waitlist CRUD
  /^\/api\/host\/seat$/,        // seat party from waitlist/reservation

  // ── Cake orders ──────────────────────────────────────────────────────────
  /^\/api\/cake-orders(\/|$)/,  // list, detail, create, status transition

  // ── Location settings (read-only) ────────────────────────────────────────
  /^\/api\/location\/quick-bar\/default$/, // GET/PUT default quick bar

  // ── EOD ──────────────────────────────────────────────────────────────────
  /^\/api\/eod\/reset$/,        // POST close day (manager-only, PIN-gated at route level)

  // ── Health ───────────────────────────────────────────────────────────────
  /^\/api\/health(\/|$)/,       // health check
]

/** Routes hard-blocked for CELLULAR_ROAMING (403 always) */
export const CELLULAR_HARD_BLOCKED: Array<string | RegExp> = [
  /^\/api\/orders\/[^/]+\/refund/,           // refund-payment (financial risk)
  /^\/api\/orders\/[^/]+\/adjust-tip$/,      // adjust-tip (post-close, back-office only)
  /^\/api\/orders\/[^/]+\/split$/,           // equal-split (anchored — does NOT block split-tickets)
  /^\/api\/orders\/[^/]+\/merge$/,           // merge orders
  /^\/api\/shifts\/[^/]+\/close/,            // shift close (back-office only)
  /^\/api\/(admin|settings|reports)(\/|$)/,  // admin/settings/reports panels
  /^\/api\/inventory(\/|$)/,
  /^\/api\/integrations(\/|$)/,
  /^\/api\/dashboard(\/|$)/,
  /^\/api\/cron(\/|$)/,
  /^\/api\/internal(\/|$)/,
  /^\/api\/fleet(\/|$)/,
]

/** Routes that require re-auth (pass through but flagged) */
export const CELLULAR_REAUTH_ROUTES: RegExp[] = [
  /^\/api\/orders\/[^/]+\/void/,     // void-payment, void-tab
  /^\/api\/orders\/[^/]+\/comp/,     // comp-void
  /^\/api\/orders\/[^/]+\/reopen$/,  // reopen closed order
  /^\/api\/eod\/reset$/,             // end-of-day close (manager PIN required)
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
