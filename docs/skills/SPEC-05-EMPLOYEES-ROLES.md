# 05 - Employees & Roles

**Status:** Planning
**Priority:** High
**Dependencies:** 09-Features-Config

---

## Overview

The Employees & Roles skill manages all aspects of employee management - from profiles to permissions to time tracking. Critically, this skill also handles the **audit logging** requirement that every button press must be tracked.

**Primary Goal:** Provide comprehensive employee management with granular role-based permissions and complete action tracking.

---

## User Stories

### As a Manager...
- I want to add new employees and set their roles
- I want to define what each role can and cannot do
- I want to see who did what and when
- I want to manage employee schedules and time cards
- I want to approve/deny time card adjustments

### As an Employee...
- I want to clock in/out easily
- I want to see my schedule
- I want to request time off
- I want to view my hours and pay info

### As an Owner/Admin...
- I want to see a complete audit trail of all actions
- I want to set up complex permission rules
- I want to export time data for payroll
- I want to manage multiple job rates per employee

---

## Features

### Employee Profiles

#### Basic Information
- [ ] First name, Last name
- [ ] Display name (for POS)
- [ ] Employee ID (auto or manual)
- [ ] Email address
- [ ] Phone number
- [ ] Address
- [ ] Date of birth
- [ ] Profile photo

#### Employment Details
- [ ] Hire date
- [ ] Employment type (full-time, part-time, contractor)
- [ ] Employment status (active, inactive, terminated)
- [ ] Termination date (if applicable)
- [ ] Termination reason

#### Job Assignments
- [ ] Multiple jobs supported (Server, Bartender, Host)
- [ ] Pay rate per job
- [ ] Pay type (hourly, salary)
- [ ] Primary job designation
- [ ] Department assignment

#### Authentication
- [ ] POS PIN (4-6 digits)
- [ ] Admin password (for backend)
- [ ] PIN requirements (unique, secure)
- [ ] Password requirements
- [ ] Failed attempt lockout

#### Emergency Contact
- [ ] Contact name
- [ ] Relationship
- [ ] Phone number

### Role Management

#### Built-In Roles
Pre-configured roles that can be customized:
- **Server:** Basic order taking and payment
- **Bartender:** Server + bar-specific features
- **Host:** Table/floor management
- **Cashier:** Quick service focus
- **Shift Lead:** Team oversight
- **Manager:** Full operational control
- **Owner:** All permissions
- **Admin:** System configuration

#### Custom Roles
- [ ] Create custom roles
- [ ] Clone existing role as starting point
- [ ] Define role hierarchy
- [ ] Role descriptions

### Permission System

#### Permission Categories

**Order Permissions:**
```
orders.create              - Create new orders
orders.view.own            - View own orders
orders.view.all            - View all orders
orders.modify.own          - Modify own orders
orders.modify.all          - Modify any order
orders.void.own.unsent     - Void own items before send
orders.void.own.sent       - Void own items after send
orders.void.all            - Void any items
orders.transfer            - Transfer orders
orders.split               - Split checks
orders.merge               - Merge checks
orders.reopen              - Reopen closed orders
```

**Payment Permissions:**
```
payments.process           - Process payments
payments.refund            - Process refunds
payments.cash_drawer       - Access cash drawer
payments.no_sale           - Open drawer without sale
payments.drop              - Make cash drops
payments.close_drawer      - Close out drawer
payments.view_totals       - View drawer totals
```

**Discount Permissions:**
```
discounts.apply            - Apply discounts
discounts.percent_max      - Maximum % discount allowed
discounts.amount_max       - Maximum $ discount allowed
discounts.comp             - Comp items/orders
discounts.approve          - Approve others' discounts
```

**Menu Permissions:**
```
menu.view                  - View menu
menu.86                    - 86 items
menu.edit                  - Edit menu items
menu.create                - Create menu items
menu.delete                - Delete menu items
menu.categories            - Manage categories
menu.modifiers             - Manage modifiers
```

**Employee Permissions:**
```
employees.view.own         - View own profile
employees.view.all         - View all employees
employees.create           - Create employees
employees.edit             - Edit employees
employees.terminate        - Terminate employees
employees.clock.own        - Clock in/out self
employees.clock.others     - Clock in/out others
employees.timecards.view   - View time cards
employees.timecards.edit   - Edit time cards
employees.schedules.view   - View schedules
employees.schedules.edit   - Edit schedules
```

