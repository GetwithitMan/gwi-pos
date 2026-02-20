# Skill 393 — Datacap Production Safety Guards

**Domain:** Payments
**Date:** 2026-02-20
**Commit:** 14de60e
**Addresses:** Third-party audit §5, §7 — Config hardening, security, and API route safety

---

## Overview

A set of production-safety guardrails added across the Datacap stack to prevent accidental simulated-mode deployments, SimScenario XML leaking to the wire, rawXml accumulation in logs, and internal write endpoints being called via public env vars.

---

## Guard 1: Simulated Mode Blocked in Production

`validateDatacapConfig()` now throws if `communicationMode === 'simulated'` when `NODE_ENV === 'production'`.

```typescript
// types.ts — validateDatacapConfig
if (communicationMode === 'simulated' && process.env.NODE_ENV === 'production') {
  throw new Error(
    'Simulated communication mode is not allowed in production. ' +
    'Set communicationMode to "local" or "cloud" and configure real Datacap credentials.'
  )
}
```

This fires at `DatacapClient` construction time — the server fails loudly at startup if misconfigured rather than silently processing fake payments.

---

## Guard 2: SimScenario XML Tag Blocked in Production

`buildRequest()` no longer emits `<SimScenario>` in production:

```typescript
// xml-builder.ts
if (fields.simScenario && process.env.NODE_ENV !== 'production') {
  parts.push(`<SimScenario>${fields.simScenario}</SimScenario>`)
}
```

In production, `simScenario` is silently ignored — it never reaches the wire.

---

## Guard 3: rawXml Stripped in Production

`parseResponse()` strips the raw XML body from the returned `DatacapResponse` in production:

```typescript
// xml-parser.ts
rawXml: process.env.NODE_ENV === 'production' ? '' : xml,
```

Prevents response XML (which may include auth codes and card-read data) from accumulating in error logs or being serialized accidentally.

---

## Guard 4: Internal API Calls Use `INTERNAL_BASE_URL`

The card-recognition fire-and-forget in `sale/route.ts` now uses a server-side env var and an internal auth header instead of the public `NEXT_PUBLIC_BASE_URL`:

```typescript
const baseUrl = process.env.INTERNAL_BASE_URL
  || process.env.NEXT_PUBLIC_BASE_URL
  || 'http://localhost:3005'

fetch(`${baseUrl}/api/card-profiles`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-internal-call': process.env.INTERNAL_API_SECRET || '',
  },
  body: JSON.stringify({ ... }),
}).catch(...)
```

**Required env vars for production:**
```
INTERNAL_BASE_URL=http://localhost:3005   # Server-internal URL (never exposed to browser)
INTERNAL_API_SECRET=<random-secret>      # Checked by /api/card-profiles to reject external callers
```

---

## Go-Live Checklist (Datacap)

Before deploying to a real venue:

- [ ] `payments.processor` set to `'datacap'` (not `'simulated'`)
- [ ] Real `merchantId` + `operatorId` on each `Location`
- [ ] All `PaymentReader.communicationMode` set to `'local'` or `'cloud'`
- [ ] `INTERNAL_BASE_URL` env set to server-local address
- [ ] `INTERNAL_API_SECRET` env set to a random secret
- [ ] `NODE_ENV=production` — simulated mode guard will throw if misconfigured
- [ ] Verify: `grep -r "SIMULATED_DEFAULTS" src/` returns zero matches
