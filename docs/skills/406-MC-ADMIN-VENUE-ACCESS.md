# Skill 406 — MC Admin Venue Access

**Domain:** Auth / Admin Access / Mission Control
**Date:** 2026-02-20
**Commits:** 460da99 (gwi-pos), 5e449ec (gwi-mission-control)
**Addresses:** GWI admins had no easily discoverable one-click path from Mission Control into a venue's admin panel — the VenueUrlCard opened the plain venue URL (unauthenticated, redirect to /admin-login)

---

## Overview

GWI Mission Control has a complete JWT-based admin access mechanism (`/pos-access/[slug]`) that lets any authenticated GWI admin (super_admin, sub_admin) enter any venue's POS admin panel without a PIN. The mechanism was complete but not exposed on the main location detail page where admins spend most of their time.

The `VenueUrlCard` "Open" link sent admins to `https://{slug}.ordercontrolcenter.com` — hitting the middleware without a session cookie → redirect to `/admin-login` → required email + password. Combined with the Skill 405 bug, every path to a venue required manual login.

---

## The Admin Access Architecture

### Token Generation (gwi-mission-control)

```
/pos-access/[slug] (server component, Clerk-protected)
  └─ getVenueAdminContext(slug)
      ├─ super_admin / sub_admin → access all venues ✓
      ├─ agent → AgentLocationAssignment check
      └─ owner / employee → org or location scope check
  └─ generatePosAccessToken({ sub, email, name, slug, orgId, role, posLocationId })
      └─ HS256 JWT, signed with PROVISION_API_KEY, 8-hour expiry
  └─ redirect to https://{slug}.ordercontrolcenter.com/auth/cloud?token={JWT}
```

### Token Consumption (gwi-pos)

```
/auth/cloud?token={JWT} (client component)
  └─ POST /api/auth/cloud-session { token }
      └─ verifyCloudToken(token, PROVISION_API_KEY)
      └─ resolve Location from JWT.posLocationId or findFirst fallback
      └─ build cloud employee { id: "cloud-{userId}", permissions: ["admin"] }
      └─ set pos-cloud-session httpOnly cookie (8h)
      └─ return { data: { employee } }
  └─ login(data.data?.employee) → populate Zustand store
  └─ navigate to /settings (venue admin home)
```

---

## Fix Applied

Added a blue "Open Admin (authenticated)" button to `VenueUrlCard.tsx` in gwi-mission-control.

The button:
- Links to `/pos-access/${savedSlug}` (relative — stays on app.thepasspos.com)
- Opens in new tab
- Routes through the JWT handoff mechanism
- User lands directly in `/settings` with no login prompt

The plain venue URL link is kept for sharing/copying (customers, ordering links, etc.). The new button is clearly labeled and distinct.

---

## Files Changed

### gwi-pos
| File | Change |
|------|--------|
| `src/app/auth/cloud/page.tsx` | Fixed data envelope unwrap (see Skill 405) |

### gwi-mission-control
| File | Change |
|------|--------|
| `src/components/admin/VenueUrlCard.tsx` | Added "Open Admin (authenticated)" button → `/pos-access/{slug}` |

---

## Session Flow After Fix

```
MC Location Detail → "Open Admin (authenticated)"
  └─ /pos-access/fruita-grill
  └─ JWT generated (8h)
  └─ Redirect → fruita-grill.ordercontrolcenter.com/auth/cloud?token=...
  └─ Cookie set, auth store populated
  └─ Land in /settings — no login prompt ✓
```
