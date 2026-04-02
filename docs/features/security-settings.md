# Feature: Security Settings

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find this feature → read every listed dependency doc.

## Summary

Security Settings govern how POS terminals behave with respect to access control, idle lockout, and approval requirements for high-risk actions. Configurable options include: idle screen lock (PIN re-entry after inactivity), require-PIN-after-payment for high-volume terminals, buddy-punch detection for time clock fraud prevention, and SMS manager approval (2-factor) for large refunds and voids above configurable dollar thresholds. A set of hardcoded policies — PIN lockout after 3 failed attempts, one-time approval codes valid for 5 minutes, approval links valid for 30 minutes — are enforced at the system level and are not user-configurable. These settings apply uniformly to Android registers and PAX devices.

## Status

`Active`

## Repos Involved

| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | API (settings), admin UI | Full |
| `gwi-android-register` | Consumes idle lock and PIN re-entry settings via bootstrap | Partial |
| `gwi-cfd` | None | None |
| `gwi-backoffice` | None | None |
| `gwi-mission-control` | None | None |

---

## UI Entry Points

| Interface | Path / Screen | Who Accesses |
|-----------|--------------|--------------|
| Admin | `/settings/security` | Managers only |

---

## Code Locations

### gwi-pos

| File / Directory | Purpose |
|-----------------|---------|
| `src/app/(admin)/settings/security/page.tsx` | Security Settings admin page |
| `src/lib/settings.ts` | `SecuritySettings` interface + `DEFAULT_SETTINGS` |
| `src/lib/api/settings-client.ts` | `loadSettings` / `saveSettings` client helpers |
| `src/app/api/settings/` | Settings GET / POST API (shared with all settings pages) |

---

## API Endpoints

