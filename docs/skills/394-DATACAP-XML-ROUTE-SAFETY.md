# Skill 394 — Datacap XML & Route Safety

**Domain:** Payments
**Date:** 2026-02-20
**Commit:** 14de60e
**Addresses:** Third-party audit §2, §3, §5 — XML safety, parsing bounds, route hardening

---

## Overview

A collection of defensive improvements to the XML builder, parser, and API routes. Covers `customerCode` validation, button label limits, print data bounds, JSON parsing hardening, and numeric validation normalization.

---

## 1. `validateCustomerCode()` — Upstream Validation Helper

New export from `xml-builder.ts` for API routes to validate customerCode before it reaches the silent 17-char truncation in `buildRequest()`:

```typescript
import { validateCustomerCode } from '@/lib/datacap/xml-builder'

const result = validateCustomerCode(body.customerCode)
if (!result.valid) {
  return Response.json({ error: result.error }, { status: 400 })
  // e.g.: "Customer code must be 17 characters or fewer (got 22).
  //        It will be truncated to: \"PO-2026-001-ACME-\""
}
```

**Signature:**
```typescript
validateCustomerCode(value: string): { valid: boolean; error?: string }
```

The `buildRequest()` still truncates silently (backwards compatible) but now logs a `console.warn` in non-production when truncation occurs.

---

## 2. Button Labels Cap — Max 4

`buildRequest()` now enforces the Datacap protocol maximum of 4 button labels for `GetMultipleChoice`:

```typescript
// xml-builder.ts
const MAX_BUTTONS = 4
const labels = fields.buttonLabels.slice(0, MAX_BUTTONS)
labels.forEach((label, i) => parts.push(tag(`Button${i + 1}`, label)))
```

Previously: any number of labels were emitted, which could confuse readers that only support up to 4 buttons.

---

## 3. `extractPrintData` Bounds

`extractPrintData()` in `xml-parser.ts` is now bounded to prevent memory issues on pathological or malformed receipt payloads:

```typescript
const MAX_LINES = 36          // Datacap spec maximum
const MAX_CHARS_PER_LINE = 500  // Defensive cap

while ((match = lineRegex.exec(xml)) !== null) {
  if (lineCount >= MAX_LINES) break
  const value = match[2]?.trim().slice(0, MAX_CHARS_PER_LINE)
  // ...
}
```

---

## 4. Walkout-Retry JSON Hardening

`POST /api/datacap/walkout-retry` previously used `.json().catch(() => ({}))` which turned malformed JSON into a confusing "Missing walkoutRetryId" error. Now returns a proper `400`:

```typescript
let body: { walkoutRetryId?: string; employeeId?: string }
try {
  body = await request.json()
} catch {
  return NextResponse.json({ error: 'Invalid JSON request body' }, { status: 400 })
}
```

---

## 5. Numeric Validation Normalization

Routes that accept amount fields previously used `!amount` which evaluates `0` as falsy. All monetary routes now use:

```typescript
if (amount === undefined || amount === null) {
  return Response.json({ error: 'Missing required field: amount' }, { status: 400 })
}
```

**Routes updated:**
| Route | Field |
|-------|-------|
| `sale/route.ts` | `amount` |
| `preauth/route.ts` | `amount` |
| `sale-by-record/route.ts` | `amount` |
| `preauth-by-record/route.ts` | `amount` |
| `return/route.ts` | `amount` |

Routes already using `=== undefined` (capture, adjust, partial-reversal) were verified correct and left unchanged.

---

## 6. Logger Migration in Routes

`walkout-retry/route.ts` migrated from `console.error` to structured `logger.error`:

```typescript
// Before
console.error('Failed to process walkout retry:', error)

// After
logger.error('datacap', 'Failed to process walkout retry', error)
```

All `console.*` calls in core Datacap lib paths now use the shared `logger` module.

---

## Summary Table

| Change | File | Impact |
|--------|------|--------|
| `validateCustomerCode()` export | `xml-builder.ts` | Routes can validate before truncation |
| customerCode truncation warning | `xml-builder.ts` | Dev visibility into silent data loss |
| Button labels cap (4) | `xml-builder.ts` | Protocol compliance |
| `extractPrintData` line + char bounds | `xml-parser.ts` | Memory safety |
| JSON parse hardening | `walkout-retry/route.ts` | Correct 400 vs confusing missing-field |
| `!amount` → `=== undefined` | 5 routes | Correct handling of $0 amounts |
| Logger migration | `walkout-retry/route.ts` | Structured logging |
