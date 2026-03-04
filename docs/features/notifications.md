# Feature: Notifications / Alerts

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find this feature → read every listed dependency doc.

## Summary

The notification system is a multi-channel outbound communication layer with three distinct purposes: (1) **system error alerts** dispatched automatically when the POS encounters CRITICAL, HIGH, or MEDIUM errors — routed to SMS, Slack, and/or email based on severity rules; (2) **email receipts** sent to customers on demand after an order is paid; and (3) **daily report emails** sent on-demand to a recipient address containing a formatted sales summary for a given business day. All email delivery is handled via the Resend API (`email-service.ts`). All SMS delivery is handled via Twilio (`twilio.ts`). Slack delivery uses an incoming webhook URL. Throttling is applied per error group ID to prevent alert floods.

## Status

`Active`

## Repos Involved

| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | All alert logic, email service, Twilio SMS, receipt route, report email route | Full |
| `gwi-android-register` | None — does not call these endpoints directly | None |
| `gwi-cfd` | None | None |
| `gwi-backoffice` | None | None |

---

## UI Entry Points

There is no admin UI for configuring notification channels (webhook URL, recipient addresses, Twilio credentials). All configuration is via environment variables. Notifications are fully server-side / fire-and-forget — no operator interaction is required to trigger error alerts.

Receipt emails are triggered by the cashier or customer at point of sale (see Receipt section below). Daily report emails are triggered on-demand via API call (e.g., from a settings or reports page calling `POST /api/reports/email`).

---

## Code Locations

### gwi-pos

| File | Purpose |
|------|---------|
| `src/lib/alert-service.ts` | `dispatchAlert()` — rules engine, throttle check, multi-channel fanout. Imports `email-service.ts` and `twilio.ts` dynamically |
| `src/lib/email-service.ts` | `sendEmail()` — Resend API wrapper. `sendErrorAlertEmail()` — formatted HTML alert email with severity color coding |
| `src/lib/twilio.ts` | `sendSMS()` — generic SMS for error alerts. Also contains void-approval SMS functions (`sendVoidApprovalSMS`, `sendApprovalCodeSMS`) |
| `src/app/api/receipts/email/route.ts` | `POST /api/receipts/email` — builds and sends a customer receipt email for a completed order |
| `src/app/api/reports/email/route.ts` | `POST /api/reports/email` — builds and sends a daily sales summary email to a specified recipient |

---

## API Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/api/receipts/email` | `withVenue` | Send a formatted receipt email for a completed order. Body: `{ orderId, email, locationId }` |
| `POST` | `/api/reports/email` | `withVenue` | Send a daily sales report email. Body: `{ reportType: 'daily', reportDate, recipientEmail, locationId }`. Only `reportType: 'daily'` is supported |

---

## External Services

| Service | SDK / Protocol | Purpose |
|---------|---------------|---------|
| **Resend** | REST API (`https://api.resend.com/emails`) | All outbound email (receipts, reports, error alerts) |
| **Twilio** | `twilio` npm package | SMS for CRITICAL error alerts and remote void approvals |
| **Slack** | Incoming webhook (`SLACK_WEBHOOK_URL`) | CRITICAL and HIGH error alert messages |

---

## Alert Channels and Severity Routing

The `ALERT_RULES` array in `alert-service.ts` defines the routing table:

| Severity | Channels | Throttle Window | Notes |
|----------|----------|----------------|-------|
| `CRITICAL` | SMS + Slack + Email | 5 minutes | SMS gated to `CRITICAL` only inside `sendSMSAlert()` |
| `HIGH` | Slack + Email | 15 minutes | No SMS |
| `MEDIUM` | Email only | 60 minutes | No SMS or Slack |
| `LOW` | None (dashboard only) | N/A | No outbound alerts of any kind |

**Slack gap:** The `sendSlackAlert()` function is fully implemented and will call the webhook URL if `SLACK_WEBHOOK_URL` is set. However, no webhook URL is configured in any known deployment. Until `SLACK_WEBHOOK_URL` is added to the environment, Slack alerts are silently skipped with a `console.warn`. HIGH-severity errors therefore receive only email in practice.

---

## Alert Throttling

Throttling is checked via `shouldThrottle()` before dispatching any alerts. It queries `ErrorLog` for a recent entry with the same `groupId` where `alertSent: true` and `alertSentAt` is within the throttle window. If throttled, `dispatchAlert()` returns `{ sent: false, throttled: true }` and no channels are called.

After a successful dispatch to any channel, `markAlertSent()` sets `alertSent: true` and `alertSentAt: now()` on the `ErrorLog` record identified by `payload.errorLogId`. Throttling is keyed on `groupId` — alerts with no `groupId` are never throttled.

---

## Receipt Emails

**Trigger:** Called by the POS or cashier UI after order payment, passing `orderId`, `email`, and `locationId` in the request body. There is no automatic trigger; it is always on-demand.

**Data fetched:** The route queries the `Order` with its `Employee`, `Location`, `OrderItem` (with `OrderItemModifier`), and completed `Payment` records.

**Template:** HTML-only email built inline in the route. Structure:
- Header: location name, address, phone
- Order info: order number, date, time, server name
- Line items: quantity, name, modifiers (indented), comped items struck through
- Totals: subtotal, discount (if any), tax, tip (if any), grand total
- Payment section: method label + last 4 digits (if card), amount
- Footer: "Thank you for your visit" + paid timestamp

