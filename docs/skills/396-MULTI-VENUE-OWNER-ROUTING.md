# Skill 396 — Multi-Venue Owner Routing

**Domain:** Auth / Cloud / Multi-Tenancy
**Date:** 2026-02-20
**Commits:** 7b6bb2f (POS), 74bf036 + a4eeaf9 (MC)
**Addresses:** Multi-venue owner detection, venue picker UI, cross-domain owner token flow

---

## Overview

When an owner manages multiple venues, a single login at any venue detects their multi-venue status via a Mission Control API call and presents a venue picker instead of immediately issuing a session. The selected venue receives a short-lived owner token that is exchanged for a local session — enabling seamless cross-domain authentication without re-entering credentials.

---

## Architecture

```
Owner logs in at venue-A.ordercontrolcenter.com/admin-login
         │
         ▼
   Clerk FAPI verification (Skill 395)
         │
         ▼
   Fetch MC: GET /api/owner/venues?email=...
   (PROVISION_API_KEY auth, 4s timeout)
         │
    ┌────┴────────┐
    │             │
  1 venue      2+ venues
  or MC down     │
    │             ▼
    ▼        Return { multiVenue: true,
  Issue        venues: [...],
  session      ownerToken: "..." }
  (normal)       │
                 ▼
           Venue Picker UI
           (dark cards, "Open →")
                 │
                 ▼
           Navigate to:
           https://{target}.ordercontrolcenter.com/auth/owner?token=...
                 │
                 ▼
           POST /api/auth/owner-session
           { token } → verify → issue pos-cloud-session
                 │
                 ▼
           Redirect to /settings
```

---

## 1. Owner Token — Signing & Verification

New exports from `cloud-auth.ts` for short-lived cross-domain owner tokens:

```typescript
import { signOwnerToken, verifyOwnerToken } from '@/lib/cloud-auth'
```

### `signOwnerToken()`

```typescript
signOwnerToken(
  email: string,
  venues: string[],   // array of venue slugs
  secret: string
): Promise<string>    // signed JWT, 10-minute expiry
```

**JWT payload shape:**
```typescript
interface OwnerTokenPayload {
  sub: 'owner-verified'
  email: string
  venues: string[]   // slugs the owner is authorized for
  iat: number
  exp: number        // iat + 600 (10 minutes)
}
```

Uses the same Web Crypto `crypto.subtle` HMAC-SHA256 pattern as `signVenueToken()` (Skill 395).

### `verifyOwnerToken()`

```typescript
verifyOwnerToken(
  token: string,
  secret: string
): Promise<OwnerTokenPayload | null>  // null if invalid/expired
```

Returns the decoded payload if the signature and expiry are valid, `null` otherwise.

---

## 2. Venue Login — Multi-Venue Detection

Updated `POST /api/auth/venue-login` to detect multi-venue owners after successful Clerk verification:

```
src/app/api/auth/venue-login/route.ts
```

### Flow Addition

After Clerk FAPI returns `status: 'complete'`:

```typescript
// Fetch venue list from Mission Control
const mcResponse = await fetch(
  `${MC_URL}/api/owner/venues?email=${encodeURIComponent(email)}`,
  {
    headers: { Authorization: `Bearer ${PROVISION_API_KEY}` },
    signal: AbortSignal.timeout(4000)  // 4s timeout
  }
)

const { data } = await mcResponse.json()
// data.venues: [{ slug, name, domain }]

if (data.venues.length >= 2) {
  const ownerToken = await signOwnerToken(email, slugs, secret)
  return Response.json({
    multiVenue: true,
    venues: data.venues,
    ownerToken
  })
}
// else: issue single-venue session as normal
```

---

## 3. Venue Picker UI

Updated `admin-login/page.tsx` with a dual-mode state:

```
src/app/admin-login/page.tsx
```

**Component state:**
```typescript
mode: 'login' | 'picking'
```

- `'login'` — Standard email + password form (Skill 395)
- `'picking'` — Venue picker displayed after multi-venue response

### Venue Picker

Dark-themed card list, one card per venue:

| Element | Detail |
|---------|--------|
| Card background | Dark theme, consistent with login page |
| Venue name | Prominent display |
| Action | "Open →" link |
| Link target | `https://{domain}/auth/owner?token={ownerToken}` |

Clicking a venue card navigates the browser to the target venue's `/auth/owner` page with the owner token as a query parameter.

---

## 4. Owner Auth Page — `/auth/owner`

New client component that receives the owner token and exchanges it for a local session:

```
src/app/auth/owner/page.tsx
```

