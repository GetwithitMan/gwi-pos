# 12 - Transfers

**Status:** Planning
**Priority:** High
**Dependencies:** 04-Order-Management, 05-Employees-Roles

---

## Overview

The Transfers skill handles moving items, orders, and ownership between tables, seats, servers, and sections. This is critical for smooth operations during shift changes, table moves, and service adjustments.

**Primary Goal:** Enable seamless transfers without losing order history, tip attribution, or operational continuity.

---

## User Stories

### As a Server...
- I want to transfer my tables to another server at shift change
- I want to move items from one seat to another
- I want to transfer a check to a different table when guests move
- I want to send an item to another server's table

### As a Manager...
- I want to reassign sections when servers clock out
- I want to track who originally took an order vs who closes it
- I want to see transfer history for accountability

### As a Bartender...
- I want to transfer a bar tab to a table when guests are seated
- I want to receive tabs transferred from the patio

---

## Features

### Transfer Types

#### Item Transfer
- [ ] Move item(s) to different seat on same table
- [ ] Move item(s) to different table
- [ ] Move item(s) to different check entirely
- [ ] Send item to bar tab

#### Check/Order Transfer
- [ ] Transfer entire check to different table
- [ ] Transfer check to different server
- [ ] Transfer bar tab to table (and vice versa)

#### Table Transfer
- [ ] Move party to different table
- [ ] Swap tables (with another party)
- [ ] Combine tables

#### Ownership Transfer
- [ ] Transfer to another server (tip attribution)
- [ ] Partial transfer (some items/checks)
- [ ] Section handoff (all tables in section)

### Transfer Workflow

#### Quick Item Transfer
```
[Hold item] → [Drag to seat/table] → Done

Or:

[Select item] → [Transfer] → [Pick destination] → Done
```

#### Check Transfer
```
[Select check] → [Transfer] → [Select new owner/table] → [Confirm] → Done
```

#### Bulk Transfer (Shift Handoff)
```
[Manager Functions] → [Section Transfer]
→ Select outgoing server
→ Select incoming server
→ Review tables/checks
→ [Confirm Transfer]
```

### Transfer Scenarios

#### Seat-to-Seat (Same Table)
- [ ] Drag item between seats
- [ ] No ownership change
- [ ] Updates ticket if already sent

#### Table-to-Table (Same Server)
- [ ] Move guests and order to new table
- [ ] Original table becomes available
- [ ] Timer continues from original seat time

#### Server-to-Server (Ownership Change)
- [ ] Tip attribution options:
  - All tips to new server
  - Split based on time
  - Original server keeps
- [ ] Requires acceptance from receiving server
- [ ] Tracks both servers in history

#### Bar-to-Table
- [ ] Tab converts to table order
- [ ] Card on file options:
  - Keep for payment
  - Release pre-auth
- [ ] Bartender tip-out maintained

### Transfer Tracking

#### What Gets Tracked
- [ ] Who initiated transfer
- [ ] Original owner
- [ ] New owner
- [ ] Timestamp
- [ ] Reason (optional)
- [ ] Items transferred
- [ ] Tip handling method

#### Transfer History
- [ ] View all transfers for a check
- [ ] View all transfers by employee
- [ ] View transfers for a shift
- [ ] Audit trail for disputes

### Transfer Notifications

#### Alert Recipients
- [ ] Receiving server gets notification
- [ ] Manager notified of handoffs
- [ ] Kitchen notified if affects tickets

---

## UI/UX Specifications

### Item Transfer (Drag)

```
+------------------------------------------------------------------+
| TABLE 12                                                         |
+------------------------------------------------------------------+
|   SEAT 1              SEAT 2              SEAT 3              |
| +--------------+    +--------------+    +--------------+         |
| | Burger       |    | Salmon       |    |              |         |
| | Fries        |    | Salad        |    |              |         |
| | [Dragging]   |====|==============|===>| [Drop here]  |         |
| |    Beer      |    |              |    |              |         |
| +--------------+    +--------------+    +--------------+         |
|                                                                  |
| Dragging "Beer" from Seat 1...                                  |
+------------------------------------------------------------------+
```