**Reporting Permissions:**
```
reports.sales              - View sales reports
reports.labor              - View labor reports
reports.product            - View product reports
reports.financial          - View financial reports
reports.export             - Export reports
```

**System Permissions:**
```
system.settings            - Modify system settings
system.audit_log           - View audit logs
system.integrations        - Manage integrations
system.backup              - Backup/restore data
```

#### Permission Levels
Some permissions have levels:
- **None:** No access
- **Own:** Only own records
- **Section:** Records in assigned section
- **All:** Full access

### Time & Attendance

#### Clock In/Out
- [ ] PIN-based clock in
- [ ] Select job (if multiple)
- [ ] Automatic job detection (configurable)
- [ ] Clock in photo capture (optional)
- [ ] Geolocation verification (optional)
- [ ] Maximum shift length alerts
- [ ] Forgot to clock out handling

#### Break Tracking
- [ ] Start/end break
- [ ] Break types (paid, unpaid)
- [ ] Break duration rules
- [ ] Auto-deduct breaks (configurable)
- [ ] Break violation alerts

#### Time Card Management
- [ ] View time cards by employee
- [ ] View time cards by date range
- [ ] Edit time entries (with approval)
- [ ] Add missed punches
- [ ] Time card notes
- [ ] Approval workflow

#### Overtime Rules
- [ ] Daily overtime threshold
- [ ] Weekly overtime threshold
- [ ] Double-time rules
- [ ] State-specific rules

### Audit Logging (CRITICAL)

**Every action logged:**

#### What Gets Logged
- [ ] User authentication (login/logout)
- [ ] Order actions (create, modify, void, etc.)
- [ ] Payment actions (all transactions)
- [ ] Discount/comp actions
- [ ] Time clock actions
- [ ] Settings changes
- [ ] Menu changes
- [ ] Employee changes
- [ ] Report access

#### Log Entry Details
- [ ] Timestamp (precise)
- [ ] Employee ID
- [ ] Action type
- [ ] Action details
- [ ] Affected record ID(s)
- [ ] Before values
- [ ] After values
- [ ] Terminal/device ID
- [ ] IP address (for web)
- [ ] Location ID

#### Audit Log Access
- [ ] Search by employee
- [ ] Search by action type
- [ ] Search by date range
- [ ] Search by record
- [ ] Export audit logs
- [ ] Retention settings

### Scheduling (Phase 2)

#### Schedule Creation
- [ ] Shift creation
- [ ] Recurring shifts
- [ ] Template schedules
- [ ] Drag-and-drop builder
- [ ] Labor cost preview

#### Employee Features
- [ ] View personal schedule
- [ ] Availability management
- [ ] Shift swap requests
- [ ] Time-off requests

#### Publishing
- [ ] Draft vs published
- [ ] Notification on publish
- [ ] Schedule conflicts detection

---

## UI/UX Specifications

### Employee List

```
+------------------------------------------------------------------+
| EMPLOYEES                                    [+ Add Employee]    |
+------------------------------------------------------------------+
| Search: [________________]     Filter: [All Roles ▼] [Active ▼] |
+------------------------------------------------------------------+
| PHOTO | NAME           | ROLE        | STATUS  | LAST CLOCK    |
+------------------------------------------------------------------+
| [img] | Sarah Miller   | Server      | Clocked In | 4:02 PM    |
| [img] | Mike Johnson   | Bartender   | Clocked In | 3:45 PM    |
| [img] | Tom Brown      | Manager     | Off Today  | Yesterday   |
| [img] | Lisa Garcia    | Host        | Clocked Out| 2:30 PM    |
| [img] | James Wilson   | Server      | Inactive   | Jan 15      |
+------------------------------------------------------------------+
```

### Employee Profile

```
+------------------------------------------------------------------+
| EMPLOYEE: Sarah Miller                              [Edit] [Save]|
+------------------------------------------------------------------+
| [Profile Photo]     | BASIC INFO              | JOBS & PAY      |
|                     | Name: Sarah Miller      | Server    $12/hr|
| [Upload]            | ID: EMP-001             | Bartender $14/hr|
|                     | Email: sarah@...        |                 |
|                     | Phone: (555) 123-4567   | Primary: Server |
|                     | Hired: Jan 15, 2024     |                 |
+------------------------------------------------------------------+
| AUTHENTICATION                    | ROLES & PERMISSIONS          |
| POS PIN: ****                     | Assigned Roles:              |
| [Reset PIN]                       | ☑ Server                     |
| Admin Access: ☑ Enabled          | ☑ Bartender                  |
| [Reset Password]                  | ☐ Shift Lead                 |
|                                   | [View Permissions]           |
+------------------------------------------------------------------+
| RECENT ACTIVITY                                                  |
| Jan 27, 4:02 PM - Clocked in as Server                          |
| Jan 27, 4:15 PM - Created Order #1234                           |
| Jan 27, 4:22 PM - Added 3 items to Order #1234                  |
| Jan 27, 4:45 PM - Voided item (reason: Customer changed mind)   |
+------------------------------------------------------------------+
```

