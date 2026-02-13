# Skill 336: Online Ordering URL Infrastructure

**Status:** DONE
**Domain:** Mission Control
**Dependencies:** 300 (Cloud Project Bootstrap), 319 (Wildcard Subdomain Routing)
**Date:** February 12, 2026

## Overview

Future-proofing infrastructure for customer-facing online ordering. Each venue location gets a unique 6-character order code and a URL pattern that combines security (random code prevents guessing) with readability (venue slug makes URLs shareable).

**URL Pattern:** `ordercontrolcenter.com/{orderCode}/{slug}`

**Example:** `ordercontrolcenter.com/VGH9Z6/gwi-admin-dev`

Stacked paths for future pages:
- `/cart` — customer cart
- `/login` — returning customer login

## Schema Changes

### CloudLocation (`prisma/schema.prisma` — Mission Control)

```prisma
model CloudLocation {
  // ... existing fields
  orderCode             String?  @unique  // Random 6-char alphanumeric (e.g. "K9F2A3")
  onlineOrderingEnabled Boolean  @default(false)
}
```

### Order Code Generation

Characters used: `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (32 chars)
- Excluded: `0`, `O`, `1`, `I` — prevents visual confusion
- 6 characters = 32^6 = ~1 billion unique codes
- Collision check: up to 10 retries on generation

```typescript
function generateOrderCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
}
```

## API Changes

### POST `/api/admin/locations` (Create Location)

- Auto-generates unique `orderCode` on location creation
- Up to 10 retries if collision detected
- Order code is immutable after creation (not editable by admin)

### PUT `/api/admin/locations/[id]` (Update Location)

- Added `onlineOrderingEnabled` boolean to update schema
- Allows toggling online ordering on/off per location

## UI Changes

### VenueUrlCard (`src/components/admin/VenueUrlCard.tsx`)

Completely rewritten to show two sections:

1. **Venue Admin Portal** — existing subdomain editor (`{slug}.ordercontrolcenter.com`)
2. **Online Ordering** — new section with:
   - Full ordering URL displayed with copy button
   - Toggle switch for enabling/disabling online ordering
   - Order code displayed prominently (for QR codes, table tents, receipts)
   - "Coming soon" message when ordering is disabled

### Props Added

```typescript
interface VenueUrlCardProps {
  locationId: string
  currentSlug: string
  orderCode: string | null      // NEW
  onlineOrderingEnabled: boolean // NEW
}
```

## Domain Architecture Decision

### Why Not Subdomains?

Original plan was `{slug}.barpos.restaurant` for online ordering. Changed to path-based:

| Approach | URL | Pros | Cons |
|----------|-----|------|------|
| Subdomain | `joes-bar.barpos.restaurant` | Clean URLs | DNS wildcard config, SSL certs, venue name exposed |
| Path-based | `ordercontrolcenter.com/K9F2A3/JoesBar` | No DNS config, privacy, single deployment | Slightly longer URL |

**Decision:** Path-based with random code + slug. The order code prevents URL guessing, and the slug keeps URLs readable for QR codes and business cards.

### `barpos.restaurant` Disposition

- Remains as a password-protected demo of the POS app
- Not used for customer-facing anything
- Vercel deployment protection recommended

## Backfill

Existing locations created before this feature get `orderCode = null`. A backfill script was run:

```bash
npx tsx scripts/backfill-order-codes.ts
```

This generated codes for all existing locations (e.g., `gwi-admin-dev` → `VGH9Z6`).

## What's NOT Built Yet (Future Work)

- Actual online ordering pages (menu, cart, checkout)
- Middleware routing for `/:orderCode/:slug` paths
- Customer accounts / returning customer login
- QR code generation from order code
- Payment processing for online orders

## Key Files

| File | Changes |
|------|---------|
| `prisma/schema.prisma` | Added `orderCode` (unique) + `onlineOrderingEnabled` to CloudLocation |
| `src/app/api/admin/locations/route.ts` | Auto-generate orderCode on create, uniqueOrderCode() helper |
| `src/app/api/admin/locations/[id]/route.ts` | Added `onlineOrderingEnabled` to update schema |
| `src/app/dashboard/locations/[id]/page.tsx` | Pass new props to VenueUrlCard |
| `src/components/admin/VenueUrlCard.tsx` | Rewritten: admin portal + online ordering sections |
| `scripts/backfill-order-codes.ts` | One-time backfill for existing locations |
