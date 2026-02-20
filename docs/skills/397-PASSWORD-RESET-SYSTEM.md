# Skill 397 — Password Reset System (Venue Self-Service + MC Admin Trigger)

**Domain:** Auth / Cloud
**Date:** 2026-02-20
**Commits:** fdd4bd9 (gwi-pos), 82624df (gwi-mission-control)
**Addresses:** Merchant self-service forgot-password, MC admin-triggered reset, Clerk FAPI email_code strategy, venue-domain-locked flow

---

## Overview

Merchants can reset their password without ever leaving their venue subdomain. The login page gains `forgot` and `verify` modes that drive the entire reset flow via Clerk FAPI server-side — no hosted UI, no redirects to `app.thepasspos.com`. GWI admins in Mission Control can also trigger a reset on behalf of an owner and share a copyable deep-link that drops the merchant directly into the code-entry step.

---

## Core Design Principle

**Merchants must never see `app.thepasspos.com` or any Clerk-hosted URL.**

All password reset flows stay on `{slug}.ordercontrolcenter.com`. Clerk FAPI's `reset_password_email_code` strategy handles everything server-side: it sends a 6-digit code to the merchant's email (not a redirect link), so the entire UX lives inside the venue subdomain.

---

## Architecture

```
FLOW A — Merchant Self-Service
─────────────────────────────
{slug}.ordercontrolcenter.com/admin-login
         │
         ▼ "Forgot your password?"
   'forgot' mode: enter email
         │
         ▼ POST /api/auth/forgot-password
   Clerk FAPI: initiate reset_password_email_code
   → returns { signInId }   (always 200 — no enumeration)
         │
         ▼ switch to 'verify' mode
   Enter 6-digit code from email + new password
         │
         ▼ POST /api/auth/reset-password
   Step 1: attempt_first_factor (code + password)
     status 'complete'         → done
     status 'needs_new_password' → Step 2: reset_password
         │
         ▼ switch to 'login' mode
   Green banner: "Password updated. Please log in."


FLOW B — MC Admin Trigger
─────────────────────────
app.thepasspos.com → Location detail → Overview tab
         │
         ▼ Owner Access card (OwnerResetCard)
   Fetch GET /api/admin/locations/[id]/owners
   → lists owner emails (role='owner', isActive=true)
         │
         ▼ "Send Reset" button
   POST /api/admin/locations/[id]/send-owner-reset { email }
   → Clerk FAPI initiates reset for owner
   → returns { resetLink: 'https://{slug}.occ.com/admin-login?reset_sid={signInId}' }
         │
         ▼ MC shows link with Copy button
   GWI admin shares with merchant (Slack, phone, etc.)
         │
         ▼ Merchant clicks link
   Lands in 'verify' mode with signInId pre-loaded
   Enters code from Clerk email + new password → done
```

---

## 1. Mode State Machine (admin-login/page.tsx)

The login page manages four modes:

```typescript
type LoginMode = 'login' | 'picking' | 'forgot' | 'verify'
```

| Mode | Displayed UI | Entry Point |
|------|-------------|-------------|
| `'login'` | Standard email + password form | Default on mount |
| `'picking'` | Venue picker (Skill 396) | Multi-venue owner after Clerk auth |
| `'forgot'` | Email input, "Send Reset Email" button | "Forgot your password?" link |
| `'verify'` | 6-digit code + new password fields | After forgot submit, or `?reset_sid=` param on mount |

### `?reset_sid=` Deep-Link Handling

On component mount, a `useEffect` reads `useSearchParams()`. If `reset_sid` is present, the page immediately switches to `'verify'` mode and stores the `signInId` — dropping the merchant straight into the code-entry step without requiring them to go through the email form.

```typescript
useEffect(() => {
  const sid = searchParams.get('reset_sid')
  if (sid) {
    setSignInId(sid)
    setMode('verify')
  }
}, [])
```

### "Forgot your password?" Button

Placed below the login form. Pre-fills the email field in `'forgot'` mode with whatever email the user already typed in the login form.

---

## 2. Flow A — Merchant Self-Service Detail

### Step 1 — Initiate Reset (`POST /api/auth/forgot-password`)

```
src/app/api/auth/forgot-password/route.ts  (gwi-pos)
```