Security settings are persisted as part of the location-wide settings object. There is no dedicated `/api/settings/security` route — all settings are read and written through the shared settings API.

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/settings` | Employee PIN | Load all settings for the location (returns `settings.security` among other namespaces) |
| `POST` | `/api/settings` | Employee PIN | Save settings; accepts partial payload — only the `security` key needs to be sent to update security settings |

---

## Socket Events

None. Security settings changes take effect on next login or next settings fetch; no socket event is emitted.

---

## Data Model

Security settings are stored as a JSON blob in the `Location.settings` field (not a separate table). The relevant slice:

```
SecuritySettings {
  requirePinAfterPayment       Boolean   // default: false
  idleLockMinutes              Int       // 0 | 1 | 3 | 5 | 10 | 15 | 30 — 0 = disabled
  enableBuddyPunchDetection    Boolean   // default: false
  require2FAForLargeRefunds    Boolean   // default: false
  refund2FAThreshold           Int       // dollars — default: 100
  require2FAForLargeVoids      Boolean   // default: false
  void2FAThreshold             Int       // dollars — default: 200
}
```

---

## Business Logic

### Idle Screen Lock

- When `idleLockMinutes > 0`, the POS terminal locks the screen after the configured number of minutes of inactivity.
- On lock, the terminal requires PIN re-entry before any further action.
- Applies to Android registers and PAX devices (`PinLoginViewModel` reads `idleLockMinutes` from bootstrapped settings). Web POS register was removed April 2026.
- The lock must not interrupt an active transaction in progress (payment flow, open order panel, etc.).
- Valid values: `0` (disabled), `1`, `3`, `5`, `10`, `15`, `30` minutes. These are enforced in the UI via the `IDLE_LOCK_OPTIONS` constant; the API stores whatever integer is sent.

### Require PIN After Payment

- When `requirePinAfterPayment = true`, the terminal prompts for PIN re-entry after every completed transaction.
- Intended for high-risk environments where employees must re-authenticate before the next sale.
- Trades security for speed — not recommended for high-volume bar service.

### Buddy-Punch Detection

- When `enableBuddyPunchDetection = true`, the system alerts managers when an employee clocks in from a device or IP address that differs from their prior clock-in history.
- The first use of any new device does not trigger an alert — only unexpected changes from an established pattern.
- Alerts are surfaced to managers; exact delivery mechanism (toast / email / dashboard flag) is implementation-dependent.

### SMS Manager Approval (2-Factor) for Refunds and Voids

- Two independent toggles: one for refunds (`require2FAForLargeRefunds`) and one for voids (`require2FAForLargeVoids`).
- When enabled, transactions above the configured dollar threshold (`refund2FAThreshold` / `void2FAThreshold`) require a remote manager to approve via SMS before the action proceeds.
- Flow: manager receives a text with action details; they respond with a one-time code (valid 5 minutes) or click an approval link (valid 30 minutes); both are single-use only.
- The dollar threshold fields are only visible in the UI when the parent toggle is enabled.
- Threshold range: $1–$10,000, step $25.

### Hardcoded (Non-Configurable) Policies

The following policies are enforced at the system level and are intentionally not exposed as configurable settings:

- PIN lockout: 3 failed attempts → account locked for 15 minutes; a manager must reset from the employee profile.
- SMS approval code validity: 5 minutes.
- Approval link validity: 30 minutes.
- All codes/links are single-use.

These are displayed as read-only informational cards in the UI under "PIN & Access."

### Business Day Settings

Business Day end-of-day rules were previously on this page but have been moved to `/settings/staff`. The Security page shows a redirect card pointing to Staff & Shifts settings.

### Saving

- Settings are saved via `saveSettingsApi({ security }, employee.id)`.
- The page tracks `isDirty` state; the save button is disabled when clean.
- An unsaved-changes warning fires on page navigation if `isDirty`.

---

## Cross-Feature Dependencies

> See `_CROSS-REF-MATRIX.md` for full matrix.

### This feature MODIFIES these features:

| Feature | How / Why |
|---------|-----------|
| Payments | `require2FAForLargeRefunds` / `require2FAForLargeVoids` gate the refund and void flows |
| Refund / Void | Voids and refunds above threshold require SMS manager approval before proceeding |
| Time Clock | `enableBuddyPunchDetection` monitors clock-in events for device/IP anomalies |
| Employees | `idleLockMinutes` and `requirePinAfterPayment` affect PIN re-entry prompts on all employee sessions |

### These features MODIFY this feature:

| Feature | How / Why |
|---------|-----------|
| Settings | Security settings are a namespace inside the shared settings object; the settings persistence layer handles reads/writes |
| Roles / Permissions | Only manager-level employees can access and change security settings |

### BEFORE CHANGING THIS FEATURE, VERIFY:

- [ ] **Payments** — changes to 2FA thresholds must not bypass or break the refund/void guard logic
- [ ] **Refund / Void** — `refund2FAThreshold` and `void2FAThreshold` are read by the approval flow; ensure backward compatibility if type changes
- [ ] **Android** — `idleLockMinutes` is consumed during bootstrap; any schema change to this field must also update Android's `SyncMeta` key handling
- [ ] **Permissions** — security settings must remain manager-only; `requirePermission()` must be called on any API route that persists these settings
- [ ] **Reports** — no impact
- [ ] **Offline** — settings changes require server connectivity; the NUC must be reachable for saves to persist

---

## Permissions Required

| Action | Permission Key | Level |
|--------|---------------|-------|
| View security settings page | Manager role | Standard/Manager |
| Save security settings | Manager role | High |

---

## Known Constraints & Limits

- `idleLockMinutes` only accepts values from the fixed set `[0, 1, 3, 5, 10, 15, 30]` in the UI; the API will accept any integer.
- The idle lock must not interrupt active payment or order flows — the consuming terminal/client is responsible for suppressing the lock timer during active transactions.
- Refund/void 2FA requires that manager phone numbers are configured on employee profiles; if no manager phone is registered, the SMS cannot be delivered.
- Advanced security features (blocked card management, suspicious tip alerts, auto-gratuity) are shown as "Coming Soon" placeholders and are not implemented.
- Business Day settings were relocated to `/settings/staff`; do not add them back to this page.

---

## Android-Specific Notes

- `idleLockMinutes` is read from the bootstrap response and consumed by `PinLoginViewModel` to determine when to enter the `isUnavailablePhase` idle-lock state.
- The Android terminal pings the server every 3 seconds to assess connectivity and enforces the idle lock independently.
- `requirePinAfterPayment` is consumed by the Android payment flow to prompt PIN re-entry after a successful tender.

---

## Related Docs

- **Feature doc:** `docs/features/settings.md`
- **Feature doc:** `docs/features/roles-permissions.md`
- **Feature doc:** `docs/features/refund-void.md`
- **Feature doc:** `docs/features/employees.md`
- **Feature doc:** `docs/features/time-clock.md`
- **Architecture guide:** `docs/guides/CODING-STANDARDS.md`

---

*Last updated: 2026-03-03*
