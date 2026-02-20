# Skill 391 — Level II Interchange (Customer Code + Tax)

**Domain:** Payments
**Date:** 2026-02-20
**Commit:** e46d997
**Datacap Cert Test:** 3.11

---

## Overview

Level II data qualifies B2B (business-to-business) card transactions for lower interchange rates. Requires a tax amount and a customer/PO code sent with the sale. Datacap responds with `Level2Status: Accepted` when the card qualifies.

---

## Usage

Pass `customerCode` and `taxAmount` in the sale API request:

```json
POST /api/datacap/sale
{
  "locationId": "loc-abc",
  "readerId": "reader-1",
  "invoiceNo": "ORD-789",
  "amount": 100.00,
  "taxAmount": 8.50,
  "customerCode": "PO-2026-001"
}
```

Response includes `level2Status`:
```json
{
  "data": {
    "approved": true,
    "authCode": "123456",
    "level2Status": "Accepted",
    ...
  }
}
```

---

## Fields

| Field | Type | Max Length | Notes |
|-------|------|-----------|-------|
| `customerCode` | `string` | 17 chars | PO number, customer ID, or reference code |
| `taxAmount` | `number` | — | Goes into `amounts.tax` |

The 17-char limit on `customerCode` is enforced at the XML builder layer (`.slice(0, 17)`).

---

## XML Protocol

Emitted in `buildRequest()`:
```xml
<Amount>
  <Purchase>100.00</Purchase>
  <Tax>8.50</Tax>
</Amount>
<CustomerCode>PO-2026-001</CustomerCode>
```

Response from processor:
```xml
<Level2Status>Accepted</Level2Status>
```

---

## Client Method

```typescript
const response = await client.sale(readerId, {
  invoiceNo: 'ORD-789',
  amounts: { purchase: 100.00, tax: 8.50 },
  customerCode: 'PO-2026-001',
})
// response.level2Status === 'Accepted'
```

---

## Simulator

When `customerCode` is present in the request, the simulator returns `<Level2Status>Accepted</Level2Status>` in the response.

---

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| No customerCode | Level II not attempted, `level2Status` undefined |
| Consumer card (not B2B) | Processor returns `Level2Status: Rejected` |
| customerCode > 17 chars | Truncated at XML builder layer |
| taxAmount = 0 | Technically valid but processor may reject Level II |
