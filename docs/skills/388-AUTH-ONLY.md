# Skill 388 — Auth Only (Zero-Dollar Card Validation)

**Domain:** Payments
**Date:** 2026-02-20
**Commit:** cd96121
**Datacap Cert Test:** 17.0

---

## Overview

Validates a card via EMV without charging any amount ($0.00 authorization). Returns a RecordNo (vault token) that can be used for future charges. Used for card-on-file enrollment, membership validation, or verifying card validity before a delayed charge.

---

## When to Use

- Store a card on file without charging it yet
- Validate a card at membership sign-up
- Pre-validate before a later SaleByRecordNo

---

## API Route

**`POST /api/datacap/auth-only`**

```json
{
  "locationId": "loc-abc",
  "readerId": "reader-1",
  "invoiceNo": "COF-001"
}
```

Response:
```json
{
  "data": {
    "approved": true,
    "authCode": "000000",
    "recordNo": "DC4:EFGH5678...",
    "cardType": "visa",
    "cardLast4": "4242",
    "cardholderName": "JOHN SMITH",
    "entryMethod": "Tap",
    "sequenceNo": "0010010050",
    "error": null
  }
}
```

---

## Client Method

`DatacapClient.authOnly(readerId, { invoiceNo })`

---

## XML Protocol

TranCode: `EMVAuthOnly`
- Amount: $0.00 (no hold placed)
- `RecordNo: RecordNumberRequested` — always vaults the card
- `Frequency: OneTime`
- `CardHolderID: Allow_V2` — enables card recognition

---

## Flow: Auth-Only -> Sale-By-Record

```
1. Customer taps/dips card -> EMVAuthOnly -> returns RecordNo
2. Store RecordNo in your system
3. Later: SaleByRecordNo with stored RecordNo -> charges card
```

---

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Card declined | `approved: false`, no RecordNo returned |
| Chip not read | Reader prompts retry |
| RecordNo not returned | Rare — treat as failed enrollment |