**Request:**
```typescript
{ email: string }
```

**Logic:**
1. Wrapped with `withVenue()` for venue context
2. Calls Clerk FAPI:
   ```
   POST {fapi}/v1/client/sign_ins
   Content-Type: application/x-www-form-urlencoded
   Body: identifier={email}&strategy=reset_password_email_code
   ```
3. Extracts `signInId` from Clerk response
4. Always returns HTTP 200 with `{ signInId }` — even if the email is not found — to prevent account enumeration

**Response:**
```typescript
{ signInId: string }
```

### Step 2 — Verify Code + Set Password (`POST /api/auth/reset-password`)

```
src/app/api/auth/reset-password/route.ts  (gwi-pos)
```

**Request:**
```typescript
{ signInId: string, code: string, password: string }
```

**Logic:**
1. Wrapped with `withVenue()` for venue context
2. Step 1 — Attempt first factor:
   ```
   POST {fapi}/v1/client/sign_ins/{signInId}/attempt_first_factor
   Body: strategy=reset_password_email_code&code={code}&password={password}
   ```
3. Check `status` in Clerk response:
   - `'complete'` → success, return 200
   - `'needs_new_password'` → proceed to Step 2
4. Step 2 (if needed) — Set new password:
   ```
   POST {fapi}/v1/client/sign_ins/{signInId}/reset_password
   Body: password={password}
   ```
5. On success: return 200

**On success in UI:** switch to `'login'` mode, display green banner: `"Password updated. Please log in."`

---

## 3. Flow B — MC Admin Trigger Detail

### Owner List (`GET /api/admin/locations/[id]/owners`)

```
src/app/api/admin/locations/[id]/owners/route.ts  (gwi-mission-control)
```

**Auth:** Clerk `auth()` — GWI admin session required

**Logic:** Queries `AdminUser` where `role = 'owner'` and `isActive = true` for the location's organization. Returns a list of owner emails to display in the card.

**Response:**
```typescript
{
  owners: Array<{ email: string, name: string }>
}
```

### Send Reset (`POST /api/admin/locations/[id]/send-owner-reset`)

```
src/app/api/admin/locations/[id]/send-owner-reset/route.ts  (gwi-mission-control)
```

**Auth:** Clerk `auth()` — GWI admin session required

**Request:**
```typescript
{ email: string }
```

**Logic:**
1. Calls Clerk FAPI `reset_password_email_code` for the owner's email (same initiation call as Flow A's `/api/auth/forgot-password`)
2. Reads the venue's slug from the `CloudLocation` record
3. Constructs the deep-link:
   ```
   https://{slug}.ordercontrolcenter.com/admin-login?reset_sid={signInId}
   ```
4. Returns the link to MC — the route itself does not email or message the merchant

**Response:**
```typescript
{ resetLink: string }
```

### OwnerResetCard Component

```
src/components/admin/OwnerResetCard.tsx  (gwi-mission-control)
```

- Dark card styling — matches `VenueUrlCard` visual language
- On mount: fetches `GET /api/admin/locations/[id]/owners`, lists owner emails
- Each owner row has a "Send Reset" button
- On click: calls `send-owner-reset`, displays the returned link
- Link is shown in a read-only input with a **Copy** button (uses `navigator.clipboard.writeText`)
- Placed in the Overview tab of Location detail, above `VenueUrlCard`

---

## 4. Clerk FAPI Helper

Both repos use the same `getClerkFapiUrl()` pattern (local copy per route, consistent with venue-login from Skill 395):