**Subject line format:** `Receipt from {LocationName} - Order #{displayNumber}`

---

## Report Emails

**Trigger:** On-demand via `POST /api/reports/email` with `{ reportType: 'daily', reportDate, recipientEmail, locationId }`. Only `reportType: 'daily'` is currently accepted; other values return HTTP 400.

**Data fetched:** All `paid` orders within the location's business day boundary (respects venue timezone via `getLocationDateRange()`). Also fetches void count from `Order` table for the same window.

**Metrics included in the email:**
- Net Sales (sum of `subtotal`)
- Total Orders (count)
- Average Check (net sales / orders)
- Tax Collected
- Tips
- Discounts
- Void count
- Total Collected (sum of `total`)

**Subject line format:** `Daily Report: {LocationName} — {FormattedDate}`

---

## Known Constraints

- **`RESEND_API_KEY` required in production.** In `development` mode with no API key, `sendEmail()` returns `{ success: true, messageId: 'dev-mode-...' }` without sending anything. In production, a missing key logs an error and returns `{ success: false }`. Receipt and report routes propagate this as HTTP 500.
- **Slack not wired.** `SLACK_WEBHOOK_URL` is not set in any current deployment. HIGH + CRITICAL alerts reach only email in practice. Slack will activate automatically once the env var is set.
- **SMS is CRITICAL-only by guard.** Even though the alert rule for CRITICAL lists `sms` as a channel, `sendSMSAlert()` has an explicit early-return for non-CRITICAL payloads as a secondary guard.
- **SMS requires four Twilio env vars:** `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`, `TWILIO_TO_NUMBER`. A missing `TWILIO_TO_NUMBER` in `alert-service.ts` silently skips SMS (different from `twilio.ts`'s `isTwilioConfigured()` which only checks the first three). Ensure all four are set.
- **Throttle requires `groupId` and `errorLogId`.** Callers of `dispatchAlert()` that omit `groupId` will never be throttled. Callers that omit `errorLogId` will not have the alert recorded, preventing future throttle checks from working correctly.
- **Report email: daily only.** The `reportType` check hard-rejects anything other than `'daily'`. Weekly, monthly, or shift-level report emails are not implemented.
- **Twilio is also used for remote void approvals** (`sendVoidApprovalSMS`, `sendApprovalCodeSMS` in `twilio.ts`). Those functions share the same Twilio client but serve a different feature (`docs/features/remote-void-approval.md`).

---

## Cross-Feature Dependencies

> See `_CROSS-REF-MATRIX.md` for full matrix.

### This feature MODIFIES these features:

| Feature | How / Why |
|---------|-----------|
| None | Notifications are outbound-only; they do not mutate POS data |

### These features MODIFY this feature:

| Feature | How / Why |
|---------|-----------|
| Error Reporting | `dispatchAlert()` is the outbound sink for `ErrorLog` entries. Error reporting writes the log; this feature sends the alert |
| Payments | Receipt email is triggered after a payment is recorded |
| Reports | Daily report email is a presentation layer on top of the sales report data |
| Remote Void Approval | Shares `twilio.ts` for void-request and approval-code SMS |

### BEFORE CHANGING THIS FEATURE, VERIFY:

- [ ] **`RESEND_API_KEY`** — any change to email delivery must account for the dev-mode bypass. Do not remove it without ensuring test environments have a real API key.
- [ ] **Throttle logic** — `shouldThrottle()` reads `ErrorLog`. Changes to the `ErrorLog` schema (particularly `groupId`, `alertSent`, `alertSentAt`) will break throttling.
- [ ] **Twilio shared client** — `twilio.ts` is used by both alert SMS and remote void approval. Changes to credential handling affect both features.
- [ ] **Receipt email** — the route queries `db.order` directly (not `OrderSnapshot`). If the order model changes (column renames, removal of `tipTotal`, `discountTotal`, etc.) the receipt route must be updated.

---

## Permissions Required

These routes use `withVenue` but do not call `requirePermission`. Any authenticated venue session can send a receipt or report email. There is no dedicated permission key for notifications.

---

## Known Constraints & Limits

- No rate limiting on `POST /api/receipts/email` or `POST /api/reports/email` beyond what `withVenue` provides. A misconfigured client could spam the Resend API.
- Receipt email has no deduplication — the same order can be emailed multiple times.
- The report email route queries `db.order` directly for orders and voids; it does not use `OrderSnapshot`. It is consistent with the financial reports page but diverges from the event-sourced model.
- No "from name" is configurable — Resend uses `EMAIL_FROM` env var (default: `noreply@gwipos.com`).

---

## Android-Specific Notes

Android does not call these endpoints directly. Receipt emails would be triggered from the web POS or a future Android screen calling `POST /api/receipts/email`. Error alerts from Android-side errors are not currently wired to `dispatchAlert()`.

---

## Related Docs

- **Feature doc:** `docs/features/error-reporting.md`
- **Feature doc:** `docs/features/remote-void-approval.md`
- **Feature doc:** `docs/features/reports.md`
- **Architecture guide:** `docs/guides/CODING-STANDARDS.md`

---

*Last updated: 2026-03-03*
