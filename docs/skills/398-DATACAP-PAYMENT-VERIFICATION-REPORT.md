# Skill 398 — Datacap Payment Verification Report

**Domain:** Payments / Reports
**Date:** 2026-02-20
**Commit:** af96d3f (gwi-pos)
**Addresses:** Owner visibility into live vs offline/SAF payments, Datacap cross-verification, authorization confirmation

---

## Overview

Owners can now see exactly which card payments went through live, which are sitting in offline/SAF (Store-and-Forward) mode awaiting settlement, and — if a Datacap Reporting API key is configured — cross-reference every local payment against Datacap's cloud records to confirm authorizations were captured.

Available at `/reports/datacap` (Payment Verification tile under Operations on the Reports Hub).

---

## Why This Exists

When a venue loses internet during service, the Datacap reader captures transactions locally in SAF mode. Those payments exist in the local POS database but have NOT been sent to the processor yet. Owners had no way to see:

1. Which payments are live (captured by Datacap) vs offline (sitting in queue)
2. Whether a specific authorization was successfully captured
3. How many transactions Datacap received vs how many the POS recorded

This report answers all three questions.

---

## Architecture

```
/reports/datacap (page)
    │
    ▼ GET /api/reports/datacap-transactions
    ├─ Query local Payment table (credit/debit only, date range)
    │   Fields: amount, tipAmount, totalAmount, cardBrand, cardLast4,
    │           authCode, entryMethod, isOfflineCapture, status,
    │           datacapRefNumber, processedAt
    │
    └─ If DATACAP_REPORTING_API_KEY + datacapMerchantId configured:
        POST https://reporting-cert.dcap.com/V3/Credit/Transactions/Query
        ├─ Merchant: settings.payments.datacapMerchantId
        ├─ Date range: startDate / endDate
        ├─ Select: TranCode, DSIXReturnCode, AuthCode, CardType,
        │          Authorize, Purchase, Gratuity, EntryMethod, AuthResponseText
        └─ Cross-reference by authCode → mark local payments as datacapVerified
```

---

## API Route

```
src/app/api/reports/datacap-transactions/route.ts
```

### Request

```
GET /api/reports/datacap-transactions?locationId=...&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&requestingEmployeeId=...
```

### Response

```typescript
{
  data: {
    localPayments: Array<{
      id: string
      amount: number
      tipAmount: number
      totalAmount: number
      cardBrand: string | null
      cardLast4: string | null
      authCode: string | null
      entryMethod: string | null
      datacapRefNumber: string | null
      isOfflineCapture: boolean
      status: string            // 'completed' | 'voided' | 'refunded'
      processedAt: string
      paymentMethod: string
      datacapVerified: boolean  // true if matched in Datacap cloud
      datacapReturnCode: string | null  // DSIXReturnCode from Datacap
      datacapTranCode: string | null
      datacapAuthResponseText: string | null
    }>
    datacapTransactions: DatacapTransaction[]  // raw V3 records
    hasReportingKey: boolean   // merchantId + DATACAP_REPORTING_API_KEY both present
    hasMerchantId: boolean
    datacapError: string | null
    datacapHasMore: boolean    // V3 returned more than 100 records
    summary: {
      totalCard: number
      totalLive: number         // !isOfflineCapture && status=completed
      totalOffline: number      // isOfflineCapture=true
      totalVoided: number       // status=voided or refunded
      totalAmount: number
      datacapApproved: number   // DSIXReturnCode=000000
      datacapDeclined: number   // non-zero DSIXReturnCode
      datacapTotal: number
    }
  }
}
```

---

## UI — /reports/datacap

### Filters
- Quick-select buttons: Today / Yesterday / This Week
- Manual date range (start + end)
- Status filter (Local Payments tab): All / Live / Offline / Voided

### Summary Cards
Always shown:
- **Card Payments** — count + total amount
- **Live / Captured** — green — online authorizations
- **Offline / SAF** — yellow — awaiting settlement
- **Voided / Refunded** — gray

Shown when reporting key configured:
- **Datacap: Approved** — blue — DSIXReturnCode 000000
- **Datacap: Declined** — red — non-zero codes
- **Datacap: Total** — shows if more than 100 records exist

### Status Badges (Local Payments tab)

| Badge | Color | Condition |
|-------|-------|-----------|
| Live | Green | `!isOfflineCapture && status === 'completed'` |
| Offline / SAF | Yellow | `isOfflineCapture === true` |
| Voided | Gray | `status === 'voided'` |
| Refunded | Blue | `status === 'refunded'` |

### Datacap Column (shown when reporting key set)

| Value | Meaning |
|-------|---------|
| `Approved` (green) | DSIXReturnCode = 000000 |
| `{code}` (red) | Non-zero DSIXReturnCode (hover shows AuthResponseText) |
| `Pending` | Offline capture — not yet sent to Datacap |
| `—` | No match found |

### Tabs

| Tab | When Visible |
|-----|-------------|
| Local Payments | Always |
| Datacap Cloud | Only when `hasReportingKey === true` |

---

## Configuration

### Required for basic report (local data only)
- No additional config — works as soon as `settings.payments.datacapMerchantId` is set

### Required for Datacap cloud cross-reference
```
DATACAP_REPORTING_API_KEY=<key from Datacap Reportal>
```

**How to get the key:**
1. Log in to Datacap Reportal
2. Settings → Reporting API section
3. Generate key if not present → Enable → Copy
4. Add to `.env.local` (NUC) and Vercel environment variables

### Environment detection
The route uses `settings.payments.datacapEnvironment` (`'cert'` or `'production'`) to select the reporting URL:
- `cert` → `https://reporting-cert.dcap.com`
- `production` → `https://reporting.dcap.com`

---

## Cross-Reference Logic

```
Local payment.authCode.toUpperCase()
    === Datacap Response.AuthCode.toUpperCase()

→ datacapVerified = true
→ datacapReturnCode = Response.DSIXReturnCode
```

**Limitation:** Auth codes can collide across days (Datacap reuses short codes). For same-day queries this is reliable. For multi-day ranges, occasional false positives are possible. Narrow to a single day for exact verification.

---

## Permissions

Uses `PERMISSIONS.REPORTS_SALES` — same permission as the Sales Report. Any manager or owner with sales report access can view this report.

---

## Files Changed

| File | Change |
|------|--------|
| `src/app/api/reports/datacap-transactions/route.ts` | New — local + Datacap V3 query, cross-reference |
| `src/app/(admin)/reports/datacap/page.tsx` | New — full report UI with status badges, tabs, filters |
| `src/app/(admin)/reports/page.tsx` | Modified — Payment Verification tile added to Operations |

---

## Summary Table

| Change | File | Impact |
|--------|------|--------|
| Datacap Reporting API route | `reports/datacap-transactions/route.ts` | Queries local payments + Datacap V3 |
| Payment Verification page | `reports/datacap/page.tsx` | Owner-facing report with status badges |
| Reports hub tile | `reports/page.tsx` | Entry point under Operations |
