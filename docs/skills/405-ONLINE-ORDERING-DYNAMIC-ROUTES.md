# Skill 405 — Online Ordering Customer Routes (T-071/T-072)

## Overview

Customers access the online ordering menu at `/{orderCode}/{slug}/` on any domain served by the POS (e.g., `ordercontrolcenter.com/ABC123/my-venue`). The `orderCode` segment is a 4–8 character uppercase alphanumeric identifier generated in Mission Control and stored on `CloudLocation.orderCode`. The `slug` segment is the venue slug, which is used to resolve the location from the local POS database. The entire route is public — no authentication cookies are required for customers to browse or order.

## Schema Changes

No schema changes in the POS repo. The `orderCode` lives in Mission Control's `CloudLocation` model and is embedded in the QR-code URL handed to customers. The POS resolves venues by `slug` (already a field on the `Location` model).

## Key Files

| File | Role |
|------|------|
| `src/middleware.ts` | Regex match + early bypass for online ordering paths; injects `x-venue-slug` header |
| `src/app/api/public/resolve-order-code/route.ts` | Public API that converts slug → locationId; checks online ordering gate |
| `src/app/[orderCode]/[slug]/page.tsx` | Customer-facing dynamic ordering page (3-step flow) |
| `src/app/[orderCode]/[slug]/layout.tsx` | Minimal layout (title: "Online Order", description: "Order online for pickup") |
| `src/app/[orderCode]/error.tsx` | Error boundary for unhandled exceptions under `/:orderCode` |

## How It Works

### Middleware bypass

The middleware matches all incoming paths against:

```typescript
const ONLINE_ORDER_PATH_RE = /^\/([A-Z0-9]{4,8})\/([a-z0-9-]+)(\/.*)?$/
```

- Capture group 1: `orderCode` — 4–8 uppercase alphanumeric characters
- Capture group 2: `slug` — lowercase alphanumeric with hyphens
- Capture group 3: optional sub-path (e.g., `/confirm`)

When the pattern matches, the middleware **immediately bypasses all cloud auth** and injects the venue slug into the request headers:

```typescript
headers.set('x-venue-slug', slugFromPath)
return NextResponse.next({ request: { headers } })
```

This means the customer page receives the `x-venue-slug` header without ever touching the JWT/cloud session validation path. The public API path regex (`/^\/api\/(online|public)\//`) provides the same bypass for the underlying API calls the page makes.

### Public resolve-order-code endpoint

`GET /api/public/resolve-order-code?slug={slug}`

- Does **not** use `withVenue()` — it is a fully public route
- Looks up `Location` by `slug` where `isActive: true`
- Checks `location.settings.onlineOrdering.enabled` (JSON field):
  - If the nested key is `false` OR `settings.onlineOrderingEnabled === false` → returns `403`
  - If the key is **absent** (legacy locations) → defaults to ALLOWED (backward compatible)
- On success returns: `{ locationId, name, slug }`
- On not-found: `404`
- On disabled: `403`

### Dynamic page — Next.js 15 async params

The page component uses React's `use()` hook to unwrap the async params object (Next.js 15 pattern):

```typescript
const { orderCode, slug } = use(params)
```

`orderCode` is kept in scope for future validation/logging but is not currently used for the resolve step — resolution is driven entirely by `slug`.

### 3-step ordering flow

The page has three sequential views, controlled by `step: 'menu' | 'cart' | 'payment'`:

1. **Menu** (`step === 'menu'`): Loads from `/api/online/menu?locationId={locationId}`. Displays category tabs + item grid. Items can be tapped to open `ItemModal` for modifier selection. A sticky "View Cart" bar appears when the cart has items.

2. **Cart** (`step === 'cart'`): Shows line items with quantity controls, customer info form (name required, email required, phone optional, special notes optional). Validates before advancing to payment.

3. **Payment** (`step === 'payment'`): Loads the Datacap Hosted Web Token iframe. On card submit, the Datacap JS callback fires `handleDatacapToken`, which POSTs to `/api/online/checkout` with the token, cart items, and customer info. On success, renders the confirmation screen.

### Resolve state machine

Before any ordering UI is shown, the page resolves the slug:

```typescript
type ResolveState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; locationId: string; locationName: string }
```

The `useEffect` on mount calls `/api/public/resolve-order-code?slug={slug}`. Errors from the API (disabled, not found, network) surface as the `error` state, which renders a "Store Not Found" screen.

### Error handling

| Condition | Behavior |
|-----------|----------|
| Slug not found / inactive location | `resolve-order-code` → 404; page shows "Store Not Found" |
| Online ordering disabled | `resolve-order-code` → 403; page shows "This ordering link is unavailable" |
| Menu load failure | `menuError` state; renders red error box |
| Datacap script load failure | `paymentError` state; prompts refresh |
| Unhandled exception in route segment | `src/app/[orderCode]/error.tsx` — "Order Code Not Found" screen |

## Configuration / Usage

1. In Mission Control, generate an `orderCode` for the venue and produce a QR code pointing to `https://www.barpos.restaurant/{orderCode}/{venueSlug}` (or equivalent domain).
2. To disable online ordering for a venue without removing the QR code, set `settings.onlineOrdering.enabled = false` on the `Location` record. The resolve endpoint will return 403 and customers will see an "unavailable" message.
3. No middleware configuration is needed — the regex match is automatic for any path matching `/{UPPERCASE_CODE}/{lowercase-slug}`.

## Notes

- The `orderCode` segment is validated by the middleware regex but is **not currently verified against the database** in the POS — the regex alone gates the early bypass. The `slug` is the actual tenant identifier used for lookup.
- `use(params)` is required because Next.js 15 made route params asynchronous. The `'use client'` directive at the top of `page.tsx` is required for this pattern.
- The `x-venue-slug` header injected by middleware is available to API routes wrapped with `withVenue()`. The public resolve endpoint does not use `withVenue()` and reads the slug from the query string instead.
- Datacap is initialized lazily — the script is only appended to the DOM when `step === 'payment'` is first entered. Navigating back to the cart does not re-initialize Datacap.
- The layout file is intentionally minimal (pass-through). All page chrome and error states are self-contained in `page.tsx` and `error.tsx`.
