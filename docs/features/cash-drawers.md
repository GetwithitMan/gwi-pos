# Feature: Cash Drawers

> **Before editing this feature:** Read `_CROSS-REF-MATRIX.md` → find this feature → read every listed dependency doc.

## Summary
Physical cash drawer management with automatic kick on cash payment (fire-and-forget ESC/POS command), per-shift drawer assignment, cash reconciliation at shift close, paid in/out transactions, and denomination counting. Drawers connect to receipt printers via TCP. Three cash handling modes: drawer, purse, none.

## Status
`Active`

## Repos Involved
| Repo | Role | Coverage |
|------|------|----------|
| `gwi-pos` | API, shift integration, ESC/POS commands, reconciliation | Full |
| `gwi-android-register` | Cash payment triggers drawer kick | Partial |
| `gwi-cfd` | N/A | None |
| `gwi-backoffice` | Cloud sync of drawer data | Partial |
| `gwi-mission-control` | N/A | None |

---

## UI Entry Points

| Interface | Path / Screen | Who Accesses |
|-----------|--------------|--------------|
| POS Web | ShiftStartModal (drawer selection) | All staff |
| POS Web | ShiftCloseoutModal (denomination counting) | All staff |
| Admin | Dashboard (shift/drawer status) | Managers |
| Reports | Cash liabilities report | Managers |

---

## Code Locations

### gwi-pos
| File / Directory | Purpose |
|-----------------|---------|
| `src/lib/cash-drawer.ts` | `triggerCashDrawer()` — sends ESC/POS kick command |
| `src/lib/escpos/commands.ts` | `ESCPOS.DRAWER_KICK` byte sequence |
| `src/lib/printer-connection.ts` | TCP socket connection to printer |
| `src/lib/escpos/shift-closeout-receipt.ts` | Shift closeout receipt builder |
| `src/app/api/drawers/route.ts` | GET list drawers with availability |
| `src/app/api/shifts/route.ts` | GET/POST shift with drawer assignment |
| `src/app/api/shifts/[id]/route.ts` | PUT close shift with reconciliation |
| `src/app/api/print/cash-drawer/route.ts` | POST send drawer kick command |
| `src/app/api/print/shift-closeout/route.ts` | POST print shift closeout receipt |
| `src/app/api/orders/[id]/pay/route.ts` | Fire-and-forget drawer kick on cash payment (line 1422) |
| `src/app/api/reports/cash-liabilities/route.ts` | GET cash liabilities report |
| `src/components/shifts/ShiftStartModal.tsx` | Drawer selection + starting cash |
| `src/components/shifts/ShiftCloseoutModal.tsx` | Denomination counting + variance |

---

## API Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `GET` | `/api/drawers` | Employee PIN | List drawers with availability |
| `POST` | `/api/shifts` | Employee PIN | Start shift (optional drawer + cash handling mode) |
| `PUT` | `/api/shifts/[id]` | Employee PIN | Close shift with cash reconciliation |
| `POST` | `/api/print/cash-drawer` | Employee PIN | Send drawer kick ESC/POS command |
| `POST` | `/api/print/shift-closeout` | Employee PIN | Print shift closeout receipt |
| `GET` | `/api/reports/cash-liabilities` | Manager | Cash liabilities report |

---

## Socket Events

### Emitted (POS → Clients)
| Event | Payload | Trigger |
|-------|---------|---------|
| `shifts:changed` | — | Shift opened or closed |

---

## Data Model

```
Drawer {
  id              String
  locationId      String
  name            String            // "Bar Drawer 1", "Register 1"
  deviceId        String?           // associated terminal ID
  isActive        Boolean
  deletedAt       DateTime?
}

PaidInOut {
  id              String
  locationId      String
  drawerId        String
  type            Enum              // in | out
  amount          Decimal
  reason          String
  reference       String?           // check number, vendor
  employeeId      String
  approvedBy      String?           // manager who approved
  deletedAt       DateTime?
}

Shift (drawer-related fields) {
  drawerId        String?           // null for purse/none mode
  startingCash    Decimal
  expectedCash    Decimal?
  actualCash      Decimal?
  variance        Decimal?          // actual - expected
  cashSales       Decimal?
  cardSales       Decimal?
}

Payment (drawer-related fields) {
  drawerId        String?           // which physical drawer received cash
  shiftId         String?           // shift attribution
}
```

