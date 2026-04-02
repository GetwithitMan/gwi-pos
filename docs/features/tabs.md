# Feature: Tabs (Bar Tabs)

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find Tabs → read every listed dependency doc.

## Summary
Tabs are open-ended orders with a special lifecycle for bar service. A tab begins with a card-first pre-authorization flow (via Datacap), allows incremental authorizations at configurable spend thresholds (80%), supports multi-card management, bottle service tiers with deposit tracking, tab transfers between employees, and walkout recovery with automatic retry scheduling. Tabs display with nickname-first priority and provide real-time updates via Socket.io.

## Status
`Active`

## Repos Involved
| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | API, POS UI, admin reporting | Full |
| `gwi-android-register` | Tab management, open/close, nickname edit | Full |
| `gwi-cfd` | Tip prompt on tab close | Partial |
| `gwi-backoffice` | Open tab aging reports | Partial |
| `gwi-mission-control` | N/A | None |

---

## UI Entry Points

| Interface | Path / Screen | Who Accesses |
|-----------|--------------|--------------|
| Mobile | `/mobile/tabs` → `src/app/(mobile)/mobile/tabs/page.tsx` | Bartenders |
| Android | `NewTabDialog.kt` — Tab open flow | All staff |
| Android | `TabListSheet.kt` — Tab list with nickname-first display | All staff |

---

## Code Locations

### gwi-pos
| File / Directory | Purpose |
|-----------------|---------|
| `src/app/(mobile)/mobile/tabs/page.tsx` | Mobile tab management |
| `src/app/api/tabs/route.ts` | GET/POST tabs (list/create) |
| `src/app/api/tabs/[id]/route.ts` | GET/PUT tab details/close/update; accepts `tabNickname` |
| `src/app/api/tabs/[id]/transfer/route.ts` | Tab transfer between employees |
| `src/app/api/datacap/preauth/` | Pre-authorize card for tab |
| `src/app/api/datacap/capture/` | Capture final amount on close |
| `src/app/api/datacap/increment/` | Incremental auth at threshold |
| `src/app/api/datacap/collect-card/` | Collect card data for tab |
| `src/app/api/datacap/walkout-retry/` | Retry walkout charges |
| `src/components/tabs/TabsPanel.tsx` | Tab list panel |
| `src/components/tabs/NewTabModal.tsx` | New tab creation modal |
| `src/components/tabs/CardFirstTabFlow.tsx` | Card-first tab opening flow |
| `src/components/tabs/TabNamePromptModal.tsx` | Tab nickname prompt |
| `src/components/tabs/BottleServiceBanner.tsx` | Bottle service progress tracking |
| `src/components/tabs/MultiCardBadges.tsx` | Multi-card display badges |
| `src/components/tabs/AuthStatusBadge.tsx` | Authorization status indicator |
| `src/components/tabs/PendingTabAnimation.tsx` | Shimmer animation during auth |
| `src/lib/socket-dispatch.ts` | `dispatchTabUpdated()`, `dispatchTabClosed()`, `dispatchTabStatusUpdate()` |

### gwi-android-register
| File | Purpose |
|------|---------|
| `NewTabDialog.kt` | Tab open flow with dual name fields (tabName + tabNickname) |
| `TabListSheet.kt` | Tab list with nickname-first display |

---

## API Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/tabs` | Employee PIN | List open/closed tabs |
| `POST` | `/api/tabs` | Employee PIN | Create new tab (emits ORDER_CREATED + TAB_OPENED events) |
| `GET` | `/api/tabs/[id]` | Employee PIN | Tab details |
| `PUT` | `/api/tabs/[id]` | Employee PIN | Update tab (close, nickname, etc.) |
| `POST` | `/api/tabs/[id]/transfer` | Employee PIN | Transfer tab to another employee |
| `POST` | `/api/datacap/preauth` | Employee PIN | Pre-authorize card |
| `POST` | `/api/datacap/capture` | Employee PIN | Capture final amount |
| `POST` | `/api/datacap/increment` | Employee PIN | Incremental auth |
| `POST` | `/api/datacap/collect-card` | Employee PIN | Collect card data |
| `POST` | `/api/datacap/walkout-retry` | Manager | Retry walkout charges |

---

## Socket Events

### Emitted (POS → Clients)
| Event | Payload | Trigger |
|-------|---------|---------|
| `tab:updated` | `{ orderId, status? }` | Tab status change (opened, closed, captured) |
| `tab:closed` | `{ orderId, total, tipAmount }` | Tab closed (mobile notification) |
| `tab:status-update` | `{ orderId, status }` | Tab status update (mobile) |

### Received (Clients → POS)
| Event | Source | Purpose |
|-------|--------|---------|
| `tab:updated` | Socket listener | Mobile tabs page debounced refresh |

**Note:** `tab:items-updated` is defined in types but never emitted — dead code/stub.

---

## Data Model

Key fields on the `Order` model (tabs are orders with `isTab = true`):