**Flow:**
1. Reads `?token=` from URL search params
2. POSTs to `/api/auth/owner-session` with `{ token }`
3. On success: calls `login(employee)` to set client state, then `router.replace('/settings')`
4. On error: displays error message (expired token, not authorized, etc.)

---

## 5. Owner Session API — `POST /api/auth/owner-session`

New endpoint that verifies the owner token and issues a venue session:

```
src/app/api/auth/owner-session/route.ts
```

**Flow:**
```typescript
// Wrapped with withVenue() for venue context
const payload = await verifyOwnerToken(token, secret)

if (!payload)
  return Response.json({ error: 'Invalid or expired token' }, { status: 401 })

if (!payload.venues.includes(venueSlug))
  return Response.json({ error: 'Not authorized for this venue' }, { status: 403 })

const employee = await findEmployeeByEmail(payload.email)

if (!employee)
  return Response.json({ notSetup: true }, { status: 403 })

// Issue pos-cloud-session cookie (same as Skill 395)
```

**Response codes:**
| Status | Condition |
|--------|-----------|
| 200 | Success — session issued, employee data returned |
| 401 | Owner token invalid or expired (10-minute window) |
| 403 | Email not in `payload.venues` for this venue slug |
| 403 `{ notSetup: true }` | Email not found in venue's Employee table |

---

## 6. MC Venue Lookup API — `GET /api/owner/venues`

New Mission Control endpoint that returns all venues an owner email has access to:

```
src/app/api/owner/venues/route.ts  (MC repo)
```

**Request:**
```
GET /api/owner/venues?email=owner@example.com
Authorization: Bearer <PROVISION_API_KEY>
```

**Query logic:**
1. Find `AdminUser` where `email` matches and `role = 'owner'`
2. Collect `orgIds` and `directLocationIds` via `AdminUserLocationAssignment`
3. Query `CloudLocation` with OR conditions (org match or direct assignment)
4. Deduplicate results by `slug`
5. Return venue list

**Response:**
```typescript
{
  data: {
    venues: [
      { slug: 'venue-a', name: 'Venue A', domain: 'venue-a.ordercontrolcenter.com' },
      { slug: 'venue-b', name: 'Venue B', domain: 'venue-b.ordercontrolcenter.com' }
    ]
  }
}
```

---

## 7. MC Middleware — Owner API Bypass

Updated Mission Control middleware to bypass Clerk `auth.protect()` for owner API routes:

```
src/middleware.ts  (MC repo)
```

```typescript
const isOwnerApiRoute = createRouteMatcher(['/api/owner(.*)'])

// In middleware handler:
if (isOwnerApiRoute(req)) {
  return NextResponse.next()  // PROVISION_API_KEY auth handled in route
}
// else: auth.protect() as normal
```

---

## 8. Middleware Allowlist Update (POS)

Expanded POS middleware allowlist for new owner auth routes:

```
src/middleware.ts
```

| Route | Purpose |
|-------|---------|
| `/auth/owner` | Owner token landing page |
| `/api/auth/owner-session` | Owner token → session exchange |

---

## Safe Fallbacks

| Scenario | Behavior |
|----------|----------|
| MC unreachable (4s timeout) | Single-venue session issued normally |
| MC returns 0 or 1 venues | Single-venue session issued normally |
| Owner token expired (>10 min) | 401 from `/api/auth/owner-session` |
| Email not in venue's Employee table | 403 `{ notSetup: true }` |

The system degrades gracefully — if MC is down or the owner has only one venue, the login flow behaves identically to Skill 395 with no user-visible difference.

---

## Summary Table

| Change | File | Repo | Impact |
|--------|------|------|--------|
| `signOwnerToken()` / `verifyOwnerToken()` | `cloud-auth.ts` | POS | Cross-domain owner JWT (10 min) |
| Multi-venue detection after Clerk auth | `venue-login/route.ts` | POS | MC venue count check, owner token response |
| Venue picker UI (`'login'` / `'picking'` mode) | `admin-login/page.tsx` | POS | Dark card list with "Open →" links |
| Owner token landing page | `auth/owner/page.tsx` | POS | Client-side token → session exchange |
| Owner session endpoint | `owner-session/route.ts` | POS | Token verify + venue slug check + session |
| Middleware allowlist expansion | `middleware.ts` | POS | `/auth/owner`, `/api/auth/owner-session` |
| Owner venues lookup API | `owner/venues/route.ts` | MC | AdminUser → venues query + dedup |
| MC middleware Clerk bypass for `/api/owner/*` | `middleware.ts` | MC | PROVISION_API_KEY auth instead of Clerk |
