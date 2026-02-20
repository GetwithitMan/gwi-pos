# Skill 387 — Pre-Auth By RecordNo (Token-Based Pre-Auth)

**Domain:** Payments / Tabs
**Date:** 2026-02-20
**Commit:** cd96121
**Datacap Cert Test:** 8.3

---

## Overview

Places a new pre-authorization hold using a stored Datacap vault token (RecordNo) — no card present required. Extends or replaces an existing pre-auth hold using the same card token without requiring the physical card.

---

## When to Use

- Re-authorize a tab that has exceeded its hold (alternative to IncrementalAuth)
- Place a new pre-auth on a saved card (e.g., bottle service tier upgrade)
- Renew a tab pre-auth that is about to expire

---

## API Route

**`POST /api/datacap/preauth-by-record`**

```json
{
  "locationId": "loc-abc",
  "readerId": "reader-1",
  "recordNo": "DC4:ABCD1234...",
  "invoiceNo": "TAB-456",
  "amount": 150.00
}
```

Response:
```json
{
  "data": {
    "approved": true,
    "authCode": "345678",
    "recordNo": "DC4:ABCD1234...",
    "amountAuthorized": "150.00",
    "sequenceNo": "0010010040",
    "error": null
  }
}
```

---

## Client Method

`DatacapClient.preAuthByRecordNo(readerId, { recordNo, invoiceNo, amount })`

---

## XML Protocol

TranCode: `PreAuthByRecordNo`
- Sends: RecordNo + InvoiceNo + Amount.Purchase
- Returns new RecordNo that can be used for subsequent captures
- No customer interaction on reader

---

## vs IncrementalAuthByRecordNo

| Method | When to Use |
|--------|-------------|
| `IncrementalAuthByRecordNo` | Increase existing hold by additional amount |
| `PreAuthByRecordNo` | Place a brand-new hold on the same stored card |
