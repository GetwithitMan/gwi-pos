# Skill 243: Admin Audit Viewer - Per-Order Activity Timeline

**Status:** API Complete
**Created:** 2026-02-08

## Overview

Read-only audit viewer for managers to see the full activity timeline of any order. Assembles data from AuditLog, VoidLog, Payment records, and Order timestamps into a single chronological timeline.

## API Endpoints

### GET /api/orders/[id]/timeline

Per-order activity timeline. Returns all events for a single order in chronological order.

**Query params:**
- `employeeId` (required) - requesting employee for auth check

**Response:**
```json
{
  "orderId": "...",
  "orderNumber": 42,
  "timeline": [
    {
      "id": "...",
      "timestamp": "2026-02-08T12:00:00Z",
      "action": "order_created",
      "source": "audit",
      "employeeId": "...",
      "employeeName": "John Smith",
      "details": { "orderNumber": 42, "orderType": "dine_in" }
    }
  ]
}
```

**Timeline sources:**
- `audit` - AuditLog entries (order_created, items_added, sent_to_kitchen, order_closed, tab_ownership_transferred, etc.)
- `void` - VoidLog entries (item_voided, order_voided) with reason, wasMade, approvedBy
- `payment` - Payment records not already covered by audit logs
- `order` - Order timestamps (createdAt, paidAt)

**Deduplication:** If both an AuditLog entry and an Order timestamp represent the same event (e.g., order_created), the audit version is kept (richer details).

### GET /api/audit/activity

Global audit log with pagination and filters. Returns audit entries across all orders.

**Query params:**
- `employeeId` (required) - requesting employee for auth check
- `locationId` (required)
- `startDate` / `endDate` - ISO date range filter
- `actionType` - filter by action (e.g., "order_created", "payment_processed")
- `filterEmployeeId` - filter by acting employee
- `limit` (default 50, max 200)
- `offset` (default 0)

**Response:**
```json
{
  "entries": [...],
  "total": 150,
  "limit": 50,
  "offset": 0
}
```

## Auth

Both endpoints require `manager.shift_review` permission.

## Action Types

| Action | Source | Description |
|--------|--------|-------------|
| order_created | audit | Order was created |
| items_added | audit | Items appended to order |
| sent_to_kitchen | audit | Order sent to kitchen |
| payment_processed | audit | Payment completed |
| order_closed | audit | Order fully paid and closed |
| tab_ownership_transferred | audit | Tab transferred between employees |
| item_voided | void | Item voided with reason |
| order_voided | void | Entire order voided |
| items_transferred | audit | Items moved between orders |
| order_merged | audit | Orders merged |
| virtual_group_dissolved | audit | Combined tables split on payment |

## Key Files

- `src/app/api/orders/[id]/timeline/route.ts` - Per-order timeline
- `src/app/api/audit/activity/route.ts` - Global audit list
