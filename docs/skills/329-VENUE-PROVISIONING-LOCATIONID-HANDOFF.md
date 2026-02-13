# Skill 329: Venue Provisioning — posLocationId Handoff

**Status:** DONE
**Date:** February 12, 2026
**Domain:** Mission Control (cross-domain: POS + MC)
**Commits:**
- POS: `c8a779d` — posLocationId handoff: provision returns it, cloud-session uses it
- MC: `1ff0750` — store and include posLocationId in JWT for POS cloud auth

## Problem

When Mission Control admins accessed the POS cloud admin interface, the cloud-session endpoint had to **guess** which `locationId` to use. This caused two critical failures:

1. **FK constraint violation** — Cloud session used fake `locationId: 'cloud-{slug}'` which didn't exist as a Location record, breaking all writes (ingredient categories, etc.)
2. **"Invalid ingredient IDs" error** — Cloud session created a NEW Location instead of using the seed's `loc-1`, so new records got a different locationId than existing data, breaking cross-table references

## Root Cause

The provisioning flow created a Location with a real `locationId` but **never sent it back to MC**. So the JWT token never included it. The cloud-session had to guess by searching or creating a Location, which frequently guessed wrong.

## Solution

Close the loop: provisioning returns `posLocationId` -> MC stores it -> JWT includes it -> cloud-session uses it directly.

### Priority Chain in Cloud Session

```
1. JWT has posLocationId? -> Use it directly (verify exists in DB)
2. No posLocationId? -> findFirst() Location (dev/unprovisioned fallback)
3. No Location at all? -> Auto-create (empty database)
```

## Files Modified

### POS (gwi-pos)

| File | Change |
|------|--------|
| `src/app/api/internal/provision/route.ts` | `seedVenueDefaults()` returns locationId; response includes `posLocationId` |
| `src/lib/cloud-auth.ts` | Added `posLocationId?: string` to `CloudTokenPayload` interface |
| `src/app/api/auth/cloud-session/route.ts` | Priority-based Location resolution: JWT posLocationId -> findFirst -> auto-create |

### MC (gwi-mission-control)

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Added `posLocationId String?` to CloudLocation model |
| `src/lib/neon-provisioning.ts` | Stores `posLocationId` from provision response on CloudLocation |
| `src/lib/pos-access-token.ts` | Added `posLocationId?: string` to `PosTokenPayload` interface |
| `src/app/pos-access/[slug]/page.tsx` | Fetches CloudLocation.posLocationId and includes in JWT |

## How It Works

### Development Scenario (No Provisioning)
- JWT won't have `posLocationId` (MC hasn't provisioned the venue)
- Cloud-session falls back to `findFirst()` - finds seed's Location (`loc-1`)
- All data uses the same locationId -> no FK errors

### Production Scenario (Provisioned Venue)
1. MC calls `provisionPosDatabase("joes-bar", "Joe's Bar")`
2. POS creates Neon DB, seeds it, returns `posLocationId: "clxyz..."`
3. MC stores `posLocationId` on CloudLocation record
4. When admin opens POS cloud admin, JWT includes `posLocationId: "clxyz..."`
5. POS cloud-session uses `"clxyz..."` directly -> deterministic, no guessing

## Related Bug Fixes (Same Session)

| Commit | Fix |
|--------|-----|
| `019f6a1` | Cloud admin gets `'admin'` permission (not `'all'`) |
| `2c8263e` | Cloud-session auto-creates Location in master DB (was using fake IDs) |
| `703e0ea` | Cloud-session uses findFirst() instead of name-based search (was creating duplicates) |

## Future Work

- **Per-venue database routing**: API routes currently use `db` (master). For multi-venue production, routes need `getDbForVenue(slug)` middleware.
- **13 routes with hardcoded `DEFAULT_LOCATION_ID = 'loc-1'`**: Need updating to read from auth session.
