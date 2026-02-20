# Skill 389 — Store-and-Forward (SAF)

**Domain:** Payments
**Date:** 2026-02-20
**Commit:** 9e10978
**Datacap Cert Tests:** 18.1, 18.2, 18.3

---

## Overview

SAF (Store-and-Forward) allows payment transactions to be stored locally on the Datacap reader when the processor is unreachable, then forwarded when connectivity is restored. The POS now supports querying the SAF queue, forwarding it, and forcing transactions offline — all three cert test cases covered.

---

## Three SAF Cert Tests

| Test | Feature | How Triggered |
|------|---------|---------------|
| 18.1 | ForceOffline | Pass `forceOffline: true` in sale/preAuth params |
| 18.2 | SAF_Statistics | `GET /api/datacap/saf/statistics` |
| 18.3 | SAF_ForwardAll | `POST /api/datacap/saf/forward` |

---

## Test 18.1 — ForceOffline Flag

Forces a transaction into SAF storage even when the processor is online. Used for testing.

**Client method:**
```typescript
const response = await client.sale(readerId, {
  invoiceNo: 'ORD-123',
  amounts: { purchase: 25.00 },
  forceOffline: true,   // ← sends <ForceOffline>Yes</ForceOffline>
})
// response.storedOffline === true when transaction was stored offline
```

**XML emitted:**
```xml
<ForceOffline>Yes</ForceOffline>
```

**Response detection:**
`DatacapResponse.storedOffline` is `true` when `TextResponse` contains "STORED" or `<StoredOffline>Yes</StoredOffline>` is present.

---

## Test 18.2 — SAF Statistics

Query the reader for current offline queue count and total amount.

**API:**
```
GET /api/datacap/saf/statistics?locationId=loc-abc&readerId=reader-1
```

**Response:**
```json
{
  "data": {
    "success": true,
    "safCount": 3,
    "safAmount": 142.50,
    "hasPending": true,
    "sequenceNo": "0010010060"
  }
}
```

**Client method:** `DatacapClient.safStatistics(readerId)`

**Batch summary integration:** `GET /api/datacap/batch` also includes `safCount`, `safAmount`, `hasSAFPending` — the batch close UI can warn admins before settling if offline transactions are queued.

---

## Test 18.3 — SAF Forward All

Flush all offline-stored transactions to the processor.

**API:**
```
POST /api/datacap/saf/forward
{ "locationId": "loc-abc", "readerId": "reader-1" }
```

**Response:**
```json
{
  "data": {
    "success": true,
    "safForwarded": 3,
    "sequenceNo": "0010010070"
  }
}
```

**Client method:** `DatacapClient.safForwardAll(readerId)`

---

## SAF UI — Payment Reader Settings

Each reader card on `/settings/hardware/payment-readers` now shows a SAF Queue section:

```
┌─────────────────────────────────┐
│ ≡ SAF Queue          [Check]    │  ← Before stats fetched
├─────────────────────────────────┤
│ ≡ SAF Queue  3 pending · $142.50│  ← With pending transactions
│ [↑ Forward Now]                 │
├─────────────────────────────────┤
│ ≡ SAF Queue          ✓ Clear    │  ← After forwarding
└─────────────────────────────────┘
```

- **Check**: fetches live SAF stats from the reader (disabled offline)
- **Amber badge**: shows count + amount when pending
- **Forward Now**: calls `/api/datacap/saf/forward`, resets badge on success
- **Green "Clear"**: shown when safCount === 0

---

## Response Fields Added to DatacapResponse

| Field | Type | Description |
|-------|------|-------------|
| `safCount` | `string?` | Number of queued offline transactions |
| `safAmount` | `string?` | Total amount in queue |
| `safForwarded` | `string?` | Count forwarded (SAF_ForwardAll only) |
| `storedOffline` | `boolean?` | True when transaction was stored (not processed online) |

---

## Simulator Support

| Scenario | Response |
|----------|----------|
| `SAF_Statistics` | `SAFCount: 0`, `SAFAmount: 0.00` (clean queue) |
| `SAF_ForwardAll` | `SAFForwarded: 0` |
| Any transaction with `forceOffline: true` | Approved normally in sim mode (real reader stores offline) |

---

## Files Modified

| File | Change |
|------|--------|
| `src/lib/datacap/types.ts` | `forceOffline` on SaleParams/PreAuthParams/RequestFields; SAF fields on DatacapResponse |
| `src/lib/datacap/xml-builder.ts` | `<ForceOffline>Yes</ForceOffline>` tag |
| `src/lib/datacap/xml-parser.ts` | Parse SAFCount, SAFAmount, SAFForwarded, StoredOffline |
| `src/lib/datacap/client.ts` | `safStatistics()`, `safForwardAll()`, `forceOffline` in sale/preAuth |
| `src/app/api/datacap/saf/statistics/route.ts` | New — SAF stats endpoint |
| `src/app/api/datacap/saf/forward/route.ts` | New — SAF forward endpoint |
| `src/app/api/datacap/batch/route.ts` | GET summary now includes SAF queue info |
| `src/app/(admin)/settings/hardware/payment-readers/page.tsx` | SAF queue widget with Check + Forward Now |