```
Order {
  isTab           Boolean   // true = this order is a tab
  tabStatus       String?   // 'open' | 'closed'
  tabName         String?   // Cardholder name (read-only, from chip data)
  tabNickname     String?   // Bartender-assigned display name (editable, 30-char max)
  preAuthId       String?   // Pre-auth transaction ref
  preAuthAmount   Decimal?  // Pre-auth amount
  preAuthLast4    String?   // Card last 4 digits
  preAuthCardBrand String?  // Visa, Mastercard, etc.
  preAuthExpiresAt DateTime? // When hold expires
  preAuthRecordNo String?   // Datacap RecordNo token
  isBottleService Boolean   // Bottle service flag
  bottleServiceCurrentSpend Decimal?  // Denormalized bottle spend
  isWalkout       Boolean   // Walkout recovery flag
  walkoutAt       DateTime? // When marked as walkout
}

OrderCard {
  id, locationId, orderId, readerId
  recordNo        String    // Datacap RecordNo token for capture/increment/void
  cardType, cardLast4, cardholderName
  authAmount      Decimal   // Current total authorized
  isDefault       Boolean   // Default payment card for this tab
  status          OrderCardStatus  // authorized | captured | voided
  capturedAmount, capturedAt, tipAmount
}

WalkoutRetry {
  id, locationId, orderId, orderCardId
  amount          Decimal   // Amount to capture
  nextRetryAt     DateTime  // Retry schedule
  retryCount, maxRetries
  status          WalkoutRetryStatus  // pending | collected | written_off
}
```

---

## Business Logic

### Primary Flow — Card-First Tab Opening
1. Bartender initiates new tab → card-first flow begins
2. Customer taps/dips card → Datacap pre-auth call with configurable amount
3. System creates `Order` with `isTab = true`, creates `OrderCard` with `recordNo` token
4. Tab appears in tab list with pending animation → resolves when auth confirmed
5. Bartender can set `tabNickname` (e.g., "Big Mike", "Corner Booth")

### Incremental Authorization
1. System monitors tab spend vs authorized amount
2. At 80% threshold (configurable), automatic incremental auth request sent to Datacap
3. `OrderCard.authAmount` updated with new authorized total

### Tab Close & Capture
1. Bartender closes tab → final total calculated (subtotal + tax + tip)
2. Datacap capture call with `OrderCard.recordNo` for exact amount
3. Emits TAB_CLOSED + PAYMENT_APPLIED + ORDER_CLOSED events
4. Socket `tab:updated` dispatched to all terminals

### Walkout Recovery
1. If capture fails (card declined, expired), order marked as walkout
2. `WalkoutRetry` record created with retry schedule
3. Auto-retry via `/api/datacap/walkout-retry` with exponential backoff
4. Manager can manually write off after max retries

### Tab Naming Rules
- **`tabName`** = cardholder name from chip (auto-filled, **read-only**, retained for payment records)
- **`tabNickname`** = bartender-assigned display name ("Big Mike", "Corner Booth") — **editable**, 30-char max
- **Display priority:** nickname → card name → "Tab #N"
- When nickname differs from card name, card name shows as subtitle

### Edge Cases & Business Rules
- Multi-card tabs: multiple `OrderCard` records per order, one marked `isDefault`
- Bottle service: `isBottleService` flag with deposit pre-auth and spend progress tracking
- Tab transfer: changes `Order.employeeId` to new bartender
- Incremental auth threshold is configurable per location in settings

---

## Cross-Feature Dependencies

> See `_CROSS-REF-MATRIX.md` for full matrix.

### This feature MODIFIES these features:
| Feature | How / Why |
|---------|-----------|
| Reports | Open tab aging, tab revenue |
| Payments | Capture on close triggers payment flow |

### These features MODIFY this feature:
| Feature | How / Why |
|---------|-----------|
| Orders | Tab is an open-ended order with special lifecycle |
| Payments | Pre-auth, capture, incremental auth via Datacap |
| Employees | Tab ownership and transfer |

### BEFORE CHANGING THIS FEATURE, VERIFY:
- [ ] **Payments** — does change affect Datacap pre-auth/capture flow?
- [ ] **Orders** — does tab lifecycle change affect order event sourcing?
- [ ] **Employees** — does tab transfer affect tip ownership?
- [ ] **Offline** — pre-auth requires network; what happens offline?
- [ ] **Socket** — does this change require new/updated `tab:updated` payload?

---

## Permissions Required

| Action | Permission Key | Level |
|--------|---------------|-------|
| Open tab | `TAB_OPEN` | Standard |
| Close tab | `TAB_CLOSE` | Standard |
| Transfer tab | `TAB_TRANSFER` | High |
| Write off walkout | `TAB_WRITEOFF` | Critical |
| View all tabs | `TAB_VIEW_ALL` | High |

---

## Known Constraints & Limits
- Pre-auth requires active network — cannot open card-based tabs offline
- `tabNickname` max 30 characters
- Walkout retry max attempts configurable (default 10)
- Incremental auth threshold default 80% — configurable per location
- `tab:items-updated` event defined but never emitted (dead code)

---

## Android-Specific Notes
- `NewTabDialog.kt`: Tab open flow with dual name fields (tabName from card + tabNickname editable)
- `TabListSheet.kt`: Tab list with nickname-first display, Open/Closed badge, balance due
- Full tab management: open, close, add items, edit nickname
- Socket listener for `tab:updated` events triggers tab list refresh

---

## Related Docs
- **Domain doc:** `docs/domains/TABS-DOMAIN.md`
- **Payments guide:** `docs/guides/PAYMENTS-RULES.md`
- **Skills:** Skill 20, 21, 22, 245
- **Changelog:** `docs/changelogs/TABS-CHANGELOG.md`

---

*Last updated: 2026-03-03*
