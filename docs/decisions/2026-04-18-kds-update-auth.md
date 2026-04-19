# KDS Fleet-Update Authentication — Decision

**Date:** 2026-04-18
**Status:** Proposed (needs user sign-off)
**Tracks:** Task #22
**Context source:** `monument-canary-partial.md`, Monument Steakhouse canary 2026-04-18

---

## Problem

KDS (pitboss + foodkds + delivery) devices cannot authenticate to the fleet update routes (`/api/android/update/latest`, `/api/android/update/events`). They get 401 on every poll.

Root cause: KDS's existing API (`/api/kds?locationId=...&screenId=...`) uses **LAN-trusted query-param auth**, not Bearer. `KDSScreen` Prisma model has NO `deviceToken` field. KDS pairing does not produce a token. The client (`kdsPreferences.getDeviceToken()`) always returns null, so KDS's `AuthInterceptor` never attaches a Bearer header even after v1.1.1 wired up the format.

Phase 8's `update/` subsystem copied the Bearer-auth pattern from register/PAX because that was the canonical design in the plan. The plan didn't anticipate KDS's pre-existing LAN-trust auth model. Monument surfaced the mismatch.

**Impact:** Every KDS device at every venue is stuck at its current `versionCode` (1) until this is fixed. The v1.1.1 artifact is live in R2 + MC, but no KDS will ever pull it.

## Non-goals

- Changing KDS's existing `/api/kds` endpoint auth model
- Issuing Bearer tokens to _all_ LAN-only devices (too much blast radius)
- Backporting fleet auth to pre-Phase-8 KDS versions

## Options

### Option A — NUC-side LAN-scoped auth for KDS

**What:** Extend NUC's `/api/android/update/_auth.ts` so that when `app` query param matches `KDS_*`, the auth helper accepts a `cloudLocationId` query parameter in lieu of a Bearer token. Validate the provided `cloudLocationId` matches this NUC's own `CLOUD_LOCATION_ID` env (or `Location.cloudLocationId` row). No Bearer, no token lookup.

**Security model:**
- LAN-only traffic already assumed trusted for `/api/kds`
- `cloudLocationId` matches NUC identity ⇒ request originates from this venue's LAN
- `deviceFingerprint` still required as a query param (exists today)
- No cross-venue risk — a KDS can only ask about its own venue's channel

**Device change:**
- KDS `UpdateClient.kt` sends `?locationId=<cached from pairing>&deviceFingerprint=...&versionCode=...&app=KDS_FOODKDS`
- No Bearer header needed
- `KdsPreferences.getLocationId()` already exists — use it

**Server change:**
- `authenticateAndroidUpdate(request)` evolves: accepts `request` (not just token string) so it can read query params
- If Bearer present → existing path (cellular → session → terminal)
- If Bearer absent AND `app=KDS_*` AND `locationId` query matches NUC identity → accept with synthesized auth object `{ locationId, tokenKind: 'kds-lan' }`
- Otherwise 401 as today

**Pros:**
- One file change on NUC (`_auth.ts` + calling routes)
- Zero schema change
- Zero pairing-flow change
- Matches KDS's existing auth model exactly
- Fast to ship + validate

**Cons:**
- Two auth models in the update route (Bearer vs LAN-scope) — slight cognitive overhead in future audits
- If KDS ever needs cloud/cellular fleet auth (e.g., remote observability beyond LAN), this model doesn't extend
- Relies on LAN trust — a device that somehow plugs into the LAN with a spoofed locationId could poll. Existing `/api/kds` has the same risk, so this doesn't regress anything.

### Option B — Real KDS pairing + `deviceToken`

**What:** Add `deviceToken String? @unique` to `KDSScreen` Prisma model. Build or extend a KDS pairing endpoint that mints a token. Return it to the device. KDS stores in prefs. KDS `AuthInterceptor` now has a real Bearer to send.

**Pros:**
- Unifies all app kinds under a single auth model (cleaner long-term)
- Enables future remote/cellular auth for KDS without another redesign
- First-class audit trail (token rotation, revocation, per-device visibility)

**Cons:**
- Schema migration (`KDSScreen.deviceToken`)
- New pairing-flow code: KDS pairing UI + `/api/kds/pair` endpoint + MC admin UI to issue/rotate tokens
- Every existing KDS in the fleet needs to be re-paired (migration operation at every venue)
- Larger surface, larger review, more places to break
- Overkill for a LAN-only device that has never needed cloud auth

## Recommendation

**Choose Option A (LAN-scoped auth on NUC).**

Reasoning:
- KDS is LAN-only by design. The existing `/api/kds` endpoint already trusts LAN + `locationId` + `screenId` for real-time order data. If we accept that trust model for kitchen tickets (which directly drive operations), it's consistent to accept it for fleet-update metadata.
- Option B's migration cost is high (schema + MC UI + per-venue re-pairing) for a payoff that's only meaningful if KDS gets cloud-auth features that aren't on any roadmap.
- A can always upgrade to B later. The reverse is also true but both require schema work either way.

The only _architectural_ reason to prefer B is "consistency across app kinds." But KDS is already architecturally distinct (LAN-only, multi-flavor, per-screen room routing via `screenId`) — consistency here is shallow.

## Acceptance criteria for A

- [ ] NUC `authenticateAndroidUpdate` accepts request (not raw token) so it can read query params
- [ ] When `app=KDS_*` and no Bearer header, validates `locationId` query matches NUC identity; returns synthesized auth object on match
- [ ] Existing Bearer paths (cellular / session / terminal) unchanged
- [ ] Both `/api/android/update/latest` and `/api/android/update/events` covered
- [ ] KDS `UpdateClient.kt` drops Bearer usage for these two endpoints, sends `locationId` query param instead
- [ ] KDS `UpdateEventReporter.flush()` same
- [ ] KDS canary at Monument successfully polls + gets 200 + registers a `CHECKED` event
- [ ] Unit test: non-KDS app without Bearer still returns 401 with generic `Authentication required`
- [ ] Unit test: `app=KDS_FOODKDS&locationId=<wrong>` returns 401

## Rollout order

1. NUC change in `gwi-pos` (auth helper + route call sites)
2. Deploy to Monument NUC (reuses existing gwi-node deploy flow)
3. KDS client change in `gwi-kds-android` — remove Bearer requirement for update endpoints, send `locationId`
4. Tag `v1.2.0` KDS (or whatever's next)
5. Canary validation at Monument (#19 KDS devices already staged, no token migration needed)
6. Promote per §2 runbook

## Budget

~3h NUC + ~2h KDS client + ~1h canary. Same-day ship plausible once decision is approved.

## Do not

- Do not couple this to Task #23 stale-token recovery. They're independent.
- Do not backport to KDS v1.0.0. That version predates the update subsystem entirely; nothing to send.
- Do not add the LAN-scoped path for anything other than `KDS_*` appKinds. Future fleet-auth hardening depends on non-KDS paths staying Bearer-only.

## Alternatives considered and rejected

- **Session token from `/api/kds?screenId=...`** (return token in response header, KDS caches it, uses as Bearer): adds cross-endpoint coupling, still requires NUC-side token minting, doesn't improve on Option A.
- **Whitelist of device fingerprints per-NUC**: requires admin UI to maintain; brittle as fingerprints change; adds state for no gain.
- **Shared fleet-wide HMAC secret on KDS apps**: rotates across every KDS in the fleet simultaneously, hard to revoke one device, high blast radius.