### Check Transfer Modal

```
+------------------------------------------------------------------+
| TRANSFER CHECK #1234                                  [Cancel]   |
+------------------------------------------------------------------+
|                                                                  |
| From: Table 12 / Sarah M.                                        |
| Total: $87.50 (4 items)                                          |
|                                                                  |
| Transfer to:                                                     |
|                                                                  |
| [TABLE]                    [SERVER]                              |
| +------------------+       +------------------+                   |
| | Table: [   ▼]   |       | Server: [  ▼]   |                   |
| | 5, 6, 8, 10... |       | Mike J.          |                   |
| +------------------+       | Lisa G.          |                   |
|                            | Tom B.           |                   |
|                            +------------------+                   |
|                                                                  |
| TIP HANDLING:                                                    |
| (•) Tips go to new server                                        |
| ( ) Split tips by time worked                                    |
| ( ) Original server keeps tips                                   |
|                                                                  |
| Reason (optional): [_______________________________]             |
|                                                                  |
| [Back]                                   [Transfer]              |
+------------------------------------------------------------------+
```

### Section Handoff

```
+------------------------------------------------------------------+
| SECTION HANDOFF                                       [Cancel]   |
+------------------------------------------------------------------+
| Outgoing: Sarah M. (clocking out)                                |
| Incoming: Mike J.                                                |
|                                                                  |
| TABLES TO TRANSFER:                                              |
| +-------------------------------------------------------------+ |
| | ☑ Table 5  - $45.00 - 2 guests - 0:32                       | |
| | ☑ Table 6  - $0.00 (just sat)                               | |
| | ☑ Table 8  - $123.50 - 4 guests - 1:15                      | |
| | ☑ Table 10 - $67.25 - 3 guests - 0:45                       | |
| +-------------------------------------------------------------+ |
|                                                                  |
| Total: 4 tables, $235.75 in open checks                         |
|                                                                  |
| TIP HANDLING FOR ALL:                                            |
| (•) Split tips 50/50                                             |
| ( ) Tips go entirely to Mike J.                                  |
| ( ) Sarah M. keeps tips earned so far                           |
|                                                                  |
| [Cancel]                              [Confirm Handoff]          |
+------------------------------------------------------------------+
```

### Transfer History View

```
+------------------------------------------------------------------+
| TRANSFER HISTORY - Check #1234                                   |
+------------------------------------------------------------------+
| Current: Table 8 / Mike J.                                       |
+------------------------------------------------------------------+
|                                                                  |
| TRANSFER LOG:                                                    |
| +-------------------------------------------------------------+ |
| | 6:45 PM - Created at Table 12 by Sarah M.                   | |
| |                                                              | |
| | 7:30 PM - Item "Dessert" moved from Seat 1 to Seat 3        | |
| |           By: Sarah M.                                       | |
| |                                                              | |
| | 8:15 PM - Transferred to Mike J. (shift change)             | |
| |           From: Sarah M.                                     | |
| |           Tip split: 50/50                                   | |
| |           Approved by: Manager Tom                          | |
| |                                                              | |
| | 8:20 PM - Moved to Table 8                                  | |
| |           From: Table 12                                     | |
| |           By: Mike J.                                        | |
| +-------------------------------------------------------------+ |
|                                                                  |
+------------------------------------------------------------------+
```

---

## Data Model

