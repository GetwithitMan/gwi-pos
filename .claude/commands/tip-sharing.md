# Tip Sharing

Comprehensive tip sharing system with automatic role-based tip-outs, custom sharing, and banked tips tracking.

## Overview

The tip sharing system provides:
- **Role-based tip-outs** - Automatic percentage deductions (e.g., 3% to Busser, 2% to Bar)
- **One-off tip sharing** - Share specific amounts to individual employees
- **Banked tips** - Track tips for employees not on shift (for payroll or future collection)
- **Tips reporting** - Detailed views of tip distribution and collection

## Tip-Out Rules

Configure automatic tip-out percentages at `/settings/tip-outs`.

### Creating a Rule

1. Navigate to Settings → Tip-Outs
2. Click "Add Tip-Out Rule"
3. Select:
   - **From Role**: Role that tips out (e.g., Server)
   - **To Role**: Role that receives (e.g., Busser)
   - **Percentage**: Amount to tip out (e.g., 3%)
4. Save the rule

### Example Configuration

| From Role | To Role | Percentage |
|-----------|---------|------------|
| Server | Busser | 3% |
| Server | Bartender | 2% |
| Server | Host | 1% |
| Bartender | Barback | 5% |

## Shift Closeout Flow

When a tipped employee closes their shift:

1. **Cash Count** - Count drawer as usual
2. **Tip Distribution** (new step):
   - View gross tips collected
   - See auto-calculated role tip-outs
   - Add custom one-off shares
   - Review net tips to keep
3. **Complete Closeout**

### Tip Distribution UI

```
┌─────────────────────────────────────────────┐
│           TIP DISTRIBUTION                  │
├─────────────────────────────────────────────┤
│ Gross Tips Collected:           $156.00     │
├─────────────────────────────────────────────┤
│ AUTOMATIC TIP-OUTS (from rules)             │
│   Busser (3%):                   -$4.68     │
│   Bartender (2%):                -$3.12     │
│   Host (1%):                     -$1.56     │
├─────────────────────────────────────────────┤
│ CUSTOM SHARES                               │
│   + Add one-off tip share                   │
│   [Select Employee ▼] [$_____]  [Add]       │
│                                             │
│   → Sarah (Server):              -$10.00    │
├─────────────────────────────────────────────┤
│ YOUR NET TIPS:                  $136.64     │
└─────────────────────────────────────────────┘
```

## Banked Tips

When a tip share is created and the recipient is **not on shift**:
- Tip is marked as "banked"
- Goes into TipBank for later collection
- Can be collected at next clock-in or paid via payroll

### Collection Methods

1. **At Clock-In**: Employee sees notification of pending tips
2. **During Shift**: Can view and collect via time clock
3. **Payroll**: Manager pays out banked tips

## Tip Collection

Employees see pending tips when clocked in:

```
┌─────────────────────────────────────────────┐
│ 💰 You have tips to collect!                │
│                                             │
│ From Sarah S. (Server):          $4.68      │
│ From Mike B. (Bartender):        $2.50      │
│ ──────────────────────────────────          │
│ Total:                           $7.18      │
│                                             │
│ [ Collect Tips ]  [ Remind Me Later ]       │
└─────────────────────────────────────────────┘
```

## API Endpoints

### Tip-Out Rules

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/tip-out-rules` | GET | List rules for location |
| `/api/tip-out-rules` | POST | Create new rule |
| `/api/tip-out-rules/[id]` | GET | Get single rule |
| `/api/tip-out-rules/[id]` | PUT | Update rule |
| `/api/tip-out-rules/[id]` | DELETE | Delete rule |

### Employee Tips

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/employees/[id]/tips` | GET | Get pending/banked tips |
| `/api/employees/[id]/tips` | POST | Collect pending tips |