---

## Business Logic

### Cash Handling Modes
| Mode | Description | Shift Start | Shift Close |
|------|-------------|-------------|-------------|
| `drawer` | Physical drawer assigned | Select drawer, count starting cash | Count drawer contents |
| `purse` | Server carries own cash | Enter purse amount | Count purse |
| `none` | No cash handling (barback) | Auto-start, no modal | Skip cash step |

### Drawer Kick Flow
1. Payment processed with `paymentMethod === 'cash'`
2. Fire-and-forget: `void triggerCashDrawer(locationId).catch(() => {})`
3. Find receipt printer (`printerRole: 'receipt'`, active, not deleted)
4. Send ESC/POS command: `[0x1b, 0x70, 0x00, 0x19, 0x78]`
5. TCP socket to printer IP:port
6. **Never blocks payment** — always resolves, logs warning on failure

### Shift Reconciliation
1. Employee clicks "Close Shift"
2. Denomination counting interface ($100, $50, $20... $0.01)
3. System calculates: `expectedCash = startingCash + netCashReceived`
4. Employee enters counted total → system calculates variance
5. If shift has `drawerId`: expected cash includes ALL cash from that drawer
6. Close shift records: actualCash, variance, totalSales, cashSales, cardSales, tipsDeclared
7. Print shift closeout receipt (fire-and-forget)

### Drawer Availability
- Drawer marked unavailable if claimed by an open shift
- `GET /api/drawers` returns `isAvailable` and `claimedBy` per drawer
- Conflict check: `db.shift.findFirst({ drawerId, status: 'open' })`

### Payment Attribution
1. If terminal has physical drawer + claimed by open shift → use that drawer + shift
2. Else if employee has open shift with drawer → use employee's shift's drawer
3. Else → null (card payment or no drawer)

### ESC/POS Command
```
DRAWER_KICK = Buffer.from([0x1b, 0x70, 0x00, 0x19, 0x78])
```
Compatible with Epson TM-T88VII (thermal) and TM-U220 (impact).

### Edge Cases & Business Rules
- Drawer kick is fire-and-forget — 7-10 second TCP timeout if printer offline
- One open session per employee (cannot have 2+ drawers simultaneously)
- Drawer exclusivity: one employee per drawer per shift
- Payouts above $25 threshold require manager approval
- Large variances flag for manager review
- 3 drawers seeded per location by default

---

## Cross-Feature Dependencies

### This feature MODIFIES these features:
| Feature | How / Why |
|---------|-----------|
| Reports | Cash drawer audit, shift variance reports |
| Shifts | Drawer reconciliation at shift close |

### These features MODIFY this feature:
| Feature | How / Why |
|---------|-----------|
| Payments | Cash payments trigger drawer kick |
| Shifts | Drawer assigned to shift on open |
| Hardware | Drawer connected to receipt printer |

### BEFORE CHANGING THIS FEATURE, VERIFY:
- [ ] **Payments** — fire-and-forget pattern on cash payment (never block)
- [ ] **Shifts** — drawer assignment and reconciliation calculations
- [ ] **Hardware** — receipt printer connection for drawer kick
- [ ] **Reports** — cash liabilities report calculations

---

## Permissions Required

| Action | Permission Key | Level |
|--------|---------------|-------|
| Open/close own drawer | Employee PIN | Standard |
| View all drawer activity | Manager role | High |
| Approve large payouts | Manager role | Critical |

---

## Known Constraints & Limits
- TCP timeout: 7-10 seconds if printer not connected
- Drawer kick command is universal ESC/POS standard
- One drawer per open shift per employee
- Cash liabilities report includes: drawer cash, house accounts, gift cards, tip ledger

---

## Android-Specific Notes
- Cash payment triggers drawer kick via API
- Shift management available on Android crew screen

---

## Related Docs
- **Spec:** `docs/skills/SPEC-37-DRAWER-MANAGEMENT.md`
- **Multi-role cash handling:** `docs/skills/249-MULTI-ROLE-CASH-HANDLING-CREW-HUB.md`
- **Cross-ref:** `docs/features/_CROSS-REF-MATRIX.md` → Cash Drawers row
- **Hardware domain:** `docs/domains/HARDWARE-DOMAIN.md`

---

*Last updated: 2026-03-03*
