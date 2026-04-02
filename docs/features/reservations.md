# Feature: Reservations

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find Reservations → read every listed dependency doc.

## Summary
Full reservation management system with online booking, deposit collection, customer matching, third-party integration support, and automated lifecycle management. Guests book via a public widget or phone, receive email/SMS confirmations with calendar invites, and are seated from a reservation queue. Includes waitlist bridge, deposit collection with text-to-pay, no-show tracking with auto-blacklisting, and advisory-lock-based double-booking prevention.

## Status
`Built` (2026-03-17)

## Repos Involved
| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | Engine, API, POS/admin/public UI, cron jobs | Full |

---

## UI Entry Points

| Interface | Path / Screen | Who Accesses |
|-----------|--------------|--------------|
| Admin | `/reservations` → `src/app/(admin)/reservations/page.tsx` | Managers, Hosts |
| Admin Settings | `/settings/reservations` → `src/app/(admin)/settings/reservations/page.tsx` | Managers |
| Integration Settings | `/settings/integrations/reservations` → `src/app/(admin)/settings/integrations/reservations/page.tsx` | Managers |
| Android Host Stand | Android `HostStandScreen.kt` | Hosts (web POS host page removed April 2026) |
| Public Booking | `/reserve/[slug]` → `src/app/(public)/reserve/[slug]/page.tsx` | Guests |
| Public Manage | `/reserve/manage/[token]` → `src/app/(public)/reserve/manage/[token]/page.tsx` | Guests |
| Public Deposit | `/reserve/pay-deposit/[depositToken]` → `src/app/(public)/reserve/pay-deposit/[depositToken]/page.tsx` | Guests |
| Public Check-in | `/checkin` → `src/app/(public)/checkin/page.tsx` | Guests |
| Reports | `/settings/reports/reservations` | Managers |

---

## Code Locations

### Engine (`src/lib/reservations/`)
| File | Purpose |
|------|---------|
| `state-machine.ts` | 7-status state machine, transition table, guards, event writing |
| `availability.ts` | Slot availability engine — time slots, blocks, cross-midnight, reduced capacity |
| `create-reservation.ts` | Canonical creation entry point — customer match, advisory lock, availability re-check, deposit eval, idempotency |
| `deposit-rules.ts` | Deposit evaluation (3 modes), refund tiers, token generation/validation |
| `customer-matcher.ts` | Phone-first E.164 matching, email fallback, no-show counting, auto-blacklist |
| `notifications.ts` | SMS (Twilio) + email (Resend) notification engine, template rendering, audit logging |
| `table-suggestion.ts` | Scored table ranking — capacity fit, section preference, table combinations |
| `waitlist-bridge.ts` | Cancelled slot → waitlist offer with 10-min claim window, SMS notification |
| `revalidate.ts` | Modification revalidation — availability, deposit delta, refund calc, cutoff enforcement |
| `ics.ts` | RFC 5545 iCalendar generation for confirmation/modification emails |
| `advisory-lock.ts` | PostgreSQL advisory locks per 15-min bucket, deadlock-safe sorted acquisition |
| `service-date.ts` | Service-date logic (late-night = previous calendar date), time math, overlap checks |

### API Routes — Internal (authenticated)
| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/reservations` | List reservations (filtered by date, status) |
| `POST` | `/api/reservations` | Create reservation (admin) |
| `GET` | `/api/reservations/[id]` | Get reservation details |
| `PUT` | `/api/reservations/[id]` | Update reservation (modify, reassign table) |
| `POST` | `/api/reservations/[id]/transition` | State machine transition (confirm, check-in, seat, complete, cancel, no-show) |
| `POST` | `/api/reservations/[id]/send-message` | Send custom SMS/email to guest |
| `GET` | `/api/reservations/[id]/events` | Audit trail for reservation |
| `POST` | `/api/reservations/[id]/deposit` | Record deposit payment |
| `POST` | `/api/reservations/[id]/deposit/text-to-pay` | Send text-to-pay deposit link |
| `POST` | `/api/reservations/[id]/sync-out` | Push reservation to third-party platform |
| `GET` | `/api/reservations/availability` | Check slot availability (admin) |
| `GET/POST` | `/api/reservations/blocks` | Manage reservation blocks (closures, reduced capacity) |
| `GET` | `/api/dashboard/reservations` | Dashboard reservation widget data |
| `GET` | `/api/reports/reservations` | Reservation reports |
| `GET` | `/api/reports/reservation-deposits` | Deposit payment reports |

### API Routes — Public (no auth, token-based)
| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/api/public/reservations/availability` | Public slot availability |
| `POST` | `/api/public/reservations` | Create reservation (online booking) |
| `POST` | `/api/public/reservations/confirm` | Guest confirms reservation |
| `POST` | `/api/public/reservations/checkin` | Guest self check-in |
| `GET` | `/api/public/reservations/[token]` | Get reservation by manage token |
| `POST` | `/api/public/reservations/[token]/cancel` | Guest cancels reservation |
| `POST` | `/api/public/reservations/[token]/modify` | Guest modifies reservation |
| `POST` | `/api/public/reservations/[token]/deposit` | Guest pays deposit |
| `GET` | `/api/public/reservations/[token]/calendar` | Download ICS calendar invite |
| `GET` | `/api/public/reservations/deposit-token/[depositToken]` | Validate deposit token |

