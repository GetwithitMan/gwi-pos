# GWI POS — Code Review Log

Companion to `docs/CODE-REVIEW-CHECKLIST.md`.
Records every review session: files covered, status per file, and all findings with severity.

**Reviewer:** Brian Lewis + Claude Code
**Started:** 2026-02-21
**Checklist:** `docs/CODE-REVIEW-CHECKLIST.md` (284 files, 9 tiers)

---

## Cross-References

| Document | Location | What It Covers |
|----------|----------|----------------|
| **Forensic Audit** (10-agent, Feb 18) | `docs/audits/FORENSIC-AUDIT-2026-02-18.md` | Pre-existing audit: hard deletes, missing filters, N+1s, sockets, performance — Waves 1–6H complete |
| **Forensic Audit Resume** | `docs/audits/FORENSIC-AUDIT-RESUME.md` | State summary for resuming the forensic audit |
| **Living Log** | `docs/logs/LIVING-LOG.md` | Session-by-session development record (commits, deploys, features, bugs) |
| **Code Review Checklist** | `docs/CODE-REVIEW-CHECKLIST.md` | All 284 files organized into 9 priority tiers |
| **This Log** | `docs/logs/CODE-REVIEW-LOG.md` | Manual code review trail — findings, owners, remediations |

> **Note for new engineers:** Start with the Forensic Audit for the macro picture (what was already found and fixed system-wide), then use this log for the file-by-file deep review. The Living Log tells you what changed and when.

---

## Open Issues Tracker

All findings across all sessions. Cleared when resolved.

| # | Severity | File | Issue | Owner | Remediation | Status |
|---|----------|------|-------|-------|-------------|--------|
| 001 | ⚠️ Medium | `src/middleware.ts` | `PROVISION_API_KEY` falls back to empty string `''` if env var is missing. `verifyCloudToken()` would accept JWTs signed with an empty key in that scenario. | Infra | Add hard startup guard in prod: `if (!process.env.PROVISION_API_KEY && process.env.NODE_ENV === 'production') throw new Error(...)` | Open |
| 002 | ⚠️ Medium | `src/lib/api-auth.ts` | Soft-mode bypass (lines 38–46) skips auth entirely when no `employeeId` is provided and `options.soft` is true. Downstream code checking only `authorized: true` without inspecting permissions is unguarded. | BE-A | Remove `soft` mode after all UI pages send `employeeId` (tracked in PM-TASK-BOARD.md). Audit every `requirePermission(..., { soft: true })` call site first. | Open |
| 003 | 🔵 Low | `src/lib/auth-utils.ts` | Unused variable `requiredParts` on line 16 — `requiredPermission.split('.')` result is never read. | BE-A | Delete line 16. | Open |
| 004 | 🔵 Low | `src/lib/db.ts` | `READ_ACTIONS` constant (Set of read operation names, line 18) is defined but never used. The actual soft-delete guard lives in the Prisma extension, not this set. | BE-A | Delete the `READ_ACTIONS` constant. | Open |
| 005 | 🔵 Low | `src/lib/db.ts` | `NO_SOFT_DELETE_MODELS` must be kept manually in sync with schema models that lack `deletedAt`. No automated safety net. | BE-A | Add a comment to `schema.prisma` template reminding devs to add new no-`deletedAt` models here. | Open |
| 006 | 🔴 Critical | `prisma/schema.prisma` | `Employee.bankAccountNumber String?` is stored in plaintext. This is a W-2 direct deposit field containing real routing + account numbers. Unencrypted PII/financial data in the database. | Infra | Encrypt at application layer before write (e.g., AES-256-GCM using a `BANK_ENCRYPTION_KEY` env var). Store as encrypted blob, decrypt on read. Mark `bankRoutingNumber` the same way. Do before any payroll feature is live. | Open |
| 007 | ⚠️ Medium | `src/lib/cloud-auth.ts` | `verifyCloudToken()` checks `if (payload.exp && ...)` — if `exp` is `0` or missing, the expiry check is skipped entirely, making such a token permanently valid. Requires PROVISION_API_KEY to exploit, but is a logic error. | BE-A | Change to `if (!payload.exp \|\| payload.exp < Math.floor(Date.now() / 1000)) return null` — same fix pattern as `verifyOwnerToken`. | Open |
| 008 | ⚠️ Medium | `src/lib/cloud-auth.ts` | `CLOUD_BLOCKED_PATHS` in `isBlockedInCloudMode()` is a **blocklist** of POS routes. Any new POS route (e.g., a future `/queue` or `/drive-thru` screen) is accessible from cloud mode by default until explicitly added to this list. An allowlist of admin routes is safer. | BE-A | Consider inverting to an allowlist: `CLOUD_ALLOWED_PATHS = ['/settings', '/menu', '/employees', '/reports', ...]`. New routes are denied in cloud mode until explicitly allowed. | Open |
| 009 | 🔵 Low | `src/lib/access-log.ts` | `ensureTable()` runs `CREATE TABLE IF NOT EXISTS` on every read AND write call. This is a DB round-trip on every log event (typically 2–3 per access attempt). | BE-A | Call `ensureTable()` once at module init (top-level `await` or singleton pattern) rather than per call. | Open |

