/**
 * In-memory primary lease state for HA fence-check.
 *
 * Extracted from fence-check/route.ts because Next.js route files
 * cannot export non-handler symbols (GET/POST/etc.) — the generated
 * type checker rejects any extra exports.
 *
 * Updated by ha-check.sh via the MC arbiter renew-lease endpoint.
 * The primary's health check loop renews the lease every 10 seconds.
 */

let mcLeaseExpiry: Date | null = null

/** Called by ha-check.sh lease renewal (via health route) to update local lease cache */
export function updateLocalLeaseExpiry(expiry: Date | null): void {
  mcLeaseExpiry = expiry
}

/** Read the current local lease expiry (used by health route) */
export function getLocalLeaseExpiry(): Date | null {
  return mcLeaseExpiry
}
