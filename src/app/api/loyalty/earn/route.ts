/**
 * DEPRECATED — POST /api/loyalty/earn
 *
 * Resolved 2026-04-23 (Loyalty Cleanup Q3): admin "manual credit" through this
 * route is no longer supported. Manual loyalty corrections must use
 * `POST /api/loyalty/adjust`, which writes a `LoyaltyTransaction` of
 * `type='admin_adjustment'` so corrections do not look like organic earning.
 *
 * Order-driven earn (the cleanup's canonical path) goes through the in-line
 * commit engine + outbox worker — `commit-payment-transaction.ts` -> the
 * `loyalty.earn` outbox event -> `loyalty-earn-worker.ts` — and never touched
 * this route. Removing the route therefore does not affect the order earn
 * path; it only closes the manual-write back door.
 *
 * This file is intentionally kept as a 410 stub for backward compatibility.
 * Any caller (admin UI, scripts, third-party integrations) hitting this URL
 * gets a clear redirect to `/api/loyalty/adjust`. See loyalty.md "API Routes".
 */

import { NextResponse } from 'next/server'

const DEPRECATION_BODY = {
  error: 'Deprecated. Use POST /api/loyalty/adjust instead.',
  migration: '/api/loyalty/adjust',
}

export function POST(): NextResponse {
  return NextResponse.json(DEPRECATION_BODY, { status: 410 })
}

// GET / PUT / DELETE were never supported here; respond with the same 410 so
// any odd caller learns the route is gone rather than getting a 405.
export function GET(): NextResponse {
  return NextResponse.json(DEPRECATION_BODY, { status: 410 })
}