### API Routes — Cron
| Route | Interval | Description |
|-------|----------|-------------|
| `/api/cron/reservation-hold-expiry` | `*/2` | Cancel expired pending holds |
| `/api/cron/reservation-no-shows` | `*/5` | Mark no-shows, increment count, auto-blacklist |
| `/api/cron/reservation-reminders` | `*/15` | 24h and 2h reminders via SMS/email |
| `/api/cron/reservation-thank-you` | `*/30` | Thank-you messages after completion |

### API Routes — Webhooks
| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/api/webhooks/reservations/[platform]` | Inbound from third-party platforms |
| `POST` | `/api/webhooks/reservations/[platform]/test` | Test webhook endpoint |

### Pages
| Path | Route Group | Description |
|------|-------------|-------------|
| `/reservations` | `(admin)` | Reservation management calendar/list |
| `/settings/reservations` | `(admin)` | Reservation engine settings |
| `/settings/integrations/reservations` | `(admin)` | Third-party integration config |
| `/host` | `(pos)` | **REMOVED (April 2026)** — host stand is now Android only |
| `/reserve/[slug]` | `(public)` | Public booking widget |
| `/reserve/manage/[token]` | `(public)` | Guest manage/cancel/modify |
| `/reserve/pay-deposit/[depositToken]` | `(public)` | Guest deposit payment |
| `/checkin` | `(public)` | Guest self check-in |

---

## Business Logic

### State Machine (7 statuses)
```
pending → confirmed → checked_in → seated → completed
                    ↗                        (terminal)
