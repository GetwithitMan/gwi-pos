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

// ── Shared singleton state via globalThis ────────────────────────────────────
// CRITICAL: server.js (esbuild) and Next.js API routes (Turbopack/Webpack) load
// separate module copies. A module-level `let mcLeaseExpiry` creates TWO
// independent singletons — server.ts sets one, API routes read the other (always null).
// Using globalThis ensures both module systems share the same lease state.

declare global {
   
  var __gwi_lease_expiry: Date | null | undefined
}

if (globalThis.__gwi_lease_expiry === undefined) {
  globalThis.__gwi_lease_expiry = null
}

/** Called by ha-check.sh lease renewal (via health route) to update local lease cache */
export function updateLocalLeaseExpiry(expiry: Date | null): void {
  globalThis.__gwi_lease_expiry = expiry
}

/** Read the current local lease expiry (used by health route) */
export function getLocalLeaseExpiry(): Date | null {
  return globalThis.__gwi_lease_expiry ?? null
}
