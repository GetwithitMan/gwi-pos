# 19 - Voids

**Status:** Planning
**Priority:** High
**Dependencies:** 04-Order-Management, 05-Employees-Roles

---

## Overview

The Voids skill manages the removal of items and orders from checks, including pre-send voids, post-send voids, and full order cancellations. Critically important for loss prevention and accountability.

**Primary Goal:** Enable necessary voids while maintaining strict controls, complete accountability, and clear audit trails.

---

## User Stories

### As a Server...
- I want to void items I entered incorrectly before sending
- I want to request a void when a customer changes their mind
- I want to know if I need manager approval for a void

### As a Manager...
- I want to approve voids quickly without leaving the floor
- I want to see all voids and their reasons
- I want alerts for excessive voiding
- I want to understand why voids happen

### As an Owner...
- I want to track void costs
- I want to identify void patterns
- I want to prevent void abuse

---

## Features

### Void Types

#### Pre-Send Void
- [ ] Item not yet sent to kitchen
- [ ] No approval required (configurable)
- [ ] No reason required (configurable)
- [ ] Instant removal

#### Post-Send Void
- [ ] Item already sent to kitchen
- [ ] May require approval
- [ ] Reason required
- [ ] Kitchen notified

#### Full Order Void
- [ ] Cancel entire order
- [ ] All items voided
- [ ] Requires approval
- [ ] Reason required

#### Payment Void
- [ ] Void a completed payment
- [ ] Before settlement only
- [ ] Refund required after settlement

### Void vs Comp

#### Void
- Item removed, not made (or mistake)
- No cost incurred (ideally)
- Removed from check entirely

#### Comp
- Item made and given free
- Cost incurred
- Shows on check as $0

### Void Reasons

#### Pre-Set Reasons
```yaml
void_reasons:
  pre_send:
    - "Entered incorrectly"
    - "Customer changed mind"
    - "Duplicate entry"

  post_send:
    - "Customer changed mind"
    - "Quality issue"
    - "Long wait time"
    - "Wrong item sent"
    - "Customer allergy"
    - "Manager decision"

  order:
    - "Customer left"
    - "Duplicate order"
    - "Test order"
    - "System error"
```

#### Custom Reasons
- [ ] Free text option
- [ ] Required for certain void types
- [ ] Searchable in reports

### Approval Workflow

#### Approval Rules
```yaml
approvals:
  pre_send:
    require_approval: false

  post_send:
    require_approval: true
    own_items_approval: false  # Can void own items without approval
    others_items_approval: true

  order_void:
    require_approval: true
    always_require: true
```

#### Approval Process
- [ ] Server initiates void
- [ ] System checks approval requirements
- [ ] If needed, notification sent to managers
- [ ] Manager approves/denies
- [ ] Void completed or rejected

#### Remote Approval
- [ ] Manager can approve from any terminal
- [ ] Mobile approval notification
- [ ] Quick approve with PIN

### Void Controls

#### Permission Levels
- [ ] Can void own items (pre-send)
- [ ] Can void own items (post-send)
- [ ] Can void any items
- [ ] Can void orders
- [ ] Can approve voids

#### Limits
- [ ] Maximum void amount without approval
- [ ] Maximum voids per shift
- [ ] Void cooldown (prevent rapid voids)

### Kitchen Communication

#### Post-Send Voids
- [ ] Notification to kitchen
- [ ] Stop preparation if possible
- [ ] Waste tracking integration

#### Void Display on KDS
- [ ] Strike-through or removal
- [ ] Void reason visible
- [ ] Alert for expensive items

### Tracking & Reporting

#### What's Tracked
- [ ] Who voided
- [ ] What was voided
- [ ] When (before/after send)
- [ ] Why (reason)
- [ ] Value voided
- [ ] Approval details
- [ ] Time to approve

#### Alerts
- [ ] High void employee
- [ ] High void item
- [ ] Unusual patterns
- [ ] Large value voids

---

## UI/UX Specifications

### Void Item Modal

```
+------------------------------------------------------------------+
| VOID ITEM                                             [Cancel]   |
+------------------------------------------------------------------+
|                                                                  |
| Item: Ribeye Steak - $34.99                                     |
| Status: SENT TO KITCHEN                                         |
|                                                                  |
| ⚠️ This item has been sent to kitchen.                          |
| Kitchen will be notified.                                       |
|                                                                  |
| REASON (Required):                                               |
| ( ) Customer changed mind                                        |
| ( ) Quality issue                                                |
| ( ) Long wait time                                               |
| ( ) Wrong item sent                                              |
| (•) Other: [Customer has allergy_________________]               |
|                                                                  |
| Manager approval: REQUIRED                                       |
|                                                                  |
| [Cancel]                                    [Request Void]       |
+------------------------------------------------------------------+
```

