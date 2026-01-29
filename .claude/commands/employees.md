# Employee Management (Skills 47-48)

Manage employees, roles, permissions, time clock, and breaks.

## Overview

Employee management handles staff records, role-based permissions, PIN authentication, time tracking, and break management.

## Employee Records

### Create Employee
1. Go to `/employees`
2. Click "Add Employee"
3. Fill in details:
   - First/Last Name
   - Display Name (for POS)
   - Email (optional)
   - Phone (optional)
   - PIN (4-6 digits)
   - Role
   - Hourly Rate

### Employee Fields

| Field | Description |
|-------|-------------|
| firstName | Legal first name |
| lastName | Legal last name |
| displayName | Shown on POS, receipts |
| email | For notifications |
| phone | Contact number |
| pin | Login PIN (4-6 digits) |
| roleId | Assigned role |
| hourlyRate | Pay rate |
| hireDate | Start date |
| color | Display color in UI |
| isActive | Can login |

## Roles & Permissions

### Default Roles

| Role | Description |
|------|-------------|
| Owner | Full access to everything |
| Manager | Admin access, reports, settings |
| Bartender | POS, bar functions, tabs |
| Server | POS, tables, orders |
| Host | Reservations, waitlist |
| Busser | Limited POS view |

### Permissions

```
admin                  - Full admin access
manage_menu            - Edit menu items
manage_employees       - Edit staff
manage_settings        - Change settings
view_reports           - Access reports
process_payments       - Take payments
void_items             - Void items
apply_discounts        - Apply discounts
open_drawer            - Open cash drawer
clock_in_out           - Use time clock
manage_reservations    - Handle reservations
tips.view_own          - See own tips
tips.view_all          - See all tips
tips.share             - Share tips
tips.manage_rules      - Edit tip rules
```

### Create Custom Role
1. Go to `/settings/roles`
2. Click "Add Role"
3. Name the role
4. Select permissions
5. Save

## Time Clock

### Clock In/Out
1. From POS, click clock icon
2. Enter PIN
3. System records timestamp
4. Shows current shift status

### Time Clock Modal
- Shows current status (clocked in/out)
- Shift duration
- Break time taken
- Clock in/out button

### Shift Records
- Clock in time
- Clock out time
- Total hours
- Break time deducted
- Overtime calculated

## Breaks (Skill 48)

### Start Break
1. Click clock icon
2. Select "Start Break"
3. Choose break type:
   - Paid Break (10-15 min)
   - Unpaid Break (30+ min)

### End Break
1. Click clock icon
2. Click "End Break"
3. Break time recorded

### Break Tracking
- Break start/end times
- Break duration
- Paid vs unpaid
- Deducted from shift hours (if unpaid)

## API Endpoints

### List Employees
```
GET /api/employees?locationId=xxx
```

### Create Employee
```
POST /api/employees
{
  "locationId": "xxx",
  "firstName": "John",
  "lastName": "Doe",
  "pin": "1234",
  "roleId": "role-server"
}
```

### Clock In
```
POST /api/time-clock/clock-in
{
  "employeeId": "xxx",
  "locationId": "yyy"
}
```

### Start Break
```
POST /api/time-clock/break/start
{
  "shiftId": "xxx",
  "breakType": "paid"
}
```

## Database Models

### Employee
```prisma
model Employee {
  id          String   @id
  locationId  String
  firstName   String
  lastName    String
  displayName String?
  email       String?
  phone       String?
  pin         String
  roleId      String
  hourlyRate  Decimal?
  hireDate    DateTime?
  color       String?
  isActive    Boolean  @default(true)
}
```

### Shift
```prisma
model Shift {
  id          String    @id
  employeeId  String
  locationId  String
  clockIn     DateTime
  clockOut    DateTime?
  breaks      Break[]
  totalHours  Decimal?
}
```

### Break
```prisma
model Break {
  id        String    @id
  shiftId   String
  startTime DateTime
  endTime   DateTime?
  breakType String    // paid, unpaid
  duration  Int?      // minutes
}
```

## Key Files

| File | Purpose |
|------|---------|
| `src/app/(admin)/employees/page.tsx` | Employee management |
| `src/app/api/employees/route.ts` | Employees CRUD |
| `src/components/time-clock/TimeClockModal.tsx` | Time clock UI |
| `src/app/api/time-clock/route.ts` | Time clock API |
| `src/stores/auth-store.ts` | Auth & employee state |
