# Skill 386 — Sale By RecordNo (Token-Based Sale)

**Domain:** Payments / Tabs
**Date:** 2026-02-20
**Commit:** cd96121
**Datacap Cert Test:** 8.1

---

## Overview

Processes a full sale using a stored Datacap vault token (RecordNo) — no card present required. Used for charging a saved card from a closed tab, recurring charges, or any scenario where the physical card is not available but a valid RecordNo exists.

---

## When to Use

- Charge a tab card that was previously vaulted via PreAuth
- Retry a walkout tab charge without the card present
- Server-initiated charge on a saved card (with customer consent)

---

## API Route

**`POST /api/datacap/sale-by-record`**

```json
{
  "locationId": "loc-abc",
  "readerId": "reader-1",
  "recordNo": "DC4:ABCD1234...",
  "invoiceNo": "ORD-789",
  "amount": 45.00,
  "gratuityAmount": 9.00
}
```

Response:
```json
{
  "data": {
    "approved": true,
    "authCode": "789012",
    "recordNo": "DC4:ABCD1234...",
    "amountAuthorized": "54.00",
    "isPartialApproval": false,
    "sequenceNo": "0010010030",
    "error": null
  }
}
```

---

## Client Method

`DatacapClient.saleByRecordNo(readerId, { recordNo, invoiceNo, amount, gratuityAmount? })`

---

## XML Protocol

TranCode: `SaleByRecordNo`
- Sends: RecordNo + InvoiceNo + Amount block (purchase + optional gratuity)
- Card NOT present — purely token-based
- No customer interaction on reader
- Supports partial approval (check `isPartialApproval` in response)

---

## Simulator Support

Supports `simScenario: 'partial'` in request fields to simulate a partial approval returning 50% of the requested amount for testing partial-approval handling.

---

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Partial approval | `isPartialApproval: true`, `amountAuthorized` < requested — handle remaining balance |
| RecordNo invalid | Datacap error — show user "Card on file could not be charged" |
| Simulated mode | Always approves full amount (or 50% if partial scenario set) |
