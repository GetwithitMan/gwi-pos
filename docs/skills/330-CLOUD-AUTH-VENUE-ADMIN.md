# Skill 330: Cloud Auth — Venue Admin Access via Mission Control

**Status:** DONE
**Date:** February 12, 2026
**Domain:** Mission Control (cross-domain: POS + MC)
**Commits:**
- POS: `8fa4a03` — cloud auth: admin-only access for venue owners via Mission Control
- POS: `501666b` — support *.ordercontrolcenter.com venue subdomains in middleware
- POS: `8801810` — multi-tenant infrastructure: subdomain routing, per-venue Neon DBs, provisioning API
- POS: `e7a4ee5` — fix: resolve Uint8Array BufferSource type mismatch
- POS: `a1a8352` — fix: remove deletedAt filter from Location query
- POS: `5a6a8c4` — fix: cloud auth gracefully handles missing venue database
- MC: `f24e826` — POS access token generation for cloud venue admin

## Overview

Enables Mission Control admins to access POS admin pages at `{slug}.ordercontrolcenter.com` without needing a local PIN login. Authentication flows through Clerk (on MC) into a signed JWT that POS validates.

## Authentication Flow

```
1. Admin clicks "Open POS Admin" in MC sidebar
2. MC redirects to /pos-access/{slug}
3. Clerk middleware ensures admin is authenticated
4. getVenueAdminContext() validates org membership
5. MC generates HMAC-SHA256 signed JWT with user claims
6. Redirect to https://{slug}.ordercontrolcenter.com/auth/cloud?token=xxx
7. POS middleware detects cloud domain
8. POS /auth/cloud page sends token to POST /api/auth/cloud-session
9. Server validates JWT signature + expiry
10. Creates httpOnly session cookie (8 hours)
11. Returns employee data for client-side auth store
12. Admin sees POS settings pages (menu, employees, floor plan, etc.)
```

## Security

| Feature | Implementation |
|---------|---------------|
| Token signing | HMAC-SHA256 with shared `PROVISION_API_KEY` secret |
| Token lifetime | 8 hours |
| Slug binding | JWT's `slug` must match venue being accessed |
| Cookie security | httpOnly, Secure (production), SameSite=lax, path=/ |
| Route blocking | POS ordering routes blocked in cloud mode (login, orders, kds, etc.) |
| Permission | Cloud admin gets `['admin']` permission array |

## Key Files

### POS
- `src/lib/cloud-auth.ts` — `CloudTokenPayload` interface, `verifyCloudToken()`, `isBlockedInCloudMode()`
- `src/app/api/auth/cloud-session/route.ts` — POST (validate + create session), DELETE (logout)
- `src/app/(auth)/auth/cloud/page.tsx` — Client page that receives token from URL and POSTs to cloud-session
- `src/middleware.ts` — Detects cloud subdomains, checks session cookie, blocks POS routes

### MC
- `src/lib/pos-access-token.ts` — `PosTokenPayload`, `generatePosAccessToken()`, HMAC-SHA256 JWT signing
- `src/app/pos-access/[slug]/page.tsx` — Server component that validates access, generates JWT, redirects

## Cloud vs Local Mode

| Feature | Local Mode | Cloud Mode |
|---------|------------|------------|
| Auth | PIN login | MC Clerk + JWT |
| Access | Full POS + Admin | Admin pages only |
| Routes | All routes | Settings/admin only |
| Session | Employee-based | Cloud admin session |
| Cookie | None | `pos-cloud-session` |

## Blocked Routes in Cloud Mode

```
/login, /orders, /kds, /entertainment, /cfd, /mobile, /tabs, /crew, /pay-at-table, /tips, /approve-void
```

## Environment Variables

| Variable | App | Purpose |
|----------|-----|---------|
| `PROVISION_API_KEY` | Both | Shared secret for JWT signing/verification |
| `NEXT_PUBLIC_CLOUD_DOMAIN` | POS | Domain for cloud mode detection (ordercontrolcenter.com) |