**Severity key:**
- 🔴 Critical — active security/data risk, fix before next deploy
- ⚠️ Medium — real risk, fix before go-live
- 🔵 Low — code quality / maintainability / minor performance
- ℹ️ Info — note for awareness, no action required

**Owner key:**
- `BE-A` — Back-end application developer
- `Infra` — Infrastructure / DevOps (env vars, encryption keys, Vercel config)

---

## Session 2 — 2026-02-21

**Theme:** Tier 1 — Security & Auth (remaining auth files) + Schema
**Tier coverage:** Tier 1: 11/37 complete (+4 this session)

### Files Reviewed

| File | Lines | Status | Findings |
|------|-------|--------|----------|
| `src/lib/cloud-auth.ts` | 215 | ✅ Solid | Issues #007, #008 — expiry logic bug + blocklist risk |
| `src/lib/access-gate.ts` | 170 | ✅ Clean | None — stateless HMAC OTP is well-implemented |
| `src/lib/access-log.ts` | 104 | ✅ Clean | Issue #009 — ensureTable called per-request |
| `prisma/schema.prisma` | 6,630 | ✅ Solid | Issue #006 — Employee.bankAccountNumber plaintext |

### Session Notes

**`cloud-auth.ts`** — Two token types in one file: `CloudTokenPayload` (PROVISION_API_KEY signed, 8h, slug-bound, from MC) and `OwnerTokenPayload` (same key, 10min, email + venue list). The `signVenueToken` function mirrors MC's format exactly so `verifyCloudToken` validates both. `verifyOwnerToken` is the better-written expiry check — the inconsistency with `verifyCloudToken` is Issue #007. The `CLOUD_BLOCKED_PATHS` blocklist approach (Issue #008) is the highest-priority thing to address before scaling to more POS route areas.

**`access-gate.ts`** — Clean stateless HMAC OTP implementation. Uses first 4 bytes of SHA-256 HMAC → mod 1,000,000 → zero-pad to 6 digits. This is functionally equivalent to a simplified TOTP. The 20-minute grace window (current + previous window) is appropriate. No brute-force protection at the library level, but that's correctly handled by the rate-limit cookie in the API route. `normalizePhone` accepts non-US numbers, but the API layer validates US-only — acceptable layering.

