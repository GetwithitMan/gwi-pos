# Skill 338: Cloud Session Validation & Guard

**Domain:** Mission Control / Settings
**Status:** DONE
**Date:** 2026-02-13
**Commits:** `ae1aa1a`, `a25aa5b`, `7fe120e`

## Problem

After deploying Skill 337 (multi-tenant DB routing), the browser's POS auth store (`gwi-pos-auth` in localStorage) had a stale `locationId: "loc-1"` from a previous login against the master DB. The venue DB's Location.id is `cmll6q1gp0002l504nbyllnv0`. This caused:

1. **FK violation on writes**: API calls sent `locationId: "loc-1"` → venue DB has no such Location → 500 on every create/update
2. **Cloud mode redirect loop**: `useRequireAuth` detected stale session → tried to redirect to `/login` → cloud middleware blocks `/login` → redirect to `/settings` → loop
3. **Race condition**: Settings pages rendered with stale `locationId` before async validation could refresh the auth store

## Solution (3 commits)

### Commit ae1aa1a — Session validation endpoint

**`GET /api/auth/validate-session?locationId=X&employeeId=Y`**
- Lightweight check that locationId and employeeId exist in the current venue DB
- Returns 401 if either is missing, signaling the client to force re-login
- Wrapped with `withVenue()` for tenant-correct DB access

**`src/hooks/useRequireAuth.ts`**
- Added one-time session validation on mount via `validatedRef`
- If 401 → forces logout and redirects to `/login`

### Commit a25aa5b — Cloud mode session re-bootstrap

**`GET /api/auth/cloud-session`** (new handler, added to existing route file)
- Reads the existing `pos-cloud-session` httpOnly cookie
- Verifies JWT signature + expiry (reuses `verifyCloudToken`)
- Resolves correct Location from the venue DB
- Returns fresh employee data for `login(employee)`

**`useRequireAuth` cloud awareness**
- Detects cloud mode via hostname (`.ordercontrolcenter.com` / `.barpos.restaurant`)
- When validate-session returns 401 in cloud mode:
  - Calls `GET /api/auth/cloud-session` to refresh from httpOnly cookie
  - If OK → `login(employee)` updates auth store silently
  - If failed → falls through to logout

**`SettingsNav` cloud UI**
- "Back to POS" → "Mission Control" link in cloud mode
- "Sign Out" button at bottom of sidebar (cloud mode only):
  - Calls `DELETE /api/auth/cloud-session` to clear httpOnly cookie
  - Clears POS auth store (`logout()`)
  - Redirects to Mission Control

### Commit 7fe120e — Settings layout guard (blocks children)

**`useCloudSessionGuard`** hook in settings layout:
- Validates auth store locationId on mount BEFORE rendering children
- If stale → refreshes from cloud session cookie
- Shows "Verifying session..." spinner until validation completes
- Prevents ANY settings page from using stale locationId

This was necessary because:
- The menu page uses `useAuthStore` directly (not `useRequireAuth`)
- The async validation in `useRequireAuth` was a race condition
- The layout guard blocks ALL children, covering every page

## Files

| File | Action |
|------|--------|
| `src/app/api/auth/validate-session/route.ts` | CREATED — locationId/employeeId check |
| `src/app/api/auth/cloud-session/route.ts` | MODIFIED — Added GET handler for cookie re-bootstrap |
| `src/hooks/useRequireAuth.ts` | MODIFIED — Cloud mode detection + re-bootstrap |
| `src/app/(admin)/settings/layout.tsx` | MODIFIED — `useCloudSessionGuard` blocks children until valid |
| `src/components/admin/SettingsNav.tsx` | MODIFIED — Cloud sign-out button, MC link |

## Cloud Auth Flow (after fix)

```
User visits fruita-bar-and-grill.ordercontrolcenter.com/settings
  │
  ├─ middleware.ts validates pos-cloud-session cookie (JWT)
  │   └─ Sets x-venue-slug header
  │
  ├─ Settings layout mounts
  │   └─ useCloudSessionGuard() fires
  │       ├─ Shows "Verifying session..." spinner
  │       ├─ Calls validate-session with current locationId
  │       │   └─ 401 (loc-1 not in venue DB)
  │       ├─ Calls GET /api/auth/cloud-session
  │       │   └─ Reads httpOnly cookie → resolves Location → returns employee
  │       ├─ login(employee) → auth store updated with correct locationId
  │       └─ Sets ready=true → children render with correct data
  │
  └─ Menu/ingredients pages load with correct locationId
```

## Key Design Decisions

1. **Layout-level guard > per-page hook**: Covers all settings pages without modifying each one
2. **Spinner blocks interaction**: Prevents race condition where user clicks before refresh completes
3. **GET endpoint reuses POST logic**: Same JWT verification + Location resolution, just reads from cookie instead of body
4. **Cloud mode detected client-side**: `window.location.hostname` check (matches CLOUD_PARENT_DOMAINS)
5. **Sign Out button**: Explicit UX for cloud users who were previously stuck with no way to clear their session