### Role Editor

```
+------------------------------------------------------------------+
| ROLE: Server                                           [Save]    |
+------------------------------------------------------------------+
| Name: [Server          ]    Clone from: [Select Role ▼]         |
| Description: [Basic order-taking staff                        ] |
+------------------------------------------------------------------+
| PERMISSIONS                                                      |
+------------------------------------------------------------------+
| ORDERS                          | PAYMENTS                       |
| ☑ Create orders                 | ☑ Process payments            |
| ☑ View own orders               | ☐ Process refunds             |
| ☐ View all orders               | ☑ Access cash drawer          |
| ☑ Modify own orders             | ☐ No-sale drawer open         |
| ☐ Modify all orders             | ☐ Close drawer                |
| ☑ Void own (unsent)             |                               |
| ☐ Void own (sent)               | DISCOUNTS                     |
| ☐ Void all                      | ☐ Apply discounts             |
| ☑ Transfer orders               | Max %: [0  ]                  |
| ☑ Split checks                  | Max $: [0  ]                  |
|                                 | ☐ Comp items                  |
+------------------------------------------------------------------+
| MENU                            | EMPLOYEES                      |
| ☑ View menu                     | ☑ View own profile            |
| ☐ 86 items                      | ☐ View all employees          |
| ☐ Edit menu                     | ☑ Clock in/out self           |
|                                 | ☐ Clock others                |
+------------------------------------------------------------------+
```

### Audit Log

```
+------------------------------------------------------------------+
| AUDIT LOG                                           [Export]     |
+------------------------------------------------------------------+
| Employee: [All ▼]  Action: [All ▼]  From: [01/27/26] To: [01/27]|
+------------------------------------------------------------------+
| TIMESTAMP        | EMPLOYEE      | ACTION           | DETAILS    |
+------------------------------------------------------------------+
| 4:45:23 PM       | Sarah Miller  | Order Item Void  | Order #1234|
|                  |               |                  | Item: Burger|
|                  |               |                  | Reason: Cust|
+------------------------------------------------------------------+
| 4:22:01 PM       | Sarah Miller  | Order Items Add  | Order #1234|
|                  |               |                  | 3 items    |
+------------------------------------------------------------------+
| 4:15:45 PM       | Sarah Miller  | Order Created    | Order #1234|
|                  |               |                  | Table 12   |
+------------------------------------------------------------------+
| 4:02:11 PM       | Sarah Miller  | Clock In         | Job: Server|
|                  |               |                  | Terminal: 1|
+------------------------------------------------------------------+
```

---

## Data Model