**`access-log.ts`** — All queries use parameterized tagged-template SQL (injection-safe). Non-fatal logging is correct for a gate log. The `ensureTable` per-call pattern works but adds unnecessary round-trips (Issue #009). Raw Neon driver usage (no Prisma migration) is the right call here — the table sits outside the multi-tenant venue schema.

**`schema.prisma`** (key models reviewed: `Organization`, `Location`, `Customer`, `Role`, `Employee`, `EmployeeRole`, `Order`, `Payment`, `SyncAuditEntry`):

- Every model reviewed has `locationId` + `@@index([locationId])` ✅
- Every model reviewed has `deletedAt DateTime?` + `syncedAt DateTime?` ✅ (except `Organization`/`Location` which are intentionally in `NO_SOFT_DELETE_MODELS`)
- **Order model** is exemplary — `offlineId @unique`, `idempotencyKey @unique`, `offlineIntentId @unique`, optimistic locking `version`, 18 compound indexes. Offline sync was clearly well-engineered.
- **Payment model** — `idempotencyKey @unique` + `offlineIntentId @unique` are the critical deduplication guards. Both `voidedAt/voidedBy` and `refundedAmount/refundedAt` are tracked separately — correct (void ≠ refund). `settledAt` for batch settlement tracking is forward-thinking.
- **Employee model** — Complete payroll data including W-4 fields, YTD earnings, bank account info. `bankAccountNumber` stored plaintext is Issue #006 — the comment in the schema even says "Should be encrypted in production." This is the only critical finding in the schema review.
- **Role model** — `permissions Json?` is nullable. This is handled safely: `api-auth.ts` casts it as `(employee.role.permissions as string[]) || []`, so a null role gets `[]` permissions. Correct fallback behavior.

### Payment Risk Classes (Preview for Datacap session)

When reviewing Datacap files (next Tier 1 session), check these specific risk classes:
- **Idempotency** — Does every charge path check `idempotencyKey` before writing? Does the offline payment manager deduplicate on `offlineIntentId`?
- **Precision** — Are all monetary values handled as `Decimal` (Prisma) and never as JS `number`? Look for `parseFloat`, `toFixed`, or raw arithmetic on money fields.
- **Timeouts** — Does the Datacap client have explicit timeouts? What happens to the order state if a payment request times out mid-flight?
- **Auth** — Do all payment API routes call `requirePermission(..., 'pos.card_payments')` or equivalent before touching Datacap?
- **Error paths** — Does a Datacap failure (network error, declined) leave the order in a recoverable state? Are partial approvals handled?

---

## Session 1 — 2026-02-21

**Theme:** Tier 1 — Security & Authentication (core auth + DB layer)
**Tier coverage:** Tier 1: 7/37 complete

### Files Reviewed

| File | Lines | Status | Findings |
|------|-------|--------|----------|
| `src/middleware.ts` | 244 | ✅ Solid | Issue #001 — PROVISION_API_KEY empty fallback |
| `src/lib/auth.ts` | 63 | ✅ Clean | None |
| `src/lib/auth-utils.ts` | 460 | ✅ Solid | Issue #003 — unused `requiredParts` variable |
| `src/lib/api-auth.ts` | 178 | ✅ Solid | Issue #002 — soft-mode bypass (tracked, deferred) |
| `src/lib/db.ts` | 304 | ✅ Very solid | Issues #004, #005 — dead code + manual sync list |
| `src/lib/with-venue.ts` | 69 | ✅ Clean | None |
| `src/lib/request-context.ts` | 34 | ✅ Clean | None |

### Session Notes

Architecture quality: High. The multi-tenant Prisma proxy pattern (`db.ts`) is well-engineered — the JS Proxy intercepts every property access and resolves the correct PrismaClient at call time from a 3-tier chain (AsyncLocalStorage → x-venue-slug header → master). No silent fallback to master DB when a slug is present but invalid (`with-venue.ts` returns 500 instead). Permission system is solid: 60+ granular permissions, wildcard pattern matching (`pos.*`), 9 default role templates, clean separation between client-safe utilities (`auth-utils.ts`) and server-side DB-backed validation (`api-auth.ts`). The soft-mode bypass is the only real concern and is already tracked.

---

## Tier 1 Summary

_To be written when all 37 Tier 1 files are reviewed. Will consolidate critical/medium issues by theme: auth, DB, payments._

---

## Checklist Progress

| Tier | Files | Reviewed | Remaining |
|------|-------|----------|-----------|
| Tier 1 — Critical | 37 | 11 | 26 |
| Tier 2 — Core Business Logic | 52 | 0 | 52 |
| Tier 3 — Core POS Pages | 42 | 0 | 42 |
| Tier 4 — Menu, Printing, Hardware | 38 | 0 | 38 |
| Tier 5 — Admin Pages | 38 | 0 | 38 |
| Tier 6 — Reports | 26 | 0 | 26 |
| Tier 7 — Mobile & Public | 10 | 0 | 10 |
| Tier 8 — System & Infrastructure | 19 | 0 | 19 |
| Tier 9 — Supporting Code | 22 | 0 | 22 |
| **Total** | **284** | **11** | **273** |

---

_Prepend new sessions above Session 2. Update the progress table and Open Issues Tracker each session._
