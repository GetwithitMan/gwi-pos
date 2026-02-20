# Skill 395 — Venue-Local Admin Login + Clerk Auth

**Domain:** Auth / Cloud
**Date:** 2026-02-20
**Commits:** 4f2434d, f4947b1
**Addresses:** Venue-local authentication — login page, Clerk FAPI credential verification, bcrypt fallback, session cookie issuance

---

## Overview

Adds a self-contained login flow at each venue's subdomain (`{slug}.ordercontrolcenter.com/admin-login`). Phase 1 builds the login page and session infrastructure; Phase 2 replaces simple bcrypt-only auth with Clerk FAPI as the primary credential verifier, keeping bcrypt as a fallback for venues not yet migrated to Clerk.

---

## 1. `signVenueToken()` — Edge-Compatible JWT Signing

New export from `cloud-auth.ts` that signs venue session JWTs using the Web Crypto API (`crypto.subtle`) for full edge runtime compatibility (no Node.js `crypto` module dependency):

```typescript
import { signVenueToken } from '@/lib/cloud-auth'

const token = await signVenueToken(payload, secret, expiresInSeconds)
```

**Signature:**
```typescript
signVenueToken(
  payload: object,
  secret: string,
  expiresInSeconds?: number  // default: 28800 (8 hours)
): Promise<string>
```

**JWT payload shape:**
```typescript
{
  sub: string          // employee ID
  email: string        // employee email
  name: string         // employee display name
  slug: string         // venue slug
  orgId: string        // Clerk organization ID
  role: string         // employee role
  posLocationId: string // POS location ID
  iat: number          // issued-at (epoch seconds)
  exp: number          // expiry (epoch seconds, iat + 28800)
}
```

Uses `crypto.subtle.importKey` + `crypto.subtle.sign` with HMAC-SHA256, producing a base64url-encoded JWT compatible with edge middleware and serverless functions.

---

## 2. Admin Login Page — `/admin-login`

Dark-themed login form at `{slug}.ordercontrolcenter.com/admin-login`:

```
src/app/admin-login/page.tsx
```

- Email + password fields with form validation
- Submits POST to `/api/auth/venue-login`
- On success: redirects to `/settings` (or prior intended route)
- On error: displays inline error message
- Dark theme consistent with POS admin UI

---

## 3. Venue Login API — `POST /api/auth/venue-login`

The core authentication endpoint. Attempts Clerk FAPI verification first, falls back to bcrypt:

```
src/app/api/auth/venue-login/route.ts
```

### Authentication Flow

```
Client POST { email, password }
         │
         ▼
  ┌─── Clerk FAPI ───┐
  │  POST https://{clerk-domain}/v1/client/sign_ins
  │  body: { identifier, strategy:'password', password }
  │  Content-Type: application/x-www-form-urlencoded
  │  5s AbortController timeout
  │           │
  │     ┌─────┴─────┐
  │   success     failure
  │   (status     │
  │  'complete')  ▼
  │     │    ┌─── bcrypt fallback ───┐
  │     │    │  employee.password?   │
  │     │    │  verifyPassword()     │
  │     │    └───────┬───────────────┘
  │     │        ┌───┴───┐
  │     │      valid   invalid
  │     │        │       │
  │     ▼        ▼       ▼
  │   Issue    Issue    401
  │  session  session  Unauthorized
  └──────────────────────────────┘
```

### Clerk FAPI Domain Derivation

The Clerk Frontend API domain is derived from the publishable key at runtime:

```typescript
// NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = "pk_test_abc123..."
// Strip "pk_test_" or "pk_live_" prefix, base64-decode the remainder → Clerk domain
const clerkDomain = atob(publishableKey.replace(/^pk_(test|live)_/, ''))
```

### Session Cookie

On successful authentication, issues a `pos-cloud-session` cookie:

```typescript
cookies().set('pos-cloud-session', token, {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  path: '/',
  maxAge: 28800  // 8 hours
})
```

---

## 4. Venue Setup API — `POST /api/auth/venue-setup`

Bootstrap endpoint for provisioning venue admin credentials:

```
src/app/api/auth/venue-setup/route.ts
```

**Request:**
```typescript
POST /api/auth/venue-setup
Authorization: Bearer <PROVISION_API_KEY>  // or ?key= query param

{
  email: string,
  setupKey: string,
  newPassword: string
}
```

**Behavior:**
- Authenticated via `PROVISION_API_KEY` (header or query param)
- Creates or updates an Employee record with a hashed password
- Used by Mission Control during venue onboarding to set initial admin credentials

---

## 5. Middleware — Auth Redirect

Updated middleware to redirect unauthenticated users to the venue-local login page instead of the Mission Control sign-in URL:

```
src/middleware.ts
```

**Allowlist** (routes that bypass auth redirect):
| Route | Purpose |
|-------|---------|
| `/admin-login` | Login page itself |
| `/api/auth/venue-login` | Login API endpoint |
| `/api/auth/venue-setup` | Provisioning endpoint |

All other routes: if no valid `pos-cloud-session` cookie → redirect to `/admin-login`.

---

## Summary Table

| Change | File | Impact |
|--------|------|--------|
| `signVenueToken()` — Web Crypto JWT signing | `cloud-auth.ts` | Edge-compatible session tokens |
| Admin login page (dark theme) | `admin-login/page.tsx` | Venue-local login UI |
| Clerk FAPI primary auth + bcrypt fallback | `venue-login/route.ts` | Dual-path credential verification |
| Clerk domain derivation from publishable key | `venue-login/route.ts` | No hardcoded Clerk URLs |
| `pos-cloud-session` cookie (8h, httpOnly) | `venue-login/route.ts` | Secure session management |
| Venue setup/provisioning endpoint | `venue-setup/route.ts` | MC-driven credential bootstrap |
| Middleware auth redirect to `/admin-login` | `middleware.ts` | Self-contained venue auth |