### Void Approval Queue (Manager View)

```
+------------------------------------------------------------------+
| PENDING VOID APPROVALS                                           |
+------------------------------------------------------------------+
|                                                                  |
| +-------------------------------------------------------------+ |
| | Table 12 - Sarah M.                           2 min ago     | |
| | Ribeye Steak - $34.99                                       | |
| | Reason: "Customer has allergy"                              | |
| |                                              [Deny] [Approve]| |
| +-------------------------------------------------------------+ |
|                                                                  |
| +-------------------------------------------------------------+ |
| | Table 8 - Mike J.                             5 min ago     | |
| | 2x IPA - $14.00                                              | |
| | Reason: "Wrong beer, customer wanted lager"                 | |
| |                                              [Deny] [Approve]| |
| +-------------------------------------------------------------+ |
|                                                                  |
+------------------------------------------------------------------+
```

### Void Order Confirmation

```
+------------------------------------------------------------------+
| VOID ENTIRE ORDER                                     [Cancel]   |
+------------------------------------------------------------------+
|                                                                  |
| ⚠️ WARNING: This will void the entire order                     |
|                                                                  |
| Order #1234 - Table 12                                          |
| Items: 6                                                        |
| Value: $87.50                                                   |
| Sent to Kitchen: Yes (4 items)                                  |
|                                                                  |
| ITEMS TO BE VOIDED:                                              |
| - Wings              $12.99  (Sent)                             |
| - Ribeye             $34.99  (Sent)                             |
| - Caesar Salad        $8.99  (Sent)                             |
| - House Salad         $8.99  (Sent)                             |
| - 2x IPA             $14.00  (Not sent)                         |
| - Cheesecake          $7.54  (Not sent)                         |
|                                                                  |
| REASON (Required):                                               |
| [Customer walked out - complaint about wait time_____]          |
|                                                                  |
| ☑ This will require manager approval                            |
|                                                                  |
| [Cancel]                                    [Request Void]       |
+------------------------------------------------------------------+
```

### Void Report

```
+------------------------------------------------------------------+
| VOID REPORT                                      Jan 27, 2026    |
+------------------------------------------------------------------+
| Period: [Today ▼]                                    [Export]    |
+------------------------------------------------------------------+
| SUMMARY                                                          |
| Total Voids: $234.67                                            |
| Void Count: 18 items                                            |
| Pre-Send: 12 items ($98.45)                                     |
| Post-Send: 6 items ($136.22)                                    |
| Orders Voided: 1 ($42.50)                                       |
+------------------------------------------------------------------+
| BY EMPLOYEE                                                      |
| Employee        | Count | Pre-Send | Post-Send | Total          |
| Sarah M.        |   5   |  $34.50  |   $45.00  | $79.50         |
| Mike J.         |   4   |  $28.00  |   $32.00  | $60.00         |
| Lisa G.         |   3   |  $12.45  |   $15.22  | $27.67         |
+------------------------------------------------------------------+
| BY REASON                                                        |
| Customer changed mind:      8  ($98.00)                         |
| Entered incorrectly:        5  ($45.67)                         |
| Quality issue:              3  ($56.00)                         |
| Other:                      2  ($35.00)                         |
+------------------------------------------------------------------+
| ⚠️ ALERTS                                                        |
| "Ribeye Steak" voided 3 times today - investigate               |
+------------------------------------------------------------------+
```

---

## Data Model

### Voids
```sql
voids {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  -- What was voided
  void_type: VARCHAR(50) (item, order)
  order_id: UUID (FK)
  order_item_id: UUID (FK, nullable)

  -- Item details (captured at void time)
  item_name: VARCHAR(200)
  item_price: DECIMAL(10,2)
  quantity: INTEGER DEFAULT 1
  void_amount: DECIMAL(10,2)

  -- Status at void
  was_sent_to_kitchen: BOOLEAN

  -- Reason
  void_reason_id: UUID (FK, nullable)
  reason_text: VARCHAR(500)

  -- Approval
  requires_approval: BOOLEAN
  approval_status: VARCHAR(50) (pending, approved, denied)
  approved_by: UUID (FK, nullable)
  approved_at: TIMESTAMP (nullable)
  denial_reason: VARCHAR(200) (nullable)

  -- Who
  voided_by: UUID (FK)
  voided_at: TIMESTAMP

  created_at: TIMESTAMP
}
```

