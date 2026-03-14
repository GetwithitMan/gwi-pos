# Feature: Store-and-Forward (SAF)

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find this feature → read every listed dependency doc.

## Summary

Store-and-Forward (SAF) allows the Datacap payment reader to store card transactions locally on the device when the processor is temporarily unreachable, then forward those queued transactions automatically when connectivity is restored. The POS supports three SAF operations: querying statistics (pending count + total amount), flushing the queue manually (Forward All), and forcing a transaction into offline storage for testing. The SAF queue is surfaced in the payment reader settings UI so managers can monitor and manually forward pending transactions before batch settlement.

## Status

`Active`

## Repos Involved

| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | API endpoints, SAF lib, admin UI widget | Full |
| `gwi-android-register` | SAF state exists in payment flow | Partial |
| `gwi-cfd` | None | None |
| `gwi-backoffice` | None | None |
| `gwi-mission-control` | None | None |

---

## UI Entry Points

| Interface | Path / Screen | Who Accesses |
|-----------|--------------|--------------|
| Admin | `/settings/hardware/payment-readers` | Managers only |

The SAF queue widget appears on each payment reader card on the hardware settings page. It shows a "Check" button when no stats have been fetched, an amber badge with count and total amount when transactions are pending, and a "Forward Now" button that flushes the queue. A green "Clear" indicator is shown when `safCount === 0`.

---

## Code Locations

### gwi-pos

| File / Directory | Purpose |
|-----------------|---------|
| `src/app/api/datacap/saf/statistics/route.ts` | `GET` — queries SAF queue stats from the reader |
| `src/app/api/datacap/saf/forward/route.ts` | `POST` — flushes all pending SAF transactions to the processor |
| `src/app/api/datacap/batch/route.ts` | `GET` batch summary includes `safCount`, `safAmount`, `hasSAFPending` |
| `src/lib/datacap/client.ts` | `safStatistics()`, `safForwardAll()`, `forceOffline` flag in `sale()`/`preAuth()` |
| `src/lib/datacap/types.ts` | `forceOffline` on `SaleParams`/`PreAuthParams`; SAF fields on `DatacapResponse` |
| `src/lib/datacap/xml-builder.ts` | Emits `<ForceOffline>Yes</ForceOffline>` tag when flag is set |
| `src/lib/datacap/xml-parser.ts` | Parses `SAFCount`, `SAFAmount`, `SAFForwarded`, `StoredOffline` from XML responses |
| `src/app/(admin)/settings/hardware/payment-readers/page.tsx` | SAF queue widget with Check + Forward Now controls |

---

## API Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/datacap/saf/statistics?locationId=&readerId=` | Manager | Queries SAF queue count and total amount from the reader |
| `POST` | `/api/datacap/saf/forward` | Manager | Flushes all pending SAF transactions to the processor |
| `GET` | `/api/datacap/batch?locationId=&readerId=` | Manager | Batch summary; includes `safCount`, `safAmount`, `hasSAFPending` |

### GET /api/datacap/saf/statistics — example response

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

### POST /api/datacap/saf/forward — example response

```json
{
  "data": {
    "success": true,
    "safForwarded": 3,
    "sequenceNo": "0010010070"
  }
}
```

---

## Socket Events

SAF operations do not emit dedicated socket events. The batch summary endpoint includes SAF state; UI polls on demand when the manager opens the hardware settings page.

---

## Data Model

SAF status is tracked directly on the `Payment` model. No separate SAF model exists.

```
Payment {
  id                 String
  locationId         String          // always filter by this
  safStatus          String?         // APPROVED_ONLINE | APPROVED_SAF_PENDING_UPLOAD |
                                     // UPLOAD_SUCCESS | UPLOAD_FAILED | NEEDS_ATTENTION
  safUploadedAt      DateTime?       // when SAF batch was uploaded to processor
  safError           String?         // last SAF upload error (UPLOAD_FAILED / NEEDS_ATTENTION)
  isOfflineCapture   Boolean         // was this captured while offline?
  offlineCapturedAt  DateTime?       // when it was queued for offline capture
  offlineTerminalId  String?         // which terminal processed this offline
  idempotencyKey     String?  @unique // deduplication fingerprint
  offlineIntentId    String?  @unique // UUID from PaymentIntentManager
  deletedAt          DateTime?
}
```

---

## Business Logic

### ForceOffline (SAF Test 18.1)

Forces a transaction into SAF storage even when the processor is online. Used for certification testing. Pass `forceOffline: true` in the sale or pre-auth call parameters; the XML builder adds `<ForceOffline>Yes</ForceOffline>`. The response field `storedOffline` is `true` when `TextResponse` contains "STORED" or `<StoredOffline>Yes</StoredOffline>` is present.