### Reports

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/reports/tips` | GET | Tips report data |

#### Tips Report Parameters

```
GET /api/reports/tips?locationId=xxx&startDate=2026-01-01&endDate=2026-01-28&employeeId=xxx
```

#### Response Structure

```json
{
  "byEmployee": [{
    "employeeId": "xxx",
    "employeeName": "John D.",
    "roleName": "Server",
    "grossTips": 156.00,
    "tipOutsGiven": 9.36,
    "tipOutsReceived": 0,
    "netTips": 146.64,
    "shiftCount": 1
  }],
  "tipShares": [{
    "id": "xxx",
    "from": "John D.",
    "fromRole": "Server",
    "to": "Sarah S.",
    "toRole": "Busser",
    "amount": 4.68,
    "type": "role_tipout",
    "percentage": 3,
    "status": "collected",
    "date": "2026-01-28T..."
  }],
  "bankedTips": [{
    "id": "xxx",
    "employeeId": "xxx",
    "employeeName": "Mike B.",
    "amount": 2.50,
    "status": "pending",
    "source": "tip_share"
  }],
  "summary": {
    "totalGrossTips": 312.00,
    "totalTipOuts": 18.72,
    "totalBanked": 2.50,
    "totalCollected": 15.00,
    "totalPaidOut": 0
  }
}
```

## Permissions

| Permission | Description | Default Roles |
|------------|-------------|---------------|
| `tips.view_own` | See your own tips | Server, Bartender |
| `tips.view_all` | See all employees' tips | Manager |
| `tips.share` | Share tips to others | Server, Bartender |
| `tips.collect` | Collect shared tips | Server, Bartender |
| `tips.manage_rules` | Configure tip-out rules | Manager |
| `tips.manage_bank` | Manage banked tips / payroll | Manager |

## Database Models

### TipOutRule

```prisma
model TipOutRule {
  id          String   @id @default(cuid())
  locationId  String
  fromRoleId  String   // Role that tips out
  toRoleId    String   // Role that receives
  percentage  Decimal  // e.g., 3.0 for 3%
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@unique([locationId, fromRoleId, toRoleId])
}
```

### TipShare

```prisma
model TipShare {
  id              String   @id @default(cuid())
  locationId      String
  shiftId         String?
  fromEmployeeId  String
  toEmployeeId    String
  amount          Decimal
  shareType       String   // 'role_tipout' | 'custom'
  ruleId          String?
  status          String   // 'pending' | 'collected' | 'banked'
  collectedAt     DateTime?
  notes           String?
  createdAt       DateTime @default(now())
}
```

### TipBank

```prisma
model TipBank {
  id            String   @id @default(cuid())
  locationId    String
  employeeId    String
  tipShareId    String?
  amount        Decimal
  source        String   // 'tip_share'
  status        String   // 'pending' | 'collected' | 'paid_out'
  collectedAt   DateTime?
  paidOutAt     DateTime?
  payrollId     String?
  createdAt     DateTime @default(now())
}
```

## Key Files

| File | Purpose |
|------|---------|
| `src/app/(admin)/settings/tip-outs/page.tsx` | Tip-out rules configuration |
| `src/app/api/tip-out-rules/route.ts` | Tip-out rules API |
| `src/components/shifts/ShiftCloseoutModal.tsx` | Shift closeout with tip distribution |
| `src/components/time-clock/TimeClockModal.tsx` | Tip collection notification |
| `src/app/(admin)/reports/tips/page.tsx` | Tips report UI |
| `src/app/api/reports/tips/route.ts` | Tips report API |
| `src/lib/auth.ts` | Tip permissions constants |

## Admin UI Navigation

- **Settings → Tip-Outs**: Configure tip-out rules (`/settings/tip-outs`)
- **Reports → Tips Report**: View tip distribution (`/reports/tips`)
- **Reports → My Tips**: Personal tip history (`/reports/tips?employeeId=xxx`)

## Troubleshooting

### Tips Show $0.00 at Closeout
**Symptom**: Gross tips show as $0.00 even though tips were collected during the shift.

**Cause**: Payments must have `employeeId` set to be counted in the shift summary. The PaymentModal passes the current employee's ID when processing payments.

**Solution**:
- Ensure you're logged in when processing payments
- Restart the dev server if you recently updated the codebase
- Check that payments in the database have valid `employeeId` values

### "No Location Found" on Tip-Outs Settings
**Symptom**: Tip-out rules page shows "No location found. Please log in again."

**Solution**:
- Make sure you're logged in via the PIN screen
- The page uses `useAuthStore` to get employee/location data
- Log out and log back in if the issue persists

### "Failed to Create Tip-Out Rule"
**Symptom**: Error when trying to add a new tip-out rule.

**Possible Causes**:
1. **Prisma client out of sync** - Restart the dev server after schema changes
2. **Duplicate rule** - A rule for this role combination already exists
3. **Invalid percentage** - Must be between 0 and 100
4. **Same from/to role** - Cannot tip out to the same role

### Tips Not Appearing for Recipients
**Symptom**: Employee doesn't see pending tips notification.

**Check**:
- Tip share status is 'pending' (not already collected)
- Employee is clocked in
- `toEmployeeId` matches the logged-in employee