### Void Reasons
```sql
void_reasons {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  reason_text: VARCHAR(200)
  void_type: VARCHAR(50) (pre_send, post_send, order, all)
  requires_notes: BOOLEAN DEFAULT false

  is_active: BOOLEAN DEFAULT true
  sort_order: INTEGER

  created_at: TIMESTAMP
}
```

### Void Settings
```sql
void_settings {
  id: UUID PRIMARY KEY
  location_id: UUID (FK)

  -- Pre-send
  pre_send_approval_required: BOOLEAN DEFAULT false
  pre_send_reason_required: BOOLEAN DEFAULT false

  -- Post-send
  post_send_approval_required: BOOLEAN DEFAULT true
  post_send_reason_required: BOOLEAN DEFAULT true
  post_send_own_items_approval: BOOLEAN DEFAULT false

  -- Order
  order_void_approval_required: BOOLEAN DEFAULT true

  -- Limits
  void_amount_approval_threshold: DECIMAL(10,2) (nullable)
  max_voids_per_shift: INTEGER (nullable)

  -- Alerts
  alert_threshold_count: INTEGER (nullable)
  alert_threshold_amount: DECIMAL(10,2) (nullable)

  updated_at: TIMESTAMP
}
```

---

## API Endpoints

### Void Operations
```
POST   /api/orders/{id}/items/{item_id}/void
POST   /api/orders/{id}/void
GET    /api/orders/{id}/voids
```

### Approval
```
GET    /api/voids/pending
POST   /api/voids/{id}/approve
POST   /api/voids/{id}/deny
```

### Void Reasons
```
GET    /api/void-reasons
POST   /api/void-reasons
PUT    /api/void-reasons/{id}
DELETE /api/void-reasons/{id}
```

### Reporting
```
GET    /api/reports/voids/summary
GET    /api/reports/voids/by-employee
GET    /api/reports/voids/by-item
GET    /api/reports/voids/by-reason
GET    /api/reports/voids/alerts
```

### Settings
```
GET    /api/locations/{loc}/void-settings
PUT    /api/locations/{loc}/void-settings
```

---

## Business Rules

1. **Pre-Send Freedom:** Items not sent can typically be voided freely
2. **Post-Send Control:** Items sent to kitchen need approval
3. **Reason Required:** Post-send and order voids require reason
4. **No Undo:** Voids cannot be undone (must re-add item)
5. **Kitchen Sync:** Post-send voids notify kitchen immediately
6. **Cost Tracking:** Void costs tracked for loss prevention

---

## Permissions

| Action | Server | Shift Lead | Manager | Admin |
|--------|--------|------------|---------|-------|
| Void own (pre-send) | Yes | Yes | Yes | Yes |
| Void own (post-send) | Config | Yes | Yes | Yes |
| Void any item | No | Config | Yes | Yes |
| Void order | No | No | Yes | Yes |
| Approve voids | No | Config | Yes | Yes |
| Configure void settings | No | No | Yes | Yes |
| View void reports | No | Config | Yes | Yes |

---

## Configuration Options

```yaml
voids:
  pre_send:
    require_approval: false
    require_reason: false

  post_send:
    require_approval: true
    require_reason: true
    own_items_exempt: true

  order:
    require_approval: true
    require_reason: true

  limits:
    approval_threshold_amount: 25.00
    max_per_shift: null  # Unlimited

  alerts:
    enabled: true
    count_threshold: 5  # Alert if > 5 voids per shift
    amount_threshold: 100.00  # Alert if > $100 voided
    item_threshold: 3  # Alert if same item voided 3x

  kitchen:
    notify_on_void: true
    show_void_reason: true
```

---

## Open Questions

1. **Void Window:** Time limit for voiding items?

2. **Partial Void:** Void 1 of 3 identical items?

3. **Void Reversal:** Allow manager to undo voids?

4. **Waste Integration:** Link voids to waste tracking?

---

## Status & Progress

### Planning
- [x] Initial requirements documented
- [ ] Approval workflow detailed
- [ ] Permission matrix finalized

### Development
- [ ] Void functionality
- [ ] Approval workflow
- [ ] Kitchen notification
- [ ] Reason management
- [ ] Reporting
- [ ] Alerts

---

*Last Updated: January 27, 2026*
