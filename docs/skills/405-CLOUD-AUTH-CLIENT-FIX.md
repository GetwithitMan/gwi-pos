# Skill 405 — Cloud Auth Client Fix

**Domain:** Auth / Admin Access
**Date:** 2026-02-20
**Commit:** 460da99 (gwi-pos)
**Addresses:** GWI admins were redirected back to /admin-login every time after clicking "Open POS Admin" in Mission Control — even though the session cookie was being set correctly

---

## Root Cause

`src/app/auth/cloud/page.tsx` called `login(data.employee)` after the POST to `/api/auth/cloud-session`.

The API returns `{ data: { employee } }` (standard `{ data: T }` envelope used throughout the codebase). So `data.employee` was `undefined` — the client Zustand auth store was getting `login(undefined)`.

The `pos-cloud-session` httpOnly cookie was being set correctly on the server, so the Next.js middleware passed the request. But the settings page read from the Zustand store, saw no authenticated employee, and immediately redirected to `/admin-login`.

The result: every single MC → venue handoff ended at the login page, requiring email + password entry.

---

## Fix

**`src/app/auth/cloud/page.tsx`**

```typescript
// Before
login(data.employee)

// After — unwrap the { data: { employee } } envelope
login(data.data?.employee)
```

One line change. The cookie flow, JWT signing, and middleware validation were all correct — only the client-side envelope unwrapping was wrong.

---

## How the Cloud Auth Flow Works (for reference)

```
MC /pos-access/{slug}
  └─ getVenueAdminContext() — validates Clerk auth + venue access
  └─ generatePosAccessToken() — HS256 JWT, 8h expiry, signed with PROVISION_API_KEY
  └─ redirect → https://{slug}.ordercontrolcenter.com/auth/cloud?token=...

POS /auth/cloud page (client component)
  └─ reads ?token from URL
  └─ POST /api/auth/cloud-session { token }
       └─ verifyCloudToken() — validates signature + expiry
       └─ resolves Location from posLocationId in JWT
       └─ returns { data: { employee } }
       └─ sets pos-cloud-session httpOnly cookie (8h)
  └─ login(data.data?.employee) — populate Zustand auth store ← FIXED
  └─ router.replace('/settings')
```

---

## Files Changed

| File | Change |
|------|--------|
| `src/app/auth/cloud/page.tsx` | `login(data.employee)` → `login(data.data?.employee)` |