pending → cancelled                           (terminal)
confirmed → cancelled                         (terminal)
confirmed → no_show                           (terminal)
seated → cancelled (staff + reason required)  (terminal)
no_show → confirmed (staff + reason + override required)
no_show → seated    (staff + reason + override required)
```

**Terminal statuses:** `completed`, `cancelled`, `no_show`

**Guards:**
- `requireStaff` — only staff actors can perform this transition
- `requireReason` — free-text reason must be provided
- `requireOverride` — override type must be specified (e.g., `no_show_reversal`, `manager_force_book`)
- `checkCutoff` — guest cancellations check `cancellationCutoffHours`

### Override Types (7)
`late_arrival`, `did_not_dine`, `manager_force_book`, `deposit_override`, `block_override`, `blacklist_override`, `no_show_reversal`

### Deposit Rules
- **3 modes:** `disabled`, `optional`, `required`
- **3 amount modes:** `flat` (fixed amount), `per_guest` (amount x party size), `percentage`
- **Triggers:** party size threshold, large party override, online booking override
- **Refund tiers:** `always` (minus nonRefundablePercent), `cutoff` (full before hours, none after), `never`
- **Token-based payment:** deposit links with configurable expiration
- **Snapshot:** deposit rules captured at booking time for audit (rules may change later)

### Customer Matching
- **Phone-first:** E.164 normalized phone lookup (primary)
- **Email fallback:** case-insensitive email match
- **Auto-create:** new Customer record if no match
- **No-show tracking:** `incrementNoShowCount()` → auto-blacklist at threshold
- **Blacklist override:** temporary window via `blacklistOverrideUntil`

### Availability Engine
- Slot interval configurable (default 15 min)
- Default turn time configurable (default 90 min)
- Per-table turn time overrides
- Cross-midnight venue support
- Reservation blocks: full-day, time-range, table-specific, section-specific
- Reduced capacity blocks (percentage-based)
- Expired holds excluded from blocking

### Table Suggestion
- Scoring: capacity fit (highest weight), priority bonus, section preference, capacity range
- Table combinations: pairs first, then triples (bidirectional combinability check)
- Top 10 suggestions returned, sorted by score

### Waitlist Bridge
- Cancelled slot > 30 min away triggers bridge
- First-in-queue waitlist entry with matching party size gets offered
- 10-minute claim window (configurable)
- SMS notification with manage link
- Unclaimed offers handled by hold-expiry cron

### Advisory Locks
- PostgreSQL `pg_advisory_xact_lock` per 15-minute bucket
- Locks sorted ascending before acquisition (deadlock prevention)
- Auto-release on transaction commit/rollback
- 300ms warning threshold for lock contention

---

## Schema

### Reservation
```
id, locationId, guestName, guestPhone, guestEmail, partySize,
reservationDate, reservationTime, duration, tableId, status,
specialRequests, internalNotes, customerId, orderId,
bottleServiceTierId, occasion, dietaryRestrictions, source,
externalId, sectionPreference, confirmationSentAt, reminder24hSentAt,
reminder2hSentAt, thankYouSentAt, confirmedAt, checkedInAt,
manageToken (unique), tags (JSON), serviceDate, holdExpiresAt,
depositStatus, depositAmountCents, depositRulesSnapshot (JSON),
statusUpdatedAt, sourceMetadata (JSON), smsOptInSnapshot,
depositRequired, depositAmount, createdBy, seatedAt, completedAt,
cancelledAt, cancelReason, createdAt, updatedAt, deletedAt, syncedAt
```

### ReservationBlock
```
id, locationId, name, reason, blockDate, startTime, endTime,
isAllDay, reducedCapacityPercent, blockedTableIds (JSON),
blockedSectionIds (JSON), createdBy, createdAt, updatedAt, deletedAt
```

### ReservationTable (junction)
```
reservationId, tableId, createdAt  (composite PK)
```

### ReservationEvent (audit trail)
```
id, locationId, reservationId, eventType, actor, actorId,
details (JSON), createdAt
```

### ReservationIdempotencyKey
```
key (PK), reservationId, source, createdAt
```

### ReservationDepositToken
```
token (PK), reservationId, expiresAt, usedAt, createdAt
```

### ReservationDeposit
```
id, locationId, reservationId, type, amount, paymentMethod,
cardLast4, cardBrand, datacapRecordNo, datacapRefNumber,
status, refundedAmount, refundedAt, refundReason, employeeId,
notes, createdAt, updatedAt, deletedAt, syncedAt
```

---

## Settings

### ReservationSettings (in `Location.settings.reservationSettings`)
| Field | Default | Description |
|-------|---------|-------------|
| `defaultTurnTimeMinutes` | 90 | Default seating duration |
| `slotIntervalMinutes` | 15 | Booking grid interval |
| `maxPartySize` | 20 | Max bookable party size |
| `cancellationCutoffHours` | 2 | Guest cannot cancel within this window |
| `modificationCutoffHours` | 4 | Guest cannot modify within this window |
| `serviceEndHour` | 4 | Hour that ends previous service date (for late-night venues) |
| `autoConfirmNoDeposit` | true | Auto-confirm when no deposit required |

### DepositRules (in `Location.settings.depositRules`)
| Field | Default | Description |
|-------|---------|-------------|
| `enabled` | false | Master toggle |
| `requirementMode` | disabled | `required` / `optional` / `disabled` |
| `defaultAmountCents` | 2500 | Flat deposit ($25) |
| `perGuestAmountCents` | 1000 | Per-guest amount ($10/person) |
| `depositMode` | flat | `flat` / `per_guest` / `percentage` |
| `partySizeThreshold` | 0 | Party size that triggers deposit (0 = all) |
| `forceForLargeParty` | false | Override for large parties |
| `largePartyThreshold` | 8 | What counts as "large" |
| `forceForOnline` | false | Require deposit for online bookings |
| `refundableBefore` | cutoff | `always` / `cutoff` / `never` |
| `refundCutoffHours` | 24 | Hours before reservation for full refund |
| `nonRefundablePercent` | 0 | Percentage withheld on refund |
| `expirationMinutes` | 60 | Deposit payment link TTL |

### ReservationMessageTemplates (in `Location.settings.reservationTemplates`)
Templates for: `confirmation`, `reminder24h`, `reminder2h`, `cancellation`, `depositRequest`, `depositReceived`, `refundIssued`, `thankYou`, `slotFreed`, `customManual`, `modification`, `noShow`, `waitlistPromoted`

Each template has: `smsBody`, `subject` (email), `emailBody` (HTML)

---

## Permissions

| Action | Permission Key | Level |
|--------|---------------|-------|
| Create/modify/cancel reservations | `tables.reservations` | Medium |
| Access reservation calendar | `tables.reservations` | Medium |
| Hold tables for future guests | `tables.reservations` | Medium |

> **Note:** The current permission model uses a single key (`tables.reservations`) for all reservation operations. Granular sub-permissions (e.g., separate cancel, no-show override, send message) are a future enhancement.

---

## Socket Events

### Emitted (POS → Clients)
| Event | Payload | Trigger |
|-------|---------|---------|
| `reservation:changed` | `{ reservationId, action, reservation }` | All status transitions, creation, modification |
| `reservation:new_online` | `{ reservationId, guestName, partySize }` | Online booking specifically (for host alert) |

---

## Cron Jobs

| Route | Interval | Description |
|-------|----------|-------------|
| `reservation-hold-expiry` | `*/2` (every 2 min) | Cancel pending reservations with expired `holdExpiresAt` |
| `reservation-no-shows` | `*/5` (every 5 min) | Mark confirmed reservations past their time as no-show, increment customer no-show count, auto-blacklist at threshold |
| `reservation-reminders` | `*/15` (every 15 min) | Send 24h and 2h reminder notifications via SMS/email |
| `reservation-thank-you` | `*/30` (every 30 min) | Send thank-you messages after reservation completion |

---

## Third-Party Integrations

- **Inbound:** `POST /api/webhooks/reservations/[platform]` — receives bookings from external platforms
- **Outbound:** `POST /api/reservations/[id]/sync-out` — pushes reservation to external platform
- **Platforms:** OpenTable, Resy, Google, Yelp, Custom API
- **Settings:** `/settings/integrations/reservations` — per-platform credential and sync configuration
- **Sources:** `staff`, `online`, `waitlist`, `opentable`, `resy`, `google`, `yelp`, `import`, `other`

---

## Event Types (28)

`created`, `modified`, `confirmed`, `checked_in`, `seated`, `completed`, `cancelled`, `no_show_marked`, `no_show_overridden`, `deposit_requested`, `deposit_paid`, `deposit_refunded`, `deposit_forfeited`, `deposit_auto_refunded_after_cancel`, `confirmation_sent`, `reminder_24h_sent`, `reminder_2h_sent`, `cancellation_sent`, `thank_you_sent`, `custom_message_sent`, `table_assigned`, `table_changed`, `party_size_changed`, `override_applied`, `block_conflict_warning`, `slot_offered`, `slot_claimed`, `checkin_ambiguous`, `integration_sync_in`, `integration_sync_out`

---

## Cross-Feature Dependencies

> See `_CROSS-REF-MATRIX.md` for full matrix.

### This feature DEPENDS ON:
| Feature | How / Why |
|---------|-----------|
| Customers | Customer matching (phone/email), no-show tracking, blacklist |
| Tables / Floor Plan | Table assignment, capacity checking, section preferences, combinations |
| Orders | `orderId` FK — linked on seating |
| Twilio SMS | SMS confirmations, reminders, text-to-pay deposit links |
| Resend Email | Email confirmations, reminders, ICS calendar invites |
| Datacap | Deposit payments via ReservationDeposit |
| Waitlist | Bridge: cancelled slot → waitlist offer |
| Settings | ReservationSettings, DepositRules, ReservationMessageTemplates, operating hours |

### This feature is DEPENDED ON BY:
| Feature | How / Why |
|---------|-----------|
| Floor Plan | Reservation count badges on tables |
| Customers | No-show count, blacklist status driven by reservations |
| Reports | Reservation and deposit reports |
| Waitlist | Waitlist bridge consumes cancelled slots |

### BEFORE CHANGING THIS FEATURE, VERIFY:
- [ ] **Customers** — does this change affect no-show counting or blacklist logic?
- [ ] **Tables** — does this change affect table capacity or assignment?
- [ ] **Deposits** — does this change affect deposit flow or refund calculations?
- [ ] **Notifications** — does this change require new/updated templates?
- [ ] **Waitlist** — does this change affect the cancelled-slot bridge?
- [ ] **Socket** — does this change require updating `reservation:changed` payload?
- [ ] **Cron** — does this change affect hold expiry, no-show, or reminder timing?

---

## Known Constraints & Limits
- **Deposits stubbed for Datacap integration** — `ReservationDeposit` model exists with `datacapRecordNo`/`datacapRefNumber` fields, but no real payment processing wired yet
- **ICS timezone hardcoded to US timezones** — `buildVTimezone()` has data for 7 US zones; unknown timezones get a minimal fallback
- **Third-party API calls stubbed** — webhook infrastructure ready, platform-specific API credentials not configured
- **No guest account portal** — guests access reservations via token-based URLs only (no login)
- **Guest cannot change party size online** — party size changes require staff assistance (revalidation engine enforces)
- **Table combinations limited to triples** — algorithm tries pairs first, then triples; no quad+ combinations

---

## Related Docs
- **Cross-ref matrix:** `docs/features/_CROSS-REF-MATRIX.md`
- **Settings types:** `src/lib/settings.ts` (`ReservationSettings`, `DepositRules`, `ReservationMessageTemplates`)
- **Socket dispatch:** `src/lib/socket-dispatch.ts` (`dispatchReservationChanged`)
- **Permission registry:** `src/lib/permission-registry.ts` (`tables.reservations`)

---

*Last updated: 2026-03-17*
