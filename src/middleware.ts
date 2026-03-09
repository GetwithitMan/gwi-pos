/**
 * Next.js Middleware entry point.
 *
 * Delegates to proxy.ts which handles:
 * - Multi-tenant venue routing (subdomain → x-venue-slug header)
 * - Cloud auth enforcement for admin pages
 * - Cellular JWT verification and gating
 * - Access gate for non-authenticated routes
 */

export { proxy as middleware, config } from './proxy'