### SAF Statistics (SAF Test 18.2)

`DatacapClient.safStatistics(readerId)` sends a `SAF_Statistics` command to the reader. The reader replies with the current pending count and total dollar amount. The batch summary endpoint re-exposes this data alongside settlement figures so managers can see pending offline transactions before closing a batch.

### SAF Forward All (SAF Test 18.3)

`DatacapClient.safForwardAll(readerId)` sends `SAF_ForwardAll` to the reader. The reader pushes all queued transactions to the processor and returns the forwarded count. The UI resets the amber badge to the green "Clear" state on success.

### Edge Cases & Business Rules

- The Check button is disabled when the POS has no network connection to the reader.
- If `safForwardAll` fails, the amber badge remains and the manager may retry. The failure does not affect already-settled transactions.
- The batch close UI warns admins when `hasSAFPending === true` before initiating settlement, to avoid settling a batch while offline transactions are still in the reader queue.
- In simulator mode, `SAF_Statistics` returns `SAFCount: 0` / `SAFAmount: 0.00`; `SAF_ForwardAll` returns `SAFForwarded: 0`; transactions with `forceOffline: true` are approved normally.

---

## Outage Payment Reconciliation

Separate from SAF (which handles processor-level offline storage on the Datacap reader), the NUC also flags payments processed during an internet outage for reconciliation:

- When `isInOutageMode()` returns true (3 consecutive Neon sync failures), all 4 payment routes (`pay`, `close-tab`, `refund-payment`, `void-payment`) set `needsReconciliation = true` on the Payment record
- `GET /api/reports/outage-payments` provides a reconciliation report with summary (count, total amount) and detail list of all outage-flagged payments
- This report is available in the EOD/shift close context so managers can verify all outage payments reconciled correctly after connectivity was restored
- Note: `needsReconciliation` is a separate concern from `safStatus` — SAF tracks reader-level offline, while `needsReconciliation` tracks NUC-level internet outage

---

## Cross-Feature Dependencies

> See `_CROSS-REF-MATRIX.md` for full matrix.

### This feature MODIFIES these features:

| Feature | How / Why |
|---------|-----------|
| Payments | Adds SAF status fields to `Payment` records; offline captures are recorded with `isOfflineCapture: true` |
| Hardware | SAF queue widget is part of the payment readers settings page |

### These features MODIFY this feature:

| Feature | How / Why |
|---------|-----------|
| Payments | Batch settlement triggers SAF flush recommendations |
| Shifts | Shift close warns when SAF transactions are pending |

### BEFORE CHANGING THIS FEATURE, VERIFY:

- [ ] **Payments** — SAF state fields on `Payment` must not be overwritten by normal payment updates
- [ ] **Batch settlement** — ensure `hasSAFPending` warning still surfaces before batch close
- [ ] **Permissions** — SAF actions require manager-level access; do not expose to standard employees
- [ ] **Offline** — SAF is specifically the offline resilience layer; changes must not break the `isOfflineCapture` flow
- [ ] **Hardware** — reader discovery must succeed before SAF stats can be fetched

---

## Permissions Required

| Action | Permission Key | Level |
|--------|---------------|-------|
| View SAF stats | Manager access on hardware settings | High |
| Forward SAF queue | Manager access on hardware settings | High |

---

## Known Constraints & Limits

- SAF storage capacity is managed entirely by the Datacap reader hardware; the POS has no visibility into the reader's maximum queue depth.
- Visa/MC network rules require SAF transactions to be uploaded within 24 hours. The batch close warning exists to help managers comply with this requirement.
- The `forceOffline` flag is for testing and certification purposes only; it should not be used in production payment flows.
- Partial SAF forwarding is not supported; the `SAF_ForwardAll` command flushes the entire queue.
- Cash and non-card payments are not subject to SAF; `safStatus` will be `null` for those records.

---

## Android-Specific Notes

SAF state (`safStatus`, `isOfflineCapture`) is synchronized to the Android register via the standard payment sync path. The Android payment flow surfaces offline capture status in the payment history screen. Android does not independently trigger SAF forwarding; that operation is manager-only from the POS web UI.

---

## Related Docs

- **Feature doc:** `docs/features/payments.md`
- **Feature doc:** `docs/features/hardware.md`
- **Architecture guide:** `docs/guides/PAYMENTS-RULES.md`
- **Skills:** Skill 389 (see `docs/skills/389-STORE-AND-FORWARD-SAF.md`)

---

*Last updated: 2026-03-14*
