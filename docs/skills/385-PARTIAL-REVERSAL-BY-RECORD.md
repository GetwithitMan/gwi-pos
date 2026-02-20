# Skill 385 — Partial Reversal By RecordNo

**Domain:** Payments / Tabs
**Date:** 2026-02-20
**Commit:** cd96121
**Datacap Cert Test:** 7.7

---

## Overview

Reduces a pre-authorized hold by a specified amount using Datacap's stored vault token (RecordNo). Used when a tab closes for less than its authorized hold — the excess authorization is released back to the cardholder.

---

## When to Use

- Tab closes for $45 but hold was $100 → partial-reverse $55 before capture
- Customer disputes a hold amount
- Auto-increment over-authorized; tab settled lower

---

## API Route

**`POST /api/datacap/partial-reversal`**

```json
{
  "locationId": "loc-abc",
  "readerId": "reader-1",
  "recordNo": "DC4:ABCD1234...",
  "reversalAmount": 55.00
}
```

Response:
```json
{
  "data": {
    "approved": true,
    "authCode": "123456",
    "recordNo": "DC4:ABCD1234...",
    "amountReversed": "55.00",
    "sequenceNo": "0010010020",
    "error": null
  }
}
```

---

## Client Method

`DatacapClient.partialReversal(readerId, { recordNo, reversalAmount })`

---

## XML Protocol

TranCode: `PartialReversalByRecordNo`
- Sends: RecordNo + Amount.Purchase (the amount to reduce by)
- Card NOT present — purely token-based
- No EMVPadReset interaction with customer
- Auto-wrapped in `withPadReset()` after completion

---

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Reversal amount > hold | Datacap rejects — don't reverse more than was held |
| RecordNo expired | Error response — fall back to capture for actual amount |
| Simulated mode | Returns Approved with full reversal confirmation |