### Employees
```sql
employees {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  -- Basic info
  first_name: VARCHAR(100)
  last_name: VARCHAR(100)
  display_name: VARCHAR(100)
  employee_number: VARCHAR(20) UNIQUE

  email: VARCHAR(200) (nullable)
  phone: VARCHAR(20) (nullable)
  address_line_1: VARCHAR(200) (nullable)
  address_line_2: VARCHAR(200) (nullable)
  city: VARCHAR(100) (nullable)
  state: VARCHAR(50) (nullable)
  postal_code: VARCHAR(20) (nullable)

  date_of_birth: DATE (nullable)

  -- Employment
  hire_date: DATE
  termination_date: DATE (nullable)
  termination_reason: VARCHAR(200) (nullable)
  employment_type: VARCHAR(50) (full_time, part_time, contractor)
  status: VARCHAR(50) (active, inactive, terminated)

  -- Media
  photo_url: VARCHAR(500) (nullable)

  -- Emergency contact
  emergency_contact_name: VARCHAR(100) (nullable)
  emergency_contact_phone: VARCHAR(20) (nullable)
  emergency_contact_relation: VARCHAR(50) (nullable)

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Employee Authentication
```sql
employee_auth {
  employee_id: UUID PRIMARY KEY (FK)

  pin_hash: VARCHAR(200)
  pin_salt: VARCHAR(100)
  password_hash: VARCHAR(200) (nullable) -- For admin access
  password_salt: VARCHAR(100) (nullable)

  failed_attempts: INTEGER DEFAULT 0
  locked_until: TIMESTAMP (nullable)

  last_login: TIMESTAMP (nullable)
  must_change_password: BOOLEAN DEFAULT false

  updated_at: TIMESTAMP
}
```

### Jobs
```sql
jobs {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  name: VARCHAR(100)
  description: TEXT (nullable)

  default_pay_rate: DECIMAL(10,2)
  pay_type: VARCHAR(20) (hourly, salary)

  department: VARCHAR(100) (nullable)

  is_active: BOOLEAN DEFAULT true
  sort_order: INTEGER

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Employee Jobs
```sql
employee_jobs {
  id: UUID PRIMARY KEY
  employee_id: UUID (FK)
  job_id: UUID (FK)

  pay_rate: DECIMAL(10,2)
  is_primary: BOOLEAN DEFAULT false

  effective_date: DATE
  end_date: DATE (nullable)

  created_at: TIMESTAMP
}
```

### Roles
```sql
roles {
  id: UUID PRIMARY KEY
  location_id: UUID (FK, nullable) -- NULL = system-wide

  name: VARCHAR(100)
  description: TEXT (nullable)

  is_system: BOOLEAN DEFAULT false -- Built-in roles
  is_active: BOOLEAN DEFAULT true

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Role Permissions
```sql
role_permissions {
  id: UUID PRIMARY KEY
  role_id: UUID (FK)

  permission_key: VARCHAR(100)
  permission_value: VARCHAR(50) (none, own, section, all, or specific value)

  created_at: TIMESTAMP
}
```

### Employee Roles
```sql
employee_roles {
  employee_id: UUID (FK)
  role_id: UUID (FK)

  assigned_at: TIMESTAMP
  assigned_by: UUID (FK)

  PRIMARY KEY (employee_id, role_id)
}
```

### Time Entries
```sql
time_entries {
  id: UUID PRIMARY KEY
  employee_id: UUID (FK)
  job_id: UUID (FK)
  location_id: UUID (FK)

  clock_in: TIMESTAMP
  clock_out: TIMESTAMP (nullable)

  -- Breaks
  break_minutes: INTEGER DEFAULT 0

  -- Calculated
  regular_hours: DECIMAL(5,2) (nullable)
  overtime_hours: DECIMAL(5,2) (nullable)

  -- Pay rate at time of entry
  pay_rate: DECIMAL(10,2)

  -- Status
  status: VARCHAR(50) (active, completed, edited, approved)

  -- Metadata
  clock_in_terminal: VARCHAR(100) (nullable)
  clock_out_terminal: VARCHAR(100) (nullable)

  notes: TEXT (nullable)

  -- Audit
  edited_by: UUID (FK, nullable)
  edited_at: TIMESTAMP (nullable)
  edit_reason: VARCHAR(200) (nullable)
  approved_by: UUID (FK, nullable)
  approved_at: TIMESTAMP (nullable)

  created_at: TIMESTAMP
  updated_at: TIMESTAMP
}
```

### Audit Log
```sql
audit_log {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  -- Who
  employee_id: UUID (FK, nullable) -- Null for system actions

  -- When
  timestamp: TIMESTAMP

  -- What
  action_category: VARCHAR(50) (order, payment, employee, menu, system)
  action_type: VARCHAR(100) (order.create, payment.process, etc.)
  action_description: TEXT

  -- Context
  entity_type: VARCHAR(50) (order, order_item, employee, etc.)
  entity_id: UUID (nullable)

  -- Changes
  before_data: JSONB (nullable)
  after_data: JSONB (nullable)

  -- Technical
  terminal_id: VARCHAR(100) (nullable)
  ip_address: VARCHAR(45) (nullable)
  user_agent: VARCHAR(500) (nullable)

  -- Indexing
  created_at: TIMESTAMP

  -- Partitioning by month recommended for large tables
}

-- Indexes
CREATE INDEX idx_audit_log_employee ON audit_log(employee_id, timestamp);
CREATE INDEX idx_audit_log_action ON audit_log(action_type, timestamp);
CREATE INDEX idx_audit_log_entity ON audit_log(entity_type, entity_id);
```

---

## API Endpoints

### Employees
```
GET    /api/employees
POST   /api/employees
GET    /api/employees/{id}
PUT    /api/employees/{id}
DELETE /api/employees/{id}
POST   /api/employees/{id}/reset-pin
POST   /api/employees/{id}/reset-password
```

### Jobs
```
GET    /api/jobs
POST   /api/jobs
PUT    /api/jobs/{id}
DELETE /api/jobs/{id}
```

### Employee Jobs
```
GET    /api/employees/{id}/jobs
POST   /api/employees/{id}/jobs
PUT    /api/employees/{id}/jobs/{job_id}
DELETE /api/employees/{id}/jobs/{job_id}
```

### Roles
```
GET    /api/roles
POST   /api/roles
GET    /api/roles/{id}
PUT    /api/roles/{id}
DELETE /api/roles/{id}
GET    /api/roles/{id}/permissions
PUT    /api/roles/{id}/permissions
```

### Employee Roles
```
GET    /api/employees/{id}/roles
POST   /api/employees/{id}/roles
DELETE /api/employees/{id}/roles/{role_id}
```

### Time Entries
```
POST   /api/time/clock-in
POST   /api/time/clock-out
POST   /api/time/break-start
POST   /api/time/break-end
GET    /api/time/entries
GET    /api/time/entries/{id}
PUT    /api/time/entries/{id}
POST   /api/time/entries/{id}/approve
GET    /api/employees/{id}/timecards
```

### Audit Log
```
GET    /api/audit-log
GET    /api/audit-log/export
GET    /api/employees/{id}/activity
```

### Authentication
```
POST   /api/auth/pin
POST   /api/auth/password
POST   /api/auth/logout
GET    /api/auth/me
```

---

## Business Rules

1. **Unique PINs:** All employee PINs must be unique within location
2. **PIN Security:** PINs hashed, never stored or displayed in plain text
3. **Lockout:** After 5 failed PIN attempts, lock for 5 minutes
4. **Clock Validation:** Cannot clock in if already clocked in
5. **Overtime Calc:** Overtime calculated at end of each day/week
6. **Audit Immutability:** Audit log entries cannot be modified or deleted
7. **Role Inheritance:** Consider role hierarchy for permission inheritance
8. **Termination:** Terminated employees cannot log in but records preserved

---

## Permissions

| Action | Server | Manager | Admin |
|--------|--------|---------|-------|
| View own profile | Yes | Yes | Yes |
| Edit own profile | Limited | Limited | Yes |
| View all employees | No | Yes | Yes |
| Create employees | No | Yes | Yes |
| Edit employees | No | Yes | Yes |
| Terminate employees | No | Manager Only | Yes |
| Manage roles | No | No | Yes |
| View audit log | No | Limited | Yes |
| Export audit log | No | No | Yes |
| Manage jobs | No | Yes | Yes |
| Approve time cards | No | Yes | Yes |

---

## Configuration Options

```yaml
employees_roles:
  authentication:
    pin_length: 4
    pin_unique: true
    max_failed_attempts: 5
    lockout_minutes: 5
    session_timeout_minutes: 30

  time_tracking:
    enabled: true
    require_job_selection: true
    auto_break_deduction: false
    auto_break_minutes: 30
    auto_break_after_hours: 6
    overtime_daily_threshold: 8
    overtime_weekly_threshold: 40

  audit:
    retention_days: 365
    log_report_views: true
    log_menu_views: false

  scheduling:
    enabled: false  # Phase 2
```

---

## Open Questions

1. **Biometric Clock:** Support fingerprint/face for clock in?

2. **GPS Verification:** Require location when clocking in via mobile?

3. **Photo Verification:** Capture photo on clock in?

4. **Permission Groups:** Support for permission groups in addition to roles?

5. **Audit Log Retention:** How long to keep audit logs? (Legal requirements)

6. **Multi-Location Employees:** Support employees working at multiple locations?

---

## Status & Progress

### Planning
- [x] Initial requirements documented
- [x] Data model defined
- [ ] Permission matrix finalized
- [ ] UI mockups created

### Development
- [ ] Employee CRUD
- [ ] Authentication system
- [ ] Role management
- [ ] Permission system
- [ ] Time tracking
- [ ] Audit logging
- [ ] Admin interface

### Testing
- [ ] Unit tests
- [ ] Permission tests
- [ ] Security testing
- [ ] Performance (audit log volume)

---

*Last Updated: January 27, 2026*
