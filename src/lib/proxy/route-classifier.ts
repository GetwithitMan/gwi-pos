/**
 * Route classifier for customer-facing site vs admin POS.
 *
 * The proxy uses this to decide whether a request needs admin auth
 * (cloud session cookie) or can pass through with just tenant context.
 * Customer-level auth (portal session, HMAC tokens) is validated by
 * the pages/APIs themselves — not by the proxy.
 */

export type RouteAudience = 'admin' | 'site-public' | 'site-token' | 'site-customer' | 'public-api'

/** Pages that any visitor can access without any auth */
const SITE_PUBLIC_PATHS = new Set(['/', '/menu', '/checkout', '/reserve', '/contact', '/gift-cards'])

/**
 * Prefix-matched paths with their audience.
 * Uses exact-or-subpath matching: '/account' matches '/account' AND '/account/orders'
 * but NOT '/accounting' or '/accountant'.
 */
const SITE_PREFIX_MAP: Array<[string, RouteAudience]> = [
  ['/order-status', 'site-token'],    // HMAC-token-gated (matches /order-status/xxx)
  ['/account', 'site-customer'],      // customer session required (matches /account, /account/orders, etc.)
]

/** Public API regex — /api/online/* and /api/public/* */
const PUBLIC_API_PATH_RE = /^\/api\/(online|public)\//

/**
 * True if pathname equals prefix exactly OR starts with prefix + '/'.
 * Prevents false positives like '/accounting' matching '/account'.
 */
function matchesExactOrSubpath(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + '/')
}

/**
 * Classify a request path into its audience.
 * Returns null for admin paths (requires cloud session auth).
 */
export function classifyPath(pathname: string): RouteAudience | null {
  if (SITE_PUBLIC_PATHS.has(pathname)) return 'site-public'
  for (const [prefix, audience] of SITE_PREFIX_MAP) {
    if (matchesExactOrSubpath(pathname, prefix)) return audience
  }
  if (PUBLIC_API_PATH_RE.test(pathname)) return 'public-api'
  return null // falls through to admin auth
}