```typescript
function getClerkFapiUrl(): string {
  const pk = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY!
  const base64 = pk.replace(/^pk_(test|live)_/, '')
  const decoded = Buffer.from(base64, 'base64').toString('utf8').replace(/\$$/, '')
  return `https://${decoded}`
}
```

All Clerk FAPI calls share these conventions:

| Convention | Value |
|------------|-------|
| Content-Type | `application/x-www-form-urlencoded` |
| Body encoding | `URLSearchParams` |
| Timeout | `AbortSignal.timeout(5000)` |
| Auth | None required (public FAPI endpoint) |

---

## 5. Middleware Allowlist Update (POS)

```
src/middleware.ts  (gwi-pos)
```

Two new routes added to the cloud allowlist so they are accessible without a session cookie:

| Route | Purpose |
|-------|---------|
| `/api/auth/forgot-password` | Initiate password reset — must be reachable before login |
| `/api/auth/reset-password` | Complete password reset — must be reachable before login |

---

## 6. Files Changed

### gwi-pos (fdd4bd9)

| File | Change | Notes |
|------|--------|-------|
| `src/app/admin-login/page.tsx` | Modified | Added `'forgot'`/`'verify'` modes, `useEffect` + `useSearchParams` for `?reset_sid=`, `handleForgot`/`handleReset` functions, shared `PageWrapper`/`Logo`/`Spinner` components |
| `src/app/api/auth/forgot-password/route.ts` | New | `withVenue`, Clerk FAPI initiate, returns `signInId` |
| `src/app/api/auth/reset-password/route.ts` | New | `withVenue`, two-step Clerk FAPI attempt + reset |
| `src/middleware.ts` | Modified | Added `/api/auth/forgot-password` and `/api/auth/reset-password` to cloud allowlist |

### gwi-mission-control (82624df)

| File | Change | Notes |
|------|--------|-------|
| `src/components/admin/OwnerResetCard.tsx` | New | Dark card (matches `VenueUrlCard` styling), owner list, Send Reset button, copyable link |
| `src/app/api/admin/locations/[id]/owners/route.ts` | New | Clerk auth, returns `AdminUser` owners for location org |
| `src/app/api/admin/locations/[id]/send-owner-reset/route.ts` | New | Clerk auth, calls Clerk FAPI, returns `resetLink` |
| `src/app/dashboard/locations/[id]/page.tsx` | Modified | Added `OwnerResetCard` above `VenueUrlCard` in Overview tab |

---

## 7. Error Handling & Edge Cases

| Scenario | Behavior |
|----------|----------|
| Email not found in Clerk | `/api/auth/forgot-password` still returns 200 + a dummy `signInId` — prevents account enumeration |
| Wrong 6-digit code | Clerk FAPI returns 422; `/api/auth/reset-password` returns error to UI |
| Expired code (10-minute window) | Clerk FAPI returns 410 or 422; UI shows error, merchant can restart flow |
| `?reset_sid=` param present on mount | `useEffect` fires before render settles; page skips `'forgot'` step entirely |
| Clerk returns `needs_new_password` | Two-step flow handles it automatically — no user-visible difference |
| MC Clerk FAPI call fails | `/api/admin/locations/[id]/send-owner-reset` returns 502; MC shows error in card |
| Owner list empty | `OwnerResetCard` renders empty state ("No owners found") |

---

## 8. Security Notes

- **No account enumeration:** `/api/auth/forgot-password` always returns 200 regardless of whether the email exists in Clerk
- **Codes are single-use:** Clerk invalidates the code after one successful `attempt_first_factor` call
- **Codes expire in 10 minutes:** Clerk enforces this server-side
- **`reset_sid` in URL is not a secret:** It is a Clerk `signInId`, not a token. Without the correct 6-digit code from the Clerk email, it cannot be used to reset a password
- **MC reset trigger requires GWI admin session:** Both MC routes are protected by `auth()` — only logged-in GWI staff can trigger owner resets

---

## Summary Table

| Change | File | Repo | Impact |
|--------|------|------|--------|
| `'forgot'` / `'verify'` modes + `?reset_sid=` handling | `admin-login/page.tsx` | POS | Self-service reset UI on venue subdomain |
| Forgot-password initiation endpoint | `forgot-password/route.ts` | POS | Clerk FAPI `email_code` initiate, enumeration-safe |
| Reset-password completion endpoint | `reset-password/route.ts` | POS | Two-step Clerk FAPI attempt + reset |
| Middleware allowlist expansion | `middleware.ts` | POS | `/api/auth/forgot-password`, `/api/auth/reset-password` |
| Owner list endpoint | `locations/[id]/owners/route.ts` | MC | Returns active owners for a location |
| Send-reset endpoint | `locations/[id]/send-owner-reset/route.ts` | MC | Clerk FAPI trigger + deep-link construction |
| Owner Access card | `OwnerResetCard.tsx` | MC | Dark card with owner list + copyable reset link |
| Location detail page | `locations/[id]/page.tsx` | MC | `OwnerResetCard` added to Overview tab |