### Transfers
```sql
transfers {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  -- What was transferred
  transfer_type: VARCHAR(50) (item, check, table, section)

  -- Source
  source_order_id: UUID (FK, nullable)
  source_table_id: UUID (FK, nullable)
  source_employee_id: UUID (FK)

  -- Destination
  target_order_id: UUID (FK, nullable)
  target_table_id: UUID (FK, nullable)
  target_employee_id: UUID (FK)

  -- Details
  reason: VARCHAR(200) (nullable)
  tip_handling: VARCHAR(50) (new_server, split, original)
  tip_split_percent: INTEGER (nullable)

  -- Approval
  requires_approval: BOOLEAN DEFAULT false
  approved_by: UUID (FK, nullable)
  approved_at: TIMESTAMP (nullable)

  -- Status
  status: VARCHAR(50) (pending, completed, rejected)

  transferred_by: UUID (FK)
  transferred_at: TIMESTAMP

  created_at: TIMESTAMP
}
```

### Transfer Items
```sql
transfer_items {
  id: UUID PRIMARY KEY
  transfer_id: UUID (FK)

  order_item_id: UUID (FK)
  from_seat: INTEGER (nullable)
  to_seat: INTEGER (nullable)

  created_at: TIMESTAMP
}
```

### Transfer Tips
```sql
transfer_tip_allocations {
  id: UUID PRIMARY KEY
  transfer_id: UUID (FK)
  order_id: UUID (FK)

  original_employee_id: UUID (FK)
  original_allocation_percent: DECIMAL(5,2)

  new_employee_id: UUID (FK)
  new_allocation_percent: DECIMAL(5,2)

  created_at: TIMESTAMP
}
```

---

## API Endpoints

### Item Transfers
```
POST   /api/orders/{id}/items/{item_id}/transfer
       Body: { target_seat, target_order_id }
```

### Check Transfers
```
POST   /api/orders/{id}/transfer
       Body: { target_table_id, target_employee_id, tip_handling }
```

### Table Transfers
```
POST   /api/tables/{id}/transfer
       Body: { target_table_id }
```

### Section Handoff
```
POST   /api/sections/{id}/handoff
       Body: { from_employee_id, to_employee_id, tip_handling, table_ids }
```

### Approval
```
POST   /api/transfers/{id}/approve
POST   /api/transfers/{id}/reject
```

### History
```
GET    /api/orders/{id}/transfers
GET    /api/employees/{id}/transfers
GET    /api/transfers?date={date}
```

---

## Business Rules

1. **Ownership Tracking:** Original creator always tracked regardless of transfers
2. **Tip Attribution:** Default tip handling configurable by location
3. **Approval Requirements:** Manager approval may be required for ownership transfers
4. **Kitchen Notification:** Transfers after send update KDS if applicable
5. **Time Tracking:** Transfer doesn't reset table time
6. **Audit Trail:** All transfers logged permanently

---

## Permissions

| Action | Server | Manager | Admin |
|--------|--------|---------|-------|
| Transfer own items | Yes | Yes | Yes |
| Transfer own checks | Yes | Yes | Yes |
| Transfer any items | No | Yes | Yes |
| Transfer any checks | No | Yes | Yes |
| Section handoff | No | Yes | Yes |
| Approve transfers | No | Yes | Yes |
| View transfer history | Own | Yes | Yes |

---

## Configuration Options

```yaml
transfers:
  items:
    allow_cross_table: true
    notify_kitchen: true

  checks:
    require_manager_approval: false
    notify_receiving_server: true

  ownership:
    default_tip_handling: "split"  # or "new_server", "original"
    default_split_percent: 50

  section_handoff:
    enabled: true
    require_manager: true
```

---

## Open Questions

1. **Declined Transfers:** Can receiving server decline a transfer?

2. **Partial Tips:** Track tips earned before vs after transfer?

3. **Transfer Limits:** Limit how many times a check can transfer?

4. **Automatic Handoff:** Auto-transfer at clock-out time?

---

## Status & Progress

### Planning
- [x] Initial requirements documented
- [ ] Tip handling scenarios detailed
- [ ] UI mockups

### Development
- [ ] Item transfers
- [ ] Check transfers
- [ ] Table transfers
- [ ] Section handoff
- [ ] Approval workflow
- [ ] Transfer history
- [ ] Notifications

---

*Last Updated: January 27, 2026*
